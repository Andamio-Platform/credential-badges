---
title: "design: per-org issuer DIDs (#4, #6) — designed, not built"
status: designed-not-built
date: 2026-07-28
type: design
origin: "GitHub issues #4 (multi-issuer static host) + #6 (per-org provisioning workflow). ROADMAP Phase 4 / deployment plan Unit 6, requirement R6."
depth: deep
---

# design: per-org issuer DIDs (#4, #6)

**This is a design document, not a build plan. Nothing here is implemented.**
It exists so the deferral of T2 is coherent rather than ad hoc: if and when
per-org issuer identity is built, this is the shape it should take, and these
are the questions that must be answered first.

---

## Summary

The headline finding is that **the obvious version of this feature is a
downgrade, and should not be built.**

"Per-org issuer DIDs" reads as: move `issuer.id` from
`did:web:credentials.andamio.io` to `did:web:credentials.andamio.io:issuers:<org>`,
give each org a KMS key, and let the credential say the org issued it. Under
Decision 2's attestation-host framing that is strictly worse than what ships
today. The credential would *name* the org as issuer while **Andamio still held
the signing key, the domain, the TLS certificate, and the deploy pipeline** —
a decentralization signal with no decentralization behind it. Today's single
Andamio DID is honest precisely because it claims only what Andamio can back:
anchoring integrity.

So the design splits the feature into the part that is real and the part that
is theatre:

| Want | Real? | Answer |
|---|---|---|
| A verifier can identify the substantive authority behind a credential | **already shipped** | The `courseOwner` field + the `course_id` (an on-chain minting policy that traces to its owner). `docs/verifier-guidance.md` already says this. |
| An org's *own key* cryptographically endorses its credentials | **real** | **D3** — a second proof in the credential's proof set, signed by a key the org holds and Andamio never sees. |
| An org has a stable, resolvable, org-scoped identifier | **real, cheap** | **D2** — `did:web:credentials.andamio.io:issuers:<alias>`, hosted here. |
| An org's badges look like the org | **real, separate feature** | `docs/brainstorms/2026-06-27-issuer-badge-customization-requirements.md`. Presentation-layer; does not need a DID. |
| An org is independent of Andamio's infrastructure | **not deliverable by this repo** | Only T3 (org's own domain) delivers it. D2 is a naming convenience, not sovereignty. Say so out loud. |

**Recommended target state:** `issuer.id` stays `did:web:credentials.andamio.io`
forever. Per-org identity arrives as an *optional co-signature*, whose
verification method resolves to an org DID that Andamio may **host** but never
**custodies**.

---

## 1. What "one issuer" actually means today

Seven singletons, each of which "per-org" would multiply. Naming them
explicitly is most of the design work, because three of them turn out to be
things you do **not** want multiplied.

| # | Singleton | Where | Multiply it? |
|---|---|---|---|
| S1 | Issuer DID `did:web:credentials.andamio.io` | `issuer-service/src/config.ts` `ISSUER_DID` (build-time constant, "never derived from request input, no fallback key/DID path") | **No** — D1 |
| S2 | KMS signing key `vc-sign-ed25519` v1, HSM, Ed25519 | ops Terraform; `KMS_KEY_VERSION_NAME` | **No** — D3 (Andamio never holds an org key) |
| S3 | DID document at `/.well-known/did.json` (+ `/did.json` alias) | repo, CI-emitted, CODEOWNERS-gated | Add siblings under `/issuers/**` — D2 |
| S4 | Hosted Profile at `/issuer` | `issuer/profile.jsonld`, nginx exact-match | Add siblings under `/issuers/**` — D2 |
| S5 | Key-epoch status list `/status/key-epoch-2026-07.json`, bits 0–63 = key versions | `issuer-service/src/status-list.ts` | **No** — D4 |
| S6 | Boot drift check: 3 live artifacts, 1 active key version, 1 vm fragment | `issuer-service/src/drift-check.ts` | **No** — D5 |
| S7 | nginx allowlist: fixed top-level paths, exact-match locations | `Dockerfile`, `check-allowlist.sh`, `.dockerignore`, `nginx/default.conf.template` | One new directory — D6 |

The instinct to multiply all seven is the trap. S2, S5 and S6 must stay
singular for reasons that are about honesty and availability, not effort.

