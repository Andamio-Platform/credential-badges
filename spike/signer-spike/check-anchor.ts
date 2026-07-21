// Rung 6 · Anchor gate (the signing-oracle guard).
//
// Verifies, against LIVE Andamioscan mainnet data, that the subject credential's
// on-chain anchor is real and matches the pinned subject identity BEFORE any
// signing is allowed. `sign.ts` imports `checkAnchor()` and calls it in-process:
// if any check below fails, `checkAnchor` throws and the signer exits with ZERO
// KMS operations. This is the deployment plan's "signing is HARD-gated on a
// positive on-chain anchor check" decision, scoped to the spike's one subject.
//
// Checks (all must pass):
//   1. The claim event resolves for the pinned tx hash, and its
//      (course_id, credentials[]) pair byte-equals the pinned
//      (courseId, sltHash), and its alias byte-equals the pinned recipient.
//   2. The tx appears in the Andamioscan transactions index as a
//      StudentCourseCredentialClaim at the pinned slot (tx/slot confirmed).
//   3. The course exists on-chain with the pinned sltHash among its modules.
//   4. The recipient's completed-courses list contains the course.
//   5. The claim-tx block_time derived from the slot (Cardano mainnet Shelley
//      formula) equals the pinned block_time — the deterministic source for
//      validFrom / proof.created.
//   6. The production badge for <courseId>.<sltHash> is live (HTTP 200).
//
// Usage: npm run check-anchor      (writes out/anchor.json on success)

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCAN = "https://andamioscan.io";
const BADGE_HOST = "https://credentials.andamio.io";

// Pinned subject — James's Andamio Issuer credential on MAINNET.
// Full identifiers, re-derived live from Andamioscan on 2026-07-21 and
// re-verified against the same source on every run of this gate.
export const SUBJECT = {
  network: "mainnet",
  alias: "james",
  courseId: "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df",
  sltHash: "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db",
  claimTxHash: "7cb75099e81644b8ce2442e2cacf4e6dafdba54991a8599e0f88f5432dd2cb03",
  slot: 190131814,
  blockTime: "2026-06-17T12:08:25Z",
  // Andamio V2 Access Token (Scaffolding Era) global-state asset for the
  // recipient: ASCII "g" + alias. Same derivation as the committed
  // real-recipient sample (globalStateAssetNameAscii "gjames" for alias
  // "james" — spike/samples/sustain-and-maintain-gimbalabs-james-real.jsonld).
  studentStateAsset: "gjames",
  courseTitle: "Andamio Issuer",
  moduleTitle: "About Andamio Issuer",
} as const;

// Cardano mainnet: Shelley starts at absolute slot 4492800 = 2020-07-29T21:44:51Z
// (unix 1596059091); 1 slot = 1 second thereafter.
const SHELLEY_START_UNIX = 1596059091;
const SHELLEY_START_SLOT = 4492800;

export function slotToBlockTime(slot: number): string {
  const unix = SHELLEY_START_UNIX + (slot - SHELLEY_START_SLOT);
  return new Date(unix * 1000).toISOString().replace(/\.000Z$/, "Z");
}

export interface Anchor {
  network: string;
  alias: string;
  courseId: string;
  sltHash: string;
  claimTxHash: string;
  slot: number;
  blockTime: string;
  studentStateAsset: string;
  courseOwner: string;
  courseTitle: string;
  moduleTitle: string;
  slts: string[];
  badgeUrl: string;
  provenance: {
    checkedAt: string;
    source: string;
    endpoints: string[];
  };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`anchor gate: GET ${url} -> HTTP ${res.status}`);
  return res.json();
}

function fail(msg: string): never {
  throw new Error(`ANCHOR GATE FAILED: ${msg}`);
}

