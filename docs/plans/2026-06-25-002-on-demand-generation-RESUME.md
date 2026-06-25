# RESUME — #33 on-demand badge generation (WIP)

**Branch:** `feat/33-on-demand-badge-generation` · **Plan:** [`2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md`](2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md) · **Last updated:** 2026-06-25

Quick-resume note so this WIP is recoverable from any machine. The plan is the
source of truth; this is just "where we stopped + what's local-only."

## Progress: 4 of 8 units done

| Unit | Status | Commit |
|---|---|---|
| U1 — gateway service-key gate | ✅ **GO** (live-verified) | `db5a54b` (findings in `docs/spikes/2026-06-25-gateway-key-verification.md`) |
| U2 — `gen.py` parameterized render | ✅ done | `ba6983a` |
| U3 — render-core (`api_client` + `render`) | ✅ done (live-verified vs preprod) | `ae1993a` |
| U4 — render service + GCS cache | ✅ done (live e2e) | `92e29c0` |
| U5 — nginx `error_page 404 → render service` | ⏳ next | — |
| U6 — cache invalidation + orphan-guard | ⏳ | — |
| U7 — deploy/CI wiring (allowlist line already done) | ⏳ | — |
| U8 — docs (README/MOC/ROADMAP + key runbook) | ⏳ | — |

**Resume with:** `/ce-work U5` against the plan file above.

## ⚠️ Local-only on the original machine (NOT in the repo)

- **`.env.local`** holds the andamio-api keys (`ANDAMIO_PREPROD_API_KEY`,
  `ANDAMIO_MAINNET_API_KEY`). It is **gitignored** — it does NOT travel with this
  push. On another machine, recreate it from `.env.example` (copy → fill real
  keys) before running anything that hits the live gateway. Keys are
  **network-scoped**: a mainnet key 401s on the preprod gateway.

## Key findings already folded into the plan (U1 live probe)

1. Non-interactive `X-API-Key` reads course + per-module titles — **confirmed GO**.
2. **Keys are network-scoped** → KTD-3: a key per network, route course → gateway.
3. **Unresolvable course returns 502, not 404** → KTD-3b: never cache a non-200;
   the service tries each configured network, 404 only when all are clean-misses.

## Run the tests (offline, no deps)

```
python3 generator/tests/test_render_parity.py   # 4/4  byte-identity + concurrency + round-trip
python3 generator/tests/test_api_client.py      # 7/7  parsing + error mapping
python3 generator/tests/test_render.py          # 8/8  fallbacks + sanitize + round-trip
python3 service/tests/test_cache.py             # 2/2
python3 service/tests/test_app.py               # 9/9  serve_badge cache/error/retry logic
bash scripts/ci/check-allowlist.sh              # static-host allowlist guard
```

## Open coordination item (not blocking U5)

Send the **#17 preprod service-key provisioning ask** (a *dedicated* service key,
not the personal CLI key currently in `.env.local`) so production uses a key in
GCP Secret Manager per KTD-3. Draft text was prepared in-session; gist: dedicated
preprod (and mainnet) `andamio-api` service keys → Secret Manager in
`andamio-credentials`, runtime SA gets `secretAccessor` only.