---

## 2. D1 — `issuer.id` never moves

**Decision: `issuer.id` is `did:web:credentials.andamio.io` permanently, for
every credential this service signs, regardless of how many orgs exist.**

Rationale:

1. **It is the true statement.** Andamio *is* the party that anchored the
   claim and signed the portable copy. An org DID in `issuer.id` would assert
   that the org produced this document, which is false for anything the
   Andamio issuer service emits.
2. **Decision 2 already settled it.** Per-org DIDs are "no longer
   correctness-relevant" under attestation framing (deployment plan, Open
   Questions → Resolved). Moving `issuer.id` would re-open a settled question
   in the weaker direction.
3. **It preserves the fail-closed signing posture.** `ISSUER_DID` being a
   build-time constant with no request-derived path is a deliberate control.
   A per-request issuer DID turns a constant into an input — the exact shape
   of bug that lets a caller pick which identity signs.
4. **Migration cost is unbounded.** Credentials in the wild reference
   `issuer.id` forever. A cutover would split the corpus into two eras with
   two trust stories and no way to un-split it.

**Consequence for the funding/partnership narrative:** do not describe a
hosted per-org DID as "the org issues its own credentials". It does not. See
§8.

---

## 3. D2 — per-org DID naming and hosting

**Decision (conditional on the feature being built at all):**

```
DID          did:web:credentials.andamio.io:issuers:<alias>
DID document https://credentials.andamio.io/issuers/<alias>/did.json
Profile      https://credentials.andamio.io/issuers/<alias>
```

Notes that matter for implementation:

- **`did:web` path form does not use `.well-known`.** Only the bare-domain
  form resolves to `/.well-known/did.json`. The path form maps each `:` to
  `/` and appends `/did.json`. Getting this wrong is the single most likely
  implementation bug.
- **Therefore the slug charset is constrained by DID syntax**, not by taste:
  no `:`, no `/`, no percent-encoding, no uppercase. `^[a-z0-9][a-z0-9_-]{0,63}$`
  or tighter.
- The `/did.json` bare-domain alias that exists for the root DID (added
  because the 1EdTech resolver deviates from spec) has **no analogue** in the
  path form. Do not invent one.

### Slug choice — use the Andamio alias

The slug must be stable forever, because credentials reference it
permanently. Candidates:

| Candidate | Verdict |
|---|---|
| Human-readable org slug (`gimbalabs`) chosen at onboarding | **Rejected.** Andamio would have to run a naming authority: uniqueness, squatting, renames, trademark disputes. Same reason `badge_id` is not a slug (`docs/badge-registry.md` §5). |
| Course `policy_id` | **Rejected.** A course is not an org. One org owns many courses; a per-course DID would produce an identity that changes every time the org launches a course. |
| Access Token global-state asset (`g<alias>`) | Workable but redundant — the `g` prefix is a derivation detail, and it is already what `courseOwner` carries as `urn:andamio:{network}:course-owner:g<alias>`. |
| **Andamio alias** (`<alias>`) | **Recommended.** It is the on-chain, protocol-allocated name of the Access Token holder — the party `docs/verifier-guidance.md` already calls the substantive authority. It is human-readable *and* derived, so it is friendly without Andamio arbitrating anything. It is already read on the signing path: `issuer-service/src/anchor.ts` takes `course.owner` (an owner alias) from the course details and refuses to proceed without it. |

This is the design's nicest property: the naming-authority problem dissolves
because Andamio's protocol already has an alias namespace, allocated on-chain,
first-come, outside this repo's control.

**It rests on two assumptions that must be verified before building** — see
O1 and O2 in §9.

### Profile content and ownership

`issuers/<alias>/profile.jsonld` is an OB 3.0 `Profile` typed `["Profile"]`
(**not** `AttestationHost` — that type is Andamio's role, not the org's), with
`id` equal to the org DID, plus org-supplied `name`, `url`, `image`,
`description`. It is mutable (cached, not `immutable`), same posture as
`/issuer`. Contents are org-supplied and Andamio-reviewed; the review gate is
the PR (§6).

---

## 4. D3 — key custody: Andamio never holds an org's signing key

