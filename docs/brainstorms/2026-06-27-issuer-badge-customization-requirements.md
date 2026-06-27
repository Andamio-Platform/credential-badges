---
date: 2026-06-27
topic: issuer-badge-customization
---

# Issuer Badge Customization — Brand Colors + Premium Background Image

> **Status: viability study, not a build spec.** Authored on the weekend ahead of
> roadmap/planning this week. The target, if built, is **no sooner than credential
> badges 1.1**. This doc captures the 1.1 feature shape, the data-ownership finding,
> and the open dependencies that planning must close — it is deliberately a
> product/scope artifact, not an implementation plan.

## Summary

A standalone credential-badges presentation layer that lets issuers brand their
badges **per-course** — brand colors (and a logo slot) for everyone, a custom
**background image** as a premium tier — authored *before* the OB3 document is
generated. Background images are stored on **IPFS** (immutable and permanent by
content-address), and the per-course customization record lives in infrastructure
the credential-badges service owns, **not** in `andamio-api`. `andamio-api`'s role
shrinks to a single entitlement check.

---

## Problem Frame

Today an Andamio badge is **build output**: its geometry is the proof-ring encoding
of the on-chain credential, and the only external read at render time is the
course/module **titles** from the andamio-api gateway (README, "How badges
resolve"). That makes badges deterministic and reproducible offline — a real virtue
— but it also means every badge for every course looks the same. There is no way for
an issuer to make their credentials look like *them*.

The 2026-04-20 imagery spike (`spike/credential-imagery.md`) already settled half of
this: OB 3.0's `Achievement.image` is the slot, image is presentation-layer only and
never identity-bearing, and v1 keyed it off `badge_id` hosted under Andamio's
control. What the spike did **not** cover is the *authoring* half — issuers outside
Andamio choosing their own look — and it left two acknowledged weaknesses in its v1
"Option A" hosting decision: **content permanence** (if Andamio stops serving, the
image is gone) and **issuer integrity** (an owner could swap the image undetected).

Two pressures now converge: external course owners want branded credentials, and the
presentation data has outgrown a home inside `andamio-api`. The felt moment is an
issuer setting up a course and wanting its badges to carry their brand before the
first credential is ever generated.

---

## Actors

- A1. **Issuer (course owner)** — an external org or individual that owns a course
  on-chain. Authority to set a course's look derives from holding the **courseOwner
  Access Token** for that `course_id`. Authors colors/logo (free) and, when entitled,
  a background image (premium).
- A2. **Recipient** — earns a credential; sees the branded badge on
  `credentials.andamio.io`, LinkedIn, etc. Does not author anything; benefits from a
  permanent, non-swappable image.
- A3. **credential-badges infrastructure** — the standalone service that owns the
  per-course customization record, pins images to IPFS, and renders/serves badges.
- A4. **andamio-api (entitlement source)** — answers one question: is this issuer's
  account paid/entitled to the premium tier? Does **not** own the customization data.
- A5. **Verifier (future)** — in the on-chain upgrade tier, can independently confirm
  the course→image binding from the chain. Not an actor in the 1.1 off-chain tier.

---

## Key Flows

- F1. **Author per-course brand (free tier)**
  - **Trigger:** Issuer sets up / edits a course's badge look before issuing.
  - **Actors:** A1, A3
  - **Steps:** Issuer authenticates as courseOwner for `course_id` → sets brand
    colors (+ optional logo) → infra stores the per-course record → existing
    on-demand render reads it like it reads titles → cache invalidated, badges
    re-render with the brand.
  - **Outcome:** Every badge for that course carries the issuer's colors; rendering
    stays reproducible-offline.
  - **Covered by:** R1, R2, R5, R6, R9

- F2. **Add premium background image**
  - **Trigger:** An *entitled* issuer uploads a custom background.
  - **Actors:** A1, A3, A4
  - **Steps:** Infra checks entitlement via A4 → if entitled, issuer uploads image →
    infra pins to IPFS and records the **CID** on the per-course record → render
    composites background + colors + proof-ring geometry → composited badge served
    (and optionally itself pinned for permanence).
  - **Outcome:** Course badges carry an immutable, permanent custom background.
  - **Covered by:** R3, R4, R7, R8, R10

- F3. **Update the look later**
  - **Trigger:** Issuer changes colors or swaps the background.
  - **Actors:** A1, A3
  - **Steps:** Issuer edits record → for an image, a new pin yields a **new CID**;
    the old CID still resolves forever → cache invalidated → badges re-render.
  - **Outcome:** The pointer advances; no previously issued credential is invalidated
    (image is never part of credential identity).
  - **Covered by:** R8, R9, R11

---

## Requirements

**Customization model**
- R1. A per-course customization record, keyed by `course_id`, is the unit of
  branding. One look applies to all of a course's badges/modules.
- R2. The free tier stores **brand colors** and an optional **logo** reference;
  these must keep badge rendering reproducible-offline (no dependency on mutable,
  un-addressed remote state).
- R3. The premium tier additionally stores a **background image**, referenced by an
  IPFS **CID**.
- R4. The same CID is the canonical image reference, designed so it can later be
  committed on-chain unchanged (the off-chain record is a faithful preview of the
  anchored tier).

**Authority and entitlement**
- R5. Authority to write a course's record is gated to the holder of the
  **courseOwner Access Token** for that `course_id` (the 1:1 course_id↔courseOwner
  invariant is the auth key).
- R6. Free-tier authoring (colors/logo) is available to any authenticated
  courseOwner.
- R7. Premium authoring (background image) requires an entitlement check resolving
  `courseOwner alias → paying account → is-entitled` against andamio-api.

**Storage and serving**
- R8. Background images are stored on IPFS; each image version is immutable by
  content-address. Updating a course's image produces a new CID; prior CIDs continue
  to resolve.
- R9. The image is **never identity-bearing**: it is excluded from any hash or
  signature that anchors credential identity (the imagery spike's "one rule"). An
  issuer changing the look never invalidates an issued credential.
- R10. The render pipeline reads the per-course record (and, for premium, fetches the
  background by CID) at generation time, composites it with the proof-ring geometry,
  and serves via the existing static-first / `@render` fallback path.
- R11. Changing a course's look triggers cache invalidation so badges re-render
  (reuses the existing #33 cache-invalidation mechanism).

**Data ownership**
- R12. The customization record and IPFS pinning are owned by the standalone
  credential-badges infrastructure, not by andamio-api. andamio-api is consulted only
  for the R7 entitlement check.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given a user who holds the courseOwner Access Token for
  `course_id` X, when they set brand colors for X, the record is written and X's
  badges re-render with those colors.
- AE2. **Covers R5.** Given a user who does **not** hold the courseOwner token for X,
  when they attempt to write X's record, the write is refused.
- AE3. **Covers R7.** Given an authenticated courseOwner whose account is **not**
  entitled, when they attempt to upload a background image, the upload is refused
  while colors/logo authoring still succeeds.
- AE4. **Covers R8, R9, R11.** Given a course with an issued credential and an
  existing background CID, when the issuer uploads a new background, a new CID is
  recorded, the old CID still resolves, badges re-render, and the previously issued
  credential remains valid.
- AE5. **Covers R2, R10.** Given a free-tier course with only brand colors, when a
  badge is rendered offline from on-chain data plus the record, the output is
  reproducible without fetching any mutable remote image.

---

## Success Criteria

- An external issuer can make their course's badges look like their brand before any
  credential is generated, without Andamio hand-editing assets.
- A premium issuer's custom background is **permanent** (survives an Andamio outage)
  and **non-swappable** in place (each version is a distinct immutable CID) — closing
  the two weaknesses the imagery spike flagged in its Option A.
- The customization data has a clear standalone home; andamio-api's only involvement
  is the entitlement check.
- A downstream planner can size the 1.1 off-chain feature without re-deciding grain,
  tiering, storage primitive, or auth key — and can see exactly which on-chain
  questions are deferred and why.

---

## Scope Boundaries

### Deferred for later

- **On-chain anchoring of the image (the reference-token tier).** Commit the CID in a
  **CIP-68 reference token minted to a validator (script) address** — not a wallet
  asset, so the one-Access-Token model does not bind it — with on-chain update
  authority tied to the courseOwner. This is the natural upgrade and the CID bridges
  to it cleanly, but it is a smart-contract / minting-policy / validator / datum
  workstream, **not** a 1.1 add-on. Its trigger is a verifier/enterprise actually
  asking "can the issuer swap the committed image undetected?"
- **Per-recipient personalized card** (`AchievementCredential.image`) — the
  Credly-style flourish from the imagery spike's Option E. Orthogonal Phase 2+ add-on.
- **Donation pipeline** for funding the free/community tier — logged as a
  sustainability idea, not designed here.

### Outside this product's identity

- **Per-badge and layered/override customization grain.** Rejected as design-tool
  creep. Per-course is the deliberate ceiling; we are not building a badge design
  studio.
- **Image as part of credential identity.** Permanently outside the product's
  identity — image is presentation-layer forever (R9). We are not building
  image-anchored credentials.
- **Hosting issuer brand data inside andamio-api.** The whole point of this study is
  that this data is *not* andamio-api's; rejecting that home is a positioning
  decision, not a deferral.

---

## Key Decisions

- **Per-course grain.** Chosen over per-org / per-badge / layered. It maps 1:1 to the
  course_id↔courseOwner invariant, so the auth model comes for free, and it avoids
  design-tool creep.
- **Two tiers split on cost.** Colors/logo are free and stay reproducible-offline;
  the background image is premium *because* it breaks offline-reproducibility and adds
  storage/upload surface — gating is what funds that cost and bounds the abuse
  surface to paid, identity-bound issuers.
- **IPFS as the storage primitive.** Content-addressing delivers the requested
  immutability and permanence directly (no transaction needed) and closes both
  Option-A weaknesses. The CID is the same reference off-chain now and on-chain later,
  so the cheap tier is an honest preview, not throwaway.
- **"Immutable" = immutable versions, advanceable pointer.** Each image version is
  immutable (its CID); the issuer can still point the course at a new CID. Credential
  identity never includes the image, so updates never invalidate issued credentials.
- **Standalone data plane, shared identity/entitlement plane.** The infra owns the
  customization record and pinning; andamio-api is consulted only for entitlement.

---

## Dependencies / Assumptions

- **Entitlement mapping (unbuilt).** Resolving `courseOwner alias → paying account →
  is-entitled` is assumed to be answerable against Andamio platform billing. The
  mapping from an on-chain courseOwner alias to a billing account is **not known to
  exist** and is the single dependency that keeps this infra from being fully
  standalone. *Unverified — must be confirmed before planning the premium tier.*
- **Reuses #33 on-demand render + cache invalidation.** Assumes the render service
  can read a per-course record and that the existing cache-invalidation mechanism
  (U6) covers look changes. Plausible from the README/ROADMAP but not verified in code
  here.
- **Paid relationship bounds abuse.** Assumes premium gating + identity-bound issuers
  reduces image-upload moderation risk to acceptable; no separate moderation system
  is assumed in 1.1.
- **OB3 mapping unaffected.** `Achievement.image` continues to carry the badge
  reference; this work changes how that image is *produced*, not the OB3 mapping
  contract.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R7][User decision] Is the paying unit the **org/account** (one subscription
  spanning many courses), and does anything in Andamio today map a courseOwner alias
  to that billing account? This gates the entire premium tier.
- [Affects R3, R8][User decision] Does "premium custom background" mean **arbitrary
  uploaded artwork**, or a **curated set** of issuer-selectable backgrounds/textures?
  The former needs upload + format/size validation; the latter is far lighter and may
  serve the brand need.

### Deferred to Planning

- [Affects R8][Technical][Needs research] IPFS operational model: self-hosted pinning
  vs a pinning service vs gateway choice; whether the *composited* badge SVG (not just
  the background) is also pinned for end-to-end permanence.
- [Affects R10][Technical] Where the composite happens (render service vs a pre-pass)
  and how a missing/slow IPFS fetch degrades (fall back to colors-only?).
- [Affects R2][Technical] Logo handling — is the logo also IPFS/CID, or a simple
  reference; does it count as free-tier or premium?
- [Affects "Deferred"][Needs research] Whether a **per-course on-chain object** exists
  today that a CIP-68 reference token could attach to, or whether the anchoring tier
  is net-new protocol work. This is the biggest sizing unknown for the upgrade and
  should be answered before that tier is roadmapped.
