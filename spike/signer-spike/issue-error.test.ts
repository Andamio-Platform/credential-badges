// Rung 8 · Narrow-catch matcher tests (issue #54, finding 1).
//
// The jsigs fallback in sign.ts may absorb EXACTLY ONE error: the known
// urn-id data-model TypeError some @digitalbazaar/vc versions throw from
// _validateUriId. Everything else must propagate. Hermetic — node builtins
// only.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isKnownUrnIdDataModelError } from "./issue-error.ts";

test("matches the known urn-id TypeError from _validateUriId", () => {
  assert.ok(
    isKnownUrnIdDataModelError(
      new TypeError(
        `"credentialSubject.id" must be a URI: "urn:andamio:mainnet:recipient:gjames".`,
      ),
    ),
  );
  assert.ok(
    isKnownUrnIdDataModelError(
      new TypeError(
        `"evidence" must be a URI: "urn:andamio:credential:mainnet:ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df:e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db:gjames".`,
      ),
    ),
  );
});

test("does NOT match the same message on a plain Error (wrong class)", () => {
  assert.equal(
    isKnownUrnIdDataModelError(
      new Error(`"credentialSubject.id" must be a URI: "urn:andamio:x".`),
    ),
    false,
  );
});

test("does NOT match a URI TypeError about a non-urn id", () => {
  assert.equal(
    isKnownUrnIdDataModelError(
      new TypeError(`"issuer" must be a URI: "not a url at all".`),
    ),
    false,
  );
});

test("does NOT match real data-model violations that must abort the run", () => {
  for (const e of [
    new Error('"type" must include `VerifiableCredential`.'),
    new Error('"credentialSubject" must make a claim.'),
    new Error('"issuer" property is required.'),
    new Error("documentLoader refused (not in allowlist): https://evil.example.com"),
    new Error("KMS returned 0 signature bytes, expected raw 64-byte Ed25519"),
    new TypeError("something unrelated"),
    undefined,
    null,
    "string error",
  ]) {
    assert.equal(isKnownUrnIdDataModelError(e), false, String(e));
  }
});
