// Rung 8 · SLT-hash derivation tests (issue #54, finding 3).
//
// Pins the dependency-free Blake2b-256 + Plutus Data CBOR implementation to
// known vectors, including the REAL mainnet subject module: the exact SLT
// texts whose hash is the pinned on-chain slt_hash the anchor gate verifies.
// Hermetic — no network, no npm install (node builtins only).

import { test } from "node:test";
import assert from "node:assert/strict";

import { blake2b256, computeSltHash, encodeSltList } from "./slt-hash.ts";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// --- Blake2b-256 (RFC 7693, unkeyed, 32-byte digest) ------------------------

test("blake2b256: empty input", () => {
  assert.equal(
    hex(blake2b256(new Uint8Array(0))),
    "0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8",
  );
});

test("blake2b256: 'abc'", () => {
  assert.equal(
    hex(blake2b256(new TextEncoder().encode("abc"))),
    "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319",
  );
});

test("blake2b256: multi-block input (bytes 0..255, exercises the compress loop)", () => {
  const data = new Uint8Array(256);
  for (let i = 0; i < 256; i++) data[i] = i;
  assert.equal(
    hex(blake2b256(data)),
    "39a7eb9fedc19aabc83425c6755dd90e6f9d0c804964a1f4aaeea3b9fb599835",
  );
});

// --- Plutus Data CBOR encoding ----------------------------------------------

test("encodeSltList: short strings use definite-length byte strings inside 0x9f...0xff", () => {
  // ["abc"] -> 9f (indef array) 43 616263 (3-byte string) ff (break)
  assert.equal(hex(encodeSltList(["abc"])), "9f43616263ff");
});

test("encodeSltList: >64-byte strings use Plutus chunked encoding (0x5f + 64-byte chunks + 0xff)", () => {
  const s = "x".repeat(100);
  assert.equal(
    hex(encodeSltList([s])),
    "9f5f5840" + "78".repeat(64) + "5824" + "78".repeat(36) + "ffff",
  );
});

// --- The full derivation ----------------------------------------------------

test("computeSltHash: empty list has a defined hash (the gate must still refuse to sign it)", () => {
  assert.equal(
    computeSltHash([]),
    "afc0da64183bf2664f3d4eec7238d524ba607faeeab24fc100eb861dba69971b",
  );
});

test("computeSltHash: chunked-path vector", () => {
  assert.equal(
    computeSltHash(["x".repeat(100)]),
    "836c8418c923f5eab614411972a666f9e60598bdaf45d26d3fc200ae3396ef31",
  );
});

// The REAL mainnet subject: module e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db
// of course ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df
// ("About Andamio Issuer" / "Andamio Issuer"). These are the on-chain SLT
// texts; their hash IS the module's slt_hash. Cross-checked against the
// andamio CLI's `course credential verify-hash` derivation
// (internal/cardano/slt_hash.go) and live Andamioscan data on 2026-07-21.
test("computeSltHash: real mainnet subject module derives the pinned slt_hash", () => {
  const slts = [
    "I can explain how the Andamio Issuer product differs from the Andamio API.",
    "I can identify the target market for the Andamio Issuer product.",
    "I can find the documentation and resources that support Andamio Issuer.",
  ];
  assert.equal(
    computeSltHash(slts),
    "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db",
  );
});

test("computeSltHash: any tampering with the SLT text changes the hash", () => {
  const slts = [
    "I can explain how the Andamio Issuer product differs from the Andamio API.",
    "I can identify the target market for the Andamio Issuer product.",
    "I can find the documentation and resources that support Andamio Issuer!",
  ];
  assert.notEqual(
    computeSltHash(slts),
    "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db",
  );
});
