# How to verify an Andamio credential

An [Andamio](https://www.andamio.io) credential is an [Open Badge](https://www.imsglobal.org/spec/ob/v3p0/), anchored on [Cardano](https://cardano.org). It records that a specific person completed a specific, evidenced process. The anchor on the public blockchain ledger makes it a credential and not just a certificate. This document is a portable copy of that on-chain record. The ledger holds the truth, not Andamio's server and not the picture of the badge, while the Open Badges document is a copy you can read and verify without any Cardano tooling.

> **Status.** The cryptographic signature described below ships with v1.1. Until it does, a credential's proof is its on-chain anchor plus the badge's [Proof-Ring](https://docs.andamio.io/docs/contract-verification) encoding. The verification model here is what a signed Andamio credential is built to support.

## What does Andamio's signature attest to?

Andamio signs a credential to attest that the on-chain record is real, and that this document faithfully reflects it. Andamio is the attestation host for a process it does not run. Andamio does not vouch for the substance of the achievement, and it does not claim to be the authority that granted it.

For example, if a course owner later turns out to be dishonest, Andamio's signature would still attest that the on-chain mint happened. It does not vouch for the "meaning" of the credential. That belongs to the parties who ran the process, not to Andamio.

## Who vouches for the achievement?

The owner of a Course is responsible for vouching for a credential.

Every Andamio course has a unique on-chain identifier, its **[course id](https://docs.andamio.io/docs/credential-badges)**. A course id is the on-chain minting policy of the course, created on Cardano when a credential issuer creates a course. It is the first half of a credential's on-chain identity. A credential is identified by its course id together with the specific credential it attests to, defined by its `slt_hash`. The badge keys off exactly that pair, `<course_id>.<slt_hash>`.

A course id is not anonymous. It traces back to the pseudonymous issuer who created the course and who stands behind what its credentials mean. Anyone can look a course id up and see who issued it.

Andamio does not decide what a credential is worth, and it does not gatekeep who is allowed to issue one. Anyone can create a course, which mints a course id, which makes them an issuer whose credentials trace back to them on-chain. The meaning is set by the issuers, in the open, and the course id points to who they are. Andamio anchors those credentials and makes them portable and checkable by anyone.

## Who creates the credential?

Four parties produce an Andamio credential. Each carries a different part of the trust.

- **An Issuer:** The person who creates the course and holds its [Access Token](https://docs.andamio.io/docs/glossary). Shown as a verifiable pseudonym.
- **An Assessor:** The teacher who evaluates the work, where the on-chain record names one. Shown as a verifiable pseudonym.
- **A blockchain:** Cardano, the immutable record of what happened and when.
- **Andamio.** The protocol that anchors the credential on-chain, and the signer of this portable copy.

Responsibility for whether an assessment is correct sits with the assessor, recorded on-chain. Andamio's part is the anchor and the signature over it.

## What can an employer or verifier rely on?

If this credential verifies, you can rely on a clear, narrow set of facts:
1. A real person holds this credential.
2. They completed a process that was recorded on Cardano at a specific time, where the record names an assessor, a specific (pseudonymous) person evaluated the work.
3. The credential is portable, and it stays verifiable for as long as the holder holds it.

What you should not assume: Andamio is not asserting that the course was rigorous or that the achievement is significant. Andamio is asserting that the on-chain process completed and that this document matches it. The rigor is the course owner's and the assessor's to stand behind.

## Where can a credential be checked?

There are two independent places to check an Andamio credential.

The **blockchain** is authoritative. The on-chain record answers whether a person holds a credential, and nothing else overrides it.

The **[status list](https://www.w3.org/TR/vc-bitstring-status-list/)** is a convenience signal, not a revocation list. It flags signing-key freshness. Each credential's `credentialStatus` entry points to the hosted list at [`credentials.andamio.io/status/key-epoch-2026-07.json`](https://credentials.andamio.io/status/key-epoch-2026-07.json), a signed `BitstringStatusListCredential` with `statusPurpose: "suspension"`. One bit represents one signing key version, not one credential: a credential's `statusListIndex` is the bit position of the key version that signed it (`0` for `#key-2026-07`). If a signing key were ever compromised, that one bit would flip, and every credential signed with that key version would be flagged at once, so a verifier can treat them with caution until they re-check the chain. A set flag is a key-version issue. It is not a statement that a recipient did not earn their credential.

**Durability.** The blockchain, the issuer's DID document, and the status list each live independently. A recipient can verify a credential they received even if Andamio's own services are offline for a week. Nothing about verification depends on Andamio staying online.

**Indexer lag.** The on-chain read is mediated by an indexer. A very recently issued credential can take a short time to appear. When in doubt, the chain is the source of truth, and you can read it directly.

## How does a developer verify a credential?

1. **Read the credential.** It is an Open Badges 3.0 / [W3C Verifiable Credential 2.0](https://www.w3.org/TR/vc-data-model-2.0/) JSON-LD document. The `issuer.id` is `did:web:credentials.andamio.io`. The `credentialSubject.id` is the recipient. The `evidence` entry, typed `["OnChainCredentialAnchor", "Evidence"]`, carries the anchor: `network`, `policyId`, `asset`, and `claimTxHash`. The `policyId` is the course id. The `asset` is the recipient's Access Token global-state asset, the on-chain object the claim transaction writes the credential into. The anchor binds the attestation into the recipient's Access Token global state on Cardano, governed by Andamio's deployed protocol validators. A top-level `courseOwner` field names the course owner by the same pseudonymous derivation, and an `assessor` field names the assessor where the on-chain record yields one (it is omitted otherwise, never blank).
2. **Resolve the issuer and check the signature.** `did:web:credentials.andamio.io` resolves to [`https://credentials.andamio.io/.well-known/did.json`](https://credentials.andamio.io/.well-known/did.json), which publishes the signing key. Verify the Data Integrity proof ([`eddsa-rdfc-2022`](https://www.w3.org/TR/vc-di-eddsa/)) against that key. Use a Data-Integrity-capable verifier such as [spruce](https://github.com/spruceid/ssi) or the [1EdTech validator](https://github.com/1EdTech/digital-credentials-public-validator). Verifiers that read only JWS-style credentials will not read this proof format.
3. **Chase the anchor.** Take `policyId` and `claimTxHash` from the `evidence` and look them up on a public Cardano explorer, or on [andamioscan.io](https://andamioscan.io). Confirm the mint exists and matches the credential. Because the `policyId` is the course id, it also tells you which course, and which owner, issued the credential. This step needs no trust in Andamio at all.
4. **Check status, if you want to.** The `credentialStatus` entry, typed `BitstringStatusListEntry` with `statusPurpose: "suspension"`, points to the hosted status list. Fetch `statusListCredential`, gunzip the multibase-decoded `encodedList`, and read the bit at `statusListIndex`. A set bit flags the signing key version, per the two-layer model above; the chain remains authoritative for whether the credential was earned.

## Why is the proof dated to the on-chain claim time?

The `proof.created` timestamp is a stated convention, not a wall-clock reading. Andamio dates each proof to the block time of the on-chain claim transaction, the same instant recorded in `validFrom`. That block time is derived deterministically from the transaction's slot on Cardano, so it is a fact of the ledger, not of Andamio's server.

The convention buys byte-stability. Signing is deterministic end to end: the same on-chain record always produces the same bytes, and re-signing an unchanged credential reproduces the identical document, signature included. Anyone can regenerate a credential from the chain and compare it byte for byte against a copy they were handed.

Two consequences for verifiers:

- `proof.created` states when the credential was earned on-chain, not when Andamio's key produced the signature. The signing happened at or after that time.
- `proof.created` can predate the signing key's publication in the DID document. That is expected under this convention and is not a sign of tampering. Key validity is checked against the DID document and the status list, not against `proof.created`.

## What does a verification result mean?

- **Anchored, signature valid.** Verified. The on-chain record exists and the signature checks out against the published key.
- **Anchored, signature unavailable.** The on-chain record exists, but the signature could not be checked here (for example, an older credential, or a verifier that cannot read the proof format). The chain still backs it.
- **Not found.** No matching on-chain record. Treat the credential as unverified.
- **Suspended.** The signing key version is flagged. This is a key-freshness issue, not a statement about whether the credential was earned. The chain remains authoritative.
- **Indeterminate.** Verification could not complete. Retry, or read the chain directly.

## What does a real credential look like?

Take an Andamio credential for the "Andamio Issuer" course, held by the alias `james`.

- Its badge renders at [`credentials.andamio.io/badges/ae192632….e9b5343186f8….svg`](https://credentials.andamio.io/badges/ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db.svg).
- Its anchor is on **mainnet**, under course id `ae192632…`, minted in claim transaction `7cb75099…` on 2026-06-17.
- That course id is the "Andamio Issuer" course, and it traces back to its owner, the alias `james`, who created the course and stands behind what the credential means. Andamio did not decide the credential's meaning. It anchored and signed it.
- You can confirm that mint yourself on any Cardano explorer using the course id and the transaction hash. You do not have to take Andamio's word for it.
- `did:web:credentials.andamio.io` publishes the key that signs the portable copy, so a standard verifier can check the signature independently.

The chain proves the credential. Andamio's signature makes that record portable and checkable anywhere, and it attests the anchor, not the achievement.

