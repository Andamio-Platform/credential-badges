# Roadmap

Where this repo is going, as a living checklist. **Prototype posture** —
production-hardening details are tracked in the plan; this file is the public
"where are we right now" view. Tick boxes as items close. When a phase
finishes, collapse it to a one-line `✅ closed YYYY-MM-DD` summary.

For *why* each item exists, follow the link into the
[deployment plan](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md).

## Today

- ✅ Static host live at `https://credentials.andamio.io` — `/context/v0.jsonld`, `/issuer`, `/badges/*` (deployed `v0.0.2`, 2026-05-25)
- ✅ Real badge imagery deployed (`v0.0.3`, 2026-05-25) — 4 per-module badges for the *Andamio for Developers* course at `/badges/<policy_id>.<slt_hash>.svg`. The URN-shaped naming convention from the deployment plan is now in production use.
- ✅ Phase 0 target course identified — *Andamio for Developers* (policy `6348bba0f9b7d7e0353715ece5946f3b61de433d314e84dad313a677`) on Cardano preprod. De-risks [#17](https://github.com/Andamio-Platform/credential-badges/issues/17): the unlock narrows from "find a course AND mint a claim" to just "mint a claim".
- ✅ Repo public — `andamio-ops` references removed (PR #9)
- ✅ Plan refined through 5 strategic decisions + 2 `/document-review` passes + 10 P1bis findings (2026-05-25)
- ✅ Phase 0 pre-flight verifier spike — 1EdTech `digital-credentials-public-validator` reached `VALID, errors=0, warnings=0` on the production-shape credential (PR #12, 2026-05-25). 3 mapper findings folded into Decision 2 / Unit 3 / Unit 4.

## On-demand badge generation — #33 (v1.0 mainnet core, in flight)

[Plan reference](docs/plans/2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md) ·
[resume note](docs/plans/2026-06-25-002-on-demand-generation-RESUME.md). The v1.0
gate: **any credential generates + serves on demand**, static-first with an
nginx `404 → @render` fallback to a second Cloud Run service. See
[`DEPLOY.md`](DEPLOY.md) for the two-service topology + apply order.

- [x] U1 — gateway service-key gate (live-verified GO)
- [x] U2 — `gen.py` parameterized render
- [x] U3 — render-core (`api_client` + `render`, live-verified vs the gateway)
- [x] U4 — render service + GCS cache (live e2e)
- [x] U5 — nginx `/badges/` 404 → `@render` fallback (docker e2e)
- [x] U6 — cache invalidation + orphan-guard (`scripts/cache-admin.py`)
- [ ] **U7 — deploy + CI wiring** — `deploy-render.yml` (`vrender-*` trigger, root-context `service/Dockerfile` build, image-only deploy, `/healthz` + live-render smoke), static `deploy.yml` tightened to `v[0-9]*.*.*`, allowlist green. Infra delta = [`andamio-ops#170`](https://github.com/Andamio-Platform/andamio-ops/pull/170). Remaining to ship: apply A–C (TF + keys), cut `vrender-0.1.0` (D), real-image cutover (E), wire `RENDER_UPSTREAM` (F).
- [ ] U8 — docs (DEPLOY/ROADMAP done here; README "How badges resolve" + gateway-key runbook remain)

> **Render service routes to mainnet.** All 22 deployed courses resolve on the
> **mainnet** gateway (every preprod lookup 502s); `serve_badge` tries
> `BADGE_NETWORKS` in order. Production must wire the mainnet key.

## Phase 0 — Evidence gate (in flight)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-0--must-resolve-before-units-36-lock-re-scoped-2026-05-22). Gates Unit 3 (mapper freeze).

- [ ] [#15](https://github.com/Andamio-Platform/credential-badges/issues/15) — Install rustup + cargo; write minimal spruce verifier binary; re-run against `spike/verifier-spike/publish/credential.jsonld`
- [ ] [#16](https://github.com/Andamio-Platform/credential-badges/issues/16) — Install docker (or gradle-from-source); run walt-id verify against the same credential
- [ ] [#17](https://github.com/Andamio-Platform/credential-badges/issues/17) — Mint ≥1 real preprod `credential_claim` (coordination ask, biggest non-code unlock)
- [ ] [#18](https://github.com/Andamio-Platform/credential-badges/issues/18) — Reproducible per-recipient `block_time` source (spike Q8)
- [ ] [#19](https://github.com/Andamio-Platform/credential-badges/issues/19) — Draft `docs/verifier-guidance.md` language with worked example
- [ ] [#20](https://github.com/Andamio-Platform/credential-badges/issues/20) — Name 3-person external comprehension cohort
- [ ] [#21](https://github.com/Andamio-Platform/credential-badges/issues/21) — Run + close comprehension gate (2-week clock; 2-iteration cap)

## Phase 1 — Crypto + CI foundation (Units 1–2, parallel with Phase 0)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-1--cryptographic--ci-foundation-units-12).

- [ ] GCP KMS Ed25519 sign key (HSM, no auto-rotation, dedicated sign identity, audit logging)
- [ ] `tools/gen-did-json.ts` — CI emits `/.well-known/did.json` from the KMS pubkey + key-pin invariant test
- [ ] Allowlist + MIME plumbing for `/.well-known/did.json` and `/status/*`
- [ ] `/issuer` Profile gains `["Profile", "AttestationHost"]` type (currently `["Profile"]` only)
- [ ] CODEOWNERS on 4 trust-critical paths: `issuer/profile.jsonld`, `tools/gen-did-json.ts`, `tools/flip-status-bit.ts`, nginx allowlist
- [ ] `docs/runbooks/issuer-provisioning.md` — rotation (additive) + compromise kill-switch (destructive)

## Phase 2 — Production service (Units 3–4)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-2--production-assembly-service-units-34). Gated on Phase 0 close.

- [ ] **Ops-repo Terraform delta** (lives in the private operations repo): external HTTPS LB + URL map `/credentials/*` → 2nd serverless NEG, 2nd Cloud Run service `credential-badges-issuer`, 2nd WIF/SA ref-constrained to `refs/tags/service-v*`, managed SSL, DNS cutover from existing domain mapping to the LB IP
- [ ] `credential-badges-issuer` service implemented (TS + KMS)
- [ ] Service refuses to start on `did.json` drift (key-pin invariant at startup)
- [ ] Mapper graduates from `spike/src/mapper.ts` to `service/src/mappers/course-v2.ts`; multi-mapper dispatch interface designed (P1bis-05)
- [ ] Characterization test: emitted credential reproduces locked spike-sample structural fields byte-for-byte
- [ ] `https://credentials.andamio.io/credentials/{id}` serves a multi-verifier-conformant, byte-stable signed credential

## Phase 3 — Verification surface (Unit 5)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-3--verification-surface--status-list-emission--verifier-guidance-unit-5). **This is the first phase where a human can "view a deployed credential badge."**

- [ ] `service/src/verify-view.ts` — server-rendered human-facing verification page
- [ ] 5 explicit states with designed copy: anchored+signature-valid, anchored+signature-unavailable, not-found, revoked-signal, indeterminate
- [ ] Multi-party process visible in rendered output: courseOwner pseudonym, assessor pseudonym, on-chain anchor with explorer link
- [ ] First emitted 131,072-bit BitstringStatusList on the static host (W3C minimum; positions 0–63 reserved for key versions)
- [ ] `tools/flip-status-bit.ts` CLI (key-version + incident-id; CODEOWNERS-gated)
- [ ] `docs/runbooks/status-flip.md`
- [ ] `docs/verifier-guidance.md` finalized with worked example on real preprod credential

## Phase 4 — Hygiene + design-not-built (Unit 6)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-4--hygiene--deferred-path-design-unit-6).

- [ ] T2 per-org issuer DIDs — **designed, not built** (Issues #4, #6)
- [ ] PQ3 cross-issuer prereq scope — design note (Issue #7)
- [ ] `docs/badge-registry.md` — `badge_id` convention + invariants (Issue #11)
- [ ] 1EdTech membership-gated conformance kit — post-launch credibility marker (rescheduled per Decision 1)

## Where to dig deeper

- **Deployment plan (the "why"):** [`docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md)
- **Repo map for new contributors:** [`MOC.md`](MOC.md)
- **Deploy mechanism:** [`DEPLOY.md`](DEPLOY.md)
- **Original spike (validated end-to-end):** [`spike/README.md`](spike/README.md)
- **Phase 0 pre-flight verifier evidence:** [`spike/verifier-spike/results/SUMMARY.md`](spike/verifier-spike/results/SUMMARY.md)
- **Tracked work in GitHub Issues:** #3–#8, #11
