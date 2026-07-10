// Deterministic regenerator for `.well-known/did.json`.
//
// SOURCE OF TRUTH: the KMS Ed25519 public key (`vc-sign-ed25519` version 1).
// The committed `.well-known/did.json` is this tool's OUTPUT — regenerate it
// here, never hand-edit the key. `tools/did-pin.test.ts` fails CI if the
// committed file ever drifts from KMS version 1.
//
// Pipeline (the only net-new step vs. the spike is the SPKI strip):
//   SPKI DER (from a PEM) -> raw 32-byte Ed25519 pubkey
//     -> 0xed01 multicodec prefix -> base58btc -> `publicKeyMultibase` -> did.json
//
// Pure and DETERMINISTIC: same key in => byte-identical did.json out. No
// timestamps, no randomness. The base58btc + multicodec logic mirrors the
// spruce-verified encoder in `spike/src/keys.ts` (kept dependency-free on
// purpose — this is a trust-critical, CODEOWNERS-gated path).
//
// Usage (regenerate the committed file):
//   gcloud kms keys versions get-public-key 1 \
//     --location us-central1 --keyring credential-badges-issuer \
//     --key vc-sign-ed25519 --project andamio-credentials \
//     | npm run --prefix tools gen > .well-known/did.json
//   # offline:   cat key.pem | node tools/gen-did-json.ts
//   # convenience: node tools/gen-did-json.ts --from-kms   (shells out to gcloud)

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DID = "did:web:credentials.andamio.io";
export const KEY_FRAGMENT = "key-2026-07";
export const VERIFICATION_METHOD_ID = `${DID}#${KEY_FRAGMENT}`;

// An Ed25519 SubjectPublicKeyInfo is a fixed 44-byte DER structure: a 12-byte
// header (SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING }) then the raw
// 32-byte key. We validate the header so a non-Ed25519 / malformed key is a
// loud error, not a silently-truncated wrong key.
const ED25519_SPKI_HEADER_HEX = "302a300506032b6570032100";
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// base58btc — BigInt encoder mirroring spike/src/keys.ts, with the matching
// decode inverse used by the key-pin invariant. Leading zero bytes map to '1'.
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n = n / 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

export function base58Decode(str: string): Uint8Array {
  let n = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of str) {
    if (ch === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

export function spkiPemToRawPublicKey(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  if (!b64) throw new Error("empty PEM: no base64 body found");
  const der = new Uint8Array(Buffer.from(b64, "base64"));
  if (der.length !== 44) {
    throw new Error(
      `not an Ed25519 SPKI key: expected 44 DER bytes, got ${der.length}`,
    );
  }
  const header = bytesToHex(der.subarray(0, 12));
  if (header !== ED25519_SPKI_HEADER_HEX) {
    throw new Error(`not an Ed25519 SPKI key: unexpected DER header ${header}`);
  }
  return der.subarray(12);
}

export function rawPublicKeyToMultibase(raw: Uint8Array): string {
  if (raw.length !== 32) {
    throw new Error(`expected 32-byte Ed25519 key, got ${raw.length}`);
  }
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + raw.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(raw, ED25519_MULTICODEC_PREFIX.length);
  return "z" + base58Encode(prefixed);
}

export function multibaseToRawPublicKey(multibase: string): Uint8Array {
  if (!multibase.startsWith("z")) {
    throw new Error("expected a base58btc multibase value ('z' prefix)");
  }
  const decoded = base58Decode(multibase.slice(1));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("not a 0xed01 (Ed25519) multicodec key");
  }
  return decoded.subarray(2);
}

export function buildDidDocument(publicKeyMultibase: string) {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: DID,
    verificationMethod: [
      {
        id: VERIFICATION_METHOD_ID,
        type: "Multikey",
        controller: DID,
        publicKeyMultibase,
      },
    ],
    assertionMethod: [VERIFICATION_METHOD_ID],
  };
}

export function didDocumentFromPem(pem: string) {
  return buildDidDocument(rawPublicKeyToMultibase(spkiPemToRawPublicKey(pem)));
}

// Serialize exactly as the committed file: 2-space indent + trailing newline.
export function serializeDidDocument(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

const KMS_GET_PUBKEY_ARGS = [
  "kms", "keys", "versions", "get-public-key", "1",
  "--location", "us-central1",
  "--keyring", "credential-badges-issuer",
  "--key", "vc-sign-ed25519",
  "--project", "andamio-credentials",
];

function main(): void {
  const pem = process.argv.includes("--from-kms")
    ? execFileSync("gcloud", KMS_GET_PUBKEY_ARGS, { encoding: "utf8" })
    : readFileSync(0, "utf8"); // stdin
  process.stdout.write(serializeDidDocument(didDocumentFromPem(pem)));
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
