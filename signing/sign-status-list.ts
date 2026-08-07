// Rung 8.3 · Sign the key-epoch status list credential with the production
// KMS key, through the SAME hardened path as the subject credential:
//
//   1. clearContextCache() — every canonicalized document fetched fresh.
//   2. checkAnchor() — THE GATE. Zero KMS operations unless the live on-chain
//      anchor check passes. The status list has no per-credential anchor of
//      its own (its bits are key versions), but no KMS call in this spike is
//      ever reachable without a passing live anchor read; the gate invariant
//      holds for every signing entrypoint.
//   3. assertKmsKeyPinnedToLiveDid() — KMS public key must equal the LIVE
//      did.json pin for #key-2026-07; mismatch refuses to sign.
//   4. Exactly ONE `gcloud kms asymmetric-sign` call, asserted before any
//      artifact write; atomic write (temp + rename).
//
// Determinism: validFrom and proof.created are pinned to the key-epoch start
// (STATUS_LIST_VALID_FROM), and the gzip encoding is mtime-0 — an unchanged
// bitstring re-signs to a byte-identical artifact.
//
// Output: ../../status/key-epoch-2026-07.json (committed; served by the
// static host at /status/key-epoch-2026-07.json). Proof in array form, the
// repo convention since rung 1.
//
// Usage: npm run sign:status

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnchor } from "./check-anchor.ts";
import {
  makeDocumentLoader,
  clearContextCache,
  ISSUER_DID,
} from "./document-loader.ts";
import {
  buildStatusListCredential,
  STATUS_LIST_VALID_FROM,
} from "./status-list.ts";
import {
  assertKmsKeyPinnedToLiveDid,
  makeKmsSigner,
  issueWith,
  verifyWith,
} from "./sign.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(HERE, "..", "..", "status", "key-epoch-2026-07.json");

async function main() {
  await clearContextCache();
  console.log("context cache cleared — all documents fetched fresh this run");

  // THE GATE — same rule as sign.ts: zero KMS operations unless the live
  // on-chain anchor check passes.
  const anchor = await checkAnchor();
  console.log(
    `anchor gate PASSED: ${anchor.courseId}.${anchor.sltHash} (tx ${anchor.claimTxHash})`,
  );

  await assertKmsKeyPinnedToLiveDid();

  const credential = buildStatusListCredential(ISSUER_DID);

  // Single-KMS-call assertion, enforced at the seam (resign-check pattern).
  const inner = makeKmsSigner();
  let kmsSignCalls = 0;
  const signer = {
    ...inner,
    async sign(input: { data: Uint8Array }) {
      kmsSignCalls += 1;
      if (kmsSignCalls > 1) {
        throw new Error("sign-status-list attempted a SECOND KMS call — aborting");
      }
      return inner.sign(input);
    },
  };

  const loader = makeDocumentLoader();
  const signed = await issueWith(
    structuredClone(credential),
    signer,
    loader,
    STATUS_LIST_VALID_FROM,
  );
  console.log(`KMS asymmetric-sign calls: ${kmsSignCalls}`);
  await verifyWith(signed, loader); // no credentialStatus on the list itself
  if (kmsSignCalls !== 1) {
    throw new Error(
      `expected exactly 1 KMS call, saw ${kmsSignCalls} — refusing to write an artifact`,
    );
  }

  if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(signed, null, 2) + "\n");
  await fs.rename(tmp, OUT_FILE);

  console.log("KMS SIGN + LIVE-DID VERIFY OK (status list credential)");
  console.log(`proof.verificationMethod = ${signed.proof[0].verificationMethod}`);
  console.log(`proof.proofValue         = ${signed.proof[0].proofValue}`);
  console.log(`wrote ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
