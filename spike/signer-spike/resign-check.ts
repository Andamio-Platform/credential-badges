// Rung 8 · Deterministic re-sign check (byte-stability proof).
//
// Re-signs the COMMITTED artifact's credential content — not the current
// mapper output — with the production KMS key, and byte-compares the result
// against ./signed-credential.json. Because Ed25519 is deterministic and
// proof.created is pinned to the claim-tx block_time, an unchanged document
// must re-sign to a byte-identical artifact. This proves, in one KMS call:
//
//   - the KMS signer seam is byte-stable (same input -> same proofValue),
//   - the hardened loader/canonicalization path reproduces the exact signed
//     dataset the committed artifact was built from.
//
// The committed artifact is the input on purpose: the Rung-8 mapper change
// (issuer.url alignment, issue #54 finding 6) means a full-pipeline re-run
// would produce a DIFFERENT document by design; that new artifact is minted at
// the production Rung-8 signing, not here. This check never writes anything.
//
// Exactly ONE `gcloud kms asymmetric-sign` call, and only after the anchor
// gate passes. On any mismatch it reports and exits 1 — nothing is committed.
//
// Usage: npm run resign-check

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnchor } from "./check-anchor.ts";
import {
  makeDocumentLoader,
  clearContextCache,
} from "./document-loader.ts";
import { makeKmsSigner, issueWith, verifyWith } from "./sign.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await clearContextCache();

  // THE GATE — same rule as sign.ts: zero KMS operations unless the live
  // on-chain anchor check passes.
  const anchor = await checkAnchor();
  console.log(
    `anchor gate PASSED: ${anchor.courseId}.${anchor.sltHash} (tx ${anchor.claimTxHash})`,
  );

  const artifactFile = path.join(HERE, "signed-credential.json");
  const committedBytes = await fs.readFile(artifactFile, "utf8");
  const committed = JSON.parse(committedBytes);
  const committedProof = Array.isArray(committed.proof)
    ? committed.proof[0]
    : committed.proof;

  // The exact signed document: the committed artifact minus its proof.
  const { proof: _proof, ...credential } = committed;

  const inner = makeKmsSigner();
  let kmsSignCalls = 0;
  const signer = {
    ...inner,
    async sign(input: { data: Uint8Array }) {
      kmsSignCalls += 1;
      if (kmsSignCalls > 1) {
        throw new Error("resign-check attempted a SECOND KMS call — aborting");
      }
      return inner.sign(input);
    },
  };

  const loader = makeDocumentLoader();
  const signed = await issueWith(
    structuredClone(credential),
    signer,
    loader,
    committedProof.created,
  );
  console.log(`KMS asymmetric-sign calls: ${kmsSignCalls}`);
  await verifyWith(signed, loader);

  if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];
  const resignedBytes = JSON.stringify(signed, null, 2) + "\n";

  const identical = resignedBytes === committedBytes;
  const proofValueMatch = signed.proof[0].proofValue === committedProof.proofValue;

  console.log(`proofValue (committed): ${committedProof.proofValue}`);
  console.log(`proofValue (re-signed): ${signed.proof[0].proofValue}`);
  console.log(`proofValue byte-identical: ${proofValueMatch ? "YES" : "NO"}`);
  console.log(`full artifact byte-identical: ${identical ? "YES" : "NO"}`);

  if (!identical) {
    console.error(
      proofValueMatch
        ? "MISMATCH is in serialization only (signature IS deterministic) — investigate before any re-commit"
        : "SIGNATURE MISMATCH — the signer or canonicalization path is NOT byte-stable. STOP.",
    );
    process.exit(1);
  }
  console.log("BYTE-STABILITY PROVEN: deterministic KMS re-sign reproduced the committed artifact exactly");
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
