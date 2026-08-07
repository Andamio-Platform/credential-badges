# Credential Imagery — Associating Images with Andamio Credentials

**Date:** 2026-04-20
**Companions:** `README.md`, `open-questions.md`, `prerequisite-chaining.md`, `end-user-ux-research.md`, `mapping.md`
**Scope:** v1 design decision + deferred full architecture

---

## The question

Open Badges have clear visual assets — a user's "badge" is a specific graphic they can display in a web app. Andamio credentials today have no visual. Can OB 3.0 provide the pathway to associating images with Andamio credentials, or does this conflate concerns?

**Short answer: OB 3.0 provides the slot. It's not conflation, as long as image stays at the presentation layer and never enters credential identity.**

---

## Architectural constraints (load-bearing)

Two facts about Andamio's model that shape this design:

1. **One Access Token per user.** Each credential holder has exactly one Andamio Access Token NFT in their wallet. Credentials are attestations written into / referenced via that single token — not minted as separate NFTs. CIP-25 / CIP-68 per-NFT metadata patterns **do not apply** to credentials; a Cardano wallet rendering its NFT gallery shows the Access Token, not per-credential graphics.

2. **A badge = any subset of 1 or more course modules.** An Andamio "badge" is a named subset of modules that defines what a recipient earned. It can be a single module, multiple modules from one course, modules across courses, or a whole course. The *badge* is the coarser-grained unit that carries image, title, criteria, and prereqs — not the course, and not the individual SLT.

These two facts rule out "CIP-25 image per credential in the wallet gallery" as a free feature and reframe the image association question as: **how do we associate an image with a badge (subset of modules), hosted and referenced in a way that OB 3.0 exports can consume?**

---

## What OB 3.0 offers

Three image slots, all optional:

| Field | What it is | Typical content |
|---|---|---|
| `Profile.image` | Issuer logo | Org / teacher brand |
| `Achievement.image` | Badge art — same for everyone who earns this badge | Course-independent, per-badge graphic |
| `AchievementCredential.image` | Per-instance art | Personalized card — recipient name, date |

Images can be a URL or a data URI. `Achievement.image` is the primary slot for Andamio's badge-level artwork.

OB 3.0 treats image as descriptive, not identity-bearing — which is the clean separation we want. (OB 2.0 often baked assertions *into* the PNG; OB 3.0's VC is canonical, the image is just an image.)

---

## The decision — Option A for v1

**Host images off-chain under Andamio's control; reference by URL in OB 3.0 exports. No on-chain anchor for images in v1.**

### v1 shape

- Each badge has an image URL stored in course/badge content payload (DB API)
- Served from `credentials.andamio.io/image/{badge_id}.png`
- Populates `Achievement.image` in OB 3.0 export
- Nothing on-chain about the image
- Trust model: recipient trusts Andamio to keep serving the image

### Why this is the right v1

- Ships the visual parity gap closure immediately (LinkedIn / Credly flow works)
- No protocol change required
- No Access Token change required
- No minting cost per credential
- Compatible with the badge = subset of modules constraint — the image keys off badge_id, not course or SLT
- Defers harder questions (content permanence, on-chain anchoring) until we know what's actually needed

### What this does NOT solve (and that's okay for v1)

- **Content permanence** — if Andamio goes down, image is gone. Acceptable for v1; IPFS mirroring is a v1.5 upgrade.
- **Issuer integrity** — course owner could swap the image after the fact without invalidating the credential. Acceptable: the SLT hash remains the credential's cryptographic identity; image is mutable marketing.
- **Wallet-native rendering** — a Cardano wallet still shows the Access Token, not per-badge graphics. Recipient sees badge graphics on `credentials.andamio.io`, LinkedIn, etc., not in Lace. Not a regression — just a reality of the Access Token model.

---

## Deferred — fuller badge imaging architecture

Explicitly out of scope for v1. Recorded here so we don't rebuild this analysis later.

### Option B — IPFS-pinned image, content-addressed

Pin image to IPFS; CID stored in course/badge payload; OB 3.0 doc carries `ipfs://{cid}` or gateway URL. Solves permanence without on-chain change. Good v1.5 upgrade once we have a recipient population that depends on long-lived credentials.

### Option C — On-chain hash commit (new design)

Commit the image hash (sha256 or CID) on-chain, alongside the badge definition. Image lives off-chain; integrity lives on-chain. Verifiers can confirm the served image matches what was declared at badge-issue time. Requires a new metadata slot in the badge/course setup transaction — small extension, not a protocol rewrite. Worth doing when we have a concrete integrity story to tell (e.g. enterprise procurement asking "can images be swapped without detection?").

### Option D — Per-course reference NFT (CIP-68-style at the course level)

A non-user-held reference NFT minted once per course, carrying CIP-68 metadata including the image. Attestations in the Access Token reference the course's policy_id; verifiers resolve to the ref NFT for imagery. Cardano explorers and ecosystem tooling get a clean rendering hook. More ambitious; worth revisiting only if ecosystem-level badge rendering becomes valuable.

### Option E — Personalized per-recipient card

Dynamically rendered at share time: `credentials.andamio.io/card/{badge_id}/{recipient}.png` includes alias, date, SLT list, chain anchor. Populates `AchievementCredential.image`. This is the "Credly-style certificate" flourish — a natural Phase 2+ addition on top of Option A.

---

## Access Token imagery (orthogonal, worth a note)

The single Access Token itself could carry CIP-25 metadata — artwork for "Andamio Learner — alias" that shows in the wallet gallery. This is a **one-per-user identity cue**, not per-badge imagery. Worth considering as a separate design thread; doesn't affect the credential imagery question.

---

## Recommended first actions (v1 shipping path)

1. Add `badge.image_url` to the badge content payload (DB API).
2. Stand up `credentials.andamio.io/image/{badge_id}.png` as the serving endpoint.
3. Populate `Achievement.image` in OB 3.0 exports from that URL.
4. Extend `sample-credential.jsonld` in the prototype with a sample image block for the Cardano XP feedback course.
5. Keep the mapping.md correction (achievement-per-badge, not achievement-per-course) on the deferred list; log it but don't ship yet.

No protocol change, no Access Token change, no minting cost, no team review required to proceed with this scope.

---

## Conflation avoidance — the one rule

Don't let image content enter any hash or signature that anchors credential identity. A course owner refreshing badge artwork in year 2 should not invalidate anyone's year-1 credential. The SLT hash is the credential's fingerprint; image is a pointer the credential carries. Keeping them separate means imagery can evolve freely without touching the chain.
