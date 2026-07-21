// Startup drift-check tests — the fail-closed boot gate (deployment plan
// Decision 4 / P1-06). Hermetic: injected fetch, injected key material. The
// live-did fixture is the REAL production did.json recorded 2026-07-21.

import assert from "node:assert/strict";
import { test } from "node:test";

import { runStartupDriftCheck, DriftError } from "../src/drift-check.ts";
import { loadCommittedAndamioContext } from "../src/document-loader.ts";
import { makeEphemeralSigner } from "../src/signer.ts";
import { fixture } from "./helpers.ts";

const LIVE_DID = fixture("live-did.json");
const VM_ID = "did:web:credentials.andamio.io#key-2026-07";
const LIVE_MULTIBASE: string = LIVE_DID.verificationMethod[0].publicKeyMultibase;
const COMMITTED_CTX = loadCommittedAndamioContext();

function fetchServing(map: Record<string, any>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url in map) {
      return new Response(JSON.stringify(map[url]), { status: 200 });
    }
    throw new Error(`drift-check test fetch: unmocked ${url}`);
  }) as typeof fetch;
}

const LIVE_URLS = {
  "https://credentials.andamio.io/.well-known/did.json": LIVE_DID,
  "https://credentials.andamio.io/context/v0.jsonld": COMMITTED_CTX,
};

test("passes when the signer's public key matches the live did.json pin", async () => {
  const { didDocument, didSource } = await runStartupDriftCheck({
    verificationMethodId: VM_ID,
    getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
    fetchImpl: fetchServing(LIVE_URLS),
    retryDelaysMs: [],
    log: () => {},
  });
  assert.equal(didSource, "live");
  assert.equal(didDocument.id, "did:web:credentials.andamio.io");
});

test("REFUSES on public-key mismatch (genuine drift): a different key can never serve", async () => {
  const rogue = makeEphemeralSigner();
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => rogue.publicKeyMultibase,
      fetchImpl: fetchServing(LIVE_URLS),
      retryDelaysMs: [],
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /refusing to serve signing endpoints/.test(e.message),
  );
});

test("REFUSES when the active verificationMethod fragment is absent from did.json", async () => {
  const stripped = { ...LIVE_DID, verificationMethod: [] };
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, "https://credentials.andamio.io/.well-known/did.json": stripped }),
      retryDelaysMs: [],
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /no verificationMethod/.test(e.message),
  );
});

test("unreachable static host: falls back to the BUNDLED did.json (lockstep CI artifact), still key-checked", async () => {
  const failing = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  const { didSource } = await runStartupDriftCheck({
    verificationMethodId: VM_ID,
    getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
    fetchImpl: failing,
    retryDelaysMs: [],
    bundledDidDocument: LIVE_DID,
    bundledAndamioContext: COMMITTED_CTX,
    log: () => {},
  });
  assert.equal(didSource, "bundled");
});

test("unreachable static host + mismatched bundled key STILL refuses (fail closed everywhere)", async () => {
  const rogue = makeEphemeralSigner();
  const failing = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => rogue.publicKeyMultibase,
      fetchImpl: failing,
      retryDelaysMs: [],
      bundledDidDocument: LIVE_DID,
      bundledAndamioContext: COMMITTED_CTX,
      log: () => {},
    }),
    (e: any) => e instanceof DriftError,
  );
});

test("REFUSES when the live Andamio context drifts from the committed bytes", async () => {
  const drifted = structuredClone(COMMITTED_CTX);
  drifted["@context"]._driftedTerm = "https://example.com/never";
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, "https://credentials.andamio.io/context/v0.jsonld": drifted }),
      retryDelaysMs: [],
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /drifted from the bundled committed context/.test(e.message),
  );
});

test("the committed .well-known/did.json in this repo pins the same key as the recorded live did.json", async () => {
  // Lockstep sanity: the bundled fallback the image bakes (the repo's
  // committed did.json) must be the same key the live host serves.
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const committed = JSON.parse(
    readFileSync(path.join(here, "..", "..", ".well-known", "did.json"), "utf8"),
  );
  const vm = committed.verificationMethod.find((m: any) => m.id === VM_ID);
  assert.equal(vm.publicKeyMultibase, LIVE_MULTIBASE);
});
