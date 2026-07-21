// Rung 8.6 · Kill-switch flip tool invariants — hermetic (node builtins only,
// no network, no KMS, no npm install). Ephemeral material only: every flip
// here operates on the committed status file or in-memory fixtures; signing
// never happens in this suite (the tool never signs — that is its contract).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  FLIP_PURPOSES,
  KEY_VERSION_REGION_END,
  flipBitInBitstring,
  keyVersionAtPosition,
  nextSuspendedPositions,
  prepareFlip,
  renderNextSteps,
  serializePayload,
} from "./flip-status-bit.ts";
import {
  ACTIVE_KEY_STATUS_INDEX,
  STATUS_LIST_BIT_LENGTH,
  SUSPENDED_KEY_VERSION_POSITIONS,
  buildStatusListCredential,
  decodeStatusList,
  statusBitAt,
} from "../spike/signer-spike/status-list.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_EPOCH = "key-epoch-2026-07";
const COMMITTED = readFileSync(join(REPO, "status", `${KEY_EPOCH}.json`));
const ISSUER_DID = "did:web:credentials.andamio.io";

// ---- flipBitInBitstring: the pure bit primitive ----

test("flip changes exactly the flipped bit; every other bit is untouched", () => {
  const bits = new Uint8Array(STATUS_LIST_BIT_LENGTH / 8);
  const flipped = flipBitInBitstring(bits, 0);
  let diff = 0;
  for (let i = 0; i < STATUS_LIST_BIT_LENGTH; i++) {
    if (statusBitAt(bits, i) !== statusBitAt(flipped, i)) diff += 1;
  }
  assert.equal(diff, 1, "exactly one bit differs");
  assert.equal(statusBitAt(flipped, 0), 1);
  // MSB-first per W3C: bit 0 = 0b1000_0000 of byte 0.
  assert.equal(flipped[0], 0b1000_0000);
  assert.equal(statusBitAt(bits, 0), 0, "input is not mutated");
});

test("re-flip restores the original bitstring byte-for-byte", () => {
  const bits = Uint8Array.from({ length: STATUS_LIST_BIT_LENGTH / 8 }, (_, i) => i % 251);
  assert.deepEqual(flipBitInBitstring(flipBitInBitstring(bits, 9), 9), bits);
});

test("flipBitInBitstring refuses NaN, fractions, and out-of-range indices", () => {
  const bits = new Uint8Array(16);
  assert.throws(() => flipBitInBitstring(bits, Number.NaN), /not an integer/);
  assert.throws(() => flipBitInBitstring(bits, 0.5), /not an integer/);
  assert.throws(() => flipBitInBitstring(bits, Number.parseInt("banana", 10)), /not an integer/);
  assert.throws(() => flipBitInBitstring(bits, -1), /out of range/);
  assert.throws(() => flipBitInBitstring(bits, 128), /out of range/);
});

// ---- keyVersionAtPosition: registry + reserved-region enforcement ----

test("keyVersionAtPosition: bit 0 is key-2026-07; unregistered and reserved refuse", () => {
  assert.equal(keyVersionAtPosition(0), "key-2026-07");
  assert.throws(() => keyVersionAtPosition(1), /not a registered key-version position/);
  assert.throws(() => keyVersionAtPosition(KEY_VERSION_REGION_END), /reserved-zero region/);
  assert.throws(() => keyVersionAtPosition(STATUS_LIST_BIT_LENGTH), /out of range/);
  assert.throws(() => keyVersionAtPosition(Number.NaN), /not an integer/);
});

// ---- prepareFlip on the committed served artifact ----

test("prepareFlip(committed, compromised-key): bit 0 flips; everything else byte-stable", () => {
  const result = prepareFlip(COMMITTED, KEY_EPOCH, 0, "compromised-key");
  assert.equal(result.before, 0);
  assert.equal(result.after, 1);
  assert.equal(result.keyVersion, "key-2026-07");
  assert.equal(
    result.committedSha256,
    createHash("sha256").update(COMMITTED).digest("hex"),
  );

  const committed = JSON.parse(COMMITTED.toString("utf8"));
  const unsigned: any = result.unsigned;

  // The proof is stripped (it no longer covers the flipped list) and ONLY the
  // encodedList changed — every other field is identical to the committed doc.
  assert.ok(!("proof" in unsigned), "unsigned payload must carry no proof");
  const { proof: _p, ...committedUnsigned } = committed;
  const { credentialSubject: cs1, ...restCommitted } = committedUnsigned;
  const { credentialSubject: cs2, ...restFlipped } = unsigned;
  assert.deepEqual(restFlipped, restCommitted);
  const { encodedList: _e1, ...cs1Rest } = cs1;
  const { encodedList: _e2, ...cs2Rest } = cs2;
  assert.deepEqual(cs2Rest, cs1Rest);

  // Decoded bitstrings differ in exactly bit 0.
  const before = decodeStatusList(cs1.encodedList);
  const after = decodeStatusList(cs2.encodedList);
  let diff = 0;
  for (let i = 0; i < STATUS_LIST_BIT_LENGTH; i++) {
    if (statusBitAt(before, i) !== statusBitAt(after, i)) diff += 1;
  }
  assert.equal(diff, 1);
  assert.equal(statusBitAt(after, 0), 1, "bit 0 (key-2026-07) is now suspended");
});

