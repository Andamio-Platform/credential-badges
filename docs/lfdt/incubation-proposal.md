# LF Decentralized Trust incubation proposal (draft)

> **Working draft, not submitted.** This file follows the section structure of
> the LFDT proposal template
> (`proposals/0000-template.md` in
> [LF-Decentralized-Trust/project-proposals](https://github.com/LF-Decentralized-Trust/project-proposals)).
> When it is ready, it is copied into a pull request against that repository.
> Before that, LFDT recommends socializing it with the TAC and with adjacent
> project communities. Every **TODO** must be resolved first. The readiness
> checklist is in [`ROADMAP.md`](../../ROADMAP.md).
>
> Working name: **credential-badges** (**TODO:** neutral project name, cleared
> with LFDT marketing).

# Sponsor(s)

**TODO.** LFDT expects more than one sponsor, from different organizations.
Sponsors advocate for the project with the TAC. They do not have to commit
resources.

| Name | Organization | Contact |
|---|---|---|
| TODO | TODO | TODO |
| TODO | TODO | TODO |

# Abstract

A ledger-neutral evidence-adapter framework that turns verified assertions from
decentralized trust systems into standards-based, portable credentials (Open
Badges 3.0 / W3C Verifiable Credentials) that people, applications, wallets, and
employers can verify without learning the source system. It includes a
production reference implementation on Cardano.

# Context

The project comes from Andamio's credential-badges repository, which issues
signed Open Badges 3.0 credentials for on-chain course credentials on Cardano
mainnet. The repository has been public under Apache 2.0 since May 2026, and
v1.0 shipped on 2026-06-29. It already contains:

- OB 3.0 / W3C VC Data Model 2.0 credentials, signed with Data Integrity
  `eddsa-rdfc-2022` under a `did:web` issuer, with keys held in a cloud KMS;
- **anchor-gated issuance**, which signs nothing unless a live check against
  the ledger confirms the claim, the subject, and a content hash;
- a key-epoch `BitstringStatusList` for suspension (the key-compromise
  kill switch);
- external verifier evidence: the 1EdTech reference validator (VALID 13/13 on
  all 58 class artifacts), spruce, and loopback verification of every served
  credential;
- deterministic, versioned, sha256-pinned published artifacts with CI-enforced
  freeze and expansion-pin invariants;
- portable presentation: self-verifying SVG badges, share pages, a holder
  viewer, and a web component published to npm.

It is related to, and intended to complement, the identity, credential, and
ledger projects already in the LFDT portfolio (see *Dependent Projects* and
*Motivation*).

# Dependent Projects

None. The project does not depend on any LFDT project's code.

It is **adjacent** to the following. We will discuss scope with each project's
maintainers before submission, to confirm that this layer belongs outside
their projects:

| Project | Relationship | How we position this project |
|---|---|---|
| Hyperledger Identus, CREDEBL | Overlap if this were framed as issuance, VC management, or an identity platform. | Not an identity stack. An attestation-translation and portable-presentation layer that can feed or sit beside them. |
| AnonCreds, Trust over IP | Adjacent on credential architecture, privacy, and trust frameworks. | A concrete implementation component, not a competing standard. A future adapter or output format could target AnonCreds. |
| Hyperledger Cacti and LFDT ledgers (Besu, Fabric, and others) | Lower-layer interoperability and the trust sources themselves. | One level above them: an evidence adapter makes their assertions portable as credentials. |

> *Guardrail:* we do not replace identity stacks. We make decentralized
> assertions usable outside their source system.

# Motivation

Ledgers and decentralized protocols are good at proving that something
happened. That proof rarely travels. A completion recorded on a chain, a vote
in a governance protocol, or an approval in a permissioned workflow is
verifiable only by someone who understands that system, runs its tooling, and
trusts its indexers. The people the proof is about (learners, contributors,
members) cannot easily take it to an employer, a wallet, or another
community.

Credential standards solve the receiving side: Open Badges 3.0 and W3C
Verifiable Credentials are accepted by a growing ecosystem of wallets,
validators, and display surfaces. What is missing is a reusable, rigorous
**bridge**: a common pattern, with working code, for turning a trusted event in
a source system into a standards-compliant credential **without weakening the
link back to the source**.

Most implementations of this bridge are bespoke and quietly unsafe in the same
ways: they sign from local state rather than from re-verified source state, use
wall-clock timestamps that break deterministic re-issuance, edit published
JSON-LD contexts in place, or claim more verifiability than the artifact
supports. This project's reference implementation encodes the fixes as
CI-enforced invariants (anchor gate, validation gate, version freeze,
expansion pin, wording gate), and that rigor is what we would bring to LFDT.

The frontier is not issuance. The frontier is **portability**.

# Status

Proposed for **Incubation**. See the
[project lifecycle](https://lf-decentralized-trust.github.io/governance/governing-documents/project-lifecycle).

# Solution

**Architecture.** Five layers:

```
Trust source ─▶ Evidence adapter ─▶ Credential core ─▶ Presentation ─▶ Verifier
(ledger,        (verifies at the     (OB 3.0 / VC,       (badge, share,    (independent
 protocol,       source, fails        DID, Data           embed, wallet,    validators)
 workflow)       closed, normalizes)  Integrity, status)  API)
```

- **Evidence adapter**, one per trust source. It verifies the claim at the
  source and fails closed, re-derives every signed field rather than trusting
  request input, derives times deterministically from the source, keeps
  subjects pseudonymous, and defines any source-specific vocabulary in a
  versioned, frozen JSON-LD context.
- **Credential core**: assembles the OB 3.0 credential, signs it with Data
  Integrity, attaches status, loopback-verifies it before release, and
  enforces artifact freeze and expansion pins.
- **Presentation**: deterministic, self-verifying badge imagery, share and
  holder pages, an embeddable web component.
- **Deployments** belong to adopters. Each one holds its own issuer DID,
  keys, and registry.

**Reference implementation.** Cardano → Andamio Course V2 adapter → OB 3.0 /
VC → badge, share page, API → 1EdTech, spruce, and loopback verification. In
production on Cardano mainnet.

**Second adapter.** A deliberately simple non-ledger adapter (Ed25519-signed
attestations from a registered source) shows that the credential surface does
not change when the source does. **TODO:** a second **ledger** adapter, for
example for an LFDT ledger, ideally contributed by a second organization.

**Transactions and identity.** No new transaction types. Issuers are
identified by `did:web`. Subjects are pseudonymous identifiers derived from
source state, never names or e-mail addresses. Signatures use Data Integrity
`eddsa-rdfc-2022`. Status uses `BitstringStatusList`.

**Effects on clients and networks.** None on source networks: adapters only
read from them. Clients receive standard OB 3.0 / VC documents and need no
source-specific software.

**Backward compatibility.** Published JSON-LD contexts are never edited, and
credentials already in the wild keep verifying. Extraction into the neutral
core is guarded by a CI equivalence test, so signed output for existing
credentials does not change.

**Testing and traceability.** Hermetic CI suites cover the anchor gate (on
recorded ledger fixtures), signing hardening, context freeze, DID key pin,
CODEOWNERS liveness, documentation links, render parity, and adapter
acceptance and refusal. A post-deploy live verifier checks the deployed
artifacts. Every KMS signing run is transcribed in the repository.

**License.** Apache License 2.0 for all project code. **TODO:** audit
third-party dependency licenses (npm and Python) and embedded font licenses
before submission.

**Trademarks.** "Andamio" is Andamio Platform's product name and is not part
of the proposed project name. The npm package `@andamio/andamio-badge` and the
`urn:andamio:` vocabulary belong to the reference adapter and deployment.
**TODO:** neutral project and package names.

# Effort and Resources

**TODO**, to be confirmed with the maintainers and sponsors.

- Maintainers: listed in `MAINTAINERS.md`. Today all are from Andamio.
  **Required before submission:** at least one maintainer from another
  organization.
- Andamio commits to remaining the reference implementation and an early
  maintainer, and to maintaining the Cardano adapter.
- Infrastructure: CI on GitHub Actions. Andamio continues to operate its own
  deployment. The project needs no LFDT-hosted infrastructure to start.
- Indicative timeline for Incubation:
  - **Quarter 1:** neutral core and adapter path in production at Andamio with
    unchanged signed output; neutral names; DCO enforced.
  - **Quarter 2:** a second ledger adapter from an outside contributor;
    per-organization issuer DIDs; signature-bearing verifier states.
  - **Quarter 3:** a second production adopter; a published adapter
    conformance kit.

# How To

```bash
git clone https://github.com/Andamio-Platform/credential-badges
cd credential-badges
make verify                                              # decode a badge's rings and check them against on-chain hashes
node --experimental-strip-types --test tools/*.test.ts   # hermetic invariants, no install
(cd issuer-service && npm ci && npm test)                # full issuance path: gate, map, sign, loopback verify
```

Live: any badge resolves at
`https://credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg`. The
embedded signed credential can be extracted and verified with any Data
Integrity verifier, and
[`how-to-check`](https://credentials.andamio.io/badges/how-to-check) walks
through doing that without trusting Andamio.

# References

- Repository: <https://github.com/Andamio-Platform/credential-badges>
- 1EdTech, *Open Badges Specification v3.0*. <https://www.imsglobal.org/spec/ob/v3p0/>
- W3C, *Verifiable Credentials Data Model v2.0*. <https://www.w3.org/TR/vc-data-model-2.0/>
- W3C, *Verifiable Credential Data Integrity 1.0* and *EdDSA Cryptosuites v1.0*. <https://www.w3.org/TR/vc-di-eddsa/>
- W3C, *Bitstring Status List v1.0*. <https://www.w3.org/TR/vc-bitstring-status-list/>
- LF Decentralized Trust, *Project Incubation Entry Considerations*. <https://lf-decentralized-trust.github.io/governance/guidelines/project-incubation-entry-considerations>

# Closure

The project succeeds when:

1. **At least three evidence adapters** for distinct trust sources are in the
   repository, at least two of them ledgers and at least one contributed by an
   organization other than Andamio.
2. **At least two independent production deployments** (issuer DIDs from
   different organizations) issue through the shared core.
3. Credentials from every adapter **pass the external reference validator**
   with zero errors and zero warnings, and verify in at least two independent
   verifiers.
4. **Maintainers come from at least three organizations**, and no
   organization holds a majority.
5. The project meets the LFDT criteria for exiting Incubation.
