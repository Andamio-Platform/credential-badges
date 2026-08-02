# Third-Party Display Targets — Research

**Date:** 2026-08-02
**Companions:** `end-user-ux-research.md`, `open-questions.md`, `mapping.md`, `CORNERS-CUT.md`
**Source trigger:** "What is a LinkedIn `certUrl`, and does this project deliver it?" — widened into where else an Andamio credential can be posted and viewed.

**Status: research only. Nothing here is decided, and nothing here is a plan.**

---

## Provenance — read this before acting on anything below

Two classes of claim in this document, deliberately separated, because the
[Validation Gate](../CONCEPTS.md) principle applies to external platforms as much as to specs:
a platform's documentation is a hypothesis about its behaviour, not evidence of it.

- **Verified against this repo** — read from source at the cited `file:line`. Trustworthy.
- **From external documentation, not tested** — read from vendor/EU docs. **No round-trip was
  performed against any external platform.** Treat as a lead worth spiking, never as a fact.

Every external-platform claim in §3–§5 is the second kind. The Credly finding in §4 is the one
most worth testing early, because it is cheap to test and it supersedes a claim currently written
into `open-questions.md`.

---

## TL;DR

1. **One decision gates every external display target: the recipient identifier.** Andamio
   credentials are pseudonymous by design; every third-party surface expects an email. This is not
   per-integration plumbing — it is a single product decision that opens or blocks all of them at once.
2. **The three targets are not the same kind of thing.** Open Badges 3.0 is a *format we already
   meet*. Credly is a *commercial platform that now accepts imports*. Europass is a *regulated regime
   we are not eligible for*. Effort, risk, and blockers differ by category, not by degree.
3. **Credly is far more reachable than `open-questions.md` Q7 currently says.** That entry
   ("closed platform; need a partnership conversation") predates Credly's earner-side import of
   outside badges. No partnership appears to be required for the display use case. See §4.
4. **`.svg` is an accepted Credly import format** — and our badges are SVGs with the credential
   baked in. The artifact shape may already be right; only the recipient identifier is wrong.
5. **Europass is out of direct reach.** It requires an eIDAS electronic seal and EU/EEA
   establishment, and uses ELM rather than OB3. A partner-institution path exists; an engineering
   path does not.
6. **This repo has no database, anywhere** (verified). Issuer-organization data would be the first
   authored, non-derivable data it has ever held — which is a bigger architectural question than it
   first appears. See §6.
7. **Two decisions turn out to be one.** *Pre-baked vs on-demand Holder Artifacts* and *store vs
   don't store recipient emails* are the same decision. See §7.

---

## 1. The shared gate — recipient identifier

`issuer-service/src/map-credential.ts:60-62` sets:

```
credentialSubject.id = urn:andamio:{network}:recipient:{studentStateAsset}
```

with the comment *"Pseudonymous URN over the recipient's Andamio Access Token global-state asset —
never the human alias."* The credential does not carry an email. It does not carry the alias either.
That is a deliberate design position, not an oversight.

Every third-party display target expects an email-derived identifier:

| Target | Identifier expectation |
|---|---|
| Credly import | Email must match one on the earner's Credly account (their hashing is case-sensitive) |
| HR systems (Workday, BambooHR) | Email hash — already noted at `open-questions.md:20` |
| LinkedIn | No identifier at all — see §2; the URL carries the proof |

**The important reframing:** this is already logged as an open question in two places
(`mapping.md:115`, `docs/plans/2026-05-16-001-…:182`). This research did not discover it. It found
the *forcing function* for it — and established that it gates the whole external-display surface
rather than any one integration.

**If it changes, make it additive.** OB3 permits a hashed `IdentityObject` alongside
`credentialSubject.id`. Keeping the pseudonymous `id` canonical and adding an identity object only
on an *export variant* would reach these platforms without reversing the pseudonymity design or
touching the shape of what we already sign.

---

## 2. LinkedIn `certUrl` — what it is, and where we stand

### What it is

