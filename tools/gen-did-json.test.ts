// Encoding unit tests for the did.json regenerator. Runs hermetically (no
// network, no KMS) — every assertion pins to independently-known-good values,
// so a wrong encoder fails rather than rubber-stamps itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  spkiPemToRawPublicKey,
  rawPublicKeyToMultibase,
  multibaseToRawPublicKey,
  base58Encode,
  base58Decode,
  didDocumentFromPem,
  serializeDidDocument,
} from "./gen-did-json.ts";

// Ground truth (verified live 2026-07-10) — KMS vc-sign-ed25519 version 1.
const KMS_V1_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMY1U557RY5Z/GJ5kmrvNIkHcZL9sv+mNfDsaYP7VUBQ=
-----END PUBLIC KEY-----`;
const EXPECTED_RAW_HEX =
  "318d54e79ed163967f189e649abbcd2241dc64bf6cbfe98d7c3b1a60fed55014";
const EXPECTED_MULTIBASE = "z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7";

const DID_JSON_PATH = fileURLToPath(
  new URL("../.well-known/did.json", import.meta.url),
);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

test("SPKI PEM strips to the raw 32-byte Ed25519 key", () => {
  const raw = spkiPemToRawPublicKey(KMS_V1_PEM);
  assert.equal(raw.length, 32);
  assert.equal(hex(raw), EXPECTED_RAW_HEX);
});

test("raw key encodes to the pinned publicKeyMultibase", () => {
  const raw = spkiPemToRawPublicKey(KMS_V1_PEM);
  assert.equal(rawPublicKeyToMultibase(raw), EXPECTED_MULTIBASE);
});

test("multibase round-trips back to the raw key bytes", () => {
  assert.equal(hex(multibaseToRawPublicKey(EXPECTED_MULTIBASE)), EXPECTED_RAW_HEX);
});

test("generation is deterministic — same PEM in, byte-identical output", () => {
  assert.equal(
    serializeDidDocument(didDocumentFromPem(KMS_V1_PEM)),
    serializeDidDocument(didDocumentFromPem(KMS_V1_PEM)),
  );
});

test("emitted document byte-matches the committed .well-known/did.json", () => {
  const emitted = serializeDidDocument(didDocumentFromPem(KMS_V1_PEM));
  const committed = readFileSync(DID_JSON_PATH, "utf8");
  assert.equal(emitted, committed);
});

test("malformed / non-Ed25519 PEM is rejected, never silently truncated", () => {
  assert.throws(() => spkiPemToRawPublicKey(""), /empty PEM/);
  // Valid base64 but wrong length (RSA-ish stub).
  assert.throws(
    () => spkiPemToRawPublicKey("-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----"),
    /expected 44 DER bytes/,
  );
  // Correct length, wrong algorithm OID in the header.
  const wrongHeader = Buffer.concat([
    Buffer.from("302a300506032b6571032100", "hex"), // 0x2b6571 != Ed25519 0x2b6570
    Buffer.alloc(32),
  ]).toString("base64");
  assert.throws(
    () => spkiPemToRawPublicKey(`-----BEGIN PUBLIC KEY-----\n${wrongHeader}\n-----END PUBLIC KEY-----`),
    /unexpected DER header/,
  );
});

test("base58 preserves leading zero bytes (encoder tail guard)", () => {
  const withLeadingZeros = new Uint8Array([0, 0, 1, 2, 3]);
  const encoded = base58Encode(withLeadingZeros);
  assert.ok(encoded.startsWith("11"), `expected two '1' prefixes, got ${encoded}`);
  assert.deepEqual(base58Decode(encoded), withLeadingZeros);
});
