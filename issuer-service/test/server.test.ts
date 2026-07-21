// Full-request-path tests: the service wired with the EPHEMERAL signer (the
// spike's loopback pattern) + real recorded Andamioscan fixtures, exercised
// over real HTTP. No KMS, no network — hermetic.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer, type AppDeps } from "../src/server.ts";
import { makeEphemeralSigner, type RawSigner } from "../src/signer.ts";
import { LayeredArtifactCache, MemoryArtifactStore } from "../src/cache.ts";
import { makeDocumentLoader } from "../src/document-loader.ts";
import { verifyWith, makeCheckStatus } from "../src/issue.ts";
import { SigningError } from "../src/signer.ts";
import { makeFixtureFetch, SUBJECT, type FixtureFetchOpts } from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATUS_LIST = JSON.parse(
  readFileSync(path.join(HERE, "..", "..", "status", "key-epoch-2026-07.json"), "utf8"),
);

const GOOD_PATH = `/credentials/mainnet/${SUBJECT.courseId}/${SUBJECT.sltHash}/${SUBJECT.alias}`;

interface Harness {
  url: (p: string) => string;
  close: () => Promise<void>;
  signCalls: () => number;
  scanCalls: string[];
}

async function startHarness(opts: {
  fixtureOpts?: FixtureFetchOpts;
  signerOverride?: RawSigner;
  /** Wrap the harness signer (e.g. to gate when it may return). */
  wrapSigner?: (base: RawSigner) => RawSigner;
} = {}): Promise<Harness> {
  const ephemeral = makeEphemeralSigner();
  let signCalls = 0;
  const inner = opts.signerOverride ?? ephemeral.signer;
  const baseSigner = opts.wrapSigner ? opts.wrapSigner(inner) : inner;
  const countedSigner: RawSigner = {
    id: baseSigner.id,
    algorithm: baseSigner.algorithm,
    sign: async (input) => {
      signCalls += 1;
      return baseSigner.sign(input);
    },
  };
  const { fetchImpl, calls } = makeFixtureFetch(opts.fixtureOpts);
  const deps: AppDeps = {
    signer: countedSigner,
    signerOverrides: ephemeral.overrides,
    issuerIdOverride: ephemeral.controller,
    didDocument: ephemeral.didDocument,
    statusListCredential: STATUS_LIST,
    fetchImpl,
    cache: new LayeredArtifactCache(new MemoryArtifactStore(), null),
    log: () => {},
  };
  const server = createServer(deps);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  return {
    url: (p) => `http://127.0.0.1:${port}${p}`,
    close: () => new Promise((r) => server.close(() => r())),
    signCalls: () => signCalls,
    scanCalls: calls,
    // Expose the ephemeral material for loopback verification.
    ...( { ephemeral } as any),
  } as Harness & { ephemeral: ReturnType<typeof makeEphemeralSigner> };
}

test("healthz responds ok", async () => {
  const h = await startHarness();
  try {
    const res = await fetch(h.url("/healthz"));
    assert.equal(res.status, 200);
  } finally {
    await h.close();
  }
});

test("happy path: serves a signed OB3 VC that round-trips through the loopback verifier", async () => {
  const h = (await startHarness()) as any;
  try {
    const res = await fetch(h.url(GOOD_PATH));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/ld+json");
    const vc = await res.json();

    // Shape: the Rung-8.3 final dialect.
    assert.deepEqual(vc["@context"], [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
      "https://credentials.andamio.io/context/v0.jsonld",
    ]);
    assert.equal(
      vc.id,
      `urn:andamio:credential:mainnet:${SUBJECT.courseId}:${SUBJECT.sltHash}:${SUBJECT.studentStateAsset}`,
    );
    assert.equal(vc.validFrom, SUBJECT.blockTime);
    assert.equal(
      vc.credentialSubject.id,
      `urn:andamio:mainnet:recipient:${SUBJECT.studentStateAsset}`,
    );
    assert.equal(vc.courseOwner, "urn:andamio:mainnet:course-owner:gjames");
    assert.deepEqual(vc.evidence[0].type, ["OnChainCredentialAnchor", "Evidence"]);
    assert.equal(vc.evidence[0].network, "mainnet");
    assert.equal(vc.evidence[0].policyId, SUBJECT.courseId);
    assert.equal(vc.evidence[0].asset, SUBJECT.studentStateAsset);
    assert.equal(vc.evidence[0].claimTxHash, SUBJECT.claimTxHash);
    assert.equal(vc.credentialStatus.type, "BitstringStatusListEntry");
    assert.equal(vc.credentialStatus.statusPurpose, "suspension");
    assert.equal(vc.credentialStatus.statusListIndex, "0");

    // Proof: array form (1EdTech Plain-JSON schema), dated to block_time.
    assert.ok(Array.isArray(vc.proof) && vc.proof.length === 1);
    assert.equal(vc.proof[0].cryptosuite, "eddsa-rdfc-2022");
    assert.equal(vc.proof[0].created, SUBJECT.blockTime);

    // Independent loopback verification of the returned bytes (the spike's
    // verify-loopback pattern): fresh loader, fresh status check.
    const loader = makeDocumentLoader({
      didDocument: h.ephemeral.didDocument,
      overrides: h.ephemeral.overrides,
    });
    await verifyWith(vc, loader, makeCheckStatus(STATUS_LIST));
  } finally {
    await h.close();
  }
});