A query parameter on LinkedIn's Add to Profile deep link
(`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&…`). It pre-fills the
**Credential URL** field of a Certification entry — what renders as the "Show credential" button on
a profile. Siblings: `certId` → Credential ID, `name` → certification name,
`organizationId` / `organizationName` → issuing organization (mutually exclusive; the numeric ID is
preferred and links to a real LinkedIn Page).

**There is no "certUrl compliance."** LinkedIn publishes no spec, no validator, no conformance
programme. Two separate things get conflated under the name:

1. **The deep-link parameter contract** — which LinkedIn has largely retired. Their help centre
   states links "will no longer be customized for a specific certificate," that existing customized
   buttons still work but "direct to the new experience without auto-filling," and that members
   "must enter the relevant information directly on their profile."
2. **The destination** — the page a viewer lands on from "Show credential." Requirements here are
   implicit, not published: publicly reachable without login, HTTPS, permanent, and it must
   actually answer *"does this named person hold this?"*

Because (1) is deprecating, **(2) is the part that matters**. That makes LinkedIn a question about
our own pages, not about their URL format — and it is the one target that needs no recipient
identifier at all, because the URL carries the proof.

### Where this project stands *(verified)*

Two builders emit the link:

- `generator/page.py:172-175` — class page; `certUrl` = the class page URL
- `badges/_holder.js:264-273` (`certUrlFor`) — holder page; `certUrl` = `/badges/{stem}/{alias}`

The holder-page path is correct and was reasoned out deliberately — KTD-7 in
`docs/plans/2026-07-24-005-feat-holder-viewer-plan.md:84` names the holder page as the real
"this person holds this, verified" target, and
`docs/plans/2026-07-28-003-feat-phase3-verification-states-plan.md:33` treats the `not-found`
verdict as load-bearing precisely because an employer arrives via `certUrl`. The no-autofill reality
is already handled honestly; the copy promises nothing.

Four gaps, ordered by impact on an employer:

1. **The class page still offers add-to-profile with a class `certUrl`** (all 58 pages,
   `badges/*.html:137`). An employer clicking "Show credential" lands on a page describing a
   credential *type*, which never names the person whose profile they came from. Structurally
   deliberate — the class page cannot know the visitor — but the result is a live button producing
   a non-proof.
2. **Every badge writes the same issuing organization.** `ORG_NAME = "Andamio Teams"` is hardcoded
   at `generator/page.py:88`, and `generator/credentials.json` carries no issuer field at all —
   only `course_id`, `slt_hash`, `course_title`, `module_title`. Already named as
   "the wrong issuing organisation" at `docs/plans/2026-07-31-001-…:81`.
3. **`ORG_ID = None`** (`generator/page.py:89`) — the org is free text LinkedIn will not link to a
   Page. Known; needs a Page admin to read the numeric ID.
4. **`certId = stem`** on both builders — the *class* coordinate. Two holders of the same badge get
   identical Credential IDs on their LinkedIn profiles. On the holder page, `alias` is available and
   unused.

**Verdict:** the integration works and is honest, and the destination architecture is right. What it
does not yet deliver is a `certUrl` that reliably answers the employer's question — because the
class page's button points somewhere that cannot, and because the issuer named on every
certification is wrong.

---

## 3. Open Badges 3.0 — already shipped, distribution is the gap

**Format-side: essentially nothing needed.** We issue OB3 today, validated 13/13 with contexts
resolving and signatures verifying (`validation-results.md`). OB3 is not a destination to integrate
with; it is the format we are already in. The gaps are elsewhere:

1. **The Holder Artifact is not built.** Baked SVGs carry the *Class Achievement* — holder-free by
   design (`CONCEPTS.md`). Nothing we can hand a third party today says "this person earned this."
   ROADMAP has the holder half as planned-not-built (215 badge-holder pairs, cached not committed).
   **This is the prerequisite for every export target.**
2. **Recipient identifier** — §1.

