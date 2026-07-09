//! Minimal spruceid/ssi verifier for the Phase 0 pre-flight sample.
//!
//! Verifies the Data Integrity `eddsa-rdfc-2022` proof and `did:web` resolution
//! on the constructed OB 3.0 credential. Closes the second of three independent
//! verifiers in the Phase 0 gate — issue #15 and the Rung-1 harness plan
//! (`docs/plans/2026-07-09-001-feat-rung1-verifier-harness-plan.md`, U1).
//!
//! Pinned against the `ssi` crate v0.16 (see Cargo.toml). Per plan KTD5 this
//! binary is a THIN ADAPTER: the decode + `verify` calls below are the only
//! pieces coupled to the crate's verification API. If a pinned minor version
//! relocates those entrypoints, adjust only them — nothing else here changes.
//!
//! ssi 0.16.0 API notes (verified against the crate source):
//!   - VC verification lives behind `DataIntegrity<C, AnySuite>` decoded via
//!     `ssi::claims::data_integrity::from_json_str`, then `.verify(&params)`.
//!   - The sample is VCDM **v2** (`credentials/v2` context, `validFrom`), so it
//!     decodes into `ssi::claims::vc::v2::JsonCredential` — NOT the v1 helper
//!     `vc::v1::data_integrity::any_credential_from_json_str`, whose v1 credential
//!     type requires `issuanceDate` and would reject a v2 credential.
//!   - `AnyDidMethod` is the did:web-capable resolver (in `ssi::dids`, not the
//!     prelude glob); `AnySuite` selects `eddsa-rdfc-2022` from the proof's
//!     `cryptosuite` field.
//!
//! Usage:   cargo run -- ../../publish/credential.jsonld
//! Exit:    0 only on zero errors AND zero warnings; non-zero on any finding
//!          (matches the pass bar the 1EdTech public validator already cleared).

use ssi::claims::data_integrity::{from_json_str, AnySuite, DataIntegrity};
use ssi::claims::vc::v2::JsonCredential;
use ssi::dids::AnyDidMethod;
use ssi::json_ld::ContextLoader;
use ssi::prelude::*;
use std::collections::HashMap;
use std::process::ExitCode;

// eddsa-rdfc-2022 canonicalizes the credential to RDF, which requires expanding
// every `@context`. ssi's bundled StaticLoader carries the W3C contexts
// (credentials/v2, security suites) but NOT these two, so we preload them.
// Vendored (not fetched) so context loading is reproducible and offline; the
// only network the runner needs is did:web issuer resolution (host must be live).
const OB3_CONTEXT_URL: &str = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const OB3_CONTEXT_JSON: &str = include_str!("../contexts/ob-v3p0-context-3.0.3.json");
const SPIKE_CONTEXT_URL: &str =
    "https://workshop-maybe.github.io/credential-badges-verifier-spike/context/v0.jsonld";
// Single source of truth: the git-tracked custom context under publish/.
const SPIKE_CONTEXT_JSON: &str = include_str!("../../../publish/context/v0.jsonld");

#[tokio::main]
async fn main() -> ExitCode {
    let path = match std::env::args().nth(1) {
        Some(p) => p,
        None => {
            eprintln!("usage: spruce-verify <credential.jsonld>");
            return ExitCode::from(2);
        }
    };

    let json = match std::fs::read_to_string(&path) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("error: cannot read {path}: {e}");
            return ExitCode::from(2);
        }
    };

    // Parse the JSON-LD VCDM 2.0 Verifiable Credential (carries a
    // DataIntegrityProof; `AnySuite` resolves the suite from the proof's
    // `cryptosuite`, here `eddsa-rdfc-2022`).
    let vc: DataIntegrity<JsonCredential, AnySuite> = match from_json_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error: not a parseable DI JSON credential: {e}");
            return ExitCode::from(2);
        }
    };

    // Preload the two contexts ssi's StaticLoader does not bundle.
    let mut ctx_map = HashMap::new();
    ctx_map.insert(OB3_CONTEXT_URL.to_string(), OB3_CONTEXT_JSON.to_string());
    ctx_map.insert(SPIKE_CONTEXT_URL.to_string(), SPIKE_CONTEXT_JSON.to_string());
    let loader = match ContextLoader::default().with_context_map_from(ctx_map) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: preloaded contexts are not valid JSON-LD: {e}");
            return ExitCode::from(2);
        }
    };

    // did:web resolver. Path-form DIDs resolve as `<domain>/<path>/did.json`
    // (the throwaway host is did:web:workshop-maybe.github.io:credential-badges-verifier-spike).
    let params =
        VerificationParameters::from_resolver(AnyDidMethod::default().into_vm_resolver::<AnyMethod>())
            .with_json_ld_loader(loader);

    // --- adapter point (plan KTD5) ---------------------------------------
    // `verify` returns Ok(Ok(())) on a clean pass, Ok(Err(_)) when the proof
    // is present but invalid, and Err(_) when verification could not run.
    // `warnings=0` is hardcoded below because ssi DI verification is binary
    // (valid / invalid) — it does not surface a distinct warning channel, so
    // the "zero warnings" half of the pass criterion is structurally satisfied.
    match vc.verify(&params).await {
        Ok(Ok(())) => {
            println!("outcome=VALID errors=0 warnings=0");
            ExitCode::SUCCESS
        }
        Ok(Err(invalid)) => {
            println!("outcome=INVALID errors=1 warnings=0");
            println!("finding: {invalid}");
            ExitCode::FAILURE
        }
        Err(e) => {
            println!("outcome=ERROR errors=1 warnings=0");
            println!("verification could not run: {e}");
            ExitCode::FAILURE
        }
    }
    // ---------------------------------------------------------------------
}
