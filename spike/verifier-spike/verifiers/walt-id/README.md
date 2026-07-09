# walt-id (waltid-identity) verifier runner

Was intended as the third independent verifier in the Phase 0 gate —
**`walt-id/waltid-identity` (Kotlin/JVM)**, the OB 3.0 + `suspension` status
primary. Issue #16.

> **DEFERRED to post-1.1 (decision 2026-07-09).** walt-id is NOT in the launch
> verifier set — its CLI cannot verify the DI JSON-LD sample (finding below); DI +
> status coverage is carried by spruce + 1EdTech. This runner is kept as a
> reproducible record for when walt-id is revisited. See `../../results/SUMMARY.md`.

## ⚠ Empirical finding (2026-07-09) — read first

Two premises baked into the original runner were wrong (confirmed by building the
CLI from source at tag `v0.20.5`):

1. **There is no `waltid/waltid-cli` docker image.** Docker Hub's `waltid/` org
   publishes *services* (`issuer-api`, `verifier-api`, …), not the CLI; ghcr.io
   and GitHub Releases have no CLI artifact for any 0.20.x tag. The CLI must be
   **built from source**.
2. **`vc verify` is JWS/SD-JWT-only.** It cannot parse a W3C Data Integrity
   (`DataIntegrityProof`/`eddsa-rdfc-2022`) JSON-LD credential. Against our sample
   every policy fails at the format gate (`String does not look like JWS`), at
   **exit code 0**. walt-id confirms neither the DI proof nor the suspension
   status on this artifact. This is the documented DI gap — a *finding, not a
   plan failure* (spruce + 1EdTech carry DI green). See `../../results/walt-id.md`.

The hosted `verifier.portal.walt.id` is OpenID4VP-only (cannot ingest a raw
credential), so a local CLI is the only path.

## Build the CLI, then run

No docker image exists — build from source (JDK 17+ and gradle; JDK 21 works):

```bash
git clone --depth 1 --branch v0.20.5 https://github.com/walt-id/waltid-identity
cd waltid-identity/waltid-applications/waltid-cli
../../gradlew installJvmDist            # launcher: build/install/waltid-jvm/bin/waltid
export WALTID_CLI="$PWD/build/install/waltid-jvm/bin/waltid"
```

```bash
./run.sh                       # verifies ../../publish/credential.jsonld
./run.sh /path/to/other.jsonld # verify a different credential
```

The runner finds the CLI via `$WALTID_CLI` (or `waltid` on `PATH`) and gates on
parsed `Success!`/`Fail!` stdout — **never the exit code**, which `vc verify`
leaves at 0 even on policy failure. It fails **closed**: the JWS-format rejection
is reported as `outcome=FINDING`, not a false VALID.

## Prerequisites

- A **built waltid CLI** (see above), located via `$WALTID_CLI` or `PATH`. The
  runner fails fast with a `BLOCKED:` message and build instructions otherwise.
- Network egress — `vc verify` would resolve the `did:web` issuer and the hosted
  `BitstringStatusList` over HTTPS *if it got past the JWS-format gate*.

## What to confirm (pass criterion: zero errors AND zero warnings)

1. **DI `eddsa-rdfc-2022` verifies.** walt-id's Data Integrity `eddsa-rdfc-2022`
   support is not prominently documented — empirical confirmation is the whole
   point of this runner. If walt-id cannot verify the DI proof, that is a
   **finding**, not a plan failure: independence-by-coverage holds because
   `spruceid/ssi` + the 1EdTech public validator both carry DI (repo plan
   risk table). Record the exact message in `../../results/walt-id.md`.
2. **`BitstringStatusListEntry` / `statusPurpose: "suspension"` is surfaced.**
   The transcript must show the status entry was read, not silently ignored.

Both confirmations are **currently unreachable**: `vc verify` rejects the
credential at the JWS-format gate before either the DI proof or the status entry
is ever evaluated (see the finding above).

## Issue #977 workaround (now moot for this sample)

walt-id issue #977 affects **multi-key** did:web resolution. The pre-flight
`../../publish/did.json` pins a **single** verification method (`#key-2026-05`),
which sidesteps it. This is moot while the JWS-format gate blocks resolution
entirely, but keep the DID document single-key in case a JWT variant is verified
through walt-id later.

## References

- Issue #16 · repo plan `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md` (P1bis-10, L439–446)
- Rung-1 harness plan `docs/plans/2026-07-09-001-feat-rung1-verifier-harness-plan.md` (U2)
