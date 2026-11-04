// EXTRACTION EQUIVALENCE: the core + adapter path must produce exactly what
// production signs today.
//
// Runs the REAL anchor gate against the issuer service's recorded Andamioscan
// fixtures (no network), then checks that
//
//   assembleCredential(cardanoAndamio.resolve(subject), ANDAMIO_ISSUER)
//
// deep-equals both the production mapper's output and the committed signed
// credential (signing/signed-credential.json) with its proof removed. If this
// stays green, switching the issuer service to the adapter path cannot change
// a signed byte for this subject. The expansion-pin job remains the authority
// on canonical form.
//
// Hermetic: node builtins only, no npm install.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnchor, GateRefusal, UpstreamError } from "../../issuer-service/src/anchor.ts";
import { mapCredential } from "../../issuer-service/src/map-credential.ts";
import { makeFixtureFetch, SUBJECT } from "../../issuer-service/test/helpers.ts";
import { assembleCredential } from "../core/assemble.ts";
import { AdapterRefusal } from "../core/types.ts";
import { assertionFromAnchor, createCardanoAndamioAdapter, ADAPTER_ID } from "../cardano-andamio/adapter.ts";
import { ANDAMIO_ISSUER } from "../cardano-andamio/issuer-profile.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const REQUEST = {
  network: SUBJECT.network,
  courseId: SUBJECT.courseId,
  sltHash: SUBJECT.sltHash,
  alias: SUBJECT.alias,
};

function adapterWith(fetchImpl: typeof fetch) {
  return createCardanoAndamioAdapter({
    gateDeps: () => ({
      fetchImpl,
      courseTitle: "Andamio Issuer",
      moduleTitle: "About Andamio Issuer",
      locatorCache: new Map<string, { txHash: string; slot: number }>(),
    }),
  });
}

test("core(adapter(subject)) equals the committed signed credential, minus its proof", async () => {
  const { fetchImpl } = makeFixtureFetch();
  const assertion = await adapterWith(fetchImpl).resolve(REQUEST);
  const credential = assembleCredential(assertion, ANDAMIO_ISSUER);

  const signed = JSON.parse(readFileSync(path.join(REPO, "signing", "signed-credential.json"), "utf8"));
  const { proof, ...unsigned } = signed;
  assert.ok(proof, "fixture sanity: the committed credential is signed");
  assert.deepStrictEqual(credential, unsigned);
});

test("core(adapter(anchor)) equals mapCredential(anchor), the production mapper", async () => {
  const { fetchImpl } = makeFixtureFetch();
  const anchor = await checkAnchor(REQUEST, {
    fetchImpl,
    courseTitle: "Andamio Issuer",
    moduleTitle: "About Andamio Issuer",
    locatorCache: new Map(),
  });
  assert.deepStrictEqual(assembleCredential(assertionFromAnchor(anchor), ANDAMIO_ISSUER), mapCredential(anchor));
});

test("the assertion is deterministic apart from provenance", async () => {
  const a = await adapterWith(makeFixtureFetch().fetchImpl).resolve(REQUEST);
  const b = await adapterWith(makeFixtureFetch().fetchImpl).resolve(REQUEST);
  const { provenance: pa, ...ra } = a;
  const { provenance: pb, ...rb } = b;
  assert.deepStrictEqual(ra, rb);
  assert.equal(pa.adapter, ADAPTER_ID);
  assert.ok(pa.endpoints && pa.endpoints.length > 0, "provenance records the reads");
});

test("a chain-side refusal surfaces as AdapterRefusal (unknown recipient)", async () => {
  const { fetchImpl } = makeFixtureFetch();
  await assert.rejects(adapterWith(fetchImpl).resolve({ ...REQUEST, alias: "mallory" }), (e: unknown) => {
    assert.ok(e instanceof AdapterRefusal);
    assert.equal(e.adapter, ADAPTER_ID);
    assert.ok(e.cause instanceof GateRefusal);
    return true;
  });
});

test("an unreachable indexer is NOT a refusal: UpstreamError propagates unchanged", async () => {
  const { fetchImpl } = makeFixtureFetch({
    override: () => new Response("upstream down", { status: 503 }),
  });
  await assert.rejects(adapterWith(fetchImpl).resolve(REQUEST), (e: unknown) => {
    assert.ok(e instanceof UpstreamError);
    assert.ok(!(e instanceof AdapterRefusal));
    return true;
  });
});
