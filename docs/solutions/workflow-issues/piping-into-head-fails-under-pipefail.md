---
title: A pipeline ending in `head` fails the build under `set -o pipefail`
date: 2026-08-07
category: workflow-issues
module: ci
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - "Writing or editing any script under scripts/ci/"
  - "Using `| head`, `| head -n`, or any consumer that exits before its producer finishes"
  - "Diagnosing a CI job that fails intermittently on PRs that do not touch it"
symptoms:
  - "`grep: write error: Broken pipe` followed by a non-zero exit"
  - "A CI job fails on one PR and passes on three others against the same base within the hour"
  - "The failing step touches nothing the changed files relate to"
root_cause: logic_error
resolution_type: code_fix
tags: [ci, shell, pipefail, sigpipe, flaky-tests, bash]
---

# A pipeline ending in `head` fails the build under `set -o pipefail`

## Context

`docker-build` failed on a two-line documentation PR (#120) that touched nothing the job exercises. The step was `scripts/ci/test-nginx-fallback.sh`, and the error was:

```
grep: write error: Broken pipe
##[error]Process completed with exit code 2
```

The line:

```bash
baked="$(ls badges/*.svg | grep -v _placeholder | head -1 | xargs -n1 basename)"
```

`head -1` exits as soon as it has one line. If `grep` is still writing when that happens, it receives SIGPIPE and exits 141. Every script under `scripts/ci/` sets `set -euo pipefail`, so `pipefail` promotes that 141 to the whole pipeline's exit status and `-e` aborts the script.

It is a race, so it usually wins. #110, #111 and #119 all passed the same job against the same base within the hour.

## Guidance

**Do not end a pipeline in a consumer that exits early** — `head`, `head -n`, or an `awk` with `exit` — when the script runs under `pipefail`. Either drop the early-exit consumer, or avoid the pipeline entirely.

Here the whole pipeline was replaceable by a glob loop, which is both immune and clearer about intent:

```bash
baked=""
for f in badges/*.svg; do
  [ "${f##*/}" = "_placeholder.svg" ] && continue
  baked="${f##*/}"
  break
done
if [ -z "$baked" ]; then echo "FATAL: no baked badge found in badges/" >&2; exit 1; fi
```

The explicit empty check is part of the fix, not decoration. The original would have carried an empty `$baked` forward silently if the glob matched nothing.

**Do not "fix" this by removing `pipefail`.** `pipefail` is what makes a failing producer in the middle of a pipeline visible at all; without it, a broken `curl | jq` chain reports the exit status of `jq` and passes. The pipeline shape is the problem, not the setting.

## Why This Matters

An intermittent red on an unrelated PR is more expensive than a consistent one. It teaches people to re-run without reading, and that habit is exactly how a real failure eventually gets waved through. A flake in a *verification* script is worse still, because the thing being trained away is scrutiny of the verifier.

The cost is also asymmetric in an unhelpful direction: the failure appears on whichever PR happens to lose the race, so the person paying to diagnose it is never the person who wrote the line.

## When to Apply

Any script under `scripts/ci/`. All three there set `set -euo pipefail`, so the hazard is live for every pipeline anyone adds.

Not a concern in a script without `pipefail`, where the pipeline reports only its last command's status — but the CI scripts here deliberately do not make that trade.

## Examples

Swept the whole of `scripts/` when fixing this: `test-nginx-fallback.sh` was the only instance. That is worth stating so nobody re-runs the sweep — the hazard is a pattern to avoid in new code, not a backlog of existing sites to clean up.

Failure signature to recognise, since it names the wrong culprit:

```
grep: write error: Broken pipe     <- grep is the victim, not the cause
exit code 2                        <- head exited first; pipefail propagated it
```

## Related

- `docs/solutions/workflow-issues/unwired-test-suites-silently-rot.md` — the other way this repo's CI has lied: a suite that runs nowhere, versus a suite that fails for a reason unrelated to the code.
- PR #121 — the fix, and the sweep that found no other instances.
