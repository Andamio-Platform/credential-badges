---
title: Stale __pycache__ bytecode makes edited Python source run old code
date: 2026-07-23
category: runtime-errors
module: generator
problem_type: runtime_error
component: tooling
symptoms:
  - "Regenerated output still contains a constant that was just edited out of the source"
  - "`inspect.getsource()` shows the NEW code while calling the same function returns the OLD behavior"
  - "grep confirms the old value is nowhere in any .py file, yet program output contains it"
root_cause: config_error
resolution_type: environment_setup
severity: medium
tags: [python, pycache, bytecode, cache-invalidation, sed, generator]
---

# Stale __pycache__ bytecode makes edited Python source run old code

## Problem

After editing `generator/gen.py` (context URL v0→v1) via `sed`, `make badges` regenerated all 58 badges — still embedding the OLD v0 URL. The source on disk had only v1; the running code produced v0. Had the output not been hash-checked, wrong artifacts would have shipped.

## Symptoms

- `build.render(rec)` output contained `context/v0.jsonld` twice per badge, while `grep v0 generator/gen.py` matched nothing
- The truly confusing one: `inspect.getsource(gen.credential_json)` showed the **new** v1 source (it reads the `.py` file) while calling `gen.credential_json(...)` in the same process returned **v0** output (it runs the loaded bytecode) — the same module object lied in two directions at once
- `generator/__pycache__/gen.cpython-312.pyc` carried the same minute-granularity mtime as the edited `gen.py`

## What Didn't Work

- Re-running `make badges` — same stale output (the cache was consulted again)
- Verifying the source, the loaded module's `__file__`, and `getsource` — all pointed at the correct, edited file, which is precisely why this failure mode burns time: every source-level check passes
- Tracing the data path (records file, render pipeline, template strings) for a second copy of the old constant — there was none

## Solution

```bash
rm -rf generator/__pycache__
make badges   # output now embeds the edited value
```

## Why This Works

CPython validates cached `.pyc` files against the source's **mtime (whole seconds) and size**. The `sed -i` rewrite landed within the same recorded second as the previous compile, and the edit (`v0`→`v1`) did not change the file size — so the interpreter judged the stale bytecode current and skipped recompilation. `inspect.getsource` reads the file directly, which is why introspection showed new code while execution ran old code.

## Prevention

- In any pipeline where Python output ships as an artifact (like `make badges`), clear or bypass bytecode caching: run with `PYTHONDONTWRITEBYTECODE=1`, or add `find . -name __pycache__ -exec rm -rf {} +` before the build. CI is immune (fresh checkout, no cache) — this bites **local** builds whose artifacts get committed, which is exactly the generator's model.
- When "the code I'm reading is not the code that's running" in Python, suspect `__pycache__` **before** re-auditing the source — especially after automated edits (`sed`, codemods) that plausibly preserve file size.
- The detection that saved this run generalizes: hash-check generated artifacts against expectations (`git status` showing 1 changed file when ~58 were expected was the tell).

## Related Issues

- PR #65 — the generator repoint where this occurred (caught before commit; the committed badge set embeds the correct v1)