**What delivery looks like:** thinner than the spec implies, and `end-user-ux-research.md:81`
already explains why — *"there is no mature wallet in 2026 where a regular learner holds their own
OB 3.0 credentials across issuers."* Nothing found in this pass contradicts that. What has moved
since that April note is **ingestion**: Accredible now documents import of OB3/W3C VCs from any
compliant issuer with signatures preserved, and Credly does too (§4). So "delivery" for OB3 means
*our credential can be pulled into other people's platforms* — not that a universal wallet appeared.

---

## 4. Credly — supersedes `open-questions.md` Q7

> `open-questions.md:76` currently reads: **"Credly — closed platform; need a partnership
> conversation."** That was accurate when written (2026-04). It is now out of date.

Credly documents **earner-side import of outside badges**: an earner uploads any OB2/OB3-compliant
badge as `.png`, `.svg`, or `.json`, and Credly parses the metadata and verifies authenticity.

Two things make this a better fit than the April note assumed:

- **`.svg` is an accepted import format** — and our badges *are* SVGs with the credential baked in.
  The artifact shape may already be right.
- **No issuer contract needed for the display use case.** The earner performs the upload. Nothing is
  being asked of Pearson.

**What would be needed:** the Holder Artifact baked per badge-holder pair (§3), plus an
email-based recipient identifier, lowercase-normalized — Credly's docs are explicit that
case-sensitivity breaks the match.

**What delivery would look like, concretely:** an Andamio badge appears in a learner's Credly
profile at `credly.com/users/{handle}`, beside their AWS and CompTIA badges, inheriting Credly's own
LinkedIn sync, embed codes, and public badge page. That is the largest enterprise badge audience
available, reached without a partnership.

**Two caveats to test before believing any of it.** Credly's docs note that badges from Microsoft,
Oracle and Salesforce are *not* supported, implying undocumented issuer-side filtering. And no
upload was attempted — this is documentation, not a round-trip.

**Recommended next probe (cheap, high information):** attempt one real import of an existing baked
SVG into a Credly account. It tests artifact acceptance, issuer filtering, and identifier matching
in a single pass, and it is the highest-information hour available anywhere in this document.

---

## 5. Europass — a regulatory regime, not an integration

Categorically different from §3 and §4. What is needed is not engineering:

- An **advanced or qualified electronic seal** under eIDAS (EU Reg. 910/2014) — an institutional
  legal instrument, not a signing key we generate.
- Issuance limited to institutions **established in the EU/EEA**, because of eIDAS.
- Accredited credentials are checked against the **Qualifications Dataset Register**, fed from
  DEQAR — recognition presumes an accredited education provider.
- A different data model entirely: **ELM** (European Learning Model), JSON-LD aligned to W3C VC
  **1.1**, signed with **JAdES**. Not OB3. Our document would be rebuilt, not reshaped.

**Assessment:** Andamio is not an EU-established accredited institution, so this is not a path we
walk directly. The plausible route is an EU partner institution issuing Europass credentials that
reference Andamio-anchored evidence — a partnership and co-issuance design, not a mapper.
**Park until a named EU partner asks for it.**

---

## 6. Where issuer-organization data could live

Prompted by the §2 gap: the LinkedIn organization name is wrong on every badge, and fixing it means
storing something.

### What exists today *(verified)*

No database anywhere — no SQL driver, no ORM, no Redis, no Firestore, in any `package.json` or on
the Python side. Persistence is:

| Layer | What it is |
|---|---|
| Git-committed files | `credentials.json`, the 58 badge SVG/PNG/HTML sets, `_registry.json` — byte-frozen, PR-reviewed |
| GCS bucket | render **cache** only, lifecycle TTL, disposable (`DEPLOY.md:31`) |
| Secret Manager | signing key, gateway API keys |
| Chain | the actual source of truth |

`issuer-service` is stateless — it signs on demand, gated on a live anchor check. That statelessness
is why the deploy story is as simple as it is.

### Why this is a real question

