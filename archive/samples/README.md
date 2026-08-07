# OB 3.0 Spike Samples — Cross-Issuer Prerequisite Chains on Andamio Mainnet

These samples demonstrate the Andamio extension `andamio:requires` (see `../prerequisite-chaining.md`) using **real Cardano mainnet policies** as the on-chain anchors.

Each sample is a project-participation OB 3.0 credential whose `andamio:requires` block points at a course-completion achievement. The prerequisite relationship is enforced by the project's Plutus mint policy — a wallet cannot mint the participation token without holding the prerequisite course attestation.

## Files

### Schema demonstrations (placeholder recipients)

- **`sustain-and-maintain-gimbalabs.jsonld`** — Schema demo for the *Sustain and Maintain Gimbalabs* project credential with placeholder recipient `sample-maya`. Requires *Getting Started at Gimbalabs* course completion.
- **`cardano-xp-project.jsonld`** — Schema demo for the *Cardano XP* project credential with placeholder recipient `sample-alex`. Requires *Join Cardano XP* course completion.

### Real-recipient demonstrations (Path B)

- **`sustain-and-maintain-gimbalabs-james-real.jsonld`** — **Real-recipient credential** for James (alias `james`, Andamio Access Token V2 — Scaffolding Era). Anchored to James's actual mainnet `ujames` user token + `gjames` global state reference UTXO. The global state datum's credential map contains entries for *both* `Getting Started at Gimbalabs` (course slt_hash `ac35904d...75ce7e44`) and `Sustain and Maintain Gimbalabs` (project state_hash `8ca2f043...4220781b`), independently verifiable on-chain (round-trip confirmed 2026-05-12 — see `../out/verify-results-sustain-and-maintain-gimbalabs-james-real.md`).
- **`cardano-xp-project-njuguna-real.jsonld`** — **Real-recipient credential** for Njuguna (alias `njuguna`, Andamio Access Token V2 — Scaffolding Era). Anchored to Njuguna's actual mainnet `unjuguna` user token + `gnjuguna` global state reference UTXO. The global state datum's credential map contains entries for *both* `Join Cardano XP` (course slt_hash `d2c8d52e...0751646d`) and the `Cardano XP` project (project state_hash `5b57d48f...8abb7c6c`), independently verifiable on-chain (round-trip confirmed 2026-05-12 — see `../out/verify-results-cardano-xp-project-njuguna-real.md`). Cross-issuer prereq pair: Cardano XP project requires Join Cardano XP course completion.

Both real-recipient samples demonstrate the full Path B mapping: real recipient identity, real attestation proofs, real prerequisite chain enforcement.

### HTML viewers (generated)

Each `.jsonld` has a matching `.html` standalone viewer next to it — drag-and-drop into a browser or email as an attachment, no server or install needed. Regenerate via `npm run render`. The real-recipient viewer also embeds the latest `verify-results.md` so the proof of on-chain verification travels with the credential.

### Companion docs

- **`../DEMO.md`** — non-technical one-pager: what the credential proves, why the on-chain anchor matters, how to verify it yourself.
- **`../screencast-script.md`** — shot-by-shot script for a 60-second demo video.

The Path B sample introduces two extension fields surfaced during the 2026-04-23 spike:
- **`andamio:accessToken`** (on `credentialSubject`) — identifies the recipient via their on-chain Access Token (CIP-25 NFT pair: `u<alias>` user token + `g<alias>` global state reference token).
- **`andamio:onChainAttestation`** (on `achievement`) — points at the specific UTXO + datum entry that proves this recipient holds this attestation. Type `global-state-entry` indicates the attestation is an entry in the recipient's Access Token global state map.
- **`andamio:prereqAttestation`** (on each `andamio:requires` entry) — points at the specific entry in the recipient's global state that satisfies this prerequisite, using the same `policyId → typed_hash` shape (carries `sltHash` for course prereqs, `stateHash` for project prereqs).

