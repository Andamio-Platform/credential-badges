# Security Policy

This project produces **signed, publicly served, permanent artifacts**: a
credential in the wild references its JSON-LD context, its issuer DID, and its
status list by URL for life. A security problem here can make valid credentials
fail verification or make invalid ones pass. Please report it privately.

## Reporting a vulnerability

**Do not open a public issue, PR, or discussion for a suspected vulnerability.**

Report it privately by one of these routes:

1. **GitHub private vulnerability reporting** (preferred): on this repository,
   open the **Security** tab and choose **Report a vulnerability**.
   **TODO (maintainers):** enable *Private vulnerability reporting* under
   Settings → Code security.
2. **Email:** `dev@andamio.io`, with `SECURITY` in the subject line.
   **TODO (maintainers):** replace with a dedicated security alias that reaches
   every maintainer and does not depend on one company's inbox.

Please include what you found, where it is (file, URL, or credential), how to
reproduce it, and what you think the impact is. A minimal proof of concept
helps. Do not include real holders' personal data.

## What to expect

| Step | Target |
|---|---|
| Acknowledge receipt | within 3 business days |
| Initial assessment and severity | within 10 business days |
| Fix or mitigation plan | communicated with the assessment |
| Public disclosure | coordinated with the reporter, normally after a fix ships, and no later than 90 days after the report unless both sides agree otherwise |

Reporters are credited in the advisory unless they ask not to be.

## Scope

**In scope (the project):**

- Signing and verification code: `signing/`, `issuer-service/`, and any
  evidence adapter in this repository.
- The anchor gate and its inputs: anything that could get a credential signed
  without a matching on-chain or source-system claim.
- Published trust artifacts and their generators: `context/`, `issuer/`,
  `.well-known/did.json`, `status/`, `tools/gen-did-json.ts`,
  `tools/flip-status-bit.ts`.
- Output safety: injection into generated SVG, HTML, or OG images, including
  through on-chain data such as aliases (see `scripts/alias_gate.py`).
- The served-file allowlist and the nginx configuration.
- The `@andamio/andamio-badge` web component.

**Deployment issues (report the same way; routed to the operator):**
problems that exist only in a specific deployment, for example
`credentials.andamio.io` (its cloud configuration, KMS keys, or service
accounts). The project forwards these to that deployment's operator. Andamio
operates `credentials.andamio.io`.

**Out of scope:** the underlying ledgers, third-party verifiers and wallets
(report to their maintainers; we are glad to help coordinate), and findings
that need a compromised maintainer account or signing key with no project-side
weakness.

## Supported versions

Security fixes land on `main` and ship in the next tagged release. Published
JSON-LD context versions are **never edited in place**, including for security
fixes. A fix to vocabulary ships as a new version (see
[`docs/solutions/conventions/never-mutate-published-jsonld-context.md`](docs/solutions/conventions/never-mutate-published-jsonld-context.md)).

## Key compromise

If a signing key may be compromised, the response is a suspension flip on the
key-epoch status list (`status/`), which suspends every credential signed under
that key version. The tooling is `tools/flip-status-bit.ts`. It prepares the
flip and never signs, and changes to it are CODEOWNERS-gated. The operational
runbook for Andamio's deployment lives in Andamio's private operations
repository. Other adopters need their own.

## Hardening practices already in place

- Signing is **anchor-gated**: nothing is signed unless a live check against
  the source of truth passes first.
- Every signed credential is **loopback-verified** before it is served.
- The issuer service **refuses to boot** on drift between its bundled and the
  publicly served trust artifacts.
- Published contexts are **sha256-pinned** and byte-frozen. Signed artifacts'
  canonical forms are **expansion-pinned** in CI.
- GitHub Actions are pinned by commit SHA and updated by Dependabot.
- Trust-critical paths require review from named code owners.
