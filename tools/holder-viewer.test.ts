// Tests for the holder viewer client module (badges/_holder.js, #73 + the
// Phase 3 verification states).
//
// Exercises the pure logic that carries the correctness risk: URL parsing, the
// status-list bit decode (ported from issuer-service/src/status-list.ts), the
// holder-state ∩ registry view model, the certUrl builder, the arrival verdict,
// and — most importantly — the two HONESTY contracts:
//
//   FAIL-LOUD (R6): a holder-state load failure must never yield badges shown
//   as verified, and a soft dependency must only ever downgrade or omit.
//
//   NO-OVERCLAIM (Phase 3): no code path may produce a "signature valid" state
//   (nothing here checks a Data Integrity proof) or a "revoked" state (absence
//   and indexer lag are indistinguishable from the browser).
//
// Run: node --experimental-strip-types --test tools/holder-viewer.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parsePath,
  b64urlToBytes,
  decodeStatusList,
  statusBitAt,
  holderStems,
  buildViewModel,
  badgeStateFor,
  arrivalVerdict,
  courseOwners,
  certUrlFor,
  loadHolderView,
  BADGE_STATES,
  VERDICTS,
  VERDICT_COPY,
  KEY_EPOCH_INDEX,
} from "../badges/_holder.js";

const STEM = "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df"
  + ".e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db";
const OTHER = "203e63f457e0b8088073ec20959c4e0cc188cf90425d4f29ff3f817f"
  + ".77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b";

// The real committed status list encodedList, read from the served file itself
// so the fixture can never drift from status/key-epoch-2026-07.json. Bit 0 is
// UNSET (the flagship is live, not suspended).
const REAL_ENCODED: string = JSON.parse(
  readFileSync(new URL("../status/key-epoch-2026-07.json", import.meta.url), "utf8"),
).credentialSubject.encodedList;

