// Startup drift-check tests — the fail-closed boot gate (deployment plan
// Decision 4 / P1-06). Hermetic: injected fetch, injected key material. The
// live-did fixture is the REAL production did.json recorded 2026-07-21.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { runStartupDriftCheck, DriftError } from "../src/drift-check.ts";
import { loadCommittedAndamioContext } from "../src/document-loader.ts";
import { decodeStatusList } from "../src/status-list.ts";
import { makeEphemeralSigner } from "../src/signer.ts";
import { fixture } from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DID = fixture("live-did.json");
const VM_ID = "did:web:credentials.andamio.io#key-2026-07";
const LIVE_MULTIBASE: string = LIVE_DID.verificationMethod[0].publicKeyMultibase;
const COMMITTED_CTX = loadCommittedAndamioContext();
const COMMITTED_STATUS = JSON.parse(
  readFileSync(path.join(HERE, "..", "..", "status", "key-epoch-2026-07.json"), "utf8"),
);

/** The committed status list with the active key's bit (position 0) FLIPPED
 *  to suspended — same list length, MSB-first bit order. */
function suspendedStatusList(): any {
  const bits = decodeStatusList(COMMITTED_STATUS.credentialSubject.encodedList);
  bits[0] |= 0b1000_0000; // W3C: bit position 0 = MSB of byte 0
  const flipped = structuredClone(COMMITTED_STATUS);
  flipped.credentialSubject.encodedList =
    "u" + gzipSync(bits).toString("base64url");
  return flipped;
}

// Map values: a plain object is served as 200 JSON; a number is served as a
// bodyless HTTP status (for 4xx/5xx classification tests).
function fetchServing(map: Record<string, any>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url in map) {
      const v = map[url];
      if (typeof v === "number") return new Response(`HTTP ${v}`, { status: v });
      return new Response(JSON.stringify(v), { status: 200 });
    }
    throw new Error(`drift-check test fetch: unmocked ${url}`);
  }) as typeof fetch;
}

const DID_URL = "https://credentials.andamio.io/.well-known/did.json";
const CTX_URL = "https://credentials.andamio.io/context/v1.jsonld";
const STATUS_URL = "https://credentials.andamio.io/status/key-epoch-2026-07.json";

const LIVE_URLS = {
  [DID_URL]: LIVE_DID,
  [CTX_URL]: COMMITTED_CTX,
  [STATUS_URL]: COMMITTED_STATUS,
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
    bundledStatusListCredential: COMMITTED_STATUS,
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
      bundledStatusListCredential: COMMITTED_STATUS,
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
      fetchImpl: fetchServing({ ...LIVE_URLS, "https://credentials.andamio.io/context/v1.jsonld": drifted }),
      retryDelaysMs: [],
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /drifted from the bundled committed context/.test(e.message),
  );
});

// --- F3: 4xx is DRIFT (a broken static deploy), never the bundled fallback ---

test("REFUSES on HTTP 404 for the live did.json: the host answering without the artifact is drift, not unreachability", async () => {
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, [DID_URL]: 404 }),
      retryDelaysMs: [],
      bundledDidDocument: LIVE_DID, // a valid bundled copy must NOT rescue a 404
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /HTTP 404/.test(e.message) && /Refusing to start/.test(e.message),
  );
});

test("REFUSES on HTTP 404 for the live context (same 4xx-is-drift classification)", async () => {
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, [CTX_URL]: 404 }),
      retryDelaysMs: [],
      bundledAndamioContext: COMMITTED_CTX,
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /HTTP 404/.test(e.message),
  );
});

test("4xx is not retried: exactly one attempt is made before refusing", async () => {
  let attempts = 0;
  const counting = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === DID_URL) {
      attempts += 1;
      return new Response("gone", { status: 404 });
    }
    return new Response(JSON.stringify((LIVE_URLS as any)[url]), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: counting,
      retryDelaysMs: [0, 0, 0],
      log: () => {},
    }),
    (e: any) => e instanceof DriftError,
  );
  assert.equal(attempts, 1, "a 4xx must refuse immediately, not burn the retry schedule");
});

test("5xx still retries then falls back to the bundled artifacts (unreachability semantics)", async () => {
  const { didSource } = await runStartupDriftCheck({
    verificationMethodId: VM_ID,
    getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
    fetchImpl: fetchServing({ [DID_URL]: 503, [CTX_URL]: 503, [STATUS_URL]: 503 }),
    retryDelaysMs: [0],
    bundledDidDocument: LIVE_DID,
    bundledAndamioContext: COMMITTED_CTX,
    bundledStatusListCredential: COMMITTED_STATUS,
    log: () => {},
  });
  assert.equal(didSource, "bundled");
});

// --- F2: the status list is the third lockstep boot-checked artifact ---

test("REFUSES on HTTP 404 for the live status list", async () => {
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, [STATUS_URL]: 404 }),
      retryDelaysMs: [],
      bundledStatusListCredential: COMMITTED_STATUS,
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /HTTP 404/.test(e.message),
  );
});

test("REFUSES when the live status list drifts from the bundled committed copy", async () => {
  const drifted = structuredClone(COMMITTED_STATUS);
  drifted.validFrom = "2026-07-02T00:00:00Z";
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: fetchServing({ ...LIVE_URLS, [STATUS_URL]: drifted }),
      retryDelaysMs: [],
      bundledStatusListCredential: COMMITTED_STATUS,
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /drifted from the bundled committed status list/.test(e.message),
  );
});

test("REFUSES when the active key version's own status bit reads SUSPENDED", async () => {
  const suspended = suspendedStatusList();
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      // Live and bundled agree (both suspended): the byte-compare passes,
      // the freshness check is what must refuse.
      fetchImpl: fetchServing({ ...LIVE_URLS, [STATUS_URL]: suspended }),
      retryDelaysMs: [],
      bundledStatusListCredential: suspended,
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /SUSPENDED/.test(e.message),
  );
});

test("REFUSES a suspended bundled list even when the static host is unreachable (fallback path is freshness-checked too)", async () => {
  const failing = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  await assert.rejects(
    runStartupDriftCheck({
      verificationMethodId: VM_ID,
      getOwnPublicKeyMultibase: async () => LIVE_MULTIBASE,
      fetchImpl: failing,
      retryDelaysMs: [],
      bundledDidDocument: LIVE_DID,
      bundledAndamioContext: COMMITTED_CTX,
      bundledStatusListCredential: suspendedStatusList(),
      log: () => {},
    }),
    (e: any) => e instanceof DriftError && /SUSPENDED/.test(e.message),
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
