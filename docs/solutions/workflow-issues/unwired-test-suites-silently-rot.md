---
title: A test suite not wired into CI silently stops protecting anything
date: 2026-07-23
category: workflow-issues
module: generator
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "Adding a test file or suite anywhere outside the paths CI already globs"
  - "Auditing why a regression shipped despite an existing test that covers it"
  - "Reviewing a PR that changes code whose tests live in an unwired suite"
symptoms:
  - "A committed invariant test fails locally when finally run, but no CI job has ever executed it"
  - "A regression covered by an existing test lands on a green PR"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
tags: [ci, test-coverage, parity-test, generator, invariants]
---

# A test suite not wired into CI silently stops protecting anything

## Context

`generator/tests/` holds real invariant tests — including `test_render_parity.py`, which asserts generator output is byte-identical to the committed badge set. None of them run in CI: `ci.yml` globs `tools/*.test.ts`, `spike/signer-spike/*.test.ts`, the expansion-pin job, and the issuer-service suite, and nothing else. When PR #65 repointed `generator/gen.py` to the v1 context, the parity invariant broke for all 58 committed badges — and every CI check stayed green. The break surfaced only because a code-review agent found the suite and ran it manually; the fix (regenerating the badge set) then shipped in the same PR.

The counter-example from the same day proves the pattern in reverse: `tools/context-freeze.test.ts` was wired into both CI and the deploy workflow at birth, so it *cannot* silently rot — a context mutation goes red before merge and again at tag time.

## Guidance

A test suite's protection is exactly as real as its CI wiring. Concretely:

- When adding a test file, adding it to a CI job glob is part of the same change — not a follow-up. If the repo pattern is per-directory globs (as here), check the new file's path actually matches an existing glob before assuming coverage.
- Periodically reconcile: every test-shaped file in the repo should be reachable from some CI job. In this repo the current gap is `generator/tests/*.py` — the fix is a small `ci.yml` job running `python3 generator/tests/test_render_parity.py` and `test_render.py` (stdlib-only, no pip install needed; each script exits per its own pass/fail summary).
- Encode known exceptions *in the test*, not in tribal memory: the parity test currently "fails by one" on the baked flagship badge (bake replaces its credential block after generation). Wired into CI as-is it would be permanently red — the flagship exception must be encoded first, which is why wiring and exception-encoding go together.

## Why This Matters

An unwired test is worse than no test: it creates the *belief* that an invariant is guarded. The parity break here was benign only because the divergence (v0 vs v1 URL in unsigned JSON) was cosmetic; the identical mechanism would have hidden a corrupted badge set just as quietly. Review agents finding the suite by luck is not a control.

## When to Apply

- Every PR that adds a test file (does a CI glob reach it?)
- After extracting or relocating code (did its tests' paths fall out of the globs?)
- When a "tested" invariant breaks anyway — first question: did the test actually run anywhere?

## Examples

The gap, concretely — `ci.yml` runs these:

```yaml
node --experimental-strip-types --test tools/*.test.ts            # tools suite ✓
node --experimental-strip-types --test spike/signer-spike/*.test.ts  # spike suite ✓
# issuer-service: npm test ✓   expansion-pin: npm run test:expansion-pin ✓
# generator/tests/*.py: nothing ✗  ← the parity invariant lived here, unenforced
```

## Related

- `generator/tests/test_render_parity.py` — the suite that caught (but only manually) the #65 badge-set divergence
- `docs/solutions/conventions/never-mutate-published-jsonld-context.md` — whose freeze test shows the wired-at-birth pattern done right
- `.github/workflows/ci.yml` — where the generator job belongs