The fork issue #6 named as "Andamio-generated and held (T2) vs owner-generated
and self-held (T3)". The design rejects the first branch outright.

| Option | Shape | Verdict |
|---|---|---|
| **K1 — Andamio-custodied per-org key** | A KMS CryptoKey per org in Andamio's keyring; the issuer service signs as any org | **Rejected.** Produces a credential that names the org as signer while Andamio holds the key. Cryptographically per-org, operationally still Andamio: a false decentralization signal, strictly less honest than today's single DID. Also: linear KMS key growth, N key epochs, N rotation runbooks, and a fail-closed boot gate that would have to prove N key pins (D5). |
| **K2 — org-generated key, Andamio publishes the public key** | The org generates Ed25519 offline, ships the public key; Andamio publishes it in `issuers/<alias>/did.json`. The org signs its own proof. | **Recommended** for the co-signature (below). Andamio never sees a private key, so there is nothing to overclaim. |
| **K3 — org self-hosts the DID document on its own domain** | `did:web:<org-domain>`; Andamio hosts nothing | **The endgame (T3).** Needs *nothing* from this repo except that a credential can reference a DID Andamio does not host. Worth noting: it is cheaper for this repo than K2, because it is the absence of a feature. |

### The co-signature

The genuinely useful per-org capability is: **the org's own key endorses the
credential, without displacing Andamio's attestation.**

W3C VC 2.0 permits a *proof set* — multiple independent proofs on one
credential, each verifiable alone. So:

- `proof[0]` — Andamio's `eddsa-rdfc-2022` Data Integrity proof, verification
  method `did:web:credentials.andamio.io#key-2026-07`. Unchanged. Attests
  anchoring integrity.
- `proof[1]` — *optional*. The org's proof, verification method
  `did:web:credentials.andamio.io:issuers:<alias>#<org-key-fragment>` (K2) or
  `did:web:<org-domain>#…` (K3). Attests whatever the org wants to attest —
  in practice, "we stand behind this".

Properties this buys:

- A verifier that has never heard of the org still verifies `proof[0]` and
  gets today's exact result. **Nothing regresses.**
- A verifier that fails to resolve `proof[1]` degrades to
  "co-signature unavailable", not "invalid" — the same shape as the existing
  "anchored, signature unavailable" state in `docs/verifier-guidance.md`.
- An org key compromise cannot invalidate Andamio's attestation, and an
  Andamio key compromise cannot invalidate the org's.
- Andamio's signing path is untouched. The org proof is added *after*
  Andamio signs, by the org, over the already-signed document.

Cost, stated plainly: **key loss is unrecoverable and it is the org's
problem.** An org that loses its key cannot co-sign again under that
verification method, and previously co-signed credentials stop verifying their
second proof once the method is removed from the DID document. Rotation is
additive (publish a new fragment, keep the old one listed) — the same rule as
Andamio's own key rotation. Any provisioning runbook must lead with this, not
bury it.

---

## 5. D4 — status-list topology does not multiply, and D5 — the boot gate stays O(1)

### D4 — one status list, Andamio's

**Decision: `/status/key-epoch-*.json` covers Andamio's signing keys only.
Andamio does not host or operate a status list for an org's key.**

Reasons:

- The existing list's semantics are *key-version freshness of the attestation
  host* (Decision 3). Adding org key versions to bits 64+ would silently
  change what "suspended" means for readers of the same list.
- A per-org list under Andamio's control is **Andamio holding a kill switch
  over an org's identity** — precisely the substantive authority the
  attestation-host framing renounces.
- The org key's revocation surface already exists and is simpler: **the DID
  document**. Removing a verification method stops the co-signature verifying.
  Under K3 the org controls that directly; under K2 it is a reviewed PR here.
- If an org later wants a real status list, it hosts one and references it
  from its own proof. Out of scope for this repo.

Corollary: a credential's `credentialStatus` entry stays exactly as it is
today — one entry, pointing at Andamio's key-epoch list, indexed by the
Andamio key version that signed `proof[0]`. It never becomes an array keyed by
proof.

### D5 — the fail-closed boot gate must not become O(number of orgs)

`issuer-service/src/drift-check.ts` refuses to open its listener unless three
live artifacts match their bundled copies and the active key's status bit is
clear. The naive multi-issuer extension — check every issuer's DID document at
boot — is **actively dangerous**:

