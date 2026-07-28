---
title: "design: PQ3 cross-issuer prereq scope vs the multi-issuer model (#7)"
status: designed-not-built
date: 2026-07-28
type: design
origin: "GitHub issue #7. ROADMAP Phase 4 / deployment plan Unit 6, requirement R6. Companion to 2026-07-28-001-design-per-org-issuer-dids.md."
depth: deep
---

# design: PQ3 cross-issuer prereq scope vs the multi-issuer model (#7)

**This is a spec note, not a build plan.** It answers the question issue #7
asks — does moving to per-org issuer DIDs reopen PQ3? — and writes down the
invariants that make the answer stable.

---

## Conclusion

**PQ3 does not reopen. Re-ratify it unchanged, and add two invariants that
make the "multi-issuer breaks prereqs" worry structurally impossible rather
than merely currently-untrue.**

The worry in #7 is that with genuinely distinct per-org issuer DIDs, "the
verifier and the `andamio:requires` resolution logic must now resolve and
trust **multiple distinct issuer DIDs**, not one." That premise is false, and
the reason is worth stating precisely because it is the whole value of the
extension:

> **`andamio:requires` references the chain, not a signature.** A prereq entry
> carries `achievementId` = `urn:andamio:{local_state_type}:{policyId}:{completionHash}`
> — three on-chain facts. Checking it means reading the ledger. It has never
> required resolving *any* issuer DID, including Andamio's. Multiplying issuer
> DIDs therefore changes nothing about how a prereq is checked.

PQ3's ratified scope — "same-protocol Andamio credentials only (URNs in the
`andamio:` namespace)" — is a statement about **what may appear in
`achievementId`**, i.e. what kind of *thing* can be a prerequisite. It is not
a statement about who signed the prereq's portable copy. Issue #7 conflates
the two; once they are separated the tension dissolves.

Concretely, on the sample #7 names: the njuguna Cardano XP chain
(project ← course) is described as "cross-issuer in name only — one `did:key`
issues both." That framing is itself the confusion. Those two credentials were
**always** cross-issuer in the sense that matters — they are anchored under
two different on-chain policies with two different owners. The shared `did:key`
was an artifact of the spike's throwaway signing setup, at the presentation
layer, and it was never load-bearing for the prereq check.

---

## The invariants

Two, both cheap, both permanent. They exist so a future contributor cannot
accidentally convert a chain-verifiable check into a trust-the-issuer check.

### PQ3-I1 — `andamio:requires` entries MUST NOT carry an issuer

No `issuer`, no `issuerDid`, no `verificationMethod`, no signature, and no
locator that implies one. The entry's permitted fields are exactly those the
published context defines (`context/v1.jsonld`):

```
achievementId · enforcement · policyReference · rationale · prereqAttestation
```

Every one of them is a chain fact or human prose. **None resolves to an
identity.**

Why this is load-bearing: the comparison table in
`spike/prerequisite-chaining.md` claims Andamio's differentiator is that a
verifier can *independently confirm the prereq was honoured* rather than
trusting an issuer claim. Adding an issuer field to a prereq entry would make
the prereq check depend on resolving and trusting a DID — reproducing exactly
the SaaS property (Badgr, Credly, Accredible) the extension exists to beat.
The regression would be silent: everything would still verify, just less
meaningfully.

Note the practical consequence: adding such a field would require a **new
context version** (`/context/v2.jsonld`) since v1 is `@protected` and frozen —
so this invariant has a natural enforcement point at context review.

### PQ3-I2 — prereq resolution is chain-first, DID-never

The normative order for a verifier checking `andamio:requires[i]`:

1. Parse `achievementId` into `{local_state_type, policyId, completionHash}`.
2. Read the chain: does the holder's Access Token global state contain that
   attestation? (Andamioscan's endpoints, or a direct ledger read — the
   `verifier-guidance.md` "this step needs no trust in Andamio at all"
   property.)
3. Optionally inspect `policyReference` to confirm what the *enforcing* policy
   actually checks at mint time.

There is no step that resolves a DID, fetches a portable copy, or verifies a
signature. A verifier that cannot reach the chain reports the prereq as
**unchecked** — never as satisfied, and never as failed.

---

## What multi-issuer *does* change

Three things, none of which touch PQ3's scope.

### 1. Nothing, under the recommended design

The companion design note keeps `issuer.id` = `did:web:credentials.andamio.io`
permanently and introduces per-org identity as an optional second proof
(`2026-07-28-001-design-per-org-issuer-dids.md`, D1/D3). Under that design
there is still exactly **one** issuer DID to resolve for any Andamio-emitted
credential, prereq or not. #7's premise never materializes.

The rest of this section covers the T3 case (an org genuinely issuing from its
own domain), where the premise would materialize — and still does not reopen
PQ3.

