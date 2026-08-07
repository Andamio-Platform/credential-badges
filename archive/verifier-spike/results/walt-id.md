# walt-id (waltid-identity) verify — transcript

**Verifier:** `walt-id/waltid-identity` (Kotlin/JVM), **built from source at tag `v0.20.5`** (commit `d0e47c7`).
**Sample:** `spike/verifier-spike/publish/credential.jsonld`
**Runner:** `spike/verifier-spike/verifiers/walt-id/` (`run.sh` → `vc verify`)
**Issue:** #16 · **Plan:** Rung 1 / U2
**Pass criterion:** zero errors AND zero warnings.

> **Decision 2026-07-09: walt-id is DEFERRED to post-1.1.** It is not in the
> launch verifier set. The finding below is the rationale — its CLI cannot verify
> the DI JSON-LD sample, and its DI + status coverage is carried by spruce +
> 1EdTech. This file + the runner are kept as the reproducible record for when
> walt-id is revisited (optional third-independent hardening / suspension-UX
> rendering). See `SUMMARY.md` and repo plan P1bis-10.

## Run 2026-07-09 — ⚠ FINDING (structural: CLI is JWS/SD-JWT-only)

### Two premises in the committed runner were wrong — corrected empirically

1. **No `waltid/waltid-cli` docker image exists.** The committed runner pulled
   `waltid/waltid-cli:0.20.0`; that repository does not exist on Docker Hub (the
   `waltid/` org publishes *services* — `issuer-api`, `verifier-api`, … — not the
   CLI), nor on ghcr.io, and GitHub Releases publish **no** prebuilt CLI artifact
   for any 0.20.x tag. The only distribution is **build-from-source via gradle**.
   Built this session (JDK 21 + Gradle 8.14):

   ```
   git clone --depth 1 --branch v0.20.5 https://github.com/walt-id/waltid-identity
   cd waltid-identity/waltid-applications/waltid-cli
   ../../gradlew installJvmDist
   # launcher: build/install/waltid-jvm/bin/waltid
   ```

2. **`vc verify` is JWS/SD-JWT-only — it cannot ingest a W3C Data Integrity
   JSON-LD credential at all.** The `<vc>` argument is documented "in JWS format";
   run against our DI JSON-LD sample, every policy fails on *format*, before any
   cryptography or status resolution:

   ```
   $ waltid vc verify -p signature -p revoked-status-list publish/credential.jsonld
   ╭───────────────────╮
   │Verification Result│
   ╰───────────────────╯
   signature:            Fail! String does not look like JWS: { … the credential … }
   revoked-status-list:  Fail! Invalid SD-JWT format: { … the credential … }
   ```

   Bare `vc verify` (signature policy only) fails identically. **Exit code is
   `0` in every case** — waltid-cli only exits non-zero on *argument* errors, so
   the exit code cannot gate a pass; the result must be parsed from
   `Success!`/`Fail!` on stdout (the runner does this, fail-closed).

### Interpretation

This is the documented **Data Integrity gap**, now empirically confirmed and
larger than "DI unsupported": waltid-cli's `vc verify` is built around
JWT/JWS/SD-JWT credentials and does not parse W3C DI (`DataIntegrityProof`,
`eddsa-rdfc-2022`) JSON-LD at all. It therefore confirms **neither** the DI proof
**nor** the `BitstringStatusListEntry`/`suspension` handling on this sample —
both fail at the JWS-format gate.

Per the repo plan's risk table this is **a finding, not a plan failure**:
independence-by-coverage holds because `spruceid/ssi` **and** the 1EdTech public
validator both verify the sample's DI proof + did:web green (see `spruce.md`,
`onedtech.md`). walt-id does not add a third *green* on the DI bytes — it adds a
recorded structural limitation.

### To make walt-id contribute a green (future work, changes the test)

walt-id could verify a **JWT/VC-JWT-encoded** variant of the same credential
(`jwt_vc_json`), but that is a different artifact than the DI JSON-LD under test
and would not exercise the `eddsa-rdfc-2022` proof. Decide separately whether the
gate wants a JWT variant or a different third DI-capable verifier.

**Status:** ⚠ Finding recorded. Not green on the DI sample (structural: JWS-only CLI).