- Boot latency becomes O(N) with a ~50s bounded-retry budget per artifact.
- Every org's artifact becomes a **hard availability dependency of Andamio's
  entire signing service**. One org's botched DID document (a 4xx, which the
  drift check correctly classifies as drift and refuses to boot on) would stop
  Andamio signing *all* credentials. That is a self-inflicted denial of
  service with an external trigger.

**Decision: the boot gate checks only the identity the service signs with.**
Since D1 keeps that singular and D3 keeps org keys out of the service, the
boot gate needs **no change at all** for per-org issuers. The `KEY_VERSION_POSITIONS`
registry, `ACTIVE_KEY_VERSION`, and the single-`verificationMethod` pin all
stay as they are.

Per-org artifacts get **build-time** invariants instead, which is where they
belong (they are static files, not signing inputs):

- `issuers/<alias>/did.json` `id` **must equal** `did:web:credentials.andamio.io:issuers:<alias>`
  — self-consistency, derived from the directory name. This is the test that
  stops an org PR from publishing a DID document claiming to be some other
  DID, including the root.
- No file under `issuers/**` may contain the root DID as its `id` or
  `controller`.
- Every `verificationMethod.controller` equals the document's own `id`.
- Slug matches the DID-syntax-safe charset (§3).
- Served-path smoke tests in CI + deploy, asserting the content type for each
  issuer path — the pattern `/issuer` and `/context/v0.jsonld` already use.

---

## 6. D6 — the static host change (#4) and the provisioning workflow (#6)

### Serving surface

One new allowlisted top-level directory, `issuers/`, changed in lockstep
across the four allowlist controls (Dockerfile `COPY`, `check-allowlist.sh`
`ALLOWED`, `.dockerignore` `!`-re-include, nginx location) — the repo's
standing rule. Adding a *directory* once is the point: adding an org is then a
new subdirectory, not nginx surgery.

nginx sketch, in the idiom the existing config already uses:

```nginx
# Per-org issuer identity (#4). ^~ owns the prefix. Two nested exact shapes,
# nothing else: a malformed slug falls through to the outer =404.
location ^~ /issuers/ {
    # did:web path form -> /issuers/<slug>/did.json. The stock mime.types
    # maps .json to application/json, which overrides default_type, so the
    # extension map must be cleared for this location (same gotcha as
    # /.well-known/did.json and ^~ /status/).
    location ~ "^/issuers/[a-z0-9][a-z0-9_-]{0,63}/did\.json$" {
        types { }
        default_type application/did+ld+json;
        add_header Cache-Control "public, max-age=3600";
        try_files $uri =404;
    }

    # Extensionless per-org Profile, mirroring `location = /issuer`.
    location ~ "^/issuers/([a-z0-9][a-z0-9_-]{0,63})$" {
        default_type application/ld+json;
        add_header Cache-Control "public, max-age=86400";
        try_files /issuers/$1/profile.jsonld =404;
    }

    return 404;
}
```

`autoindex off` is already global — verify no directory listing appears at
`/issuers/`, and that `/issuers/<slug>/` (trailing slash) 404s rather than
falling through to the generic `location /`.

### Trust boundary (#6's explicit requirement)

*"A per-org issuer must not be able to mint Profiles/DIDs for another org via
this repo's allowlist."* Three controls, in order of strength:

1. **Provisioning is a reviewed PR to this repo.** There is no self-serve
   write path, and none should be built before the rest of this is in
   production. Merge rights are the access control.
