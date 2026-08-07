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

// Built by concatenation so this file does not match its own patterns.
// A literal here would make the guard flag itself and go red on a correct tree.
const DEPTH2_PATTERNS = [
  ['"..", ', '".."'].join(""), // the two-segment array form in a path.join/resolve
  ["../", "../"].join(""), // the two-segment literal form in an import or comment
];

test("no depth-2 path survives anywhere in the package", () => {
  // Top level only: no recursion, so node_modules/ (which the expansion-pin
  // job installs into this directory) and class-artifacts/ stay out of scope.
  const sources = readdirSync(HERE, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && e.name !== SELF)
    .map((e) => e.name);

  assert.ok(sources.length > 0, "found no .ts sources to scan");

  const offenders: string[] = [];
  for (const name of sources) {
    const body = readFileSync(path.join(HERE, name), "utf8");
    body.split("\n").forEach((line, i) => {
      for (const pattern of DEPTH2_PATTERNS) {
        if (line.includes(pattern)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `depth-2 paths remain — these resolve above the repo root now:\n  ` +
      offenders.join("\n  ") +
      `\n(comments count: sign-status-list.ts documents its own output path.)`,
  );
});
