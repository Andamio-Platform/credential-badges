# Prerequisite Chaining — An Andamio Extension to OB 3.0

**Status:** v1 design ratified 2026-04-23. Sample artifacts in `samples/` use this shape against real Andamio mainnet policies.
**Date:** 2026-04-20 (initial), 2026-04-23 (v1 ratified, samples landed)
**Companion to:** `open-questions.md` (Q4 — unaliased `andamio:` context), `mapping.md`, `README.md`, `samples/README.md`

---

## The Gap

**Open Badges 3.0 has no structural concept of prerequisite badges.** No `prerequisite`, `requires`, or `dependsOn` property exists on the `Achievement` class. The closest properties are:

- `criteria.narrative` — free-text prose describing what earning requires (human-readable only, not machine-enforceable)
- `alignment` — maps an achievement to an *external competency definition* (a framework, a standards body taxonomy). Not to another achievement.
- `evidence` — artifacts supporting the claim
- `result` — graded outcome data

The OB 3.0 **Implementation Guide** mentions prerequisites as a use-case narrative ("Issuer issued a verifiable assertion of prerequisite course completion to Maya") but provides no property to encode it. Prerequisite enforcement is expected to live in the issuer's platform, outside the credential document.

### The adjacent spec (CLR 2.0)

The Comprehensive Learner Record 2.0 defines an `Association` class with an `AssociationType` enumeration. This is 1EdTech's relationship primitive. But CLR is a *transcript wrapper* — a bundle of credentials with relationships between them — and Association is intra-CLR, not cross-issuer and not chain-verifiable.

### What platforms do today

- **Badgr / Canvas Credentials** — "Pathways" feature (UI + database, not spec-level)
- **Credly** — "Stacks" (UI + database, not spec-level)
- **Accredible** — "Sequences" (UI + database, not spec-level)

None of these are encoded in the signed OB 3.0 JSON-LD. A verifier reading the signed document sees a badge, not a pathway. Prerequisite enforcement is trust-the-issuer — if the issuer's platform DB lied or was compromised, the badge is still validly signed.

---

## The Andamio Angle

Andamio's credentials are Cardano native tokens minted by a Plutus validator. **Prerequisite enforcement can live in the minting policy** — the chain itself refuses to mint credential B unless the recipient's wallet holds credential A (or some specified subset).

This is structurally different from every OB 3.0 implementation today:

| Dimension | Platforms (Badgr, Credly, …) | Andamio |
|---|---|---|
| Where prereq is checked | Issuer platform DB | Plutus validator at mint time |
| What the signed VC encodes | The badge, standalone | The badge + on-chain anchor |
| How a verifier confirms prereq | Trust issuer claim | Read the mint policy + verify wallet holds prereq |
| Cross-issuer prereq possible? | No (platform-scoped) | Yes (policies can reference any chain asset) |
| Revocation of prereq affects B? | Issuer discretion | Enforceable in policy design |

A verifier who knows the Andamio extension + has chain access can **independently confirm the prereq was honoured**, not just that the issuer claims it was. That's a real property no SaaS implementation can match.

---

## Proposed Extension Shape

Add a namespaced property under the `andamio` JSON-LD context (which is already flagged for publication in `open-questions.md` Q4):

```json
"andamio:requires": [
  {
    "achievementId": "urn:andamio:{local_state_type}:{policyId}:{completionHash}",
    "enforcement": "mint-policy",
    "policyReference": "https://cexplorer.io/policy/{enforcing_policy_id}",
    "rationale": "Plain-language explanation of what the on-chain enforcement actually checks."
  }
]
```

> **Credential identity** (ratified 2026-04-23): every Andamio credential has the three-part identity `{local_state_type}:{policyId}:{completionHash}`. Prereqs are referenced by the full three-part URN so the check is version-precise: a revised course with a new `completionHash` is a distinguishable prereq. Mainnet URNs are production-implicit (omit network); preprod URNs are test-explicit. See `mapping.md` for the full convention.

### Property semantics

