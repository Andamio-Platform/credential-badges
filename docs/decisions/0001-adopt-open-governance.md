# 0001. Adopt open governance in preparation for foundation incubation

- **Status:** Proposed
- **Date:** 2026-11-04
- **Deciders:** TODO (current maintainers)
- **Vote:** TODO

## Context

credential-badges began as Andamio's badge and credential repository. It now
holds working, standards-based credential infrastructure: Open Badges 3.0 / W3C
Verifiable Credentials, `did:web` issuer identity, Data Integrity signing,
key-epoch status lists, anchor-gated issuance, external verifier validation,
and portable presentation (SVG, share pages, web component). Very little of
that is specific to Andamio's learning product.

The project intends to propose incubation at LF Decentralized Trust as a
ledger-neutral credential interoperability layer, with Andamio/Cardano as the
first reference implementation. LFDT's incubation entry considerations ask for
a public roadmap, multiple maintainers (ideally from different
organizations), community practices, more than one sponsor, Apache 2.0
licensing, and DCO sign-off.

The repository already had a license, a code of conduct, contribution notes,
CODEOWNERS gates, and a roadmap. It had no written governance, maintainer
list, security policy, adopter list, decision log, or DCO requirement.

## Decision

Add `GOVERNANCE.md`, `MAINTAINERS.md`, `SECURITY.md`, `ADOPTERS.md`, and this
decision-record directory. Require DCO sign-off on new commits. Separate the
**project** (code, specifications, vocabulary) from **deployments** (Andamio's
`credentials.andamio.io` and any future adopter's), and state Andamio's role
after contribution: reference implementation, first adopter, early maintainer,
no veto.

## Options considered

- **Wait until a foundation accepts the project, then adopt its templates.**
  Rejected. The TAC evaluates governance readiness at entry, so the documents
  need to exist and be in use beforehand.
- **Copy a foundation's full governance template.** Rejected for now. Most of
  it addresses multi-project and multi-company situations that do not exist
  yet. The small version here can grow by recorded vote.

## Consequences

- Trust-critical changes need two maintainer approvals, from different
  organizations once that is possible.
- Several facts are left as explicit **TODO** markers (maintainer names and
  affiliations, the security alias, the neutral project name). They must be
  resolved before a proposal is filed. They are visible rather than guessed.
- Commits need `Signed-off-by` lines. A DCO check should be enabled on the
  repository (the DCO GitHub App or an equivalent).
