# signer-spike (Rung 6, hardened at Rung 8, finalized at Rung 8.3)

One cryptographically signed OB3 Verifiable Credential for a **real mainnet
Andamio credential**, signed with the **production GCP KMS Ed25519 key**,
hard-gated on a **live on-chain anchor check**, and verified by independent
verifiers. The first time a real Andamio credential got a real signature.

The committed artifact is [`signed-credential.json`](./signed-credential.json) —
since Rung 8.3 in its FINAL production shape: the deployment plan's flat
`evidence` anchor dialect (`network`/`policyId`/`asset`/`claimTxHash`),
top-level `courseOwner` attribution (assessor omitted — the on-chain record
names none), and a `credentialStatus` BitstringStatusListEntry pointing at the
served key-epoch status list ([`status/key-epoch-2026-07.json`](../../status/key-epoch-2026-07.json),
signed with the same key; `statusPurpose: "suspension"`, one bit per key
version, bit 0 = `#key-2026-07` = 0).

## The subject credential (full identifiers, re-derived live from Andamioscan)

| field | value |
|-------|-------|
| network | `mainnet` |
| alias | `james` |
| course id (mint policy) | `ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df` |
| slt_hash | `e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db` |
| claim tx hash | `7cb75099e81644b8ce2442e2cacf4e6dafdba54991a8599e0f88f5432dd2cb03` |
| slot | `190131814` |
| block_time (derived from slot) | `2026-06-17T12:08:25Z` |
| course / module | "Andamio Issuer" / "About Andamio Issuer" |
| recipient studentStateAsset | `gjames` (Access Token global-state asset, ASCII `g` + alias) |
| badge | <https://credentials.andamio.io/badges/ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db.svg> |

`validFrom` and `proof.created` are both pinned to the claim-tx `block_time`,
derived deterministically from the slot (mainnet Shelley formula), per the
deployment plan's determinism decision.

## The anchor-gate contract (`check-anchor.ts`)

Signing is **unreachable** unless a live Andamioscan read proves the anchor.
`sign.ts` calls `checkAnchor()` in-process before constructing any signer; a
failed anchor read exits with **zero KMS operations**. The gate asserts, against
`https://andamioscan.io` live:

1. `/api/v2/events/credential-claims/claim/{tx}` resolves (per-tx resolution —
   only classifier-confirmed claims live at that path), and its
   `(course_id, credentials[])` byte-equals the pinned `(courseId, sltHash)`,
   and its `alias` byte-equals the pinned recipient.
