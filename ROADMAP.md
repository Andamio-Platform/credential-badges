# Roadmap

Where this repo is going, as a living checklist. **Prototype posture** —
production-hardening details are tracked in the plan; this file is the public
"where are we right now" view. Tick boxes as items close. When a phase
finishes, collapse it to a one-line `✅ closed YYYY-MM-DD` summary.

For *why* each item exists, follow the link into the
[deployment plan](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md).

## Release status

**v1.0 (mainnet core), SHIPPED 2026-06-29.** A learner's on-chain credential
renders as a badge that's visible in the Andamio app and resolves on demand for
*any* credential at `credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg`
(static-first, with an on-demand render fallback so nothing has to be
pre-generated). Live on Cardano **mainnet**.

**v1.1 (the portable / verifiable layer), SHIPPED 2026-07-23.** Ed25519 signing,
`did:web` issuer identity, and OB 3.0 signed VCs are live. The
`credential-badges-issuer` service (deployed `service-v0.1.1`) serves a
KMS-signed, anchor-gated credential for any registered badge at
`credentials.andamio.io/credentials/{network}/{policyId}/{sltHash}/{recipient}`.
A badge's proof is now its signature *and* its Proof-Ring encoding *and* its
on-chain anchor.

**v1.2 (share + embed), SHIPPED 2026-07-24.** Per-badge display/share pages with
OG cards, a PNG pipeline, the two explainers, a standalone holder viewer with
live verified/suspended state, and the `@andamio/andamio-badge` web component on
npm.

