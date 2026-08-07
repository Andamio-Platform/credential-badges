// Repo-root depth guard (retire-spike move).
//
// This package used to live at spike/signer-spike/ — depth 2, where a
// two-segment climb from HERE reached the repo root. It now lives at
// signing/ — depth 1, where that same two-segment climb resolves ABOVE
// the repo, and a one-segment climb is correct.
//
// Constructing a wrong path throws nothing. It only fails when something
// READS it, and six of the fourteen depth-coupled sites are never read by
// any test: no test file imports sign.ts, sign-class.ts, bake-class.ts, or
// validate-1edtech.ts. Two of those six are WRITE paths reached only by a
// live signing run (badges/*.svg) or a key-compromise kill-switch flip
// (status/key-epoch-2026-07.json). A wrong edit there stays invisible until
// an incident.
//
// So: two assertions. The first proves the arithmetic every module shares.
// The second catches a site the move MISSED, which the first cannot see.
// Hermetic — node builtins only, no npm install.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));

// Every module in this package sits flat in signing/ and shares this HERE,
// so one assertion covers the arithmetic all of them use.
const REPO = path.resolve(HERE, "..");

// The four repo-root artifacts this package reads or writes.
const MARKERS = [
  "context/v1.jsonld",
  "status/key-epoch-2026-07.json",
  "badges/_registry.json",
  "generator/credentials.json",
];

test("repo-root resolution: resolve(HERE, '..') is the repo root", () => {
  for (const marker of MARKERS) {
    assert.ok(
      existsSync(path.join(REPO, marker)),
      `${marker} not found under ${REPO} — the package's repo-root arithmetic ` +
        `is wrong for its current depth. Every path built from it (the served ` +
        `status list, the badge bake target, the committed context) resolves ` +
        `to the wrong place.`,
    );
  }
});

// Two `..` segments separated by nothing but quotes, commas, slashes, or
// whitespace. Built from a source string rather than written as a literal so
// this file does not flag itself. Matching on the SHAPE rather than on two
// exact spellings is deliberate: `resolve(HERE, "..", "..")`, `"..",".."`,
// `"../.."`, `../../`, and the same segments split across lines are all the
// same bug, and a guard that only knew one spelling would go green on the
// other four.
const DEPTH2 = new RegExp(["\\.\\.", "[\\s,\"'/]*", "\\.\\."].join(""));

// The cross-package imports this package makes. A depth edit can leave these
// syntactically fine and still unresolvable, and no CI job ever loads the
// modules that declare them (nothing imports sign.ts or bake-class.ts), so
// the shape check above would pass while the import is broken.
const CROSS_PACKAGE_IMPORTS = ["tools/gen-did-json.ts", "tools/bake-signed-vc.ts"];

test("no depth-2 path survives in the package's top-level .ts sources", () => {
  // Top level only: no recursion, so node_modules/ (which the expansion-pin
  // job installs into this directory) and class-artifacts/ stay out of scope.
  // Subdirectories are deliberately unscanned — the package is flat, and
  // transcripts/ and validation/ are frozen records that keep the old paths.
  const sources = readdirSync(HERE, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== SELF)
    .map((e) => e.name);

  assert.ok(sources.length > 0, "found no .ts sources to scan");

  const offenders: string[] = [];
  for (const name of sources) {
    const body = readFileSync(path.join(HERE, name), "utf8");
    // Scan the whole text, not line by line: the segments may be split across
    // lines, and this package already formats one repo-root join that way.
    if (!DEPTH2.test(body)) continue;
    const at = body.search(DEPTH2);
    const line = body.slice(0, at).split("\n").length;
    offenders.push(`${name}:${line}: ${body.split("\n")[line - 1].trim()}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `depth-2 paths remain — these resolve above the repo root now:\n  ` +
      offenders.join("\n  ") +
      `\n(comments count too: sign-status-list.ts documents its own output path.)`,
  );
});

test("cross-package imports resolve at this depth", () => {
  for (const target of CROSS_PACKAGE_IMPORTS) {
    assert.ok(
      existsSync(path.join(REPO, target)),
      `${target} not found from ${REPO} — an import specifier in this package ` +
        `points at nothing. Nothing in CI loads the modules that declare these, ` +
        `so this assertion is the only thing that catches it.`,
    );
  }
});
