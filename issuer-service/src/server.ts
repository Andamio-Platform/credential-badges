// HTTP surface: GET /credentials/{network}/{policyId}/{sltHash}/{recipient}
// (deployment plan Unit 4 route, verbatim) + /healthz for Cloud Run.
//
// Request flow (every step fail-closed):
//   validate params (400, zero upstream calls)
//     -> badge registry (404 before any chain read)
//     -> signed-artifact cache (a hit serves bytes with ZERO signer calls)
//     -> singleflight per cache key (concurrent first requests for the same
//        coordinate collapse onto ONE gate+sign run)
//     -> anchor gate (404 unknown-claim / 422 anchor-mismatch, zero KMS ops)
//     -> map (final dialect) -> sign (exactly once, asserted)
//     -> post-sign loopback verify (incl. status bit)
//     -> proof wrapped in array form (1EdTech Plain-JSON schema)
//     -> cache + serve application/ld+json
//
// Error contract:
//   400 invalid-params        (malformed path — no upstream call was made)
//   404 wrong-network         (valid network enum, not this deployment's)
//   404 unknown-badge         (not in the repo badge registry)
//   404 unknown-claim         (chain has nothing at this coordinate)
//   422 anchor-mismatch       (chain data CONFLICTS with the coordinate; the
//                              body says why — e.g. SLT text no longer hashes
//                              to the on-chain commitment)
//   502 signing-unavailable   (KMS/signing failure, including a signer-
//                              returned proof that fails the post-sign
//                              loopback verify — never a partial artifact)
//   503 upstream-unavailable  (Andamioscan / badge host unreachable)
//
// The service registers NO other public route (plan Unit 4: everything
// non-/credentials belongs to the static host). /healthz is the Cloud Run
// liveness endpoint only — the LB routes /credentials/* here and nothing else.

import http from "node:http";

import { KNOWN_NETWORKS, NETWORK } from "./config.ts";
import { lookupBadge } from "./badge-registry.ts";
import {
  checkAnchor,
  GateRefusal,
  UpstreamError,
  type FetchLike,
} from "./anchor.ts";
import { mapCredential } from "./map-credential.ts";
import { makeDocumentLoader } from "./document-loader.ts";
import { issueWith, verifyWith, makeCheckStatus } from "./issue.ts";
import { SigningError, type RawSigner } from "./signer.ts";
import { LayeredArtifactCache, artifactCacheKey } from "./cache.ts";
import { ACTIVE_KEY_VERSION } from "./status-list.ts";

const NETWORK_RE = /^[a-z]+$/;
const POLICY_ID_RE = /^[0-9a-f]{56}$/;
const SLT_HASH_RE = /^[0-9a-f]{64}$/;
// On-chain aliases observed: [A-Za-z0-9_]; keep the charset tight — the alias
// is interpolated into upstream URL paths (SSRF/path-injection surface).
const ALIAS_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface AppDeps {
  signer: RawSigner;
  /** Loader overrides for the ephemeral signer's DID material (tests/local). */
  signerOverrides?: Record<string, any>;
  /** Ephemeral mode only: controller DID substituted as issuer.id so the
   *  post-sign verify holds (issuer must equal the VM controller). NEVER set
   *  in kms mode — the production issuer DID is a fixed server-side constant. */
  issuerIdOverride?: string | null;
  /** Boot-pinned, drift-verified did.json. */
  didDocument: any;
  /** The served status list credential (committed repo bytes in production). */
  statusListCredential: any;
  fetchImpl: FetchLike;
  cache: LayeredArtifactCache;
  /** Test seams. */
  registryFile?: string;
  andamioContext?: any;
  log?: (msg: string) => void;
}

interface ErrorBody {
  error: string;
  reason: string;
}

function sendJson(res: http.ServerResponse, status: number, body: ErrorBody): void {
  const bytes = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, { "content-type": "application/json" });
  res.end(bytes);
}

function sendCredential(res: http.ServerResponse, artifact: string): void {
  res.writeHead(200, { "content-type": "application/ld+json" });
  res.end(artifact);
}

