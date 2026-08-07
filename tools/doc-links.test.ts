// DOC-LINK INVARIANT — every relative link in a live doc resolves.
//
// This repo navigates by cross-reference: MOC.md maps the components, the
// runbooks link to the evidence they depend on, and docs/solutions/ entries
// cite the code that burned someone. A dead link in any of those costs a
// reader time at exactly the moment they were told where to go — and during
// a key-compromise response, that reader is working under pressure.
//
// The trigger was the retire-spike move (2026-08), which relocated 183 files.
// The reference sweep missed two links; both were caught by hand, across two
// review rounds, because nothing was watching. This test watches.
//
// THE EXCLUSION LIST IS THE POINT
//
// Dated plans, brainstorms, transcripts, validator captures, and the archived
// prototype deliberately keep links to paths that have since moved. They are
// records of what was true when written, not instructions about where things
// are now — AGENTS.md keeps plans legible on purpose, "including decisions
// that were later refuted", and rewriting a KMS transcript would falsify the
// attribution chain the key-compromise runbook depends on.
//
// So this list encodes the instruction-versus-record distinction rather than
// merely skipping inconvenient files. Adding a path here means claiming it is
// a record. Do that deliberately.
//
// Hermetic — node builtins only, no npm install (runs in the did-pin job
// alongside the rest of tools/, which is dependency-free by design).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

/** Records, not instructions. See the header — this list is a claim. */
const RECORD_PREFIXES = [
  "docs/plans/", // dated decision records, refuted ones included
  "docs/brainstorms/", // dated requirements records
  "archive/", // the retired prototype and its evidence
  "signing/transcripts/", // verbatim KMS run captures
  "signing/validation/", // raw external-validator captures
  "tools/transcripts/", // verbatim run captures
];

/** `[text](target)` — captures the target, minus any `#fragment`. */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

function liveMarkdown(): string[] {
  return execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: REPO, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((f) => !RECORD_PREFIXES.some((p) => f.startsWith(p)));
}

test("every relative link in a live doc resolves", () => {
  const files = liveMarkdown();
  assert.ok(files.length > 0, "git ls-files matched no live markdown");

  const dead: string[] = [];

  for (const file of files) {
    const dir = path.dirname(path.join(REPO, file));
    const body = readFileSync(path.join(REPO, file), "utf8");

    body.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(LINK)) {
        // Strip a trailing #anchor; a bare "#section" link is intra-file.
        const target = m[1].split("#")[0];
        if (target === "") continue;
        if (/^(https?:|mailto:)/.test(target)) continue;
        if (existsSync(path.resolve(dir, target))) continue;
        dead.push(`${file}:${i + 1}: ${m[1]}`);
      }
    });
  }

  assert.deepEqual(
    dead,
    [],
    `links in live docs pointing at nothing:\n  ` +
      dead.join("\n  ") +
      `\nRepoint each one, or — if the file is genuinely a dated record rather ` +
      `than a live instruction — add its prefix to RECORD_PREFIXES and say why.`,
  );
});
