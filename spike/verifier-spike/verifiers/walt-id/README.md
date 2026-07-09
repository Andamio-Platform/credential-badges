# walt-id (waltid-identity) verifier runner

Closes the third independent verifier in the Phase 0 gate — **`walt-id/waltid-identity` (Kotlin/JVM)**, the OB 3.0 + `suspension` status primary. Issue #16.

The hosted `verifier.portal.walt.id` is OpenID4VP-only (it cannot ingest a raw
credential for direct verify), so this runner drives the CLI locally.

## Run

```bash
./run.sh                       # verifies ../../publish/credential.jsonld
./run.sh /path/to/other.jsonld # verify a different credential
```

`run.sh` uses docker by default:

```
docker run --rm --network host -v <sample-dir>:/data:ro \
  waltid/waltid-cli:0.20.0 vc verify --verbose /data/credential.jsonld
```

Override the version/image with `WALTID_VERSION` or `WALTID_IMAGE` env vars.

## Prerequisites

- A **running docker daemon** (`docker info` must succeed). The runner fails
  fast with a `BLOCKED:` message if the daemon is down.
- Network egress — the verifier resolves the `did:web` issuer and the hosted
  `BitstringStatusList` over HTTPS (hence `--network host`).

## What to confirm (pass criterion: zero errors AND zero warnings)

1. **DI `eddsa-rdfc-2022` verifies.** walt-id's Data Integrity `eddsa-rdfc-2022`
   support is not prominently documented — empirical confirmation is the whole
   point of this runner. If walt-id cannot verify the DI proof, that is a
   **finding**, not a plan failure: independence-by-coverage holds because
   `spruceid/ssi` + the 1EdTech public validator both carry DI (repo plan
   risk table). Record the exact message in `../../results/walt-id.md`.
2. **`BitstringStatusListEntry` / `statusPurpose: "suspension"` is surfaced.**
   The transcript must show the status entry was read, not silently ignored.

## Issue #977 workaround

walt-id issue #977 affects **multi-key** did:web resolution. The pre-flight
`../../publish/did.json` pins a **single** verification method
(`#key-2026-05`), which sidesteps it. Keep the DID document single-key when
verifying with walt-id.

## gradle-from-source fallback (no docker)

When a docker daemon is unavailable, build the CLI from source (gradle + JDK 17+
are already expected on a Phase 0 dev machine):

```bash
git clone --depth 1 --branch <v0.20.x-tag> https://github.com/walt-id/waltid-identity
cd waltid-identity/waltid-applications/waltid-cli
../../gradlew build
# then run the built CLI's `vc verify` against the sample
```

Confirm the exact module path and `vc verify` invocation against the pinned
release — the CLI surface is the version-coupled adapter point.

## References

- Issue #16 · repo plan `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md` (P1bis-10, L439–446)
- Rung-1 harness plan `docs/plans/2026-07-09-001-feat-rung1-verifier-harness-plan.md` (U2)
