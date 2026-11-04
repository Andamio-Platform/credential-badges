# Architecture: a reusable credential layer with Andamio as its first adopter

This document separates the **reusable credential infrastructure** in this
repository from the **Andamio- and Cardano-specific** parts. It is the map for
extracting a neutral core without rebuilding what already works.

> **The one-sentence thesis.** A ledger may prove that something happened.
> This project makes that proof **portable**: it turns a verified assertion from
> a trust source into a standards-based credential that ordinary applications,
> wallets, employers, and communities can verify without learning the source
> system.

It does not replace identity stacks, wallets, or ledgers. It sits one layer
above the trust source and one layer below the place where people see the
credential.

## The pipeline

```
 ┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐   ┌─────────────────┐   ┌──────────────┐
 │ Trust source │──▶│ Evidence adapter │──▶│ Credential core   │──▶│ Presentation    │──▶│ Verifier     │
 │              │   │                  │   │                   │   │                 │   │              │
 │ ledger,      │   │ verifies the     │   │ OB 3.0 / W3C VC:  │   │ badge SVG/PNG,  │   │ independent  │
 │ protocol,    │   │ claim at the     │   │ issuer, subject,  │   │ share page,     │   │ tools check  │
 │ workflow, or │   │ source; emits a  │   │ evidence, status, │   │ embed, wallet,  │   │ signature,   │
 │ enterprise   │   │ normalized       │   │ Data Integrity    │   │ API             │   │ status, and  │
 │ system       │   │ assertion        │   │ proof             │   │                 │   │ evidence     │
 └──────────────┘   └──────────────────┘   └───────────────────┘   └─────────────────┘   └──────────────┘
   e.g. Cardano       e.g. Andamio           shared, source-          shared                  external
                      Course V2              neutral
```

**Today's reference implementation:** Cardano → Andamio Course V2 adapter →
OB 3.0 / VC signed with `eddsa-rdfc-2022` under `did:web:credentials.andamio.io`
→ badge, share page, holder viewer, web component → 1EdTech validator, spruce,
and a loopback verifier.

The adapter contract is specified in
[`evidence-adapter.md`](evidence-adapter.md).

## What belongs where

| Layer | Owned by | Responsibilities |
|---|---|---|
| **Andamio product** | Andamio (outside this repository) | Learning workflows, courses, assessments, evidence of work, issuer and assessor relationships, community participation. |
| **Evidence adapter** (per source) | This project, with one adapter per trust source | Verify the claim against the source (fail closed), derive deterministic times and identifiers, and normalize into a source-neutral assertion. Define any source-specific vocabulary. |
| **Credential core** | This project | Serialize to OB 3.0 / W3C VC, sign (Data Integrity), resolve DIDs, attach status, run post-sign loopback verification, and freeze and pin published artifacts. |
| **Presentation** | This project | Deterministic badge rendering, share and holder pages, OG and PNG imagery, the embeddable web component. |
| **Deployment** | Each adopter | Issuer DID, signing keys (KMS), hosting, registry of what it issues, operational runbooks. Andamio operates `credentials.andamio.io`. |

## Where the code is today

An honest map: most of the code is already reusable, but it is named, configured,
and wired for one source.

