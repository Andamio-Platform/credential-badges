// Rung 6 · Closed, allowlisted JSON-LD document loader (production surfaces).
// Rung 8 hardening (issue #54, finding 2): the LIVE guarantees are now
// actually live.
//
// Serves exactly what canonicalization and verification need — the W3C/OB3
// contexts (network-cached under out/ctx-cache), the LIVE production Andamio
// context, and the LIVE production did:web document — and refuses anything
// else. Mirrors the deployment plan's "production document loader is closed"
// decision at spike scale.
//
// Live-vs-cached split (the finding-2 fix):
//   - `fetchLiveDidDocument` (feeds the KMS key pin, in-sign did:web
//     resolution, and post-sign verification) NEVER touches the disk cache —
//     every call is a network fetch. A stale or poisoned out/ctx-cache entry
//     cannot satisfy the key pin, and a key rotation is visible in-process.
//   - The context-drift guard fetches the live Andamio context over the
//     network on first use (never from disk), deep-compares it against the
//     committed context/v0.jsonld, and only then serves it (memoized
//     IN-PROCESS — the memo is the live bytes fetched this run).
//   - Only the version-pinned, immutable W3C/OB3 contexts go through the disk
//     cache — and `clearContextCache()` lets a KMS run start from an empty
//     cache so even those are fetched fresh (sign.ts calls it in kms mode).
//
// Integrity guard: the live context fetched from credentials.andamio.io must
// deep-equal the repo's committed context/v0.jsonld. Signing under a drifted
// context would produce a signature third parties cannot reproduce; the loader
// makes that a loud failure instead.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CTX_CACHE = path.join(HERE, "out", "ctx-cache");
const REPO_CONTEXT_FILE = path.join(HERE, "..", "..", "context", "v0.jsonld");

export const ISSUER_DID = "did:web:credentials.andamio.io";
export const DID_JSON_URL = "https://credentials.andamio.io/.well-known/did.json";
export const ANDAMIO_CONTEXT_URL = "https://credentials.andamio.io/context/v0.jsonld";

const WEB_CONTEXTS = new Set([
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://w3id.org/security/multikey/v1",
  "https://w3id.org/security/data-integrity/v2",
  "https://www.w3.org/ns/did/v1",
]);

export type DocumentLoader = (url: string) => Promise<{
  contextUrl: null;
  documentUrl: string;
  document: any;
}>;

// Always-network fetch. The trust-critical documents (did.json, the Andamio
// context) come through here and ONLY here — no disk cache on this path.
async function fetchLiveJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/ld+json, application/json" },
  });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  return res.json();
}

// Disk-cached fetch — for the version-pinned, immutable W3C/OB3 contexts only.
async function fetchCached(url: string): Promise<any> {
  await fs.mkdir(CTX_CACHE, { recursive: true });
  const cacheFile = path.join(
    CTX_CACHE,
    url.replace(/[^a-zA-Z0-9]/g, "_") + ".json",
  );
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    /* fetch below */
  }
  const doc = await fetchLiveJson(url);
  await fs.writeFile(cacheFile, JSON.stringify(doc), "utf8");
  return doc;
}

// Removes the on-disk context cache entirely AND drops the in-process live-
// context memo. sign.ts calls this at the start of every `--signer kms` run,
// so a production signing run starts from a provably empty cache: every
// document it canonicalizes against — including the drift-checked Andamio
// context — is fetched fresh from the network.
export async function clearContextCache(): Promise<void> {
  checkedLiveContext = null;
  await fs.rm(CTX_CACHE, { recursive: true, force: true });
}

// In-process memo of the LIVE Andamio context — set only after the network
// fetch + drift check below. Never populated from disk.
let checkedLiveContext: any = null;

