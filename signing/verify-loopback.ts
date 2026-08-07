// Rung 6 · Standalone loopback verification of the committed artifact.
//
// Reads ./signed-credential.json and verifies its eddsa-rdfc-2022 proof with
// @digitalbazaar/vc, resolving the issuer key from the LIVE production
// did:web document (https://credentials.andamio.io/.well-known/did.json).
// No signing keys involved — pure verification, reproducible by anyone.
//
// Usage: npm run verify

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";

import { makeCheckStatus, type StatusListSource } from "./check-status.ts";
import { makeDocumentLoader } from "./document-loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const file = path.join(HERE, "signed-credential.json");
  const credential = JSON.parse(await fs.readFile(file, "utf8"));

  // Status source: "committed" (default, pre-deploy — reads the repo's
  // status/ file; documented override, see check-status.ts) or "live"
  // (post-deploy re-check): npm run verify -- --status live
  const statusArgIdx = process.argv.indexOf("--status");
  const statusSource: StatusListSource =
    statusArgIdx !== -1 && process.argv[statusArgIdx + 1] === "live"
      ? "live"
      : "committed";

  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const r: any = await vc.verifyCredential({
    credential,
    suite,
    documentLoader: makeDocumentLoader(),
    checkStatus: makeCheckStatus(statusSource),
  });

  const proof = Array.isArray(credential.proof) ? credential.proof[0] : credential.proof;
  console.log("digitalbazaar loopback verification (live did:web resolution)");
  console.log(`  credential:  ${credential.id}`);
  console.log(`  vm:          ${proof?.verificationMethod}`);
  console.log(`  cryptosuite: ${proof?.cryptosuite}`);
  console.log(`  verified:    ${r.verified ? "YES" : "NO"}`);
  if (!r.verified) {
    console.log(`  error: ${r.error?.message}`);
    for (const e of r.error?.errors ?? []) console.log(`    - ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
