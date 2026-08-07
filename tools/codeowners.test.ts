// CODEOWNERS LIVENESS INVARIANT — every gated path still matches a real file.
//
// GitHub emits no error, no warning, and no CI signal for a CODEOWNERS pattern
// that matches nothing. The entry stays in the file, review still *looks*
// gated, and the gate protects nothing. That is the worst shape a guard can
// take: it fails open and it fails silently.
//
// The trigger was the retire-spike move (2026-08), which relocated two gated
// trust-critical files — /spike/signer-spike/status-list.ts and its test, the
// key-compromise kill-switch surface. Both globs were repointed and verified
// by hand. Nothing would have caught it if they had not been. This test makes
// the next path move loud instead.
//
// Scope: liveness only. It asserts each pattern still resolves to at least one
// tracked file. It does NOT judge whether the right things are gated — that is
// a review question, not an invariant.
//
// Hermetic — node builtins only, no npm install (this runs in the did-pin job
// alongside the rest of tools/, which is dependency-free by design).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const CODEOWNERS = path.join(REPO, ".github", "CODEOWNERS");

/** Every tracked path in the repo, repo-relative, forward-slashed. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/**
 * The CODEOWNERS entries, in file order.
 *
 * Owners are deliberately ignored — this test is about path liveness, and
 * validating team handles would need the GitHub API (not hermetic).
 */
function ownedPatterns(): { pattern: string; line: number }[] {
  return readFileSync(CODEOWNERS, "utf8")
    .split("\n")
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter(({ text }) => text !== "" && !text.startsWith("#"))
    .map(({ text, line }) => ({ pattern: text.split(/\s+/)[0], line }));
}

/**
 * Does `pattern` match at least one tracked file?
 *
 * Only the two shapes this repo actually uses are understood: a root-anchored
 * file path, and a root-anchored `dir/**` subtree. An unrecognized shape
 * THROWS rather than returning false or true — a guard that quietly gives up
 * on a pattern it cannot parse is the exact failure this file exists to
 * prevent. If a new shape is introduced, teach it here deliberately.
 */
function matchesSomething(pattern: string, tracked: string[]): boolean {
  assert.ok(
    pattern.startsWith("/"),
    `CODEOWNERS pattern ${pattern} is not root-anchored. This test only ` +
      `understands root-anchored patterns; teach it the new shape rather than ` +
      `letting it pass unchecked.`,
  );
  const body = pattern.slice(1);

  if (body.endsWith("/**")) {
    const prefix = body.slice(0, -2); // keep the trailing slash
    return tracked.some((f) => f.startsWith(prefix));
  }

  assert.ok(
    !body.includes("*"),
    `CODEOWNERS pattern ${pattern} uses a wildcard shape this test does not ` +
      `understand (only a trailing /** is supported). Teach it the new shape.`,
  );
  // A bare path is a file, or a directory covering everything beneath it.
  return tracked.some((f) => f === body || f.startsWith(`${body}/`));
}

test("every CODEOWNERS pattern still matches a tracked file", () => {
  const tracked = trackedFiles();
  assert.ok(tracked.length > 0, "git ls-files returned nothing");

  const entries = ownedPatterns();
  assert.ok(entries.length > 0, "parsed no CODEOWNERS entries — is the file empty?");

  const dead = entries
    .filter(({ pattern }) => !matchesSomething(pattern, tracked))
    .map(({ pattern, line }) => `.github/CODEOWNERS:${line}: ${pattern}`);

  assert.deepEqual(
    dead,
    [],
    `CODEOWNERS patterns matching no tracked file:\n  ` +
      dead.join("\n  ") +
      `\nGitHub will not warn about these. Each one is a review gate that ` +
      `looks present and protects nothing — repoint it to where the file ` +
      `moved, or delete the entry if the path is genuinely gone.`,
  );
});