// True ONLY when `committed` differs from `live` by adding NEW top-level term
// keys inside "@context" — the Rung-4 "Option A" additive-evolution shape for
// the pre-stable v0 context. Everything else must be byte-identical:
//
//   - every key OUTSIDE "@context" must match exactly (no adds, no removals),
//   - every key live's "@context" already defines must be deep-equal in the
//     committed one — adding a key INSIDE an existing term's definition (e.g.
//     an "@type" on a term that had none) changes how EXISTING documents
//     expand, which is a mutation, not an addition. The earlier any-depth
//     recursion accepted exactly that; this version refuses it.
//
// Exported for the hermetic tests.
export function isAdditiveSuperset(committed: any, live: any): boolean {
  const isPlainObject = (v: any) =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isPlainObject(committed) || !isPlainObject(live)) return false;

  // Outside "@context": byte-identical, both directions.
  const allKeys = new Set([...Object.keys(committed), ...Object.keys(live)]);
  for (const k of allKeys) {
    if (k === "@context") continue;
    if (!(k in committed) || !(k in live)) return false;
    if (JSON.stringify(committed[k]) !== JSON.stringify(live[k])) return false;
  }

  const cc = committed["@context"];
  const lc = live["@context"];
  if (!isPlainObject(cc) || !isPlainObject(lc)) return false;

  // Every live term must exist in committed with a deep-equal definition;
  // committed may only ADD new term keys at this one level.
  return Object.keys(lc).every(
    (k) => k in cc && JSON.stringify(cc[k]) === JSON.stringify(lc[k]),
  );
}

async function liveAndamioContext(): Promise<any> {
  if (checkedLiveContext !== null) return checkedLiveContext;
  const doc = await fetchLiveJson(ANDAMIO_CONTEXT_URL);
  const repo = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
  if (JSON.stringify(doc) !== JSON.stringify(repo)) {
    // TRANSITIONAL, EXPLICITLY OPTED-IN (Rung 8.3): when this repo ADDS terms
    // to the pre-stable v0 context (P1bis-04 + the flat evidence dialect), the
    // committed context is briefly ahead of the live host — the deploy that
    // publishes it ships from this very branch. Under CONTEXT_AHEAD_OF_LIVE_OK=1
    // and ONLY when the committed context is a strict additive superset of the
    // live one (every live term byte-identical; committed only adds), the
    // loader serves the COMMITTED bytes so signing canonicalizes against the
    // context that will be live at deploy. Third parties can only reproduce
    // the signature after that deploy — the PR body carries the post-deploy
    // re-verification checklist. Any non-additive divergence still refuses,
    // env var or not; without the env var the strict equality gate is
    // unchanged.
    if (
      process.env.CONTEXT_AHEAD_OF_LIVE_OK === "1" &&
      isAdditiveSuperset(repo, doc)
    ) {
      console.warn(
        `context-drift guard: committed context/v0.jsonld is an ADDITIVE superset of live ${ANDAMIO_CONTEXT_URL} — serving COMMITTED bytes (CONTEXT_AHEAD_OF_LIVE_OK=1, pre-deploy transitional state; signature reproducible by third parties only after the deploy)`,
      );
      checkedLiveContext = repo;
      return repo;
    }
    throw new Error(
      `live ${ANDAMIO_CONTEXT_URL} drifted from committed context/v0.jsonld — refusing to canonicalize`,
    );
  }
  checkedLiveContext = doc;
  return doc;
}

// LIVE did:web document — network on every call, never the disk cache. This
// feeds the KMS key pin, in-sign did:web resolution, and post-sign
// verification, so all three see the network's current truth.
export async function fetchLiveDidDocument(): Promise<any> {
  return fetchLiveJson(DID_JSON_URL);
}

// `localKeyOverrides` (loopback-signer mode only) maps a verificationMethod id
// to a Multikey document, bypassing did:web resolution for the ephemeral key.
export function makeDocumentLoader(
  localKeyOverrides: Record<string, any> = {},
): DocumentLoader {
  return async (url: string) => {
    if (localKeyOverrides[url]) {
      return { contextUrl: null, documentUrl: url, document: localKeyOverrides[url] };
    }

    if (url === ISSUER_DID || url.startsWith(`${ISSUER_DID}#`)) {
      const didDoc = await fetchLiveDidDocument();
      if (url === ISSUER_DID) {
        return { contextUrl: null, documentUrl: url, document: didDoc };
      }
      const vm = (didDoc.verificationMethod ?? []).find((m: any) => m.id === url);
      if (!vm) throw new Error(`verificationMethod not found in live did.json: ${url}`);
      return {
        contextUrl: null,
        documentUrl: url,
        document: { "@context": "https://w3id.org/security/multikey/v1", ...vm },
      };
    }

    if (url === ANDAMIO_CONTEXT_URL) {
      return {
        contextUrl: null,
        documentUrl: url,
        document: await liveAndamioContext(),
      };
    }

    if (WEB_CONTEXTS.has(url)) {
      return { contextUrl: null, documentUrl: url, document: await fetchCached(url) };
    }

    throw new Error(`documentLoader refused (not in allowlist): ${url}`);
  };
}