async function encodeList(bytes: Uint8Array): Promise<string> {
  const cs = new CompressionStream("gzip");
  const stream = new Response(bytes).body!.pipeThrough(cs);
  const gz = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of gz) bin += String.fromCharCode(b);
  return "u" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function res(body: unknown, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

const REGISTRY = {
  [STEM]: { course_title: "Andamio", module_title: "Flagship module", signed: true },
  [OTHER]: { course_title: "Join Cardano XP", module_title: "Find a bug", signed: false },
};

function holderState(stems: string[]) {
  return {
    alias: "james",
    completed_courses: stems.map((s) => {
      const [course_id, slt] = s.split(".");
      return { course_id, claimed_credentials: [slt] };
    }),
  };
}

// Live-shape completed-courses rows (probed 2026-07-28): the fields the viewer
// reads are course_id + owner; tx_hash here is the COURSE-CREATION tx, not the
// claim tx, and is deliberately unused.
const COMPLETED = [
  {
    tx_hash: "42bfbfd422ff3090691278792a757a0c9df1d3e1f1c4004aac57b1d3406eaf5d",
    slot: 179270763, course_id: STEM.split(".")[0], owner: "james",
    teachers: ["james", "sebastianpabon"],
  },
  { tx_hash: "6a53c0d0", slot: 184118231, course_id: OTHER.split(".")[0], owner: "cardano_xp", teachers: ["cardano_xp"] },
];

// A fetch stub routing by URL substring. Any key can be overridden to fail.
function stubFetch(overrides: Record<string, () => any> = {}) {
  return async (url: string) => {
    if (url.includes("/courses/completed")) return (overrides.completed ?? (() => res(COMPLETED)))();
    if (url.includes("/holder-api/")) return (overrides.state ?? (() => res(holderState([STEM, OTHER]))))();
    if (url.includes("/_registry.json")) return (overrides.registry ?? (() => res(REGISTRY)))();
    if (url.includes("/status/")) return (overrides.status ?? (() => res({ credentialSubject: { encodedList: REAL_ENCODED } })))();
    throw new Error(`unexpected fetch ${url}`);
  };
}

test("parsePath accepts a well-formed holder path", () => {
  assert.deepEqual(parsePath(`/badges/${STEM}/james`), { stem: STEM, alias: "james" });
  assert.deepEqual(parsePath(`/badges/${STEM}/james/`), { stem: STEM, alias: "james" });
});

test("parsePath rejects malformed paths", () => {
  assert.equal(parsePath(`/badges/${STEM}`), null, "missing alias");
  assert.equal(parsePath("/badges/tooshort/james"), null, "bad stem");
  assert.equal(parsePath(`/badges/${STEM}/has space`), null, "illegal alias char");
  assert.equal(parsePath(`/badges/${STEM}/a$b`), null, "illegal alias char");
  assert.equal(parsePath("/something/else"), null, "not a badge path");
});

test("statusBitAt reads the real committed list as NOT suspended", async () => {
  const bits = await decodeStatusList(REAL_ENCODED);
  assert.equal(statusBitAt(bits, KEY_EPOCH_INDEX), 0);
});

test("decodeStatusList round-trips a synthetically SUSPENDED list (bit 0 = MSB)", async () => {
  const buf = new Uint8Array(16); // 128 bits
  buf[0] = 0b1000_0000; // set bit 0 = MSB of byte 0
  const bits = await decodeStatusList(await encodeList(buf));
  assert.equal(statusBitAt(bits, 0), 1, "bit 0 set");
  assert.equal(statusBitAt(bits, 1), 0, "bit 1 unset (MSB-first ordering)");
});

test("decodeStatusList rejects a non-multibase string", async () => {
  await assert.rejects(() => decodeStatusList("H4sIno-u-prefix"));
});

test("statusBitAt guards range + integer index", async () => {
  const bits = new Uint8Array(2);
  assert.throws(() => statusBitAt(bits, -1));
  assert.throws(() => statusBitAt(bits, 16));
  assert.throws(() => statusBitAt(bits, 1.5));
});

test("b64urlToBytes decodes url-safe alphabet without padding", () => {
  // "u" prefix stripped by caller; "SGk" = "Hi"
  assert.deepEqual([...b64urlToBytes("SGk")], [0x48, 0x69]);
});

test("holderStems flattens completed_courses -> stems", () => {
  assert.deepEqual(holderStems(holderState([STEM, OTHER])), [STEM, OTHER]);
  assert.deepEqual(holderStems({}), []);
  assert.deepEqual(holderStems(null), []);
});

test("buildViewModel intersects with registry and folds in state", () => {
  const badges = buildViewModel({
    holderState: holderState([STEM, OTHER, "deadbeef".repeat(7) + "." + "0".repeat(64)]),
    registry: REGISTRY,
    keyEpochSuspended: false,
    arrivedStem: OTHER,
  });
  assert.equal(badges.length, 2, "unknown-to-registry stem omitted");
  assert.equal(badges[0].stem, OTHER, "arrived-from badge sorts first");
  const flagship = badges.find((b) => b.stem === STEM)!;
  assert.equal(flagship.state, BADGE_STATES.SIGNATURE_UNAVAILABLE,
    "a proof being PRESENT is never rendered as a proof being valid");
  const other = badges.find((b) => b.stem === OTHER)!;
  assert.equal(other.state, BADGE_STATES.ANCHORED, "unsigned -> anchored");
});

test("buildViewModel marks signed badges suspended / indeterminate correctly", () => {
  const suspended = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: true, arrivedStem: null });
  assert.equal(suspended[0].state, BADGE_STATES.SUSPENDED, "signed + key-epoch set -> suspended");
  const unknown = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: null, arrivedStem: null });
  assert.equal(unknown[0].state, BADGE_STATES.INDETERMINATE,
    "signed + status unavailable -> indeterminate, never silent ok");
  // an UNSIGNED badge is anchored regardless of the key-epoch bit
  const unsigned = buildViewModel({ holderState: holderState([OTHER]), registry: REGISTRY, keyEpochSuspended: true, arrivedStem: null });
  assert.equal(unsigned[0].state, BADGE_STATES.ANCHORED);
});

