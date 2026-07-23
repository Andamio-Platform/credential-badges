---
title: Deterministic same-key re-sign with byte-identity acceptance gates
date: 2026-07-23
category: best-practices
module: signing-pipeline
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - "Re-signing an already-published credential without a vocabulary or key change"
  - "A context version bump requires re-signing artifacts against a new context URL"
  - "Verifying that the signing pipeline has not drifted since an artifact was produced"
tags: [kms, re-sign, eddsa-rdfc-2022, determinism, proofvalue, expansion-pin, signing]
---

# Deterministic same-key re-sign with byte-identity acceptance gates

## Context

The context v0→v1 remediation (#64/#65) required re-signing the flagship badge against a new context URL whose bytes were identical to the old one. Because `eddsa-rdfc-2022` signs the RDF canonicalization — and context URLs emit no canonical triples when the resolved bytes are unchanged — the correct outcome was fully predictable in advance: the new signature had to be byte-identical to the old one. That prediction became the acceptance gate, and it held.

This is distinct from the key-compromise runbook (`docs/runbooks/key-compromise.md`), which re-issues under a NEW key after a compromise. This doc is the **same-key** re-sign: nothing about the trust anchors changes; only a referenced URL (or other canonically-invisible detail) does.

## Guidance

Run the hardened path (`spike/signer-spike/sign.ts --signer kms`), which enforces: context cache cleared → live anchor gate (on-chain claim re-verified, SLT texts hash-checked) → live-DID key pin (KMS public key == published `did.json`) → **exactly one** KMS `asymmetric-sign` call → atomic artifact write. `proof.created` derives from the claim-tx block time, so it is stable across re-signs by construction — no timestamp choice to make.

Then enforce **hard acceptance gates** — predictions, not observations:

1. `proofValue` is **byte-identical** to the previous signature (Ed25519 is deterministic; same canonical N-Quads + same key + same created ⇒ same signature).
2. Expansion-pin dataset hashes (`spike/signer-spike/expansion-pin.dep-test.ts`) are **unchanged** — the pins are not updated; they *verify* the re-sign.
3. The artifact diff is **exactly the intended lines** (in #65: one `@context` URL line in `signed-credential.json` and the same line inside the baked SVG).
4. Re-bake with `tools/bake-signed-vc.ts` and confirm `extract` round-trips byte-identical to the signed artifact, committed **in the same commit** (the expansion-pin header rule).

Any deviation — a changed `proofValue`, a shifted pin, an extra diff line — is a **stop-the-line failure**, not a pin update: it means the pipeline (mapper, canonicalizer, dependency versions) drifted in a way that this procedure exists to detect. Diagnose before committing anything.

Preflight before signing (this repo's "verify the premise empirically" rule): confirm the live artifact, the committed artifact, and the embedded credential actually match each other and the incident narrative — the handoff doc for #64/#65 carried a wrong sha256 that a preflight caught.

## Why This Matters

Treating determinism as a *hope* ("proofValue will probably be unchanged") licenses accepting a changed signature, which masks exactly the pipeline-drift bug class the signing architecture is built to prevent. Treating it as a *gate* turns the re-sign into a self-verifying operation: the old signature is the strongest possible test oracle for the new one. It also caps KMS usage at one signing call per re-sign — no retry loops against a production key.

## When to Apply

- Context version bumps where the new version is a byte-copy (cache-migration bumps)
- Any re-sign where inputs to canonicalization are meant to be unchanged
- As a periodic drift check: `spike/signer-spike/resign-check.ts` re-signs the committed content and byte-compares, proving pipeline determinism with one KMS call
- NOT for key rotation or compromise — that is `docs/runbooks/key-compromise.md` (new key, new `verificationMethod`, status-list flip)

## Examples

The #65 flagship re-sign, verified end to end:

```text
old proofValue: z5hsxeJrVFpLaE4wFt5e2rM78xzg81...Fiaw
new proofValue: z5hsxeJrVFpLaE4wFt5e2rM78xzg81...Fiaw   # byte-identical ✓
artifact diff:  1 insertion, 1 deletion — the @context URL line only ✓
expansion pins: unchanged, dep-test green with no pin edits ✓
KMS calls:      1 ✓
```

## Related

- `docs/solutions/conventions/never-mutate-published-jsonld-context.md` — the incident class that motivates cache-migration re-signs
- `docs/runbooks/key-compromise.md` Phase 4 — the NEW-key counterpart; its re-sign mechanics should stay aligned with this doc rather than duplicating them
- `docs/plans/2026-07-23-001-fix-context-v1-bump-and-resign-plan.md` (R4 — the gates as plan requirements)
- PRs #59 (re-sign + re-bake precedent), #64, #65 (the verified execution)