test("restore un-flips: flip -> restore round-trips to the committed unsigned doc", () => {
  const flipped = prepareFlip(COMMITTED, KEY_EPOCH, 0, "compromised-key");
  // Re-attach a dummy proof so the restore starts from a "signed" flipped list
  // (the tool refuses an unsigned base — in real ops the flipped list is
  // re-signed before it is ever committed).
  const flippedSigned = { ...flipped.unsigned, proof: JSON.parse(COMMITTED.toString("utf8")).proof };
  const restored = prepareFlip(
    Buffer.from(serializePayload(flippedSigned)),
    KEY_EPOCH,
    0,
    "restore",
  );
  assert.equal(restored.before, 1);
  assert.equal(restored.after, 0);
  const { proof: _p, ...committedUnsigned } = JSON.parse(COMMITTED.toString("utf8"));
  // Same platform => same deterministic gzip encoding: byte-identical payload.
  assert.equal(
    serializePayload(restored.unsigned),
    serializePayload(committedUnsigned),
    "restore must reproduce the committed unsigned document exactly",
  );
});

test("prepared payload = what the hardened re-sign will build (builder coherence)", () => {
  // sign-status-list.ts signs buildStatusListCredential(ISSUER_DID), which
  // reads SUSPENDED_KEY_VERSION_POSITIONS. After the flip PR sets the
  // constant to nextSuspendedPositions, builder output and this tool's
  // payload must agree — same fields, same decoded bitstring.
  const result = prepareFlip(COMMITTED, KEY_EPOCH, 0, "compromised-key");
  assert.deepEqual(nextSuspendedPositions(result), [0]);
  const rebuilt: any = buildStatusListCredential(ISSUER_DID, {
    flippedKeyVersionPositions: nextSuspendedPositions(result),
  });
  const unsigned: any = result.unsigned;
  assert.deepEqual(
    decodeStatusList(unsigned.credentialSubject.encodedList),
    decodeStatusList(rebuilt.credentialSubject.encodedList),
    "tool payload and builder must encode the same bitstring",
  );
  unsigned.credentialSubject = {
    ...unsigned.credentialSubject,
    encodedList: rebuilt.credentialSubject.encodedList,
  };
  assert.deepEqual(unsigned, rebuilt);
});

// ---- refusals ----

test("prepareFlip refuses bad purposes, epochs, indices, and no-op flips", () => {
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, 0, "revocation"), /unknown purpose/);
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, 0, ""), /unknown purpose/);
  assert.throws(() => prepareFlip(COMMITTED, "2026-07", 0, "compromised-key"), /key-epoch-YYYY-MM/);
  assert.throws(
    () => prepareFlip(COMMITTED, "key-epoch-2026-08", 0, "compromised-key"),
    /id mismatch/,
    "epoch must match the committed list's id",
  );
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, Number.NaN, "compromised-key"), /not an integer/);
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, -1, "compromised-key"), /out of range/);
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, STATUS_LIST_BIT_LENGTH, "compromised-key"), /out of range/);
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, 64, "compromised-key"), /reserved-zero/);
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, 1, "compromised-key"), /not a registered/);
  // Direction guards: the committed list has bit 0 = 0 today.
  assert.throws(() => prepareFlip(COMMITTED, KEY_EPOCH, 0, "restore"), /already 0/);
});

test("prepareFlip refuses an unsigned or non-suspension base document", () => {
  const committed = JSON.parse(COMMITTED.toString("utf8"));
  const { proof: _p, ...unsigned } = committed;
  assert.throws(
    () => prepareFlip(Buffer.from(serializePayload(unsigned)), KEY_EPOCH, 0, "compromised-key"),
    /no proof/,
  );
  const wrongPurpose = structuredClone(committed);
  wrongPurpose.credentialSubject.statusPurpose = "revocation";
  assert.throws(
    () => prepareFlip(Buffer.from(serializePayload(wrongPurpose)), KEY_EPOCH, 0, "compromised-key"),
    /statusPurpose/,
  );
});

// ---- operator guidance ----

test("next-steps output names the hardened re-sign, the constant, and the sha-pin procedure", () => {
  const result = prepareFlip(COMMITTED, KEY_EPOCH, 0, "compromised-key");
  const steps = renderNextSteps(result);
  // The tool prepares; the operator signs via the existing hardened path.
  assert.match(steps, /npm run sign:status/);
  assert.match(steps, /exactly ONE KMS call/);
  // The flip lands in code: the committed constant the builder + CI read.
  assert.match(steps, /SUSPENDED_KEY_VERSION_POSITIONS: readonly number\[\] = \[0\]/);
  // The committed-file sha-pin test's update procedure is referenced.
  assert.match(steps, /COMMITTED_STATUS_FILE_SHA256/);
  assert.match(steps, /shasum -a 256 status\/key-epoch-2026-07\.json/);
  assert.match(steps, /UPDATE THIS PIN ON EVERY LEGITIMATE RE-SIGN/);
  // Propagation + the required cross-verifier read (runbook residual risk 1).
  assert.match(steps, /max-age=3600/);
  assert.match(steps, /cross-verifier read/);
  assert.match(steps, /docs\/runbooks\/key-compromise\.md/);
  assert.match(steps, /NOTHING IS SIGNED/);
});

test("purposes are exactly the Decision-3 flip purpose plus the false-alarm stand-down", () => {
  assert.deepEqual([...FLIP_PURPOSES], ["compromised-key", "restore"]);
});

test("today's committed state: no key version suspended (kill-switch armed, not fired)", () => {
  assert.deepEqual([...SUSPENDED_KEY_VERSION_POSITIONS], []);
  const bits = decodeStatusList(
    JSON.parse(COMMITTED.toString("utf8")).credentialSubject.encodedList,
  );
  assert.equal(statusBitAt(bits, ACTIVE_KEY_STATUS_INDEX), 0);
});
