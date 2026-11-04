// The core assembler refuses malformed assertions rather than repairing them.
// Hermetic: node builtins only.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assembleCredential, validateAssertion } from "../core/assemble.ts";
import type { IssuerProfile, TrustAssertion } from "../core/types.ts";

const ISSUER: IssuerProfile = {
  id: "did:web:issuer.example",
  type: ["Profile"],
  name: "Issuer",
  url: "https://issuer.example",
  description: "Test issuer.",
  baseContexts: ["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"],
  statusEntry: () => ({ id: "https://issuer.example/status#0", type: "BitstringStatusListEntry" }),
};

const BASE: TrustAssertion = {
  credentialId: "urn:example:credential:1",
  validFrom: "2026-01-02T03:04:05Z",
  name: "N",
  description: "D",
  subject: { id: "urn:example:subject:1" },
  achievement: { id: "urn:example:achievement:1", name: "A", description: "AD", criteria: { narrative: "C" } },
  evidence: [{ id: "urn:example:evidence:1", type: ["Evidence"], name: "E" }],
  contexts: ["https://example.org/ctx/v1.jsonld", "https://www.w3.org/ns/credentials/v2"],
  extensions: { exampleTerm: "x" },
  provenance: { adapter: "test", checkedAt: "2026-01-02T03:04:05Z", source: "test" },
};

test("assembles base contexts first, adds adapter contexts once, attaches status", () => {
  const vc = assembleCredential(BASE, ISSUER) as any;
  assert.deepStrictEqual(vc["@context"], [...ISSUER.baseContexts, "https://example.org/ctx/v1.jsonld"]);
  assert.equal(vc.exampleTerm, "x");
  assert.equal(vc.credentialStatus.type, "BitstringStatusListEntry");
  assert.equal("provenance" in vc, false, "provenance is never signed");
});

test("does not alias the assertion's evidence or extensions", () => {
  const vc = assembleCredential(BASE, ISSUER) as any;
  vc.evidence[0].name = "mutated";
  assert.equal(BASE.evidence[0].name, "E");
});

const bad: [string, Partial<TrustAssertion> | ((a: TrustAssertion) => TrustAssertion), RegExp][] = [
  ["empty name", { name: "" }, /name/],
  ["local time", { validFrom: "2026-01-02T03:04:05+01:00" }, /validFrom/],
  ["e-mail subject", { subject: { id: "alice@example.org" } }, /pseudonymous/],
  ["no evidence", { evidence: [] }, /evidence/],
  ["evidence without Evidence type", { evidence: [{ id: "x", type: ["Thing"], name: "n" }] }, /Evidence/],
  ["missing criteria", (a) => ({ ...a, achievement: { ...a.achievement, criteria: { narrative: "" } } }), /criteria/],
  ["extension overwrites issuer", { extensions: { issuer: "did:evil" } }, /overwrite/],
  ["extension overwrites proof", { extensions: { proof: {} } }, /overwrite/],
];

for (const [label, change, pattern] of bad) {
  test(`refuses an assertion with ${label}`, () => {
    const a = typeof change === "function" ? change(structuredClone(BASE)) : { ...structuredClone(BASE), ...change };
    assert.throws(() => validateAssertion(a as TrustAssertion), pattern);
    assert.throws(() => assembleCredential(a as TrustAssertion, ISSUER), pattern);
  });
}