**Next up** is the [Phase 3](#phase-3--verification-surface-unit-5) remainder —
the states that assert *signature* validity rather than on-chain state — plus
signing-key lifecycle ([#87](https://github.com/Andamio-Platform/credential-badges/issues/87))
and per-holder baked artifacts.

> **Two version axes, don't conflate them.** The repo/release tag (which deploys
> the static host) is separate from the **JSON-LD schema** version. The schema
> reached **`v1` (stable, byte-frozen)** with the signing work — `/context/v1.jsonld`
> is what every signed credential references, and it is frozen forever. New terms
> ship as `/context/v2.jsonld`, never as an edit to v1; see
> [`docs/solutions/conventions/never-mutate-published-jsonld-context.md`](docs/solutions/conventions/never-mutate-published-jsonld-context.md).

## ✅ Foundations: closed 2026-05-25

Static host live at `https://credentials.andamio.io`; real badge imagery deployed
with the URN-shaped naming convention in production use; repo made public
(PR #9); plan refined through 5 strategic decisions, 2 `/document-review` passes,
and 10 P1bis findings; pre-flight verifier spike reached 1EdTech
`VALID, errors=0, warnings=0` on the production-shape credential (PR #12), with 3
mapper findings folded into Decision 2 / Unit 3 / Unit 4.

## ✅ On-demand badge generation (#33, v1.0 mainnet core): closed 2026-06-29

**Shipped + verified live.** Any credential renders and serves on demand at
`credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg`: static-first, with an
nginx `404 → @render` fallback to the `credential-badges-render` Cloud Run
service (course/module titles read from the **mainnet** andamio-api gateway, SVG
cached in GCS). U1–U8 done; cutover applied (Terraform + gateway keys,
`vrender-0.1.1` render image, `RENDER_UPSTREAM` wired, static host on `v0.1.4`).
End-to-end confirmed: a not-pre-generated credential renders through the public
host. Two-service topology, deploy triggers, and apply order in
[`DEPLOY.md`](DEPLOY.md).

---

# v1.1: portable / verifiable layer

Phases 0–2 are **closed**. What turned the badge from "Proof-Ring + on-chain
anchor" into an independently verifiable OB 3.0 / VC is live; Phase 3 has a
remainder, and Phase 4 is untouched.

## ✅ Phase 0 — Evidence gate: closed 2026-07-23

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-0--must-resolve-before-units-36-lock-re-scoped-2026-05-22).

All seven issues (#15–#21) closed. The verifier gate was **redefined mid-phase**
from "≥3 independent verifiers" to "**2 independents + loopback**": spruce ✅
(green after an ssi-0.16 adapter fix plus vendored contexts) and 1EdTech ✅
(`VALID 13/13, 0 errors` on the live badge's extracted credential, after the
`/did.json` alias in #57). **walt-id is deferred post-1.1** — its CLI is JWS-only
with no docker image, so it cannot verify a Data Integrity JSON-LD proof at all.
Real mainnet claims exist (#17), `block_time` derives reproducibly from the
claim-tx slot (#18), and the comprehension gate ran and closed (#19–#21).

## ✅ Phase 1 — Crypto + CI foundation (Units 1–2): closed 2026-07-23

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-1--cryptographic--ci-foundation-units-12).

- [x] GCP KMS Ed25519 sign key — dedicated sign identity (`credential-badges-sign-sa`), no auto-rotation, `cloudkms` DATA_READ/DATA_WRITE audit logs. **Deviation: the key is `SOFTWARE`, not HSM** → [#87](https://github.com/Andamio-Platform/credential-badges/issues/87)
- [x] `tools/gen-did-json.ts` — emits `/.well-known/did.json` from the KMS pubkey; `tools/did-pin.test.ts` holds the key-pin invariant
- [x] Allowlist + MIME plumbing for `/.well-known/did.json` and `/status/*` (plus the `/did.json` bare-domain alias, #57)
- [x] `/issuer` Profile typed `["Profile", "AttestationHost"]`
- [x] CODEOWNERS on the trust-critical paths — **document-only**, deliberately not backed by branch-protection required reviewers (plan P1bis-09)
- [x] `docs/runbooks/issuer-provisioning.md` — additive rotation (this file) + compromise kill-switch (`docs/runbooks/key-compromise.md`). Writing it surfaced a **prerequisite nobody had noticed: `tools/gen-did-json.ts` cannot emit a two-key DID document**, so no additive rotation is currently possible → [#87](https://github.com/Andamio-Platform/credential-badges/issues/87)

## ✅ Phase 2 — Production service (Units 3–4): closed 2026-07-23

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-2--production-assembly-service-units-34).

Shipped in #61, deployed `service-v0.1.1`. The ops-repo Terraform delta is
applied and verified live: external HTTPS LB routes `/credentials/*` to the
issuer's serverless NEG, Cloud Run ingress is `internal-and-cloud-load-balancing`
(the LB is the only path), the service runs as the sign-only SA distinct from the
deploy identity, and the WIF provider is ref-constrained to `refs/tags/service-v*`
in its own pool. The service refuses to boot on `did.json`, context, or
status-list drift, and treats a 4xx from the static host as drift rather than
unreachability. Every signed credential is loopback-verified before it is served.

Two deviations carried forward: the service lives at `issuer-service/`, not
`service/` (the render service took that path in #33), and **multi-mapper
dispatch (P1bis-05) was not built** — the badge registry gates the service to
Course V2 badges and a single mapper serves them. It becomes additive work when a
new local-state shape ships.

## Phase 3 — Verification surface (Unit 5)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-3--verification-surface--status-list-emission--verifier-guidance-unit-5).

Partly shipped, and **not in the shape the plan anticipated**: instead of one
server-rendered `verify-view.ts`, the surface is static — a per-badge page at
`/badges/{stem}` (#76–#78) and a holder viewer at `/badges/{stem}/{alias}` (#79)
that resolves live on-chain and suspension state client-side.

- [x] Human-facing verification surface — as static badge pages + holder viewer, **not** `service/src/verify-view.ts`
- [x] First emitted BitstringStatusList served at `/status/key-epoch-2026-07.json` (Rung 8.3, positions reserved for key versions)
- [x] `tools/flip-status-bit.ts` CLI (Rung 8.6 — key-epoch + bit-index + purpose; prepares the flip, never signs; CODEOWNERS-gated)
- [x] `docs/runbooks/key-compromise.md` (Rung 8.6 — subsumes the planned `status-flip.md`: trigger criteria, flip containment, cross-verifier read, DID-doc response, re-issuance)
- [x] `docs/verifier-guidance.md` written with worked example (#19, #52) — including the `proof.created` block-time convention
- [ ] **The signature-bearing states.** The viewer ships 2 states (verified / suspended) against the plan's 5, and by design it "does not itself assert a signature is cryptographically valid" — it reads on-chain + suspension state and points at an independent verifier. `anchored+signature-valid`, `anchored+signature-unavailable`, and `indeterminate` are the gap.
- [x] Multi-party process visible in rendered output — shipped in #93: courseOwner pseudonym per badge, the verified andamioscan course link, and the assessor named as absent rather than blank-filled
- [x] **Class artifacts baked — 58 of 58.** Every rendered badge now carries a signed, holder-free Class Achievement, validated **VALID 13/13** against the 1EdTech OB30Inspector (both as a signed artifact and extracted from a baked SVG). The flagship no longer misreports: its shared file carried one holder's credential on a coordinate with six holders.
- [ ] **Per-holder baked artifacts.** The holder half of the same work — a pre-baked artifact per badge-holder pair (215 today), cached rather than committed. Plan: [`docs/plans/2026-07-28-004-feat-fully-baked-badges-plan.md`](docs/plans/2026-07-28-004-feat-fully-baked-badges-plan.md). PNGs remain unbaked (0 of 116).

## Phase 4 — Hygiene + design-not-built (Unit 6)

[Plan reference](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-4--hygiene--deferred-path-design-unit-6).

- [ ] T2 per-org issuer DIDs — **designed, not built** (Issues #4, #6)
- [ ] PQ3 cross-issuer prereq scope — design note (Issue #7)
- [ ] `docs/badge-registry.md` — `badge_id` convention + invariants (Issue #11)
- [ ] 1EdTech membership-gated conformance kit — post-launch credibility marker (rescheduled per Decision 1)

---

# ✅ v1.2 (share + embed): shipped 2026-07-24

Turns a verifiable badge into something a holder can actually *use*. PNG + Open
Graph card pipeline with a self-pruning generator (#75), a static display/share
page per badge with OG tags (#76), share actions — downloads, copy, social, Web
Share, embed snippet, LinkedIn (#77), the two explainers "How do I share this?" /
"How do I check this?" (#78), a standalone holder viewer with live
verified/suspended state (#79), and the `@andamio/andamio-badge` web component
published to npm (#80). Refinements in #83. Released `v1.2.0`.

---

# ✅ Baked artifacts: the shape decision, resolved 2026-07-28

The conflict was real: **a badge image is keyed `(course_id, slt_hash)`; a
credential is keyed `(course_id, slt_hash, holder)`.** The reference badge has
six on-chain holders, so the one baked file asserted that one named person had
earned it — wrong for the other five, and reachable from their own badge pages.

**Resolved by splitting the artifact in two.** A shared badge carries a
**Class Achievement** — holder-free, describing what the badge means. A
**Holder Artifact** — asserting that a named person earned it — is a separate
object at a per-holder address. See `CONCEPTS.md`.

The class half shipped: all 58 rendered badges baked and validated 13/13. The
holder half is planned but not built — pre-baked per badge-holder pair (215
today), cached rather than committed, because holder identity in public git
history is permanent and un-purgeable.

One finding worth carrying forward: the first class shape omitted
`credentialSubject.id`, which the OB 3.0 implementation guide **recommends** and
the published schema **permits**. The reference validator rejected it anyway.
Validating a single artifact before batching caught it for the price of one
signature. Evidence: [`spike/signer-spike/validation/README.md`](spike/signer-spike/validation/README.md).

Procedure: [`docs/runbooks/class-artifact-signing.md`](docs/runbooks/class-artifact-signing.md).

## Where to dig deeper

- **Deployment plan (the "why"):** [`docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md)
- **Repo map for new contributors:** [`MOC.md`](MOC.md)
- **Deploy mechanism:** [`DEPLOY.md`](DEPLOY.md)
- **Original spike (validated end-to-end):** [`spike/README.md`](spike/README.md)
- **Phase 0 pre-flight verifier evidence:** [`spike/verifier-spike/results/SUMMARY.md`](spike/verifier-spike/results/SUMMARY.md)
- **Issuer service (the signing oracle):** [`issuer-service/README.md`](issuer-service/README.md)
- **Open GitHub Issues:** #4, #6, #7, #8, #11 (multi-issuer + design), #36 (event-triggered generate-on-earn), #87 (signing-key lifecycle)
