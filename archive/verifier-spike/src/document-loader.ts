import { promises as fs } from "node:fs";
import path from "node:path";

import { DID, BASE_URL, STATUS_LIST_URL } from "./did-web.js";
import { SPIKE_CONTEXT_URL } from "./context.js";

export type DocumentLoader = (url: string) => Promise<{
  contextUrl: null;
  documentUrl: string;
  document: any;
}>;

const ROOT = process.cwd();
const PUBLISH = path.join(ROOT, "publish");
const CTX_CACHE = path.join(ROOT, "out", "ctx-cache");

const WEB_CONTEXTS = new Set([
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://w3id.org/security/multikey/v1",
  "https://w3id.org/security/data-integrity/v2",
  "https://www.w3.org/ns/did/v1",
]);

async function fetchCached(url: string): Promise<any> {
  await fs.mkdir(CTX_CACHE, { recursive: true });
  const cacheFile = path.join(CTX_CACHE, url.replace(/[^a-zA-Z0-9]/g, "_") + ".json");
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch {
    /* fetch */
  }
  const res = await fetch(url, {
    headers: { accept: "application/ld+json, application/json" },
  });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const doc = await res.json();
  await fs.writeFile(cacheFile, JSON.stringify(doc), "utf8");
  return doc;
}

async function readPublish(relativePath: string): Promise<any> {
  const file = path.join(PUBLISH, relativePath);
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export const localDocumentLoader: DocumentLoader = async (url) => {
  // did:web — resolve to the locally-written did.json (publish/did.json), then to
  // the verificationMethod fragment if a # was included.
  if (url === DID || url.startsWith(`${DID}#`)) {
    const didDoc = await readPublish("did.json");
    if (url === DID) {
      return { contextUrl: null, documentUrl: url, document: didDoc };
    }
    const vm = didDoc.verificationMethod.find((m: any) => m.id === url);
    if (!vm) throw new Error(`verificationMethod not found in did.json: ${url}`);
    return {
      contextUrl: null,
      documentUrl: url,
      document: { "@context": "https://w3id.org/security/multikey/v1", ...vm },
    };
  }

  if (url === SPIKE_CONTEXT_URL) {
    return {
      contextUrl: null,
      documentUrl: url,
      document: await readPublish("context/v0.jsonld"),
    };
  }

  if (url === STATUS_LIST_URL) {
    return {
      contextUrl: null,
      documentUrl: url,
      document: await readPublish("status/key-epoch-2026-05.json"),
    };
  }

  if (WEB_CONTEXTS.has(url)) {
    return { contextUrl: null, documentUrl: url, document: await fetchCached(url) };
  }

  // Anything starting with the BASE_URL is a published artifact — fall through to publish/.
  if (url.startsWith(BASE_URL + "/")) {
    const rel = url.slice(BASE_URL.length + 1);
    return { contextUrl: null, documentUrl: url, document: await readPublish(rel) };
  }

  throw new Error(`documentLoader refused (not in allowlist): ${url}`);
};
