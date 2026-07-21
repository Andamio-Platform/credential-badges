// Anchor-gate tests — hermetic (fixture-backed fetch, real recorded
// Andamioscan responses for the known subject credential). The refusal paths
// mirror spike/signer-spike/check-anchor.test.ts, generalized to the
// service's server-side-resolved subject.

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkAnchor, GateRefusal, UpstreamError, slotToBlockTime } from "../src/anchor.ts";
import { makeFixtureFetch, SUBJECT, fixture } from "./helpers.ts";

const GATE_DEPS = (fetchImpl: typeof fetch) => ({
  fetchImpl,
  courseTitle: "Andamio Issuer",
  moduleTitle: "About Andamio Issuer",
  locatorCache: new Map<string, { txHash: string; slot: number }>(),
});

const REQ = {
  network: "mainnet",
  courseId: SUBJECT.courseId,
  sltHash: SUBJECT.sltHash,
  alias: SUBJECT.alias,
};

test("slotToBlockTime derives the pinned block_time from the pinned slot", () => {
  assert.equal(slotToBlockTime(SUBJECT.slot), SUBJECT.blockTime);
});

test("gate passes for the real subject: discovers the claim tx server-side and pins every field", async () => {
  const { fetchImpl } = makeFixtureFetch();
  const anchor = await checkAnchor(REQ, GATE_DEPS(fetchImpl));
  assert.equal(anchor.claimTxHash, SUBJECT.claimTxHash);
  assert.equal(anchor.slot, SUBJECT.slot);
  assert.equal(anchor.blockTime, SUBJECT.blockTime);
  assert.equal(anchor.studentStateAsset, SUBJECT.studentStateAsset);
  assert.equal(anchor.courseOwner, "james");
  assert.equal(anchor.slts.length, 3);
  assert.equal(
    anchor.badgeUrl,
    `https://credentials.andamio.io/badges/${SUBJECT.courseId}.${SUBJECT.sltHash}.svg`,
  );
});

test("warm locator cache: second gate run re-verifies via slot binary search and returns an identical anchor", async () => {
  const { fetchImpl, calls } = makeFixtureFetch();
  const deps = GATE_DEPS(fetchImpl);
  const first = await checkAnchor(REQ, deps);
  const callsAfterFirst = calls.length;
  const second = await checkAnchor(REQ, deps);
  const warmCalls = calls.length - callsAfterFirst;
  // The warm path must not replay the discovery scan (which resolves every
  // claim row it passes): it binary-searches the known (tx, slot) and
  // re-reads the one claim event.
  assert.ok(
    warmCalls < callsAfterFirst,
    `warm path made ${warmCalls} calls, expected fewer than the cold path's ${callsAfterFirst}`,
  );
  const strip = (a: any) => ({ ...a, provenance: null });
  assert.deepEqual(strip(second), strip(first));
});

test("poisoned locator entry cannot survive: gate falls back to discovery and still pins the true claim tx", async () => {
  const { fetchImpl } = makeFixtureFetch();
  const deps = GATE_DEPS(fetchImpl);
  deps.locatorCache.set(`${SUBJECT.alias}/${SUBJECT.courseId}.${SUBJECT.sltHash}`, {
    txHash: "deadbeef".repeat(8),
    slot: SUBJECT.slot,
  });
  const anchor = await checkAnchor(REQ, deps);
  assert.equal(anchor.claimTxHash, SUBJECT.claimTxHash);
});

test("REFUSES unknown alias (no on-chain global state) — unknown-claim", async () => {
  const { fetchImpl, calls } = makeFixtureFetch();
  await assert.rejects(
    checkAnchor({ ...REQ, alias: "mallory" }, GATE_DEPS(fetchImpl)),
    (e: any) => e instanceof GateRefusal && e.kind === "unknown-claim",
  );
  // Refused at the state gate: exactly one upstream read.
  assert.equal(calls.length, 1);
});

test("REFUSES a credential absent from the recipient's global-state credential map — unknown-claim", async () => {
  const tamperedState = fixture("scan-users-james-state.json");
  for (const c of tamperedState.completed_courses) {
    if (c.course_id === SUBJECT.courseId) {
      c.claimed_credentials = c.claimed_credentials.filter(
        (h: string) => h !== SUBJECT.sltHash,
      );
    }
  }
  const { fetchImpl } = makeFixtureFetch({
    override: (url) =>
      url.endsWith(`/api/v2/users/${SUBJECT.alias}/state`)
        ? new Response(JSON.stringify(tamperedState), { status: 200 })
        : undefined,
  });
  await assert.rejects(
    checkAnchor(REQ, GATE_DEPS(fetchImpl)),
    (e: any) => e instanceof GateRefusal && e.kind === "unknown-claim",
  );
});

test("REFUSES tampered SLT text (blake2b commitment mismatch) — anchor-mismatch", async () => {
  const tamperedCourse = fixture("scan-course-details-ae192632.json");
  tamperedCourse.modules[0].module.slts[0] = "I can claim something the chain never committed to.";
  const { fetchImpl } = makeFixtureFetch({
    override: (url) =>
      url.endsWith(`/api/v2/courses/${SUBJECT.courseId}/details`)
        ? new Response(JSON.stringify(tamperedCourse), { status: 200 })
        : undefined,
  });
  await assert.rejects(
    checkAnchor(REQ, GATE_DEPS(fetchImpl)),
    (e: any) =>
      e instanceof GateRefusal &&
      e.kind === "anchor-mismatch" &&
      /does not match the on-chain commitment/.test(e.reason),
  );
});

test("REFUSES an EMPTY slts array — anchor-mismatch, never signs an empty narrative", async () => {
  const tamperedCourse = fixture("scan-course-details-ae192632.json");
  tamperedCourse.modules[0].module.slts = [];
  const { fetchImpl } = makeFixtureFetch({
    override: (url) =>
      url.endsWith(`/api/v2/courses/${SUBJECT.courseId}/details`)
        ? new Response(JSON.stringify(tamperedCourse), { status: 200 })
        : undefined,
  });
  await assert.rejects(
    checkAnchor(REQ, GATE_DEPS(fetchImpl)),
    (e: any) => e instanceof GateRefusal && e.kind === "anchor-mismatch" && /EMPTY slts/.test(e.reason),
  );
});

test("surfaces indexer unavailability as UpstreamError, never a refusal", async () => {
  const { fetchImpl } = makeFixtureFetch({
    override: (url) =>
      url.includes("/api/v2/transactions")
        ? new Response("upstream down", { status: 503 })
        : undefined,
  });
  await assert.rejects(
    checkAnchor(REQ, GATE_DEPS(fetchImpl)),
    (e: any) => e instanceof UpstreamError,
  );
});
