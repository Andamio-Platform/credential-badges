// Startup drift check (deployment plan Decision 4, refined per P1-06) — the
// fail-closed boot gate. The service REFUSES to open its listener unless the
// signing identity it is configured with is provably the identity the world
// resolves:
//
//   1. ACTIVE KEY VERSION IS IN THE REGISTRY: the active key version must
//      have a bit position in the compiled-in key-version registry —
//      otherwise the emitted credentialStatus.statusListIndex would be a
//      silent semantic error (plan: "converts a silent semantic error into a
//      loud startup failure").
//   2. LIVE did.json CARRIES THE ACTIVE KEY: fetch the live
//      https://credentials.andamio.io/.well-known/did.json with bounded
//      retry (5 attempts, exponential backoff, ~50s total). The active
//      verificationMethod fragment must be present with a publicKeyMultibase
//      byte-equal to the SIGNER'S OWN public key (KMS getPublicKey in
//      production). Present-but-mismatched => genuine drift => REFUSE TO
//      START, fail loud.
//   3. UNREACHABLE-HOST FALLBACK: if the live fetch fails after all retries,
//      the BUNDLED did.json (the repo's committed .well-known/did.json, baked
//      into this image by the same repo state that deploys the static host)
//      is the authoritative reference for this boot — drift is not silently
//      accepted, the reference is the lockstep CI artifact. A loud warning is
//      logged so operators see the unreachable-static-host condition.
//   4. COMMITTED-CONTEXT LIVENESS: the live context/v0.jsonld must equal the
//      bundled committed context (signing under a drifted context produces
//      signatures third parties cannot reproduce). Same bounded retry + same
//      bundled fallback semantics.
//
// The check returns the VERIFIED did.json document, which becomes the closed
// document loader's boot-pinned did:web resolution for the life of the
// process.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DID_JSON_URL,
  ANDAMIO_CONTEXT_URL,
} from "./config.ts";
import {
  ACTIVE_KEY_VERSION,
  KEY_VERSION_POSITIONS,
} from "./status-list.ts";
import { loadCommittedAndamioContext } from "./document-loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Dockerfile bakes the repo's committed .well-known/did.json at the same
// relative location as in the repo checkout.
const BUNDLED_DID_FILE = path.join(HERE, "..", "..", ".well-known", "did.json");

export const RETRY_DELAYS_MS = [200, 1_000, 5_000, 15_000, 30_000];

export class DriftError extends Error {}

export interface DriftCheckDeps {
  /** The active verificationMethod id (fixed server-side constant). */
  verificationMethodId: string;
  /** The signer's own public key, multibase — KMS getPublicKey in production,
   *  the ephemeral key in ephemeral mode. */
  getOwnPublicKeyMultibase(): Promise<string>;
  fetchImpl?: typeof fetch;
  /** Test seam: override the retry schedule. */
  retryDelaysMs?: number[];
  /** Test seams for the bundled reference artifacts. */
  bundledDidDocument?: any;
  bundledAndamioContext?: any;
  log?: (msg: string) => void;
}

async function fetchJsonWithRetry(
  url: string,
  fetchImpl: typeof fetch,
  delays: number[],
  log: (msg: string) => void,
): Promise<any | null> {
  for (let i = 0; i <= delays.length; i++) {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/ld+json, application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === delays.length) {
        log(`startup drift check: GET ${url} failed after ${i + 1} attempts: ${(e as Error).message}`);
        return null;
      }
      log(`startup drift check: GET ${url} attempt ${i + 1} failed (${(e as Error).message}); retrying in ${delays[i]}ms`);
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  return null;
}

function assertKeyPinned(didDoc: any, vmId: string, ownMultibase: string, source: string): void {
  const vm = (didDoc?.verificationMethod ?? []).find((m: any) => m.id === vmId);
  if (!vm) {
    throw new DriftError(
      `${source} did.json has no verificationMethod ${vmId} — refusing to serve signing endpoints`,
    );
  }
  if (vm.publicKeyMultibase !== ownMultibase) {
    throw new DriftError(
      `signer public key ${ownMultibase} != ${source} did.json pin ${vm.publicKeyMultibase} for ${vmId} — refusing to serve signing endpoints (genuine drift: fail closed)`,
    );
  }
}

/** Runs all startup checks; returns the verified did.json to pin for the
 *  life of the process. Throws DriftError on any mismatch (fail closed). */
export async function runStartupDriftCheck(deps: DriftCheckDeps): Promise<{
  didDocument: any;
  didSource: "live" | "bundled";
}> {
  const log = deps.log ?? ((m) => console.error(m));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;

  // 1. Active key version is in the compiled-in registry.
  if (!(ACTIVE_KEY_VERSION in KEY_VERSION_POSITIONS)) {
    throw new DriftError(
      `active key version ${ACTIVE_KEY_VERSION} has no bit position in the key-version registry — refusing to start`,
    );
  }

  const ownMultibase = await deps.getOwnPublicKeyMultibase();

  // 2/3. Live did.json (bounded retry), bundled fallback when unreachable.
  const liveDid = await fetchJsonWithRetry(DID_JSON_URL, fetchImpl, delays, log);
  let didDocument: any;
  let didSource: "live" | "bundled";
  if (liveDid !== null) {
    assertKeyPinned(liveDid, deps.verificationMethodId, ownMultibase, "live");
    didDocument = liveDid;
    didSource = "live";
  } else {
    didDocument =
      deps.bundledDidDocument ?? JSON.parse(readFileSync(BUNDLED_DID_FILE, "utf8"));
    assertKeyPinned(didDocument, deps.verificationMethodId, ownMultibase, "bundled");
    didSource = "bundled";
    log(
      `startup drift check WARNING: live ${DID_JSON_URL} unreachable — starting against the BUNDLED did.json (lockstep CI artifact). Investigate the static host.`,
    );
  }

  // 4. Committed-context liveness: the live context must equal the bundled
  // committed bytes; unreachable falls back to the bundled copy (which the
  // closed loader serves regardless — this check exists to make live drift a
  // loud boot failure instead of an unreproducible-signature incident).
  const committedCtx = deps.bundledAndamioContext ?? loadCommittedAndamioContext();
  const liveCtx = await fetchJsonWithRetry(ANDAMIO_CONTEXT_URL, fetchImpl, delays, log);
  if (liveCtx !== null) {
    if (JSON.stringify(liveCtx) !== JSON.stringify(committedCtx)) {
      throw new DriftError(
        `live ${ANDAMIO_CONTEXT_URL} drifted from the bundled committed context/v0.jsonld — refusing to start (signatures would not be third-party reproducible)`,
      );
    }
  } else {
    log(
      `startup drift check WARNING: live ${ANDAMIO_CONTEXT_URL} unreachable — canonicalizing against the bundled committed context (the bytes the static host deploys).`,
    );
  }

  return { didDocument, didSource };
}