Everything in `credentials.json` today is **derived**. `fetch.py` projects chain state into it,
`build.py` renders from it, `reconcile.py` prunes orphans. Delete the tree and it regenerates. That
reproducibility is what Version Freeze, Expansion Pin, Drift Check and Deterministic Re-sign all
rest on.

An issuing-organization name is **the first piece of data here that is not derivable**. `andamioscan`
gives `owner: "james"` — an alias, not an organization. Someone must author the display name, it
changes over time, and it lands on people's LinkedIn profiles so it cannot churn freely.

**So the question is not "which database." It is: is `credential-badges` a renderer or a platform?**
Today it is emphatically a renderer. A database makes it a platform, and every invariant in
`CONCEPTS.md` gets harder to hold.

### Options

**Andamio API / dbapi — currently the strongest.** `fetch.py` *already* pulls authored data from the
authed `andamio` CLI — that is where course and module titles come from. Organization name is the
same class of data, from the same owner, with the same edit lifecycle. Not a new dependency; the one
we already have. Course owners already have identity and auth there, which is what self-service
issuer identity needs. Keeps this repo a renderer.

**Committed JSON here — the bridge.** An `issuers.json` mapping alias → org record. Zero new infra,
fits the offline deterministic build, free version history, CODEOWNERS gating already exists. Fine
for dozens of issuers edited by Andamio staff; wrong the moment issuers self-serve. Its real value
is being the seam — same consumer code either way, so the source can be swapped later without
touching anything downstream.

**Its own database here — resist for now.** First stateful component in a deliberately stateless
system, buying nothing dbapi does not already have. The honest case arrives only if
`credential-badges` becomes a multi-tenant issuer platform with its own identity model. Nothing in
the current roadmap points there.

### Schema note worth taking early

Do not model the record as `ORG_NAME`. There is one issuer entity with a **canonical display name**,
plus a map of **platform-specific bindings** — LinkedIn's numeric org id today, plausibly Credly,
Europass, or an OpenBadges display later. The canonical name is also what belongs on the badge page,
the OG card, and the issuer profile — not only LinkedIn. Getting that shape right costs nothing now;
the alternative is a LinkedIn-shaped field every future platform works around.

### Feasibility of the plumbing *(verified — cheaper than expected)*

- `andamioscan.io/api/v2/courses` **already returns `owner` per course**, in the exact loop
  `generator/fetch.py:70-82` already runs. No new endpoint, no new auth.
- **Nothing signed changes.** Zero of the 58 baked SVGs contain a LinkedIn reference; all 58 hits are
  in the HTML pages. Display-layer only: no re-sign, no Version Freeze exposure, no Expansion Pin
  movement, no re-bake.
- **The 1:1 invariant is already locked** — `docs/plans/2026-05-16-001-…:256` fixes
  `course_id ↔ courseOwner` as course-level, never per-credential. Exactly the shape an org name needs.

Five touch points: `fetch.py` (populate), `credentials.json` (additive field), `page.py:172`
(per-record lookup, constant as fallback), `holder.py:59` `build_registry()` (carry it),
`_holder.js:264` `certUrlFor()` (read it).

**The catch:** `owner` is `"james"` — an alias, not an organization. No human-readable organization
name exists anywhere in this system, at any layer. So the LinkedIn org name is not a *precursor* to
the "course owner as issuing authority" work — it is a **consumer** of it, and cannot be finished
before that design lands.

---

## 7. The coupling worth knowing

*Pre-baked vs on-demand Holder Artifacts* and *store vs don't store recipient emails* are **the same
decision**, not two.

**(a) Store the association.** Andamio persists alias → email. Required if Holder Artifacts are
**pre-baked**, which is what ROADMAP currently plans (215 badge-holder pairs, cached). You cannot
pre-bake an artifact whose input nobody has supplied yet.

**(b) Collect at export time.** The holder enters their email in the export flow; `issuer-service`
hashes it and signs on demand. The email is an *input to signing*, never a stored fact. No database,
no PII at rest.

