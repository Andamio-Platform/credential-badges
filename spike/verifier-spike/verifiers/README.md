# Phase 0 verifier harness

Reproducible runners for the Phase 0 multi-verifier gate. The gate closes when
**all three independent verifiers** verify the pre-flight sample with **zero
errors AND zero warnings** (any warning is a finding). A fourth runner, the
`@digitalbazaar/vc` self-loopback, is a sanity check and does **not** count
toward "≥3 independent".

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
| `spruceid/ssi` (Rust) | DI `eddsa-rdfc-2022` + did:web authority | ✅ | [`spruce/run.sh`](spruce/run.sh) | rustup + cargo | see `../results/spruce.md` |
| `walt-id/waltid-identity` (JVM) | OB 3.0 + `suspension` primary | ✅ | [`walt-id/run.sh`](walt-id/run.sh) | docker (or gradle) | see `../results/walt-id.md` |
| `@digitalbazaar/vc` (TS) | Self-loopback sanity | — | `npm run verify` (spike root) | node | ✅ done |

## Run them

```bash
# spruce (spruceid/ssi) — needs rustup + cargo (https://rustup.rs)
verifiers/spruce/run.sh

# walt-id (waltid-identity) — needs a running docker daemon (see walt-id/README.md)
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
call — to reflect the empirical count. The gate is met when the SUMMARY reads
**3-of-3 independent green**.

## Pass criterion

Zero errors **and** zero warnings on the credential bytes, per verifier. A
warning is a finding to investigate before the gate closes — the bar the
1EdTech pass already cleared (`VALID, errors=0, warnings=0`).
