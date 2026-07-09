# Phase 0 pre-flight verifier spike — viability summary

**Plan reference:** `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`
→ "Pre-Phase-0 spike (~1-2 hours)" under Phase 0 + P1bis-10.

**Goal of the spike:** confirm the target verifier set actually handles the
production feature combination on the existing spike sample before Phase 0
locks the set. Decision: keep the set or replace specific verifiers.

**Date:** 2026-05-25
**Run by:** `workshop-maybe` (Claude Code session)

## Target features tested

A constructed OB 3.0 credential carrying all four production-shape elements
simultaneously:

1. `did:web` resolution (`did:web:workshop-maybe.github.io:credential-badges-verifier-spike`)
2. Data Integrity `eddsa-rdfc-2022` cryptosuite proof
3. `BitstringStatusListEntry` with `statusPurpose: "suspension"`, pointing to
   a 131,072-bit (W3C minimum) status list hosted on the same throwaway domain
4. `OnChainCredentialAnchor` as a typed `evidence` entry (with base `Evidence` type)

Realistic Cardano values reused from `spike/samples/sustain-and-maintain-gimbalabs-james-real.jsonld`.

Throwaway host: `https://workshop-maybe.github.io/credential-badges-verifier-spike/`
(GitHub Pages on `workshop-maybe/credential-badges-verifier-spike`, public). Delete when
the spike closes. Production target is `did:web:credentials.andamio.io`.

## Per-verifier outcome

| Verifier | Verifier role | Status | Outcome |
|----------|---------------|--------|---------|
| `@digitalbazaar/vc` (TS) | Self-loopback sanity (not counted toward "≥3 independent") | ✅ Done | Cryptographic proof verifies; status list resolves; did:web resolves |
| `1EdTech digital-credentials-public-validator` (Java, hosted at verifybadge.org) | Spec-driven OB 3.0 conformance | ✅ Done — `outcome=VALID, errors=0, warnings=0, totalRun=13` | Clean pass after iterating on first-pass findings |
| `spruceid/ssi` (Rust) | DI eddsa-rdfc-2022 authority (90/91 W3C interop) | ⏸ Runner committed (`verifiers/spruce/`); run pending Rust toolchain | Empirical TBD — see `spruce.md` |
| `walt-id/waltid-identity` (Kotlin/JVM) | OB 3.0 + suspension primary; published gap on DI documentation | ⏸ Runner committed (`verifiers/walt-id/`); run pending docker daemon | Empirical TBD — see `walt-id.md` |

## Verifier-set viability call

**The plan's P1bis-10 verifier set is preliminarily viable.** Empirical
confirmation is 1-of-3 (1EdTech green). The remaining two are blocked on
local toolchain installs, not on capability gaps surfaced by the spike.

**Rung 1 update (2026-07-09):** reproducible runner harnesses for both remaining
independents are now committed under `spike/verifier-spike/verifiers/` (spruce
Rust binary against `ssi` v0.16.x per issue #15; walt-id docker `vc verify` per
issue #16, with a gradle fallback). Both fail fast with a clear `BLOCKED:`
message when their toolchain is absent — verified 2026-07-09: `cargo`/`rustup`
not installed, docker daemon not running. The empirical count stays **1-of-3**;
the harness reduces closing the gate to *install the toolchain and run the
runner* (see `verifiers/README.md`, `spruce.md`, `walt-id.md`).

**Action to close the gate (Rung 1 "verified when"):**

- Install rustup + cargo → run `verifiers/spruce/run.sh` → capture into `spruce.md`.
- Start docker (or gradle fallback) → run `verifiers/walt-id/run.sh` → capture into `walt-id.md`.
- When both read zero-errors/zero-warnings, flip their rows to ✅ and update this
  call to **3-of-3 independent green**. Any walt-id DI warning is a finding, not
  a blocker: spruce + 1EdTech carry DI (independence-by-coverage).
- **No verifier replacement needed** based on signal collected so far. The
  P1bis-10 set composition (walt-id + spruce + 1EdTech public validator +
  digitalbazaar self-loopback) does not need revision.

## Direct findings for the plan (mapper-grade, lock into Unit 3 / Unit 4)

1. **`evidence[].type` must be array form including `"Evidence"`.**
   The mapper must emit `"type": ["OnChainCredentialAnchor", "Evidence"]`,
   not bare `"OnChainCredentialAnchor"`. OB 3.0 requires every evidence
   entry to include the base `Evidence` type; custom subtypes extend it.
   → Update Unit 3 "Attestation-framing emission" — implication 2.
2. **`proof` must be array form for OB 3.0 Plain JSON compliance.**
   `@digitalbazaar/vc` emits a single proof as `{...}` (JSON-LD-lenient).
   Unit 4's `/credentials/...` response handler must wrap the proof in
   `[{...}]` before serving, or it fails the Plain JSON schema check.
   → Add to Unit 4 server response shape.
3. **`issuer.url` must resolve to a Profile JSON-LD.** Already in Unit 2's
   scope; the spike confirmed 1EdTech's `IssuerProbe` actually exercises
   the dependency (warning when the URL 404s).
   → Already covered; no plan change.

## Findings deferred / unresolved

- **P1bis-02 (suspension UX disposition):** the 1EdTech validator is
  probe-based, not UI-rendering — it doesn't surface a human-readable
  "suspended" banner. To get suspension-UX signal as P1bis-02 requires,
  walt-id or another rendering verifier needs to be installed and a
  bit-flipped credential needs to be sent through it. **P1bis-02 disposition
  remains deferred** until walt-id (or equivalent) is installed.
- **Cross-verifier byte-stability** — the spike signed once and submitted
  once. The plan's "byte-stability across two builds + simulated rotation"
  test (Phase 0 byte-stability gate) is not exercised here and remains a
  Phase 0 deliverable.

## Throwaway hosting cleanup checklist

When Phase 0 closes (or when the spike's data is no longer useful):

- [ ] Delete repo `workshop-maybe/credential-badges-verifier-spike` (or
      archive it for audit-trail purposes).
- [ ] Remove the local working tree at
      `~/projects/01-projects/credential-badges-verifier-spike/`.
- [ ] Keep `spike/verifier-spike/` committed in this repo as plan evidence
      (the plan treats `spike/` as the historical source of truth).
