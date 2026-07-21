// Rung 6 · Signer: Data Integrity proof, cryptosuite eddsa-rdfc-2022.
// Rung 8 hardening (issue #54, findings 1, 2): narrowed fallback catch,
// single-signer-invocation assertion, atomic artifact write, live checks live.
//
// Pipeline (all inside @digitalbazaar/data-integrity — this file only supplies
// the raw Ed25519 sign function):
//   RDFC-1.0 canonicalize proof config + document -> SHA-256 each ->
//   sign(concatenation) -> base58btc-multibase 64-byte signature -> proofValue.
//
// Two signer modes:
//   --signer local   Loopback validation. Ephemeral node:crypto Ed25519 key
//                    wrapped in the SAME custom-signer seam the KMS path uses
//                    (async sign({data}) over raw bytes -> 64-byte signature),
//                    then immediately verified with @digitalbazaar/vc. Run this
//                    FIRST; it proves the plumbing without touching KMS.
//   --signer kms     Production. Exactly ONE `gcloud kms asymmetric-sign` call
//                    (Cloud KMS Ed25519 = PureEdDSA over raw bytes: data, not
//                    digest). Hard-gated: checkAnchor() runs in-process first —
//                    any anchor failure exits before any KMS operation. The
//                    context cache is cleared at the start of the run, and the
//                    KMS public key is re-pinned against the LIVE did.json
//                    (never a cached copy) before signing.
//
// Invariants enforced before ANY artifact reaches disk (finding 1):
//   - vc.issue errors are NOT blindly swallowed: only the known urn-id
//     data-model TypeError (see issue-error.ts) may route to the jsigs
//     fallback; everything else throws and aborts the run.
//   - The signer seam must have been invoked EXACTLY ONCE (kms mode: exactly
//     one `gcloud kms asymmetric-sign` call). A double-invocation — e.g. a
//     post-signer throw inside vc.issue followed by a fallback re-sign —
//     fails the run.
//   - The artifact is written atomically (temp file + rename), so a failed
//     assertion or a mid-write crash can never leave a partial artifact.
//
// Output (kms mode): ../signed-credential.json (committed artifact) with
// `proof` wrapped in array form (1EdTech OB3 Plain-JSON schema requires
// `proof: [{...}]`; rung-1 finding #2).

import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import jsigs from "jsonld-signatures";

import { checkAnchor } from "./check-anchor.ts";
import { isKnownUrnIdDataModelError } from "./issue-error.ts";
import { mapCredential } from "./map-credential.ts";
import {
  makeDocumentLoader,
  fetchLiveDidDocument,
  clearContextCache,
  ISSUER_DID,
} from "./document-loader.ts";
import {
  rawPublicKeyToMultibase,
  spkiPemToRawPublicKey,
  KMS_GET_PUBKEY_ARGS,
} from "../../tools/gen-did-json.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");

export const VERIFICATION_METHOD_ID = `${ISSUER_DID}#key-2026-07`;

const KMS_SIGN_ARGS = [
  "kms",
  "asymmetric-sign",
  "--version",
  "1",
  "--key",
  "vc-sign-ed25519",
  "--keyring",
  "credential-badges-issuer",
  "--location",
  "us-central1",
  "--project",
  "andamio-credentials",
];

interface RawSigner {
  id: string;
  algorithm: "Ed25519";
  sign(input: { data: Uint8Array }): Promise<Uint8Array>;
}

// Counts every invocation of the raw-signer seam (both modes). kmsCalls
// additionally counts actual `gcloud kms asymmetric-sign` executions.
let signerInvocations = 0;
let kmsCalls = 0;

export function makeKmsSigner(): RawSigner {
  return {
    id: VERIFICATION_METHOD_ID,
    algorithm: "Ed25519",
    async sign({ data }: { data: Uint8Array }): Promise<Uint8Array> {
      signerInvocations += 1;
      const inFile = path.join(OUT, "kms-sign-input.bin");
      const sigFile = path.join(OUT, "kms-sign-output.sig");
      await fs.writeFile(inFile, Buffer.from(data));
      execFileSync("gcloud", [
        ...KMS_SIGN_ARGS,
        "--input-file",
        inFile,
        "--signature-file",
        sigFile,
      ]);
      kmsCalls += 1;
      const sig = new Uint8Array(await fs.readFile(sigFile));
      if (sig.length !== 64) {
        throw new Error(
          `KMS returned ${sig.length} signature bytes, expected raw 64-byte Ed25519`,
        );
      }
      return sig;
    },
  };
}

