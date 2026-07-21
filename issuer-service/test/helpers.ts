// Hermetic test harness: a fixture-backed `fetch` for the anchor gate's
// Andamioscan + badge-host reads. Every fixture under test/fixtures/ is a
// REAL RECORDED RESPONSE for the known subject credential (James's mainnet
// "Andamio Issuer" credential — the spike/signer-spike subject), recorded
// 2026-07-21. Any URL outside the fixture set throws, so a test can never
// silently reach the network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

export function fixture(name: string): any {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
}

// The known subject (full identifiers — never truncated).
export const SUBJECT = {
  network: "mainnet",
  alias: "james",
  courseId: "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df",
  sltHash: "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db",
  claimTxHash: "7cb75099e81644b8ce2442e2cacf4e6dafdba54991a8599e0f88f5432dd2cb03",
  slot: 190131814,
  blockTime: "2026-06-17T12:08:25Z",
  studentStateAsset: "gjames",
} as const;

const SCAN = "https://andamioscan.io";
const BADGE_HOST = "https://credentials.andamio.io";

function json(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function notFound(): Response {
  return new Response("404 page not found", { status: 404 });
}

export interface FixtureFetchOpts {
  /** Return a Response to override the default for a URL; undefined = default. */
  override?: (url: string, init?: RequestInit) => Response | undefined;
}

export interface FixtureFetch {
  fetchImpl: typeof fetch;
  calls: string[];
}

export function makeFixtureFetch(opts: FixtureFetchOpts = {}): FixtureFetch {
  const state = fixture("scan-users-james-state.json");
  const claimEvent = fixture("scan-claim-event-7cb75099.json");
  const courseDetails = fixture("scan-course-details-ae192632.json");
  const completed = fixture("scan-users-james-courses-completed.json");
  const txIndex: any[] = fixture("scan-transactions-index.json").rows;

  const calls: string[] = [];

  const fetchImpl = (async (input: any, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);

    const overridden = opts.override?.(url, init);
    if (overridden !== undefined) return overridden;

    const u = new URL(url);
    const base = `${u.protocol}//${u.host}`;
    const p = u.pathname;

    if (base === SCAN) {
      if (p === `/api/v2/users/${SUBJECT.alias}/state`) return json(200, state);
      if (p.startsWith("/api/v2/users/") && p.endsWith("/state")) return notFound();

      if (p === "/api/v2/transactions") {
        const limit = Number(u.searchParams.get("limit") ?? 20);
        const page = Number(u.searchParams.get("page") ?? 1);
        const start = (page - 1) * limit;
        return json(200, {
          data: txIndex.slice(start, start + limit),
          meta: {
            current_page: page,
            total_pages: Math.ceil(txIndex.length / limit),
            total_count: txIndex.length,
            limit,
          },
        });
      }

      const claimMatch = p.match(/^\/api\/v2\/events\/credential-claims\/claim\/([0-9a-f]{64})$/);
      if (claimMatch) {
        // Only the subject's claim tx resolves; other claim rows in the real
        // index snapshot are other people's claims — the fixture set records
        // only the subject's event, so they 404 here (same shape Andamioscan
        // gives for a tx that is not a classifier-confirmed claim).
        if (claimMatch[1] === SUBJECT.claimTxHash) return json(200, claimEvent);
        return notFound();
      }

      if (p === `/api/v2/courses/${SUBJECT.courseId}/details`) return json(200, courseDetails);
      if (/^\/api\/v2\/courses\/[0-9a-f]{56}\/details$/.test(p)) return notFound();

      if (p === `/api/v2/users/${SUBJECT.alias}/courses/completed`) return json(200, completed);
      if (p.startsWith("/api/v2/users/") && p.endsWith("/courses/completed")) return notFound();

      throw new Error(`fixture fetch: unmocked Andamioscan URL ${url}`);
    }

    if (base === BADGE_HOST) {
      if (p === `/badges/${SUBJECT.courseId}.${SUBJECT.sltHash}.svg`) {
        return new Response(null, { status: 200 });
      }
      if (p.startsWith("/badges/")) return notFound();
      throw new Error(`fixture fetch: unmocked badge-host URL ${url}`);
    }

    throw new Error(`fixture fetch: refusing non-fixture URL ${url}`);
  }) as typeof fetch;

  return { fetchImpl, calls };
}
