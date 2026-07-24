// Tests for the holder viewer client module (badges/_holder.js, #73).
//
// Exercises the pure logic that carries the correctness risk: URL parsing, the
// status-list bit decode (ported from issuer-service/src/status-list.ts), the
// holder-state ∩ registry view model, the certUrl builder, and — most
// importantly — the FAIL-LOUD contract (R6): a holder-state load failure must
// never yield badges shown as verified.
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
  certUrlFor,
  loadHolderView,
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

// A fetch stub routing by URL substring. Any key can be overridden to fail.
function stubFetch(overrides: Record<string, () => any> = {}) {
  return async (url: string) => {
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
  assert.equal(flagship.state, "signed", "signed + not suspended -> signed");
  const other = badges.find((b) => b.stem === OTHER)!;
  assert.equal(other.state, "anchored", "unsigned -> anchored");
});

test("buildViewModel marks signed badges suspended / unknown correctly", () => {
  const suspended = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: true, arrivedStem: null });
  assert.equal(suspended[0].state, "suspended", "signed + key-epoch set -> suspended");
  const unknown = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: null, arrivedStem: null });
  assert.equal(unknown[0].state, "unknown", "signed + status unavailable -> unknown, never silent ok");
  // an UNSIGNED badge is anchored regardless of the key-epoch bit
  const unsigned = buildViewModel({ holderState: holderState([OTHER]), registry: REGISTRY, keyEpochSuspended: true, arrivedStem: null });
  assert.equal(unsigned[0].state, "anchored");
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

test("loadHolderView degrades to 'unknown' when only the status list fails", async () => {
  const view = await loadHolderView({ stem: STEM, alias: "james", fetchImpl: stubFetch({ status: () => res(null, { ok: false, status: 500 }) }) });
  assert.equal(view.ok, true, "holder state loaded -> view is ok");
  const flagship = view.badges.find((b: any) => b.stem === STEM);
  assert.equal(flagship.state, "unknown", "signed badge with no status read -> unknown, never silent signed");
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

test("buildViewModel treats a non-boolean suspension as 'unknown', never 'signed' (R6)", () => {
  // A future refactor passing undefined instead of null must NOT fabricate signed.
  const badges = buildViewModel({ holderState: holderState([STEM]), registry: REGISTRY, keyEpochSuspended: undefined, arrivedStem: null });
  assert.equal(badges[0].state, "unknown");
});
