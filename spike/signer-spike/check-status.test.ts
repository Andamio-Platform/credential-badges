// Rung 8.3 follow-up (ADV-7) · checkStatus hook invariants — hermetic (node
// builtins only, no network: the "committed" source reads the repo's status/
// file from disk).
//
// The sharp edge under test: `Number.parseInt` on a malformed statusListIndex
// yields NaN, and NaN passes every </>= range comparison (all false), so an
// unguarded read would silently land on bit 0 and report the credential fresh.
// The hook must refuse instead.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeCheckStatus } from "./check-status.ts";
import { statusListEntry } from "./status-list.ts";

function credentialWithStatus(status: any) {
  return { credential: { credentialStatus: status } };
}

test("a well-formed entry against the committed list verifies (bit 0 is fresh)", async () => {
  const checkStatus = makeCheckStatus("committed");
  const result = await checkStatus(credentialWithStatus(statusListEntry()));
  assert.deepEqual(result, { verified: true });
});

test("a non-integer statusListIndex is REFUSED, never silently read as bit 0", async () => {
  const checkStatus = makeCheckStatus("committed");
  for (const bad of ["banana", "", "NaN"]) {
    const result = await checkStatus(
      credentialWithStatus({ ...statusListEntry(), statusListIndex: bad }),
    );
    assert.equal(result.verified, false, `statusListIndex ${JSON.stringify(bad)} must refuse`);
    assert.match(String((result as any).error), /not an integer/);
  }
});

test("a credential with no credentialStatus passes through", async () => {
  const checkStatus = makeCheckStatus("committed");
  assert.deepEqual(await checkStatus({ credential: {} } as any), { verified: true });
});
