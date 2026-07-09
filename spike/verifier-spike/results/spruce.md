# spruce (spruceid/ssi) verify — transcript

**Verifier:** `spruceid/ssi` (Rust), `ssi` v0.16.0 — DI `eddsa-rdfc-2022` + did:web authority (90/91 W3C interop).
**Sample:** `spike/verifier-spike/publish/credential.jsonld`
**Runner:** `spike/verifier-spike/verifiers/spruce/` (`run.sh` → `cargo run`)
**Issue:** #15 · **Plan:** Rung 1 / U1
**Pass criterion:** zero errors AND zero warnings.

## Run 2026-07-09 — ✅ VALID

Toolchain installed this session: `rustup` + `cargo 1.97.0` / `rustc 1.97.0`
(stable-aarch64-apple-darwin), user-local under `~/.cargo`.

```
$ verifiers/spruce/run.sh
# spruce (spruceid/ssi) verify — 2026-07-09T19:14:45Z
sample: .../spike/verifier-spike/publish/credential.jsonld

outcome=VALID errors=0 warnings=0
exit=0
```

Deterministic across repeated runs. **Empirical: VALID, errors=0, warnings=0.**
The DI `eddsa-rdfc-2022` proof verifies and the `did:web` issuer resolves over
the live host — spruce independently confirms the two things it exists to carry.

## Adapter work required on first real run (plan KTD5)

The committed `src/main.rs` targeted an older `ssi` API and did not compile
against the resolved `ssi` v0.16.0. Two thin-adapter fixes, all confined to the
verify path (nothing else changed):

1. **VC decode + verify entrypoint moved.** `ssi` 0.16.0 has no `.verify()` on
   `AnyJsonCredential`. The credential is decoded with
   `ssi::claims::data_integrity::from_json_str::<JsonCredential, AnySuite>` and
   verified with `vc.verify(&params).await` (returns `Ok(Ok(()))` on a clean
   pass). Same three-arm match as before.
2. **VCDM version.** The sample is VCDM **v2** (`credentials/v2` context,
   `validFrom`), so it decodes into `ssi::claims::vc::v2::JsonCredential`. The
   v1 helper `vc::v1::data_integrity::any_credential_from_json_str` uses the v1
   credential type (requires `issuanceDate`) and would reject the sample.
3. **did:web resolver import.** `AnyDidMethod` lives in `ssi::dids` (not the
   prelude glob): `AnyDidMethod::default().into_vm_resolver::<AnyMethod>()`.

### JSON-LD context loader (the one non-obvious step)

`eddsa-rdfc-2022` canonicalizes the credential to RDF, which requires expanding
**every** `@context`. `ssi`'s bundled `StaticLoader` carries the W3C contexts
(`credentials/v2`, security suites) but NOT:

- `https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json` (OB 3.0)
- `https://workshop-maybe.github.io/credential-badges-verifier-spike/context/v0.jsonld` (custom)

Without them the run fails with `JSON-LD expansion failed: … Unknown context`.
The runner preloads both via `ContextLoader::default().with_context_map_from(…)`,
attached with `.with_json_ld_loader(…)`. They are **vendored, not fetched**, so
context loading is reproducible and offline:

- OB 3.0 context → `verifiers/spruce/contexts/ob-v3p0-context-3.0.3.json` (vendored copy).
- custom context → `include_str!`'d straight from `publish/context/v0.jsonld` (single source of truth).

The only network the runner needs is **did:web issuer resolution** — keep the
GitHub Pages host live (`workshop-maybe.github.io/credential-badges-verifier-spike`).

**Status:** ✅ Green. Independent DI + did:web verifier confirmed.
