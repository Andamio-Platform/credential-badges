// Closed, allowlisted JSON-LD document loader — the deployment plan's
// "production document loader is closed and build-time-pinned" decision.
// Origin: spike/signer-spike/document-loader.ts (Rung 8 hardened), adapted
// from a per-run CLI to a long-running service:
//
//   - The W3C/OB3/security contexts are VENDORED into the image
//     (issuer-service/contexts/, integrity-pinned by contexts/manifest.json,
//     verified at load) — no network fetch at request time, ever. The spike's
//     disk cache + clearContextCache dance is replaced by build-time pinning.
//   - The Andamio context is served from the COMMITTED repo bytes
//     (context/v1.jsonld, baked into the image). The live-host drift check
//     the spike ran per-invocation moves to the service's STARTUP checks
//     (drift-check.ts) — a long-running service must not make the static
//     host a per-request availability dependency of the signing path.
//   - The did:web document is PINNED AT BOOT: the startup drift check fetches
//     the live did.json, verifies the active key, and hands the verified
//     document here. Request-time resolution serves those verified bytes.
//   - Anything else is refused. No network fallthrough exists in this module
//     at all: it performs ZERO fetches.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ISSUER_DID, ANDAMIO_CONTEXT_URL } from "./config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTEXTS_DIR = path.join(HERE, "..", "contexts");
const MANIFEST_FILE = path.join(CONTEXTS_DIR, "manifest.json");
// Dockerfile bakes the repo's committed context/v1.jsonld at the same
// relative location as in the repo checkout.
const REPO_CONTEXT_FILE = path.join(HERE, "..", "..", "context", "v1.jsonld");

export type DocumentLoader = (url: string) => Promise<{
  contextUrl: null;
  documentUrl: string;
  document: any;
}>;

/** Vendored contexts, integrity-verified against the manifest. Throws loudly
 *  on any hash mismatch — a tampered vendored context must never be served
 *  into canonicalization. */
export function loadVendoredContexts(): Map<string, any> {
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
  const out = new Map<string, any>();
  for (const [url, entry] of Object.entries<any>(manifest.contexts)) {
    const file = path.join(CONTEXTS_DIR, entry.file);
    const bytes = readFileSync(file, "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(
        `vendored context ${entry.file} sha256 ${sha256} != manifest pin ${entry.sha256} — refusing to serve a tampered context`,
      );
    }
    out.set(url, JSON.parse(bytes));
  }
  return out;
}

export function loadCommittedAndamioContext(file: string = REPO_CONTEXT_FILE): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

export interface LoaderOpts {
  /** The boot-verified did:web document (from the startup drift check). */
  didDocument: any;
  /** Extra verificationMethod / controller documents — the ephemeral-signer
   *  seam for tests and local runs. */
  overrides?: Record<string, any>;
  /** Test seam for the committed Andamio context. */
  andamioContext?: any;
}

export function makeDocumentLoader(opts: LoaderOpts): DocumentLoader {
  const vendored = loadVendoredContexts();
  const andamioContext = opts.andamioContext ?? loadCommittedAndamioContext();
  const overrides = opts.overrides ?? {};

  return async (url: string) => {
    if (overrides[url]) {
      return { contextUrl: null, documentUrl: url, document: overrides[url] };
    }

    if (url === ISSUER_DID || url.startsWith(`${ISSUER_DID}#`)) {
      const didDoc = opts.didDocument;
      if (url === ISSUER_DID) {
        return { contextUrl: null, documentUrl: url, document: didDoc };
      }
      const vm = (didDoc.verificationMethod ?? []).find((m: any) => m.id === url);
      if (!vm) throw new Error(`verificationMethod not found in boot-pinned did.json: ${url}`);
      return {
        contextUrl: null,
        documentUrl: url,
        document: { "@context": "https://w3id.org/security/multikey/v1", ...vm },
      };
    }

    if (url === ANDAMIO_CONTEXT_URL) {
      return { contextUrl: null, documentUrl: url, document: andamioContext };
    }

    if (vendored.has(url)) {
      return { contextUrl: null, documentUrl: url, document: vendored.get(url) };
    }

    throw new Error(`documentLoader refused (not in allowlist): ${url}`);
  };
}
