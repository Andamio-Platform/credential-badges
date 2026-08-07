// Rung 8 · Document-loader LIVE-guarantee tests (issue #54, finding 2).
//
// Proves that a poisoned or stale out/ctx-cache entry can NEVER satisfy the
// key pin or the context-drift guard: the trust-critical fetches
// (did.json, the Andamio context) go to the network every time. Hermetic —
// `fetch` is mocked; no real network, no npm install (node builtins only).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  makeDocumentLoader,
  fetchLiveDidDocument,
  clearContextCache,
  isAdditiveSuperset,
  DID_JSON_URL,
  ANDAMIO_CONTEXT_URL,
  ISSUER_DID,
} from "./document-loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CTX_CACHE = path.join(HERE, "out", "ctx-cache");
const REPO_CONTEXT_FILE = path.join(HERE, "..", "..", "context", "v1.jsonld");

const VM_ID = `${ISSUER_DID}#key-2026-07`;

// The doc the mocked NETWORK serves — stands in for the live did.json.
const LIVE_DID_DOC = {
  "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
  id: ISSUER_DID,
  verificationMethod: [
    {
      id: VM_ID,
      type: "Multikey",
      controller: ISSUER_DID,
      publicKeyMultibase: "zLIVE-KEY-FROM-NETWORK",
    },
  ],
  assertionMethod: [VM_ID],
};

// A poisoned/stale cache entry claiming a DIFFERENT (e.g. pre-rotation) key.
const POISONED_DID_DOC = {
  ...LIVE_DID_DOC,
  verificationMethod: [
    { ...LIVE_DID_DOC.verificationMethod[0], publicKeyMultibase: "zPOISONED-STALE-KEY" },
  ],
};

function cacheFileFor(url: string): string {
  return path.join(CTX_CACHE, url.replace(/[^a-zA-Z0-9]/g, "_") + ".json");
}

async function poisonCache(url: string, doc: any): Promise<void> {
  await fs.mkdir(CTX_CACHE, { recursive: true });
  await fs.writeFile(cacheFileFor(url), JSON.stringify(doc), "utf8");
}

const realFetch = globalThis.fetch;
let fetchLog: string[] = [];

