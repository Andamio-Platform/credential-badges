# U1 gate — gateway service-key verification

**Date:** 2026-06-25 · **Plan:** [#33 dynamic on-demand generation](../plans/2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md) · **Issue:** #33

## Verdict: **GO** (mechanism confirmed) — with three required plan refinements

A non-interactive `X-API-Key` against `andamio-api` **does** read course + per-module
titles for arbitrary `course_id`s. The Monday no-go premise holds. But the live probe
surfaced network-scoping and error-semantics realities the plan must account for before
building.

## What was tested

Read-only GETs against the two documented endpoints, key read from the local
`andamio` CLI config (`dev_alias: manager-001`, `ant_…` key, `base_url: https://api.andamio.io`)
without echoing it. **Note:** this is a personal dev key, not a dedicated service key —
sufficient to prove the *mechanism*; provisioning a dedicated per-network service key
remains a deploy task (KTD-3).

- `GET /api/v2/course/user/course/get/{course_id}` → `data.content.title`, `data.source`
- `GET /api/v2/course/user/modules/{course_id}` → `data[].content.title`, `data[].slt_hash`, `data[].on_chain_slts`, `data[].source`

## Results

| Course | Gateway | course/get | modules | Notes |
|---|---|---|---|---|
| Join Cardano XP (`203e63f4…`) | api.andamio.io | **200** `source=merged` title="Join Cardano XP" | **200** 1 module, title + slt_hash + on_chain_slts | ✅ full data |
| Getting Started at Gimbalabs (`3ed1bca6…`) | api.andamio.io | **200** `source=merged` | **200** 2 modules, full titles | ✅ full data |
| Andamio for Developers (`6348bba0…`, preprod) | api.andamio.io | **502** BAD_GATEWAY "Failed to fetch course" | **502** | course not on this network's indexer |
| Andamio for Developers (`6348bba0…`) | preprod.api.andamio.io | **401** Unauthorized | **401** | mainnet key invalid on preprod gateway |
| Bogus id (`deadbeef…`) | api.andamio.io | **502** BAD_GATEWAY | **502** | unresolvable id → 502, **not 404** |

## Findings → plan refinements

1. **GO on the mechanism.** Non-interactive `X-API-Key` reads titles for arbitrary
   course_ids (proven on two live courses, `source=merged`, full title + slt_hash +
   on_chain_slts). The render-core (U3) parsing matches reality.

2. **Keys are network-scoped (NEW).** The mainnet key returns **401** on
   `preprod.api.andamio.io`. A single key cannot serve courses across networks. The
   deployed *Andamio for Developers* badges are **preprod**, so rendering them on demand
   needs a **preprod** key. → **KTD-3 must store a key per network and route a course_id
   to the matching gateway.** Provisioning a dedicated preprod service key is now an
   explicit prerequisite (couples to issue #17, the preprod credential mint).

3. **Errors are coarse: unresolvable course → 502, not 404 (NEW).** Both a wrong-network
   course and a bogus id return `502 BAD_GATEWAY`. The service **cannot cleanly
   distinguish "not found" from "upstream down."** → **U4 must NOT cache non-200
   responses, and needs a placeholder/validity policy** (e.g. serve `_placeholder.svg`
   or a typed 404/502 passthrough; never persist an error to GCS).

4. **`on_chain_slts` fallback confirmed.** Every module row carried `on_chain_slts`
   alongside `content.title` — KTD-6's fallback chain (DB title → on_chain_slts →
   generic) has a real source.

## Still open (small)

- **Brand-new / `chain_only` credential title.** Every course probed returned
  `source=merged` (DB title present). The specific "freshly-issued credential returns an
  empty title" case wasn't reproducible without a fresh preprod credential (issue #17).
  De-risked by finding #4 (on_chain_slts always present), but worth one live check once a
  fresh preprod `credential_claim` exists.

## Reproduce

`scratchpad/u1_probe.py` (curl-based, like `fetch.py`; prints only safe fields). Key is
read from `~/.andamio/config.json` at runtime and never printed.
