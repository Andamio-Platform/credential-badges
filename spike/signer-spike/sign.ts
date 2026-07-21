// Rung 6 · Signer: Data Integrity proof, cryptosuite eddsa-rdfc-2022.
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
//                    any anchor failure exits before any KMS operation. Also
//                    re-pins the KMS public key against the LIVE did.json
//                    before signing.
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
import { mapCredential } from "./map-credential.ts";
import {
  makeDocumentLoader,
  fetchLiveDidDocument,
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

let kmsCalls = 0;

function makeKmsSigner(): RawSigner {
  return {
    id: VERIFICATION_METHOD_ID,
    algorithm: "Ed25519",
    async sign({ data }: { data: Uint8Array }): Promise<Uint8Array> {
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
        return new Uint8Array(edSign(null, Buffer.from(data), privateKey));
      },
    },
    overrides: { [controller]: didDoc, [id]: vm },
  };
}

async function assertKmsKeyPinnedToLiveDid(): Promise<void> {
  const pem = execFileSync("gcloud", KMS_GET_PUBKEY_ARGS, { encoding: "utf8" });
  const kmsMultibase = rawPublicKeyToMultibase(spkiPemToRawPublicKey(pem));
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

async function issueWith(
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
  } catch {
    // vc.issue applies strict data-model checks that can reject urn: ids on
    // some versions; jsigs.sign produces the identical proof (rung-1 pattern).
    const { AssertionProofPurpose } = (jsigs as any).purposes;
    return await (jsigs as any).sign(structuredClone(credential), {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });
  }
}

async function verifyWith(signed: any, documentLoader: any): Promise<void> {
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

async function main() {
  const mode = process.argv[process.argv.indexOf("--signer") + 1];
  if (mode !== "local" && mode !== "kms") {
    console.error("usage: sign.ts --signer local|kms");
    process.exit(2);
  }

  // THE GATE. Signing is unreachable unless the live on-chain anchor check
  // passes — zero KMS calls on a failed anchor read.
  const anchor = await checkAnchor();
  console.log(
    `anchor gate PASSED: ${anchor.courseId}.${anchor.sltHash} claimed by ${anchor.alias} in tx ${anchor.claimTxHash} (slot ${anchor.slot})`,
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
    await verifyWith(signed, loader);
    const outFile = path.join(OUT, "credential-local.json");
    await fs.writeFile(outFile, JSON.stringify(signed, null, 2) + "\n");
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

  // 1EdTech OB3 Plain-JSON schema requires proof in array form.
  if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];

  const outFile = path.join(HERE, "signed-credential.json");
  await fs.writeFile(outFile, JSON.stringify(signed, null, 2) + "\n");
  console.log("KMS SIGN + LIVE-DID VERIFY OK");
  console.log(`proof.verificationMethod = ${signed.proof[0].verificationMethod}`);
  console.log(`proof.proofValue         = ${signed.proof[0].proofValue}`);
  console.log(`wrote ${outFile}`);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
