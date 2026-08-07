# Open Questions — Surfaced During the Phase 1 Spike

Things the team needs to decide or that need verification before the Phase 2 service build starts. Numbered for reference; rough priority order.

## Questions about the credential model

### Q1. No real preprod completion credentials exist yet
The task asked for a "Midnight PBL completion credential" on preprod. We discovered:

- The Midnight PBL course (`dd29e3da6227720a8600a41c95e4f40e74785e2831da036ac95843ff`) is currently **mainnet-only**. Per task constraints, mainnet was off-limits.
- The largest preprod course we could find with active student state is "Give Feedback on This App" (`76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742`, the Cardano XP feedback course referenced in `040-testing/xp/preprod/README.md`).
- Three students (lynx, otter, zebra) have live `student_state` UTXOs under that course's state policy.
- **No completion credential has actually been claimed** on any preprod course we could find. The on-chain LocalStateNFT mint count is 1 across the policy.

**Action**: should we (a) run a `credential_claim` against the preprod feedback course with one of the test wallets so we have a real claimed credential to validate against in Phase 2, or (b) port the Midnight PBL course content to a fresh preprod deployment? Either gives the Phase 2 build a real anchor to test round-trip verification against.

### Q2. Recipient identifier — what shape?
We used `urn:andamio:preprod:recipient:{studentStateAsset}` — pseudonymous, stable, fully on-chain-derivable, and privacy-preserving by default. Production options worth confirming:

- **Email hash** (sha256 of normalized email) — best for HR system import (Workday, BambooHR).
- **Wallet address** (bech32) — most "Cardano-native" but exposes wallet activity.
- **`did:cardano` or `did:web` per recipient** — cleanest standards story; requires a DID method.
- **Recipient choice at claim time** — most aligned with our principles (Plan §5: "Privacy vs portability tradeoff").

This is OB 3.0–allowed in any of these forms. **Decision needed before Phase 2.** Open question Q3 in the plan doc.

### Q3. Issuer identity — who is the issuing authority?

> **Consolidated 2026-05-15.** This question previously appeared in three places that didn't reference each other: this Q3 (DID method), `mapping.md:105` ("a shared Andamio issuer DID with per-org sub-issuers — open question"), and `prerequisite-chaining.md` PQ3 / `samples/README.md:115` (cross-issuer scope = same-protocol only). They are one decision. The live work is now tracked as **`credential-badges` issues #3–#8** (#3 is the anchor decision); this section is the rationale of record.

**Reframe.** "Who is the issuer?" answers differently per layer:

- **On-chain (truth):** the issuing authority is the **policy ID**. Each course/project has its own Plutus mint policy; root of trust is that policy + the recipient's Access Token global-state entry, independently verifiable with **zero trust in any DID** (`verify.ts`, 7/0). Andamio is **not** inherently the authority.
- **Presentation (OB 3.0 `issuer`):** currently flattens that per-policy authority into one throwaway `did:key` — a spike artifact, not a protocol constraint.

**DID method**: `did:web` for the issuer (lowest friction — serve `/.well-known/did.json` over HTTPS; verifiers need nothing but HTTPS). `did:cardano` deferred — defining a non-existent method is scope creep, same reasoning as the "no `did:andamio` registry" out-of-scope call.