export function createRequestHandler(deps: AppDeps) {
  const log = deps.log ?? ((m: string) => console.error(m));
  const locatorCache = new Map<string, { txHash: string; slot: number }>();
  // Singleflight per cache key (tier-2 review F4): K concurrent first
  // requests for the same coordinate collapse onto ONE gate + sign run —
  // without it, a cold-cache stampede costs K KMS signs and K discovery
  // scans. Entries are removed as soon as the flight settles; a rejected
  // flight is shared with its waiters (each maps the error independently)
  // and the next request starts fresh.
  const inflight = new Map<string, Promise<string>>();
  const documentLoader = makeDocumentLoader({
    didDocument: deps.didDocument,
    overrides: deps.signerOverrides ?? {},
    andamioContext: deps.andamioContext,
  });
  const checkStatus = makeCheckStatus(deps.statusListCredential);

  return async function handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method-not-allowed", reason: "GET only" });
      return;
    }

    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }

    const m = pathname.match(/^\/credentials\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (!m) {
      sendJson(res, 404, {
        error: "not-found",
        reason: "this service serves GET /credentials/{network}/{policyId}/{sltHash}/{recipient} and /healthz only",
      });
      return;
    }
    const [, network, policyId, sltHash, recipient] = m;

    // Strict path-param validation BEFORE any chain call (plan Unit 4).
    if (!NETWORK_RE.test(network) || !POLICY_ID_RE.test(policyId) || !SLT_HASH_RE.test(sltHash) || !ALIAS_RE.test(recipient)) {
      sendJson(res, 400, {
        error: "invalid-params",
        reason: "expected /credentials/{network}/{56-hex policyId}/{64-hex sltHash}/{recipient alias}",
      });
      return;
    }
    if (network !== NETWORK) {
      if ((KNOWN_NETWORKS as readonly string[]).includes(network)) {
        sendJson(res, 404, {
          error: "wrong-network",
          reason: `this deployment serves ${NETWORK}; no credentials exist here for ${network}`,
        });
      } else {
        sendJson(res, 400, {
          error: "invalid-params",
          reason: `unknown network ${JSON.stringify(network)}; expected one of ${KNOWN_NETWORKS.join(", ")}`,
        });
      }
      return;
    }

    // Registered badges only — refused before any chain read.
    const badge = lookupBadge(policyId, sltHash, deps.registryFile);
    if (!badge) {
      sendJson(res, 404, {
        error: "unknown-badge",
        reason: `no badge ${policyId}.${sltHash} in the Andamio badge registry`,
      });
      return;
    }

    // Signed-artifact cache: a hit must not re-call the signer (or the gate).
    const cacheKey = artifactCacheKey({
      network,
      courseId: policyId,
      sltHash,
      studentStateAsset: `g${recipient}`,
      keyVersion: ACTIVE_KEY_VERSION,
    });
    try {
      const cached = await deps.cache.get(cacheKey);
      if (cached !== null) {
        sendCredential(res, cached);
        return;
      }
    } catch (e) {
      // A broken second-level store must not take the signing path down.
      log(`artifact cache read failed for ${cacheKey}: ${(e as Error).message}`);
    }

    const produceArtifact = async (): Promise<string> => {
      // THE GATE. Signing is unreachable unless the live on-chain anchor
      // check passes — zero KMS calls on any refusal.
      const anchor = await checkAnchor(
        { network, courseId: policyId, sltHash, alias: recipient },
        {
          fetchImpl: deps.fetchImpl,
          courseTitle: badge.course_title,
          moduleTitle: badge.module_title,
          locatorCache,
        },
      );

      const credential = mapCredential(anchor);
      if (deps.issuerIdOverride) {
        credential.issuer = { ...credential.issuer, id: deps.issuerIdOverride };
      }

      // Single-sign invariant (issue #54 finding 1): the signer seam must be
      // invoked EXACTLY ONCE per issuance, asserted before the artifact is
      // cached or served.
      let signerInvocations = 0;
      const countingSigner: RawSigner = {
        id: deps.signer.id,
        algorithm: deps.signer.algorithm,
        sign: async (input) => {
          signerInvocations += 1;
          return deps.signer.sign(input);
        },
      };

      const signed = await issueWith(credential, countingSigner, documentLoader, anchor.blockTime);
      if (signerInvocations !== 1) {
        throw new SigningError(
          `signer seam invoked ${signerInvocations} times, expected exactly 1 — refusing to serve the artifact`,
        );
      }

      // Never serve what does not verify (includes the status bit). A KMS-
      // returned signature that fails the loopback verify is a broken signing
      // backend, not an internal bug — classified as SigningError so the
      // caller sees 502 signing-unavailable (tier-2 review F7).
      try {
        await verifyWith(signed, documentLoader, checkStatus);
      } catch (e) {
        throw new SigningError(
          `post-sign loopback verification of the signer-returned proof failed: ${(e as Error).message}`,
        );
      }

      // 1EdTech OB3 Plain-JSON schema requires proof in array form.
      if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];

      const artifact = JSON.stringify(signed, null, 2) + "\n";
      try {
        await deps.cache.put(cacheKey, artifact);
      } catch (e) {
        log(`artifact cache write failed for ${cacheKey}: ${(e as Error).message}`);
      }
      return artifact;
    };

    try {
      let flight = inflight.get(cacheKey);
      if (!flight) {
        flight = produceArtifact();
        inflight.set(cacheKey, flight);
        // Clear the entry when the flight settles; swallow here — every
        // waiter (including this request) handles the rejection itself.
        flight.catch(() => {}).finally(() => inflight.delete(cacheKey));
      }
      sendCredential(res, await flight);
    } catch (e) {
      if (e instanceof GateRefusal) {
        sendJson(res, e.kind === "unknown-claim" ? 404 : 422, {
          error: e.kind,
          reason: e.reason,
        });
        return;
      }
      if (e instanceof UpstreamError) {
        log(`upstream error: ${e.message}`);
        sendJson(res, 503, {
          error: "upstream-unavailable",
          reason: "the on-chain index or badge host could not be read; no credential was signed",
        });
        return;
      }
      if (e instanceof SigningError) {
        log(`signing error: ${e.message}`);
        sendJson(res, 502, {
          error: "signing-unavailable",
          reason: "the signing backend failed; no partial artifact was produced",
        });
        return;
      }
      log(`unexpected error serving ${pathname}: ${(e as Error).stack ?? e}`);
      sendJson(res, 500, {
        error: "internal",
        reason: "unexpected failure; no credential was served",
      });
    }
  };
}

export function createServer(deps: AppDeps): http.Server {
  const handle = createRequestHandler(deps);
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(`handler crashed: ${(e as Error).stack ?? e}`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal", reason: "handler crashed" });
      } else {
        res.destroy();
      }
    });
  });
}
