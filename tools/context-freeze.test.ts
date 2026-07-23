// CONTEXT-FREEZE INVARIANT — published JSON-LD context versions never change.
//
// A published, versioned context URL is immutable forever: credentials in the
// wild reference it by URL, and third-party verifiers cache the resolved bytes
// indefinitely (app-level JSON-LD document caches ignore HTTP max-age). An
// in-place edit therefore makes correctly signed credentials fail verification
// deterministically at caching verifiers — that is the 2026-07-21 v0 mutation
// incident (see docs/solutions/conventions/never-mutate-published-jsonld-context.md).
// This test turns that convention into an enforced invariant: any PR that
// changes the bytes of a published context version goes RED here.
//
// Vocabulary changes ship as a NEW version file (/context/v2.jsonld, ...).
// Append the new file's pin to PINNED_CONTEXTS in the SAME PR that publishes it.
//
// Deliberately NOT pinned: status/key-epoch-*.json. The status list is mutable
// by design — the key-compromise kill-switch (tools/flip-status-bit.ts,
// docs/runbooks/key-compromise.md) flips suspension bits in an emergency, and a
// byte pin here would make that runbook a CI-red event at the worst possible
// time. Do not "pin everything" this file into covering /status/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Ground truth. v1 was published as a byte-copy of the post-Rung-8.3 v0, so the
// two versions currently pin to the SAME hash; they diverge the day a v2
// vocabulary change ships (v1 stays frozen at this value forever).
const PINNED_CONTEXTS: Record<string, string> = {
  "context/v0.jsonld":
    "1823b3d6fe67dc271b702e899f53db6cbd0a3171baa50cb1336706768ab6932d",
  "context/v1.jsonld":
    "1823b3d6fe67dc271b702e899f53db6cbd0a3171baa50cb1336706768ab6932d",
};

function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The invariant as a reusable assertion so we can prove it BOTH passes on the
// committed files AND throws on drifted bytes (guard-bites test below).
function assertFrozen(rel: string, bytes: Buffer): void {
  assert.equal(
    sha256Hex(bytes),
    PINNED_CONTEXTS[rel],
    `${rel} has drifted from its published-version pin — published context ` +
      `versions are immutable forever; ship vocabulary changes as a NEW ` +
      `version file and add its pin here in the same PR`,
  );
}

test("every file in context/ has a pin (no unpinned or foreign files)", () => {
  // Without this reconciliation, a future context/v2.jsonld committed WITHOUT
  // a pin entry would be invisible to the freeze invariant — the exact silent
  // gap this test exists to close. The FULL directory listing is compared (no
  // .jsonld filter, no dotfile filter): Dockerfile COPYs context/ wholesale
  // and .dockerignore re-includes context/**, so ANY file here ships and is
  // served publicly. A local failure on a stray file means that file would
  // ship — delete it, don't relax this test. Set-equality also catches
  // deleting a pinned version file.
  const published = readdirSync(repoPath("context"))
    .map((f) => `context/${f}`)
    .sort();
  assert.deepEqual(published, Object.keys(PINNED_CONTEXTS).sort());
});

for (const rel of Object.keys(PINNED_CONTEXTS)) {
  test(`committed ${rel} is byte-identical to its published pin`, () => {
    // A missing file throws loudly here (readFileSync) — deleting a published
    // context version is as much a freeze violation as editing one.
    assertFrozen(rel, readFileSync(repoPath(rel)));
  });
}

test("the invariant catches an in-place mutation (guard bites)", () => {
  const drifted = Buffer.from(readFileSync(repoPath("context/v0.jsonld")));
  drifted[drifted.length - 1] ^= 0x01;
  assert.throws(() => assertFrozen("context/v0.jsonld", drifted), /drifted from/);
});
