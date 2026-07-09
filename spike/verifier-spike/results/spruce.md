# spruce (spruceid/ssi) verify — transcript

**Verifier:** `spruceid/ssi` (Rust), pinned v0.16.x — DI `eddsa-rdfc-2022` + did:web authority (90/91 W3C interop).
**Sample:** `spike/verifier-spike/publish/credential.jsonld`
**Runner:** `spike/verifier-spike/verifiers/spruce/` (`run.sh` → `cargo run`)
**Issue:** #15 · **Plan:** Rung 1 / U1
**Pass criterion:** zero errors AND zero warnings.

## Run 2026-07-09

```
$ verifiers/spruce/run.sh
BLOCKED: cargo not found — install rustup+cargo (https://rustup.rs), then re-run.
exit=3
```

**Empirical: BLOCKED on Rust toolchain.** `cargo`/`rustup` are not installed in
this environment. The verifier harness (`Cargo.toml` + `src/main.rs` + `run.sh`)
is committed and reproducible — the runner fails fast rather than producing a
misleading result.

**To close this row:** install rustup + cargo (https://rustup.rs), then run
`verifiers/spruce/run.sh` and paste the resulting `outcome=… errors=N warnings=N`
line here. On first compile, confirm the pinned `ssi` minor version's
verification entrypoint matches the adapter call in `src/main.rs` (plan KTD5);
adjust that single call if the API moved.

**Status:** ⏸ Blocked on toolchain install (not on any capability gap). Harness ready.
