// The anchor gate (the signing-oracle guard), generalized to ANY registered
// badge + recipient. Origin: spike/signer-spike/check-anchor.ts (Rung 6,
// hardened at Rung 8 per issue #54 findings 3, 4, 5) — the checks are the
// spike's, with the spike's single pinned SUBJECT generalized to a
// server-side-resolved subject.
//
// Issue #54 finding 4 (the plan half): the gate lives INSIDE this service —
// the only code path that will ever hold sign permission (the service runs AS
// the sign SA). And there is NO caller-supplied subject override: the caller
// names a (network, policyId, sltHash, recipient) coordinate, and every field
// that reaches the signer is re-derived from LIVE Andamioscan reads and
// byte-verified against the chain's own commitments. Nothing signable comes
// from request input.
//
// Checks (all must pass; signing is unreachable otherwise):
//   1. GLOBAL-STATE GATE (the deployment plan's core gate, verbatim): the
//      recipient's current global-state credential map contains the course
//      (policyId) AND the on-chain claimed-credential hash for it byte-equals
//      the requested sltHash, AND the state record's alias byte-equals the
//      resolved recipient. (/api/v2/users/{alias}/state)
//   2. The claim tx is DISCOVERED server-side (never caller-supplied): the
//      slot-descending transactions index is scanned for
//      StudentCourseCredentialClaim rows, each resolved at the per-tx claim
//      endpoint until one matches (alias, course_id, credentials ∋ sltHash).
//      A warm locator cache short-circuits the scan; the cached (tx, slot) is
//      then re-verified by the spike's BINARY SEARCH over the slot-descending
//      index (O(log pages), decay-proof — finding 5) plus a fresh per-tx
//      claim-event re-read, so a poisoned locator entry can never survive.
//   3. The claim event's (tx_hash, alias, course_id, credentials) byte-equal
//      the resolved subject.
//   4. Course details: the sltHash is a real module credential, its SLT texts
//      are non-empty, and Blake2b-256 over their Plutus Data CBOR encoding
//      equals the sltHash (finding 3 — the text that gets signed into
//      criteria.narrative is exactly what the chain commits to).
//   5. The recipient's completed-courses list contains the course.
//   6. block_time is DERIVED from the discovered slot (mainnet Shelley
//      formula) — the deterministic source for validFrom / proof.created.
//   7. The production badge SVG for <courseId>.<sltHash> is live (HTTP 200).

import { computeSltHash } from "./slt-hash.ts";
import { SCAN_URL, STATIC_HOST } from "./config.ts";

// Cardano mainnet: Shelley starts at absolute slot 4492800 = 2020-07-29T21:44:51Z
// (unix 1596059091); 1 slot = 1 second thereafter.
const SHELLEY_START_UNIX = 1596059091;
const SHELLEY_START_SLOT = 4492800;

export function slotToBlockTime(slot: number): string {
  const unix = SHELLEY_START_UNIX + (slot - SHELLEY_START_SLOT);
  return new Date(unix * 1000).toISOString().replace(/\.000Z$/, "Z");
}

export interface Subject {
  network: string;
  courseId: string;
  sltHash: string;
  alias: string;
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

/** The chain does not support the request: unknown-claim (nothing on chain
 *  for this coordinate) vs anchor-mismatch (chain data exists but CONFLICTS
 *  with what the request names — e.g. SLT text no longer hashes to the
 *  commitment). Both refuse with ZERO KMS operations. */
export class GateRefusal extends Error {
  readonly kind: "unknown-claim" | "anchor-mismatch";
  readonly reason: string;
  constructor(kind: "unknown-claim" | "anchor-mismatch", reason: string) {
    super(`ANCHOR GATE REFUSED (${kind}): ${reason}`);
    this.kind = kind;
    this.reason = reason;
  }
}

/** The gate could not complete its reads (indexer/static host unreachable or
 *  5xx). Never surfaced as a refusal — an honest 503, never a signed doc. */
export class UpstreamError extends Error {}

export type FetchLike = typeof fetch;

const TX_PAGE_LIMIT = 100;

interface GateDeps {
  fetchImpl: FetchLike;
  courseTitle: string;
  moduleTitle: string;
  /** Warm (alias/courseId.sltHash) -> {txHash, slot} locator entries. Always
   *  re-verified against the live index + per-tx claim event before use. */
  locatorCache: Map<string, { txHash: string; slot: number }>;
}

function makeGetJson(fetchImpl: FetchLike) {
  return async (url: string): Promise<any> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new UpstreamError(`GET ${url} failed: ${(e as Error).message}`);
    }
    if (res.status === 404) return null; // semantic not-found, caller decides
    if (!res.ok) throw new UpstreamError(`GET ${url} -> HTTP ${res.status}`);
    return res.json();
  };
}

