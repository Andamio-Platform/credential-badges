//! Minimal spruceid/ssi verifier for the Phase 0 pre-flight sample.
//!
//! Verifies the Data Integrity `eddsa-rdfc-2022` proof and `did:web` resolution
//! on the constructed OB 3.0 credential. Closes the second of three independent
//! verifiers in the Phase 0 gate — issue #15 and the Rung-1 harness plan
//! (`docs/plans/2026-07-09-001-feat-rung1-verifier-harness-plan.md`, U1).
//!
//! Pinned against the `ssi` crate v0.16 (see Cargo.toml). Per plan KTD5 this
//! binary is a THIN ADAPTER: the single `verify` call below is the only piece
//! coupled to the crate's verification API. If a pinned minor version relocates
//! that entrypoint, adjust only that call — nothing else here should change.
//!
//! Usage:   cargo run -- ../../publish/credential.jsonld
//! Exit:    0 only on zero errors AND zero warnings; non-zero on any finding
//!          (matches the pass bar the 1EdTech public validator already cleared).

use ssi::prelude::*;
use std::process::ExitCode;

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

    // Parse the JSON-LD Verifiable Credential (carries a DataIntegrityProof).
    let vc: AnyJsonCredential = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("error: not a parseable JSON credential: {e}");
            return ExitCode::from(2);
        }
    };

    // did:web resolver. Path-form DIDs resolve as `<domain>/<path>/did.json`
    // (the throwaway host is did:web:workshop-maybe.github.io:credential-badges-verifier-spike).
    let params = VerificationParameters::from_resolver(AnyDidMethod::default());

    // --- adapter point (plan KTD5) ---------------------------------------
    // `verify` returns Ok(Ok(())) on a clean pass, Ok(Err(_)) when the proof
    // is present but invalid, and Err(_) when verification could not run.
    // `warnings=0` is hardcoded below because ssi DI verification is binary
    // (valid / invalid) — it does not surface a distinct warning channel, so
    // the "zero warnings" half of the pass criterion is structurally satisfied.
    match vc.verify(params).await {
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