- `achievementId` — Full three-part URN of the required achievement (`{local_state_type}:{policyId}:{completionHash}`). Matches the `achievement.id` of the prereq's credential byte-for-byte.
- `enforcement` — enum. At minimum: `"mint-policy"` (chain-enforced at mint), `"issuer-attestation"` (issuer claims it was checked).
- `policyReference` — optional URL where the enforcing Plutus policy can be inspected. For `"mint-policy"` enforcement, this points at the *enforcing* policy (the one that checks for the prereq at mint time), not the prereq's own policy.
- `rationale` — human-readable explanation of what the on-chain enforcement actually checks. Helps non-Cardano verifiers parse the claim without having to read the Plutus script. Added to v1 (2026-04-23).

### Four prereq cases — one flat array, no special syntax

Flat array (implicit `allOf` per PQ2 v1) handles every case by enumerating required credentials, each with its full three-part URN:

**Case 1 — credential → credential (single prereq of any type)**:
```json
"andamio:requires": [
  { "achievementId": "urn:andamio:course:P1:h1", "enforcement": "mint-policy", ... }
]
```

**Case 2 — multiple credentials required (same policy, different completions; or different policies)**:
```json
"andamio:requires": [
  { "achievementId": "urn:andamio:course:P1:h1", ... },
  { "achievementId": "urn:andamio:course:P1:h2", ... },  // different completionHash under same policy — just another entry
  { "achievementId": "urn:andamio:course:P2:h3", ... }
]
```

**Case 3 — project → course** (a project completion is prereq for a course):
```json
"andamio:requires": [
  { "achievementId": "urn:andamio:project:P:h", ... }
]
```

**Case 4 — course → project** (shown in `samples/sustain-and-maintain-gimbalabs-james-real.jsonld`):
```json
"andamio:requires": [
  { "achievementId": "urn:andamio:course:3ed1bca6...:ac35904d...", ... }
]
```

**Mixed / future** — any combination of current or future `local_state_type` values:
```json
"andamio:requires": [
  { "achievementId": "urn:andamio:course:P1:h1", ... },
  { "achievementId": "urn:andamio:project:P2:h2", ... },
  { "achievementId": "urn:andamio:moduleset:P3:h3", ... }  // hypothetical future type, no protocol update
]
```

The `local_state_type` segment is an open registry — the array doesn't care what type each entry is. This is why the architecture generalizes automatically as new on-chain local-state types are introduced.

### Legibility

- **OB 3.0-strict verifiers** that don't know the `andamio` context: ignore the property (by JSON-LD convention)
- **Andamio-aware verifiers**: cross-check the policy on-chain and confirm the wallet holds the prereq asset
- **Platform importers** (HR systems, LMS): read `criteria.narrative` for human prose; machine-readable prereq is bonus

### Round-trip consistency

The same prereq list should be encoded **both** in the Plutus minting policy (the source of truth) **and** in the OB 3.0 document (the portable mirror). Divergence between the two would be an issuer bug. Phase 2 tooling should generate the OB 3.0 prereq block from the compiled policy, not from a separate config.

---

## Open Questions

### PQ1. What does "requires" mean when the prereq is revoked or burned?

If credential A is revoked (via `credentialStatus` / Bitstring Status List) or the NFT is burned, what happens to credential B which required A?

Options:
- **Strict**: B becomes invalid when A is revoked. Requires runtime revocation propagation — expensive.
- **Snapshot**: B is valid if A was valid at mint time of B. Prereq is proof-of-history, not proof-of-current-state.
- **Verifier choice**: the VC states the prereq; the verifier decides which policy to enforce.

Recommendation: **Snapshot**, with a verifier hook. Composability stays intact; revocation semantics stay simple.

### PQ2. How do we encode "1 of N" vs "all of N" requirements?

A badge might require *any one* of three prereqs, or *all three*. OB 3.0 has no precedent for this; the namespaced extension can borrow from `anyOf` / `allOf` shapes common in JSON Schema:

```json
"andamio:requires": {
  "allOf": [ { "achievementId": "..." }, { "achievementId": "..." } ],
  "anyOf": [ { "achievementId": "..." }, { "achievementId": "..." } ]
}
```

Adds complexity. Maybe not v1. v1 = implicit `allOf`; v2 = structured boolean logic.

### PQ3. Cross-issuer prereqs — same protocol or any chain asset?

