---
title: A destination-only pathspec silently defeats git rename detection
date: 2026-08-07
category: conventions
module: ci
problem_type: convention
component: development_workflow
severity: high
applies_when:
  - "Verifying that a file move changed no content"
  - "Writing a gate that asserts renames are pure, especially over signed or pinned artifacts"
  - "Scoping any `git diff -M` with a pathspec"
symptoms:
  - "`git diff -M` reports moved files as fresh additions instead of renames"
  - "A rename-integrity gate cannot pass even on a perfectly clean move"
  - "Numstat shows the full line count of every moved file rather than `0 0`"
root_cause: wrong_api
resolution_type: documentation_update
tags: [git, rename-detection, pathspec, verification, file-moves, signed-artifacts]
---

# A destination-only pathspec silently defeats git rename detection

## Context

`git diff -M` applies its pathspec **before** rename detection runs, not after. Restricting the diff to the destination filters the delete side out of the candidate set, so `-M` has nothing to pair the addition with and reports it as a new file.

This was a P0 in the verification strategy for the retire-spike move (#115). The gate meant to prove that 58 signed credentials were byte-identical was written as:

```bash
git diff -M origin/main --numstat -- signing/ archive/     # ✗ cannot pass
```

It could never have passed. Every one of the 58 artifacts would have reported as a fresh addition, and the check that existed specifically to prove nothing was touched would have looked like proof that everything was.

## Guidance

**Name both sides of the move in the pathspec, or use no pathspec at all.**

```bash
git diff -M origin/main --numstat -- spike/ signing/ archive/    # ✓
```

Reproduced in a scratch repo, one file moved from `spike/signer-spike/` to `signing/`:

| Pathspec | Output |
|---|---|
| *(none)* | `0	0	{spike/signer-spike => signing}/f1.json` |
| `-- signing/` | `1	0	signing/f1.json` |
| `-- spike/ signing/` | `0	0	{spike/signer-spike => signing}/f1.json` |

The middle row is the trap. It is not an error — it is a plausible-looking wrong answer, which is why it survives review.

## Why This Matters

The failure is inverted from the usual one. A gate that wrongly reports failure is annoying but safe; you investigate and find the truth. This gate reports *the shape of catastrophic failure* — every signed artifact rewritten — on a move where nothing happened.

The likely reaction under time pressure is not "my pathspec is wrong." It is to distrust the move, or to weaken the gate until it passes. Both are worse than having no gate.

**Corollary: do not trust a single git-level check to prove artifact identity.** #115 paired the corrected diff with an independent sha256 manifest taken before the move and compared after, keyed by root-relative path. Two readings from different mechanisms; either one alone is a single point of failure, and one of them was wrong.

## When to Apply

Any time `git diff` is scoped with a pathspec and rename detection matters. Also applies to `--find-renames`, `--summary`, and `--stat` — the pathspec ordering is a property of the diff machinery, not of `-M` specifically.

Not a concern for an unscoped diff, which is often the simplest correct answer.

## Examples

The gate as it now reads, with both sides named and the reason stated inline so the next person does not re-derive it:

```
| Rename integrity | git diff -M origin/main --numstat -- spike/ signing/ archive/ | 0 0 for every path except … |
```

Keying the corroborating manifest by path-within-the-tree rather than by base name also matters. The moved package carried two `README.md` files — its own, and one inside `validation/` — so a basename-keyed map silently drops one of the pair and then reports "identical" for a file it never compared. Paths *inside* a moved tree are preserved by the move, which is what makes them a safe key on both sides.

## Related

- `docs/solutions/conventions/a-move-is-not-a-rename-when-code-encodes-its-depth.md` — the other half of verifying a move: git proves the bytes, not the behaviour.
- `docs/solutions/best-practices/deterministic-kms-resign.md` — the predict-then-gate discipline this follows: a pin verifies an operation, it is never rebaselined by it.
- PR #115 — where this was found, and the reproduction above.
