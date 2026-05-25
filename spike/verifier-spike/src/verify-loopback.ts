import { promises as fs } from "node:fs";
import path from "node:path";

import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import jsigs from "jsonld-signatures";

import { localDocumentLoader } from "./document-loader.js";
import { makeCheckStatus } from "./check-status.js";

const ROOT = process.cwd();
const CRED = path.join(ROOT, "out", "credential.jsonld");

async function main() {
  const credential = JSON.parse(await fs.readFile(CRED, "utf8"));

  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const checkStatus = await makeCheckStatus(localDocumentLoader);

  let verified = false;
  let detail: any = null;

  try {
    const r: any = await vc.verifyCredential({
      credential,
      suite,
      documentLoader: localDocumentLoader,
      checkStatus,
    });
    verified = !!r.verified;
    if (!verified) {
      detail = {
        topError: r.error?.message,
        nestedErrors: r.error?.errors?.map((x: any) => ({
          message: x.message,
          name: x.name,
          stack: x.stack?.split("\n").slice(0, 4).join("\n"),
        })),
        results: r.results?.map((x: any) => ({
          verified: x.verified,
          error: x.error?.message,
        })),
      };
    } else {
      detail = "(via vc.verifyCredential)";
    }
  } catch (e: any) {
    try {
      const { AssertionProofPurpose } = (jsigs as any).purposes;
      const r: any = await (jsigs as any).verify(credential, {
        suite,
        purpose: new AssertionProofPurpose(),
        documentLoader: localDocumentLoader,
      });
      verified = !!r.verified;
      detail = r.verified ? "(via jsigs.verify)" : r.error;
    } catch (e2: any) {
      detail = `verify threw: ${e2?.message ?? e2}`;
    }
  }

  console.log("self-loopback verification");
  console.log(`  verified: ${verified ? "YES" : "NO"}`);
  console.log(`  detail:   ${JSON.stringify(detail)}`);
  const proof = Array.isArray(credential.proof) ? credential.proof[0] : credential.proof;
  console.log(`  proof.type=${proof?.type}`);
  console.log(`  proof.cryptosuite=${proof?.cryptosuite}`);
  console.log(`  proof.verificationMethod=${proof?.verificationMethod}`);

  if (!verified) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
