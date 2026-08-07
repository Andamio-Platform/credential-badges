//! R6 check: resolve `did:web:credentials.andamio.io` with ssi 0.16's
//! `AnyDidMethod` — the SAME resolver `spruce-verify` (main.rs) uses to resolve
//! the issuer during credential verification. Confirms the production DID doc
//! (deployed by tag v1.0.1) resolves to `#key-2026-07` pinning KMS v1.
//!
//! Usage: cargo run --bin resolve -- did:web:credentials.andamio.io
//! Exit:  0 only if resolution yields the expected fragment + publicKeyMultibase.

use ssi::dids::{AnyDidMethod, DIDResolver, DID};
use std::process::ExitCode;

const EXPECT_FRAG: &str = "#key-2026-07";
const EXPECT_MB: &str = "z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7";

#[tokio::main]
async fn main() -> ExitCode {
    let did_str = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "did:web:credentials.andamio.io".to_string());
    let did = match DID::new(&did_str) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("invalid DID {did_str}: {e}");
            return ExitCode::from(2);
        }
    };

    println!("resolving {did_str} via ssi AnyDidMethod (did:web → HTTPS fetch)...");
    let resolver = AnyDidMethod::default();
    let vm = match resolver.resolve_into_any_verification_method(did).await {
        Ok(Some(vm)) => vm,
        Ok(None) => {
            println!("outcome=FAIL: resolved, but no verification method");
            return ExitCode::FAILURE;
        }
        Err(e) => {
            println!("outcome=FAIL: resolution error: {e}");
            return ExitCode::FAILURE;
        }
    };

    let mb = vm
        .properties
        .get("publicKeyMultibase")
        .and_then(|v| v.as_str())
        .unwrap_or("<none>");
    println!("  id={}", vm.id);
    println!("  type={}", vm.type_);
    println!("  controller={}", vm.controller);
    println!("  publicKeyMultibase={mb}");

    let frag_ok = vm.id.as_str().ends_with(EXPECT_FRAG);
    let mb_ok = mb == EXPECT_MB;
    let type_ok = vm.type_ == "Multikey";
    if frag_ok && mb_ok && type_ok {
        println!("outcome=PASS: spruce/ssi resolves production → {EXPECT_FRAG} pinning KMS v1");
        ExitCode::SUCCESS
    } else {
        println!("outcome=FAIL: frag_ok={frag_ok} mb_ok={mb_ok} type_ok={type_ok}");
        ExitCode::FAILURE
    }
}
