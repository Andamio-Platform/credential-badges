---
title: A CODEOWNERS pattern that stops matching still looks like a gate
date: 2026-08-07
category: workflow-issues
module: ci
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Moving, renaming, or deleting any path named in .github/CODEOWNERS"
  - "Reviewing a PR that relocates files under a trust-critical directory"
  - "Adding a new review gate and assuming it will keep working"
symptoms:
  - "A CODEOWNERS entry names a path that no longer exists, and nothing anywhere reports it"
  - "A trust-critical file merges without the review its gate was supposed to force"
  - "The gate is verified by hand during the move and never again"
root_cause: missing_workflow_step
resolution_type: tooling_addition
tags: [codeowners, review-gates, fail-open, file-moves, ci, guard-tests]
---

# A CODEOWNERS pattern that stops matching still looks like a gate

## Context

GitHub emits no error, no warning, and no CI signal for a CODEOWNERS pattern that matches nothing. The entry stays in the file. Review still *looks* gated. The gate protects nothing.

That is the worst shape a control can take: it fails open, and it fails silently.

Retiring `spike/` (#115) relocated two gated files — the status-list builder and its test, which are the key-compromise kill-switch surface. Both globs were repointed and verified by hand. Nothing in the repository would have caught it if they had not been.

## Guidance

**Treat every path in `.github/CODEOWNERS` as a reference that a file move can break, and assert it mechanically.** `tools/codeowners.test.ts` does this: it asserts every pattern still resolves to at least one tracked file, and runs in the existing dependency-free `did-pin` job.

Three design choices in that guard are worth carrying to any similar check:

**Liveness only.** It asserts each pattern resolves to *something*. It deliberately does not judge whether the right things are gated — that is a review question, and encoding it as an invariant would make the guard wrong the first time coverage intentionally changes.

**An unparseable pattern throws.** Only the two shapes in use are understood (a root-anchored file, and `/dir/**`). Anything else fails loudly with "teach it the new shape" rather than returning true or false. A guard that quietly gives up on input it cannot read is the exact failure it exists to prevent.

**It is gated by the file it guards.** `/tools/codeowners.test.ts` has its own CODEOWNERS entry, matching how `did-pin.test.ts` and `context-freeze.test.ts` are gated alongside what they pin. Deleting the guard should be a deliberate act.

## Why This Matters

CODEOWNERS is the only control standing between an unreviewed change and a trust-critical path. In this repo those paths publish the issuer signing key, freeze published JSON-LD contexts, and flip the key-compromise kill switch. A gate that has silently stopped applying is worse than no gate, because the file still reads as protected and nobody re-checks it.

The cost of the failure is also delayed and invisible: the gate does not break at the moment of the move, it breaks at the next PR that touches the newly-ungated file — which may be months later, by someone who never knew the gate existed.

## When to Apply

Any change that moves, renames, or deletes a tracked path. In practice, run the guard on every PR and stop thinking about it.

The check needs `git ls-files`, so it reads *tracked* files. A newly-added gate stays red until the file it names is staged — which is correct, since GitHub matches CODEOWNERS against repository contents and an untracked file is ungatable. Stage the file before expecting green.

## Examples

The failure this catches, reproduced by re-breaking the exact glob #115 relocated:

```
.github/CODEOWNERS:48: /spike/signer-spike/status-list.ts
```

Before the guard, that line produced no output anywhere — not from GitHub, not from CI, not from `git`. After it, `did-pin` goes red with the file and line.

## Related

- `docs/solutions/workflow-issues/unwired-test-suites-silently-rot.md` — the same family, one layer down: a suite that runs nowhere has already stopped protecting anything.
- `docs/solutions/conventions/a-move-is-not-a-rename-when-code-encodes-its-depth.md` — the other silent-failure class the same move surfaced.
- PR #115 — where this was found and fixed.
