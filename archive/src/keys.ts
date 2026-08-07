/**
 * Throwaway Ed25519 keypair for the prototype. Generated fresh on every run unless
 * ./out/issuer-key.json already exists; persisted so subsequent runs sign deterministically
 * for diff-friendly outputs. NEVER use these keys for anything real.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import * as ed25519 from "@noble/ed25519";

export interface PrototypeKey {
  publicKeyMultibase: string;   // z6Mk...
  publicKeyBase64Url: string;
  secretKeyBase64Url: string;
  publicKeyHex: string;
  secretKeyHex: string;
  kid: string;                  // did:key:z6Mk...#z6Mk...
  did: string;                  // did:key:z6Mk...
  publicJwk: any;
  privateJwk: any;
}

const KEY_DIR = path.resolve(process.cwd(), "out");
const KEY_PATH = path.join(KEY_DIR, "issuer-key.json");

// Ed25519 multicodec prefix (0xed01) + raw 32-byte public key, base58btc-encoded with z prefix.
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  // BigInt-based encoder, fine for our key sizes
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let out = "";
  while (n > 0n) {
    const r = Number(n % 58n);
    n = n / 58n;
    out = BASE58_ALPHABET[r] + out;
  }
  // Preserve leading zero bytes as '1' chars
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getOrCreateKey(): Promise<PrototypeKey> {
  await fs.mkdir(KEY_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(KEY_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    // generate
  }

  const secret = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(secret);

  const publicKeyMultibaseBytes = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length
  );
  publicKeyMultibaseBytes.set(ED25519_MULTICODEC_PREFIX, 0);
  publicKeyMultibaseBytes.set(publicKey, ED25519_MULTICODEC_PREFIX.length);
  const publicKeyMultibase = "z" + base58Encode(publicKeyMultibaseBytes);

  const did = `did:key:${publicKeyMultibase}`;
  const kid = `${did}#${publicKeyMultibase}`;

  // Build JWKs for JWT signing via jose
  const publicJwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: bytesToBase64Url(publicKey),
  };
  const privateJwk = {
    ...publicJwk,
    d: bytesToBase64Url(secret),
  };

  const out: PrototypeKey = {
    publicKeyMultibase,
    publicKeyBase64Url: bytesToBase64Url(publicKey),
    secretKeyBase64Url: bytesToBase64Url(secret),
    publicKeyHex: bytesToHex(publicKey),
    secretKeyHex: bytesToHex(secret),
    kid,
    did,
    publicJwk,
    privateJwk,
  };

  await fs.writeFile(KEY_PATH, JSON.stringify(out, null, 2), "utf8");
  return out;
}