- **Same protocol**: prereq must be an Andamio credential (URN shape enforceable)
- **Any chain asset**: prereq can be any Cardano native token the verifier recognizes (e.g., "holder of <Intersect member token>")
- **Any VC**: prereq can be any signed VC whose `id` matches (requires verifier to resolve and check validity)

Start narrow (same-protocol Andamio credentials), widen as use cases surface.

### PQ4. How does this compose with CLR 2.0?

If Andamio eventually emits a CLR 2.0 transcript, the `Association` mechanism can mirror `andamio:requires` into 1EdTech-native `hasPrerequisite` / `isPartOf` relationships. Worth confirming there's no semantic drift between the two representations.

### PQ5. Competitive and strategic lift

- **Where this matters for enterprise positioning**: "Your badges are dead ends. What if they were building blocks?" — prereq chaining is the literal structural answer to "building blocks." This is the composability moat made machine-readable.
- **Where this matters for protocol positioning**: no OB 3.0 implementer today can offer on-chain-enforced prereqs. This is a defensible wedge.
- **Where to surface it**: enterprise pitch deck, `credentials-beyond-the-app.md`, whitepaper.

### PQ6. What breaks if we publish before 1EdTech certification?

The extension lives under the `andamio:` namespace and is invisible to non-Andamio verifiers. It does not alter the OB 3.0 surface. Certification risk is low — but worth running past Sebastian's 1EdTech contact before we point a press release at it.

---

## v1 Ratification (2026-04-23)

For the v1 shape used in `samples/`, the open questions resolve as:

- **PQ1 (revocation)**: snapshot semantics — a credential remains valid even if its prereq is later revoked. Verifier hook can opt into stricter behavior.
- **PQ2 (multiplicity)**: implicit `allOf` only. Structured `anyOf` / `allOf` blocks deferred to v2.
- **PQ3 (cross-issuer scope)**: same-protocol Andamio credentials only (URNs in the `andamio:` namespace). Widening to arbitrary chain assets or arbitrary VCs deferred. *(Reviewed 2026-07-28 against the per-org-issuer-DID design and re-ratified unchanged — a prereq entry references the chain, not a signature, so multiplying issuer DIDs does not reopen this. See [`docs/plans/2026-07-28-002-design-multi-issuer-prereq-scope-pq3.md`](../docs/plans/2026-07-28-002-design-multi-issuer-prereq-scope-pq3.md), which adds two invariants — no issuer field in `requires`; prereq resolution is chain-first, DID-never.)*
- **PQ4 (CLR 2.0 mapping)**: deferred. Confirm no semantic drift before emitting CLR 2.0 transcripts.
- **PQ5 (strategic lift)**: confirmed — this is the literal "building blocks" claim from the enterprise landing page.
- **PQ6 (publish before 1EdTech cert)**: yes. Namespaced extension is invisible to non-Andamio verifiers; certification risk low.

## Recommended Next Steps

1. ✅ **Prototype in the spike** — done 2026-04-23. See `samples/sustain-and-maintain-gimbalabs.jsonld` and `samples/cardano-xp-project.jsonld`.
2. **Flag in the Phase 2 team review** (Gate 0 in the one-pager).
3. **Sanity-check with a prospect** — does this resonate as a differentiator in an enterprise sales conversation? Worth one call with a Tier 1 prospect.
4. **Consolidate with Q4** — publishing the `andamio` JSON-LD context is the shared blocker. When Q4 is scheduled, include `requires`, `enforcement`, `policyReference`, and `rationale` in the initial context definition.
5. **Path B follow-up** — extend the OB 3.0 mapper to handle the v2 Access Token shape, then re-issue the samples with real recipient identifiers.

---

## Related

- `open-questions.md` Q4 — `andamio:onChainAnchor` context publishing (shared dependency)
- `open-questions.md` Q9 — credential burns / revocation (interacts with PQ1)
- `open-questions.md` Q14 — Cardano XP interop (XP is a natural prereq source: "held 100 XP" → unlocks a course)
- `mapping.md` — where the new property would slot into the document shape
- `README.md` — update to mention prerequisite chaining once we've decided to ship