function mockFetch(routes: Record<string, any>): void {
  fetchLog = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    fetchLog.push(url);
    if (url in routes) {
      return new Response(JSON.stringify(routes[url]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

beforeEach(async () => {
  await clearContextCache();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await clearContextCache();
});

test("a poisoned cache entry cannot satisfy the key pin: fetchLiveDidDocument returns the NETWORK doc", async () => {
  await poisonCache(DID_JSON_URL, POISONED_DID_DOC);
  mockFetch({ [DID_JSON_URL]: LIVE_DID_DOC });

  const doc = await fetchLiveDidDocument();

  assert.equal(fetchLog.filter((u) => u === DID_JSON_URL).length, 1, "did.json must be fetched from the network");
  assert.equal(doc.verificationMethod[0].publicKeyMultibase, "zLIVE-KEY-FROM-NETWORK");
  assert.notEqual(doc.verificationMethod[0].publicKeyMultibase, "zPOISONED-STALE-KEY");
});

test("every call to fetchLiveDidDocument hits the network — a rotation is visible in-process", async () => {
  mockFetch({ [DID_JSON_URL]: LIVE_DID_DOC });
  await fetchLiveDidDocument();
  await fetchLiveDidDocument();
  assert.equal(
    fetchLog.filter((u) => u === DID_JSON_URL).length,
    2,
    "each key-pin/verify read must be a fresh network fetch",
  );
});

test("document loader resolves the issuer verificationMethod from the NETWORK, not a poisoned cache", async () => {
  await poisonCache(DID_JSON_URL, POISONED_DID_DOC);
  mockFetch({ [DID_JSON_URL]: LIVE_DID_DOC });

  const loader = makeDocumentLoader();
  const { document } = await loader(VM_ID);

  assert.equal(document.publicKeyMultibase, "zLIVE-KEY-FROM-NETWORK");
});

test("context-drift guard reads the NETWORK: a clean-looking cache entry cannot mask a drifted live context", async () => {
  // Stale-but-clean cache: byte-equal to the committed repo context. Under the
  // old cache-first loader this would satisfy the drift guard even after the
  // live host drifted. It must not.
  const repoContext = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
  await poisonCache(ANDAMIO_CONTEXT_URL, repoContext);

  const driftedLiveContext = { "@context": { drifted: "https://example.com/drifted#" } };
  mockFetch({ [ANDAMIO_CONTEXT_URL]: driftedLiveContext });

  const loader = makeDocumentLoader();
  await assert.rejects(
    () => loader(ANDAMIO_CONTEXT_URL),
    /drifted from committed context\/v1\.jsonld/,
    "the drift guard must see the live (drifted) context, not the stale cache copy",
  );
});

test("clearContextCache removes the on-disk cache directory", async () => {
  await poisonCache(DID_JSON_URL, POISONED_DID_DOC);
  await clearContextCache();
  await assert.rejects(() => fs.access(CTX_CACHE));
});

// ---- Rung 8.3: the CONTEXT_AHEAD_OF_LIVE_OK transitional gate ----

// A stand-in "live" context that is the committed one MINUS one added term —
// i.e. the exact pre-deploy state after an additive context PR.
async function liveSubsetOfCommitted(): Promise<any> {
  const repo = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
  const live = structuredClone(repo);
  const keys = Object.keys(live["@context"]);
  delete live["@context"][keys[keys.length - 1]];
  return live;
}

test("without the env var, an additively-behind live context still REFUSES (default unchanged)", async () => {
  delete process.env.CONTEXT_AHEAD_OF_LIVE_OK;
  mockFetch({ [ANDAMIO_CONTEXT_URL]: await liveSubsetOfCommitted() });
  const loader = makeDocumentLoader();
  await assert.rejects(
    () => loader(ANDAMIO_CONTEXT_URL),
    /drifted from committed context\/v1\.jsonld/,
  );
});

test("with CONTEXT_AHEAD_OF_LIVE_OK=1, an additive superset serves the COMMITTED bytes", async () => {
  process.env.CONTEXT_AHEAD_OF_LIVE_OK = "1";
  try {
    mockFetch({ [ANDAMIO_CONTEXT_URL]: await liveSubsetOfCommitted() });
    const loader = makeDocumentLoader();
    const { document } = await loader(ANDAMIO_CONTEXT_URL);
    const repo = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
    assert.deepEqual(document, repo, "must canonicalize against the committed (deploy-bound) context");
  } finally {
    delete process.env.CONTEXT_AHEAD_OF_LIVE_OK;
  }
});

test("with CONTEXT_AHEAD_OF_LIVE_OK=1, a NON-additive divergence still refuses", async () => {
  process.env.CONTEXT_AHEAD_OF_LIVE_OK = "1";
  try {
    const live = await liveSubsetOfCommitted();
    live["@context"]["andamio"] = "https://evil.example.com/ns#"; // mutated live term
    mockFetch({ [ANDAMIO_CONTEXT_URL]: live });
    const loader = makeDocumentLoader();
    await assert.rejects(
      () => loader(ANDAMIO_CONTEXT_URL),
      /drifted from committed context\/v1\.jsonld/,
      "a live term the committed context does not carry byte-identically must refuse",
    );
  } finally {
    delete process.env.CONTEXT_AHEAD_OF_LIVE_OK;
  }
});

test("isAdditiveSuperset: only NEW top-level '@context' terms pass; everything else must be byte-identical", () => {
  const live = {
    "@context": {
      "@version": 1.1,
      "@protected": true,
      andamio: "https://credentials.andamio.io/ns#",
      courseOwner: { "@id": "andamio:courseOwner", "@type": "@id" },
    },
  };

  // Adding a brand-new term key at the "@context" top level: additive.
  const addsTerm = structuredClone(live);
  (addsTerm["@context"] as any).network = { "@id": "andamio:network" };
  assert.equal(isAdditiveSuperset(addsTerm, live), true);

  // Identical documents are trivially an additive superset.
  assert.equal(isAdditiveSuperset(structuredClone(live), live), true);

  // Adding a key INSIDE an existing term's definition mutates how existing
  // documents expand — REFUSED (the ADV-2 case the old any-depth recursion
  // wrongly accepted).
  const mutatesInsideTerm = structuredClone(live);
  (mutatesInsideTerm["@context"] as any).courseOwner["@container"] = "@set";
  assert.equal(isAdditiveSuperset(mutatesInsideTerm, live), false);

  // Mutating an existing term's value: refused.
  const mutatesValue = structuredClone(live);
  (mutatesValue["@context"] as any).andamio = "https://evil.example.com/ns#";
  assert.equal(isAdditiveSuperset(mutatesValue, live), false);

  // Removing a live term: refused.
  const removesTerm = structuredClone(live);
  delete (removesTerm["@context"] as any).courseOwner;
  assert.equal(isAdditiveSuperset(removesTerm, live), false);

  // Adding a key OUTSIDE "@context": refused (only @context terms may grow).
  const addsTopLevel = structuredClone(live) as any;
  addsTopLevel.extra = 1;
  assert.equal(isAdditiveSuperset(addsTopLevel, live), false);

  // Non-object shapes are never additive supersets.
  assert.equal(isAdditiveSuperset([1], live), false);
  assert.equal(isAdditiveSuperset({ "@context": [1] }, live), false);
});

test("the transitional gate REFUSES a live term mutated by an ADDED key inside its definition", async () => {
  process.env.CONTEXT_AHEAD_OF_LIVE_OK = "1";
  try {
    // Live serves the committed context PLUS an extra key inside an existing
    // term's definition — committed is NOT a superset of it, and serving the
    // committed bytes would canonicalize differently than live verifiers do.
    const repo = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
    const live = structuredClone(repo);
    live["@context"].courseOwner = {
      ...live["@context"].courseOwner,
      "@container": "@set",
    };
    mockFetch({ [ANDAMIO_CONTEXT_URL]: live });
    const loader = makeDocumentLoader();
    await assert.rejects(
      () => loader(ANDAMIO_CONTEXT_URL),
      /drifted from committed context\/v1\.jsonld/,
    );
  } finally {
    delete process.env.CONTEXT_AHEAD_OF_LIVE_OK;
  }
});

test("loader still refuses anything outside the allowlist", async () => {
  mockFetch({});
  const loader = makeDocumentLoader();
  await assert.rejects(
    () => loader("https://evil.example.com/context.jsonld"),
    /documentLoader refused/,
  );
});
