// U2 expansion check for the class credential — requires the jsonld dep, so it
// lives outside the hermetic `npm test` suite (same split as
// expansion-pin.dep-test.ts).
//
// Why this matters more than a shape assertion: eddsa-rdfc-2022 signs the
// canonical N-Quads of the EXPANDED document, not the JSON you wrote. A term
// the context does not define is silently dropped during expansion — it never
// reaches the signed bytes. That is the failure mode this file exists to catch,
// and it matters twice over here, because the human-readable prose is the only
// mitigation available for the identityless shape (KTD-1). Prose that gets
// dropped in expansion is decorative, not a mitigation.
//
// Run: npm run test:class-expansion

import { test } from "node:test";
import assert from "node:assert/strict";

import jsonld from "jsonld";

import { buildClassCredential, registry } from "./class-credential.ts";
import { makeDocumentLoader } from "./document-loader.ts";

const loader = makeDocumentLoader();
const NETWORK = "mainnet";

/** Canonical N-Quads — literally the bytes the signature is computed over. */
async function signedBytes(cred: unknown): Promise<string> {
  return (await jsonld.canonize(cred, {
    documentLoader: loader,
    algorithm: "URDNA2015",
    format: "application/n-quads",
  })) as unknown as string;
}

test("every source term survives expansion — nothing silently dropped", async () => {
  const cred: any = buildClassCredential(registry()[0], NETWORK);
  const expanded = await jsonld.expand(cred, { documentLoader: loader });
  const flat = JSON.stringify(expanded);

  // Each source term must appear as the suffix of some absolute IRI. Compared
  // case-insensitively: OB 3.0 maps `criteria` to `…#Criteria`, and a
  // case-sensitive check reports a false drop.
  const terms = new Set<string>();
  (function walk(n: any) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      for (const [k, v] of Object.entries(n)) {
        if (!k.startsWith("@") && k !== "id" && k !== "type") terms.add(k);
        walk(v);
      }
    }
  })(cred);

  const dropped = [...terms].filter(
    (t) => !new RegExp(`[#/]${t}"`, "i").test(flat),
  );
  assert.deepEqual(dropped, [], `terms dropped during expansion: ${dropped.join(", ")}`);
});

test("the definition prose reaches the signed bytes", async () => {
  const cred = buildClassCredential(registry()[0], NETWORK);
  const nq = await signedBytes(cred);
  assert.ok(
    nq.includes("does not assert that any person holds it"),
    "the description's disclaimer must be in the canonical N-Quads",
  );
  assert.ok(
    nq.includes("does not assert that any person has met them"),
    "the criteria narrative's disclaimer must be in the canonical N-Quads",
  );
});

test("no holder identity reaches the signed bytes", async () => {
  const nq = await signedBytes(buildClassCredential(registry()[0], NETWORK));
  assert.ok(!nq.includes(":recipient:"), "a recipient URN reached the signed graph");
  assert.ok(!/claimTxHash/i.test(nq), "a claim-transaction reference reached the signed graph");
});

test("canonicalization is deterministic across builds", async () => {
  const rec = registry()[0];
  const a = await signedBytes(buildClassCredential(rec, NETWORK));
  const b = await signedBytes(buildClassCredential(rec, NETWORK));
  assert.equal(a, b, "canonical N-Quads must be byte-stable (R3)");
});

test("every registered badge canonicalizes, and each produces distinct bytes", async () => {
  const seen = new Map<string, string>();
  for (const rec of registry()) {
    const nq = await signedBytes(buildClassCredential(rec, NETWORK));
    const id = `${rec.course_id}.${rec.slt_hash}`;
    const clash = seen.get(nq);
    assert.equal(clash, undefined, `${id} canonicalizes identically to ${clash}`);
    seen.set(nq, id);
  }
  assert.equal(seen.size, registry().length);
});
