---
title: "feat: Andamio Open Badges 3.0 Issuer deployment"
type: feat
status: prototype-grade-p1bis-refined
posture: prototype (Production-hardening checklist documents the upgrade path)
date: 2026-05-16
deepened: 2026-05-16
reviewed: 2026-05-16
decided: 2026-05-22
p1_refined: 2026-05-22
second_pass_review: 2026-05-23
p1bis_refined: 2026-05-25
origin: spike/ (imported from orch ob3-prototype, 2026-05-16 — committed source of truth)
---

# feat: Andamio Open Badges 3.0 Issuer deployment

## ✅ Decisions Locked — Read This First (Prototype Posture)

**Posture:** `credential-badges` is a **prototype**. Core correctness work (signing, attestation
framing, multi-verifier conformance, anchor gate, status-list shape) is at production rigor.
Infrastructure-hardening details (cross-project IAM scoping, branch protection, cosign signing,
continuous integrity monitoring, recipient incident notification) are at prototype rigor. The
"Production-hardening checklist" section near the bottom of the plan documents the upgrade path.

**Decision pass history (2026-05-22 → 2026-05-25):**

1. **5 strategic decisions** locked 2026-05-22 (sequencing, attestation-host framing, revocation,
   did.json location, deploy topology).
2. **First `/document-review` (7 personas)** + **10 P1 findings** resolved same day —
   refining Decisions 2 and 3 substantially (statusPurpose: suspension; key-epoch-only status-list;
   Course V2 mapping scope; startup-drift retry+bundled-fallback+CI-probe; 3-person comprehension
   gate; named verifier set).
3. **Second `/document-review` (re-pass)** 2026-05-23 + **12 auto-fixes** applied: W3C
   BitstringStatusList minimum-size compliance (131,072-bit list, positions 0–63 reserved for key
   versions); archived verifier libraries replaced with maintained successors; second WIF
   ref-constraint specified; startup drift gains SHA-binding + KMS-key-in-registry check;
   comprehension gate bounded (2 iterations, 2 weeks); Course V2 declared internal-only;
   durability claim narrowed.
4. **10 P1bis findings** resolved 2026-05-25 — substantial refinements:
   - **P1bis-01** comprehension gate gains 3 disconfirming questions (probe internalization
     not just recall)
   - **P1bis-02** suspension-UX final disposition deferred to pre-flight spike UX data;
     mass-suspension threat-model entry added
   - **P1bis-03** static incident page is OPTIONAL (prototype posture); verification view shows
     suspended state regardless; productionization makes the incident page required
   - **P1bis-04 + P1bis-06** v0-context update registers 4 attestation-namespaced terms
     (`AttestationHost`, `OnChainCredentialAnchor`, `courseOwner`, `assessor`); mutable
     in-place additive change
   - **P1bis-05** Multi-mapper dispatch ARCHITECTURE designed now (interface contract +
     policy-id signal + shared field compatibility + file structure `service/src/mappers/course-v2.ts`);
     V3 mapper content deferred
   - **P1bis-07** out-of-band smoke probe (separate workflow) only; daily integrity monitor
     dropped under prototype; cosign deferred to productionization
   - **P1bis-08** API-key auth to `andamio-api` (prototype posture); cross-project GCP IAM
     dissolved for v1; production-hardening upgrade path = adopt dbapi/api IAM-binding pattern
   - **P1bis-09** CODEOWNERS = document-only enforcement + glob patterns + force-push disabled
     + minimal Actions permissions; full branch protection deferred to productionization
   - **P1bis-10** Phase 0 verifier set (revised 2026-07-09): **launch (1.1) gate = two
     independent complementary verifiers — spruceid/ssi (DI authority) + 1EdTech
     digital-credentials-public-validator (OB3 spec + status/evidence) — both green on the
     credential bytes, plus the digitalbazaar self-loopback.** walt-id/waltid-identity was
     evaluated and **deferred to post-1.1** (its CLI is JWS-only, cannot verify the DI
     JSON-LD sample — see `spike/verifier-spike/results/walt-id.md`); revisit as optional
     third-independent hardening / suspension-UX rendering, not a launch blocker.

**Next step:** Phase 0 spin-up + Unit 1 kickoff in parallel. Pre-flight verifier spike is
the Phase 0 first sub-task; results inform the suspension-UX disposition (P1bis-02).

| # | Decision | Outcome (2026-05-22) |
|---|----------|----------------------|
| 1 | **Sequencing** | Phase 0 re-scoped: **multi-verifier conformance** (≥2 independent OB3/VC libs) + real preprod claim + Issue #8 — replaces 1EdTech as gate. 1EdTech scheduled post-launch as credibility work. Units 1–2 proceed in parallel with Phase 0; Unit 3 gated on Phase 0 close. Rationale: clients waiting, but no corners on correctness — 1EdTech is a credibility marker, not a correctness requirement, and multi-verifier catches the same class of bugs faster. |
| 2 | **Issuer identity / Issue #8** | **Attestation-host framing** — Andamio is the protocol-layer attestor of a multi-party process (course owner = Access Token holder, assessor = teacher, chain = immutable record, Andamio = anchor + signer). `issuer.id` honestly means "Andamio cryptographically attests that this multi-party process completed correctly on-chain." Five concrete implications in credential structure (see Key Technical Decisions → Issuer identity). The plan **scopes itself to the Course V2 local state** (1 courseOwner, 1 assessor, 1:1 claim-tx→credential; per-local-state mapping spec pattern — future Course V3+ shapes get their own specs, not modifications to this one). James's framing: this is a meaningful innovation in how Andamio communicates trust to the world; **Phase 0 includes a comprehension gate** (3-person external review per P1-02) that empirically tests whether the framing lands — language scaled to claims-validated-by-evidence rather than asserted up front. |
| 3 | **Revocation** | **`BitstringStatusListEntry` with `statusPurpose: "suspension"` and key-epoch-only granularity.** *(Refined 2026-05-22 from the original Decision 3 wording per document-review findings P1-01 + P1-07.)* `statusPurpose: "suspension"` is the W3C-standard purpose for reversible/temporary invalidity — closer to what attestation-freshness means than `"revocation"`, and verifiers display "suspended" not "revoked." The bitstring is ~64 bits total: **one bit per signing key version**. A credential's `statusListIndex` is its key version's position. Flipping a bit affects **all credentials signed under that key version** — right shape for key-compromise events. **No per-credential state in the issuer service.** Flip purpose limited to `compromised-key`; the previously-considered `off-chain-consistency` purpose is dropped (per-credential off-chain disavowal contradicts attestation-host framing; chain burn/transfer is observable on-chain and surfaced by Unit 5). `flip-status-bit.ts` is trivial: one bit per key compromise. Hosted on static host, CODEOWNERS-gated. |
| 4 | **DID-doc location** | **CI-generated, served static by nginx.** `/.well-known/did.json` joins `/context`, `/issuer`, `/badges` on the static host. CI step pulls KMS pubkey → emits `did.json` → key-pin invariant test. Signing service refuses to sign with any key version absent from the published `did.json` at startup (drift becomes a startup failure, not a silent verification break). Reverses the deepening pass's "live-from-service" choice. Rationale: verification must survive signing outage. |
| 5 | **Deploy topology** | Default applied. Two Cloud Run services in `andamio-credentials`: existing `credential-badges` (static nginx) + new `credential-badges-issuer` (TS+KMS). **Path-routing requires an external HTTPS Load Balancer** (Cloud Run `gcloud run domain-mappings` does NOT support path-based routing — domain mapping binds one domain to one service). The ops-repo Terraform delta provisions: (a) an external HTTPS LB with URL map: path matcher `/credentials/*` → serverless NEG for `credential-badges-issuer`, default → serverless NEG for `credential-badges`; (b) managed SSL cert covering `credentials.andamio.io`; (c) DNS cutover from any existing Cloud Run domain mapping to the new LB IP (keep the old mapping warm during verification, then remove). Static host gains `/.well-known/did.json` (Decision 4) and `/status/*` (Decision 3) in the nginx allowlist. Second WIF/SA, **sign-only**, distinct from deploy WIF. **The second WIF provider MUST constrain `attribute.ref` to `refs/tags/service-v*` (not `refs/tags/v*`)** — mirrors the static-host's existing constraint; the two WIFs' ref-constraints MUST be non-overlapping so neither tag prefix can mint the other's token. New tag prefix `service-v*.*.*` for issuer service deploys. **CODEOWNERS (P1bis-09 prototype scope)** gates 6 glob patterns: `issuer/profile.jsonld`, `tools/gen-did-json.ts`, `tools/flip-status-bit.ts`, `static/status/*.json`, `static/.well-known/did.json`, `context/v0.jsonld`, and the nginx allowlist config — document-only enforcement (no required-reviewer branch protection in v1); cheap exception: force-push to default branch disabled. **Ops-repo Terraform delta is the named pre-Unit-4 prerequisite.** |

Phase 0 (re-scoped) is still a hard gate on Unit 3 (mapper freeze). The plan's stance:
**no Unit 3 lock until** (a) the DI-signed sample passes ≥2 independent OB3/VC verifier
libraries; (b) at least one real `credential_claim` exists on preprod and was signed
end-to-end; (c) Issue #8's narrow question — "what claim does `issuer` make under
attestation framing?" — is documented (it's already answered by Decision 2, but the
verifier-guidance language has to be written).

## Overview

Promote the validated `ob3-prototype` spike (now committed at `spike/`) into a production
Open Badges 3.0 issuer, fully backed by Andamio as the cryptographic issuer. This turns
on-chain Andamio Credentials (Cardano native assets indexed by Andamioscan) into signed,
independently verifiable OB 3.0 / W3C VC 2.0 credentials.

**Terminology used throughout this plan.**
- **`credential_claim`** — the on-chain Cardano native-asset mint *transaction* recording a course owner's
  or assessor's decision to grant a credential to a recipient. This is the authoritative on-chain event.
- **claim-tx** — synonym for the credential_claim transaction; used interchangeably.
- **`block_time`** — the Cardano block timestamp of the claim-tx, used as the deterministic source for
  `validFrom` / `proof.created` in the signed VC (see Phase 0 byte-stability gate).
- **OB3 credential / signed credential** — the off-chain JSON-LD document Andamio's issuer service
  derives from the credential_claim and signs. v1 is 1:1 (one OB3 credential per credential_claim).

**Validation status (corrected — read this first).** The credential mapping and OB3 *shape*
are well-developed but **not externally conformance-proven**. Per `spike/validation-results.md`:
local structural checks (14/14), JSON-LD context expansion, and a **VC-JWT** signature
round-trip PASS — on a **synthetic** credential, using the spike's own `did:key` resolver.
**1EdTech OB 3.0 conformance: NOT RUN** (membership-gated). The **Data Integrity
`eddsa-rdfc-2022`** path this plan ships was *not* the path locally validated (JWT was);
its only check is a self-loopback. And **no real `credential_claim` has ever been minted**
on preprod (spike Q1) — the validated sample is synthetic. Therefore this plan is **not**
"promote a proven artifact"; it is "harden a promising spike and obtain the conformance +
real-credential evidence it does not yet have." A **Phase 0 evidence gate** (below) must
close before Units 3–6 lock non-re-litigable decisions.

The work is: (0) run a **DI-signed** sample through **≥2 independent OB3/VC verifier libraries**
and produce ≥1 real preprod `credential_claim` (1EdTech kit re-scoped to post-launch
credibility work — see Decision 1); (1) replace the throwaway `did:key` with a real
Andamio `did:web` identity backed by managed keys, with a CI-generated static `did.json`
(see Decision 4); (2) stand up a deployed assembly+signing service that deterministically
re-derives credentials from on-chain truth and frames Andamio as an **attestation host**
of a multi-party process (see Decision 2); (3) ship a public verification surface plus a
**`BitstringStatusListEntry` with attestation semantics** (see Decision 3) — preserving
the static host's allowlist/CI guarantees and surviving signing-service outages.

## Problem Frame

Today an Andamio Credential exists only as an on-chain Cardano native asset. No signed,
portable OB3 document is produced anywhere in production. The spike proved the full pipeline
works but cut deliberate corners (`spike/CORNERS-CUT.md`): a throwaway Ed25519 key persisted
to disk, `issuer.id` rewritten to a `did:key` that doesn't match the issuer name, no deployed
service, no public verification URL, no revocation read model. A credential is only "fully
backed by Andamio" when a strict third-party verifier can resolve `issuer.id` → a DID document
→ a verification method controlled by Andamio, and the document was signed by a key Andamio
actually custodies. That is the gap this plan closes.

## Requirements Trace

