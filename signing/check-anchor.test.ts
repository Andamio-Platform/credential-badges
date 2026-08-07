// Rung 8 · Anchor-gate tests (issue #54, findings 3, 4-code, 5).
//
// The gate is SEALED (no parameters), so its refusal paths are exercised
// hermetically by mocking `fetch` with a fake Andamioscan — no subject
// override, no network, no npm install (node builtins only).
//
// The fake index simulates a mainnet history 10,000 transactions deep with the
// pinned claim tx buried ~9,000 rows down — far past the old linear scan's
// ~2,000-row window — to prove the slot binary search stays valid as history
// grows (finding 5), in O(log pages) requests.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { checkAnchor, SUBJECT } from "./check-anchor.ts";

const SCAN = "https://andamioscan.io";

// The real on-chain SLT texts for the pinned module — blake2b-256 over their
// Plutus Data CBOR encoding equals SUBJECT.sltHash (see slt-hash.test.ts).
const REAL_SLTS = [
  "I can explain how the Andamio Issuer product differs from the Andamio API.",
  "I can identify the target market for the Andamio Issuer product.",
  "I can find the documentation and resources that support Andamio Issuer.",
];

const TX_LIMIT = 50;
const TOTAL_ROWS = 10_000;
const PINNED_INDEX = 9_000; // 0-based position of the claim tx in the index
const SLOT_STEP = 5;
const TOP_SLOT = SUBJECT.slot + PINNED_INDEX * SLOT_STEP;

interface FakeOptions {
  claim?: any;
  slts?: string[] | null; // null -> module missing entirely
  pinnedIndex?: number | null; // null -> tx absent from the index
  pinnedRow?: Partial<{ slot: number; event_type: string }>;
  completed?: any[];
}

// Builds the slot-descending transactions index row for global index i.
function makeRow(i: number, opts: FakeOptions): any {
  const pinnedIndex = opts.pinnedIndex === undefined ? PINNED_INDEX : opts.pinnedIndex;
  if (pinnedIndex !== null && i === pinnedIndex) {
    return {
      tx_hash: SUBJECT.claimTxHash,
      slot: TOP_SLOT - i * SLOT_STEP,
      event_type: "StudentCourseCredentialClaim",
      ...opts.pinnedRow,
    };
  }
  return {
    tx_hash: `synthetic-tx-${i}`,
    slot: TOP_SLOT - i * SLOT_STEP,
    event_type: i % 3 === 0 ? "StudentCourseAssignmentCommit" : "ManagerProjectTasksManage",
  };
}

const realFetch = globalThis.fetch;
let txPageFetches = 0;

