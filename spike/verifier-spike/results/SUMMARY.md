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
| `@digitalbazaar/vc` (TS) | Self-loopback sanity (not counted as an independent verifier) | ✅ Done | Cryptographic proof verifies; status list resolves; did:web resolves |
| `1EdTech digital-credentials-public-validator` (Java, hosted at verifybadge.org) | Spec-driven OB 3.0 conformance | ✅ Done — `outcome=VALID, errors=0, warnings=0, totalRun=13` | Clean pass after iterating on first-pass findings |
| `spruceid/ssi` (Rust) | DI eddsa-rdfc-2022 authority (90/91 W3C interop) | ✅ Done — `outcome=VALID, errors=0, warnings=0` (`ssi` v0.16.0) | DI `eddsa-rdfc-2022` proof + did:web resolve clean — see `spruce.md` |
| `walt-id/waltid-identity` (Kotlin/JVM) | OB 3.0 + suspension primary; published gap on DI documentation | ⏭ Deferred to post-1.1 — CLI `vc verify` is JWS/SD-JWT-only; cannot ingest DI JSON-LD (finding confirmed by building from source, tag v0.20.5) | Not in the launch set; DI + status carried by spruce + 1EdTech — see `walt-id.md` |

## Verifier-set viability call

**DECIDED 2026-07-09 — launch 1.1 on two independents; walt-id deferred.** The
gate closes on **2 independent complementary verifiers green on the DI sample** —
`spruceid/ssi` and the 1EdTech public validator both report `errors=0, warnings=0`
— plus the digitalbazaar self-loopback. **`walt-id` is deferred to post-1.1**: its
CLI cannot verify the DI JSON-LD sample at all (structural — see below), and its DI
+ status coverage is already carried by spruce + 1EdTech. Revisit walt-id later as
optional third-independent hardening / suspension-UX rendering, not a launch
blocker. (Repo plan P1bis-10 updated to match.)

**Rung 1 update (2026-07-09) — runners run, not just committed.** Both remaining
independents were executed this session (see `spruce.md`, `walt-id.md`):

- **spruce ✅** — installed `rustup`+`cargo 1.97.0`, fixed the `ssi` 0.16.0 API
  drift (thin-adapter, plan KTD5) and preloaded the OB3 + custom JSON-LD contexts
  the bundled loader lacks. Deterministic `outcome=VALID errors=0 warnings=0`.
- **walt-id ⚠ FINDING** — two committed premises were empirically wrong: (1) the
  `waltid/waltid-cli` docker image **does not exist** anywhere (Docker Hub org
  has services only; no ghcr/release CLI artifact) — the CLI must be **built from
  source** (done, tag v0.20.5); (2) `vc verify` is **JWS/SD-JWT-only** and does
  not parse W3C Data Integrity JSON-LD — against our sample every policy fails at
  the format gate (`String does not look like JWS`), at exit code 0. It confirms
  **neither** the DI proof **nor** the suspension status on this sample.

**Gate call: closes on 2 independents by independence-of-coverage.** The plan's
risk table pre-blessed this: walt-id's DI failure is a *finding, not a plan
failure* because spruce + 1EdTech independently carry the DI proof + did:web green.
The two independents between them touch every production feature — spruce carries
DI `eddsa-rdfc-2022` + did:web; 1EdTech carries OB3 spec conformance, the
`OnChainCredentialAnchor` evidence shape, and surfaces `BitstringStatusListEntry`/
`suspension`. What two-instead-of-three gives up: a second independent check on
suspension and an independent *rendering* of it (the already-deferred P1bis-02) —
accepted as post-1.1 hardening.

**Why not force a third:** a **JWT/VC-JWT variant** through walt-id tests a
*different artifact* and does not exercise `eddsa-rdfc-2022`, so it adds no DI
coverage; a different third DI-capable verifier is largely redundant with spruce
(the DI authority). Neither is worth blocking 1.1. walt-id integration is
tracked as optional post-1.1 work — see `walt-id.md` for the reproducible record.

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
  "suspended" banner. walt-id was the intended rendering verifier, but its CLI
  cannot ingest the DI JSON-LD sample (JWS-only — see `walt-id.md`), so it
  provides no suspension-UX signal on this artifact either. **P1bis-02 remains
  deferred** and now needs a *different* rendering verifier (or a JWT variant
  through walt-id) to get suspension-UX signal.
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
