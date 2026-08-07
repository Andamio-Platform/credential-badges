// Rung 8.3 · BitstringStatusListEntry check for the loopback verifier.
//
// @digitalbazaar/vc refuses to verify a credential that carries
// `credentialStatus` unless a `checkStatus` function is supplied — so the
// subject credential (which now emits its BitstringStatusListEntry per
// Decision 3) needs this hook in every loopback verify.
//
// STATUS-LIST SOURCE — the documented pre-deploy override:
//   - "committed" (default until the deploy ships): the status list URL
//     (https://credentials.andamio.io/status/key-epoch-2026-07.json) is NOT
//     live yet — this PR is what puts the file on the static host. Fetching it
//     would 404. The check instead reads the COMMITTED status/ file — the
//     exact bytes the deploy will serve. The live re-check happens post-tag
//     (deploy checklist in the PR body): flip to "live" and re-run.
//   - "live": fetch the status list from its production URL (the post-deploy
//     posture; no disk involved).
//
// Scope note (same boundary as the rung-1 spike): this check verifies the
// STATUS BIT, not the status list credential's own proof — that artifact's
// signature is verified at signing time (sign-status-list.ts post-sign
// verify) and independently by spruce (transcripts/rung83-spruce-status-list.txt).
// Chain remains authoritative for per-credential state; a set bit means only
// "signing key version not fresh".
//
// Dependency-free (node builtins via status-list.ts) so hermetic tests can
// import it without npm install.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeStatusList, statusBitAt, STATUS_LIST_URL } from "./status-list.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED_STATUS_FILE = path.join(
  HERE, "..", "..", "status", "key-epoch-2026-07.json",
);

export type StatusListSource = "committed" | "live";

async function loadStatusListCredential(source: StatusListSource): Promise<any> {
  if (source === "live") {
    const res = await fetch(STATUS_LIST_URL, {
      headers: { accept: "application/ld+json, application/json" },
    });
    if (!res.ok) throw new Error(`status list fetch ${STATUS_LIST_URL} -> HTTP ${res.status}`);
    return res.json();
  }
  console.log(
    `checkStatus: using COMMITTED status/key-epoch-2026-07.json for ${STATUS_LIST_URL} (pre-deploy override; live re-check happens post-tag)`,
  );
  return JSON.parse(await fs.readFile(COMMITTED_STATUS_FILE, "utf8"));
}

/** checkStatus hook for @digitalbazaar/vc verifyCredential. */
export function makeCheckStatus(source: StatusListSource = "committed") {
  return async function checkStatus({ credential }: { credential: any }) {
    const status = credential.credentialStatus;
    if (!status) return { verified: true };
    try {
      if (status.type !== "BitstringStatusListEntry") {
        throw new Error(`unsupported credentialStatus type: ${status.type}`);
      }
      if (status.statusListCredential !== STATUS_LIST_URL) {
        throw new Error(
          `credentialStatus points at ${status.statusListCredential}, expected ${STATUS_LIST_URL}`,
        );
      }
      const listCred = await loadStatusListCredential(source);
      const subject = listCred.credentialSubject ?? {};
      if (subject.statusPurpose !== status.statusPurpose) {
        throw new Error(
          `statusPurpose mismatch: entry says ${status.statusPurpose}, list says ${subject.statusPurpose}`,
        );
      }
      const bits = decodeStatusList(subject.encodedList);
      const index = Number.parseInt(status.statusListIndex, 10);
      if (!Number.isInteger(index)) {
        // parseInt on a malformed statusListIndex yields NaN, which passes a
        // </>= range guard (NaN comparisons are all false) and would silently
        // read bit 0 — refuse loudly instead.
        throw new Error(
          `statusListIndex is not an integer: ${JSON.stringify(status.statusListIndex)}`,
        );
      }
      if (statusBitAt(bits, index) === 1) {
        throw new Error(
          `credential SUSPENDED at statusListIndex ${index} (signing key version not fresh — chain remains authoritative)`,
        );
      }
      return { verified: true };
    } catch (e) {
      return { verified: false, error: e as Error };
    }
  };
}
