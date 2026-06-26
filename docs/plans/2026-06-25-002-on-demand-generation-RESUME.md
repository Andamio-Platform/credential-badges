# RESUME — #33 on-demand badge generation (WIP)

**Branch:** `feat/33-on-demand-badge-generation` · **Plan:** [`2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md`](2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md) · **Last updated:** 2026-06-26

Quick-resume note so this WIP is recoverable from any machine. The plan is the
source of truth; this is just "where we stopped + what's local-only."

## Progress: 5 of 8 units done

| Unit | Status | Commit |
|---|---|---|
| U1 — gateway service-key gate | ✅ **GO** (live-verified) | `db5a54b` (findings in `docs/spikes/2026-06-25-gateway-key-verification.md`) |
| U2 — `gen.py` parameterized render | ✅ done | `ba6983a` |
| U3 — render-core (`api_client` + `render`) | ✅ done (live-verified vs preprod) | `ae1993a` |
| U4 — render service + GCS cache | ✅ done (live e2e) | `92e29c0` |
| U5 — nginx `/badges/` 404 → `@render` fallback | ✅ done (docker e2e + stub) | `7b163a1` |
| U6 — cache invalidation + orphan-guard | ⏳ next | — |
| U7 — deploy/CI wiring (allowlist line already done) | ⏳ | — |
| U8 — docs (README/MOC/ROADMAP + key runbook) | ⏳ | — |

**Resume with:** `/ce-work U6` against the plan file above. **U6 is pure
config/code — offline-testable, no live key and no #17 dependency.** Do it
before touching U7 (deploy), which is where the key + #17 land.

**U5 shipped (`7b163a1`):** the config is now an envsubst **template**
(`nginx/default.conf.template`); `RENDER_UPSTREAM` is injected at container
start (Dockerfile default is a non-routable `127.0.0.1:9` so nginx always
boots and a miss returns 502 until U7 wires the real Cloud Run URL). The
`^~ /badges/` prefix block owns badge serving and `try_files $uri @render`;
the fallback is scoped to `/badges/` only. Verified end-to-end against a stub
upstream via `scripts/ci/test-nginx-fallback.sh` (wired into the CI
`docker-build` job): static-hit-from-disk, miss-proxies-to-`@render`,
`Cache-Control` passthrough, and scoped-404 all green.

## ✅ Re-verified live 2026-06-26 (with `.env.local` set up)

U1–U4 confirmed working end-to-end on a fresh machine:

- **30/30 offline tests green** (parity 4 · api_client 7 · render 8 · cache 2 ·
  app 9 · allowlist guard).
- **Full live on-demand render of a real credential** = 126KB self-contained SVG,
  fonts embedded, title fetched live from the gateway. The U3→U4 path is sound.
- **The deployed credential set resolves on `mainnet`, not preprod.** All 22
  distinct courses in `generator/credentials.json` return 200 on the **mainnet**
  gateway; **every preprod lookup 502s** (KTD-3b unresolvable). `serve_badge`
  already handles this (tries configured networks in order). **Implication for
  U7:** the production render service must wire the **mainnet** key (and route
  these courses → mainnet gateway) — refines KTD-3's "deployed badges are
  preprod" assumption. Not a U5/U6 concern.
- **#17 is NOT a blocker for U5/U6** (confirmed — see coordination item below).

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