test("no state name asserts signature validity, and 'revoked' is not in the vocabulary", () => {
  const all = [...Object.values(BADGE_STATES), ...Object.values(VERDICTS)];
  for (const s of all) {
    assert.ok(!/valid/i.test(s), `state "${s}" claims validity`);
    assert.ok(!/revok/i.test(s), `state "${s}" claims revocation`);
  }
  // Every state has designed copy, and none of it says the signature checks out.
  for (const s of Object.values(VERDICTS)) {
    const copy = (VERDICT_COPY as any)[s];
    assert.ok(copy?.headline && copy?.detail, `no designed copy for "${s}"`);
    const text = `${copy.headline} ${copy.detail}`;
    assert.ok(!/signature is valid|signature valid|verified signature/i.test(text),
      `copy for "${s}" overclaims signature validity`);
  }
});

test("badgeStateFor NEVER yields a valid/revoked state, across the whole input matrix", () => {
  const inputs = [true, false, null, undefined, 0, 1, "true", {}];
  for (const signed of [true, false, undefined, null, 0, 1]) {
    for (const keyEpochSuspended of inputs) {
      const s = badgeStateFor({ signed, keyEpochSuspended } as any);
      assert.ok(Object.values(BADGE_STATES).includes(s),
        `badgeStateFor({signed:${signed},sus:${keyEpochSuspended}}) -> unknown state "${s}"`);
    }
  }
  // Only a CONFIRMED false upgrades a signed badge off `indeterminate`.
  assert.equal(badgeStateFor({ signed: true, keyEpochSuspended: false }), BADGE_STATES.SIGNATURE_UNAVAILABLE);
  assert.equal(badgeStateFor({ signed: true, keyEpochSuspended: undefined as any }), BADGE_STATES.INDETERMINATE);
});

test("certUrlFor targets the HOLDER page as certUrl", () => {
  const url = certUrlFor("https://credentials.andamio.io", STEM, "james", "Flagship module");
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, "https://www.linkedin.com/profile/add");
  assert.equal(u.searchParams.get("certUrl"), `https://credentials.andamio.io/badges/${STEM}/james`);
  assert.equal(u.searchParams.get("startTask"), "CERTIFICATION_NAME");
  assert.equal(u.searchParams.get("certId"), STEM);
});

test("loadHolderView happy path returns verified badges", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch(), origin: "https://credentials.andamio.io" });
  assert.equal(view.ok, true);
  assert.equal(view.badges.length, 2);
});

test("loadHolderView FAILS LOUD when holder state is unreachable (R6)", async () => {
  const s502 = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ state: () => res(null, { ok: false, status: 502 }) }) });
  assert.equal(s502.ok, false, "502 -> not ok");
  assert.ok(!("badges" in s502) || !s502.badges, "no badges shown on failure");

  const thrown = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ state: () => { throw new Error("network"); } }) });
  assert.equal(thrown.ok, false, "network throw -> not ok");

  const regFail = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ registry: () => res(null, { ok: false, status: 500 }) }) });
  assert.equal(regFail.ok, false, "registry failure -> not ok");
});

test("loadHolderView empty holder -> ok with no badges (not an error)", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "nobody", fetchImpl: stubFetch({ state: () => res(holderState([])) }) });
  assert.equal(view.ok, true);
  assert.equal(view.badges.length, 0);
});

test("loadHolderView degrades to 'indeterminate' when only the status list fails", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ status: () => res(null, { ok: false, status: 500 }) }) });
  assert.equal(view.ok, true, "holder state loaded -> view is ok");
  const flagship = view.badges.find((b: any) => b.stem === STEM);
  assert.equal(flagship.state, BADGE_STATES.INDETERMINATE,
    "signed badge with no status read -> indeterminate, never a silent pass");
  assert.equal(view.verdict.state, BADGE_STATES.INDETERMINATE,
    "the verdict degrades with the badge it describes");
});

// A 200 with an unparseable body (.json() throws) must fail loud, not crash.
function resThrow() {
  return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } };
}

test("loadHolderView FAILS LOUD on a 200-with-garbage-body (json throws)", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ state: () => resThrow() }) });
  assert.equal(view.ok, false, "unparseable holder-state body -> not ok");
  assert.ok(!view.badges, "no badges rendered");
});

