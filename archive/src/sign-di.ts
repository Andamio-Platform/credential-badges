/**
 * Demo-grade Data Integrity signer (eddsa-rdfc-2022) for the real-recipient
 * Path B samples.
 *
 * Purpose: clear the 1EdTech "missing a proof" error so the njuguna sample
 * passes the official OB 3.0 verifier for the team demo. This embeds a
 * standard W3C Data Integrity proof in the .jsonld so the artifact stays
 * drag-and-drop.
 *
 * CORNERS CUT (demo-grade — see CORNERS-CUT.md, all tracked as
 * credential-badges #3–#8):
 *   - Throwaway Ed25519 key (out/issuer-multikey.json, gitignored). NOT a
 *     real org key. Production = did:web + managed signing (#3/#5).
 *   - issuer.id is rewritten to the throwaway key's did:key so the proof
 *     verifies. This replaces the previous hardcoded did:key. Production
 *     issuer identity is the #3 decision.
 *   - Permissive custom document loader with a hand-maintained allowlist and
 *     a naive on-disk context cache. Not the production resolver.
 *   - Samples are signed IN PLACE. The signature breaks if the document is
 *     re-rendered/edited; re-run `npm run sign-di` after any sample change.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";
import jsigs from "jsonld-signatures";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");
const KEY_PATH = path.join(OUT, "issuer-multikey.json");
const CTX_DIR = path.join(OUT, "ctx-cache");

const SAMPLES = [
  "samples/cardano-xp-project-njuguna-real.jsonld",
  "samples/sustain-and-maintain-gimbalabs-james-real.jsonld",
];

// Hand-maintained allowlist (corner cut — production needs a real resolver).
const ALLOWED_CONTEXTS = new Set([
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://credentials.andamio.io/context/v0.jsonld",
  "https://w3id.org/security/multikey/v1",
  "https://w3id.org/security/data-integrity/v2",
  "https://www.w3.org/ns/did/v1",
]);

async function loadOrCreateKey(): Promise<any> {
  await fs.mkdir(OUT, { recursive: true });
  try {
    const raw = JSON.parse(await fs.readFile(KEY_PATH, "utf8"));
    return await Ed25519Multikey.from(raw);
  } catch {
    /* generate fresh */
  }
  const kp: any = await Ed25519Multikey.generate();
  const did = `did:key:${kp.publicKeyMultibase}`;
  kp.controller = did;
  kp.id = `${did}#${kp.publicKeyMultibase}`;
  const exported = await kp.export({ publicKey: true, secretKey: true });
  await fs.writeFile(KEY_PATH, JSON.stringify(exported, null, 2), "utf8");
  console.log(`  generated throwaway issuer key: ${did}`);
  return kp;
}

async function fetchContextCached(url: string): Promise<any> {
  await fs.mkdir(CTX_DIR, { recursive: true });
  const cacheFile = path.join(CTX_DIR, url.replace(/[^a-zA-Z0-9]/g, "_") + ".json");
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    /* fetch */
  }
  const res = await fetch(url, { headers: { accept: "application/ld+json, application/json" } });
  if (!res.ok) throw new Error(`context fetch ${url} -> HTTP ${res.status}`);
  const doc = await res.json();
  await fs.writeFile(cacheFile, JSON.stringify(doc), "utf8");
  return doc;
}

function didKeyResolve(url: string) {
  const base = url.split("#")[0];
  const pkm = base.slice("did:key:".length);
  const vmId = `${base}#${pkm}`;
  if (url.includes("#")) {
    return {
      "@context": "https://w3id.org/security/multikey/v1",
      id: vmId,
      type: "Multikey",
      controller: base,
      publicKeyMultibase: pkm,
    };
  }
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: base,
    verificationMethod: [
      { id: vmId, type: "Multikey", controller: base, publicKeyMultibase: pkm },
    ],
    assertionMethod: [vmId],
    authentication: [vmId],
  };
}

async function documentLoader(url: string): Promise<any> {
  if (url.startsWith("did:key:")) {
    return { contextUrl: null, documentUrl: url, document: didKeyResolve(url) };
  }
  if (ALLOWED_CONTEXTS.has(url)) {
    return { contextUrl: null, documentUrl: url, document: await fetchContextCached(url) };
  }
  throw new Error(`documentLoader refused (not in allowlist): ${url}`);
}

async function signOne(file: string, keyPair: any): Promise<void> {
  const abs = path.join(ROOT, file);
  const credential: any = JSON.parse(await fs.readFile(abs, "utf8"));

  // Corner cut: rewrite issuer.id to the key we control so the proof verifies.
  credential.issuer.id = keyPair.controller;
  delete credential.proof;

  const suite = new DataIntegrityProof({
    signer: keyPair.signer(),
    cryptosuite: eddsaRdfc2022,
  });

  let signed: any;
  try {
    signed = await vc.issue({ credential, suite, documentLoader });
  } catch (e: any) {
    // Fallback: vc.issue runs strict VC-data-model checks that can reject
    // VC 2.0 / urn: ids on some lib versions. jsigs.sign is more permissive
    // and produces the same proof. Tracked as a corner in CORNERS-CUT.md.
    console.log(`  vc.issue rejected (${e?.message ?? e}); falling back to jsigs.sign`);
    const { AssertionProofPurpose } = (jsigs as any).purposes;
    signed = await (jsigs as any).sign(credential, {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });
  }

  await fs.writeFile(abs, JSON.stringify(signed, null, 2) + "\n", "utf8");

  // Round-trip verify so we don't ship an artifact that fails 1EdTech.
  const verifySuite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  let verified = false;
  let detail = "";
  try {
    const r: any = await vc.verifyCredential({
      credential: signed,
      suite: verifySuite,
      documentLoader,
    });
    verified = !!r.verified;
    detail = r.verified ? "" : JSON.stringify(r.error?.errors?.map((x: any) => x.message) ?? r.error);
  } catch (e: any) {
    try {
      const r: any = await (jsigs as any).verify(signed, {
        suite: verifySuite,
        purpose: new (jsigs as any).purposes.AssertionProofPurpose(),
        documentLoader,
      });
      verified = !!r.verified;
      detail = r.verified ? "(via jsigs.verify)" : JSON.stringify(r.error);
    } catch (e2: any) {
      detail = `verify threw: ${e2?.message ?? e2}`;
    }
  }

  console.log(
    `  ${file}\n    issuer.id -> ${keyPair.controller}\n    proof.type=${signed.proof?.type} cryptosuite=${signed.proof?.cryptosuite}\n    round-trip verified: ${verified ? "YES" : "NO"} ${detail}`
  );
  if (!verified) {
    throw new Error(`round-trip verification FAILED for ${file} — not shipping`);
  }
}

async function main() {
  const keyPair = await loadOrCreateKey();
  console.log(`Signing ${SAMPLES.length} real samples with did:key ${keyPair.controller}`);
  for (const f of SAMPLES) await signOne(f, keyPair);
  console.log("Done. Re-run `npm run verify` (chain) + `npm run render` next.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
