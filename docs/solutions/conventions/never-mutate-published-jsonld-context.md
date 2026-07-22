---
title: "Never mutate a published JSON-LD context, bump the version URL instead"
date: 2026-07-22
category: conventions
module: context-hosting
problem_type: convention
component: tooling
severity: medium
applies_when:
  - "Adding, renaming, or removing terms in a context served under /context/"
  - "Any change to a published artifact that signed credentials reference by URL"
symptoms:
  - "1EdTech verifybadge.org EmbeddedProofProbe fails (12/13) on a correctly signed badge"
  - "Verifier's canonicalized N-Quads silently drop custom terms (courseOwner, OnChainCredentialAnchor fields)"
resolution_type: workflow_improvement
tags: [jsonld, context, caching, immutable, verifier, ob3, data-integrity]
---

# Never mutate a published JSON-LD context, bump the version URL instead

## Context

On 2026-07-21 the published context at `https://credentials.andamio.io/context/v0.jsonld` was upgraded in place: new terms (`courseOwner`, the `OnChainCredentialAnchor` evidence fields) were added under the same URL. The context is served with `Cache-Control: public, max-age=86400, immutable`.

The next morning, 1EdTech's verifybadge.org validator failed `EmbeddedProofProbe` (12/13) on a correctly signed badge. Its report showed why: the validator canonicalized the credential against its cached pre-upgrade copy of the context, so the terms that copy didn't define were silently dropped from the N-Quads. The canonical hash no longer matched the signature, which was computed over the complete document. SpruceID's `ssi` (live context resolution) verified the same credential clean, confirming the signature itself was fine. The failure self-healed once the validator's cache expired.

## Guidance

A published, versioned context URL is immutable forever. To change the vocabulary:

1. Publish the new context at the next version URL (`/context/v1.jsonld`).
2. Reference the new URL in the `@context` array of credentials signed from that point on.
3. Keep every previously published version serving byte-identical content indefinitely, since existing signed credentials reference it by URL and re-canonicalize against it at every verification.

`max-age=86400, immutable` on `/context/*` is correct and should stay. It is the mutation that was wrong, not the caching.

## Why This Matters

Data Integrity proofs (`eddsa-rdfc-2022`) sign the RDF canonicalization of the document, and canonicalization depends on the context content, not just its URL. Any verifier holding a different copy of the context computes a different hash, so an in-place edit makes valid signatures unverifiable (or, worse, could make tampered documents canonicalize identically). JSON-LD makes this failure silent: undefined terms are dropped without error. `immutable` explicitly licenses every cache to keep the old copy without revalidating, so an in-place change guarantees a window (24h here, unbounded for app-level document caches) where third-party verifiers fail on valid credentials.

## When to Apply

- Any edit to a file under `/context/` that is already live
- Any other URL-referenced signed-artifact surface with the same property, e.g. `/status/*` list URLs referenced from `credentialStatus`
- Reviewing PRs that touch context or nginx cache headers: an in-place context content change is a blocker, a new version file is the fix

## Examples

Wrong: editing `/context/v0.jsonld` to add `courseOwner`.

Right: publish `/context/v1.jsonld` containing the full vocabulary, and sign new credentials with:

```json
"@context": [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://credentials.andamio.io/context/v1.jsonld"
]
```

Credentials already signed against `v0` keep verifying because `v0.jsonld` never changes again.

## Related

- verifybadge.org report 44c287d8 (2026-07-22): the failing probe's `canonicalizedJsonLdObjectWithoutProof` is missing the post-upgrade terms, the direct evidence for this rule
- `spike/verifier-spike/verifiers/spruce/run.sh`: independent verification path used to isolate the failure to the verifier's cache
- `docs/verifier-guidance.md`: verifier-facing framing of the credential