(b) fits this system better than expected. `issuer-service` already signs on demand gated on a live
Anchor Gate check — on-demand signing is the existing model, not a new one. It preserves the
stateless architecture. And it delivers what `end-user-ux-research.md:224` claims as the
differentiator: *"the recipient chooses, not the platform."* Andamio never holding recipient emails
is a positioning asset, not merely an engineering convenience.

Its cost: incompatible with pre-baking, and OB3 hashed identity involves a salt — confirm whether
unsalted `sha256(lowercased email)` interops with Credly before assuming byte-determinism is free.

**Deciding the artifact model settles the storage question.** Worth knowing before the database
question is re-opened on its own terms.

---

## 8. Open decisions — none of these are made

1. **Recipient identifier shape** — pseudonymous only, or additive hashed email on an export variant?
   Gates §3, §4, and HR import. *(Already logged: `mapping.md:115`, plan §182.)*
2. **Pre-baked vs on-demand Holder Artifacts** — settles §7, and with it whether any datastore is
   needed at all.
3. **Where issuer-organization data lives** — dbapi, committed JSON, or a new store (§6). Downstream
   of the renderer-vs-platform question.
4. **Is the org display name owner-editable or Andamio-approved?** It appears on third parties'
   profiles, so it is a trust surface, not a display string.
5. **Wording Gate:** may we name the course owner as LinkedIn's "organization" while `issuer.id` is
   Andamio? The attestation-host framing already separates the roles in the signed artifact and
   `courseOwner` is a real signed field — so it is *backed*. But LinkedIn's field reads as
   "this organization issued this" to an employer. Decidable, but it should be decided.
6. **How loudly to lead with third-party reach at all.** Every target in §3–§5 puts a learner's
   credential inside a SaaS silo — the model `end-user-ux-research.md` argues Andamio structurally
   improves on. Not an argument against doing it. But "where can people post and view this" and
   "who actually holds the credential" are different questions, and reach into Credly is reach on
   the incumbent's terms.

---

## 9. Suggested sequence, if this is pursued

The dependency graph is unusually clean:

**Holder Artifact → recipient identifier decision → Credly import spike.**

Those three unlock the largest audience for the least new work, and the first two are already on the
roadmap for independent reasons. Nothing in that chain is Credly-specific — it is the same
foundation Accredible ingestion and HR-system import need. Europass stays out of scope absent a
partner. The LinkedIn organization-name thread sits downstream of the same identifier and
issuer-identity work, which is a useful consolidation: **one cluster of product decisions gates the
entire external-display surface.**

---

## Sources

External documentation consulted 2026-08-02. None round-tripped against a live platform.

- [LinkedIn Add to Profile](https://addtoprofile.linkedin.com/)
- [LinkedIn Help — Add to Profile changes / autofill removal](https://www.linkedin.com/help/linkedin/answer/a528030)
- [Credly — How to Add an Outside Badge to Your Credly Profile](https://support.credly.com/hc/en-us/articles/30107800919707-How-to-Add-an-Outside-Badge-to-Your-Credly-Profile)
- [Credly — FAQs for Imported Badges](https://support.credly.com/hc/en-us/articles/33251711887643-FAQs-for-Imported-Badges)
- [Credly — support for Open Badge 3.0](https://learn.credly.com/blog/credly-supports-open-badge-3.0)
- [Accredible — Open Badge 3.0 and W3C VC support](https://www.accredible.com/newsroom/accredible-launches-support-for-open-badge-3-0-and-w3c-verifiable-credentials)
- [Europass — European Digital Credentials issuers](https://europa.eu/europass/en/europass-tools/digital-credentials/digital-credentials-issuers)
- [European Learning Model (ELM)](https://github.com/european-commission-empl/European-Learning-Model)
- [DEQAR — European Digital Credentials for Learning](https://docs.deqar.eu/stable/europass/)
- [Open Badges 3.0 Implementation Guide](https://www.imsglobal.org/spec/ob/v3p0/impl)
