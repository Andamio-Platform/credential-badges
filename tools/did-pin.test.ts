// KEY-PIN INVARIANT — the drift guard.
//
// The committed `.well-known/did.json` MUST publish exactly the KMS
// `vc-sign-ed25519` version 1 public key. If the committed key is ever wrong or
// silently rotated, this test goes RED — a loud CI failure instead of a silent
// verification break for every credential.
//
// Default: decode-only, hermetic (no network). Opt-in live check: set
// KMS_LIVE_PIN=1 with an authed gcloud to additionally re-fetch KMS version 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DID,
  VERIFICATION_METHOD_ID,
  multibaseToRawPublicKey,
  rawPublicKeyToMultibase,
  spkiPemToRawPublicKey,
} from "./gen-did-json.ts";

// Ground truth (verified live 2026-07-10) — raw 32 bytes of KMS version 1.
const PINNED_RAW_HEX =
  "318d54e79ed163967f189e649abbcd2241dc64bf6cbfe98d7c3b1a60fed55014";

const DID_JSON_PATH = fileURLToPath(
  new URL("../.well-known/did.json", import.meta.url),
);

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function readCommittedDoc(): any {
  return JSON.parse(readFileSync(DID_JSON_PATH, "utf8"));
}

// The invariant, as a reusable assertion so we can prove it BOTH passes on the
// committed doc AND throws on a drifted one.
function assertPinnedKey(doc: any): void {
  const vm = doc.verificationMethod?.[0];
  assert.ok(vm, "did.json has no verificationMethod");
  assert.equal(vm.type, "Multikey");
  const raw = multibaseToRawPublicKey(vm.publicKeyMultibase);
  assert.equal(
    hex(raw),
    PINNED_RAW_HEX,
    "committed publicKeyMultibase does NOT match KMS vc-sign-ed25519 version 1",
  );
}

test("committed did.json publishes exactly KMS version 1", () => {
  assertPinnedKey(readCommittedDoc());
});

test("identifiers are internally consistent", () => {
  const doc = readCommittedDoc();
  assert.equal(doc.id, DID);
  assert.equal(doc.verificationMethod[0].id, VERIFICATION_METHOD_ID);
  assert.equal(doc.verificationMethod[0].controller, DID);
  assert.equal(doc.assertionMethod[0], VERIFICATION_METHOD_ID);
});

test("the invariant catches a drifted / rotated key (guard bites)", () => {
  // Flip one byte of the pinned key, re-encode, and confirm the pin check fails.
  const drifted = new Uint8Array(Buffer.from(PINNED_RAW_HEX, "hex"));
  drifted[drifted.length - 1] ^= 0x01;
  const doc = readCommittedDoc();
  doc.verificationMethod[0].publicKeyMultibase = rawPublicKeyToMultibase(drifted);
  assert.throws(() => assertPinnedKey(doc), /does NOT match KMS/);
});

test("live KMS re-fetch matches the committed key", { skip: !process.env.KMS_LIVE_PIN }, () => {
  const pem = execFileSync(
    "gcloud",
    [
      "kms", "keys", "versions", "get-public-key", "1",
      "--location", "us-central1",
      "--keyring", "credential-badges-issuer",
      "--key", "vc-sign-ed25519",
      "--project", "andamio-credentials",
    ],
    { encoding: "utf8" },
  );
  assert.equal(hex(spkiPemToRawPublicKey(pem)), PINNED_RAW_HEX);
});
