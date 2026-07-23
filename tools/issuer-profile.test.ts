// ISSUER-PROFILE + CONTEXT SHAPE INVARIANT — the Rung 4 drift guard.
//
// The hosted issuer Profile (`issuer/profile.jsonld`, served at `/issuer`) MUST
// carry the spike-proven AttestationHost shape, and the served context
// (`context/v1.jsonld`, served at `/context/v1.jsonld`) MUST DEFINE the
// `AttestationHost` term the Profile references — otherwise strict JSON-LD
// verifiers silently drop the unmapped `AttestationHost` type. If either file
// drifts from the shape that passed spruce (VALID 0/0) + the 1EdTech validator,
// this test goes RED — a loud CI failure instead of a silent verification break.
//
// Scope: a SELF-CONSISTENCY / structural guard on the committed files. It does
// NOT fetch the live host or run a JSON-LD processor (the `tools/` package has
// no deps by design); served-layer content-type + resolution stays covered by
// the CI `smoke` job, and full expansion is a post-deploy manual "verified when".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Ground truth — the subject and served context the Profile must name (Rung 4).
const ISSUER_DID = "did:web:credentials.andamio.io";
const SERVED_CONTEXT_URL = "https://credentials.andamio.io/context/v1.jsonld";
const EXPECTED_PROFILE_CONTEXT = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  SERVED_CONTEXT_URL,
];

const PROFILE_PATH = fileURLToPath(
  new URL("../issuer/profile.jsonld", import.meta.url),
);
const CONTEXT_PATH = fileURLToPath(
  new URL("../context/v1.jsonld", import.meta.url),
);

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

// The Profile invariant, reusable so we can prove it passes on the committed
// file AND throws on a drifted one.
function assertProfileShape(profile: any): void {
  assert.equal(profile.id, ISSUER_DID, "Profile id must be the did:web subject");
  assert.deepEqual(
    profile.type,
    ["Profile", "AttestationHost"],
    "Profile type must be exactly [Profile, AttestationHost]",
  );
  assert.deepEqual(
    profile["@context"],
    EXPECTED_PROFILE_CONTEXT,
    "Profile @context must be [W3C VC v2, OB v3p0, served andamio context], in order",
  );
  assert.equal(
    profile.url,
    "https://credentials.andamio.io",
    "Profile url must stay the homepage, not the DID",
  );
  // House style bans em-dashes; guard the neighbouring typographic dashes too
  // (en-dash, horizontal bar) so a substitute can't slip past a naive check.
  assert.equal(
    /[—–―]/.test(profile.description),
    false,
    "Profile description must not contain em/en/typographic dashes (house style)",
  );
}

// The context invariant: AttestationHost must be a DEFINED term so the Profile's
// type does not drop on expansion. OnChainCredentialAnchor rides along for
// Rung 6. Adding these must not have clobbered the pre-existing @protected terms.
function assertContextDefinesTerms(context: any): void {
  const c = context["@context"];
  assert.equal(c["AttestationHost"], "andamio:AttestationHost");
  assert.equal(c["OnChainCredentialAnchor"], "andamio:OnChainCredentialAnchor");
  assert.equal(c["@protected"], true, "context must stay @protected");
  // Rung 8.3 additive terms (plan P1bis-04 + Decision 2 flat evidence dialect).
  // courseOwner / assessor are @id-typed (URN references, expanded as IRIs);
  // the four flat anchor terms are the Decision-2 evidence field names,
  // registered top-level so the flat evidence entry expands with no dropped
  // terms. Same shapes the rung-1 throwaway context proved against spruce +
  // 1EdTech (spike/verifier-spike/publish/context/v0.jsonld).
  assert.deepEqual(c["courseOwner"], { "@id": "andamio:courseOwner", "@type": "@id" });
  assert.deepEqual(c["assessor"], { "@id": "andamio:assessor", "@type": "@id" });
  assert.equal(c["network"], "andamio:network");
  assert.equal(c["policyId"], "andamio:policyId");
  assert.equal(c["asset"], "andamio:asset");
  assert.equal(c["claimTxHash"], "andamio:claimTxHash");
  // Guard the SHAPE, not just the key: these terms are object-form with a
  // scoped @context defining their on-chain sub-properties. A flatten to a bare
  // string mapping would still pass `term in c` while silently dropping the
  // nested properties on expansion — so assert the scoped @context survives.
  for (const term of [
    "onChainAnchor",
    "onChainAttestation",
    "accessToken",
    "requires",
    "prereqAttestation",
  ]) {
    const def = c[term];
    assert.ok(
      def && typeof def === "object" && def["@context"],
      `pre-existing term '${term}' must survive the edit with its scoped @context intact`,
    );
  }
}

test("committed issuer profile carries the AttestationHost shape (Rung 4)", () => {
  assertProfileShape(readJson(PROFILE_PATH));
});

test("committed context defines AttestationHost + OnChainCredentialAnchor", () => {
  assertContextDefinesTerms(readJson(CONTEXT_PATH));
});

test("the profile guard bites — a dropped AttestationHost type fails", () => {
  const profile = readJson(PROFILE_PATH);
  profile.type = ["Profile"]; // pre-Rung-4 shape
  assert.throws(() => assertProfileShape(profile), /Profile type must be exactly/);
});

test("the context guard bites — an undefined AttestationHost fails", () => {
  const context = readJson(CONTEXT_PATH);
  delete context["@context"]["AttestationHost"];
  assert.throws(() => assertContextDefinesTerms(context));
});

test("the context guard bites — a dropped Rung-8.3 flat-evidence term fails", () => {
  for (const term of ["courseOwner", "assessor", "network", "policyId", "asset", "claimTxHash"]) {
    const context = readJson(CONTEXT_PATH);
    delete context["@context"][term];
    assert.throws(
      () => assertContextDefinesTerms(context),
      `deleting '${term}' must fail the invariant`,
    );
  }
});