test("cache prevents double-signing: a re-request serves byte-identical bytes with exactly one signer call", async () => {
  const h = await startHarness();
  try {
    const res1 = await fetch(h.url(GOOD_PATH));
    assert.equal(res1.status, 200);
    const body1 = await res1.text();
    assert.equal(h.signCalls(), 1);

    const res2 = await fetch(h.url(GOOD_PATH));
    assert.equal(res2.status, 200);
    const body2 = await res2.text();
    assert.equal(body2, body1, "cached artifact must be byte-identical");
    assert.equal(h.signCalls(), 1, "a re-request must not re-invoke the signer");
  } finally {
    await h.close();
  }
});

test("singleflight: K concurrent cold requests for one coordinate produce exactly ONE gate+sign run", async () => {
  // The signer is gated so the one flight provably stays open until every
  // concurrent request has attached to it — no timing luck involved.
  let releaseSign!: () => void;
  const signGate = new Promise<void>((r) => (releaseSign = r));
  const h = await startHarness({
    wrapSigner: (base) => ({
      ...base,
      sign: async (input) => {
        await signGate;
        return base.sign(input);
      },
    }),
  });
  try {
    const K = 5;
    const pending = Array.from({ length: K }, () => fetch(h.url(GOOD_PATH)));
    await new Promise((r) => setTimeout(r, 100)); // let all K handlers attach
    releaseSign();
    const responses = await Promise.all(pending);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    for (const r of responses) assert.equal(r.status, 200);
    for (const b of bodies) assert.equal(b, bodies[0], "all waiters must receive byte-identical artifacts");
    assert.equal(h.signCalls(), 1, `${K} concurrent first requests must collapse onto one signer call`);
    // The gate ran once too: exactly one global-state read happened.
    const stateReads = h.scanCalls.filter((u) => u.endsWith(`/api/v2/users/${SUBJECT.alias}/state`));
    assert.equal(stateReads.length, 1, "concurrent requests must not stampede the anchor gate");
  } finally {
    await h.close();
  }
});

test("singleflight shares a failure with its waiters and is not sticky afterwards", async () => {
  let releaseSign!: () => void;
  const signGate = new Promise<void>((r) => (releaseSign = r));
  const failing: RawSigner = {
    id: "did:example:failing#key-1",
    algorithm: "Ed25519",
    sign: async () => {
      await signGate;
      throw new SigningError("KMS asymmetricSign -> HTTP 500");
    },
  };
  const h = await startHarness({ signerOverride: failing });
  try {
    const pA = fetch(h.url(GOOD_PATH));
    const pB = fetch(h.url(GOOD_PATH));
    await new Promise((r) => setTimeout(r, 100)); // both attach to the one flight
    releaseSign();
    const [a, b] = await Promise.all([pA, pB]);
    assert.equal(a.status, 502);
    assert.equal(b.status, 502);
    assert.equal(h.signCalls(), 1, "concurrent waiters share the failed flight's single signer call");
    // A later request starts a NEW flight (the failed one was evicted).
    const retry = await fetch(h.url(GOOD_PATH));
    assert.equal(retry.status, 502);
    assert.equal(h.signCalls(), 2, "a settled failed flight must not be served to later requests");
  } finally {
    await h.close();
  }
});

test("gate refuses a tampered subject: recipient who never claimed -> 404 unknown-claim, signer never invoked", async () => {
  const h = await startHarness();
  try {
    const res = await fetch(
      h.url(`/credentials/mainnet/${SUBJECT.courseId}/${SUBJECT.sltHash}/mallory`),
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "unknown-claim");
    assert.ok(body.reason.length > 0, "refusal body must say why");
    assert.equal(h.signCalls(), 0, "no signer call on a gate refusal");
  } finally {
    await h.close();
  }
});