| Path | Layer | Source-specific today? | What extraction needs |
|---|---|---|---|
| `issuer-service/src/anchor.ts` | Adapter (Cardano / Andamio) | **Yes, by design.** Andamioscan reads, Shelley slot→time, global-state gate. | Becomes the body of the Cardano/Andamio adapter's `resolve()`. No logic change. |
| `issuer-service/src/slt-hash.ts` | Adapter (Cardano / Andamio) | Yes. Plutus Data CBOR and Blake2b-256 over SLTs. | Moves with the adapter. |
| `issuer-service/src/map-credential.ts` | **Mixed** | Interleaves generic OB 3.0 assembly with Andamio URNs, narrative, `courseOwner`, and `OnChainCredentialAnchor`. | Split: the generic assembly goes to the core, and the field values come from the adapter's normalized assertion. Output must stay **byte-for-byte equivalent** after canonicalization, so existing signatures and expansion pins do not move. |
| `issuer-service/src/badge-registry.ts` | Deployment | Yes. Reads `generator/credentials.json`. | A registry interface that each deployment provides. |
| `issuer-service/src/config.ts` | Deployment | Yes. Issuer DID, static host, and indexer URLs are constants. | Deployment configuration (issuer profile, URLs) passed in, not imported. |
| `issuer-service/src/issue.ts`, `document-loader.ts`, `signer.ts`, `status-list.ts`, `drift-check.ts`, `cache.ts` | Core | Mostly no. URLs come from config. | Parameterize URLs. These are the reusable heart. |
| `issuer-service/src/server.ts` | Core + deployment | The route shape `/credentials/{network}/{policyId}/{sltHash}/{recipient}` is Cardano-shaped. | A generic route keyed by adapter id plus an opaque request, with the Cardano route kept as an alias. |
| `signing/` | Core (batch path) | Partially. Class artifacts and transcripts are Andamio's. | Library code to the core. Andamio's signed artifacts and transcripts stay as the reference deployment's records. |
| `context/v1.jsonld` | Adapter vocabulary (Andamio) | Yes. `AttestationHost`, `OnChainCredentialAnchor`, `courseOwner`, and others. | Stays frozen forever. A neutral core vocabulary, if needed, ships as a **new** context and never as an edit. |
| `generator/`, `imaging/`, `web-component/`, `public/` | Presentation | Proof-Ring geometry encodes `(policy_id, slt_hash)`, and naming and palettes are Andamio's. | Generalize the ring encoding to *any* two content hashes from an adapter. Rename the web component under a neutral name, with an alias for the old one. |
| `tools/`, `scripts/ci/` | Core (invariants) | No. | Already reusable. |
| `.github/workflows/deploy*.yml`, `nginx/`, `Dockerfile`s | Deployment | Yes. | Stay as Andamio's deployment, documented as an example deployment. |

## Invariants extraction must not break

These come from [`CONCEPTS.md`](../../CONCEPTS.md) and are enforced in CI. A
neutral core inherits all of them. They are a large part of what makes this
implementation worth upstreaming.

- **Anchor gate.** Nothing is signed unless the adapter re-verified the claim
  at the source, live. For the core, this means `resolve()` is the only way to
  obtain a signable assertion.
- **Validation gate.** Check one artifact against the external reference
  validator before signing a batch.
- **Version freeze.** Published contexts are byte-frozen. `v1` stays exactly
  as it is.
- **Expansion pin.** A refactor of the mapper must not change the canonical
  RDF dataset of any committed signed artifact. This is the equivalence test
  for extraction.
- **Wording gate.** Copy never claims broader verifiability than the artifact
  supports.

## Extraction plan (no rebuild)

1. **Specify the adapter contract** ([`evidence-adapter.md`](evidence-adapter.md)).
2. **Add a source-neutral core assembler** beside the existing mapper, plus a
   Cardano/Andamio adapter that wraps the existing anchor gate. Prove in CI
   that `core(adapter(anchor))` equals `mapCredential(anchor)`.
3. **Add a second, deliberately simple reference adapter** for a non-ledger
   source, to show that the credential-facing surface does not change.
4. **Switch the issuer service** to the core and adapter path behind the
   equivalence test and the expansion pins. Signed bytes must not move.
5. **Generalize presentation** (ring encoding inputs, neutral package names).
6. **Separate deployment** (configuration, registry, workflows) as "the Andamio
   deployment", an example that other adopters copy.

Steps 1 to 3 are additive and do not touch any live signing path. Steps 4 to 6
change production code and are sequenced after review.

## Known gaps, kept visible

- Only one adapter exists in production, and the multi-mapper dispatch noted
  in [`ROADMAP.md`](../../ROADMAP.md) was never built.
- Issuer identity is single-tenant (`did:web:credentials.andamio.io`).
  Per-organization issuer DIDs are designed but not built (issues #4, #6).
- The signature-bearing verification states in the holder viewer are not
  built.
- Per-holder baked artifacts are not built. Holder identity is deliberately
  kept out of git history.
- The vocabulary namespace is Andamio's. A neutral namespace would be a new
  context version, decided by a recorded vote.