2. **CODEOWNERS `/issuers/**`.** A lighter gate than `/.well-known/**` (an org
   file cannot affect Andamio's signing identity) but still a named reviewer,
   because a wrong public key here means a third party's endorsement is
   attributable to the wrong entity.
3. **The CI invariants in D5** — a directory can only ever publish the DID its
   own name implies. This is what makes the blast radius of a bad PR exactly
   one slug.

What none of these give you: **isolation from Andamio.** Andamio controls the
domain, the certificate, the image, and the deploy, so Andamio can rewrite any
hosted per-org DID document unilaterally. That is a property of hosting, not a
gap to be closed. K3 is the only fix.

### Provisioning runbook shape (#6's definition of done)

The runbook is not written here because it should not be written until the
feature is real. Its required sections, and the failure each exists to
prevent:

| Section | Prevents |
|---|---|
| Eligibility: what makes a requester the owner of `<alias>` | Issuing an identity to someone who does not hold the Access Token |
| **Proof of control** (see §7) | The same, cryptographically rather than by assertion |
| Key generation, org-side, offline; public key transmitted, private key never | Andamio ever being in a position to overclaim custody (K1) |
| "If you lose this key, Andamio cannot recover it" — signed acknowledgement | The support incident that ends in someone asking Andamio to hold a backup |
| Profile content review (name, logo, url, description) before a forever-public file | Publishing something Andamio would not want to serve permanently |
| Rotation: additive only; old fragment stays listed | Silently invalidating every credential already co-signed |
| Deprovisioning: what "leaving" means when the DID is referenced forever | Deleting a DID document that live credentials resolve |

That last row is the one most likely to be skipped and most expensive to get
wrong. **A published per-org DID document must keep resolving forever**, like
a context version — even for an org that has left. Deprovisioning means
removing verification methods and marking the Profile, never a 404.

---

## 7. Binding the DID to the on-chain identity, and where issue #8 lands

A hosted per-org DID is only worth anything if a verifier can check that it
really belongs to the party behind the course. Two candidate bindings:

- **B1 — proof of Access Token control.** The requester signs a challenge with
  the wallet key holding the `g<alias>` Access Token global-state asset
  (CIP-8 / CIP-30 message signing). This proves control of exactly the object
  `courseOwner` already names. **Available today, needs nothing from #8**, and
  is the correct binding under attestation framing because the Access Token
  holder *is* the party Decision 2 designates as the substantive authority.
- **B2 — proof of mint-policy control.** A signature by whatever key
  authorizes the course's minting policy. Stronger-sounding, and the subject
  of [#8](https://github.com/Andamio-Platform/credential-badges/issues/8).

### Is this design blocked on #8?

**No — with one bounded exception.**

- The topology (D1–D6) does not depend on it. Andamio's own claim is about
  anchoring integrity and is true regardless of who controls any policy.
- The binding does not depend on it: B1 is implementable today.
- **What #8 does gate is what may be *said*.** Any claim of the form "the org
  genuinely issues its own credentials" — i.e. T3 as a decentralization story
  rather than a hosting arrangement — rests on the mint policy being
  owner-controlled. If Andamio's protocol mints on the owner's behalf, then
  even a self-hosted org DID is a presentation-layer overlay on a
  protocol-operated authority. That is a perfectly fine thing to be; it is not
  a fine thing to oversell. #8's own body says exactly this.

**Recommendation:** treat #8 as a prerequisite for *external claims about T3*,
not for building D1–D6. Do not put "self-sovereign issuer" in a funding
narrative until #8 has a written answer with code references.

---

## 8. Effect on `docs/verifier-guidance.md`

Smaller than expected, because the doc already does the hard part. It already
says the course owner vouches for the credential, that the course id traces to
a non-anonymous owner, and that Andamio "does not decide what a credential is
worth". **The substantive authority is already identified — by an on-chain
policy id, which is a stronger identifier than a `did:web` slug Andamio
hosts.**

If per-org DIDs ship, three additive changes:

1. A short section on the **proof set**: a credential may carry a second
   proof; verifying only Andamio's proof is complete and sufficient; a missing
   or unverifiable second proof is "co-signature unavailable", never
   "invalid".
2. One sentence of **honesty about hosting**: a
   `did:web:credentials.andamio.io:issuers:<alias>` DID document is served by
   Andamio, so it inherits Andamio's availability and integrity. It is a
   stable name for the course owner, not independence from Andamio.
3. Extend the result vocabulary with **"anchored, signature valid,
   co-signature unavailable"** — do not fold it into "indeterminate".

Explicitly *not* changed: the four-party framing, the two-layer chain/status
model, and the claim that Andamio's signature attests to the anchor and not
the achievement. Per-org DIDs do not alter any of those.

---

## 9. Open questions — not resolvable from this repo

**O1. Is an Andamio alias unique and permanently bound to one party?**
The slug recommendation in D2 assumes the on-chain Access Token mint policy
enforces alias uniqueness. If two parties can hold the same alias, or an alias
can be re-registered after release, the slug is not stable-forever and D2 must
fall back to the Access Token asset or a hash of it. *Answerable from the
Access Token mint policy; not answerable from this repo.*

**O2. Is the Access Token transferable?**
If `g<alias>` can change hands, "controls the alias now" ≠ "controlled the
alias when the credential was claimed", and the B1 binding proves less than it
appears to. Would not invalidate the design, but the runbook and the
verifier-facing language would need to say what the binding actually asserts.

**O3. Does anyone actually want this?**
No org has asked for a per-org issuer DID. The demand signal that exists is
for **branding** (`docs/brainstorms/2026-06-27-issuer-badge-customization-requirements.md`),
which is presentation-layer and needs no DID. Building D2/D3 before a
concrete requester is speculative. This document is insurance against
incoherent deferral, not a build queue entry.

**O4. What does an org co-sign, and when?**
The co-signature model (D3) implies an org-side signing step after Andamio
signs. Who runs it — a CLI, the Andamio app with a connected wallet, a batch
job? Unspecified, and it is the largest unestimated piece of work here. Note
that a wallet-based flow would use a Cardano key, which is Ed25519 but wrapped
in CIP-8/COSE rather than a Data Integrity proof — whether that can be
expressed as a VC 2.0 proof, or needs a distinct evidence-style field, is
**unresolved and should be settled before committing to the proof-set shape.**

**O5. Per-org badge hosting (#11's remaining open decision).**
Answered by D1: since `issuer.id` never moves and badges are presentation-only
(`docs/badge-registry.md` I4), **badges stay in this repo under `/badges/`
with the existing `badge_id` naming.** There is no per-org badge path. Org
branding is a render-time input (the customization brainstorm), not a
different URL space. The binding constraint either way is `badge_id` invariant
I3: no existing badge URL may move, ever.

---

## 10. If this is ever built — order of operations

Not estimated; sequence only. Each step is independently shippable and each
earlier step is useful without the later ones.

1. Answer **O1** and **O2** from the Access Token mint policy. Everything
   downstream keys off the slug being stable-forever.
2. Answer **O4** — the co-signing mechanism — far enough to know whether the
   proof-set shape survives contact with Cardano wallet signing.
3. Ship the **serving surface** (D6, §"Serving surface"): `issuers/`
   directory, allowlist lockstep, nginx block, CI invariants, CODEOWNERS,
   content-type smoke tests. This is issue #4 and is genuinely independent of
   every key-custody question — it can ship with zero issuers in it.
4. Ship a **Profile-only** issuer (no key, no `did.json`) for one real org.
   Delivers the branding and identity value with no custody surface at all,
   and validates the provisioning workflow end-to-end.
5. Only then, add `did.json` + the K2 key flow + the co-signature (D3), and
   write `docs/runbooks/issuer-provisioning.md` per §6's table.

Steps 3 and 4 close #4 and #6 as a coherent unit. Step 5 is a separate
decision that should require a named requester (O3).

---

## Related

- [`docs/verifier-guidance.md`](../verifier-guidance.md) — the trust model this design must not weaken
- [`docs/badge-registry.md`](../badge-registry.md) — `badge_id` invariants; O5 above
- [`docs/plans/2026-07-28-002-design-multi-issuer-prereq-scope-pq3.md`](2026-07-28-002-design-multi-issuer-prereq-scope-pq3.md) — the PQ3 reconciliation (#7)
- [`docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md) — Decision 2, R6, Unit 6
- [`docs/brainstorms/2026-06-27-issuer-badge-customization-requirements.md`](../brainstorms/2026-06-27-issuer-badge-customization-requirements.md) — per-org *branding*, the demand signal that actually exists
- `issuer-service/src/{config,drift-check,status-list,anchor,map-credential}.ts` — the singletons in §1
- Issues [#4](https://github.com/Andamio-Platform/credential-badges/issues/4),
  [#6](https://github.com/Andamio-Platform/credential-badges/issues/6),
  [#8](https://github.com/Andamio-Platform/credential-badges/issues/8),
  [#11](https://github.com/Andamio-Platform/credential-badges/issues/11)