test("loadHolderView FAILS LOUD on a malformed-but-200 holder state (non-iterable)", async () => {
  // completed_courses is a number: buildViewModel/holderStems throw — must be
  // caught and surfaced as fail-loud, never an unhandled rejection (R6).
  const bad = () => res({ alias: "james", completed_courses: 42 });
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ state: bad }) });
  assert.equal(view.ok, false, "malformed shape -> not ok");
  assert.ok(!view.badges, "no badges rendered");
});

test("loadHolderView failure return always carries alias (no 'undefined' heading)", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ state: () => res(null, { ok: false, status: 502 }) }) });
  assert.equal(view.ok, false);
  assert.equal(view.alias, "james", "failure return includes the requested alias");
});

test("buildViewModel dedupes a repeated stem", () => {
  const badges = buildViewModel({ holderState: holderState([STEM, STEM, OTHER]), registry: REGISTRY, keyEpochSuspended: false, arrivedStem: null });
  assert.equal(badges.length, 2, "duplicate claimed stem collapses to one badge");
});

test("buildViewModel treats a non-boolean suspension as 'indeterminate', never a pass (R6)", () => {
  // A future refactor passing undefined instead of null must NOT fabricate a
  // signature-present-and-unsuspended reading.
  const badges = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: undefined, arrivedStem: null });
  assert.equal(badges[0].state, BADGE_STATES.INDETERMINATE);
});

// ---- Arrival verdict (Phase 3) --------------------------------------------

test("arrivalVerdict: held badge -> the badge's own state", () => {
  const v = arrivalVerdict({
    ok: true, holderState: holderState([STEM, OTHER]), arrivedStem: OTHER,
    registry: REGISTRY, keyEpochSuspended: false,
  });
  assert.deepEqual(v, { state: BADGE_STATES.ANCHORED, stem: OTHER });

  const signedV = arrivalVerdict({
    ok: true, holderState: holderState([STEM]), arrivedStem: STEM,
    registry: REGISTRY, keyEpochSuspended: false,
  });
  assert.equal(signedV.state, BADGE_STATES.SIGNATURE_UNAVAILABLE);
});

test("arrivalVerdict: NOT-FOUND is the whole point — the holder does not hold this badge", () => {
  // This is the case the pre-Phase-3 page answered with silence: the badge just
  // vanished from an unordered list, which a reader scans as confirmation.
  const v = arrivalVerdict({
    ok: true, holderState: holderState([OTHER]), arrivedStem: STEM,
    registry: REGISTRY, keyEpochSuspended: false,
  });
  assert.deepEqual(v, { state: VERDICTS.NOT_FOUND, stem: STEM });

  const empty = arrivalVerdict({
    ok: true, holderState: holderState([]), arrivedStem: STEM,
    registry: REGISTRY, keyEpochSuspended: false,
  });
  assert.equal(empty.state, VERDICTS.NOT_FOUND, "a holder with no badges is still a not-found answer");
});

test("arrivalVerdict is derived from on-chain state, NOT the registry (KTD-1)", () => {
  // A stem absent from _registry.json means "we have no badge art", not "the
  // holder does not hold it". Reporting not-found on that basis would be a wrong
  // answer about a real credential.
  const UNREGISTERED = "aa".repeat(28) + "." + "bb".repeat(32);
  const v = arrivalVerdict({
    ok: true, holderState: holderState([UNREGISTERED]), arrivedStem: UNREGISTERED,
    registry: REGISTRY, keyEpochSuspended: false,
  });
  assert.equal(v.state, BADGE_STATES.ANCHORED,
    "held-but-unregistered is anchored, never not-found");
});

test("arrivalVerdict: a failed read is INDETERMINATE, never not-found", () => {
  // Conflating "we couldn't read" with "they don't hold it" would turn an outage
  // into an accusation.
  const v = arrivalVerdict({ ok: false, arrivedStem: STEM });
  assert.deepEqual(v, { state: VERDICTS.INDETERMINATE, stem: STEM });

  const malformed = arrivalVerdict({ ok: true, holderState: holderState([]), arrivedStem: "nothex" });
  assert.deepEqual(malformed, { state: VERDICTS.INDETERMINATE, stem: null });

  const garbage = arrivalVerdict({
    ok: true, holderState: { completed_courses: 42 }, arrivedStem: STEM, registry: REGISTRY,
  });
  assert.equal(garbage.state, VERDICTS.INDETERMINATE, "unparseable state -> indeterminate");
});