// Locate a KNOWN (txHash, slot) in the Andamioscan transactions index by
// binary search over the slot-descending pages — ported from the spike
// (issue #54 finding 5: decay-proof however deep the tx sinks). Returns the
// index row or null.
export async function findClaimTxRow(
  getJson: (url: string) => Promise<any>,
  txHash: string,
  slot: number,
): Promise<any | null> {
  const attempt = async (): Promise<any | null> => {
    const first = await getJson(
      `${SCAN_URL}/api/v2/transactions?limit=${TX_PAGE_LIMIT}&page=1`,
    );
    if (first === null) return null;
    const totalPages = Math.max(1, first.meta?.total_pages ?? 1);

    const rowsOf = (listing: any): any[] => listing?.data ?? [];
    const findIn = (rows: any[]): any | null =>
      rows.find((r: any) => r.tx_hash === txHash) ?? null;

    const pageCache = new Map<number, any[]>([[1, rowsOf(first)]]);
    const getPage = async (p: number): Promise<any[]> => {
      if (p < 1 || p > totalPages) return [];
      if (!pageCache.has(p)) {
        const listing = await getJson(
          `${SCAN_URL}/api/v2/transactions?limit=${TX_PAGE_LIMIT}&page=${p}`,
        );
        pageCache.set(p, rowsOf(listing));
      }
      return pageCache.get(p)!;
    };

    let lo = 1;
    let hi = totalPages;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rows = await getPage(mid);
      if (rows.length === 0) return null; // index shrank mid-search; retry
      const hit = findIn(rows);
      if (hit) return hit;
      const maxSlot = rows[0].slot;
      const minSlot = rows[rows.length - 1].slot;
      if (slot > maxSlot) {
        hi = mid - 1; // pinned slot is newer -> earlier pages
      } else if (slot < minSlot) {
        lo = mid + 1; // pinned slot is older -> later pages
      } else {
        // Slot ties can straddle a page boundary, and concurrent inserts can
        // shift rows by up to a page. Check both neighbors.
        return findIn(await getPage(mid - 1)) ?? findIn(await getPage(mid + 1));
      }
    }
    return null;
  };

  return (await attempt()) ?? (await attempt());
}

// Server-side claim-tx discovery: walk the index newest-first, resolve each
// StudentCourseCredentialClaim row at the per-tx claim endpoint, stop at the
// first event matching (alias, courseId, credentials ∋ sltHash).
async function discoverClaimTx(
  getJson: (url: string) => Promise<any>,
  s: Subject,
): Promise<{ txHash: string; slot: number; event: any } | null> {
  let page = 1;
  for (;;) {
    const listing = await getJson(
      `${SCAN_URL}/api/v2/transactions?limit=${TX_PAGE_LIMIT}&page=${page}`,
    );
    if (listing === null) return null;
    const rows: any[] = listing.data ?? [];
    if (rows.length === 0) return null;
    for (const row of rows) {
      if (row.event_type !== "StudentCourseCredentialClaim") continue;
      const event = await getJson(
        `${SCAN_URL}/api/v2/events/credential-claims/claim/${row.tx_hash}`,
      );
      if (event === null) continue; // not classifier-confirmed at that path
      if (
        event.alias === s.alias &&
        event.course_id === s.courseId &&
        Array.isArray(event.credentials) &&
        event.credentials.includes(s.sltHash)
      ) {
        return { txHash: row.tx_hash, slot: row.slot, event };
      }
    }
    const totalPages = Math.max(1, listing.meta?.total_pages ?? 1);
    if (page >= totalPages) return null;
    page += 1;
  }
}

