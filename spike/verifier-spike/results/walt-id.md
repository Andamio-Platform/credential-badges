# walt-id (waltid-identity) verify — transcript

**Verifier:** `walt-id/waltid-identity` (Kotlin/JVM), pinned v0.20.x — OB 3.0 + `suspension` status primary.
**Sample:** `spike/verifier-spike/publish/credential.jsonld`
**Runner:** `spike/verifier-spike/verifiers/walt-id/` (`run.sh` → docker `vc verify`)
**Issue:** #16 · **Plan:** Rung 1 / U2
**Pass criterion:** zero errors AND zero warnings. Confirm DI `eddsa-rdfc-2022`
verifies and `BitstringStatusListEntry`/`suspension` is surfaced.

## Run 2026-07-09

```
$ verifiers/walt-id/run.sh
BLOCKED: docker daemon not running — start it, or use the gradle fallback (README.md).
exit=3
```

**Empirical: BLOCKED on docker daemon.** `docker` is installed but the daemon is
not running in this environment, and the hosted `verifier.portal.walt.id` is
OpenID4VP-only (cannot ingest a raw credential). The runner + README are
committed and reproducible — the runner fails fast rather than producing a
misleading result.

**To close this row:** start the docker daemon (or use the gradle-from-source
fallback in `verifiers/walt-id/README.md`), then run `verifiers/walt-id/run.sh`
and paste the resulting transcript here. Confirm both:
- DI `eddsa-rdfc-2022` verifies. If walt-id cannot (documented gap), record the
  exact message — it is a **finding**, not a plan failure. Independence-by-coverage
  holds: spruce + 1EdTech carry DI.
- `statusPurpose: "suspension"` is surfaced (not silently ignored).

Keep `publish/did.json` single-key (`#key-2026-05`) to sidestep walt-id #977.

**Status:** ⏸ Blocked on toolchain (docker daemon down). Harness ready.