test("gate refuses tampered SLT text -> 422 anchor-mismatch with the reason, signer never invoked", async () => {
  const h = await startHarness({
    fixtureOpts: {
      override: (url) => {
        if (url.endsWith(`/api/v2/courses/${SUBJECT.courseId}/details`)) {
          const course = JSON.parse(
            readFileSync(
              path.join(HERE, "fixtures", "scan-course-details-ae192632.json"),
              "utf8",
            ),
          );
          course.modules[0].module.slts[0] = "Tampered learning target.";
          return new Response(JSON.stringify(course), { status: 200 });
        }
        return undefined;
      },
    },
  });
  try {
    const res = await fetch(h.url(GOOD_PATH));
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.error, "anchor-mismatch");
    assert.match(body.reason, /does not match the on-chain commitment/);
    assert.equal(h.signCalls(), 0);
  } finally {
    await h.close();
  }
});

test("malformed params -> 400 with ZERO upstream calls", async () => {
  const h = await startHarness();
  try {
    const res = await fetch(h.url("/credentials/mainnet/nothex/alsonothex/james"));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid-params");
    assert.equal(h.scanCalls.length, 0);
    assert.equal(h.signCalls(), 0);
  } finally {
    await h.close();
  }
});

test("valid-but-other network -> 404 wrong-network; unknown network -> 400", async () => {
  const h = await startHarness();
  try {
    const preprod = await fetch(
      h.url(`/credentials/preprod/${SUBJECT.courseId}/${SUBJECT.sltHash}/james`),
    );
    assert.equal(preprod.status, 404);
    assert.equal((await preprod.json()).error, "wrong-network");

    const bogus = await fetch(
      h.url(`/credentials/devnet/${SUBJECT.courseId}/${SUBJECT.sltHash}/james`),
    );
    assert.equal(bogus.status, 400);
    assert.equal(h.scanCalls.length, 0);
  } finally {
    await h.close();
  }
});

test("unregistered badge -> 404 unknown-badge with ZERO upstream calls", async () => {
  const h = await startHarness();
  try {
    const res = await fetch(
      h.url(`/credentials/mainnet/${"a".repeat(56)}/${"b".repeat(64)}/james`),
    );
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "unknown-badge");
    assert.equal(h.scanCalls.length, 0);
  } finally {
    await h.close();
  }
});

test("service registers no other route: non-/credentials paths 404", async () => {
  const h = await startHarness();
  try {
    for (const p of ["/.well-known/did.json", "/status/key-epoch-2026-07.json", "/credentials", "/"]) {
      const res = await fetch(h.url(p));
      assert.equal(res.status, 404, `${p} must not be served here`);
    }
    assert.equal(h.scanCalls.length, 0);
  } finally {
    await h.close();
  }
});

test("signing backend failure -> 502, no partial artifact, nothing cached", async () => {
  const failing: RawSigner = {
    id: "did:example:failing#key-1",
    algorithm: "Ed25519",
    sign: async () => {
      throw new SigningError("KMS asymmetricSign -> HTTP 500");
    },
  };
  const h = await startHarness({ signerOverride: failing });
  try {
    const res = await fetch(h.url(GOOD_PATH));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "signing-unavailable");
    // A retry hits the gate + signer again (nothing was cached) and fails the
    // same way — still no partial artifact.
    const retry = await fetch(h.url(GOOD_PATH));
    assert.equal(retry.status, 502);
  } finally {
    await h.close();
  }
});

test("signer returns a signature that fails the post-sign loopback verify -> 502 signing-unavailable (not 500), nothing cached", async () => {
  // The signer "succeeds" but returns garbage: a well-formed 64-byte value
  // that is not a valid Ed25519 signature over the proof input. The loopback
  // verify is what catches it — a broken signing backend, 502 not 500.
  const garbage: RawSigner = {
    id: "did:example:garbage#key-1",
    algorithm: "Ed25519",
    sign: async () => new Uint8Array(64),
  };
  const h = await startHarness({ signerOverride: garbage });
  try {
    const res = await fetch(h.url(GOOD_PATH));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error, "signing-unavailable");
    // Nothing was cached: a retry re-runs the pipeline (and fails again).
    const retry = await fetch(h.url(GOOD_PATH));
    assert.equal(retry.status, 502);
    assert.equal(h.signCalls(), 2);
  } finally {
    await h.close();
  }
});

test("indexer outage -> 503 upstream-unavailable, never a refusal, signer never invoked", async () => {
  const h = await startHarness({
    fixtureOpts: {
      override: (url) =>
        url.includes("/api/v2/users/") && url.endsWith("/state")
          ? new Response("db down", { status: 503 })
          : undefined,
    },
  });
  try {
    const res = await fetch(h.url(GOOD_PATH));
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, "upstream-unavailable");
    assert.equal(h.signCalls(), 0);
  } finally {
    await h.close();
  }
});