// Loopback signer: ephemeral Ed25519 keypair through the SAME seam.
function makeLocalSigner(): { signer: RawSigner; overrides: Record<string, any> } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyMultibase = rawPublicKeyToMultibase(spkiPemToRawPublicKey(spkiPem));
  const controller = "did:example:signer-spike-loopback";
  const id = `${controller}#key-1`;
  const vm = {
    "@context": "https://w3id.org/security/multikey/v1",
    id,
    type: "Multikey",
    controller,
    publicKeyMultibase,
  };
  const didDoc = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: controller,
    verificationMethod: [vm],
    assertionMethod: [id],
  };
  return {
    signer: {
      id,
      algorithm: "Ed25519",
      async sign({ data }: { data: Uint8Array }): Promise<Uint8Array> {
        // node:crypto ed25519 sign over raw bytes = PureEdDSA, the exact
        // semantics Cloud KMS applies to the `data` field.
        signerInvocations += 1;
        return new Uint8Array(edSign(null, Buffer.from(data), privateKey));
      },
    },
    overrides: { [controller]: didDoc, [id]: vm },
  };
}

async function assertKmsKeyPinnedToLiveDid(): Promise<void> {
  const pem = execFileSync("gcloud", KMS_GET_PUBKEY_ARGS, { encoding: "utf8" });
  const kmsMultibase = rawPublicKeyToMultibase(spkiPemToRawPublicKey(pem));
  // fetchLiveDidDocument NEVER reads the disk cache (finding 2): this pin is
  // against the network's current did.json on every run.
  const didDoc = await fetchLiveDidDocument();
  const vm = (didDoc.verificationMethod ?? []).find(
    (m: any) => m.id === VERIFICATION_METHOD_ID,
  );
  if (!vm) {
    throw new Error(
      `live did.json has no verificationMethod ${VERIFICATION_METHOD_ID} — refusing to sign`,
    );
  }
  if (vm.publicKeyMultibase !== kmsMultibase) {
    throw new Error(
      `KMS public key ${kmsMultibase} != live did.json pin ${vm.publicKeyMultibase} — refusing to sign`,
    );
  }
  console.log(`key pin OK: KMS v1 == live did.json ${VERIFICATION_METHOD_ID} (${kmsMultibase})`);
}

export async function issueWith(
  credential: any,
  signer: RawSigner,
  documentLoader: any,
  created: string,
): Promise<any> {
  const suite = new DataIntegrityProof({
    signer,
    date: created,
    cryptosuite: eddsaRdfc2022,
  });
  try {
    return await vc.issue({ credential, suite, documentLoader });
  } catch (e) {
    // NARROW catch (finding 1): only the known urn-id data-model TypeError
    // from vc.issue's _checkCredential may fall back to jsigs.sign (which
    // produces the identical proof without the data-model re-check; rung-1
    // pattern). Any other error — a real data-model violation, a loader
    // refusal, a signer failure, a post-signer throw — aborts the run.
    if (!isKnownUrnIdDataModelError(e)) throw e;
    console.log(
      `vc.issue rejected urn ids (known data-model incompatibility) — using jsigs.sign fallback: ${(e as Error).message}`,
    );
    const { AssertionProofPurpose } = (jsigs as any).purposes;
    return await (jsigs as any).sign(structuredClone(credential), {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });
  }
}

export async function verifyWith(signed: any, documentLoader: any): Promise<void> {
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const r: any = await vc.verifyCredential({
    credential: signed,
    suite,
    documentLoader,
  });
  if (!r.verified) {
    const nested = r.error?.errors?.map((e: any) => e.message).join("; ");
    throw new Error(`post-sign verification FAILED: ${r.error?.message ?? "?"} ${nested ?? ""}`);
  }
}

