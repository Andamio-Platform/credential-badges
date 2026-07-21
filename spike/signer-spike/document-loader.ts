// Rung 6 · Closed, allowlisted JSON-LD document loader (production surfaces).
//
// Serves exactly what canonicalization and verification need — the W3C/OB3
// contexts (network-cached under out/ctx-cache), the LIVE production Andamio
// context, and the LIVE production did:web document — and refuses anything
// else. Mirrors the deployment plan's "production document loader is closed"
// decision at spike scale.
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
  const res = await fetch(url, {
    headers: { accept: "application/ld+json, application/json" },
  });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const doc = await res.json();
  await fs.writeFile(cacheFile, JSON.stringify(doc), "utf8");
  return doc;
}

let liveContextChecked = false;

async function liveAndamioContext(): Promise<any> {
  const doc = await fetchCached(ANDAMIO_CONTEXT_URL);
  if (!liveContextChecked) {
    const repo = JSON.parse(await fs.readFile(REPO_CONTEXT_FILE, "utf8"));
    if (JSON.stringify(doc) !== JSON.stringify(repo)) {
      throw new Error(
        `live ${ANDAMIO_CONTEXT_URL} drifted from committed context/v0.jsonld — refusing to canonicalize`,
      );
    }
    liveContextChecked = true;
  }
  return doc;
}

export async function fetchLiveDidDocument(): Promise<any> {
  return fetchCached(DID_JSON_URL);
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
