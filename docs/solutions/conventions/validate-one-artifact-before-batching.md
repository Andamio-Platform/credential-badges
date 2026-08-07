---
title: "Validate one artifact before batching — a spec permission is not a validator verdict"
date: 2026-07-28
category: conventions
module: signing-pipeline
problem_type: convention
component: tooling
severity: high
applies_when:
  - "About to produce many signed artifacts in one batch"
  - "A shape decision rests on what a spec permits or recommends, not on a verifier run"
  - "The batch would be expensive to unwind — committed, published, or KMS-signed"
tags: [validation, conformance, ob3, signing, gate, verifier]
---

# Validate one artifact before batching — a spec permission is not a validator verdict

## Context

The class-artifact shape was designed *identityless*: `credentialSubject` with no `id`. That was not a guess. The OB 3.0 implementation guide **explicitly recommends** omitting `credentialSubject.id` for badges delivered by URL sharing and download, and the published JSON schema **permits** it outright — `AchievementSubject` requires only `type` and `achievement`. Both were checked directly against the spec before building.

The 1EdTech reference validator rejects it:

```
ERROR  "no id in credentialSubject"  — CredentialSubjectProbe
```

Twelve of thirteen probes passed. Issuer resolution, `did:web`, the Data Integrity proof, the key-epoch status list, the evidence shape — all fine. One probe failed, and it was the one the spec had said not to worry about.

58 badges were queued to sign. One was signed and validated first, so the cost of being wrong was **two KMS signatures** instead of 58 plus a full bake to unwind.

## Guidance

**Sign one, validate it, then batch.** Not a sample at the end — one artifact, before the rest exist.

**Treat "the spec permits this" as a hypothesis the gate tests, not a reason to skip the gate.** Reading the spec carefully is necessary and insufficient. Conformance has two independent authorities — the written standard and the implementation the ecosystem actually runs — and they can disagree. When they do, the running implementation wins, because it is what rejects your artifact in someone else's pipeline.

**Isolate the fix before spending more.** When the gate fails, change the *already-signed* artifact and re-validate before signing anything new. Here, injecting the candidate `credentialSubject.id` into the pass-1 artifact made the `CredentialSubjectProbe` error disappear and left only `EmbeddedProofProbe` failing — the expected consequence of mutating signed bytes. That isolated the subject id as the sole cause for zero additional signatures.

**Hold the bar at 0 errors *and* 0 warnings.** "No errors" is a weaker gate that lets shape drift accumulate.

The procedure lives in [`docs/runbooks/class-artifact-signing.md`](../../runbooks/class-artifact-signing.md) (Phase 3). Evidence for both passes, including the full validator responses, is committed at [`signing/validation/README.md`](../../../signing/validation/README.md).

## Why This Matters

The failure mode this prevents is not "we shipped something broken" — it is "we shipped 58 things broken, publicly, signed by a production key, and unwinding means re-signing all of them."

It also protects against the more insidious version: a batch that *validates* but was designed against a misread. The gate produces an external verdict on the actual bytes, which no amount of careful spec reading substitutes for.

This is the second time the running implementation of a standard has beaten its written contract in this repo. The first was [`never-mutate-published-jsonld-context.md`](never-mutate-published-jsonld-context.md), where the same validator's document cache ignored HTTP `max-age` and silently canonicalized against a stale context. Two cases make it a pattern rather than an anecdote: **verify against the implementation, not the document describing it.**

## When to Apply

- Any batch of signed or published artifacts where the shape is not yet externally confirmed.
- Any time the justification for a shape is "the spec says this is allowed" and no verifier has seen it.
- After a shape change to an artifact class that already passed — the previous verdict does not transfer.

Not needed when the shape is unchanged from an artifact that already holds an external verdict; that is what byte-stable re-signing is for (see [`deterministic-kms-resign.md`](../best-practices/deterministic-kms-resign.md), which applies the same predict-then-gate discipline at commit time rather than batch time).

## Examples

The resolved shape carries a subject id that is the **achievement's own URN** — the thing being defined, never a person:

```
credentialSubject:
  id: urn:andamio:course:<courseId>:<sltHash>   # the achievement, not a holder
  type: [AchievementSubject]
  achievement: { … }
```

Omitting the id would have meant, in the spec's own framing, *"an earner we cannot name"* — a claim about a person that a definition should not make. So the validator's requirement and the honest shape happened to agree, but that was luck, not design.

The invariant is now a regression guard rather than a memory — `signing/class-credential.test.ts` asserts the subject id exists and names the probe that requires it, so a future "simplify" cannot quietly restore the rejected shape.

**Related:** issue #89 (the holder/class split that produced this artifact), and KTD-1 in [`docs/plans/2026-07-28-004-feat-fully-baked-badges-plan.md`](../../plans/2026-07-28-004-feat-fully-baked-badges-plan.md), which records the decision, its refutation, and the re-validation.
