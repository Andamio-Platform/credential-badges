import { promises as fs } from "node:fs";
import path from "node:path";

import { getOrCreateKey } from "./keys.js";
import { buildDidDocument } from "./did-web.js";
import { buildSpikeContext } from "./context.js";
import { buildStatusListCredential } from "./status-list.js";
import { buildTargetCredential } from "./credential.js";
import { buildIssuerProfile } from "./issuer-profile.js";
import { signCredential } from "./sign.js";
import { localDocumentLoader } from "./document-loader.js";

// OB 3.0 Plain JSON conformance requires `proof` as an array. @digitalbazaar/vc
// emits it as a single object (JSON-LD lenient form); this wraps it so the
// published credential satisfies both schemas.
function arrayifyProof(signed: any): any {
  if (signed.proof && !Array.isArray(signed.proof)) {
    return { ...signed, proof: [signed.proof] };
  }
  return signed;
}

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, "publish");
const OUT = path.join(ROOT, "out");

async function writeJson(file: string, doc: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`  wrote ${path.relative(ROOT, file)}`);
}

async function main() {
  console.log("verifier-spike generate");

  const key = await getOrCreateKey();
  console.log(`  key id: ${key.id}`);

  // 1. DID document (unsigned — did:web docs are not signed).
  await writeJson(path.join(PUBLISH, "did.json"), buildDidDocument(key));

  // 2. Spike-augmented Andamio v0 context.
  await writeJson(path.join(PUBLISH, "context", "v0.jsonld"), buildSpikeContext());

  // 2b. Stub issuer Profile (clears 1EdTech IssuerProbe url-accessibility check).
  await writeJson(path.join(PUBLISH, "issuer"), buildIssuerProfile());

  // 3. Status list credential (unsigned then signed).
  const statusListUnsigned = buildStatusListCredential();
  const statusListSigned = arrayifyProof(
    await signCredential(statusListUnsigned, key, localDocumentLoader),
  );
  await writeJson(
    path.join(PUBLISH, "status", "key-epoch-2026-05.json"),
    statusListSigned,
  );

  // 4. Target credential.
  const credentialUnsigned = buildTargetCredential();
  const credentialSigned = arrayifyProof(
    await signCredential(credentialUnsigned, key, localDocumentLoader),
  );
  await writeJson(path.join(OUT, "credential.jsonld"), credentialSigned);
  await writeJson(path.join(PUBLISH, "credential.jsonld"), credentialSigned);

  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
