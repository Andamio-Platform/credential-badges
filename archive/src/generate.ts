/**
 * Entry point: produce a signed OB 3.0 credential and write it to disk.
 *
 * Outputs:
 *   out/issuer-key.json           — the throwaway Ed25519 keypair (regenerated only if missing)
 *   out/credential.unsigned.json  — the JSON-LD document with no proof
 *   out/credential.signed.json    — same document with a JWT proof block
 *   out/credential.jwt.txt        — the bare compact JWS (vc+jwt)
 *   ../sample-credential.jsonld   — the canonical signed sample copied to the deliverable location
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { referenceCredential } from "./credential.js";
import { mapToOB3 } from "./mapper.js";
import { getOrCreateKey } from "./keys.js";
import { signAsJwt } from "./sign.js";

async function main() {
  const outDir = path.resolve(process.cwd(), "out");
  await fs.mkdir(outDir, { recursive: true });

  console.log("Loading throwaway issuer key...");
  const key = await getOrCreateKey();
  console.log(`  did: ${key.did}`);
  console.log(`  kid: ${key.kid}`);

  console.log("\nMapping Andamio credential -> OB 3.0...");
  const ob3 = mapToOB3(referenceCredential, {
    issuerDid: key.did,
    issuerProfileUrl: "https://credentials.preprod.andamio.io/issuer",
    credentialBaseUrl: "https://credentials.preprod.andamio.io",
  });

  await fs.writeFile(
    path.join(outDir, "credential.unsigned.json"),
    JSON.stringify(ob3, null, 2),
    "utf8"
  );

  console.log("Signing as VC-JWT (EdDSA)...");
  const signed = await signAsJwt(ob3, key);

  await fs.writeFile(
    path.join(outDir, "credential.signed.json"),
    JSON.stringify(signed.signedDocument, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(outDir, "credential.jwt.txt"), signed.jwt, "utf8");

  // Promote the signed document to the deliverable filename
  await fs.copyFile(
    path.join(outDir, "credential.signed.json"),
    path.resolve(process.cwd(), "sample-credential.jsonld")
  );

  console.log("\nDone. Wrote:");
  console.log("  out/credential.unsigned.json");
  console.log("  out/credential.signed.json");
  console.log("  out/credential.jwt.txt");
  console.log("  sample-credential.jsonld");
}

main().catch((err) => {
  console.error("generate failed:", err);
  process.exit(1);
});
