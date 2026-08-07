# The badge registry — `badge_id` convention and invariants

**Status:** normative for the shipped system. Closes [#11](https://github.com/Andamio-Platform/credential-badges/issues/11) (deployment plan R5, Unit 6).

Every badge this project serves is named by a **`badge_id`**. A `badge_id` is not
a slug Andamio assigns; it is derived from the Cardano chain. This document
states what a `badge_id` is, where the registry that lists them lives, and the
invariants that hold for both — because a signed OB 3.0 credential references a
badge URL by that name **forever**.

---

## 1. The convention

```
badge_id = <course_id> "." <slt_hash>
```

| Segment | Bytes | Hex chars | What it is |
|---|---|---|---|
| `course_id` | 28 | 56 | The Cardano **minting policy id** of the course, created on-chain when an issuer creates the course. Also called `policy_id` in the README and `policyId` in credential `evidence`. |
| `slt_hash` | 32 | 64 | The course-state hash the on-chain local state commits to for the module. Not opaque: it is a Blake2b-256 composition over the module's Student Learning Target texts (see `issuer-service/src/slt-hash.ts` and `archive/mapping.md` §"gjames map"). |

Concretely:

```
203e63f457e0b8088073ec20959c4e0cc188cf90425d4f29ff3f817f.77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b
```

The pair is the identity of exactly one Andamio credential, which maps 1:1 to
one OB 3.0 `Achievement`. Both halves are on-chain-derived, so **no naming
authority exists and none is needed** — Andamio does not decide, allocate, or
arbitrate badge names. This is the same property Decision 2 relies on
elsewhere: the substantive authority is the course owner behind the
`course_id`, not Andamio.

### Relationship to the credential's `achievement.id`

The badge id and the OB 3.0 achievement URN carry the same two facts in
different shapes. They are **not** interchangeable strings:

```
achievement.id   urn:andamio:course:<course_id>:<slt_hash>
badge_id                            <course_id>.<slt_hash>
```

The URN keeps a `{local_state_type}` segment (`course`, `project`, future
types) that the `badge_id` drops; today every served badge is a `course`
credential. See §7 for what happens when that stops being true.

### The URL surface derived from one `badge_id`

`badge_id` is a **path stem**, not a filename. One stem fans out across the
static host (see `nginx/default.conf.template`, `location ^~ /badges/`):

| URL | What it serves | Origin |
|---|---|---|
| `/badges/{badge_id}` | The badge display / share page | committed `{badge_id}.html` |
| `/badges/{badge_id}.html` | The same page, direct hit | committed |
| `/badges/{badge_id}.svg` | The badge image referenced by `achievement.image` | committed, **or rendered on demand** via `@render` |
| `/badges/{badge_id}.png` | Download raster | committed build output |
| `/badges/{badge_id}.og.png` | 1200×630 Open Graph card | committed build output |
| `/badges/{badge_id}.embed.html` | The iframe embed document | committed |
| `/badges/{badge_id}/{alias}` | Holder viewer for one recipient | committed `_holder.html` shell |

Only `.svg` has an on-demand render fallback. Every other extension is
static-only and a miss is a clean 404 — deliberately, so a `.png` miss cannot
proxy to a render service that only speaks `.svg` and surface a 502.

---

## 2. Where the registry lives

There are three artifacts, in a deliberate build order. Only the first is
hand-touched.

| Artifact | Role | Shape |
|---|---|---|
| `generator/credentials.json` | **Source of truth.** One row per credential, refreshed from chain data by `make fetch`. | JSON array of `{course_id, slt_hash, course_title, module_title}` |
| `badges/_registry.json` | **Build output.** Emitted by `make badges` alongside the SVGs; consumed by the display pages, the holder viewer, and the embed. | JSON object keyed by `badge_id` → `{course_title, module_title, signed}` |
| `issuer-service/src/badge-registry.ts` | **The signing gate.** Loads `generator/credentials.json` and refuses a `(course_id, slt_hash)` pair that is not in it — *before* any chain read. | in-memory `Map<badge_id, BadgeEntry>` |

`badge_id` is the join key across all three. `badges/_registry.json` adds
exactly one field the source does not carry, `signed`, which drives honest
verified-state wording in the page, the holder viewer, and the
`<andamio-badge>` web component. It is presentation state, never a trust claim
in itself.

### Adding a badge

```bash
make fetch     # authed: refresh generator/credentials.json from chain data
make badges    # offline, deterministic: regenerate badges/ + _registry.json
make verify    # ring-geometry round-trip check
```

Then commit both `generator/credentials.json` and the regenerated `badges/`
output, and deploy by tag. Never hand-edit anything in `badges/`.

---

## 3. Invariants

These hold today and must keep holding. Several are enforced in code; the
enforcing site is named where one exists.

### I1 — Fixed shape, lowercase hex

`^[0-9a-f]{56}\.[0-9a-f]{64}$`. Enforced by `service/app.py` `BADGE_RE` for the
render path and by the holder-viewer location regex in
`nginx/default.conf.template`. A malformed stem is a 400 (render service) or a
404 (static host), never a render attempt.

### I2 — Case-sensitive, never normalized

`badge_id` is lowercase hex. An uppercase variant is a *different URL* that
404s. Nothing in the stack case-folds a badge id, and nothing should start:
case-folding would make two distinct URLs resolve to one artifact and quietly
weaken the "the URL is the identity" property.

### I3 — A published `badge_id` is permanent

A signed OB 3.0 credential carries `achievement.image` = the badge SVG URL.
Signed copies live in holders' hands indefinitely. Therefore a published
`badge_id`:

- is never renamed,
- is never deleted,
- is never repointed to a different credential.

This is the same rule as the context-version freeze
(`docs/solutions/conventions/never-mutate-published-jsonld-context.md`), one
level up: there the **bytes** are frozen, here the **id → credential mapping**
is frozen. See I4 for why the bytes are not.

### I4 — Presentation-only; never identity-bearing

The badge image is a *pointer*, not the credential's identity. The on-chain
anchor is the identity. Consequences that follow, and that must not be
"tidied up" later:

- Badge art is **mutable**. An issuer may refresh a graphic without
  invalidating any credential; the credential references the URL, not the
  bytes.
- Badges are served `Cache-Control: public, max-age=86400` — cached but
  explicitly **not** `immutable`, unlike `/context/*`.
- No badge byte ever enters a hash or signature that anchors credential
  identity.

I3 and I4 together are the whole rule: **the name is frozen, the picture is
not.**

### I5 — New content is a new `badge_id`, never an edit

Revising a module's SLT texts changes its `slt_hash`, which changes the
`badge_id`, which is a new URL. There is no in-place "version 2" of a badge and
no version segment in the path. This is why the convention is version-precise
for free — a course revision produces a distinguishable achievement, not a
silent update (empirically demonstrated 2026-05-12, `archive/mapping.md`).

### I6 — One `badge_id` → one credential, stored as a length-1 list

Deployment plan R5: the data model stores a credential **list**, but v1 only
ever emits length-1 lists. The list shape is forward-compatibility for a
future multi-credential badge ("this badge covers modules A, B, and C"). **No
multi-credential logic or UX exists**, and none should be inferred from the
shape. Anything that reads the registry today may assume exactly one
credential per `badge_id`; anything that *writes* it must not assume the
assumption is permanent.

### I7 — Build output, never hand-authored

*"If it can be generated, it must be generated."* Every file in `badges/` is
rendered deterministically from chain data by `generator/`. A hand-edit is
lost on the next `make badges` and breaks `make verify` (the ring geometry no
longer round-trips to the on-chain hashes).

### I8 — Registry membership gates **signing**, not **rendering**

A deliberate asymmetry, easy to trip on:

- **Signing is closed.** `issuer-service/src/badge-registry.ts` refuses an
  unregistered `(course_id, slt_hash)` pair before any chain read. The issuer
  service signs credentials for *registered* badges only.
- **Rendering is open.** `service/app.py` renders any well-formed pair on
  demand, whether or not it is in `generator/credentials.json`, because the
  point of #33 was that no badge has to be pre-generated.

So "the badge image resolves" is **not** evidence that the badge is
registered, and vice versa. The one place they meet is the issuer service's
anchor gate, which HEADs the live badge URL and refuses to sign if it does not
return 200 (`issuer-service/src/anchor.ts`) — registration and served artifact
must both hold before a signature exists.

### I9 — Withheld courses are excluded on both paths

`generator/build.py` `SKIP_COURSES` is the single source of truth for courses
deliberately held back from publication. `service/app.py` checks it *before*
the cache read, so a previously cached object for a now-withheld course is not
served. Any new badge-serving path must honour the same list, or it publishes
art the project withheld.

### I10 — `_`-prefixed names inside `badges/` are reserved

`_holder.html`, `_holder.js`, `_placeholder.svg`, `_registry.json` are
infrastructure, not badges. The reservation is free: a `badge_id` always
starts with a hex digit, so it can never collide with a `_` name. Keep new
infrastructure files under the `_` prefix.

### I11 — `badge_id` does not encode the network

**Known wart, deliberately tolerated.** A Cardano policy id is a script hash
and is network-independent, so nothing in a `badge_id` says mainnet or
preprod. The render service copes by trying its configured `BADGE_NETWORKS`
**in order** and treating `unresolvable` / `not_found` as "maybe the wrong
network, try the next".

Why it is tolerated: mainnet is production-implicit under the URN convention
(`archive/mapping.md`), the issuer service pins `NETWORK = "mainnet"` as a
build-time constant, and the credential itself carries `evidence.network`
explicitly — so nothing *trust-affecting* depends on inferring the network
from the URL. What would force a change: serving mainnet and preprod badges
for the *same* policy id from one host. That would need a network segment in
the path, which is a new URL space for new badges only — never a rename of an
existing one (I3).

---

## 4. What a `badge_id` is not

- **Not the credential id.** That is
  `urn:andamio:credential:{network}:{course_id}:{slt_hash}:{studentStateAsset}`
  — it includes the recipient. A `badge_id` is recipient-independent: one badge
  image serves every holder of that credential.
- **Not the achievement URN.** See §1; the URN keeps the `local_state_type`
  segment.
- **Not a slug.** There is no human-readable badge naming scheme, and adding
  one would create a namespace Andamio has to arbitrate (uniqueness, renames,
  squatting, trademark). See §5.
- **Not stable across Andamio deployments.** The `slt_hash` composition is
  salted with the deployment's `ls_cs`, so the same SLT texts under a different
  Andamio deployment produce a different `slt_hash` and therefore a different
  badge (`archive/mapping.md`, "the hash is deployment-bound").

---

## 5. Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Human-readable slugs (`gimbalabs-plutus-pbl-01`) | Creates a namespace Andamio must arbitrate — uniqueness, renames, squatting, disputes. Reintroduces exactly the "Andamio is the authority" posture Decision 2 removed. Discarded before first commit (2026-05-25); no rename was ever needed. |
| A version segment (`{course_id}.{slt_hash}.v2.svg`) | Redundant: a revision already changes `slt_hash` (I5). A separate version counter would be a second, weaker source of truth. |
| Recipient in the path | Would multiply identical images per holder and break caching. The recipient lives in the credential and in the holder viewer subpath (`/badges/{badge_id}/{alias}`), not in the badge identity. |
| Content-addressed image names (IPFS CID as the id) | The id would then change whenever the *art* changed, violating I3/I4 — the name must be frozen while the picture stays mutable. IPFS remains open as a *storage* option for badge art (`docs/brainstorms/2026-06-27-issuer-badge-customization-requirements.md`), which is a different question. |

---

## 6. Per-org vs shared hosting (the one open question from #11)

Issue #11's remaining open decision is whether issuer-org-owned badges live in
this repo under Andamio's host, or in per-issuer paths / per-issuer repos.
That decision is **coupled to the per-org issuer DID design** and is answered
there, not here:
[`docs/plans/2026-07-28-001-design-per-org-issuer-dids.md`](plans/2026-07-28-001-design-per-org-issuer-dids.md) §7.

The short version, and the part that binds this document: **whatever is decided
about per-org hosting must not change an existing badge URL.** I3 is
unconditional. A per-org badge path, if one is ever introduced, is a new URL
space for new badges, served alongside `/badges/` forever.

---

## 7. Forward compatibility

Two known extensions, neither built:

- **Non-course local-state types.** `project` credentials use
  `{project_id}.{state_hash}` — structurally identical (56 hex + 64 hex), so the
  path shape already accommodates them without change. What is *not* determined
  is whether a `project` badge and a `course` badge could ever collide: they
  would need the same policy id and the same 32-byte state hash, which is not
  reachable in practice. If a future `local_state_type` breaks the 28/32-byte
  shape, it needs its own path space, not a widened regex.
- **Multi-credential badges.** See I6. The list shape is reserved; the logic is
  not built.

---

## Related

- [`README.md`](../README.md) — "How badges resolve" (static-first + render fallback)
- [`generator/README.md`](../generator/README.md) — the generation pipeline
- [`MOC.md`](../MOC.md) — repo map
- [`docs/cache.md`](cache.md) — render-cache TTLs, orphan guard, `cache-admin`
- [`archive/credential-imagery.md`](../archive/credential-imagery.md) — the v1 imagery design decision
- [`archive/mapping.md`](../archive/mapping.md) — the full Andamio → OB 3.0 field mapping and the URN convention
- [`docs/solutions/conventions/never-mutate-published-jsonld-context.md`](solutions/conventions/never-mutate-published-jsonld-context.md) — the sibling freeze rule for published contexts