- **R1** — Andamio is the cryptographic OB3 **attestation host** for a multi-party process:
  real `did:web:credentials.andamio.io`, managed signing key, production issuer Profile,
  multi-verifier conformance (≥2 independent libs) in Phase 0; 1EdTech kit deferred to
  post-launch credibility work. (orig req 1; Decisions 1, 2; Issues #3, #5)
- **R2** — Assembly service maps Andamioscan on-chain data → signed OB3 `AchievementCredential`
  pinning the hosted context/issuer/badge image, populating a structured **anchor-proof**
  (mint policy, asset, claim tx) plus course-owner and assessor references; lives in this
  repo as a deployed service. (orig req 2; Decision 2)
- **R3** — Holder binding: a defined `credentialSubject.id` strategy (= recipient = `studentStateAsset`).
  Attestation context (course owner, assessor, chain anchor) lives in separate structured
  fields, not jammed into `credentialSubject`. (orig req 3; Decision 2)
- **R4** — Public verification surface: unauthenticated per-credential URL, server-side
  re-derivation each view, explicit states, on-chain credential-state read model
  reconciled with a **`BitstringStatusListEntry` with `statusPurpose: "suspension"`** whose
  bits represent **key-version freshness** (one bit per signing key version; not per-credential
  earned-status — chain remains authoritative for the latter). (orig req 4; Decision 3 +
  P1-01 + P1-07; spike Q9)
- **R5** — `badge_id` ↔ Andamio Credential (`<course_id>.<slt_hash>`) mapping ownership and
  registry location, with a forward-compatible 1-credential-list data model. (orig req 5; Issue #11)
- **R6** — Issuer sovereignty: ship **T1** (single Andamio DID), design the **T2** per-org-DID
  path, defer **T3** org self-sovereign. Preserve the existing static host allowlist/CI
  guarantees throughout. (Issues #3, #4, #6, #7)

## Scope Boundaries

- **Not** building T2 per-org issuer DIDs or T3 org self-sovereignty — only designing the T1→T2 path.
- **Building (revised 2026-05-22 per Decision 3):** a minimal OB3 `BitstringStatusListEntry`
  with attestation-freshness semantics — a hosted bitstring on the static host, a
  CODEOWNERS-gated flip CLI (`tools/flip-status-bit.ts`), an audit ledger, and the
  `status-flip.md` runbook. The on-chain read model + verifier-guidance two-layer framing
  remain primary; the status list is the convenience signal for off-the-shelf verifiers.
  (Supersedes the earlier scope boundary "Not building OB3 Bitstring Status List revocation
  infrastructure — only the on-chain read model + documented designed path.")
- **Not** changing the on-chain protocol, mint policies, or the `credential_claim` transaction.
- **Not** rebuilding the auth'd self-only holder dashboard at
  `andamio-app-v2/src/app/(app)/credentials/page.tsx` — this is the public verifiable surface;
  backend-sharing is explicitly decided against (different trust + auth model).
- **Not** re-deriving the inner/outer Blake2b state hashes in the service (spike `mapping.md`
  notes TS/Go parity is incomplete) — the service trusts Andamioscan's indexed hashes as the
  on-chain source of truth, same as the spike.

### Deferred to Separate Tasks

- T2 per-org issuer DIDs + provisioning runbook: Issues #4, #6 (designed here, built later).
- Multi-issuer ↔ PQ3 cross-issuer-prereq reconciliation: Issue #7 (spec note here, full work later).
- Per-course on-chain policy key-custody research: Issue #8 (informs T2/T3; does not block T1).
- Recipient-chosen `credentialSubject.id` (email-hash / wallet / per-recipient DID): spike Q2 —
  v1 ships the pseudonymous URN default; richer binding is a later iteration tied to the claim flow.
- Bitstring Status List revocation: spike Phase 4.
- Veridian / KERI substrate (`did:webs` issuer + TEL-backed status-list projection): additive
  under the OB3 wire format, non-breaking with v1. Trigger: when holder-side wallet UX or
  recipient recovery becomes a goal — pairs with the Q2 holder-binding deferral above. v1
  hygiene: keep the issuer DID a single config value so the eventual `did:web` → `did:webs`
  migration stays a resolver-side change.

## Context & Research

### Relevant Code and Patterns

- `spike/src/mapper.ts` — locked Andamio→OB3 transform; field-by-field spec in `spike/mapping.md`.
- `spike/src/sign-di.ts` — Data Integrity `eddsa-rdfc-2022` signer; this is the production
  signing path. **Validation status (corrected, 2026-05-22):** the spike's *only* externally
  exercised path was VC-JWT on synthetic credentials against its own resolver; the DI path
  this plan ships has only a local self-loopback (CORNERS-CUT #7). DI conformance is closed
  by Phase 0 multi-verifier conformance (Decision 1). `spike/src/sign.ts` (JWT) is the spike
  baseline only — JWT was never validated against real on-chain data either.
- `spike/src/path-b.ts` — programmatic builder: alias + policy id → full OB3 doc from chain.
- `spike/src/verify.ts` + `spike/src/plutus.ts` — on-chain datum-membership check (the
  revocation/anchor read model foundation).
- `spike/src/keys.ts` — throwaway key generation; the thing being **replaced** by managed keys.
- Existing static host: `Dockerfile`, `nginx/default.conf`, `scripts/ci/check-allowlist.sh`,
  `.dockerignore`, `.github/workflows/{ci,deploy}.yml` — allowlist + tag-triggered WIF deploy
  to Cloud Run (GCP project `andamio-credentials`). Pattern to preserve, not break.

### Institutional Learnings

- `spike/CORNERS-CUT.md` — the 8 cut corners; this plan hardens corners 1, 2, 4, 5, 6, 7.
- `spike/open-questions.md` — 14 open questions; Q3/Q4 resolved, Q2/Q5/Q8/Q9/Q10 addressed here.
- `spike/prerequisite-chaining.md` — PQ1–PQ6 ratified defaults; PQ3 interacts with R6/Issue #7.
- Issues #3–#8, #11 — the issuer-identity decision graph; #3 is the ratified anchor (T1 chosen).

### External References

- W3C VC Data Model 2.0; Open Badges 3.0 (context `v3p0/context-3.0.3.json`).
- W3C VC `BitstringStatusListEntry` — credentialStatus mechanism mainstream OB3 verifiers honor.
- `did:web` method spec — DID doc served over HTTPS (this repo already serves HTTPS JSON-LD).
- Data Integrity `eddsa-rdfc-2022` cryptosuite — canonicalized-RDF Ed25519 proof; preferred
  over VC-JWT for JSON-LD-native verifier acceptance. Conformance via multi-verifier
  cross-check in Phase 0 (≥2 independent OB3/VC libs); 1EdTech kit post-launch (Decision 1).
- GCP KMS (asymmetric Ed25519 sign) — managed key custody in the existing `andamio-credentials` project.

## Key Technical Decisions

- **Language: keep TypeScript.** The DI signing implementation is TS
  (`@digitalbazaar/data-integrity` + `eddsa-rdfc-2022`); the spike's "port to Go" note assumed
  the service would live in `andamio-api`, which changed (service lives here). Keeping TS
  avoids re-introducing canonicalization/signing risk. Phase 0 (Decision 1) confirms the TS
  DI path passes ≥2 independent verifier libs before Unit 3 freezes the mapper.
- **Signing: Data Integrity `eddsa-rdfc-2022`, not VC-JWT.** JSON-LD-native; the spike's
  real-recipient samples use it. The spike's only validated signature path was VC-JWT; DI
  has a self-loopback check only (`spike/CORNERS-CUT.md` #7). Phase 0 closes that gap via
  multi-verifier cross-check. JWT retained as a fallback library-side until DI conformance is
  observed across the multi-verifier set.
- **Issuer identity: attestation host of a multi-party process — single `did:web:credentials.andamio.io`.**
  (Decision 2 — supersedes earlier "T1, per-course differentiation via Profile name/logo only".)
  Andamio is *not* claiming to be the issuer-of-record of any individual credential; Andamio
  is the protocol-layer attestor that a multi-party process (course owner = Access Token
  holder; assessor = teacher; chain = immutable record; Andamio = anchor + signer) produced
  this credential correctly on-chain. `issuer.id = did:web:credentials.andamio.io` honestly
  means: **"Andamio cryptographically attests that this multi-party process completed
  correctly on-chain, anchored on Andamio's protocol."** This is defensible regardless of
  who controls any individual course's mint policy (Issue #8) — Andamio's claim is about
  anchoring integrity, not substantive authority.

  **Plan scope: v1 maps the "Course V2" local-state shape** (locked 2026-05-22 per P1-04 +
  Andamio domain memory). **"Course V2" is internal plan-scoping terminology and MUST NOT
  appear in any user-facing field** — not in the credential's `name`, `description`, or any
  visible Achievement field; not in the verification view's rendered output; not in
  `verifier-guidance.md`. It's a label for the on-chain local-state shape, not a product
  version number. Course V2 invariants:
  - **1:1 course_id ↔ courseOwner alias** — domain invariant; will not change across local
    states; courseOwner is course-level, never per-credential within a course.
  - **Exactly one assessor per credential** — Course V2 design. Multiple teachers may
    operate within a course; two credentials from the same course can differ *only* by
    assessor.
  - **1:1 claim-tx → OB3 credential** — Course V2 emits one OB3 credential per approved
    assignment commitment.
  Future local states (Course V3+, or differently-named) will get **their own mapping
  specs**, not modifications to this one. Per-local-state mapping is the protocol-aligned
  pattern, mirroring Andamio's existing "Course" / "Project" local-state separation.

  **Phase 0 revision authority (narrowed per P1-04):** Decision 2's field shapes are
  *locked* for the Course V2 invariants above. Phase 0 has authority to revise only:
  - The `OnChainCredentialAnchor` field set (currently `network, policyId, asset, claimTxHash`)
    if real preprod data shows additional fields are needed (e.g. slot, datum hash) to
    disambiguate the anchor.
  - The `credentialSubject.id` URN derivation against real recipient data.
  James is the decision authority for any such revision.

  Five concrete implications (locked for Course V2):
  1. **`issuer.type`** = `["Profile", "AttestationHost"]` with a human-readable `description`
     field stating the role ("Andamio is the protocol-layer attestor of a multi-party
     credential process; this credential references the on-chain record below for the
     authoritative truth of issuance").
  2. **Structured anchor-proof field** — emit as the VC standard `evidence` field with
     **array-form type `["OnChainCredentialAnchor", "Evidence"]`** (NOT bare
     `"OnChainCredentialAnchor"`; OB 3.0 requires every evidence entry to include the
     base `Evidence` type, with custom subtypes alongside). Carries `network`, `policyId`,
     `asset`, `claimTxHash`. Supersedes the earlier ad-hoc `onChainAnchor` /
     `onChainAttestation` field names — use `evidence` (typed
     `["OnChainCredentialAnchor", "Evidence"]`) consistently throughout the plan and
     implementation; no other field name is correct. *(Empirical: Phase 0 pre-flight
     verifier spike, 2026-05-25, `spike/verifier-spike/`: 1EdTech `EvidenceProbe` rejected
     bare-string type; array form passed.)*
  3. **Course-owner reference** included as a structured field referencing the Access Token
     holder (pseudonymous URN; e.g. `urn:andamio:{network}:course-owner:{accessTokenAsset}`).
     The course-owner is the credential-program operator; the credential should expose this.
  4. **Assessor reference**, where the on-chain record yields it (teachers are typically also
     Access Token holders), included as a structured field — verifiable pseudonym only, no
     human name. If not present in the on-chain record for a given credential, the field
     is omitted (not blank-filled).
  5. **`docs/verifier-guidance.md` leads with this framing** — explains that Andamio's
     signature attests to *anchoring integrity*, not to being the substantive authority, and
     shows how to verify the chain reference independently using the structured anchor-proof.
  `credentialSubject.id` remains the recipient (`studentStateAsset` per the gated single
  datum read) — attestation *context* (owner, assessor, chain anchor) lives in the structured
  sibling fields above, **not** jammed into `credentialSubject`. This also resolves the
  spike's `mapper.ts` vs `path-b.ts` `credentialSubject.id` ambiguity (`studentStateAsset` wins).
- **Revocation: `BitstringStatusListEntry` with `statusPurpose: "suspension"` and key-epoch-only
  semantics** (Decision 3, refined 2026-05-22 per document-review findings P1-01 + P1-07 +
  second-pass auto-fix for W3C minimum-size compliance). Supersedes the original Decision 3
  wording ("attestation-freshness with statusPurpose: revocation") which review showed
  structurally misleads verifiers. The credential includes a `credentialStatus` entry of type
  `BitstringStatusListEntry` with `statusPurpose: "suspension"` (W3C-standard; semantically
  reversible/temporary; matches what attestation-freshness actually means). Pointing to a
  hosted bitstring on the static host (`/status/{listId}.json`). **The bitstring is
  131,072 bits (W3C minimum, ~16KB uncompressed, ~150 bytes gzipped)** — key-epoch
  semantics are implemented by **reserving positions 0–63 for signing key versions**
  (bit 0 = `key-2026-05`, bit 1 = `key-2026-06`, …); positions 64..131071 are reserved
  zero forever (or for a future per-credential flip-purpose if attestation framing ever
  evolves). A credential's `statusListIndex` is the bit position of the **key version that
  signed it**, not its own identity. Flipping a bit affects **all credentials signed under that key version
  simultaneously** — exactly the right shape for a key-compromise event. **No per-credential
  state lives in the issuer service.** The off-chain-consistency flip purpose
  (originally Decision 3) is dropped: per-credential off-chain disavowal is exactly the
  substantive issuer authority that attestation-host framing rejects (Decision 2); chain
  burn/transfer is observable on-chain and surfaced by Unit 5's verification view.
  `flip-status-bit.ts` operates on a key-version index (single bit flip per compromise event),
  not a credential URN. Bitstring is CI-emitted (allowlisted route, MIME
  `application/vc-statuslist+json`), regenerated on bit-flip via the CODEOWNERS-gated CLI.
  `docs/verifier-guidance.md` documents the two-layer model: status = convenience signal
  (key-version freshness); chain = authoritative for per-credential state.
- **Key custody: GCP Cloud KMS `EC_SIGN_ED25519`, HSM protection level.** Confirmed feasible
  (GA 2024): Cloud KMS Ed25519 is PureEdDSA over **raw** message bytes (the `data` field, never
  `digest`) — exactly what `eddsa-rdfc-2022` needs, since the cryptosuite canonicalizes+hashes
  *before* calling the signer. Private key never leaves KMS. **Do not** use protection level
  `EXTERNAL` (Ed25519 unconfirmed there). **Do not** enable KMS automatic rotation (it would
  silently desync the published DID-doc public key from the signing version) — rotation is
  managed explicitly: new KMS key version → new versioned DID-doc fragment → new credentials
  use the new fragment. Replaces `spike/src/keys.ts` disk key (corner 1).
- **Signer integration is a first-class seam, not a hack.** `new DataIntegrityProof({ signer,
  cryptosuite: eddsaRdfc2022 })` accepts a custom signer `{ id, algorithm:'Ed25519',
  async sign({data}) }`. The KMS adapter MUST return the **raw 64-byte** Ed25519 signature
  unmodified and **assert `length === 64`** before passing it to `DataIntegrityProof` (Cloud
  KMS already returns raw; any DER/base64/hex transcode corrupts every proof). `signer.id` =
  the fully-qualified versioned DID URL (`did:web:credentials.andamio.io#key-YYYY-MM`),
  byte-identical to the DID-doc fragment, forever. Verification method published as
  `Multikey` / `publicKeyMultibase`, listed in **both** `verificationMethod` and
  `assertionMethod`. Old verification methods are **retained in the DID doc** while any
  credential signed under them must still verify (non-expiring badges ⇒ keys published
  effectively forever); removing a verification method is reserved for the compromise
  kill-switch, which intentionally invalidates credentials signed under it.
- **Signing is HARD-gated on a positive on-chain anchor check (security-critical).** The KMS
  signing call MUST be unreachable unless a single shared datum read proves: (a) the
  caller-supplied `policyId` is a key in the recipient's current global-state datum credential
  map, (b) the on-chain hash for that policy is **byte-equal** to the caller-supplied
  `sltHash`, and (c) the on-chain alias bytes match the resolved `recipient`. Failing any →
  `not-found` / `revoked-signal` with **zero** KMS operations. The gate read and the signed
  assertion consume one datum read (no TOCTOU). The issuer DID is a fixed server-side constant;
  it is never derived from request input and has no fallback key/DID path. Rationale: without
  this, the endpoint is an open Andamio-signing oracle (`spike/src/path-b.ts` resists
  "policy absent" but does **not** assert the caller `sltHash` equals the on-chain hash;
  `spike/src/verify.ts` is a post-hoc CLI harness, not a precondition).
- **DID document is CI-generated from KMS and served static by nginx** (Decision 4 —
  reverses the deepening pass's "live-from-service" choice). `did:web:credentials.andamio.io`
  resolves to `/.well-known/did.json` on the static host (joining `/context`, `/issuer`,
  `/badges`, and `/status/*`). CI step: pull KMS pubkey for the active key version(s) →
  emit `did.json` → key-pin invariant test asserts the resulting `did.json` references the
  intended `signer.id` fragment → deploy as static artifact. **Drift prevention via service
  startup check:** the issuer service reads the published `did.json` at startup, compares
  to its intended `signer.id` fragment, and **refuses to start** if absent — drift becomes a
  startup failure, never a silent broken signature. Rationale: verification must survive
  signing-service outage. Under attestation framing, signed credentials are correct
  point-in-time attestations of completed past events; they should remain verifiable
  independent of whether the current signing service is alive. Smaller trust surface (nginx
  allowlist) gets to hold the trust-critical artifact. Tradeoff vs live-from-service: an
  extra CI step on key rotation (CI run + static-host redeploy) in exchange for verification
  durability through service outages.
- **Deterministic reproducibility, not mere re-derivation — scoped honestly.** Every request
  rebuilds from Andamioscan state via the locked mapper; pinning `validFrom` **and**
  `proof.created` to the claim-tx `block_time` removes the *obvious* time-varying fields. But
  byte-stability is **only achievable within a single build + key epoch** and is **not yet
  demonstrated**: RDFC-2022 canonicalizes expanded RDF, so (i) a context-version change
  (Andamio context is still `v0`, "shape may change"), (ii) any Andamioscan field/ordering
  change in the mutable course content the body embeds, or (iii) a key rotation (re-derived
  old credentials sign under the *current* fragment, since nothing is persisted) each silently
  break byte-identity for already-distributed copies. **Open dependency, not resolved:** the
  spike does not have a per-recipient claim-tx `block_time` source (it uses policy-mint time;
  Q8 punted; no real claim exists — Q1). Phase 0 must either empirically demonstrate
  byte-stability (same on-chain input, two independent builds + a simulated rotation → assert
  byte-identity) or the plan drops the byte-stability contract and **reconsiders the rejected
  "durable proof + derived body" alternative**. Until then this is a gating prerequisite of
  Unit 4 and the KMS-SPOF mitigation that depends on it is provisional.
- **Production document loader is closed and build-time-pinned.** No arbitrary network fetch
  at request time during canonicalization: the W3C VC 2.0 / OB3 / Andamio contexts and the
  `did:web` resolver are bundled or fetched only from the pinned same-origin host with
  integrity checks; any unlisted URL is rejected (no network fallthrough). Rationale: a
  per-request server-side JSON-LD signer with a permissive loader (spike CORNERS-CUT #3/#5/#7)
  is an SSRF + availability dependency on the signing path — not acceptable as "TBD".
- **`credentialSubject.id`: v1 = pseudonymous URN** `urn:andamio:{network}:recipient:{studentStateAsset}`
  (spike default — on-chain-derivable, privacy-preserving). Recipient-chosen binding deferred (Q2).
- **Badge registry: in this repo.** `badge_id` is the `<course_id>.<slt_hash>` URN itself
  (1:1 Andamio Credential → OB3 Achievement). Data model stores a credential **list** but v1
  only ever emits length-1 lists (forward-compat for future multi-credential badges; no
  multi-credential logic/UX built).

## Open Questions

### Resolved During Planning

- **Issuer identity (Decision 2, 2026-05-22):** attestation-host framing — Andamio is the
  protocol-layer attestor of a multi-party process (course owner + assessor + chain +
  Andamio anchor/signer). Supersedes the earlier T1/T2/T3 tier framing for v1 — under
  attestation framing, per-org DIDs are no longer correctness-relevant. Issue #8 (mint-
  policy custody) no longer gates correctness because Andamio's `issuer` field truthfully
  claims attestation-host authority regardless of who controls any individual policy.
- **Sequencing + Phase 0 scope (Decision 1, 2026-05-22):** Phase 0 re-scoped to multi-
  verifier conformance (≥2 independent OB3/VC libs) + real preprod claim + verifier-
  guidance language. 1EdTech kit rescheduled post-launch as credibility work.
- **Revocation (Decision 3, 2026-05-22):** ship `BitstringStatusListEntry` with attestation
  semantics — bits = attestation freshness, not earned-status. Hosted on static host.
- **DID-doc location (Decision 4, 2026-05-22):** CI-emitted from KMS, served static by
  nginx. Service consumes via startup drift check.
- **Deploy topology (Decision 5, 2026-05-22):** two Cloud Run services, LB path-routed
  on `credentials.andamio.io`. Sign-only WIF distinct from deploy WIF. Ops-repo Terraform
  delta is pre-Unit-4 prerequisite.
- Service home → new deployed service in this repo (user-confirmed).
- Pull scope → spike committed as source of truth here; internal strategy gitignored (done).
- Signing approach → Data Integrity `eddsa-rdfc-2022` *intended* (JSON-LD-native), JWT as
  fallback. Multi-verifier conformance closes the validation gap (Decision 1, Phase 0).
- Language → TypeScript (reuse the most-developed implementation).
- KMS feasibility → confirmed by external research: Cloud KMS `EC_SIGN_ED25519` (HSM) is
  PureEdDSA over raw bytes, injectable as a custom `DataIntegrityProof` signer returning raw
  64-byte sigs. Solidly established.

### Phase 0 — Must Resolve Before Units 3–6 Lock (re-scoped 2026-05-22)

Phase 0 is the **evidence gate** that protects Units 3–6 (mapper, language, signing path,
identity model) from being re-litigated. Decision 1 re-scoped this: dropped 1EdTech as a
gate (rescheduled to post-launch credibility work), kept the substantive correctness checks.
The remaining gates:

- **Multi-verifier DI conformance** (replaces 1EdTech kit, refined per P1-09 + P1bis-10).
  Original design: three **independent** verifiers covering complementary coverage gaps
  (Explore-agent research 2026-05-25 surfaced that no single named library covers the full
  feature combination — walt-id is strong on OB3 + suspension but weak on DI eddsa-rdfc-2022;
  spruceid/ssi is the inverse), plus a self-loopback check. **Revised 2026-07-09 (empirical):
  the launch (1.1) gate is TWO independent complementary verifiers — spruce + 1EdTech, both
  green — plus the loopback. walt-id is deferred (see its bullet below).** Between them the two
  independents touch every production feature: spruce carries DI `eddsa-rdfc-2022` + did:web;
  1EdTech carries OB3 spec conformance, the `OnChainCredentialAnchor` evidence shape, and
  surfaces the `BitstringStatusListEntry`/`suspension` status. The one thing two-instead-of-
  three gives up is a second independent check on suspension and an independent *rendering*
  of it — that is the already-deferred P1bis-02, now explicitly a post-1.1 item.
  - **`spruceid/ssi` Rust crate** and **`1EdTech digital-credentials-public-validator`** —
    the two launch independents (detailed below).
  - **`walt-id/waltid-identity` verifier (Kotlin/JVM)** — successor to ssikit. v0.20.x+.
    **DEFERRED to post-1.1 (decision 2026-07-09).** Was the intended primary for **OB3
    AchievementCredential + BitstringStatusListEntry with `statusPurpose: "suspension"`**.
    Empirical finding (built from source, tag v0.20.5): its CLI `vc verify` is **JWS/SD-JWT-
    only** and cannot ingest the W3C Data Integrity JSON-LD sample at all — it verifies
    neither the DI proof nor the suspension status on this artifact, and there is no official
    docker image (source build only). Not worth the integration cost for launch; DI + status
    coverage is carried by spruce + 1EdTech (independence-by-coverage). Revisit post-1.1 as
    optional third-independent hardening or for suspension-UX rendering — possibly via a
    JWT/VC-JWT variant, which is a *different* artifact than the DI credential under test.
    (Historical caveat if revisited: walt-id issue #977 affects multi-key did:web resolution;
    workaround = single-key DID docs, which `publish/did.json` already uses.) Full record:
    `spike/verifier-spike/results/walt-id.md`.
  - **`spruceid/ssi` Rust crate** (v0.16.x+, used directly, not via the archived `didkit-cli`).
    Primary verifier for **DI `eddsa-rdfc-2022` + did:web**: 90/91 on W3C eddsa-rdfc-2022
    interop test suite. OB3 schema enforcement may need custom Rust code (no documented
    examples); pre-flight spike writes a minimal verifier binary.
  - **`1EdTech digital-credentials-public-validator`** (https://github.com/1EdTech/digital-credentials-public-validator)
    — **third independent verifier; free + public** (distinct from the membership-gated
    1EdTech conformance kit). Gives us most of the 1EdTech credibility value at zero
    scheduling cost. Used as the spec-driven Phase 0 conformance check.
  - **`@digitalbazaar/vc` + `@digitalbazaar/data-integrity` (TS)** — self-loopback check
    that the KMS-signed output still verifies through the signing stack. **Not counted
    as an independent verifier** (it's not independent of itself).
  **Note on 1EdTech (Decision 1 refinement):** with the public validator running in Phase 0,
  the deferred-post-launch 1EdTech work narrows to **just the formal membership-gated kit
  run** as the final credibility marker (a much smaller post-launch task than originally
  framed). The public validator catches the same class of structural bugs.
  **Pre-Phase-0 spike (~1-2 hours):** confirm each candidate library handles the full
  feature combination on the existing spike sample: `did:web` resolution, `eddsa-rdfc-2022`,
  `BitstringStatusListEntry` with `statusPurpose: "suspension"` (P1-01), `OnChainCredentialAnchor`
  as opaque custom evidence type. Any candidate that fails the spike must be replaced
  before Phase 0 starts; do not enter the gate with verifier-set viability unknown.
  **Status (2026-05-25): RUN.** `spike/verifier-spike/` carries the workspace, signed
  credential, and verifier transcripts. Outcome: 1EdTech public validator reached
  `outcome=VALID, errors=0, warnings=0, totalRun=13` after three mapper-grade findings
  were addressed (now baked into Decision 2 implication 2 + Unit 3 attestation-framing
  emission + Unit 4 served-response shape — see `spike/verifier-spike/results/SUMMARY.md`).
  Self-loopback (`@digitalbazaar/vc`) green. **Update 2026-07-09 — both remaining independents
  were run** (Rung 1 harness, `feat/rung1-verifier-harness`): **`spruceid/ssi` v0.16.0 → VALID,
  errors=0, warnings=0** on the DI-signed sample (green, launch independent #2). **`walt-id`
  built from source (tag v0.20.5) → structural finding: CLI `vc verify` is JWS/SD-JWT-only,
  cannot ingest the DI JSON-LD sample** — deferred to post-1.1 (see the walt-id bullet above
  and `spike/verifier-spike/results/walt-id.md`). **P1bis-10 set composition IS revised: the
  launch gate is now the two independents (spruce + 1EdTech) + loopback.**
  **Pass criteria:** the two independent libraries (spruce + 1EdTech) must verify the same
  credential bytes with **no errors AND no warnings** (achieved). A warning from any library
  is a finding to investigate before
  the gate closes. **Arbitration on disagreement:** W3C VC 2.0 + OB 3.0 specs are the
  tiebreakers. If a library's rejection is spec-correct, we fix the credential. If it is
  over-strict (verifier bug), open an issue with the maintainer, document the deviation,
  and exclude the specific check with rationale. Never silently pick the most-permissive
  verifier.
- **No real `credential_claim` exists** on preprod (spike Q1). Produce ≥1 real claimed
  credential and sign it end-to-end (real Andamioscan read → mapper → KMS-signed VC) before
  the mapper/identity model is frozen against synthetic fixtures. Confirms the mapper and
  attestation-host framing work on actual on-chain data, not just fixtures.
- **`validFrom`/`proof.created` source unproven.** The spike uses *policy-mint* time, not
  per-recipient *claim-tx* `block_time` (Q8 punted). Byte-stable determinism — and the
  KMS-SPOF mitigation built on it — is unestablished until this source is real and shown
  stable across fetches/builds/rotation. If unrecoverable, choose a documented deterministic
  fallback or reconsider "durable proof + derived body".
- **Issue #8 narrow question, restated under attestation framing.** Decision 2 already
  resolved the substance — Andamio's `issuer` field claims attestation-host authority, not
  substantive issuance authority, so the answer to "does Andamio control mint policy X" no
  longer gates correctness of the framing. What Phase 0 must still produce: the **draft
  verifier-guidance language** that explains the multi-party process clearly, with a worked
  example on a real preprod credential, so verifiers know what the signature attests to and
  how to chase the on-chain reference. The draft is the Phase 0 deliverable; Unit 5 finalizes
  the published `verifier-guidance.md` with the production signed credential as the worked
  example. This is documentation, not architecture — but the draft is gating because the
  credential structure (anchor-proof, course-owner, assessor fields) needs Unit 3 to bake it
  in.
- **Comprehension gate (P1-02 + P1bis-01).** Show the real preprod credential + draft
  verifier-guidance language + Unit 5 verification view to a **3-person external cohort**:
  (i) one external verifier-tool maintainer, (ii) one client representative who consumes
  Andamio credentials, (iii) one credentialing-domain outsider unfamiliar with Andamio.
  Acceptance criteria, **all** of which must pass:
  1. **Articulation:** each can articulate the multi-party process (course owner + assessor
     + chain + Andamio) within ~5 minutes of reading.
  2. **Disconfirming question A — substantive vs attestation authority:** *"If the course owner
     turned out to be fraudulent, what does Andamio's signature still attest to?"* — Correct
     answer signals: *"only that the on-chain mint happened; Andamio doesn't vouch for the
     substantive credential."* Wrong answer (e.g., *"the credential is still valid because
     Andamio signed it"*) means the framing didn't land even if the parties were named.
  3. **Disconfirming question B — durability model:** *"If the issuer service is offline for a
     week, can a recipient still verify a credential they received yesterday?"* — Correct:
     *"yes — chain + did.json + status list live on the static host."* Probes whether
     Decision 4's durability model is internalized.
  4. **Disconfirming question C — responsibility:** *"Who is responsible if the assessment was
     incorrect?"* — Correct: *"the assessor, anchored on-chain."* Wrong (*"Andamio, because
     they signed"*) signals the attestation-vs-substantive distinction didn't land.
  **Iteration cap:** 2 rounds. If the gate still hasn't closed after 2 rounds of revision,
  escalate to a structured architecture decision rather than blocking indefinitely (options:
  scale back the framing positioning, change the cohort, or accept the gap and document it
  as a known limitation). **Time bound:** cohort named within 3 days of Phase 0 kickoff;
  gate review completes within 2 weeks of the real preprod credential existing.
  **Cohort named by James in Phase 0 kickoff.** The gate is acknowledged to be a smoke-test
  for catastrophic incomprehension, not a statistically powered validation (N=3 is small;
  cohort selection is non-blinded). The disconfirming questions strengthen the signal:
  reviewers who pass articulation but fail disconfirming questions reveal the framing was
  parroted, not internalized.
- **courseOwner / assessor indexer-cost test (P1-03).** Confirm `andamio-api` returns
  both fields per credential at ≤1 extra read per field (James's current expectation).
  If empirical cost is higher than expected, escalate as a Phase 0 finding — courseOwner
  and assessor are otherwise locked Course V2 invariants per P1-04. The expected outcome
  is to ship both fields; this gate exists to surface a contradiction with reality, not
  to defer the fields.
- **1EdTech kit — post-launch credibility work** (Decision 1). Scheduled separately, not a
  gate. Obtain membership, run the kit; iterate if it finds discrepancies. Treated as a
  marketing/positioning artifact, not a correctness requirement.

### Deferred to Implementation

- Exact GCP KMS key resource layout and IAM binding — must use a **dedicated sign-only
  service identity, distinct from the deploy WIF identity** (a CI compromise must not be able
  to sign); Cloud Audit Logs for CryptoKeyVersion use enabled and retained. Resource layout
  depends on `andamio-credentials` infra (Terraform in the private ops repo).
- Domain routing settled by Decision 5: `credentials.andamio.io` is path-routed via an
  **external HTTPS Load Balancer** (Cloud Run domain-mappings do not support path routing,
  so the existing static-host domain mapping must be replaced by an LB-with-URL-map).
  Path matcher: `/credentials/*` → serverless NEG for `credential-badges-issuer`; default
  → serverless NEG for the existing `credential-badges` static host (serving `/context`,
  `/issuer`, `/badges`, `/.well-known/did.json`, `/status/*`). The Terraform delta in the
  private ops repo provisions: the LB + URL map + two serverless NEGs + managed SSL cert +
  DNS cutover (with the old domain mapping retained warm during verification), plus the
  second sign-only WIF/SA and the new tag-prefix trigger. This is the named pre-Unit-4
  prerequisite.
- **Anchor gate read path (P1-05 + P1bis-08 prototype refinement):** **Andamioscan via the
  `andamio-api` proxy** is the v1 production read path. **Auth mechanism = shared API key**
  (prototype posture; consistent with `credential-badges` being a prototype). The issuer
  service authenticates to `andamio-api` as an external consumer, presenting an API key
  stored in GCP Secret Manager in `andamio-credentials`. The runtime SA
  (`credential-badges-issuer-runtime@andamio-credentials.iam.gserviceaccount.com`) has
  `roles/secretmanager.secretAccessor` on the key only; no cross-project GCP IAM binding
  needed. **The cross-project IAM verification item (formerly Unit 1, then Unit 4) is
  DISSOLVED for v1.** Mitigations for the v1 trust posture: (i) audit logging on
  `andamio-api`-side captures which key issued requests; (ii) key rotation runbook in
  `docs/runbooks/issuer-provisioning.md` covers rotating the shared key; (iii) freshness/
  confirmation-depth signal needed to distinguish indexer-lag from genuine `not-found`
  (see Unit 5); (iv) verifier-guidance documents that the gate read is indexer-mediated
  and provides Blockfrost/explorer URLs for independent verification. **API key compromise
  threat:** amplified read access to publicly-indexed chain data — acceptable harm class
  for a prototype, since the underlying chain data is publicly observable anyway.
  **Production-hardening upgrade path:** when `credential-badges` is productionized, adopt
  the cross-project IAM-binding pattern already used between `dbapi` and `api`
  (roles/run.invoker on the andamio-api Cloud Run service, runtime SA principal,
  application-level per-endpoint enforcement). Documented in the "Production-hardening
  checklist" section below.
- `credentialSubject.id` derivation settled by Decision 2: it is the recipient, derived from
  `studentStateAsset` per `mapper.ts`. The gated single datum read yields `alias`, which is
  used for the **anchor-gate equality check** (alias bytes == resolved recipient bytes); it
  is **not** the subject id. The `path-b.ts` "bare `alias`" usage is the wrong precedent and
  is removed. Attestation context (course-owner, assessor, on-chain anchor) lives in
  structured sibling fields, never inside `credentialSubject`.
- The signed body embeds `accessToken.userTokenHolder` (current wallet address) — this both
  de-anonymizes the pseudonymous subject and **breaks byte-stability across a wallet
  transfer**. Decision: **exclude `userTokenHolder` from the signed document** unless a
  written rationale justifies keeping it.

## Output Structure

    credential-badges/
      issuer/
        profile.jsonld            # MODIFIED — v0 minimal → production Profile
                                  #   (id=did:web; type=[Profile, AttestationHost];
                                  #    description = multi-party attestation framing)
      service/                    # NEW — issuer service (TypeScript; routes /credentials/*)
        src/                      # graduated from spike/src (mapper, sign-di, path-b, verify, plutus)
                                  # + KMS signer adapter, closed doc loader, anchor gate,
                                  #   structured anchor-proof + course-owner + assessor emission,
                                  #   key-version registry (build-time constant — maps key
                                  #   versions to bit positions in status bitstring; P1-07),
                                  #   startup did.json drift check w/ retry + bundled fallback (P1-06)
        expected-did.json         # NEW — CI-baked at build time; includes
                                  #   `bundled_with_did_json_sha256` field binding it
                                  #   cryptographically to the matching live did.json
                                  #   (second-pass auto-fix for the lockstep claim).
                                  #   Used as authoritative fallback by the startup drift
                                  #   check when the live did.json fetch fails (P1-06).
        Dockerfile                # service container (separate from static-host Dockerfile)
      context/
        v0.jsonld                 # MODIFIED — additive update (P1bis-04 + P1bis-06):
                                  #   registers 4 attestation-framing terms
                                  #   (AttestationHost, OnChainCredentialAnchor,
                                  #    courseOwner, assessor) as Andamio-namespaced IRIs.
                                  #   Mutable in-place; v0 documented as "shape may change".
      static/                     # NEW — files served by the existing credential-badges nginx:
        .well-known/did.json      # NEW — CI-emitted from KMS pubkey (Decision 4)
        status/                   # NEW — CI/CLI-emitted key-epoch bitstrings (Decision 3, P1-07)
          {listId}.json           #   BitstringStatusList; 131,072 bits W3C minimum;
                                  #   positions 0-63 reserved for key versions; rest
                                  #   reserved zero forever; allowlisted; vc-statuslist+json
                                  #   MIME; statusPurpose: "suspension"
        incidents/                # NEW (OPTIONAL under prototype — P1bis-03):
          {incident-id}.md        #   hand-written incident pages published alongside
                                  #   status-bit flips; linked from verification view
                                  #   when key-version bit=1. Optional in v1;
                                  #   productionization makes this required.
      tools/                      # NEW — small CLIs the CI workflows + ops humans share
        gen-did-json.ts           # NEW — KMS-pubkey → did.json emitter (used by CI; also emits
                                  #   service/expected-did.json bundled fallback)
        flip-status-bit.ts        # NEW — flip one bit in the key-epoch bitstring; takes
                                  #   key-version-id + compromised-key purpose + incident ID;
                                  #   no URN argument (P1-07); CODEOWNERS-gated invocation
      docs/
        plans/                    # this plan
        runbooks/
          issuer-provisioning.md  # NEW — T1 runbook, key-compromise response, T2 path (Issue #6)
          status-flip.md          # NEW — when/how to flip a status bit (Decision 3 ops)
        verifier-guidance.md      # NEW — attestation framing first; multi-party process;
                                  #   chain = authoritative; status = convenience signal;
                                  #   indexer-lag caveat; how to verify the anchor proof
      CODEOWNERS                  # NEW — gates 4 trust-critical files:
                                  #   issuer/profile.jsonld, tools/gen-did-json.ts,
                                  #   tools/flip-status-bit.ts (+ generated bitstrings),
                                  #   nginx allowlist config
      spike/                      # imported source of truth (CI-ignored, not served)
      .github/workflows/
        deploy.yml                # MODIFIED — add service build/deploy lane (service-v*.*.*
                                  #   tag prefix); decouples issuer-service releases from
                                  #   static-host releases (Decision 5)
        ci.yml                    # MODIFIED — service tests + DID/profile smoke
                                  #   + key-pin invariant (gen-did-json output references
                                  #     intended signer.id fragment)
                                  #   + v0-context smoke (4 attestation terms present;
                                  #     P1bis-04/06)
                                  #   + multi-verifier conformance gate (Phase 0)
        smoke-probe.yml           # NEW — out-of-band post-deploy smoke probe (P1bis-07).
                                  #   Triggered via workflow_run after deploy.yml completes.
                                  #   Runs with `contents: read` only (P1bis-09). Fetches
                                  #   live did.json from credentials.andamio.io; asserts
                                  #   the expected signer.id fragment is present. Out-of-
                                  #   band from the build environment (mitigates CI-poison
                                  #   attack path while staying inside same repo for v1).
                                  # NOTE: daily integrity monitor DROPPED under prototype
                                  #   posture; deferred to production-hardening checklist.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not code
> to reproduce.*

```
Verifier / consumer
        │  GET credentials.andamio.io/credentials/{network}/{policyId}/{sltHash}/{recipient}
        ▼
┌──────────────────────────────────┐     ┌─────────────────────────────────────────┐
│  Issuer Service (Cloud Run, TS;  │     │ Static Host (nginx, existing Cloud Run) │
│   credential-badges-issuer)      │     │ allowlisted, immutable cache, CI-emitted│
│                                  │ pins│                                         │
│  startup: read  ◄──────────┐     │◄────┤ /context/v0.jsonld                      │
│  /.well-known/did.json,    │     │     │ /issuer  (Profile, AttestationHost type)│
│  refuse start if signer.id │     │     │ /badges/{badge_id}.svg                  │
│  fragment absent           │     │     │ /.well-known/did.json (CI-emitted from  │
│  (drift = startup failure) │     │     │   KMS pubkey; vc-statuslist+json MIME)  │
│                                  │     │ /status/{listId}.json (BitstringStatus  │
│  serves /credentials/...         │     │   List; flipped via CLI + CODEOWNERS)   │
│                                  │     └─────────────────────────────────────────┘
│  1. validate path params         │              ▲
│     (network = trust enum)       │              │ verifiers also fetch
│  2. ONE datum read (Andamioscan  │              │ did.json + status list
│     via andamio-api proxy)       │              │ from here directly
│  3. HARD GATE: policy∈datum ∧    │
│     onchain-hash == sltHash ∧    │
│     alias == recipient ?         │
│        no ─► not-found /         │
│             revoked-signal       │
│             (ZERO KMS calls)     │
│        yes ▼                     │
│  4. map → OB3 (mapper.ts):       │
│     issuer = AttestationHost,    │
│     evidence = OnChainCredential │
│       Anchor (policy/asset/tx),  │
│     courseOwner ref, assessor    │
│       ref (where present),       │
│     credentialStatus = bitstring │
│       entry (attestation         │
│       freshness semantics),      │
│     validFrom/proof.created =    │
│       claim-tx block_time        │
│  5. sign via KMS adapter ────────┼───► GCP KMS EC_SIGN_ED25519 (HSM)
│     (raw 64-byte, DI eddsa-      │      key never leaves KMS;
│      rdfc-2022)                  │      sign-only WIF (not deploy WIF)
│  6. emit byte-stable doc + state │
└──────────────────────────────────┘

State machine per request (gate decides BEFORE any KMS op):
  not-found        ── policy/alias absent in datum, OR sltHash != on-chain hash,
                       OR alias-encoding-rejected (non-printable bytes outside 0x20-0x7E)
  revoked-signal   ── claim tx exists but pair now absent (burn/transfer);
                       MUST be distinguished from indexer-lag (freshness check);
                       status bit is NOT flipped (P1-07: chain remains authoritative
                       for per-credential state; key-epoch status bit reflects only
                       key-version freshness, not credential burn/transfer)
  anchored+signed  ── gate passed AND KMS sign OK (deterministic, byte-stable)
  anchored+unsigned── gate passed, KMS unavailable: degraded, on-chain truth only
                       (verifiers can still verify already-distributed credentials
                        because did.json + status list live on the static host)

CI pipeline (separate from request path):
  KMS getPublicKey ─► tools/gen-did-json.ts ─► static/.well-known/did.json
                     │ asserts: emitted did.json references the active
                     │   signer.id fragment that the service intends to use
                     ▼
                     deploy → existing credential-badges static host
                     (any drift fails service startup, not silently)
```

## Implementation Units

- [ ] **Unit 1: Managed issuer key + CI-emitted did.json + allowlist/CI foundation + runbooks**

**Goal:** Stand up the KMS-held signing key with correct custody; produce the **CI-emitted
`did.json`** (Decision 4) on the static host with a key-pin invariant test; reconcile the
allowlist/CI **before** any `service/` directory exists, so Phases 2–3 are not red-CI by
construction. The static host gains two new trust-critical generated artifacts in this Unit:
`/.well-known/did.json` (this Unit) and `/status/*` (Unit 5 emits the first bitstring, but
its allowlist + MIME plumbing lands here).

**Requirements:** R1, R6

**Dependencies:** None (hard prerequisite for Units 3–6).

**Files:**
- Modify: `scripts/ci/check-allowlist.sh` — **logic refactor** required, not just an
  additive update. The existing script enforces a flat top-level allowlist (`top="${entry%%/*}"`).
  Decision 4 + Decision 3 add a new top-level directory `static/` whose *nested* paths
  (`static/.well-known/did.json`, `static/status/*.json`) must be allowlisted while
  arbitrary content inside `static/` is rejected. Add a parallel exact-path allowlist
  mechanism (e.g., a NESTED_ALLOWLIST set the script checks after the top-level pass), with
  `static/` itself added to IGNORED at the top level. Add `service/`, `spike/`, `tools/`,
  `docs/` to IGNORED — they must never be served.
- Modify: `.dockerignore`, static-host `Dockerfile` — **preserve the explicit per-file/per-subtree
  COPY discipline** that the existing Dockerfile relies on (the original Dockerfile comment
  explicitly warns against `COPY .` or `COPY *` because the host is forever-public and a
  forgotten file would leak). Use:
  ```
  COPY static/.well-known/did.json /usr/share/nginx/html/.well-known/did.json
  COPY static/status/                /usr/share/nginx/html/status/
  ```
  Do NOT use `COPY static/ /usr/share/nginx/html/` — that would let an accidental
  `static/draft.md` become servable. The per-subtree COPY for `status/` is acceptable
  because that subtree is exclusively for generated status lists (allowlisted in
  `check-allowlist.sh`). Add nginx MIME mappings: `application/did+ld+json` for did.json,
  `application/vc-statuslist+json` for status lists.
- Create: `tools/gen-did-json.ts` — KMS `getPublicKey` for the active signing key
  version(s) → emit `static/.well-known/did.json` **and** `service/expected-did.json`
  (bundled fallback per P1-06, including the `bundled_with_did_json_sha256` field
  cryptographically binding it to the matching live did.json — second-pass auto-fix).
  Runs in CI; outputs committed or pushed to the respective build artifacts. Asserts the
  emitted `verificationMethod[].id` matches the intended `signer.id` fragment
  (`#key-YYYY-MM` form). Failure ⇒ CI fails, no deploy.
- Create: `context/v0.jsonld` update **(P1bis-04 + P1bis-06)** — additive (mutable
  in-place; v0 documented as "shape may change"). Registers the 4 attestation-framing terms
  as Andamio-namespaced IRIs: `AttestationHost`, `OnChainCredentialAnchor`, `courseOwner`,
  `assessor` mapped to `https://credentials.andamio.io/context/v0#<Term>`. Without this,
  strict JSON-LD verifiers would drop these terms during expansion — multi-verifier "no
  warnings" Phase 0 gate would fail.
- Create: `CODEOWNERS` **(P1bis-09 prototype scope)** — document-only enforcement with
  explicit glob patterns: `issuer/profile.jsonld`, `tools/gen-did-json.ts`,
  `tools/flip-status-bit.ts` (created Unit 5), `static/status/*.json`,
  `static/.well-known/did.json`, `context/v0.jsonld`, and the nginx allowlist config.
  Owner = James (or whoever has commit access; productionization names a real team
  requiring ≥2 reviewers). **Full branch protection deferred to productionization**;
  the one cheap exception is **disable force-push to default branch** (one-time GitHub
  setting that protects audit-ledger integrity).
- Configure: GitHub Actions workflow permissions **(P1bis-09)** — every workflow runs
  with minimum-necessary permissions; only workflows that need `contents: write` (the
  deploy lanes) have it. Smoke probe + integrity workflows run `contents: read` only.
- Create: `docs/runbooks/issuer-provisioning.md` — T1 key creation/custody; **explicit
  key-compromise response section distinct from rotation**; documents the CI-emit +
  service-startup-check drift-prevention loop; **API-key rotation procedure for
  `andamio-api` access (P1bis-08)** — key stored in GCP Secret Manager
  (`projects/andamio-credentials/secrets/andamio-api-key`); runtime SA has
  `secretmanager.secretAccessor` on it; rotation = create new key version, update
  `andamio-api`-side allowed-keys list, deploy issuer service, deprecate old version.
- Test: extend `.github/workflows/ci.yml` — allowlist assertions + key-pin invariant
  (gen-did-json output references intended signer.id fragment) + v0-context smoke
  (4 attestation-framing terms present and resolve to expected Andamio IRIs).

**Approach:**
- KMS key: purpose `ASYMMETRIC_SIGN`, algorithm `EC_SIGN_ED25519`, protection level **HSM**,
  in the `andamio-credentials` project. **Automatic rotation disabled.** A **dedicated
  sign-only service identity, separate from the deploy WIF identity** (CI compromise must not
  be able to sign). Cloud Audit Logs for CryptoKeyVersion use enabled + retained. Infra
  (Terraform/IAM) lives in the private ops repo — runbook captures repeatable steps + rollback.
- Runbook **rotation** path: new KMS key version → new versioned DID-doc fragment
  (`#key-YYYY-MM`) → new credentials sign under the new fragment; old fragments retained while
  any credential signed under them must still verify (coordinate retention with credential
  lifetime — non-expiring badges ⇒ keys published effectively forever).
- Runbook **compromise** path (separate, deliberately destructive): remove the compromised
  verification method from the DID doc **entirely** (intentionally breaks all credentials
  signed under it), revoke the sign IAM binding, disable/destroy the key version. State that
  re-issuance is cheap *because* of the no-persistence design — turn the no-DB property into
  the compromise mitigation. The verifier-facing consequence is documented in Unit 5.
- Allowlist reconciliation lands here, with single ownership, so the moment Unit 3 creates
  `service/` the static-host CI is already correct (it currently fails closed on any unlisted
  top-level path — good, but must be pre-reconciled).

**Patterns to follow:** allowlist lockstep across `Dockerfile` / `.dockerignore` /
`check-allowlist.sh` (Issue #4 pattern); existing IGNORED-prefix handling for `.git`/`.github`.

**Test scenarios:**
- Edge case: allowlist CI passes with `service/`, `spike/`, `docs/` IGNORED, and still fails
  on a genuinely unlisted top-level path (guarantee not weakened).
- Edge case: a file placed under `service/` does not become servable by the static host.
- Test expectation: KMS/IAM/runbook content has no behavioral tests in this repo (infra in
  ops repo) — covered by the Unit 4 deploy-time key-pin invariant.

**Verification:** Allowlist CI green with the new IGNORED prefixes; runbook documents
rotation **and** a distinct compromise kill-switch; KMS key exists with HSM + no-auto-rotation
+ dedicated sign identity + audit logging.

- [ ] **Unit 2: Production issuer Profile (Attestation-host framing)**

**Goal:** Upgrade `issuer/profile.jsonld` from v0 minimal to a production OB3 Profile that
expresses the **attestation-host framing** (Decision 2) — `id` is the `did:web`, `url` is
the Profile, `type` includes both `Profile` and `AttestationHost`, `description` states the
multi-party process role plainly.

**Requirements:** R1

**Dependencies:** Unit 1 (DID id must exist to reference; CODEOWNERS in place).

**Files:**
- Modify: `issuer/profile.jsonld`
- Test: `.github/workflows/ci.yml` (existing `/issuer` smoke; extend to assert `id` = did:web
  and `type` contains both `Profile` and `AttestationHost`)

**Approach:** Set `id` to `did:web:credentials.andamio.io`, keep `url` →
`https://credentials.andamio.io/issuer`. `type` = `["Profile", "AttestationHost"]`. Set
`description` to plain language stating Andamio's role: e.g. *"Andamio is the protocol-layer
attestation host for a multi-party credential process. The substantive authority for any
credential issued through Andamio is split across the course owner (the Access Token
holder who created the course), the assessor (the teacher who evaluated the work), and the
Cardano chain (the immutable record). Andamio's cryptographic signature attests that this
multi-party process completed correctly on-chain — it does not claim authority over what
the credential means."* Real Andamio name/logo. Remove the spike disclaimer. Profile stays
mutable (non-immutable cache) by existing design, **but `issuer.id` and `issuer.type` are
frozen fields** — a static-host redeploy may change description/name/logo, never `id` or
`type`. CODEOWNERS (Unit 1) gates this file.

**Patterns to follow:** existing `issuer/profile.jsonld` structure and `nginx` `/issuer`
exact-match serving.

**Test scenarios:**
- Happy path: `GET /issuer` → 200 `application/ld+json`, `type` includes both `Profile` and
  `AttestationHost`, `id` = the did:web, `url` = the Profile URL.
- Edge case: `issuer.id` here matches `issuer.id` embedded in freshly assembled credentials
  AND the static-host-served did.json `id` (no drift between Profile, credentials, DID doc).
- Edge case: CI fails if a Profile change alters `issuer.id` or removes `AttestationHost`
  from `type` (frozen-field invariant).

**Verification:** Verifier dereferences both `issuer.id` and `issuer.url` with no warnings;
attestation-host framing is visible in the Profile.

- [ ] **Unit 3: Graduate spike → production assembly/signing library**

**Goal:** Move the mapper + DI signer + chain reader from `spike/src/` into `service/src/`
as a production module that signs via KMS instead of a disk key, with the anchor gate as a
blocking precondition.

**Requirements:** R2, R3, R5

**Dependencies:** Unit 1 (KMS key + did.json); Unit 2 (Profile with attestation-host type);
**Phase 0 gates** (multi-verifier DI conformance, real claim, `block_time` source,
verifier-guidance language for attestation framing) — Unit 3 freezes the mapper, so it must
not start until Phase 0 closes.

**Concrete controls (from security review — must be specified, not left to the implementer):**
- Anchor gate distinguishes **four internal rejection reasons**, each logged + metric'd
  separately (P1-10). The HTTP response is `404 not-found` for all four (don't leak which
  reason to the caller — narrows attacker info):
  - `policy-absent` — caller `policyId` is not a key in the recipient's global-state datum credential-map
  - `hash-mismatch` — caller `sltHash` is not byte-equal to the on-chain hash for that policy
  - `alias-mismatch` — datum alias hex is not byte-equal to `asciiToHex(recipient)`
  - `alias-encoding-rejected` — datum alias contains any byte outside printable ASCII
    (defined as `0x20..0x7E` inclusive). The gate returns `404` unconditionally in this case;
    no encoding-ambiguity resolution attempted. Metric `anchor_gate_encoding_rejection_total`
    increments; operators alert on non-zero. **Open sub-question (P1-10, deferred to
    Phase 0 / Unit 1):** confirm whether Andamio on-chain code enforces printable-ASCII
    aliases. If yes, runbook treats any rejection metric reading as P0 invariant violation
    (on-chain protocol bug or attempted exploit).
- The gate **reuses the single in-memory datum object**, not `spike/src/verify.ts`'s
  independent `bf.getTxOutput` fetch (that fetch would reintroduce the forbidden TOCTOU).
- **No in-process or edge caching of the datum read on the gate→sign path** — every signing
  request performs a fresh datum read; caching is permitted only on the non-signing
  verification view.
- Exclude `accessToken.userTokenHolder` (wallet address) from the signed document.
- `signer.id`/issuer DID is a fixed server-side constant; delete the `spike/src/path-b.ts`
  hardcoded `did:key` fallback. Pin `validFrom`/`proof.created` to claim-tx `block_time`.
- **Attestation-framing emission (Decision 2 — implements implications 2–5 of the 5
  implications listed in Key Technical Decisions; implication 1, `AttestationHost` on the
  Profile, is implemented in Unit 2):** the mapper MUST emit (a) `evidence` with
  **array-form `type: ["OnChainCredentialAnchor", "Evidence"]`** (NOT bare
  `"OnChainCredentialAnchor"` — OB 3.0 requires base `Evidence` alongside custom subtypes;
  empirically caught by Phase 0 pre-flight spike's 1EdTech `EvidenceProbe`, 2026-05-25)
  carrying `network`, `policyId`, `asset`, `claimTxHash`
  (implication 2); (b) a `courseOwner` structured field with URN
  `urn:andamio:{network}:course-owner:{accessTokenAsset}` (implication 3); (c) where the
  on-chain record yields an assessor (teacher Access Token), an `assessor` structured field
  with a verifiable pseudonym URN (implication 4). The assessor field is **omitted** when
  absent, never blank-filled. Implication 5 (verifier-guidance language) lands in Unit 5;
  Unit 3 must not start until the draft language is written (Phase 0 gate). `credentialSubject.id`
  is the recipient URN (`urn:andamio:{network}:recipient:{studentStateAsset}`) — these
  attestation-context fields are siblings of `credentialSubject`, not embedded inside it.
  Unit 3 MUST NOT emit these fields if Unit 2's Profile has not yet been deployed with the
  `AttestationHost` type, since verifiers dereference `issuer.id` to find that type.
- **`credentialStatus` emission (Decision 3, refined per P1-01 + P1-07):** the mapper MUST
  emit a `credentialStatus` entry of type `BitstringStatusListEntry` with
  `statusPurpose: "suspension"` (W3C-standard purpose for reversible/temporary invalidity;
  semantically the closest fit for "Andamio's off-chain attestation is no longer fresh —
  check the chain"). `statusListIndex` is the bit position of the **key version that signed
  this credential** (e.g., `0` for the first key version, `1` for the second). The
  key-version→position assignment is a build-time constant (config or enum), not a runtime
  computation; the issuer service knows which key version it is signing with and emits the
  corresponding index. **No URN→position mapping exists.** No persisted manifest. No
  runtime state. `statusListCredential` URL = `https://credentials.andamio.io/status/{listId}.json`.
- **Startup drift check (Decision 4, refined per P1-06 + second-pass auto-fixes):** at
  boot, the service performs three assertions before opening its HTTP listener:
  1. **Bundled-vs-live consistency:** compare its build-time-baked `service/expected-did.json`
     (CI-emitted alongside the static-host `did.json` in the same build) against the **live**
     `did.json` fetched from `https://credentials.andamio.io/.well-known/did.json`. The
     bundled file MUST include a `bundled_with_did_json_sha256` field containing the
     SHA-256 of the matching live `did.json` at emission time; the startup check verifies
     the live file's SHA matches this field (cryptographic lockstep, not convention).
  2. **Active key version is in registry:** the active KMS key version identifier MUST
     be present in the compiled-in key-version registry. If KMS rotated to a new version
     since this container was built, the registry won't know its bit position — refuse to
     start (converts a silent semantic error in `credentialStatus.statusListIndex` into a
     loud startup failure).
  3. **signer.id fragment is present in live did.json:** assert the active `signer.id`
     fragment is present as a `verificationMethod` with the expected `publicKeyMultibase`.

  Three boot paths after these checks: Three paths:
  - **Live fetch succeeds + matches the bundled fragment:** start normally.
  - **Live fetch succeeds + mismatches:** genuine drift detected. **Refuse to start, fail
    loud.** This is the case the drift check exists to catch (e.g. a wrong did.json was
    deployed, or a key rotation happened without updating the service container).
  - **Live fetch fails after bounded retry** (5 attempts, exponential backoff:
    `200ms → 1s → 5s → 15s → 30s`, total ~50s): the static host is unreachable. Start using
    the **bundled** `expected-did.json` as the authoritative reference. Drift is not silently
    accepted — the bundled fragment was emitted in lockstep with the static host's did.json by
    the same CI run, so it is equally authoritative for the duration of this deploy. Log a
    warning so operators see the unreachable-static-host condition.
  This combination handles four failure modes: cold-start during a static-host deploy
  (retry), DNS/LB propagation lag at first LB cutover (retry), key-rotation race (refuse on
  mismatch when reachable; bundled covers the unreachable window), brief static-host outage
  (bundled fallback). The complementary CI-side defense is the deploy-time smoke probe
  documented in Unit 4 (issuer-service deploy workflow refuses to tag if the bundled
  `signer.id` fragment isn't present in the live static-host did.json at deploy time).

**Files:**
- Create: `service/src/` — graduated `sign-di.ts`, `path-b.ts`, `verify.ts`, `plutus.ts`;
  a **KMS signer adapter** replacing `keys.ts`; an **anchor-gate** module; a **closed
  document loader** + **`did:web` resolver** replacing the spike's permissive loader; a
  **key-version registry** (build-time constant mapping key-version IDs to bit positions
  in the status bitstring); a **startup did.json drift check** module with bundled-fallback
  and bounded retry (P1-06).
- Create: `service/src/mappers/` — **multi-mapper dispatch architecture (P1bis-05)**.
  Each on-chain local-state shape gets its own mapper module:
  - `mappers/types.ts` — shared `CredentialMapper` interface contract:
    ```ts
    interface CredentialMapper {
      readonly localStateVersion: 'course-v2' | string  // future: 'course-v3', etc.
      canHandle(policyId: string, datum: OnChainDatum): boolean
      map(input: MapperInput): OB3CredentialBody
    }
    ```
  - `mappers/course-v2.ts` — graduated from spike's `mapper.ts`; handles the current
    on-chain Course V2 shape (1 courseOwner, 1 assessor, 1:1 claim-tx→credential).
  - `mappers/dispatch.ts` — selects a mapper given a `policyId` + datum. **Dispatch
    signal: policy-id based.** Each course's mint policy was created at a known local-state
    version; the dispatch consults a registry (cached at startup; refreshed via API key call
    to `andamio-api` per P1bis-08). Falls through with explicit `unknown-local-state` error
    if no mapper claims the policy — never silently dispatches to a default.
  - **Shared field compatibility contract** — every mapper MUST emit the following fields
    identically (cross-version frozen contract): `issuer.id`, `issuer.type`,
    `credentialStatus` (BitstringStatusListEntry with `statusPurpose: "suspension"` per P1-01
    and key-version-indexed per P1-07), `evidence` of type `OnChainCredentialAnchor`
    (core 4 fields: network, policyId, asset, claimTxHash — additional fields permitted),
    `validFrom` and `proof.created` (claim-tx `block_time`), `credentialSubject.id`
    (`urn:andamio:{network}:recipient:{studentStateAsset}`). Each mapper is free to add
    local-state-specific sibling fields beyond this contract.
  - **Coexistence semantics:** V2 mapper is retained indefinitely after future local-state
    mappers ship. The service must be able to serve a V2 credential URL forever; new
    local-state versions are additive `mappers/course-v3.ts` files registered in
    `dispatch.ts`. V1 ships V2 only; this Unit lays the dispatch foundation.
- Create: `service/expected-did.json` (CI-baked at build time — the active `signer.id`
  fragment + multibase pubkey; used as the authoritative reference if the live did.json
  fetch fails after bounded retry, per P1-06).
- Create: `service/package.json`, `service/tsconfig.json`
- Test: `service/src/__tests__/` (mapper fidelity, KMS adapter, anchor-gate, loader,
  attestation-framing emission, credentialStatus emission with `statusPurpose: "suspension"`
  and key-version index, startup drift check with retry + bundled-fallback paths)

**Approach:**
- Keep `mapper.ts` byte-faithful to `spike/mapping.md` as the on-chain → OB3 *structural*
  spec, **but extend it** to emit the attestation-framing fields (Decision 2) and the
  `credentialStatus` entry (Decision 3) — these are first-class additions, not "improvements"
  to the locked spec. 1:1 Andamio Credential → OB3 Achievement; `badge_id` = the three-part URN.
  Data model carries a credential **list**, v1 emits length-1 only.
- **Attestation-framing emission:** `issuer` references the Profile via `did:web:credentials.andamio.io`
  (which itself carries the `AttestationHost` type from Unit 2); sibling-of-`credentialSubject`
  fields emitted: `evidence` (`OnChainCredentialAnchor` with `network`/`policyId`/`asset`/
  `claimTxHash`), `courseOwner`, `assessor` (omitted when absent). `credentialSubject.id` =
  recipient URN.
- **`credentialStatus` emission (P1-01 + P1-07):** emit `BitstringStatusListEntry` with
  `statusPurpose: "suspension"`. `statusListIndex` = the bit position of the **active
  signing key version** in the key-version registry (a build-time constant). This is NOT
  per-credential — every credential signed under the same key version emits the same
  `statusListIndex`. `statusListCredential` URL =
  `https://credentials.andamio.io/status/{listId}.json`. Bit value at the active key's
  position is `0` at issuance (key fresh); a `compromised-key` flip sets it to `1`.
  **No URN→index manifest.** No per-credential persistent state. The key-version registry
  is shared between the issuer service (which reads it to emit) and `tools/flip-status-bit.ts`
  (which reads it to know which bit to flip).
- **KMS signer adapter:** implement `{ id, algorithm:'Ed25519', async sign({data}) }` and pass
  to `new DataIntegrityProof({ signer, cryptosuite: eddsaRdfc2022 })`. Canonicalization +
  hashing stay inside the library (the adapter is a pure byte→byte leaf). Call Cloud KMS with
  the message in the **`data`** field (never `digest`); return the signature as a raw
  `Uint8Array` **unmodified** — assert `length === 64`; no DER/base64/hex transcode. `signer.id`
  = `did:web:credentials.andamio.io#key-YYYY-MM`, the fixed server-side issuer DID + active
  versioned fragment — **never** request-derived, **no** `did:key` fallback (delete the
  `spike/src/path-b.ts` hardcoded `did:key` default).
- **Anchor gate (security-critical):** one shared datum read; signing is unreachable unless
  (a) caller `policyId` ∈ recipient global-state datum map, (b) on-chain hash **byte-equal**
  caller `sltHash`, (c) on-chain alias == resolved `recipient`. The spike's `verify.ts`
  equality logic becomes a **blocking precondition**, not a post-hoc CLI. Gate failure ⇒
  `not-found`/`revoked-signal`, zero KMS calls. No TOCTOU: the gate and the signed assertion
  use the same datum read.
- **Closed document loader + `did:web` resolver:** build-time-pinned context set (W3C VC 2.0
  / OB3 / Andamio `v0` / `BitstringStatusList`), no arbitrary network fetch at request time,
  unlisted URL rejected (no fallthrough); real `did:web` resolver replacing spike
  `didKeyResolve` (CORNERS-CUT #3/#5/#7 — owned here, not "TBD").
- **Startup drift check (Decision 4):** before accepting requests, the service fetches
  `https://credentials.andamio.io/.well-known/did.json` (the static-host CI-emitted file),
  parses it, and asserts the `signer.id` fragment is present as a `verificationMethod` with
  a `publicKeyMultibase` byte-equal to `KMS getPublicKey` of the active version. Absent /
  mismatch ⇒ **refuse to start**. Drift becomes a startup failure, never a silent broken
  signature.

**Execution note:** Characterization-first — before refactoring, assert the graduated mapper
reproduces an existing spike sample (`spike/samples/*-real.jsonld`) byte-for-byte under the
same inputs (with `validFrom`/`proof.created` pinned). Lock the structural behavior, then
swap the key backend, add the gate, and **then** layer the attestation-framing + status-list
emission as additive structural changes (with explicit new test fixtures, not by modifying
the locked spike samples).

**Patterns to follow:** `spike/src/mapper.ts`, `spike/src/sign-di.ts`, `spike/src/path-b.ts`,
`spike/src/verify.ts`, `spike/src/plutus.ts`.

**Test scenarios:**
- Happy path: known on-chain inputs → OB3 doc structurally identical to the validated spike
  sample for the locked fields, **plus** the new attestation-framing + credentialStatus
  fields populated correctly; KMS-signed credential verifies against the CI-emitted did.json.
- Happy path: KMS adapter returns exactly 64 bytes; an independent Ed25519 verifier validates
  it against the KMS `getPublicKey` of the same key version.
- Happy path: emitted credential passes ≥2 independent OB3/VC verifier libraries
  (Phase 0 gate); credentialStatus entry is dereferenceable to the hosted bitstring.
- **Error path (forgery — highest priority):** well-formed `policyId`/`sltHash`/`recipient`
  that is NOT in the on-chain datum, OR `sltHash` ≠ on-chain hash for a real policy →
  `not-found`/`not-anchored`, **the signer is asserted never invoked**, no signed doc emitted.
- Error path (startup drift): start the service with a did.json that does not contain the
  active key fragment → service refuses to start (Unit 5's no-deploy-on-drift property).
- Edge case: credential list of length 1 emits a single Achievement (multi-length unused in v1).
- Edge case: assessor present in chain data → emitted; absent → field omitted (never blank).
- Edge case: document loader rejects an unlisted `@context`/DID URL (no network fallthrough).
- Error path: KMS unavailable → signing fails cleanly; no unsigned doc emitted as signed.
- Integration: assemble → gate → KMS sign → multi-verifier DI verification round-trips green.

**Verification:** Graduated module emits credentials that (a) reproduce locked spike-sample
fields byte-for-byte, (b) carry the new attestation-framing + credentialStatus fields, and
(c) pass ≥2 independent OB3/VC verifiers signed by the real KMS did:web key; the signer is
provably unreachable for non-anchored input; startup refuses on did.json drift.

- [ ] **Unit 4: Deployed issuer service — `/credentials/*` endpoint (did.json served by static host)**

**Goal:** Wrap Unit 3 in the new `credential-badges-issuer` Cloud Run service that serves
`/credentials/...`, emitting deterministically reproducible, KMS-signed, attestation-framed
credentials. **The DID document is NOT served by this service** — it is CI-emitted to the
static host in Unit 1; this service only *consumes* it (startup drift check) and references
its `signer.id` fragment.

**Requirements:** R1, R2, R4

**Dependencies:** Unit 3; **pre-Unit-4 prerequisite (Decision 5):** ops-repo Terraform delta
merged — second Cloud Run service `credential-badges-issuer`, second sign-only WIF/SA
distinct from deploy WIF, LB path-routing on `credentials.andamio.io` (`/credentials/*` →
this service; everything else → static host).

**Files:**
- Create: `service/src/server.ts` (HTTP entry: `/credentials/...` only — **no**
  `/.well-known/did.json` route here)
- Create: `service/Dockerfile`
- Modify: `.github/workflows/deploy.yml` (add `service-v*.*.*` tag-prefix lane for the new
  issuer service, WIF-constrained to the sign-only identity; static-host `v*.*.*` lane stays
  unchanged)
- Modify: `.github/workflows/ci.yml` (add startup-drift smoke test against staging did.json)
- Test: `service/src/__tests__/server.test.ts`

**Approach:**
- **Startup:** Unit 3's drift check runs before the listener opens — fetches
  `https://credentials.andamio.io/.well-known/did.json` (the static-host CI-emitted file),
  asserts the active `signer.id` fragment is present as a `verificationMethod` with the
  expected `publicKeyMultibase`. Mismatch ⇒ refuse to start. This is the structural
  replacement for "live-from-service drift-impossible by code path" — drift is still
  impossible, but the mechanism is fail-loud-on-boot, not on every did.json fetch.
- `GET /credentials/{network}/{policyId}/{sltHash}/{recipient}`: **strict path-param
  validation before any chain call** — `network` is a **closed trust-affecting enum**
  (`mainnet`|`preprod`; it selects the upstream/credentials via `Blockfrost.fromEnv`),
  `policyId`/`sltHash` strict hex-length, `recipient`/alias constrained before
  `asciiToHex`/upstream-path interpolation (SSRF/path-injection). Then: one datum read →
  Unit 3 anchor gate → on pass, map with **`validFrom` AND `proof.created` pinned to the
  claim-tx `block_time`** (deterministic; byte-stable across fetches), emit attestation-
  framing fields + `credentialStatus` entry → KMS sign → **wrap `proof` in array form
  `[{...}]` before serialization** (OB 3.0 Plain JSON schema requires `proof` as an array;
  `@digitalbazaar/vc` emits a singular proof as a JSON-LD-lenient object, which 1EdTech's
  Plain JSON schema check rejects — empirically caught by Phase 0 pre-flight spike,
  2026-05-25) → return JSON-LD. **No persistence** — re-derivation is byte-identical, so
  third parties can cache/re-share/offline-verify safely.
- **`did:web` resolution survives signing-service outage** (Decision 4 win, with the
  scope tightened per second-pass auto-fix): if this Cloud Run service is down, the static
  host still serves `did.json` and `/status/{listId}`, so verifiers can verify any
  credential they have already received the JSON for. **The scope is "verify
  already-received credential bytes," NOT "fetch and verify a previously-unseen credential
  URL"** — the `/credentials/*` route itself goes through this service. During a
  signing-service outage: existing verifiers with cached credentials → continue working;
  new fetches via the URL → fail. Operational implication: recipients who want their
  credentials to remain verifiable during signing-service outages should download and save
  the JSON-LD bytes after first issuance (not rely on the URL alone).
- **Abuse/cost control (load-bearing, since no-persistence removes the natural cache):**
  the anchor gate runs before any KMS op (no KMS spend on forgery attempts); Cloud Run
  `max-instances` cost ceiling; an edge rate limit; a documented Andamioscan/Blockfrost read
  budget; upstream-quota-exhausted ⇒ explicit error state, never a fake/unsigned-as-signed doc.
- LB path-routing (Decision 5): `/credentials/*` lands here; **everything else** is the
  static host's responsibility (`/context`, `/issuer`, `/badges`, `/.well-known/did.json`,
  `/status/*`). The service must not register any non-`/credentials` route.

**Patterns to follow:** existing `.github/workflows/deploy.yml` WIF + `refs/tags/v*`
constraint, parameterised by tag prefix; `spike/src/path-b.ts` build flow.

**Test scenarios:**
- Happy path: valid on-chain credential → 200, signed OB3 doc with attestation-framing
  fields + `credentialStatus` entry, verifies independently by ≥2 OB3 verifier libs.
- Happy path: two requests for the same logical credential return **byte-identical** docs
  (deterministic — `validFrom`/`proof.created` from block_time, not request time).
- Happy path: `GET /.well-known/did.json` from the static host (NOT this service) resolves;
  service refuses to register a `/.well-known/did.json` route.
- Happy path: signing-service down + verifier still verifies an already-distributed credential
  by fetching did.json + status list from the static host (drift Decision 4 win).
- Error path: well-formed but non-anchored input → `not-found`, **no KMS sign call**, no doc.
- Error path: `network` not in the enum / malformed hex params → 400, **no chain call**.
- Error path: Andamioscan unreachable → 5xx explicit error state; Andamioscan stale (lag) is
  handled in Unit 5, never silently surfaced as `revoked`.
- Error path: service started against a did.json that does not contain the active key
  fragment → refuses to start, alert emitted, no requests served.
- Integration: deployed `credentials.andamio.io/credentials/...` URL serves a doc that the
  multi-verifier set accepts; the LB correctly routes other paths to the static host.

**Verification:** Public `/credentials/...` URL returns a multi-verifier-conformant,
byte-stable, attestation-framed credential; did.json drift detected at startup; LB
path-routing keeps `did.json` + status-list resolution alive through signing-service outage;
non-anchored input incurs zero KMS cost.

- [ ] **Unit 5: Public verification surface + status-list emission + verifier guidance**

**Goal:** A human-facing, unauthenticated verification view with explicit states; the
**first emitted bitstring** on the static host (Decision 3); the **status-flip CLI**; and
the verifier-guidance document that anchors the attestation framing for verifiers.

**Requirements:** R4

**Dependencies:** Unit 4.

**Files:**
- Create: `service/src/verify-view.ts` — server-rendered verification page **designed
  explicitly for human verifiers** (per P1-02). Five states (anchored+signature-valid,
  anchored+signature-unavailable, not-found, revoked-signal, indeterminate) must have
  designed copy, not raw state-name labels. Multi-party process visible in the rendered
  output: courseOwner pseudonym, assessor pseudonym (where present per Course V2 + P1-03),
  on-chain anchor with links to a public Cardano explorer for independent verification.
  **Suspended-state rendering (P1bis-03):** when the credential's key-version status bit
  is 1, the verification view displays a clear "credential is suspended" message + (if
  an incident page exists) a link to `/incidents/{incident-id}`. The message specifies
  this is an attestation-freshness issue, not a credential-earned issue, and that the
  chain remains authoritative. If no incident page has been published yet (prototype
  posture: incident page is OPTIONAL), the verification view falls back to a generic
  suspended-state message.
- Create: `tools/flip-status-bit.ts` — CLI takes a **key-version identifier** + purpose
  (compromised-key only) + incident ID. Looks up the key version's bit position in the
  key-version registry; sets that bit in `static/status/{listId}.json`; appends an
  audit-ledger entry (who/when/why/which-key-version/incident-id) committed to the repo
  via PR. No URN argument; no per-credential indexing. Invocation gated on CODEOWNERS.
- Create: `static/status/{listId}.json` — **131,072-bit BitstringStatusList** (W3C minimum,
  second-pass auto-fix). Positions 0–63 reserved for key versions; positions 64..131071
  reserved zero forever. At first deploy: all zeros. `statusPurpose: "suspension"` in the
  status list metadata.
- Create: `docs/runbooks/status-flip.md` — when and how to flip a key-version bit, distinct
  from key rotation, distinct from issuance. Single flip per compromise event.
  **Incident-page guidance (P1bis-03 prototype scope):** the operator MAY publish a
  static incident page at `static/incidents/{incident-id}.md` in the same PR as the
  bit-flip; recommended but not required for v1 (productionization-hardening makes this
  required + adds an incident-page template). The verification view falls back to a
  generic suspended-state message if no incident page is published.
- Create (OPTIONAL — prototype posture): `static/incidents/` directory in the allowlist
  + nginx serving rules. Hand-written markdown or HTML pages at
  `static/incidents/{incident-id}.md`; linked from the verification view when bit=1.
  Recipients learn passively via the URL they share with employers; no email/in-app
  notification in v1. **Trigger condition for substrate-level recipient-binding
  workstream:** if a real compromise event reveals this passive comms is inadequate,
  that becomes the forcing function for Veridian/KERI substrate consideration.
- Create: `docs/verifier-guidance.md` — leads with the attestation-host framing (Decision 2);
  documents the two-layer model (Decision 3); explains the indexer-lag caveat; **includes a
  worked example on a real preprod credential** (per Phase 0 verifier-guidance-language gate
  — Phase 0 produces the draft; Unit 5 finalizes with the real signed output). Layered for
  three audiences (per P1-02 design-lens finding): a developer-integration section
  (verification API calls, JSON-LD field names, did:web + status-list mechanics), a
  trust-statement section for employers/verifiers (plain-language explanation of the
  multi-party process), and a recipient-FAQ section (what each verification state means
  and what to do).
- Test: `service/src/__tests__/verify-view.test.ts`, `tools/__tests__/flip-status-bit.test.ts`

**Approach:**
- **States** (verification view): `anchored+signature-valid`, `anchored+signature-unavailable`
  (degraded — still shows on-chain truth), `not-found`, `revoked-signal` (claim tx exists but
  the `(policyId, typed_hash)` pair is absent from the recipient's current global-state datum
  — burn/transfer, via `spike/src/verify.ts` + `plutus.ts`), `indeterminate` (freshness
  inconclusive — never falsely surfaces as `revoked`).
- **Indexer-lag safety (must-fix):** `revoked-signal` MUST be distinguishable from
  Andamioscan staleness. "Absent because burned" and "absent because the indexer lags/partial-
  indexed" look identical at the datum layer; surfacing a held, valid credential as `revoked`
  is *worse* than an outage (silent incorrectness vs honest error). Use a freshness /
  confirmation-depth signal on the Andamioscan response (or a fallback direct chain read)
  before declaring `revoked-signal`; if freshness is indeterminate, return `indeterminate`,
  never `revoked`.
- **Status-bit semantics (Decision 3, refined per P1-01 + P1-07):** the bitstring is
  key-epoch-indexed (~64 bits, one per key version). `statusPurpose: "suspension"` —
  reversible/temporary semantics that match attestation-freshness honestly.
  - Bit set to 1 by `flip-status-bit.ts <key-version-id> compromised-key` when a key
    version is being removed from the DID doc. All credentials signed under that key
    version are now displayed as "suspended" by status-aware verifiers — a double signal
    for verifiers that read status but not DID-doc-method removals.
  - **No `off-chain-consistency` purpose.** Per-credential off-chain disavowal is the
    substantive issuer authority the attestation-host framing rejects. Chain
    burn/transfer is observable on-chain and surfaced by the verification view; the
    OB3 credential remains a valid point-in-time attestation.
  - The CLI refuses to flip without `compromised-key` purpose and a referenced incident
    ID in the audit ledger; the audit trail captures purpose + actor + incident.
- **Verifier-guidance language (gates Unit 3, per Phase 0):** the document must clearly
  explain (1) Andamio's role as protocol-layer attestation host of a multi-party process;
  (2) the structured anchor-proof field and how to dereference each on-chain reference for
  independent verification; (3) the two-layer model — `credentialStatus` is a convenience
  signal, the chain is authoritative; (4) the indexer-lag caveat (Andamioscan-mediated
  reads may lag chain); (5) key-compromise containment: DID-doc verification-method removal
  intentionally invalidates credentials signed under it; treat anchor-presence as the
  authoritative liveness signal, not the signature alone. **Worked example on a real
  preprod credential** (Phase 0 dependency).
- **`flip-status-bit.ts` ops (P1-07):** input = key-version ID + `compromised-key` purpose
  + incident ID; output = updated bitstring in `static/status/{listId}.json` (one bit
  flipped at the key-version's position) + audit-ledger entry committed to the repo
  (who/when/which-key-version/which-incident). CODEOWNERS gate ensures the flip lands via a
  reviewed PR. **No URN argument; no per-credential operations.** Single bit flip per
  compromise event affects all credentials signed under that key version simultaneously.

**Patterns to follow:** `spike/src/verify.ts`, `spike/src/plutus.ts`, `spike/src/render.ts`.

**Test scenarios:**
- Happy path: valid held credential → `anchored+signature-valid`; key-version status bit = 0.
- Happy path: `flip-status-bit.ts <key-version> compromised-key <incident-id>` → bit at
  that key-version's position flips; static-host deploy serves the updated bitstring; an
  OB3 verifier reading `credentialStatus` reports the credential as "suspended" (consistent
  with the DID-doc method removal for that key version; suspension semantics match
  attestation-freshness more honestly than the previous "revocation" framing).
- Edge case: claim tx exists, asset no longer in datum, indexer fresh → verification view
  shows `revoked-signal`; status bit is **not flipped** (Decision 3 P1-07: chain
  burn/transfer doesn't trigger off-chain status changes; chain remains authoritative).
- Edge case: pair absent but Andamioscan freshness indeterminate/lagging → `indeterminate`,
  **never** `revoked-signal` (held valid credential must not show as revoked on lag).
- Edge case: unknown credential → `not-found` (no signed doc emitted).
- Error path: signing backend down but chain readable → `anchored+signature-unavailable`,
  on-chain facts still shown; verifier with cached did.json/status list still verifies.
- Error path: `flip-status-bit.ts` without a documented purpose → refuses; no bitstring
  change.
- Integration: revocation read uses the same datum-membership logic as the assembly anchor
  gate (one source of truth, no divergence).

**Verification:** Each state reachable and correct; first bitstring deployed to static host;
flip-status-bit CLI exercised end-to-end for both purposes; verifier-guidance documents the
attestation framing with a worked example on a real preprod credential.

- [ ] **Unit 6: T2/PQ3 designed-not-built + spec hygiene**

**Goal:** Capture the deferred T2/PQ3 design so the chosen T1 architecture stays coherent,
and document the shipped system. (Allowlist/CI reconciliation moved to Unit 1 as a hard
prerequisite — it is not cleanup.)

**Requirements:** R5, R6

**Dependencies:** Units 1–5.

**Files:**
- Modify: `docs/runbooks/issuer-provisioning.md` (extend with T2 `issuers/<org>` path scheme
  + per-org key custody design — Issues #4, #6, designed not built)
- Create: `docs/badge-registry.md` (badge_id = `<course_id>.<slt_hash>` URN; SVG-primary;
  presentation-only invariant from Issue #11; length-1-list rule)
- Modify: `README.md` ("What's here" — service vs static host, badge_id convention,
  trust-critical files)

**Approach:**
- Document the T1→T2 path (per-org DID slug convention, key-custody fork) and the Issue #7
  PQ3 cross-issuer-prereq reconciliation as a written spec note — decision-coupled,
  deliberately deferred, so the deferral is coherent rather than ad hoc.
- README states which files are trust-critical (CODEOWNERS-gated) and the static/dynamic split.

**Test scenarios:**
- Test expectation: none — design/docs content; the allowlist CI invariants live in Unit 1
  and the key-pin invariant in Unit 4.

**Verification:** README + runbook + badge-registry accurately describe the shipped
architecture, the trust boundary, and the deferred T2/PQ3 path.

## System-Wide Impact

- **Interaction graph:** New `credential-badges-issuer` Cloud Run service reads Andamioscan
  via the existing `andamio-api` proxy, calls GCP KMS to sign, and serves `/credentials/...`
  only. The existing `credential-badges` static host serves `/context`, `/issuer` (Profile
  with `AttestationHost` type), `/badges`, **`/.well-known/did.json`** (CI-emitted from KMS,
  Decision 4), and **`/status/{listId}.json`** (CI/CLI-emitted bitstring, Decision 3). LB
  path-routes `credentials.andamio.io` between the two (Decision 5). The auth'd holder
  dashboard in `andamio-app-v2` is intentionally untouched and not backend-shared.
- **Error propagation:** Chain-read or signing failure must degrade to an explicit state
  (`not-found` / `signature-unavailable`), never a silently invalid or fake-signed document.
- **State lifecycle risks:** No signed documents persisted — eliminates stale-cache drift by
  construction. Key rotation handled via multi-method DID doc; pre-rotation credentials must
  still verify (test in Unit 3). DID-doc and status-list drift prevention via (a) CI
  emission + key-pin invariant; (b) service startup refusing to start on did.json drift.
- **API surface parity:** The pseudonymous `credentialSubject.id` and 1:1 badge model must
  match `spike/mapping.md` for the structural core; attestation-framing + credentialStatus
  fields are additive (test fixtures separate from locked spike samples).
- **Integration coverage:** Unit 4/5 cross-layer tests against a deployed URL + multi-verifier
  (≥2 independent OB3/VC libs) are the real proof; unit tests on the mapper alone are
  insufficient.
- **Unchanged invariants:** Static host allowlist, tag-gated WIF deploy, immutable context
  cache, on-chain protocol, and the badge-image-is-presentation-only rule are explicitly
  preserved. Allowlist grows to cover did.json + status lists with their correct MIMEs.
- **Threat model (explicit):** The issuer's trust boundary includes (1) the GCP KMS key +
  its sign-only IAM, separate from deploy WIF (a single Andamio root key signs all credentials
  — compromise mints unlimited back-dated valid-forever credentials; mitigated by the DID-doc-
  removal kill-switch in Unit 1/5, attestation-freshness status-bit flip Decision 3, audit
  logging); (2) the static host's trust-critical generated artifacts — `did.json` and status
  lists (supply-chain: a malicious CI/CLI run could publish an attacker verification method
  or flip a bit unilaterally — mitigated by CODEOWNERS on `tools/gen-did-json.ts`,
  `tools/flip-status-bit.ts`, generated bitstrings, and the nginx allowlist; key-pin
  invariant CI fails on `signer.id` drift; status-flip CLI refuses without a documented
  purpose and writes an audit ledger entry); (3) the dynamic service code that gates signing
  (supply-chain: a malicious commit could weaken the anchor gate — mitigated by CODEOWNERS
  on `service/src/` security-critical modules + Unit 3 forgery-test requirement); (4) the
  unauth public endpoint (signing-oracle risk — neutralized only by the Unit 3/4 hard anchor
  gate). Andamioscan is an upstream trust dependency: the surface proves "the indexer says
  this pair is in the datum," not chain directly — stated in verifier-guidance with
  independent evidence URLs and the attestation-framing two-layer model.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Signing-oracle: endpoint signs well-formed-but-not-on-chain input** | Med | **Critical** | Unit 3/4 hard anchor gate (policy∈datum ∧ hash byte-equal ∧ alias match) is a blocking precondition with zero KMS ops on failure; test asserts signer never invoked on non-anchored input |
| **KMS key compromise → unlimited valid-forever forged credentials** | Low | **Critical** | Unit 1 runbook compromise kill-switch (remove VM from DID doc entirely); Decision 3 status-bit flip purpose=`compromised-key` flips bits as a double signal; sign identity ≠ deploy WIF; KMS audit logging; verifier-guidance says anchor-presence is authoritative, not signature alone |
| **Static-host supply-chain: malicious CI/CLI run publishes attacker VM or unjustified status-bit flip** | Low | **High** | CODEOWNERS on `tools/gen-did-json.ts`, `tools/flip-status-bit.ts`, the bitstring outputs, and the nginx allowlist; key-pin invariant CI fails on signer.id drift; status-flip CLI refuses without a documented purpose and writes an audit-ledger entry committed to repo |
| **did:web drift between published key and signing key (CI-emitted, Decision 4)** | Low | High | Two-layer mitigation: (a) CI key-pin invariant asserts emitted did.json references intended signer.id; (b) service startup fetches did.json + refuses to start on mismatch — drift becomes a startup failure, never a silent broken signature |
| **Andamioscan lag → held valid credential shown as `revoked-signal`** | Med | High | Unit 5 freshness/confirmation-depth check; `indeterminate` state instead of `revoked` when lag is possible; distinct from "Andamioscan down" (honest 5xx). **Under P1-07, status bits are never flipped for chain-state changes** (off-chain-consistency purpose dropped) — the verification view shows on-chain truth from a fresh read, the `credentialStatus` bit reflects only key-version freshness. Indexer lag cannot wrongly flip a status bit. |
| **Unauth per-request KMS-sign cost/DoS (no-persistence removes natural cache)** | Med | Med | Gate-before-sign (no KMS spend on forgeries); Cloud Run max-instances ceiling; edge rate limit; documented upstream read budget |
| **Runtime context/DID fetch on signing path = SSRF + availability dependency** | Med | High | Unit 3 closed build-time-pinned document loader + real did:web resolver; unlisted URL rejected, no network fallthrough |
| KMS signing changes canonicalized bytes vs spike disk key, breaking multi-verifier conformance | Low | High | De-risked: Cloud KMS `EC_SIGN_ED25519` is PureEdDSA over raw bytes (canonicalize+hash stay in the cryptosuite); adapter returns raw 64-byte; Unit 3 characterization test + Phase 0 multi-verifier re-run after swap |
| Signing-service outage breaks verification of already-issued credentials | Low→0 | High | Eliminated by Decision 4: did.json + status list live on the static host, independent of the signing service; verifiers verify cached credentials through any signing-service outage |
| Live Andamioscan field/endpoint shape differs from spike fixtures | Med | Med | Wire against running `andamio-api` proxy, not fixtures; explicit error state on mismatch |
| Attestation-framing language confuses verifiers (Decision 2 is new framing) | Med | Med | Phase 0 **comprehension gate** (P1-02) — 3-person external cohort must articulate the multi-party process unaided after reading the credential + draft verifier-guidance + verification view; iterate if it doesn't land. Multi-verifier conformance covers the structural part. Verification view (Unit 5) designed explicitly for human verifiers, not just JSON-LD field dumps. |
| `statusPurpose: "suspension"` not honored by some verifiers (newer than `"revocation"`) | Low | Med | Phase 0 pre-flight spike confirms each candidate library handles `suspension` purpose before the multi-verifier gate is locked (P1-09 + P1bis-10). Fallback: switch to a custom `statusPurpose` value if `suspension` support is gappy. The chain remains authoritative regardless of status-list behavior. |
| **Mass-suspension UX harm during key-compromise event** (P1bis-02 + P1bis-03) | Med | High | A single `compromised-key` flip causes all credentials signed under that key version to display SUSPENDED in third-party verifier UIs simultaneously (potentially 100s of credentials at once). Mitigations: (a) verification view shows clear suspended-state context with link to optional incident page; (b) recipients re-share the URL after rotation completes (URL transparently serves under new key); (c) runbook documents the mass-event response. Productionization-hardening: required incident page + recipient notification channel. Prototype-posture acceptance: passive comms via verification view; trigger condition for KERI/Veridian substrate workstream if real-event experience shows this is inadequate. |
| **CI compromise poisons both the bundled and live did.json artifacts (P1bis-07 residual)** | Low | High | Out-of-band smoke probe in separate workflow (`smoke-probe.yml`) fetches live did.json post-deploy with `contents: read` only; SHA-binding (`bundled_with_did_json_sha256`) cryptographically links the bundled file to the matching live did.json at emission time. Residual risk: coordinated compromise of CI + smoke-probe job in same run — accepted under prototype posture; daily integrity monitor + cosign signing are documented productionization upgrades. |
| **walt-id DI eddsa-rdfc-2022 support not documented (P1bis-10)** | ~~Med~~ Confirmed | Low | **RESOLVED 2026-07-09:** empirically confirmed worse than "undocumented" — walt-id's CLI `vc verify` is JWS/SD-JWT-only and cannot ingest the DI JSON-LD sample at all (built from source, tag v0.20.5). Fallback engaged as designed: spruceid/ssi carries DI (90/91 W3C interop, VALID errors=0 warnings=0) + 1EdTech public validator provides the spec-driven check. **walt-id deferred to post-1.1; launch gate = these two independents + loopback.** See `spike/verifier-spike/results/walt-id.md`. |
| **API-key compromise gives attacker read access to `andamio-api` (P1bis-08 prototype tradeoff)** | Low | Low | Acceptable harm class — chain data is publicly observable; `andamio-api` exposes indexed reads of public data only. Mitigations: audit logging on `andamio-api`-side identifies key usage; rotation runbook covers shared-key rotation. Productionization upgrade: replace with cross-project IAM binding pattern (per dbapi/api precedent). |
| `did:web` resolution edge cases in strict verifiers | Low | High | Unit 4 startup drift check + Phase 0 multi-verifier conformance is the gate; Multikey in both verificationMethod and assertionMethod |
| T2/PQ3 deferral creates later spec contradiction | Low | Med | Unit 6 writes the designed path now so the deferral is coherent |
| Infra (KMS/IAM/Terraform) lives in private ops repo | — | Med | Runbook captures repeatable steps + rollback; this repo ships served artifacts + plumbing only; Decision 5 names the ops-repo Terraform delta as pre-Unit-4 prerequisite |
| **Post-launch:** 1EdTech kit (rescheduled, Decision 1) discovers a DI discrepancy after clients are live | Low | Med | Treated as a **post-launch** credibility/iteration risk, *not* a pre-launch correctness risk (Decision 1 explicitly removes 1EdTech as a gate). Mitigation: Phase 0 multi-verifier conformance covers the same bug classes pre-launch; if the kit later finds something the multi-verifier set missed, iterate (kit-discovered issues are typically structural, addressable without re-issuance under attestation framing — see Decision 2). Open question for the post-launch work: name an owner and target date (see Open Questions / Deferred to Implementation) |

## Phased Delivery

### Phase 0 — Evidence gate (re-scoped 2026-05-22; no Unit 3 lock until these close)
Run a **DI-signed** sample through **≥2 independent OB3/VC verifier libraries** (replaces
1EdTech kit gate, Decision 1; 1EdTech rescheduled post-launch). Produce **≥1 real preprod
`credential_claim`** — the gate means: a real course owner or assessor mints an on-chain
`credential_claim` transaction on preprod (not a synthetic test asset or a hardcoded
fixture), then the assembly+signing service consumes it end-to-end (real Andamioscan read
→ mapper → KMS-signed VC). Establish a reproducible per-recipient claim-tx `block_time`
source (or a documented deterministic fallback) and demonstrate byte-stability across two
builds + a simulated rotation. **Draft** the verifier-guidance language for the
attestation-host framing (Decision 2) with a worked example on the real preprod credential;
the draft is the Phase 0 deliverable, and Unit 5 finalizes the published `verifier-guidance.md`
with the production credential as the worked example. Runs in parallel with Phase 1
(Units 1–2). Until Phase 0 closes, Unit 3 (mapper freeze) does not start.

### Phase 1 — Cryptographic + CI foundation (Units 1–2)
KMS key (HSM, no-auto-rotation, dedicated sign identity, audit logging); allowlist/CI
reconciliation (hard prerequisite — `service/` must not red-CI the static host);
**CI-emitted `did.json` on the static host** (Decision 4, `tools/gen-did-json.ts` +
key-pin invariant); allowlist + MIME plumbing for `did.json` and `/status/*`; runbook with
rotation **and** compromise kill-switch; CODEOWNERS on the 4 trust-critical files;
production Profile with `AttestationHost` type (Decision 2). Gate: allowlist CI green; emitted
did.json passes key-pin invariant; runbook reviewed. Runs in parallel with Phase 0.

### Phase 2 — Production assembly service (Units 3–4)
Graduate the validated spike to the new `credential-badges-issuer` Cloud Run service serving
`/credentials/...` only (Decision 5). The DID document is **already** on the static host
from Phase 1; this service consumes it (startup drift check). **Pre-Phase-2 prerequisite
(Decision 5):** ops-repo Terraform delta merged (second Cloud Run service, sign-only WIF/SA
distinct from deploy WIF, LB path-routing). Gates: (a) Phase 0 closed; (b) characterization
test reproduces locked spike-sample structural fields byte-for-byte; (c) emitted credential
carries attestation-framing + credentialStatus fields and passes multi-verifier set;
(d) signer provably unreachable for non-anchored input; (e) service refuses to start on
did.json drift; (f) public `credentials.andamio.io/credentials/...` URL serves a
multi-verifier-conformant, byte-stable credential.

### Phase 3 — Verification surface + status-list emission + verifier guidance (Unit 5)
Public per-credential view, explicit states, on-chain revocation signal, **first emitted
bitstring** on the static host (Decision 3), `flip-status-bit.ts` CLI gated on CODEOWNERS,
verifier-guidance.md finalised with attestation-framing-first ordering and worked example.

### Phase 4 — Hygiene + deferred-path design (Unit 6)
T2/PQ3 designed-not-built, README/runbook/badge-registry. Schedule 1EdTech membership +
post-launch credibility kit run.

## Documentation / Operational Notes

- `docs/runbooks/issuer-provisioning.md` — T1 key creation/custody; **rotation** (additive,
  non-destructive) **and a distinct compromise kill-switch** (destructive VM removal); audit
  logging; sign-identity ≠ deploy-identity; T2 designed path; the CI-emit + service-startup-
  check drift-prevention loop (Decision 4).
- `docs/runbooks/status-flip.md` — when to flip a key-version status bit (Decision 3 +
  P1-07): purpose is `compromised-key` only, paired with a DID-doc method removal for the
  same key version. Single bit flip per compromise event. Audit-ledger entry (key-version,
  incident ID, who/when/why) required. Chain burn/transfer is NOT a flip trigger — chain
  state is observable on-chain; the OB3 credential remains a valid point-in-time attestation.
- `docs/verifier-guidance.md` — leads with attestation-host framing (Decision 2); two-layer
  model (status = convenience, chain = authoritative); worked example on a real preprod
  credential dereferencing the structured anchor-proof; indexer-lag caveat; compromise-
  containment consequence.
- `docs/badge-registry.md` — badge_id convention + invariants (Issue #11).
- `CODEOWNERS` — gates 4 trust-critical files: `issuer/profile.jsonld`, `tools/gen-did-json.ts`,
  `tools/flip-status-bit.ts` (+ generated bitstrings), and the nginx allowlist. The tag-gate
  alone is insufficient for any of these.
- Rollback: static host and issuer service are independently tag-deployed (Decision 5). A
  static-host rollback that reverts a `did.json` or status-list change is safe because the
  issuer service refuses to start on did.json drift — a bad static-host rollback fails loud
  on the next service deploy. An issuer-service rollback reverts the gate/signer only;
  did.json + status lists remain stable on the static host (verification of existing
  credentials unaffected, Decision 4 win). Rotation never invalidates prior credentials;
  compromise intentionally does (re-issue is cheap by design).
- Update Issues #3 (resolved: attestation-host framing supersedes T1/T2/T3 framing —
  Andamio's role is reframed, not just tiered), #5 (did:web served by **static host**,
  CI-emitted, Decision 4), and link this plan from #4/#6/#7/#8/#11.

## Alternative Approaches Considered

- **Port to Go in `andamio-api`** (spike's original note) — rejected: re-introduces signing
  canonicalization risk against a passing conformance result; splits issuer identity from
  issuance across repos. Superseded by the user's "service in this repo" decision.
- **VC-JWT signing** — rejected: DI `eddsa-rdfc-2022` is JSON-LD-native and the spike's
  real-recipient samples use it; multi-verifier conformance in Phase 0 (Decision 1) closes
  the gap on DI's previously-unvalidated path. JWT retained only as the spike baseline.
- **Persist whole signed credentials** — rejected: introduces drift between document and
  chain state.
- **1EdTech conformance kit as gate** — rejected for v1, rescheduled post-launch (Decision 1).
  Membership scheduling adds weeks to critical path; the kit's substantive value
  (RDF-canonicalization edge cases, context handling, status entry shape) is captured by
  multi-verifier conformance across ≥2 independent OB3/VC libs. 1EdTech is treated as a
  market-positioning artifact, not a correctness requirement.
- **Live-from-service DID document** (deepening pass's original choice) — rejected by
  Decision 4. The "drift impossible by code path" argument held cryptographically but coupled
  verification availability to signing-service uptime. CI-emitted static did.json + service
  startup drift check + signer.id-fragment key-pin in CI provides equivalent drift safety
  with strictly better availability (verification survives signing outage). Trust surface
  also contracts onto nginx instead of the TS runtime.
- **Single issuer field claim ("Andamio is the issuer")** — rejected by Decision 2. Under
  multi-party process reality (course owner + assessor + chain + Andamio), claiming
  Andamio-as-substantive-issuer is dishonest when Andamio is actually the protocol-layer
  attestor. Attestation-host framing replaces the single-issuer claim; structured
  anchor-proof + courseOwner + assessor fields make the multi-party process verifier-visible.
- **No `credentialStatus` (original plan default)** — rejected by Decision 3. Mainstream OB3
  verifiers honor StatusList; emitting no status mechanism either over-trusts (verifier
  defaults to valid) or under-trusts (verifier treats as suspicious). Decision 3 ships a
  `BitstringStatusListEntry` whose bit semantics fit attestation framing (attestation
  freshness, not earned-status). Honest + interop.
- **Durable proof + derived body** (sign once at claim time, store only the proof/its anchor,
  re-derive the body) — considered, not adopted for v1: it would make the proof KMS-
  independent for reads (mitigating the KMS-as-availability-SPOF and per-request-cost
  arguments), but it reintroduces a persistence store and a sign-at-claim coupling to the
  on-chain `credential_claim` flow (out of scope; protocol-side). The chosen path —
  **deterministic byte-stable re-derivation + did.json on static host (Decision 4)** —
  captures most of the benefit: a third party who fetched a credential once can verify it
  offline forever, and even *first-time* verification of a previously-issued credential
  survives a signing-service outage because did.json + status list are on the static host.
  Revisit durable-proof if sign-at-claim lands protocol-side or KMS sign latency/quota
  proves binding for *new* credential issuance.
- **T2 per-org DIDs in v1** — rejected for v1 (Issue #3): under attestation-host framing
  (Decision 2), per-org DIDs are not required for honesty — Andamio's single DID truthfully
  attests to a multi-party process regardless of which org's course is being credentialed.
  Designed-not-built remains the right disposition.

## Production-Hardening Checklist

`credential-badges` v1 ships as a **prototype** (per posture lock 2026-05-25). The
following hardening items are explicitly deferred until productionization. This list
exists so productionization is a known finite delta, not a re-architecture exercise.

- [ ] **Cross-project IAM for `andamio-api` access (P1bis-08 upgrade).** Replace the
      API-key auth with the IAM-binding pattern already in use between `dbapi` and `api`:
      `roles/run.invoker` on the andamio-api Cloud Run service, runtime SA principal,
      application-level per-endpoint enforcement. Remove `andamio-api-key` secret.
- [ ] **Full branch protection on default branch (P1bis-09 upgrade).** Require
      CODEOWNERS-approved review on PRs touching the 4 trust-critical glob patterns;
      disallow direct push; require status checks pass; require linear history.
- [ ] **Named CODEOWNERS team with ≥2 reviewers required.** v1 has James as owner;
      productionization names a real team.
- [ ] **Container image signing with `cosign`.** Build pipeline signs the issuer-service
      container; Cloud Run verifies signature before accepting the revision. Closes the
      coordinated CI+static-host compromise path (P1bis-07 residual).
- [ ] **Daily out-of-band integrity monitor (P1bis-07 upgrade).** Scheduled workflow
      from a separate repo/identity fetches live did.json and asserts expected fragment.
      Catches post-deploy tampering.
- [ ] **Static incident page is REQUIRED on status-flip (P1bis-03 upgrade).** Operator
      MUST publish a hand-written incident page in the same PR as any bit-flip; the PR
      template includes the page draft. v1 has the page as optional.
- [ ] **Recipient-binding upgrade** — if mass-suspension experience reveals passive
      verification-view comms is inadequate (P1bis-03 trigger condition), evaluate
      KERI/Veridian substrate for holder-side wallet UX. Out of scope for v1; the
      issuer DID is kept as a single config value so `did:web → did:webs` is a
      resolver-side change (v1 hygiene rule).
- [ ] **Formal 1EdTech membership-gated conformance kit run** — v1 ships with the public
      validator (P1bis-10); productionization adds the formal kit as the credibility
      capstone.
- [ ] **Cloud Armor on the LB frontend** — DDoS/WAF rules; rate-limit policies at LB
      level rather than only in application code. Both Cloud Run services configured with
      `ingress: internal-and-cloud-load-balancing` to prevent direct `*.run.app` URL
      invocation bypassing the LB.

## Sources & References

- **Origin (committed source of truth):** `spike/` (imported from orch `ob3-prototype`, 2026-05-16)
- Mapping spec: `spike/mapping.md`; corners: `spike/CORNERS-CUT.md`; open Qs: `spike/open-questions.md`
- Prereq chaining / PQ defaults: `spike/prerequisite-chaining.md`
- Validated samples: `spike/samples/*-real.jsonld`; validation: `spike/validation-results.md`
- Issuer-identity decision graph: Issues #3 (anchor), #4, #5, #6, #7, #8, #11
- External: W3C VC Data Model 2.0; Open Badges 3.0 `v3p0/context-3.0.3.json`; `did:web`;
  W3C Data Integrity EdDSA Cryptosuites v1.0 (`eddsa-rdfc-2022`)
- GCP Cloud KMS — Key algorithms (`EC_SIGN_ED25519`), AsymmetricSign REST ref (`data` vs
  `digest`), release notes (Ed25519 GA 2024-04-15)
- `@digitalbazaar/data-integrity` + `eddsa-rdfc-2022-cryptosuite` + `ed25519-multikey`
  (custom signer seam, raw-64-byte proofValue encoding, Multikey/publicKeyMultibase)
- Microsoft Entra Verified ID — signing-key rotation vs credential-lifetime coordination;
  did:webvh valid-keys (multi-key assertionMethod retention)
- Deepening pass 2026-05-16: best-practices-researcher (KMS feasibility),
  architecture-strategist (drift/determinism), security-sentinel (signing-oracle/compromise)
- Document-review pass 2026-05-16: 6 personas; corrected the "1EdTech 0/0 passed" false
  premise and added Phase 0.
- Decisions pass 2026-05-22: 5 strategic decisions resolved (sequencing/Phase 0 re-scope;
  attestation-host framing; BitstringStatusListEntry w/ attestation semantics; CI-emitted
  static did.json; default deploy topology with path-routing). James sharpened Decision 2
  framing — "this is the fundamental innovation we want to deliver to the world."
- Document-review pass 2026-05-22 (post-decisions): 7 personas (coherence, feasibility,
  product-lens, design-lens, security-lens, scope-guardian, adversarial); 10 auto-fixes
  applied + 10 P1 findings resolved the same day. Material refinements: statusPurpose
  shifted to "suspension" (P1-01); status-list shifted to key-epoch-only with no
  per-credential state (P1-07); plan scoped to Course V2 mapping (P1-04); comprehension
  gate added to Phase 0 (P1-02); startup drift check fortified with retry + bundled
  fallback + CI smoke probe (P1-06).
- Document-review pass 2026-05-23 (post-P1-refinement): 7 personas re-reviewed; 12
  auto-fixes applied for critical compliance + dependency gaps. Most notable:
  W3C BitstringStatusList REQUIRES minimum 16KB / 131,072 entries — status list resized
  from ~64 bits to 131,072 with key versions reserved at positions 0–63; archived libraries
  `walt-id/ssikit` and `spruceid/didkit` replaced with maintained successors
  (`waltid-identity` + `spruceid/ssi` crate); new WIF ref-constraint specified
  (`refs/tags/service-v*`); startup drift check extended with cryptographic
  `bundled_with_did_json_sha256` binding + active-KMS-key-in-registry check; comprehension
  gate bounded (2 iterations, 2 weeks); cross-project IAM verification moved Unit 1→Unit 4;
  `Course V2` explicitly internal-only; durability claim narrowed to "verify
  already-received bytes," not "fetch and verify new URL"; per-file COPY in Dockerfile
  preserved.
- P1bis decisions pass 2026-05-25: 10 findings resolved. Most-impactful: comprehension gate
  gains 3 disconfirming questions (P1bis-01); suspension-UX disposition deferred to
  pre-flight spike data + mass-suspension threat-model entry (P1bis-02); static incident
  page made optional under prototype posture (P1bis-03); v0-context update registers 4
  attestation-namespaced terms — `AttestationHost`, `OnChainCredentialAnchor`,
  `courseOwner`, `assessor` (P1bis-04 + P1bis-06); multi-mapper dispatch architecture
  designed now via `service/src/mappers/` with policy-id signal + shared field
  compatibility contract (P1bis-05); out-of-band smoke probe only, daily integrity monitor
  + cosign deferred to productionization (P1bis-07); API-key auth to `andamio-api`,
  cross-project IAM dissolved for v1 (P1bis-08); document-only CODEOWNERS + force-push
  disabled + minimal Actions permissions (P1bis-09); Phase 0 verifier set updated to
  walt-id + spruceid/ssi + **1EdTech digital-credentials-public-validator** (free) +
  digitalbazaar self-loopback (P1bis-10).
- **Posture lock 2026-05-25:** `credential-badges` is a prototype. Hardening simplifications
  scoped to: cross-project IAM, branch protection, cosign, integrity monitor, recipient
  notification, formal 1EdTech kit, named CODEOWNERS team. Production-Hardening Checklist
  section documents the upgrade path. Core correctness work (signing, framing, conformance,
  anchor gate, status-list shape, KMS, WIF separation, did.json drift, SHA-binding,
  forgery test, CODEOWNERS gating mechanism) remains at production rigor.
- Pre-flight verifier research 2026-05-25 (Explore agent): confirmed
  `walt-id/waltid-identity` v0.20.x supports OB3 + suspension + did:web (issue #977
  multi-key caveat); `spruceid/ssi` v0.16.x supports DI eddsa-rdfc-2022 (90/91 W3C
  interop) + did:web rigorously, OB3 schema needs custom code; **surfaced 1EdTech
  `digital-credentials-public-validator`** as the free third-independent verifier
- **Pre-Phase-0 verifier spike 2026-05-25** (`spike/verifier-spike/`): constructed a
  credential carrying all four production features simultaneously (`did:web`,
  `eddsa-rdfc-2022`, `BitstringStatusListEntry/suspension`, `OnChainCredentialAnchor`
  as typed evidence), published to throwaway GH Pages host
  (`workshop-maybe.github.io/credential-badges-verifier-spike`), submitted to verifiers.
  Results: **1EdTech public validator returned `outcome=VALID, errors=0, warnings=0,
  totalRun=13`** after iterating through 3 findings (now in plan). `@digitalbazaar/vc`
  self-loopback green. `spruceid/ssi` + `walt-id/waltid-identity` empirically deferred
  pending toolchain install. P1bis-10 set composition confirmed without revision.
  Note: 1EdTech canonical `vc.1edtech.org` URL (from upstream README) does not resolve;
  community deployment at `verifybadge.org` runs the same codebase and is the live
  public instance.
  that gives most of the 1EdTech credibility value at zero scheduling cost.
- **Rung 1 verifier runs 2026-07-09** (`feat/rung1-verifier-harness`): ran the two deferred
  independents against the same `publish/credential.jsonld`. **spruce (`ssi` v0.16.0) → VALID,
  errors=0, warnings=0** (required a KTD5 thin-adapter fix for the 0.16 API + preloading the
  OB3/custom JSON-LD contexts). **walt-id (built from source, tag v0.20.5) → structural
  finding: CLI `vc verify` is JWS/SD-JWT-only, cannot ingest DI JSON-LD; no official docker
  image exists.** **Decision: launch 1.1 on the two independents (spruce + 1EdTech) + loopback;
  defer walt-id to post-1.1** as optional third-independent hardening / suspension-UX rendering
  (P1bis-02). Supersedes the 2026-05-25 "P1bis-10 confirmed without revision" note. Full
  records: `spike/verifier-spike/results/{spruce,walt-id}.md`, `SUMMARY.md`.