## The credential identity — generalized (ratified 2026-04-23)

Every Andamio credential has a three-part identity:

```
course → {course_id} : {slt_hash}
project → {project_id} : {state_hash}
```

- **`local_state_type`** — open-ended string naming the kind of on-chain local state. Current values: `course`, `project`. Future types (e.g., `moduleset`, `track`, `cohort`) will extend this without schema changes. The `andamio:onChainAnchor.type` field carries the same label.
- **`policyId`** — Cardano native-asset minting policy identifier for the local state (institutional anchor).
- **Typed hash (third URN segment)** — named per credential type in Andamio's vocabulary: **`slt_hash`** for courses, **`state_hash`** for projects. It's the value stored at this credential's `policyId` key in the recipient's `g<alias>` global state datum map. Algorithm (confirmed 2026-05-12 via source-read in `andamio-atlas-api-v2`): two-step `blake2b_256( blake2b_256(serialiseData(toBuiltinData(state_list))) || ls_cs )`, where `state_list` is the course's module slt_hashes (course case) or the project's map of tokens flattened (project case), and `ls_cs` is the deployment-wide local state validator policy id. Note: "slt_hash" is overloaded — at the credential level it's the gjames-map value (computed via the algorithm above); at the module level it's the per-module SLT hash (produced by `andamio course credential compute-hash`). See `../mapping.md` for the full algorithm and cross-language replication status.

**Why it matters**: two credentials are identical iff all three parts (type, policyId, typed hash) match byte-for-byte. A course revision produces a new `slt_hash` under the same `policyId`; a project state update produces a new `state_hash` — a distinguishable achievement, not a silent update. Prereq references use the full three-part URN, so enforcement is version-precise.

**Why it generalizes**: the `andamio:requires` array is flat and each entry carries the full three-part URN. Any new `local_state_type` participates in the credential graph automatically — no schema change, no registry maintenance, no protocol update.

See `../mapping.md` for the full convention and `../prerequisite-chaining.md` for the four prereq cases (course→course, course→project, project→course, multi-policy, mixed / future types).

## What is real, what is illustrative

### Schema demos (`sustain-and-maintain-gimbalabs.jsonld`, `cardano-xp-project.jsonld`)

| Element | Status |
|---|---|
| Project policy IDs | **Real mainnet** — verifiable on cexplorer / Blockfrost |
| Course policy IDs (in `andamio:requires.achievementId`) | **Real mainnet** |
| `andamio:onChainAnchor.creationTxHash` and `creationTime` | **Real mainnet** — the LocalStateNFT mint TXs for each policy |
| Prerequisite enforcement description | **Real** — enforced by the project's Plutus mint policy at TX validation time |
| Typed hash values in URNs (`...0000...0001` through `...0000...0004`) | **Illustrative** — placeholder all-zero-plus-counter hex strings. Real course slt_hashes and project state_hashes are Blake2b-256 outputs. |
| Recipient DIDs (`urn:andamio:recipient:sample-maya`, `sample-alex`) | **Illustrative** — placeholder identifiers, not real wallets |
| Issuer DID (`did:key:z6Mk...`) | **Throwaway** — Phase 1 spike key; production will use `did:web:credentials.andamio.io` or per-org issuer DIDs |
| Proof block | **Omitted** — the *schema demos* remain unsigned shape demonstrations. (The two `*-real.jsonld` samples below are now signed — see their table.) |

### Real-recipient (`sustain-and-maintain-gimbalabs-james-real.jsonld`)

