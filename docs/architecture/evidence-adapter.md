# The evidence-adapter contract

An **evidence adapter** connects one trust source to the credential core. It
is the only source-specific piece of the issuance path. Everything after it
(credential assembly, signing, status, presentation, verification) is shared.

This document is the contract. It is normative for any adapter in this
repository. Changing it requires a decision record and a maintainer vote (see `GOVERNANCE.md`, proposed alongside this document).

The key words MUST, MUST NOT, SHOULD, and MAY are used as in RFC 2119.

## Shape

```ts
/** One adapter per trust source (a ledger and protocol, a workflow engine, an enterprise system). */
export interface EvidenceAdapter<Request> {
  /** Stable, unique identifier, e.g. "cardano-andamio-course-v2". Never reused. */
  readonly id: string;

  /** Coarse class of trust source: "ledger" | "workflow" | "enterprise" | "attestation" | … */
  readonly sourceKind: string;

  /**
   * Verify the request against the trust source and return a normalized assertion.
   * MUST fail closed: throw AdapterRefusal when the source does not support the claim,
   * and a different error when the source cannot be reached. MUST NOT return a partial
   * assertion.
   */
  resolve(request: Request): Promise<TrustAssertion>;
}

/** What the source verifiably says, normalized for the credential core. */
export interface TrustAssertion {
  /** Stable credential identifier (URI). Deterministic for the same (claim, subject). */
  credentialId: string;
  /** ISO 8601 UTC, derived from the source (e.g. block time), never from the wall clock. */
  validFrom: string;
  name: string;
  description: string;
  subject: {
    /** Pseudonymous identifier. MUST NOT be a human name or e-mail address. */
    id: string;
  };
  achievement: {
    id: string;
    name: string;
    description: string;
    criteria: { narrative: string };
  };
  /** At least one evidence item that points back to the authoritative claim. */
  evidence: EvidenceItem[];
  /** Extra JSON-LD contexts that define the adapter's evidence and extension terms. */
  contexts: string[];
  /** Top-level credential properties defined in the adapter's context (e.g. courseOwner). */
  extensions?: Record<string, unknown>;
  /** Not signed. Records how and when the claim was checked, for logs and transcripts. */
  provenance: {
    adapter: string;
    checkedAt: string;
    source: string;
    endpoints?: string[];
  };
}

export interface EvidenceItem {
  /** Dereferenceable URL or URI for the authoritative claim. */
  id: string;
  /** MUST include "Evidence". The adapter's own evidence type comes first. */
  type: string[];
  name: string;
  /** Source-specific, flat terms defined in the adapter's context (e.g. network, policyId). */
  [term: string]: unknown;
}

/** Thrown when the source does not support the claim. Never retried as if it were an outage. */
export class AdapterRefusal extends Error {}
```

The **credential core** turns a `TrustAssertion` and a deployment's
`IssuerProfile` (issuer DID and profile fields, base contexts, and a status-entry
factory) into an unsigned OB 3.0 `OpenBadgeCredential`, then signs and
loopback-verifies it as it does today. The core never imports an adapter, and
an adapter never sees a signing key.

## Rules

### Verification

1. **Fail closed.** `resolve()` returns only after every check passes. Anything
   less throws. This is the [Anchor Gate](../../CONCEPTS.md#anchor-gate),
   generalized.
2. **Re-derive, don't trust input.** Every field in the assertion that reaches
   the signer MUST be derived from the source, not copied from the request.
   The request names a coordinate. The adapter looks everything up.
3. **Bind content to the source's commitment.** If the source commits to
   content by hash (for example, the SLT hash on Cardano), the adapter MUST
   recompute the hash over the content it will put in the credential and
   compare it.
4. **Separate refusal from outage.** "The source says no" (`AdapterRefusal`)
   and "the source could not be asked" (any other error) are different
   outcomes and map to different HTTP statuses.

### Determinism

5. **Same claim, same assertion.** Two `resolve()` calls for the same
   coordinate against an unchanged source MUST produce deep-equal assertions,
   apart from `provenance`. This is what makes the
   [Deterministic Re-sign](../../CONCEPTS.md#deterministic-re-sign) invariant
   hold.
6. **No wall-clock times in signed fields.** `validFrom` comes from the source.

### Privacy

7. **Pseudonymous subjects.** `subject.id` is a pseudonymous identifier
   derived from the source (for example, an on-chain state asset). Human names,
   e-mail addresses, and similar identifiers MUST NOT appear in signed fields.
8. **Absent parties are omitted.** If the source does not record a party (for
   example, an assessor), leave it out. Never fill it with a placeholder.

### Vocabulary

9. **Every term defined.** Every property in `evidence` and `extensions` MUST
   be defined by one of the referenced contexts, so canonicalization drops
   nothing. CI checks this through expansion pins.
10. **Contexts are versioned and frozen.** An adapter's context is published at
    a version URL and never edited (see
    [`never-mutate-published-jsonld-context.md`](../solutions/conventions/never-mutate-published-jsonld-context.md)).

### Testing

11. **Hermetic tests.** Every adapter ships tests that run in CI with no
    network, using recorded fixtures for the source.
12. **Refusal tests.** Tests MUST cover at least one tampered or unknown
    claim and show `AdapterRefusal`.
13. **One artifact through the reference validator** before an adapter is used
    to sign a batch ([Validation Gate](../../CONCEPTS.md#validation-gate)).

## The reference adapter: Cardano / Andamio Course V2

| Contract field | Source today |
|---|---|
| `id` | `cardano-andamio-course-v2` |
| request | `{ network, courseId, sltHash, alias }` |
| `resolve()` | the existing anchor gate, `issuer-service/src/anchor.ts` `checkAnchor()` |
| `credentialId` | `urn:andamio:credential:{network}:{courseId}:{sltHash}:{studentStateAsset}` |
| `validFrom` | claim-transaction block time, derived from the slot |
| `subject.id` | `urn:andamio:{network}:recipient:{studentStateAsset}` |
| `evidence[0]` | `OnChainCredentialAnchor`: `network`, `policyId`, `asset`, `claimTxHash` |
| `contexts` | `https://credentials.andamio.io/context/v1.jsonld` |
| `extensions` | `courseOwner` |

Wrapping the existing gate this way must leave the signed output unchanged.
`core(adapter.fromAnchor(anchor))` must equal today's `mapCredential(anchor)`,
and that is enforced by a test.

## Writing a new adapter

1. Open an issue that describes the trust source, what "verified" means
   there, and how a claim is addressed.
2. Write a decision record if the adapter needs new vocabulary.
3. Implement `resolve()` with the rules above. Start with the refusal tests.
4. Publish any new context at a version URL, sha256-pinned.
5. Add a row to `ADOPTERS.md` (proposed alongside this document) if you run it in production
   or a pilot.
