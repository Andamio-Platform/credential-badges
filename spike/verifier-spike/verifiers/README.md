# Phase 0 verifier harness

Reproducible runners for the Phase 0 multi-verifier gate.

**Launch (1.1) gate — DECIDED 2026-07-09: two independent complementary verifiers**
green on the pre-flight sample with **zero errors AND zero warnings** (any warning
is a finding), plus the `@digitalbazaar/vc` self-loopback sanity check:

- **`spruceid/ssi`** — ✅ VALID, errors=0 warnings=0 (DI `eddsa-rdfc-2022` + did:web).
- **`1EdTech digital-credentials-public-validator`** — ✅ VALID (OB3 spec + status + evidence).

**`walt-id` is deferred to post-1.1**, not in the launch set: its CLI `vc verify`
is JWS/SD-JWT-only and cannot ingest a W3C Data Integrity JSON-LD credential
(`../results/walt-id.md`). Its DI + status coverage is carried by spruce + 1EdTech
(independence-of-coverage). The runner is kept as a reproducible record for when
walt-id is revisited (optional third-independent hardening / suspension-UX
rendering). Rationale + the two-vs-three tradeoff: `../results/SUMMARY.md`.

Locked verifier set: repo plan `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md` (P1bis-10).
Slice plan: `docs/plans/2026-07-09-001-feat-rung1-verifier-harness-plan.md` (Rung 1).

## The sample under test

All runners target the git-tracked, `did:web`-resolvable copy:

```
spike/verifier-spike/publish/credential.jsonld
```

It carries all four production-shape elements at once: `did:web` resolution,
DI `eddsa-rdfc-2022` proof, `BitstringStatusListEntry`/`suspension`, and an
`OnChainCredentialAnchor` typed `evidence` entry. Its `did:web` issuer resolves
via GitHub Pages at `https://workshop-maybe.github.io/credential-badges-verifier-spike/`
(keep that host live until the spike fully closes).

## The four runners

| Verifier | Role | Independent? | Runner | Toolchain | Status |
|----------|------|:---:|--------|-----------|--------|
| `1EdTech digital-credentials-public-validator` | Spec-driven OB 3.0 | ✅ | hosted (verifybadge.org) | none | ✅ VALID · PR #12 |
| `spruceid/ssi` (Rust) | DI `eddsa-rdfc-2022` + did:web authority | ✅ | [`spruce/run.sh`](spruce/run.sh) | rustup + cargo | ✅ VALID errors=0 warnings=0 · `../results/spruce.md` |
| `walt-id/waltid-identity` (JVM) | OB 3.0 + `suspension` primary | ✅ | [`walt-id/run.sh`](walt-id/run.sh) | build from source (no docker image exists) | ⏭ DEFERRED post-1.1: CLI is JWS-only, cannot verify DI JSON-LD · `../results/walt-id.md` |
| `@digitalbazaar/vc` (TS) | Self-loopback sanity | — | `npm run verify` (spike root) | node | ✅ done |

## Run them

```bash
# spruce (spruceid/ssi) — needs rustup + cargo (https://rustup.rs)
verifiers/spruce/run.sh

# walt-id (waltid-identity) — build the CLI from source (no docker image exists),
# then point the runner at it. See walt-id/README.md.
#   git clone --depth 1 --branch v0.20.5 https://github.com/walt-id/waltid-identity
#   cd waltid-identity/waltid-applications/waltid-cli && ../../gradlew installJvmDist
#   export WALTID_CLI="$PWD/build/install/waltid-jvm/bin/waltid"
verifiers/walt-id/run.sh

# loopback sanity (already green)
npm run build && npm run verify
```

Each runner prints an `outcome=… errors=N warnings=N` line and exits non-zero
on any error or warning.

## Where results land

Capture each runner's transcript into `../results/`:

- `../results/spruce.md`
- `../results/walt-id.md`
- `../results/onedtech.md`  (1EdTech, already captured)

Then update `../results/SUMMARY.md` — the per-verifier table and the viability
call — to reflect the empirical count. **The launch (1.1) gate is met: the two
independents (spruce + 1EdTech) are green + loopback; walt-id is deferred
post-1.1** (see SUMMARY for the decision).

## Pass criterion

Zero errors **and** zero warnings on the credential bytes, per verifier. A
warning is a finding to investigate before the gate closes — the bar the
1EdTech pass already cleared (`VALID, errors=0, warnings=0`).