| Element | Status |
|---|---|
| Recipient identity (alias, Access Token NFT pair, wallet address, IPFS image) | **Real mainnet** — James's actual `ujames` user token + `gjames` global state reference |
| User-token holder address (recipient's wallet) | **Real mainnet** |
| `gjames` global state script address + UTXO + datum hash | **Real mainnet** — independently verifiable |
| Course completion attestation (slt_hash for Getting Started at Gimbalabs: `ac35904d...75ce7e44`) | **Real on-chain** — entry in James's `gjames` global state datum map, used in both `achievement.id` URN and `andamio:requires.achievementId` URN |
| Project participation attestation (state_hash for Sustain and Maintain Gimbalabs: `8ca2f043...4220781b`) | **Real on-chain** — entry in James's `gjames` global state datum map, used in the `achievement.id` URN |
| Proof block | **Present (demo-grade)** — W3C Data Integrity proof, `eddsa-rdfc-2022`, signed by a throwaway `did:key`. `issuer.id` is rewritten to that key so the proof verifies. Clears the 1EdTech "missing a proof" error. Production issuer/key: `credential-badges` #3–#8. **Corners cut: `CORNERS-CUT.md`.** Re-run `npm run sign-di` after any sample edit. |
| All other elements | Same as schema demos (real on-chain anchors) |

These samples are intended for **schema validation** and **landing-page reference**. They are not authoritative attestations and should not be treated as such.

## URN naming convention

Per the rules established 2026-04-23:

- **Three-part identity**: `urn:andamio:{local_state_type}:{policyId}:{typed_hash}` — third segment is the course's `slt_hash` or the project's `state_hash` (see "Credential identity — generalized" section above).
- **Production (mainnet) is implicit**: omit the network segment. `urn:andamio:course:<course_id>:<slt_hash>`, `urn:andamio:project:<project_id>:<state_hash>`.
- **Test/preprod is explicit**: include the network segment. `urn:andamio:preprod:course:<course_id>:<slt_hash>`.

A verifier seeing a URN without a network segment can assume mainnet. Test environments must be explicitly tagged so they cannot be mistaken for production credentials.

## What this validates

1. **The shape of `andamio:requires`** — proposed in `../prerequisite-chaining.md`, now expressed against real on-chain policies.
2. **The cross-issuer / cross-program structure** — the Sustain-and-Maintain chain and the Cardano-XP chain are independent programs (different policy IDs, different domains) that share the same prereq pattern. This is the literal structure behind the landing page's "credentials compose across programs" claim.
3. **The generalized three-part identity** — every credential is `{local_state_type}:{policyId}:{typed_hash}` (slt_hash for courses, state_hash for projects, future types extend without schema changes). `andamio:onChainAnchor.type` uses the same open-ended label. Future local-state types participate automatically.
4. **Version-precise prereq semantics** — a prereq reference carries the full three-part URN including the typed hash, so revisions are distinguishable. Snapshot semantics (PQ1) become trivial because old credentials still point at the old hash. Empirically demonstrated 2026-05-12: James's Feb-12 sustain-and-maintain snapshot uses state_hash `8ca2f04306...`; his current on-chain record for the same project uses state_hash `087238813f...`. Same policy, different achievement-version.

## Architectural insight worth capturing

Andamio credentials carry **revision-precise, type-generalized identity by default** — because the on-chain anchor pattern already encodes it. OB 3.0's lack of native prereq support and lack of native versioning aren't gaps for Andamio; they're inherent in the chain-anchor pattern. The Credential Graph claim on the enterprise landing page isn't aspirational — it's a structural property already enforced on-chain; the JSON-LD samples here just expose it through a portable shape so non-Cardano verifiers can read it.

## What this does NOT validate

1. ~~The `andamio:` JSON-LD context is not yet published.~~ **Resolved 2026-05-15.** The context is live at `https://credentials.andamio.io/context/v0.jsonld` (served with `application/ld+json`) and wired into every sample's `@context`. The samples now use the **bare terms** (`onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`) the context defines, so JSON-LD expansion resolves them as proper RDF instead of dropping them (njuguna sample: 0 → 39 `andamio:` namespace IRIs after wiring). Remaining caveat: the context is `v0` (shape may still change pre-1.0) and the issuer is still a throwaway `did:key`, not the production `did:web:credentials.andamio.io`.
2. **Alignment URLs are not present.** Project participation credentials don't decompose into SLT-style alignments the way course completions do. Worth a separate design pass on whether to add project-specific alignment shapes.
3. **The Cardano XP chain is schema-only**, not real-recipient — James (the recipient used for Path B) has the *Join Cardano XP* course attestation in his global state but does NOT have the *Cardano XP* project attestation. Either the project policy ID needs verification or James simply hasn't joined that project; needs confirmation.

## v1 design defaults baked in

(From `../prerequisite-chaining.md` PQ1–PQ6, v1 ratification 2026-04-23):

- **Revocation**: snapshot semantics (a project credential remains valid even if the prereq course credential is later revoked)
- **Multiplicity**: implicit `allOf` (every entry in `andamio:requires` must be satisfied)
- **Cross-issuer scope**: same-protocol Andamio credentials only (URN with `andamio:` namespace)
- **CLR 2.0 mapping**: deferred
- **Publish before 1EdTech certification**: yes (namespaced extension is invisible to non-Andamio verifiers)
- **`rationale` field**: added as a v1 extension to `andamio:requires` entries — human-readable explanation of what the on-chain enforcement actually checks. Helps non-Cardano verifiers parse the claim.

## Validation

To run these through the existing local validator:

```bash
cd ..
# Schema demos (unsigned) — JSON-LD shape only
node dist/validate.js samples/sustain-and-maintain-gimbalabs.jsonld
node dist/validate.js samples/cardano-xp-project.jsonld

# Real-recipient samples (signed) — re-sign + round-trip verify the DI proof
npm run sign-di
# Chain (datum-membership) verification — independent of the proof
npm run verify -- samples/cardano-xp-project-njuguna-real.jsonld
```

Expected: schema demos pass structural validation (signature skipped, unsigned).
The two `*-real.jsonld` samples carry a verified `eddsa-rdfc-2022` Data
Integrity proof and pass the official 1EdTech verifier (`vc.1ed.tech/validate`)
with **0 errors, 0 warnings**; chain verification is **7 passed, 0 failed**.

## Path B status (2026-04-23)

Path B (Access Token integration) is **partially landed** as of 2026-04-23:

- ✅ **Architecture decoded**: `u<alias>` user token (held in recipient wallet) + `g<alias>` global state reference token (held at Andamio script address) + global state datum containing `Constr [alias_bytes, map<policyId, typed_hash>]` (typed_hash = slt_hash for course entries, state_hash for project entries)
- ✅ **Real-recipient sample produced** for the Sustain and Maintain Gimbalabs chain (James as recipient)
- ✅ **Three new extension fields prototyped**: `andamio:accessToken`, `andamio:onChainAttestation`, `andamio:prereqAttestation`
- ⏳ **Cardano XP chain** still schema-only — needs a recipient wallet that has both `Join Cardano XP` course AND `Cardano XP` project in their global state map
- ⏳ **Mapper extension** — current samples were hand-written. Updating `src/mapper.ts` to produce the Path B shape from the existing on-chain inputs is the next code step.
- ⏳ **Verifier harness** (Q13) — the natural next mile is a verifier that takes a Path B credential, fetches the recipient's `gjames`-style global state UTXO, and confirms the claimed attestations are present in the datum map.

## Next steps

- ~~Resolve `open-questions.md` Q4 (publish `andamio:` JSON-LD context).~~ **Done 2026-05-15** — context published, samples rewired to bare terms, expansion verified.
- Identify the 4 unknown policy IDs in James's global state map (worth a 5-min Andamio API lookup).
- Verify the Cardano XP project policy ID and find a real recipient with both course + project for that chain.
- Update `src/mapper.ts` to produce Path B credentials programmatically.
- Build verifier harness (Q13) for Path B credentials.
- Feed into the landing page Credential Graph section as the concrete artifact that backs the claim.