test("arrivalVerdict NEVER returns revoked-signal, for any input (plan KTD-2)", () => {
  const holderStates = [
    holderState([]), holderState([STEM]), holderState([OTHER]),
    null, undefined, {}, { completed_courses: 42 },
  ];
  for (const ok of [true, false]) {
    for (const holderState_ of holderStates) {
      for (const keyEpochSuspended of [true, false, null]) {
        const v = arrivalVerdict({
          ok, holderState: holderState_ as any, arrivedStem: STEM,
          registry: REGISTRY, keyEpochSuspended,
        });
        assert.ok(Object.values(VERDICTS).includes(v.state), `unknown verdict "${v.state}"`);
        assert.ok(!/revok/i.test(v.state), "absence must never be reported as revoked");
      }
    }
  }
});

test("loadHolderView returns a verdict on BOTH the ok and the fail-loud paths", async () => {
  const ok = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch() });
  assert.equal(ok.verdict.state, BADGE_STATES.SIGNATURE_UNAVAILABLE);

  const failed = await loadHolderView({
    stem: STEM, alias: "james",
    fetchImpl: stubFetch({ state: () => res(null, { ok: false, status: 502 }) }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.verdict.state, VERDICTS.INDETERMINATE,
    "a failed load still answers the URL's question, explicitly");
});

test("loadHolderView surfaces not-found for a holder who doesn't hold the arrived badge", async () => {
  const view = await loadHolderView({
    stem: STEM, alias: "james",
    fetchImpl: stubFetch({ state: () => res(holderState([OTHER])) }),
  });
  assert.equal(view.ok, true);
  assert.equal(view.verdict.state, VERDICTS.NOT_FOUND);
  assert.equal(view.badges.length, 1, "the badges they DO hold are still listed");
});

// ---- Course-owner attribution (multi-party visibility) ---------------------

test("courseOwners maps course_id -> owner and drops unusable rows", () => {
  assert.deepEqual(courseOwners(COMPLETED), {
    [STEM.split(".")[0]]: "james",
    [OTHER.split(".")[0]]: "cardano_xp",
  });
  assert.deepEqual(courseOwners([{ course_id: "x" }, { owner: "y" }, { course_id: "z", owner: "" }, null]), {},
    "a row without a usable (course_id, owner) pair contributes nothing");
  assert.deepEqual(courseOwners(null as any), {}, "non-array upstream -> empty, never a throw");
});

test("buildViewModel folds in the course owner and omits it when unknown", () => {
  const withOwners = buildViewModel({
    holderState: holderState([STEM, OTHER]), registry: REGISTRY,
    keyEpochSuspended: false, arrivedStem: null, owners: courseOwners(COMPLETED),
  });
  assert.equal(withOwners.find((b) => b.stem === STEM)!.courseOwner, "james");
  assert.equal(withOwners.find((b) => b.stem === STEM)!.courseId, STEM.split(".")[0]);

  const without = buildViewModel({
    holderState: holderState([STEM]), registry: REGISTRY,
    keyEpochSuspended: false, arrivedStem: null,
  });
  assert.equal(without[0].courseOwner, null, "omitted, never blank-filled or guessed");
});

test("the course-owner read is SOFT — its failure never downgrades the view (R7)", async () => {
  for (const broken of [
    () => res(null, { ok: false, status: 503 }),
    () => { throw new Error("network"); },
    () => resThrow(),
    () => res({ not: "an array" }),
  ]) {
    const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ completed: broken }) });
    assert.equal(view.ok, true, "a soft failure must not fail the view");
    assert.equal(view.verdict.state, BADGE_STATES.SIGNATURE_UNAVAILABLE, "state is unchanged");
    assert.equal(view.badges.find((b: any) => b.stem === STEM).courseOwner, null,
      "no owner rendered rather than a wrong one");
  }
});
