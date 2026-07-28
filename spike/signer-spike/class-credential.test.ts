// U2 tests for the class-credential builder.
//
// The failure mode being defended against is a field that reads as an identity
// claim. That is much easier to assert absent than to notice present, so the
// identity assertions here walk the whole object rather than checking known
// field names.
//
// Run: node --experimental-strip-types --test spike/signer-spike/class-credential.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClassCredential,
  classCredentialId,
  UnknownBadge,
} from "./class-credential.ts";
import { PRODUCTION_CONTEXTS, ISSUER_DID } from "./map-credential.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const REGISTRY = path.join(REPO, "generator", "credentials.json");

const registry = JSON.parse(readFileSync(REGISTRY, "utf8")) as Array<{
  course_id: string;
  slt_hash: string;
  course_title: string;
  module_title: string;
}>;

const SAMPLE = registry[0];
const NETWORK = "mainnet";

/** Every string value anywhere in the object, for identity sweeps. */
function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const v of node) allStrings(v, out);
  else if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) allStrings(v, out);
  }
  return out;
}

/** Every key name anywhere in the object. */
function allKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const v of node) allKeys(v, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

// ------------------------- no identity, anywhere --------------------------- //

test("credentialSubject carries NO id — the identityless shape (KTD-1)", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  assert.ok(c.credentialSubject, "credentialSubject must exist");
  assert.equal(
    Object.prototype.hasOwnProperty.call(c.credentialSubject, "id"),
    false,
    "credentialSubject.id must be absent, not empty",
  );
});

test("no field anywhere carries a holder identifier or alias", () => {
  const c = buildClassCredential(SAMPLE, NETWORK);
  // The holder dialect's identity-bearing shapes: recipient URNs, Access
  // Token assets (g<alias>), and claim-transaction references.
  for (const s of allStrings(c)) {
    assert.ok(!s.includes(":recipient:"), `recipient URN leaked: ${s}`);
    assert.ok(!/\burn:andamio:[a-z]+:recipient\b/.test(s), `recipient URN leaked: ${s}`);
  }
  for (const k of allKeys(c)) {
    assert.ok(k !== "claimTxHash", "claimTxHash implies a specific earning event");
    assert.ok(k !== "asset", "asset is the holder's Access Token — never in a class artifact");
    assert.ok(k !== "assessor", "assessor names a person; deliberately omitted");
  }
});

test("the credential id is a badge URN, distinct from the credential URN namespace", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  assert.equal(c.id, classCredentialId(SAMPLE, NETWORK));
  assert.match(c.id, /^urn:andamio:badge:/);
  assert.ok(
    !c.id.startsWith("urn:andamio:credential:"),
    "a class artifact must not occupy the holder-credential URN namespace",
  );
});

// ---------------------------- shape + provenance --------------------------- //

test("references the production contexts and the hosted issuer profile", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  assert.deepEqual(c["@context"], [...PRODUCTION_CONTEXTS]);
  assert.equal(c.issuer.id, ISSUER_DID);
  assert.deepEqual(c.type, ["VerifiableCredential", "OpenBadgeCredential"]);
});

test("carries a credentialStatus entry so the kill-switch covers it (KTD-6)", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  assert.equal(c.credentialStatus.type, "BitstringStatusListEntry");
  assert.equal(c.credentialStatus.statusPurpose, "suspension");
  assert.match(c.credentialStatus.statusListCredential, /^https:\/\/credentials\.andamio\.io\/status\//);
});

test("evidence anchors to the badge coordinate, not to a claim", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  const ev = c.evidence[0];
  assert.deepEqual(ev.type, ["OnChainCredentialAnchor", "Evidence"]);
  assert.equal(ev.network, NETWORK);
  assert.equal(ev.policyId, SAMPLE.course_id);
  assert.ok(ev.id.includes(SAMPLE.course_id), "evidence should locate the course on chain");
});

test("human-readable text says this is a definition, not an earning claim", () => {
  const c = buildClassCredential(SAMPLE, NETWORK) as any;
  const prose = `${c.description} ${c.credentialSubject.achievement.criteria.narrative}`.toLowerCase();
  assert.ok(
    prose.includes("does not assert") || prose.includes("not assert that any"),
    "the description must state plainly that nobody is claimed to have earned it",
  );
  // The machine-readable shape cannot express "definition", so the prose is
  // the mitigation KTD-1 relies on — it must not read as an earning claim.
  assert.ok(!/\bhas earned\b|\bcompleted the\b/.test(prose), `prose reads as an earning claim: ${prose}`);
});

// ------------------------------ determinism -------------------------------- //

test("two builds for the same badge are byte-identical (R3)", () => {
  const a = JSON.stringify(buildClassCredential(SAMPLE, NETWORK));
  const b = JSON.stringify(buildClassCredential(SAMPLE, NETWORK));
  assert.equal(a, b);
});

test("every registered badge builds, and each id is unique", () => {
  const ids = new Set<string>();
  for (const rec of registry) {
    const c = buildClassCredential(rec, NETWORK) as any;
    assert.ok(c.name, `no name for ${rec.course_id}.${rec.slt_hash}`);
    ids.add(c.id);
  }
  assert.equal(ids.size, registry.length, "class credential ids must be unique per badge");
});

// -------------------------------- refusals --------------------------------- //

test("refuses a badge absent from the registry", () => {
  assert.throws(
    () => buildClassCredential(
      { course_id: "f".repeat(56), slt_hash: "0".repeat(64), course_title: "x", module_title: "y" },
      NETWORK,
    ),
    UnknownBadge,
  );
});

test("refuses a malformed coordinate", () => {
  assert.throws(
    () => buildClassCredential(
      { course_id: "nope", slt_hash: "0".repeat(64), course_title: "x", module_title: "y" },
      NETWORK,
    ),
    UnknownBadge,
  );
});
