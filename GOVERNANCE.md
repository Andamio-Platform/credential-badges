# Governance

This document describes how the credential-badges project makes decisions,
who can make them, and how that changes as the project moves from a
single-company repository toward neutral, multi-organization governance
(the intended path is incubation at
[LF Decentralized Trust](https://www.lfdecentralizedtrust.org/)).

It is deliberately small. Where this file is silent, the project follows
ordinary open-source practice: discuss in public, prefer consensus, and write
the decision down.

> **Status: transitional.** Until the project is accepted by a neutral host,
> Andamio Platform remains the steward of this repository and of the
> `credentials.andamio.io` deployment. The rules below are the ones the project
> intends to operate under after contribution, and they apply now wherever
> they do not conflict with that stewardship. Items marked **TODO** need a
> decision from the current maintainers before an incubation proposal is filed.

## Two things this project is not

1. **The project is not the Andamio product.** Learning workflows, courses,
   assessments, and community features belong to Andamio. This project is the
   reusable layer underneath them: credential serialization, signing, DID and
   status handling, verifier compatibility, evidence adapters, and the
   badge / embed / share presentation surfaces.
2. **The project is not a deployment.** `credentials.andamio.io` is Andamio's
   production deployment of this code, operated by Andamio under Andamio's own
   keys, cloud accounts, and private runbooks (`andamio-ops`). The project
   governs the code, specifications, and published vocabulary; each adopter
   governs its own deployment, issuer identity, and signing keys.

## Roles

| Role | Who | Can |
|---|---|---|
| **Contributor** | Anyone who opens an issue, PR, or discussion. | Propose changes. Review and comment on anything. |
| **Reviewer** | Contributors listed in [`.github/CODEOWNERS`](.github/CODEOWNERS) for a path. | Approve changes to the paths they own. |
| **Maintainer** | People listed in [`MAINTAINERS.md`](MAINTAINERS.md). | Merge PRs, cut releases, triage security reports, and vote on project decisions. |

Maintainers are individuals, not companies. A maintainer who changes employer
stays a maintainer.

## How decisions are made

**Lazy consensus by default.** Most changes are decided in the PR that makes
them: a PR may merge once it has the approvals its paths require (below), CI is
green, and no maintainer has an unresolved objection.

**Trust-critical paths need two reviewers.** Changes to anything CODEOWNERS
marks as trust-critical (the published DID document, JSON-LD contexts, the
issuer profile, the status list and kill-switch tooling, the signing entry
points, the served-file allowlist, and the alias safety gate) need approval
from two maintainers. Once the project has maintainers from more than one
organization, those two approvals must come from **different organizations**.

**Decisions that need a recorded vote.** The following are decided by a vote
of the maintainers, open for at least 7 days, and recorded as a decision record
under [`docs/decisions/`](docs/decisions/README.md):

- adding or removing a maintainer;
- changes to this file;
- a new published vocabulary version (`context/vN.jsonld`) or any change to
  the evidence-adapter interface contract;
- adopting, removing, or relicensing a dependency that changes the project's
  license posture;
- moving the project to, or out of, a foundation.

A vote passes with a simple majority of all maintainers. If the maintainers
come from more than one organization, no single organization's maintainers may
cast more than half of the votes counted. Their votes are scaled down to that
cap.

**Architecture decisions** (a new adapter interface, a change to the signing
pipeline's guarantees, a new served path) are written up as a short decision
record before or alongside the PR. See [`docs/decisions/`](docs/decisions/README.md).

## Becoming a maintainer

A contributor becomes a maintainer by nomination from an existing maintainer
and a vote (above). The usual signal is sustained, high-quality contribution
and review over several months. Organizational diversity among maintainers is
an explicit goal: when two candidates are otherwise comparable, prefer the one
who adds a new organization.

Maintainers who are inactive for six months may be moved to *emeritus* status
by a vote, or step down at any time by opening a PR against
[`MAINTAINERS.md`](MAINTAINERS.md).

## Releases

Releases are cut by a maintainer by pushing a version tag, as described in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`DEPLOY.md`](DEPLOY.md). A tag is the
record of what shipped. Releases that touch signed or published artifacts follow
the integrity invariants in [`CONCEPTS.md`](CONCEPTS.md): version freeze,
validation gate, anchor gate, and deterministic re-sign.

The deploy workflows in this repository deploy **Andamio's** instance. After
contribution, the project will publish versioned source releases and packages;
adopters deploy them. See the decision records for how that separation lands.

## Andamio's role after contribution

Andamio built the first implementation and remains its first production
adopter. After contribution, Andamio intends to:

- stay a **reference implementation and early maintainer**, with the same
  rights as any other maintainer and no veto;
- keep owning its product, its deployment at `credentials.andamio.io`, its
  issuer DID (`did:web:credentials.andamio.io`), and its signing keys;
- keep the Andamio/Cardano evidence adapter maintained in this repository as
  the reference adapter;
- transfer any project-level name or mark to the host foundation as the
  foundation requires. **TODO:** choose a neutral project name (the current
  repository name is generic; the `@andamio/andamio-badge` package and the
  `andamio` vocabulary are not).

## Conduct, security, and licensing

- Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).
- All code is licensed under [Apache 2.0](LICENSE). Contributions are accepted
  under the Developer Certificate of Origin (see
  [`CONTRIBUTING.md`](CONTRIBUTING.md#developer-certificate-of-origin-dco)).

## Changing this document

By maintainer vote, recorded as a decision record. If the project is accepted
into a foundation, the foundation's charter and its technical advisory
council's policies take precedence over anything here that conflicts with them.