// `subject` override exists ONLY so the refusal path is testable (a tampered
// pair must throw before any signing). Production callers pass nothing.
export async function checkAnchor(subject: typeof SUBJECT = SUBJECT): Promise<Anchor> {
  const S = subject;
  const endpoints: string[] = [];
  const hit = async (p: string) => {
    endpoints.push(p);
    return getJson(SCAN + p);
  };

  // 1. Claim event: (course_id, slt_hash) pair matches the subject.
  const claim = await hit(`/api/v2/events/credential-claims/claim/${S.claimTxHash}`);
  if (claim.tx_hash !== S.claimTxHash)
    fail(`claim event tx_hash mismatch: ${claim.tx_hash}`);
  if (claim.alias !== S.alias)
    fail(`claim event alias mismatch: expected ${S.alias}, got ${claim.alias}`);
  if (claim.course_id !== S.courseId)
    fail(`claim event course_id mismatch: expected ${S.courseId}, got ${claim.course_id}`);
  if (!Array.isArray(claim.credentials) || !claim.credentials.includes(S.sltHash))
    fail(
      `claim event credentials [${(claim.credentials ?? []).join(", ")}] does not include slt_hash ${S.sltHash}`,
    );

  // 2. Transactions index: tx confirmed as StudentCourseCredentialClaim at the slot.
  let txRow: any = null;
  for (let page = 1; page <= 40 && !txRow; page++) {
    const listing = await getJson(`${SCAN}/api/v2/transactions?limit=50&page=${page}`);
    txRow = (listing.data ?? []).find((r: any) => r.tx_hash === S.claimTxHash) ?? null;
    if (!txRow && page >= (listing.meta?.total_pages ?? page)) break;
  }
  endpoints.push(`/api/v2/transactions?limit=50&page=1..n`);
  if (!txRow) fail(`tx ${S.claimTxHash} not found in the transactions index`);
  if (txRow.event_type !== "StudentCourseCredentialClaim")
    fail(`tx ${S.claimTxHash} indexed as ${txRow.event_type}, not StudentCourseCredentialClaim`);
  if (txRow.slot !== S.slot)
    fail(`tx ${S.claimTxHash} slot mismatch: expected ${S.slot}, got ${txRow.slot}`);

  // 3. Course details: course exists, slt_hash is a real module credential.
  const course = await hit(`/api/v2/courses/${S.courseId}/details`);
  if (course.course_id !== S.courseId) fail(`course details id mismatch: ${course.course_id}`);
  const module_ = (course.modules ?? []).find((m: any) => m.slt_hash === S.sltHash);
  if (!module_) fail(`course ${S.courseId} has no module with slt_hash ${S.sltHash}`);

  // 4. Recipient's completed courses include this course.
  const completed = await hit(`/api/v2/users/${S.alias}/courses/completed`);
  if (!(completed ?? []).some((c: any) => c.course_id === S.courseId))
    fail(`alias ${S.alias} completed-courses list does not include ${S.courseId}`);

  // 5. Deterministic block_time from slot.
  const derived = slotToBlockTime(S.slot);
  if (derived !== S.blockTime)
    fail(`block_time derived from slot ${S.slot} is ${derived}, expected ${S.blockTime}`);

  // 6. Production badge is live.
  const badgeUrl = `${BADGE_HOST}/badges/${S.courseId}.${S.sltHash}.svg`;
  const badgeRes = await fetch(badgeUrl, { method: "HEAD" });
  if (badgeRes.status !== 200) fail(`badge ${badgeUrl} -> HTTP ${badgeRes.status}`);

  return {
    network: S.network,
    alias: S.alias,
    courseId: S.courseId,
    sltHash: S.sltHash,
    claimTxHash: S.claimTxHash,
    slot: S.slot,
    blockTime: S.blockTime,
    studentStateAsset: S.studentStateAsset,
    courseOwner: course.owner,
    courseTitle: S.courseTitle,
    moduleTitle: S.moduleTitle,
    slts: module_.module?.slts ?? [],
    badgeUrl,
    provenance: {
      checkedAt: new Date().toISOString(),
      source: SCAN,
      endpoints,
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  checkAnchor()
    .then(async (anchor) => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const outFile = path.join(here, "out", "anchor.json");
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(outFile, JSON.stringify(anchor, null, 2) + "\n");
      console.log("ANCHOR GATE PASSED");
      console.log(`  alias:        ${anchor.alias}`);
      console.log(`  courseId:     ${anchor.courseId}`);
      console.log(`  sltHash:      ${anchor.sltHash}`);
      console.log(`  claimTxHash:  ${anchor.claimTxHash}`);
      console.log(`  slot:         ${anchor.slot}`);
      console.log(`  blockTime:    ${anchor.blockTime}`);
      console.log(`  courseOwner:  ${anchor.courseOwner}`);
      console.log(`  badge:        ${anchor.badgeUrl} (200)`);
      console.log(`  wrote:        ${outFile}`);
    })
    .catch((e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    });
}
