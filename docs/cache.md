# Badge cache: staleness, TTL, and invalidation (#33, U6 · KTD-7)

The on-demand render path (KTD-1) serves a badge from a **GCS cache bucket** on a
hit and renders-then-caches on a miss. This doc covers the cache's one liability —
**staleness** — and the tooling that bounds it: `scripts/cache-admin.py`.

This is the **cache** surface only. The checked-in `badges/*.svg` set (served
statically by nginx) is a separate surface; its self-pruning remains the
[orphan-shield plan][orphan]'s deferred concern, not this one.

## What can go stale

On-demand+cache **dissolves** the old orphan class: a credential dropped on-chain
simply stops resolving at the gateway, so it is never re-rendered or re-cached —
it just stops being served. But it **introduces** a new one: a cached SVG whose
on-chain title later changes. The bytes on disk are now wrong until something
removes them. Two mechanisms bound that window.

### 1. TTL (time-bounds every cached object)

- **Object `Cache-Control`** — each cached SVG is written `public, max-age=86400`
  (`service/cache.py`), matching the static host. Downstream caches/CDNs therefore
  re-validate at least daily; cached art is never `immutable`.
- **Bucket lifecycle** — a GCS **lifecycle rule** (delete objects older than N
  days) is the hard backstop, so even an un-invalidated object eventually expires
  and re-renders fresh. The lifecycle rule lives in **private-ops Terraform**
  alongside the bucket itself (out of this repo) — see [DEPLOY.md][deploy] /
  the deployment plan. Because a badge is always re-derivable, expiry is
  non-destructive: the next request re-renders it.

### 2. Explicit invalidation (`scripts/cache-admin.py`)

For "this title changed *now*, don't wait for the TTL," remove the object
directly. Deletion is **non-destructive** — the badge re-renders on the next
request.

```bash
# Required env (the bucket + networks the service uses):
export BADGE_CACHE_BUCKET=<gcs-bucket-name>
export BADGE_NETWORKS=mainnet,preprod          # default; order = lookup order
# Gateway keys, network-scoped (only reconcile needs these):
export ANDAMIO_MAINNET_API_KEY=...  ANDAMIO_PREPROD_API_KEY=...

# Drop one or more cached badges (re-render on next request):
python3 scripts/cache-admin.py invalidate <cid>.<slt>.svg [<cid>.<slt>.svg ...]

# Find cache objects whose course_id no longer resolves on-chain:
python3 scripts/cache-admin.py reconcile            # report only
python3 scripts/cache-admin.py reconcile --delete   # remove them
```

## `reconcile` — subsuming the orphan guard for the cache

The orphan-shield plan deferred a "no-matching-record / self-pruning" guard. For
the **cache** surface, `reconcile` is that guard: it lists cache objects and
flags any whose `course_id` no longer resolves at the gateway. It resolves each
unique `course_id` **once** per run (kinder to the API rate limit).

**Safety rails:**

- **Protected names are never touched** — `_placeholder.svg` and every baked
  `badges/*.svg` are excluded, as is any object whose name is not a well-formed
  badge key (`<56-hex course_id>.<64-hex slt_hash>.svg`).
- **A course is "orphaned" only on a clean miss everywhere** — `reconcile`
  deletes a course's objects only when **every** configured network returns a
  clean `unresolvable`/`not_found`. This mirrors `app.serve_badge`'s 404-vs-502
  split.
- **Gateway failures fail loudly** — if the gateway client errors for any other
  reason (`auth`/`timeout`/`transport`/`config`), resolution is *inconclusive*,
  so `reconcile` **aborts with a non-zero exit** instead of guessing. We count on
  the gateway client; if it breaks we stop — because mis-flagging a live course
  would delete a real badge. (A `401 auth` on one network is *not* read as
  "missing": per the U1 finding keys are network-scoped, so a 401 means the key
  for that network is wrong — an ops problem, not an absent course.)

## Tests

```
python3 service/tests/test_cache.py        # delete() idempotency + list_keys()
python3 scripts/tests/test_cache_admin.py  # invalidate/reconcile + fail-loud logic
```

Both run offline (GCS bucket and gateway are dependency-injected); no live key
or bucket is needed to exercise the logic.

[orphan]: plans/2026-06-25-001-fix-orphan-shield-badge-cleanup-plan.md
[deploy]: ../DEPLOY.md