**Sovereignty tiers** (the real decision — see `credential-badges` #3 for the table and key-custody analysis):

- **T1 Display-only** — one Andamio `did:web`, per-course Profile name/logo only. ≈free, weakest decentralization.
- **T2 Andamio-hosted per-org DIDs** — `did:web:credentials.andamio.io:issuers:<org>`, distinct DID+key per owner, Andamio runs infra. Maps 1:1 to on-chain policy.
- **T3 Org self-sovereign** — owner controls the DID; Andamio = protocol + anchor host. Strongest "credentials travel beyond Cardano, not locked to one authority" story; on-narrative for the Cardano XP / John funding frame.

**The crux is key custody, not hosting.** Serving N issuers is cheap (`credential-badges` #4). Sovereignty = who holds the signing key, which is independent of the on-chain policy authority.

**Interaction with a ratified default.** PQ3 ratified cross-issuer prereq scope as "same-protocol Andamio only." Genuine per-org issuer DIDs *strengthen* the cross-issuer story but reopen that default (verifier must resolve N issuer DIDs). Tracked as `credential-badges` #7.

**Not yet verified** (gates how real T3 can be): who controls the per-course on-chain mint policy — owner vs Andamio-on-behalf. Tracked as `credential-badges` #8; finding feeds #3.

**Recommendation (unchanged for Phase 2, now with a designed path): `did:web` issuer, T1 to ship, T2 path designed, T3 deferred to v2** — but make the tier choice and key-custody model an explicit decision (#3), not an implicit default, because it carries strategic weight beyond plumbing.

## Questions about the JSON-LD context

### Q4. `andamio:onChainAnchor` is unaliased — ✅ RESOLVED 2026-05-15
The custom field carrying the `policy_id`, `asset_name`, and `slt_hash` previously appeared as a literal property name with no prefix definition. JSON-LD libraries treated it as a relative IRI and dropped the sub-properties on expansion — a strict OB 3.0 verifier could reject the document for undefined terms.

**Resolution**: the context is published at `https://credentials.andamio.io/context/v0.jsonld` (served `application/ld+json`; source in the `credential-badges` repo). Each term is defined with a scoped `@context` for its sub-properties. All samples now carry the context URL in `@context` **and** use the **bare terms** (`onChainAnchor`, `accessToken`, `requires`, …) — the CURIE form bypasses the scoped sub-contexts, so bare terms are required for full resolution. Empirically: njuguna sample expands from 5402 → 9897 chars with 0 → 39 `andamio:` namespace IRIs, `policyId` now resolving as `…/ns/v0#policyId`. Verifier/renderer accept the legacy CURIE form as a fallback; the Path B builder and `mapper.ts` emit the new canonical shape.

Residual: the published context is `v0` (not `v1` — shape may still change pre-1.0), and 1EdTech certification + the production `did:web` issuer remain open (see the issuer caveat in `samples/README.md`).

### Q5. Alignment URLs don't resolve
Each SLT becomes an `Alignment` pointing at e.g. `https://credentials.preprod.andamio.io/achievement/{course_id}/{slt_hash}#slt-1`. These URLs don't exist yet. An OB 3.0 verifier that follows alignment links will get 404s.

**Fix**: in Phase 2, add `GET /achievement/{course_id}/{slt_hash}` to the credential service that returns a JSON-LD competency definition for each SLT. Cheap to add (it's just templated rendering of the SLT text).

## Questions about validation / certification

### Q6. The public IMS validator is OB 2.0 only
`openbadgesvalidator.imsglobal.org` is the URL you'd intuitively reach for, but it's pinned to OB 2.0 and an old `pyld`. For OB 3.0 conformance you need the 1EdTech certification kit, which is membership-gated.

**Action**: this matches the plan's expected procurement path (Plan §4). Sebastian needs to drive the membership decision before we can certify. Until then, our local validation harness (structural + JSON-LD + JWT signature) is the substitute.

### Q7. No public reference verifier we could test against
The plan calls for "automated interop tests against known verifiers (Credly, POK, 1EdTech reference validator)" in Phase 3. Of those:

- **Credly** — closed platform; need a partnership conversation.
- **POK** — no public verifier endpoint we found in the spike timebox.
- **1EdTech reference validator** — gated by membership.

Worth a separate research pass to find any public OB 3.0 verifier we can hit programmatically. The closest universal target is the W3C `vc-test-suite-data-model` — a Mocha test runner that exercises a credential service. We didn't run it because it requires standing up the credential service, which is Phase 2 work.

## Questions about the on-chain anchor

### Q8. How do we recover `validFrom` from the chain?
For a real completion credential we want `validFrom` to be the `block_time` of the `credential_claim` transaction. Blockfrost gives us this: the asset's `initial_mint_tx_hash` (from `/assets/{asset_id}`) → `/txs/{hash}` → `block_time`. The mapper currently hardcodes `new Date()` because we have no real claim to anchor against.

**Action**: add a `--from-blockfrost` mode to the generator that fetches the actual `block_time` once we have a claimed credential. ~30 minutes of work. Punted.

### Q9. What about credential burns?
If a student burns their credential NFT on-chain, the OB 3.0 document we previously signed remains valid by signature. The chain knows the credential is gone; the OB 3.0 document doesn't.

This is the same problem `credentialStatus` (Bitstring Status List) solves in Phase 4. Until then, **a verifier checking the OB 3.0 document alone might think the credential still exists.** Worth flagging in the verifier reference docs (Plan §3): "to fully verify, dereference the on-chain anchor and confirm the asset still exists in the recipient's wallet."

### Q10. Cross-chain verification cost
Our evidence URLs include the Blockfrost API endpoint, which requires the verifier to have a Blockfrost project ID. For verifiers without one, we should also expose a cached, public endpoint at `https://credentials.andamio.io/anchor/{policy_id}/{asset_name}` that returns the same data without authentication. Trivial to add in Phase 2.

## Questions about scope creep

### Q11. Should the spike test Linked Data Proof too?
We shipped JWT proof only. LDP via `eddsa-rdfc-2022-cryptosuite` (the modern replacement for `Ed25519Signature2020`) is the more "JSON-LD-native" path and is what some verifiers prefer. The Phase 2 plan calls for both.

**Decision**: confirm in team review whether JWT-only is acceptable for v1. If yes, we save ~1–2 days of integration work. If no, add LDP early in Phase 2.

### Q12. Per-course or per-instance issuer profile?
Currently the issuer is "Andamio (cardano_xp on Cardano preprod)" — one issuer with the teacher alias surfaced in the `name`. Some procurement contexts want a clear separation: one issuer per teaching organization, each with its own profile. This affects URL design and key scoping (Plan §1.3 / Q2 / Q3).

## Questions about what to build next

### Q13. Should Phase 1 also produce a verifier?
The spike is one-way: Andamio → OB 3.0. A useful next mile is a **verifier harness** in the same prototype that takes a signed OB 3.0 document, extracts the on-chain anchor, and confirms the asset still exists in the claimed recipient's wallet. ~1 day of work in TS, then port to Go for the Phase 2 service.

### Q14. How does this interact with Cardano XP?
Cardano XP credentials (`722c475bebb106799b109fc95301c9b796e1a37b6afc601359d54a04` policy on preprod, asset name `5850` = "XP") are fungible XP tokens, not completion NFTs. The OB 3.0 mapping needs a different shape for "I earned 50 XP through 5 contributions" vs "I completed this course." Worth a separate spike when XP infra needs to expose OB 3.0 surface.

---

## Items resolved during the spike (no team input needed)

- The OB 3.0 + W3C VC 2.0 contexts are publicly resolvable and stable. No mirroring needed for the prototype.
- VC-JWT signing with EdDSA / `did:key` works end-to-end with the `jose` library.
- The mapping from Andamio's data shape to OB 3.0 fields is straightforward and lossless.
- The dual-issuance approach is technically valid: the on-chain anchor remains canonical, and the OB 3.0 document references it via `evidence` and the custom `andamio:onChainAnchor` field.