export async function checkAnchor(s: Subject, deps: GateDeps): Promise<Anchor> {
  const getJson = makeGetJson(deps.fetchImpl);
  const endpoints: string[] = [];
  const hit = async (p: string) => {
    endpoints.push(p);
    return getJson(SCAN_URL + p);
  };
  const refuse = (kind: "unknown-claim" | "anchor-mismatch", reason: string): never => {
    throw new GateRefusal(kind, reason);
  };

  // 1. GLOBAL-STATE GATE: (policyId, sltHash, alias) against the recipient's
  // CURRENT on-chain global state.
  const state = await hit(`/api/v2/users/${s.alias}/state`);
  if (state === null)
    refuse("unknown-claim", `alias ${s.alias} has no on-chain global state`);
  if (state.alias !== s.alias)
    refuse("anchor-mismatch", `global state alias mismatch: expected ${s.alias}, got ${state.alias}`);
  const stateCourse = (state.completed_courses ?? []).find(
    (c: any) => c.course_id === s.courseId,
  );
  if (!stateCourse)
    refuse(
      "unknown-claim",
      `course ${s.courseId} is not in the credential map of ${s.alias}'s current global-state datum`,
    );
  if (!(stateCourse.claimed_credentials ?? []).includes(s.sltHash))
    refuse(
      "unknown-claim",
      `credential ${s.sltHash} is not among the claimed credentials for course ${s.courseId} in ${s.alias}'s current global-state datum`,
    );

  // 2. Claim-tx discovery (server-side; never caller-supplied) + decay-proof
  // binary-search verification of the (tx, slot) coordinate.
  const locatorKey = `${s.alias}/${s.courseId}.${s.sltHash}`;
  let txHash: string;
  let slot: number;
  let event: any;
  const cached = deps.locatorCache.get(locatorKey);
  if (cached) {
    // Warm path: re-verify the cached coordinate from the live index (binary
    // search, O(log pages)) and re-read the per-tx claim event fresh.
    endpoints.push(`/api/v2/transactions?limit=${TX_PAGE_LIMIT}&page=<slot-binary-search>`);
    const row = await findClaimTxRow(getJson, cached.txHash, cached.slot);
    event = row === null ? null : await hit(`/api/v2/events/credential-claims/claim/${cached.txHash}`);
    if (
      row === null ||
      event === null ||
      row.event_type !== "StudentCourseCredentialClaim" ||
      row.slot !== cached.slot
    ) {
      deps.locatorCache.delete(locatorKey); // poisoned/stale — fall back to discovery
      event = null;
    }
    txHash = cached.txHash;
    slot = cached.slot;
  } else {
    txHash = "";
    slot = 0;
    event = null;
  }
  if (event === null) {
    endpoints.push(
      `/api/v2/transactions?limit=${TX_PAGE_LIMIT}&page=<discovery-scan>` ,
    );
    const found = await discoverClaimTx(getJson, s);
    if (found === null)
      refuse(
        "unknown-claim",
        `no StudentCourseCredentialClaim event matches (alias=${s.alias}, course_id=${s.courseId}, credential=${s.sltHash}) in the transactions index`,
      );
    ({ txHash, slot, event } = found!);
    // Decay-proof re-location of the discovered coordinate (finding 5) — the
    // same check the warm path runs, so both paths pin (tx, slot) identically.
    const row = await findClaimTxRow(getJson, txHash, slot);
    if (!row)
      refuse("anchor-mismatch", `discovered claim tx ${txHash} did not re-locate in the transactions index at slot ${slot}`);
    if (row.event_type !== "StudentCourseCredentialClaim")
      refuse("anchor-mismatch", `tx ${txHash} indexed as ${row.event_type}, not StudentCourseCredentialClaim`);
    if (row.slot !== slot)
      refuse("anchor-mismatch", `tx ${txHash} slot mismatch: discovered ${slot}, index says ${row.slot}`);
  }

  // 3. Claim-event byte-equality against the resolved subject.
  if (event.tx_hash !== txHash)
    refuse("anchor-mismatch", `claim event tx_hash mismatch: ${event.tx_hash} != ${txHash}`);
  if (event.alias !== s.alias)
    refuse("anchor-mismatch", `claim event alias mismatch: expected ${s.alias}, got ${event.alias}`);
  if (event.course_id !== s.courseId)
    refuse("anchor-mismatch", `claim event course_id mismatch: expected ${s.courseId}, got ${event.course_id}`);
  if (!Array.isArray(event.credentials) || !event.credentials.includes(s.sltHash))
    refuse(
      "anchor-mismatch",
      `claim event credentials [${(event.credentials ?? []).join(", ")}] does not include slt_hash ${s.sltHash}`,
    );

  // 4. Course details: sltHash is a real module credential and its SLT texts
  // hash to EXACTLY the requested sltHash (finding 3).
  const course = await hit(`/api/v2/courses/${s.courseId}/details`);
  if (course === null) refuse("unknown-claim", `course ${s.courseId} not found on-chain`);
  if (course.course_id !== s.courseId)
    refuse("anchor-mismatch", `course details id mismatch: ${course.course_id}`);
  const module_ = (course.modules ?? []).find((m: any) => m.slt_hash === s.sltHash);
  if (!module_)
    refuse("unknown-claim", `course ${s.courseId} has no module with slt_hash ${s.sltHash}`);
  const slts: string[] = module_.module?.slts ?? [];
  if (slts.length === 0)
    refuse(
      "anchor-mismatch",
      `course ${s.courseId} module ${s.sltHash} returned an EMPTY slts array — refusing to sign a credential with no SLT text`,
    );
  if (!slts.every((t) => typeof t === "string"))
    refuse("anchor-mismatch", `course ${s.courseId} module ${s.sltHash} slts array contains non-string entries`);
  const derivedSltHash = computeSltHash(slts);
  if (derivedSltHash !== s.sltHash)
    refuse(
      "anchor-mismatch",
      `SLT text does not match the on-chain commitment: blake2b_256(plutus_cbor(slts)) = ${derivedSltHash}, expected slt_hash ${s.sltHash} — the fetched SLT text is not what the chain committed to`,
    );
  if (typeof course.owner !== "string" || course.owner.length === 0)
    refuse("anchor-mismatch", `course ${s.courseId} details carry no owner alias`);

  // 5. Recipient's completed courses include this course.
  const completed = await hit(`/api/v2/users/${s.alias}/courses/completed`);
  if (!(completed ?? []).some((c: any) => c.course_id === s.courseId))
    refuse(
      "anchor-mismatch",
      `alias ${s.alias} completed-courses list does not include ${s.courseId} despite the global-state credential map naming it`,
    );

  // 6. Deterministic block_time from the discovered slot.
  const blockTime = slotToBlockTime(slot);

  // 7. Production badge is live.
  const badgeUrl = `${STATIC_HOST}/badges/${s.courseId}.${s.sltHash}.svg`;
  let badgeRes: Response;
  try {
    badgeRes = await deps.fetchImpl(badgeUrl, { method: "HEAD" });
  } catch (e) {
    throw new UpstreamError(`HEAD ${badgeUrl} failed: ${(e as Error).message}`);
  }
  if (badgeRes.status !== 200)
    throw new UpstreamError(`badge ${badgeUrl} -> HTTP ${badgeRes.status} (registered badge artifact not being served — refusing to sign)`);

  // The gate PASSED — only now does the locator become warm.
  deps.locatorCache.set(locatorKey, { txHash, slot });

  return {
    network: s.network,
    alias: s.alias,
    courseId: s.courseId,
    sltHash: s.sltHash,
    claimTxHash: txHash,
    slot,
    blockTime,
    // Andamio V2 Access Token (Scaffolding Era) global-state asset for the
    // recipient: ASCII "g" + alias (same derivation as the spike's committed
    // real-recipient sample).
    studentStateAsset: `g${s.alias}`,
    courseOwner: course.owner,
    courseTitle: deps.courseTitle,
    moduleTitle: deps.moduleTitle,
    // Byte-pinned into the anchor record AND hash-verified above: these exact
    // strings are what mapCredential signs into criteria.narrative.
    slts,
    badgeUrl,
    provenance: {
      checkedAt: new Date().toISOString(),
      source: SCAN_URL,
      endpoints,
    },
  };
}