// The single-invocation invariant, asserted BEFORE any artifact write. In kms
// mode this is the `kmsCalls === 1` guarantee from issue #54 finding 1; in
// loopback mode the same seam counter proves the identical property.
function assertSignedExactlyOnce(mode: "local" | "kms"): void {
  if (signerInvocations !== 1) {
    throw new Error(
      `signer seam invoked ${signerInvocations} times, expected exactly 1 — refusing to write an artifact`,
    );
  }
  if (mode === "kms" && kmsCalls !== 1) {
    throw new Error(
      `gcloud kms asymmetric-sign executed ${kmsCalls} times, expected exactly 1 — refusing to write an artifact`,
    );
  }
}

// Atomic write: the artifact appears at `file` only via rename of a fully
// written temp file. A crash or thrown assertion can never leave a partial
// artifact, and the previous artifact (if any) survives any failure.
async function writeArtifactAtomically(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, file);
}

async function main() {
  const mode = process.argv[process.argv.indexOf("--signer") + 1];
  if (mode !== "local" && mode !== "kms") {
    console.error("usage: sign.ts --signer local|kms");
    process.exit(2);
  }

  // kms runs start from a provably empty context cache (finding 2): every
  // document canonicalized or verified against comes fresh off the network.
  if (mode === "kms") {
    await clearContextCache();
    console.log("context cache cleared — all documents fetched fresh this run");
  }

  // THE GATE. Signing is unreachable unless the live on-chain anchor check
  // passes — zero KMS calls on a failed anchor read.
  const anchor = await checkAnchor();
  console.log(
    `anchor gate PASSED: ${anchor.courseId}.${anchor.sltHash} claimed by ${anchor.alias} in tx ${anchor.claimTxHash} (slot ${anchor.slot}; ${anchor.slts.length} SLT texts hash-verified)`,
  );

  const credential = mapCredential(anchor);
  await fs.mkdir(OUT, { recursive: true });

  if (mode === "local") {
    const { signer, overrides } = makeLocalSigner();
    const loader = makeDocumentLoader(overrides);
    // Loopback-only: the verifier requires issuer == verification-method
    // controller, so the ephemeral controller stands in as issuer here.
    // The committed artifact is only ever produced by kms mode.
    credential.issuer = { ...credential.issuer, id: signer.id.split("#")[0] };
    const signed = await issueWith(credential, signer, loader, anchor.blockTime);
    console.log(`signer seam invocations: ${signerInvocations}`);
    await verifyWith(signed, loader);
    assertSignedExactlyOnce("local");
    const outFile = path.join(OUT, "credential-local.json");
    await writeArtifactAtomically(outFile, JSON.stringify(signed, null, 2) + "\n");
    console.log("LOOPBACK SIGN+VERIFY OK (ephemeral key, custom-signer seam validated)");
    console.log(`wrote ${outFile}`);
    return;
  }

  // kms mode
  await assertKmsKeyPinnedToLiveDid();
  const loader = makeDocumentLoader();
  const signer = makeKmsSigner();
  const signed = await issueWith(credential, signer, loader, anchor.blockTime);
  console.log(`KMS asymmetric-sign calls: ${kmsCalls}`);
  await verifyWith(signed, loader);
  assertSignedExactlyOnce("kms");

  // 1EdTech OB3 Plain-JSON schema requires proof in array form.
  if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];

  const outFile = path.join(HERE, "signed-credential.json");
  await writeArtifactAtomically(outFile, JSON.stringify(signed, null, 2) + "\n");
  console.log("KMS SIGN + LIVE-DID VERIFY OK");
  console.log(`proof.verificationMethod = ${signed.proof[0].verificationMethod}`);
  console.log(`proof.proofValue         = ${signed.proof[0].proofValue}`);
  console.log(`wrote ${outFile}`);
}

// Guarded (Rung 8) so resign-check.ts can import the signer seam without
// triggering a signing run.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((e) => {
    console.error(String(e?.stack ?? e));
    process.exit(1);
  });
}
