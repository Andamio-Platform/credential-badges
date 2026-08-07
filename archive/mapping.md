# Andamio -> Open Badge 3.0 — Field-by-Field Mapping

This is the explicit transform applied by `src/mapper.ts`. Every OB 3.0 field is either drawn from Andamio's on-chain credential model or synthesized from a documented assumption.

## Credential identity convention (ratified 2026-04-23, naming refined 2026-05-12)

Every Andamio credential has a type-specific two-part identity. Andamio uses different names for the third element by credential type:

| Credential type | Native identity notation | URN form |
|---|---|---|
| Course | `<course_id> : <slt_hash>` | `urn:andamio:course:<course_id>:<slt_hash>` |
| Project | `<project_id> : <state_hash>` | `urn:andamio:project:<project_id>:<state_hash>` |

The unified URN keeps a `{local_state_type}` segment so a verifier can detect the type without reading the body. The third URN segment is the type-specific hash (`slt_hash` for courses, `state_hash` for projects, future types as they're added).

- **`local_state_type`** — open-ended string naming the kind of on-chain local state. Current values: `course`, `project`. Future types (e.g., `moduleset`, `track`, `cohort`) will extend without schema changes. The `andamio:onChainAnchor.type` field carries the same label (with a `-state` suffix: `course-state`, `project-state`).
- **`policyId` / `course_id` / `project_id`** — Cardano native-asset minting policy identifier for the local state. The institutional anchor. Same value across naming conventions; the type-specific prefix is conventional in Andamio's vocabulary.
- **Type-specific hash (third URN segment)** — content-addressed summary hash, stored as the value in the recipient's `g<alias>` global state datum map keyed by `policyId`.
  - **`slt_hash`** (course): represents the course state — derived from the course's module slt_hashes. Note that "slt_hash" is overloaded in Andamio: **module slt_hash** = `blake2b_256` over one module's SLT strings (per-module, produced by `andamio course credential compute-hash` / `computeSltHash` in core); **course slt_hash** = the gjames-map value (course-level, computed via the two-step algorithm below). The module slt_hashes feed the course slt_hash as inputs.
  - **`state_hash`** (project): represents the project state — hash of the map of tokens earned in that project. Distinct from any module slt_hash and from the `task_hash` produced by `computeTaskHash` (which is a separate concept used for treasury commits, not the gjames-map value).
- **JSON-LD field names** in this spike use the type-specific names directly: `andamio:onChainAttestation.sltHash` for course attestations, `andamio:onChainAttestation.stateHash` for project attestations. The verifier accepts `completionHash` as a legacy alias for either.

  **Exact algorithm (confirmed 2026-05-12 via source-read in `andamio-atlas-api-v2`):**

  Two-step Blake2b-256 with a deployment-wide salt. Defined in `andamio-tx/TxBuilding/Andamio/Utility/GetValidators/V2/GetGlobal.hs:89-94`:

  ```haskell
  hashLocalState     ls_cs data_hash = blake2b_256 (data_hash <> ls_cs)
  hashLocalStateData list            = blake2b_256 (serialiseData (toBuiltinData list))
                                       -- returns "" for empty list
  ```

  Composed: `gjames_value = blake2b_256( blake2b_256( serialiseData( toBuiltinData( state_list ))) || ls_cs )` — 32-byte output, 64-char hex. This is what Andamio calls `slt_hash` (when the local state is a course) or `state_hash` (when the local state is a project).

  Inputs:

  | | `state_list` (inner hash input) | Call site |
  |---|---|---|
  | **Course** | `[SltHash]` — list of the course's module slt_hashes, serialized as bytestrings | `TxBuilders/Student/V2/MintCourseState.hs:41` (`curState = hashLocalStateData courseStateBbs`) |
  | **Project** | `ListValue` (project's flattened funded value list, `toFlatVals state`) | `TxBuilders/Contributor/V2/MintContributorState.hs:70` (`curState = hashLocalStateData $ toFlatVals state`) |

  Both then flow into `createNewGsDatMint global_state ls_id ls_cs curState` (GetGlobal.hs:70-74), which calls `hashLocalState ls_cs curState` to produce the value stored at key `ls_id` in the gjames map.

  - **`ls_id`** = course or project NFT mint policy ID (the key in the gjames map — this is the `policyId` in the OB 3.0 URN).
  - **`ls_cs`** = local state validator's minting policy ID — a deployment-wide constant, not per-credential. Acts as a domain-separating salt.

  Implication for cross-deployment verification: the same module slt_hashes computed under a different Andamio deployment would produce a different course slt_hash. The hash is deployment-bound. The `andamio:onChainAnchor.network` field already carries the deployment indicator, but verifiers reproducing the hash from raw inputs also need `ls_cs` for the target deployment.

  Note: `hashProjectData` (`Utility/Types/Project.hs:84-85`) does exist and hashes a `TaskData` struct (project_content, expiration, lovelace, native_assets), but it is used in `createCommitProjectSkeleton` for treasury commit operations — it is **not** the project state_hash stored in the gjames map.

  **Cross-language replication status (confirmed 2026-05-12)**:

  Each gjames-map value (course `slt_hash` / project `state_hash`) is a composition: an **inner hash** over a Plutus-encoded state list, then an **outer hash** with `ls_cs` as a domain-separating salt. The atoms exist cross-language; the composition does not.

  | Hash | Haskell (`andamio-atlas-api-v2`) | TS (`andamio-core`) | Go (`andamio-cli`) |
  |---|---|---|---|
  | Module slt_hash — `blake2b_256(serialiseData(toBuiltinData([slt_string_1, ...])))` (one module's SLT list) | `sltsToBbs` (MintModule) | `computeSltHash` ✓ | `ComputeSltHash` ✓ |
  | TaskData hash — `blake2b_256(serialiseData(toBuiltinData(BPProjectData)))` (treasury commit, **not** the gjames-map value) | `hashProjectData` (Project.hs:84) | `computeTaskHash` ✓ | `ComputeTaskHash` ✓ |
  | Commitment / assignment-evidence hash | (off-chain only) | `computeCommitmentHash` ✓ | — |
  | **Course state inner hash** — `blake2b_256(serialiseData(toBuiltinData([module_slt_hash_1, ...])))` (a list of *module slt_hashes*, not SLT strings) | `hashLocalStateData` (GetGlobal.hs:92) | **not replicated** | **not replicated** |
  | **Project state inner hash** — `blake2b_256(serialiseData(toBuiltinData([FlatValue, ...])))` (project's map of tokens, flattened) | `hashLocalStateData` (GetGlobal.hs:92) | **not replicated** | **not replicated** |
  | **Outer composition** — `blake2b_256(data_hash ‖ ls_cs)` — produces the **course `slt_hash` or project `state_hash`** in the gjames map | `hashLocalState` (GetGlobal.hs:89) | **not replicated** | **not replicated** |

  Important nuance: `computeSltHash` (core/cli) hashes one module's *SLT strings* — this is the **module slt_hash**. The **course slt_hash** is one layer higher: hash of the list of module slt_hashes, then outer-composed with `ls_cs`. Same name "slt_hash" overloaded at two levels; cannot derive course slt_hash from `computeSltHash(allSLTsConcatenated)` — the levels do not collapse.

  **Implications for the verifier harness work (item 2 in "what's next")**:

  - Three viable paths for verifying a Path B credential's typed hash (course slt_hash or project state_hash):
    1. **Recompute from raw state** — port `hashLocalStateData` (course-state and project-state variants) + `hashLocalState` to TS or Go. Half-day per stack. Cleanest, fully off-chain, but requires fetching the course's module slt_hashes from DB API and knowing the deployment's `ls_cs`.
    2. **Call txapi** — server-side recompute via an endpoint in `andamio-atlas-api-v2`. Trusts txapi as oracle; trivial to implement.
    3. **Datum-membership check only** — fetch the recipient's `g<alias>` UTXO, decode the datum, confirm the claimed `(policyId → typed_hash)` pair is present. Does **not** prove the hash matches the underlying course state, but **does** prove the recipient's on-chain record bears this exact pair — sufficient for VC verification. Simplest, recommended for v1, shipped as `src/verify.ts`.

  Recommendation: ship the v1 verifier on path 3 (datum-membership). Path 1 (recompute) is a strong follow-up that closes the round-trip "the on-chain hash matches the canonical SLT list" — useful for audit trails and dispute resolution, but not the first thing to prove externally.

Two credentials are identical iff all three components match byte-for-byte. A course revision produces a new `slt_hash` (or project a new `state_hash`) under the same `policyId` — a distinguishable achievement, not a silent update. **Version-precision demonstrated empirically 2026-05-12**: between Feb 12 and 2026-05-12, the Sustain and Maintain Gimbalabs project's `state` evolved, producing a new state_hash for the same policy. James's Feb-12 credential and the current on-chain record reference the same project but different achievement-versions.

### URN shape

```
urn:andamio:course:{course_id}:{slt_hash}                    ← mainnet course credential
urn:andamio:project:{project_id}:{state_hash}                ← mainnet project credential
urn:andamio:preprod:course:{course_id}:{slt_hash}            ← preprod course (test-explicit)
urn:andamio:preprod:project:{project_id}:{state_hash}        ← preprod project (test-explicit)
```

The production-implicit, test-explicit rule: mainnet URNs omit the network segment; preprod and other test networks include it explicitly. A verifier seeing a URN without a network segment can assume mainnet. The `andamio:onChainAnchor.network` field always carries the explicit network for machine clarity, regardless of what the URN omits.

This applies retroactively: the existing preprod sample already follows the rule (`urn:andamio:preprod:credential:...`).

## Top-level Verifiable Credential fields

| OB 3.0 / VC 2.0 field | Source | Rule | Notes |
|---|---|---|---|
| `@context` | constant | `[ "https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json" ]` | Both contexts confirmed publicly resolvable. |
| `id` | derived | `urn:andamio:credential:{policyId}:{recipientId}` (mainnet) or `urn:andamio:preprod:credential:{policyId}:{recipientId}` (preprod) | Stable URN form per the convention above. We don't yet host a dereferenceable URL — production will swap to `https://credentials.andamio.io/ob3/{policyId}/{recipientId}` (per Plan §1). |
| `type` | constant | `["VerifiableCredential", "OpenBadgeCredential"]` | Required by OB 3.0. |
| `validFrom` | derived | ISO 8601 timestamp of issuance | Production: pull `block_time` of the `credential_claim` tx via Blockfrost. Spike uses generation-time so JWT `nbf` is always satisfied. |
| `name` | derived | `"Completion: {course.title}"` | The achievement name, lifted to the credential level for at-a-glance display. |
| `description` | derived | `course.description` (from on-chain or DB API content payload) | The Andamio course description prose. |

## Issuer

| OB 3.0 field | Source | Rule | Notes |
|---|---|---|---|
| `issuer.id` | generated | `did:key:z6Mk...` | Ed25519 multibase-encoded public key. Spike uses a throwaway key. Production issuer identity (DID method + per-org sovereignty tier + key custody) is the consolidated decision in `open-questions.md` Q3, tracked as `credential-badges` #3–#8. |
| `issuer.type` | constant | `["Profile"]` | Required by OB 3.0. |
| `issuer.name` | derived | `"Andamio ({teacherAlias} on Cardano {network})"` | Production: organization name from issuer registry. |
| `issuer.url` | constant | `https://credentials.preprod.andamio.io/issuer` | Will return the Issuer Profile JSON-LD when the credential service ships. |
| `issuer.description` | constant | spike disclaimer | Will be replaced with real Andamio org metadata. |

## Credential subject

| OB 3.0 field | Source | Rule | Notes |
|---|---|---|---|
| `credentialSubject.id` | derived | `urn:andamio:{network}:recipient:{studentStateAsset}` | Pseudonymous, stable, fully on-chain-derivable. **Open question**: do we want to support email-hash, did:web, or wallet-bound DID per recipient preference? Plan §5 / open-questions.md. |
| `credentialSubject.type` | constant | `["AchievementSubject"]` | Required by OB 3.0. |
| `credentialSubject.achievement` | nested object | see below | One Achievement per credential. |

## Achievement

| OB 3.0 field | Source | Rule | Notes |
|---|---|---|---|
| `achievement.id` | derived | Course: `urn:andamio:course:{course_id}:{slt_hash}`. Project: `urn:andamio:project:{project_id}:{state_hash}`. Prepend `:preprod` segment for testnet credentials. | The type-specific credential identity — see the convention section above. Two credentials share an `achievement.id` only when all three parts match byte-for-byte. Revisions produce a new typed hash and therefore a new achievement identity. This matches the Andamio protocol's on-chain anchor pattern. |
| `achievement.type` | constant | `["Achievement"]` |  |
| `achievement.name` | derived | `course.title` |  |
| `achievement.description` | derived | `course.description` |  |
| `achievement.criteria.narrative` | synthesized | Markdown listing every SLT + the on-chain anchor reference | This is the human-readable evidence statement. We render the SLTs verbatim from `module.slts` and append the policy_id so verifiers see the chain anchor immediately. |
| `achievement.alignment` | synthesized | One `Alignment` per SLT, pointing to a future `https://credentials.preprod.andamio.io/achievement/{course_id}/{slt_hash}#slt-N` URL | This is the natural OB 3.0 hook for our SLT structure: each SLT becomes an alignment to an Andamio-hosted competency definition. The URLs don't resolve yet — flagged in open-questions.md. |

## Evidence

| OB 3.0 field | Source | Rule | Notes |
|---|---|---|---|
| `evidence[0].id` | constant | `https://preprod.cexplorer.io/policy/{policy_id}` | Public block explorer link. Always resolvable. |
| `evidence[1].id` | constant | `https://cardano-preprod.blockfrost.io/api/v0/assets/{asset_id}` | Programmatic chain anchor. The Blockfrost endpoint requires a `project_id` header for live verification — verifiers should have their own. |

`evidence` is OB 3.0–optional. We include it because the on-chain anchor is the load-bearing part of an Andamio credential, and OB 3.0 verifiers that ignore custom extensions still see the evidence URLs.

## Andamio-specific extension

| Field | Rule | Notes |
|---|---|---|
| `andamio:onChainAnchor` | object with `network`, `type` (open-ended string naming the `local_state_type` as `course-state` / `project-state` / etc.), `policyId`, `assetName`, `assetFingerprint`, `blockfrostAsset`, `explorerUrl`, `claimTxHash`. The typed hash itself (`sltHash` / `stateHash`) lives on `onChainAttestation`. | Custom property. **Gap**: we have not yet defined an `andamio` JSON-LD context that aliases this term properly. JSON-LD expansion currently emits this as a fully-prefixed but un-namespaced predicate, which the digitalbazaar `jsonld` library accepts as a relative IRI. For OB 3.0 conformance we need to publish a context at e.g. `https://credentials.andamio.io/context/v1.jsonld` and add it to the `@context` array. Tracked in open-questions.md. |
| `andamio:requires` | array of `{ achievementId, enforcement, policyReference, rationale }` | Cross-issuer prerequisite extension, flat array (implicit `allOf`). Each entry's `achievementId` is the full three-part URN of the required credential. Works uniformly for course→course, course→project, project→course, multi-prereq, and future local-state-type chains. See `prerequisite-chaining.md` for full design. v1 ratification 2026-04-23. |
| `andamio:onChainAttestation` | object recording where the recipient's earned attestation lives on-chain: `type` (e.g., `global-state-entry`), `policyId`, `sltHash` (course attestations) **or** `stateHash` (project attestations), `globalStateUtxo`, `globalStateDatumHash`, `verification`. | Path B real-recipient field. Points at the specific UTXO + datum entry that proves THIS attestation. The `policyId` + typed hash pair is denormalized from the parent `achievement.id` URN for verifier ergonomics. Introduced 2026-04-23; field naming refined 2026-05-12. The verifier accepts `completionHash` as a legacy alias. |
| `andamio:accessToken` | object on `credentialSubject`: Access Token NFT pair info (`u<alias>` user token + `g<alias>` global state reference), holder address, global state script address, global state UTXO | Path B identity extension — the recipient's canonical on-chain identity per Andamio v2 Access Token model. Introduced 2026-04-23. |

## Proof

| OB 3.0 / VC field | Source | Rule | Notes |
|---|---|---|---|
| `proof.type` | constant | `JsonWebSignature2020` | OB 3.0 explicitly supports JWT proofs. |
| `proof.created` | runtime | ISO 8601 |  |
| `proof.verificationMethod` | derived | `{did}#{publicKeyMultibase}` | The `did:key` self-resolves to its verification method without needing a registry. |
| `proof.proofPurpose` | constant | `assertionMethod` |  |
| `proof.jwt` | runtime | EdDSA JWS over `{ vc: <document>, iss, sub, jti, iat, nbf }` | Conventional VC-JWT shape. The full document sits under `vc`; conventional JWT claims duplicate id/issuer/subject for verifier convenience. |

## Fields we do NOT populate

| OB 3.0 field | Why omitted |
|---|---|
| `credentialStatus` | No revocation list yet (Plan §2.4 — Phase 4, deferred). When implemented, will point at `https://credentials.andamio.io/status/{list_index}`. |
| `credentialSchema` | No JSON Schema published yet for Andamio's variant. Would be `https://credentials.andamio.io/schema/v1`. |
| `validUntil` | Andamio credentials don't expire. Could be set if a course owner explicitly chose an expiry. |
| `credentialSubject.achievement.result` | Andamio is currently pass/fail at the credential level (a credential exists or it doesn't). If we add graded outcomes (e.g. teacher rubric scores), this is the natural home. |
| `credentialSubject.achievement.image` | Course `image_url` exists in the course content payload — easy add in v2 of the mapper. Skipped for spike clarity. |
| `refreshService`, `termsOfUse`, `relatedResource` | Out of scope for v1. |

## Direct field correspondences (cheat sheet)

```
Andamio                              OB 3.0
----------------------------------------------------------------
local_state_type (course,       ->   achievement.id URN segment, andamio:onChainAnchor.type
  project, future types)             (open registry — not an enum; type field carries
                                     -state suffix: course-state / project-state)
policy_id (course_id /          ->   achievement.id URN segment, andamio:onChainAnchor.policyId,
  project_id / future)               issuer.url path component (also: Cardano native asset policy_id)
gjames-map value (typed hash):
  course → slt_hash             ->   achievement.id URN segment (third),
  project → state_hash               andamio:onChainAttestation.sltHash | .stateHash,
  Computed:                          andamio:requires.achievementId URN third segment,
  blake2b_256(blake2b_256(           andamio:prereqAttestation.sltHash | .stateHash
  serialiseData(state_list))
  || ls_cs); state_list is the
  course's module slt_hashes OR
  the project's flat funded
  values; ls_cs is the deployment-
  wide local-state policy id.
module slt_hash                  ->   not used directly in the credential identity —
  (Blake2b-256 over a single        modules are a level below the course credential.
  module's SLT strings;             Feeds the course slt_hash as one element of the
  produced by                       inner-hash state_list. May surface in alignment URLs
  `andamio course credential       in future iterations.
  compute-hash` /
  computeSltHash in core/cli)
asset_name (recipient alias hex)->   credential.id (last segment), credentialSubject.id seed
module.slts[]                   ->   achievement.criteria.narrative (numbered)
                                     achievement.alignment[] (one per SLT)
course.title / project.title    ->   credential.name, achievement.name
course.description              ->   credential.description, achievement.description
teacher.alias / project.alias   ->   issuer.name suffix
recipient.accessTokenAlias      ->   credentialSubject.id (URN form), andamio:accessToken block
network ("preprod" | "mainnet") ->   all URN namespaces (preprod explicit, mainnet implicit)
claim_tx (from Blockfrost)      ->   andamio:onChainAnchor.claimTxHash, validFrom (block_time)
issuer signing key              ->   did:key (spike) or did:web (production)
```
