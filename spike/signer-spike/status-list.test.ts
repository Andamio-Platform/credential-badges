// Rung 8.3 · Status-list builder invariants — hermetic (node builtins only,
// no network, no KMS, no npm install).
//
// Pins the deployment plan's Decision 3 shape: 131,072-bit list (W3C minimum),
// statusPurpose "suspension", one bit per key version with bit 0 = key-2026-07
// and bit 0 = 0 (not suspended), multibase-"u" base64url-no-pad GZIP encoding,
// and deterministic bytes (same bitstring -> same encodedList).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  ACTIVE_KEY_STATUS_INDEX,
  ACTIVE_KEY_VERSION,
  KEY_VERSION_POSITIONS,
  STATUS_LIST_BIT_LENGTH,
  STATUS_LIST_URL,
  buildStatusListCredential,
  decodeStatusList,
  encodeStatusList,
  statusBitAt,
  statusListEntry,
} from "./status-list.ts";

const ISSUER_DID = "did:web:credentials.andamio.io";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMITTED_STATUS_FILE = join(REPO, "status", "key-epoch-2026-07.json");

test("registry: key-2026-07 owns bit 0 and is the active key version", () => {
  assert.equal(KEY_VERSION_POSITIONS["key-2026-07"], 0);
  assert.equal(ACTIVE_KEY_VERSION, "key-2026-07");
  assert.equal(ACTIVE_KEY_STATUS_INDEX, 0);
});

test("unsigned credential: W3C shape, suspension purpose, 131,072 all-zero bits", () => {
  const cred = buildStatusListCredential(ISSUER_DID);
  assert.deepEqual(cred["@context"], ["https://www.w3.org/ns/credentials/v2"]);
  assert.equal(cred.id, STATUS_LIST_URL);
  assert.deepEqual(cred.type, ["VerifiableCredential", "BitstringStatusListCredential"]);
  assert.equal(cred.issuer, ISSUER_DID);
  assert.equal(cred.credentialSubject.id, `${STATUS_LIST_URL}#list`);
  assert.equal(cred.credentialSubject.type, "BitstringStatusList");
  assert.equal(cred.credentialSubject.statusPurpose, "suspension");

  const bits = decodeStatusList(cred.credentialSubject.encodedList);
  assert.equal(bits.length * 8, STATUS_LIST_BIT_LENGTH, "W3C minimum 131,072 bits");
  assert.ok(bits.every((b) => b === 0), "fresh list must be all zeros");
  assert.equal(statusBitAt(bits, ACTIVE_KEY_STATUS_INDEX), 0, "key-2026-07 not suspended");
});

test("encodedList is multibase base64url-no-pad ('u' prefix), deterministic", () => {
  const a = buildStatusListCredential(ISSUER_DID).credentialSubject.encodedList;
  const b = buildStatusListCredential(ISSUER_DID).credentialSubject.encodedList;
  assert.ok(a.startsWith("u"), "multibase base64url-no-pad prefix required by W3C spec");
  assert.ok(!a.includes("="), "no padding");
  assert.equal(a, b, "same bitstring must encode to identical bytes (re-sign stability)");
});

test("bit semantics: flipping a key-version position sets exactly that bit, MSB-first", () => {
  const cred = buildStatusListCredential(ISSUER_DID, { flippedKeyVersionPositions: [0, 9] });
  const bits = decodeStatusList(cred.credentialSubject.encodedList);
  assert.equal(statusBitAt(bits, 0), 1);
  assert.equal(statusBitAt(bits, 9), 1);
  assert.equal(statusBitAt(bits, 1), 0);
  assert.equal(statusBitAt(bits, 8), 0);
  // MSB-first byte layout per W3C: bit 0 = 0b1000_0000 of byte 0.
  assert.equal(bits[0], 0b1000_0000);
  assert.equal(bits[1], 0b0100_0000);
  assert.throws(() => buildStatusListCredential(ISSUER_DID, { flippedKeyVersionPositions: [131_072] }));
});

test("decode refuses a non-multibase encodedList (the rung-1 prefixless dialect)", () => {
  const prefixless = encodeStatusList(new Uint8Array(16)).slice(1);
  assert.throws(() => decodeStatusList(prefixless), /missing "u" prefix/);
});

test("statusListEntry: the subject credential's credentialStatus shape (Decision 3)", () => {
  assert.deepEqual(statusListEntry(), {
    id: `${STATUS_LIST_URL}#0`,
    type: "BitstringStatusListEntry",
    statusPurpose: "suspension",
    statusListIndex: "0",
    statusListCredential: STATUS_LIST_URL,
  });
});

// ---- The committed served artifact ----

test("committed status/key-epoch-2026-07.json: signed, fresh, and rebuilds byte-identically", () => {
  const committed = JSON.parse(readFileSync(COMMITTED_STATUS_FILE, "utf8"));

  // Signed by the production did:web with the same DI suite as the subject
  // credential, proof in array form (repo convention since rung 1).
  assert.ok(Array.isArray(committed.proof) && committed.proof.length === 1);
  assert.equal(committed.proof[0].type, "DataIntegrityProof");
  assert.equal(committed.proof[0].cryptosuite, "eddsa-rdfc-2022");
  assert.equal(committed.proof[0].proofPurpose, "assertionMethod");
  assert.equal(
    committed.proof[0].verificationMethod,
    `${ISSUER_DID}#${ACTIVE_KEY_VERSION}`,
  );

  // The document (minus proof) must be EXACTLY what the builder produces —
  // any drift between the builder and the served file is a loud failure.
  const { proof: _proof, ...unsigned } = committed;
  assert.deepEqual(unsigned, buildStatusListCredential(ISSUER_DID));

  // And the served list says the active key version is NOT suspended.
  const bits = decodeStatusList(committed.credentialSubject.encodedList);
  assert.equal(statusBitAt(bits, ACTIVE_KEY_STATUS_INDEX), 0);
});
