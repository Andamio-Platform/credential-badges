---
title: A directory move relocates more than its files — depth couplings and ignore rules go too
date: 2026-08-07
last_updated: 2026-08-07
category: conventions
module: signing
problem_type: convention
component: development_workflow
severity: high
applies_when:
  - "Moving or promoting a directory that contains code, not just documents"
  - "Reviewing a PR whose diff reads as renames plus a handful of one-token path edits"
  - "Changing the nesting depth of any module that reads or writes a repo-root artifact"
  - "Deciding whether a structural change needs a guard or just green CI"
  - "Moving a directory that contains its own nested .gitignore"
symptoms:
  - "A module resolves the repo root by climbing a fixed number of segments from its own location"
  - "Every test passes after a move, but a path that is only written during a rare operation now points outside the repo"
  - "A reviewer sees `0 0` renames and concludes nothing changed"
  - "Build output that was ignored for months reappears untracked after pulling a rename"
tags: [git, refactoring, file-moves, path-resolution, gitignore, silent-failure, guard-tests, signing]
---

# A directory move relocates more than its files — depth couplings and ignore rules go too

## Context

Retiring `spike/` (#115) moved `spike/signer-spike/` to `signing/` — 108 files, all reported by git as 100%-similarity renames with zero changed lines. That number is what makes this dangerous: a rename-only diff invites the conclusion that behaviour cannot have changed.

It had. Eleven modules resolved the repo root by climbing two segments from their own location:

```ts
const REPO = path.resolve(HERE, "..", "..");   // correct at spike/signer-spike/
                                               // one directory too high at signing/
```

Nothing in the file changed. What the expression *means* changed, because its meaning was never in the file — it was in the file's position.

## Guidance

**Before moving code, grep the moved tree for path arithmetic anchored on the module's own location** (`__dirname`, `import.meta.url`, `HERE`, `path.resolve(…, "..")`, `include_str!`). Every hit is a hidden coupling to the current depth and needs one edit per level changed.

**Then ask which of those sites any test actually executes** — not which are *covered*, which are *executed*. This is the load-bearing question, because:

> Path construction never throws. `path.resolve` will happily build a path to nowhere. The error surfaces at the read or write, not at construction.

So a site whose path is built during a test but only *used* in production fails silently. In #115, seven of fourteen sites were read by a test and failed loudly when wrong. The other six were reached by no test at all — including both write paths:

| Site | Reached by | Would have failed |
|---|---|---|
| `document-loader.ts`, `class-credential.ts`, `check-status.ts` + 4 in tests | existing tests | loudly, in CI |
| `sign.ts`, `sign-class.ts`, `validate-1edtech.ts` | a live signing run | at the next signing run |
| `sign-status-list.ts` | a key-compromise kill-switch flip | during an incident |
| `bake-class.ts` | a badge re-bake | after rewriting 58 served SVGs |

**Guard the arithmetic rather than extracting a helper.** A shared `repo-root.ts` is the better long-term shape, but it converts a move into a refactor and makes the diff unreviewable as a move. A test asserting the invariant buys the same protection and keeps the change what it says it is. `signing/repo-root.test.ts` is that guard.

**Match the guard to the shape, not to one spelling.** The first version of that guard looked for two literal strings and missed four equivalent forms — `"../.."`, `"..",".."`, `path.dirname(path.dirname(…))`, and the same segments split across lines. That last one is not hypothetical: this package already formats one repo-root join across lines. Mutation-test a guard against the spellings it is supposed to catch before trusting it.

## Why This Matters

The failure mode is not "the move broke something." It is "the move broke something and every signal said it was fine." Rename detection reports `0 0`. The test suite is green. CI is green. The wrongness sits in a write path that nobody exercises until the day they most need it to work — for `sign-status-list.ts`, that is a key-compromise response.

A guard converts an invisible failure into a red build at the moment the mistake is made.

## The other thing that leaves with the tree: its ignore rules

Path arithmetic is the mechanism that bites *inside* the moved code. There is a second one that bites *outside* it, and it was missed on the first pass of the same move.

**A nested `.gitignore` travels with the directory it sits in.** `verifier-spike/verifiers/spruce/.gitignore` contained `/target`. It moved to `archive/` with the code, so the rule stopped applying at the old path — and 1.4GB of Rust build output, ignored for months, came back untracked the moment anyone pulled the rename.

The root `.gitignore` had a migration guard, but it named individual leftovers: the private-material files, `node_modules/`, `out/`. Naming leftovers individually cannot anticipate this, because you would have to already know every ignore rule nested inside the tree you moved. Ignoring the directory can:

```gitignore
# Migration guard. `git mv` moves tracked files only, so pulling the rename
# into an existing clone deletes the tracked files and strands the untracked
# ones — now un-ignored. Nothing should exist here anymore.
spike/
```

**Before moving a directory, list the `.gitignore` files inside it** (`find <dir> -name .gitignore`) and ask what each one was covering. Anything they ignored is about to become visible at the old path in every existing clone.

Whether that matters depends on what was ignored. Here it was regenerable build output, so the cost was noise and disk. Had it been the private strategy material the root rules also cover, it would have been one `git add -A` from a permanent public history.

## When to Apply

Any move of a directory containing code. Skip it for documents.

Both mechanisms apply, and they need separate checks: grep the moved tree for path arithmetic, and list the `.gitignore` files inside it.

Depth-independent anchors are exempt: anything resolved from `process.cwd()` or an environment variable does not care where its module lives. That is why the `archive/` half of #115 needed no repairs at all — `archive/src/` and `archive/verifier-spike/src/` anchor on the working directory, so their behaviour is unchanged by the rename.

## Examples

The invariant, asserted from the package's own location:

```ts
// Every module in this package shares this HERE, so one assertion
// covers the arithmetic all of them use.
const REPO = path.resolve(HERE, "..");
for (const marker of ["context/v1.jsonld", "status/key-epoch-2026-07.json",
                      "badges/_registry.json", "generator/credentials.json"]) {
  assert.ok(existsSync(path.join(REPO, marker)));
}
```

Plus a scan that catches a site the move *missed*, which the assertion above cannot see — matching the shape rather than a spelling, and reading whole-file so a line-split climb is still caught:

```ts
// Two `..` separated by nothing but quotes, commas, slashes, or whitespace.
const DEPTH2 = new RegExp(["\\.\\.", "[\\s,\"'/]*", "\\.\\."].join(""));
```

Both live in `signing/repo-root.test.ts`, run in the hermetic `signing-hardening` CI job, and were observed failing against the un-repaired tree before the repairs landed — a guard that has only ever passed has not been shown to guard anything.

## Related

- `docs/solutions/conventions/assert-the-artifact-not-the-source.md` — the same family: a guard that inspects the wrong thing passes while the invariant is violated.
- `docs/solutions/workflow-issues/unwired-test-suites-silently-rot.md` — names relocation explicitly as a trigger for tests falling out of CI globs.
- PR #115 — the move this came from.