function installFakeAndamioscan(opts: FakeOptions = {}): void {
  txPageFetches = 0;
  const json = (body: any) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);

    if (url === `${SCAN}/api/v2/events/credential-claims/claim/${SUBJECT.claimTxHash}`) {
      return json(
        opts.claim ?? {
          tx_hash: SUBJECT.claimTxHash,
          alias: SUBJECT.alias,
          course_id: SUBJECT.courseId,
          credential_hash: "34d2418e23ba3f8d1aa3468f6b3f60c720bddd8db46bb7b7a72256cb40bdeff8",
          credentials: [SUBJECT.sltHash],
        },
      );
    }

    const txMatch = url.match(
      new RegExp(`^${SCAN}/api/v2/transactions\\?limit=(\\d+)&page=(\\d+)$`),
    );
    if (txMatch) {
      txPageFetches += 1;
      const limit = Number(txMatch[1]);
      const page = Number(txMatch[2]);
      const start = (page - 1) * limit;
      const rows = [];
      for (let i = start; i < Math.min(start + limit, TOTAL_ROWS); i++) {
        rows.push(makeRow(i, opts));
      }
      return json({
        data: rows,
        meta: {
          current_page: page,
          total_pages: Math.ceil(TOTAL_ROWS / limit),
          total_count: TOTAL_ROWS,
          limit,
        },
      });
    }

    if (url === `${SCAN}/api/v2/courses/${SUBJECT.courseId}/details`) {
      const modules =
        opts.slts === null
          ? []
          : [
              {
                slt_hash: SUBJECT.sltHash,
                module: { slts: opts.slts ?? REAL_SLTS, prerequisites: null },
                created_by: "james",
              },
            ];
      return json({ course_id: SUBJECT.courseId, owner: "james", modules });
    }

    if (url === `${SCAN}/api/v2/users/${SUBJECT.alias}/courses/completed`) {
      return json(opts.completed ?? [{ course_id: SUBJECT.courseId }]);
    }

    if (
      url === `https://credentials.andamio.io/badges/${SUBJECT.courseId}.${SUBJECT.sltHash}.svg` &&
      init?.method === "HEAD"
    ) {
      return new Response(null, { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("checkAnchor is SEALED: takes no parameters (no caller-supplied subject override)", () => {
  assert.equal(checkAnchor.length, 0, "checkAnchor must accept no arguments");
});

test("gate passes on a faithful deep index, and byte-pins the hash-verified SLT texts", async () => {
  installFakeAndamioscan();
  const anchor = await checkAnchor();
  assert.equal(anchor.sltHash, SUBJECT.sltHash);
  assert.deepEqual(anchor.slts, REAL_SLTS);
  assert.equal(anchor.slot, SUBJECT.slot);
  assert.equal(anchor.courseOwner, "james");
});

test("binary search finds a tx buried 9,000 rows deep in O(log pages) requests, not a linear scan", async () => {
  installFakeAndamioscan();
  await checkAnchor();
  // 200 pages at limit 50. The old linear scan needed ~181 page fetches (and
  // was hard-capped at 40 -> spurious fail-closed). log2(200) ~ 7.6; allow
  // generous headroom for the first page, neighbor checks, and the retry.
  assert.ok(
    txPageFetches <= 25,
    `expected O(log pages) page fetches, got ${txPageFetches}`,
  );
});

test("REFUSES when the claim tx is absent from the transactions index", async () => {
  installFakeAndamioscan({ pinnedIndex: null });
  await assert.rejects(() => checkAnchor(), /not found in the transactions index/);
});

test("REFUSES when the indexed slot does not match the pinned slot", async () => {
  // Keep the index consistent (sorted, unique tx hashes) but lie about the
  // pinned row's slot by one step. The neighbor-page scan still finds the tx;
  // the gate must then reject the slot mismatch.
  installFakeAndamioscan({
    pinnedIndex: PINNED_INDEX - 1,
    pinnedRow: { slot: TOP_SLOT - (PINNED_INDEX - 1) * SLOT_STEP },
  });
  await assert.rejects(() => checkAnchor(), /slot mismatch/);
});

test("REFUSES when the tx is indexed under a different event type", async () => {
  installFakeAndamioscan({ pinnedRow: { event_type: "StudentCourseAssignmentCommit" } });
  await assert.rejects(() => checkAnchor(), /indexed as StudentCourseAssignmentCommit/);
});

test("REFUSES a tampered claim event alias", async () => {
  installFakeAndamioscan({
    claim: {
      tx_hash: SUBJECT.claimTxHash,
      alias: "mallory",
      course_id: SUBJECT.courseId,
      credentials: [SUBJECT.sltHash],
    },
  });
  await assert.rejects(() => checkAnchor(), /alias mismatch/);
});

test("REFUSES a claim event whose credentials do not include the pinned slt_hash", async () => {
  installFakeAndamioscan({
    claim: {
      tx_hash: SUBJECT.claimTxHash,
      alias: SUBJECT.alias,
      course_id: SUBJECT.courseId,
      credentials: ["0000000000000000000000000000000000000000000000000000000000000000"],
    },
  });
  await assert.rejects(() => checkAnchor(), /does not include slt_hash/);
});

test("REFUSES tampered SLT text: hash(slts) != slt_hash (finding 3)", async () => {
  installFakeAndamioscan({
    slts: [
      REAL_SLTS[0],
      REAL_SLTS[1],
      "I can find the documentation and resources that support Andamio Issuer!",
    ],
  });
  await assert.rejects(
    () => checkAnchor(),
    /SLT text does not match the on-chain commitment/,
  );
});

test("REFUSES an EMPTY slts array — never signs an empty narrative (finding 3)", async () => {
  installFakeAndamioscan({ slts: [] });
  await assert.rejects(() => checkAnchor(), /EMPTY slts array/);
});

test("REFUSES when the module is missing from course details", async () => {
  installFakeAndamioscan({ slts: null });
  await assert.rejects(() => checkAnchor(), /has no module with slt_hash/);
});

test("REFUSES when the recipient's completed courses do not include the course", async () => {
  installFakeAndamioscan({ completed: [{ course_id: "deadbeef" }] });
  await assert.rejects(() => checkAnchor(), /completed-courses list does not include/);
});