### 2. Discovering a prereq's *portable copy* becomes ambiguous

If credential B requires credential A, and A was issued by an org from its own
domain, where does a verifier fetch A's OB 3.0 document?

**Answer: it does not need to, and the credential must not tell it where.**

- The prereq check is a chain read (PQ3-I2). A portable copy of A is never
  required to satisfy B's `requires` entry.
- A verifier that *wants* a portable copy of A can get one from Andamio's
  assembly service, because that service **derives** credentials from chain
  data rather than retrieving stored documents. It can therefore produce a
  portable copy of any Andamio-anchored credential regardless of who else
  might also publish one. Andamio is a *universal but non-authoritative and
  non-exclusive* resolver for Andamio-anchored credentials.
- Embedding a locator URL in the prereq entry would be a mistake for the same
  reason as PQ3-I1: it turns a chain read into a fetch-and-trust, and it rots
  (the locator outlives the host).

### 3. Prereq key compromise must not cascade — and does not

Under multi-issuer, "org A's signing key was compromised" is a new event
class. Does it affect credential B, which required A?

**No, and the existing ratified defaults already guarantee it:**

- **PQ1 snapshot semantics** — B remains valid even if A is later revoked.
- **PQ3-I2** — B's prereq entry references A's *chain* attestation, which a
  key compromise does not alter. Keys sign portable copies; they do not
  produce the on-chain record.
- **Decision 3 / D4** — Andamio's key-epoch status list flags Andamio's key
  versions only. There is no mechanism by which an org's key event flips a bit
  that affects another org's credentials, and per the companion note none
  should be built.

Worth stating in `verifier-guidance.md` if T3 ever ships, because "the
prerequisite's issuer was compromised" is the kind of thing a verifier will
reasonably ask about and reason wrongly about.

---

## Re-ratification

PQ3 stands as ratified on 2026-04-23: **same-protocol Andamio credentials
only.** Reviewed 2026-07-28 against the multi-issuer model; unchanged.

The widening options PQ3 listed remain deferred, and multi-issuer does not
strengthen the case for either:

- **Any chain asset** (e.g. "holder of an Intersect member token") — still
  deferred. It is a genuine widening of what may be a prerequisite, and it is
  orthogonal to how many issuer DIDs exist. It would need a URN shape for
  non-Andamio assets and a statement of what `enforcement: "mint-policy"` means
  when the enforcing policy is not Andamio's.
- **Any VC** (prereq is any signed credential whose `id` matches) — still
  deferred, and **now explicitly disfavoured**: it is the one widening that
  would violate PQ3-I2, because satisfying it requires resolving and trusting
  an issuer. If it is ever wanted, it should be a *separate, differently-named
  term* whose weaker semantics are visible at the field name, not a widening
  of `requires`.

---

## Documentation reconciliation (#7's third bullet)

Issue #7 asks that `spike/prerequisite-chaining.md` and
`spike/samples/README.md` be updated so the ratified default and the
multi-issuer reality do not contradict. Assessment: **there is no
contradiction to fix yet** — multi-issuer is designed, not built, and the
`did:key` caveat in `samples/README.md` is already flagged as a known spike
limitation ("the issuer is still a throwaway `did:key`, not the production
`did:web:credentials.andamio.io`").

Minimal action taken: a forward pointer added to the PQ3 line of
`spike/prerequisite-chaining.md`'s v1 ratification, so a reader who arrives at
PQ3 while thinking about multi-issuer lands here. The spike documents are
historical records of a ratification and should not be rewritten to describe a
system that does not exist.

Action deferred until per-org DIDs actually ship:

- Fold PQ3-I1 and PQ3-I2 into `docs/verifier-guidance.md` as verifier-facing
  normative language (the spike doc is not the verifier-facing surface).
- Add the "prerequisite's issuer was compromised" case to the result
  vocabulary discussion.
- Re-issue the njuguna sample against real per-org DIDs, at which point the
  sample stops being "cross-issuer in name only" — and should verify
  identically, which is the point.

---

## Related

- [`spike/prerequisite-chaining.md`](../../spike/prerequisite-chaining.md) — PQ1–PQ6 and the 2026-04-23 v1 ratification
- [`spike/samples/README.md`](../../spike/samples/README.md) — the v1 defaults as baked into the samples
- [`context/v1.jsonld`](../../context/v1.jsonld) — the `requires` term definition; `@protected`, so the field set is frozen for v1
- [`docs/plans/2026-07-28-001-design-per-org-issuer-dids.md`](2026-07-28-001-design-per-org-issuer-dids.md) — the multi-issuer model this reconciles against
- [`docs/verifier-guidance.md`](../verifier-guidance.md) — where PQ3-I1/I2 belong once there is something to verify
- Issue [#7](https://github.com/Andamio-Platform/credential-badges/issues/7)