2. `/api/v2/transactions` indexes the tx as `StudentCourseCredentialClaim` at
   the pinned slot — located by **binary search over the slot-descending
   index** (O(log pages)), so the check stays valid however deep the tx sinks
   as mainnet history grows (issue #54, finding 5).
3. `/api/v2/courses/{courseId}/details` lists the sltHash among the course's
   modules, the module's SLT texts are non-empty, and
   **Blake2b-256 over their Plutus Data CBOR encoding equals the pinned
   sltHash** (the derivation of `slt_hash` from SLT text, matching the
   on-chain validator and the andamio CLI's `course credential verify-hash`) —
   the text that gets signed into `criteria.narrative` is exactly what the
   chain commits to (issue #54, finding 3).
4. `/api/v2/users/{alias}/courses/completed` contains the course.
5. block_time derived from the slot equals the pinned block_time.
6. The production badge SVG for `<courseId>.<sltHash>` returns HTTP 200.

`checkAnchor()` is **sealed**: it takes no parameters (the old test-only
subject override is gone — issue #54, finding 4, code half), and the `Anchor`
it returns is the single object `mapCredential` maps from. Refusal paths are
covered hermetically in `check-anchor.test.ts` (mocked `fetch`); the original
`transcripts/anchor-gate.txt` shows the Rung-6 gate passing on the real
subject and refusing a tampered slt_hash.

## Signing pipeline (`sign.ts`)

Data Integrity proof, cryptosuite `eddsa-rdfc-2022`, via
`@digitalbazaar/data-integrity`: RDFC-1.0 canonicalize proof config + document,
SHA-256 each, sign the concatenation. The custom signer seam supplies raw
Ed25519 only:

- **`--signer local`** (run first): ephemeral `node:crypto` Ed25519 key through
  the same `async sign({data})` seam — validates the plumbing end-to-end with
  a digitalbazaar verify, no KMS involved.
- **`--signer kms`**: exactly **one** `gcloud kms asymmetric-sign` call
  (Cloud KMS Ed25519 is PureEdDSA over the raw `data` bytes, never a digest;
  64-byte raw signature asserted, then base58btc-multibase encoded into
  `proofValue` by the suite). Before signing, the KMS public key (version 1 of
  `projects/andamio-credentials/locations/us-central1/keyRings/credential-badges-issuer/cryptoKeys/vc-sign-ed25519`)
  is re-pinned against the **live**
  `https://credentials.andamio.io/.well-known/did.json` — mismatch refuses to
  sign.

`verificationMethod: did:web:credentials.andamio.io#key-2026-07`,
`proofPurpose: assertionMethod`.

The document loader is closed and allowlisted (W3C/OB3 contexts, the live
production Andamio context, the live production did:web document — nothing
else), and it refuses to canonicalize if the live
`https://credentials.andamio.io/context/v0.jsonld` drifts from the committed
`context/v0.jsonld`.

Rung-8 hardening (issue #54, findings 1 + 2):

- The LIVE guarantees are actually live: `did.json` is fetched from the
  network on **every** read (key pin, in-sign resolution, post-sign verify),
  and the context-drift guard compares the **network** copy against the
  committed context — a stale or poisoned `out/ctx-cache/` entry can never
  satisfy either (proven in `document-loader.test.ts`). A `--signer kms` run
  additionally clears the context cache at start, so even the immutable
  W3C/OB3 contexts are fetched fresh.
- The `vc.issue` fallback is narrowed to the one known urn-id data-model
  `TypeError` (`issue-error.ts`; on the pinned dependency set it is dead
  code — verified empirically). Any other error aborts the run.
- The signer seam must be invoked **exactly once** (kms mode: exactly one
  `gcloud kms asymmetric-sign` call), asserted before any artifact write, and
  the artifact is written atomically (temp file + rename) — a failed assert
  can never leave a partial artifact.

## Repro commands

```
cd spike/signer-spike
npm install

npm run check-anchor     # anchor gate only; writes out/anchor.json
npm run map              # gate + unsigned credential; writes out/credential-unsigned.json
npm run sign:local       # gate + loopback sign/verify with an ephemeral key (no KMS)
npm run sign:status      # gate + key-pin check + ONE KMS sign of the key-epoch
                         #   status list -> writes ../../status/key-epoch-2026-07.json
npm run sign:kms         # gate + key-pin check + ONE KMS sign + live-did verify
                         #   -> writes ./signed-credential.json
npm run verify           # standalone digitalbazaar verify of the committed artifact
                         #   (resolves production did:web live; add `-- --status live`
                         #   post-deploy to check the LIVE status list instead of the
                         #   committed file)
npm run test             # Rung-8 hardening tests — hermetic (mocked fetch, no KMS)
npm run resign-check     # ONE deterministic KMS re-sign of the committed artifact;
                         #   proves byte-stability, writes nothing

# CONTEXT_AHEAD_OF_LIVE_OK=1 is a PER-DEPLOY-WINDOW flag, not standing
# workflow: it exists only for the window between committing an additive
# context change and the deploy that publishes it, and signing/verify runs
# are prefixed with it ONLY inside that window (see Decisions #6 below).
# Once the live context matches the committed one, run without it — the
# strict-equality drift guard is the normal posture.

# spruce (independent verifier #1):
cd ../verifier-spike/verifiers/spruce
./run.sh ../../../signer-spike/signed-credential.json

# 1EdTech public validator (headless file upload):
curl -X POST "https://verifybadge.org/api/validate?validatorId=OB30Inspector&other=" \
  -F "file=@signed-credential.json;type=application/json"
```

KMS access: `gcloud` authenticated as a principal with
`cloudkms.publicKeyViewer` + `cloudkms.signerVerifier` on the key (this run
used James's own account directly; impersonation of
`credential-badges-sign-sa@andamio-credentials.iam.gserviceaccount.com` is not
granted to it — see PR body).

## Verification results

Rung 8.3 (the current artifact — flat evidence + courseOwner + credentialStatus):

| verifier | result | transcript |
|----------|--------|------------|
| spruceid/ssi v0.16 (`spruce-verify`, production did:web resolved live, committed context vendored) | **VALID, errors=0, warnings=0** | `transcripts/rung83-spruce.txt` |
| spruceid/ssi v0.16 on the STATUS LIST credential (`status/key-epoch-2026-07.json`) | **VALID, errors=0, warnings=0** | `transcripts/rung83-spruce-status-list.txt` |
| digitalbazaar loopback (`verify-loopback.ts`, live did:web + status check) | **verified: YES** | `transcripts/rung83-digitalbazaar-loopback.txt` |
| 1EdTech public validator (headless) | 12/13 probes pass; 1 error from `EmbeddedProofProbe` — **expected until deploy**: the validator expands against the LIVE context, which gains the Rung-8.3 terms only when this branch deploys. Re-run post-deploy; expected 13/13. | `transcripts/rung83-1edtech-full.json` |

Rung 6/8.2 (the previous artifact, for the record):

| verifier | result | transcript |
|----------|--------|------------|
| spruceid/ssi v0.16 (`spruce-verify`, production did:web resolved live) | **VALID, errors=0, warnings=0** | `transcripts/spruce.txt` |
| digitalbazaar loopback (`verify-loopback.ts`, live did:web) | **verified: YES** | `transcripts/digitalbazaar-loopback.txt` |
| 1EdTech public validator (headless) | 12/13 probes pass; 1 error from its did:web resolver fetching the bare-domain DID at `/did.json` instead of the spec's `/.well-known/did.json` (fixed by the `/did.json` alias, PR #57) | `transcripts/1edtech.md`, `transcripts/1edtech-full.json` |

## Decisions taken (documented deviations)

1. ~~**No `credentialStatus` in this artifact.**~~ **SUPERSEDED at Rung 8.3.**
   The repo now hosts `/status/key-epoch-2026-07.json` (131,072-bit
   BitstringStatusList, `statusPurpose: "suspension"`, bit 0 = `key-2026-07`,
   signed by the production did:web via the hardened path —
   `sign-status-list.ts`), and the artifact carries the matching
   `BitstringStatusListEntry` (`statusListIndex: "0"` = the signing key
   version's registry position; see `status-list.ts`).
2. ~~**No top-level `courseOwner` / `assessor` fields.**~~ **SUPERSEDED at
   Rung 8.3.** The P1bis-04 context update registers `courseOwner` and
   `assessor` in `context/v0.jsonld` (additive; existing terms byte-untouched),
   and the mapper emits `courseOwner`
   (`urn:andamio:mainnet:course-owner:gjames`). `assessor` stays omitted for
   THIS credential because the on-chain record names no assessor — that is the
   plan's omit-never-blank rule, not a deviation.
3. ~~**The anchor rides inside `evidence` as nested blocks.**~~ **SUPERSEDED
   at Rung 8.3.** The context update registers the flat anchor terms
   (`network`, `policyId`, `asset`, `claimTxHash`) top-level, and the evidence
   entry now carries the plan's Decision-2 flat dialect ("no other field name
   is correct"). `policyId` **is** the course id; `asset` is the recipient's
   Access Token global-state asset (`gjames`) — Course V2 mints no
   per-credential native asset (the claim burns the course-state token and
   updates the recipient's global state), so the student-state asset is the
   honest fill for the plan's anchor field set. The nested
   `onChainAnchor`/`onChainAttestation` scoped terms remain defined in the
   context (it evolves additively only) but are no longer emitted.
4. **`proof` committed in array form** (1EdTech OB3 Plain-JSON schema
   requirement, rung-1 finding #2).
5. **Direct KMS access instead of SA impersonation.** Impersonating
   `credential-badges-sign-sa@andamio-credentials.iam.gserviceaccount.com` is
   denied for `james@andamio.io` (no `iam.serviceAccountTokenCreator`); direct
   `get-public-key` / `asymmetric-sign` succeed. Signing behavior is identical
   (same key version, same PureEdDSA semantics).
6. **Rung 8.3 pre-deploy transitional state (context ahead of live).** The
   committed `context/v0.jsonld` is an additive superset of the live one until
   the next deploy ships it. Signing/verifying locally therefore ran with
   `CONTEXT_AHEAD_OF_LIVE_OK=1`, which the document loader honors ONLY when
   the committed context differs from the live fetch by nothing but NEW
   top-level term keys inside `"@context"` — an added key INSIDE an existing
   term's definition changes how existing documents expand and refuses like
   any other divergence (review follow-up ADV-2 tightened this; the earlier
   check accepted additions at any depth). Without the env var the strict
   equality gate is unchanged. This is a PER-DEPLOY-WINDOW flag, not standing
   workflow: set it only between committing an additive context change and
   the deploy that publishes it, then drop it. Until the deploy, third
   parties expanding against the LIVE context cannot reproduce the signature —
   the 1EdTech `EmbeddedProofProbe` failure below is exactly that, expected
   until deploy. Likewise `checkStatus` reads the COMMITTED `status/` file
   (the exact bytes the deploy will serve) because the status URL is 404
   until deploy; the live re-check happens post-tag.

   What "additive" does and does not guarantee (review follow-up ADV-4): the
   context change is **expansion-invariant for all SIGNED artifacts** —
   mechanically verified by `expansion-pin.dep-test.ts` (CI job
   `expansion-pin`), which expands the committed `signed-credential.json` and
   `status/key-epoch-2026-07.json` under the committed context and pins the
   canonical RDF dataset hash, so no future context PR can silently change
   what the committed proofs were computed over. It is NOT expansion-invariant
   for the 58 v1.0 UNSIGNED badges: their embedded credentials gain one
   previously-dropped triple (`network`, now registered and picked up via the
   compact-IRI key path). Harmless — no proofs exist on them, so there is no
   signature to break.

## Ladder state

Rung 7 baked the signed VC into the **live badge SVG**
(`/badges/ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db.svg`,
re-baked at Rung 8.3 with the final-shape artifact — `tools/bake-signed-vc.ts`),
so the picture of the badge carries its own independently verifiable
credential. Rung 8.1 shipped the `/did.json` alias for the 1EdTech resolver
(PR #57); Rung 8.2 hardened this signer (PR #58); Rung 8.3 shipped the
context-v0 term update, the served key-epoch status list, and the final-shape
re-sign + re-bake. What remains on the ladder: productionizing the signer as
the issuer service, and `tools/flip-status-bit.ts` + the status-flip runbook.
