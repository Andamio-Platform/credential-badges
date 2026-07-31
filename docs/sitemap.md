# Sitemap — everything served at `credentials.andamio.io`

Every public URL this repo serves, what produces it, and whether it may change.
Counts are as of the current `generator/credentials.json` (62 records, 4 skipped
by `SKIP_COURSES`, so **58 credentials**).

**Two rules govern this whole surface.** Nothing is served unless the
`Dockerfile` explicitly `COPY`s it and `scripts/ci/check-allowlist.sh` lists it —
`COPY .` is banned, because this host is forever-public. And anything a
credential references by URL is permanent: a badge in the wild names its context
and signing key by URL for life.

Related: [`MOC.md`](../MOC.md) maps components; this maps **URLs**.
[`DEPLOY.md`](../DEPLOY.md) covers how they ship.

---

## Trust surface — referenced by credentials, permanent

These exist because a signed credential points at them. Breaking one breaks
verification for every badge already issued.

| URL | Source | Mutable? | What it is |
|---|---|---|---|
| `/context/v1.jsonld` | `context/v1.jsonld` | **no** — frozen, sha256-pinned | The current signing context. Every signed credential references it. New terms ship as `v2`, never as an edit |
| `/context/v0.jsonld` | `context/v0.jsonld` | **no** — frozen forever | Retired context. Mutated in place once (2026-07-21); that incident is why v1 exists. Serves 200 forever; nothing signs against it |
| `/.well-known/did.json` | `.well-known/did.json` | yes — on key rotation | The `did:web:credentials.andamio.io` document. Publishes the issuer signing key (`#key-2026-07`) |
| `/did.json` | same file | yes | Bare-domain alias. Some resolvers fetch here instead of `/.well-known/`; the 1EdTech validator is one |
| `/issuer` | `issuer/profile.jsonld` | yes | Hosted OB 3.0 issuer Profile, typed `["Profile","AttestationHost"]`. Extensionless, served as `application/ld+json` |
| `/status/key-epoch-2026-07.json` | `status/` | yes — **this is the kill switch** | Signed `BitstringStatusList`. One bit per signing-key version. Flipping a bit suspends every credential signed under that key — see [`runbooks/key-compromise.md`](runbooks/key-compromise.md) |

## Credential pages — 58 of each

Keyed `{course_id}.{slt_hash}` (56 hex + `.` + 64 hex), the `badge_id` convention
in [`badge-registry.md`](badge-registry.md). Every variant below is the same stem
with a different suffix.

| URL | Count | Source | What it is |
|---|---|---|---|
| `/badges/{stem}` | 58 | `generator/page.py` | **The share page.** Extensionless. Canon design since `v1.3.1` |
| `/badges/{stem}.svg` | 58 | `generator/build.py` | **The credential itself** — carries the signed OB 3.0 VC. Everything else here is presentation |
| `/badges/{stem}.png` | 58 | `imaging/rasterize.ts` | Display raster, 1024×1024 |
| `/badges/{stem}.og.png` | 58 | `generator/og.py` + `imaging/` | 1200×630 social card — the `og:image` of the share page, and the first Andamio surface anyone sees when a link is shared |
| `/badges/{stem}.embed` | 58 | `generator/page.py` | 340×380 iframe variant for third-party sites |
| `/badges/{stem}/{alias}` | dynamic | `generator/holder.py` | **The per-holder view.** One static shell (`_holder.html`) served for any holder path; its JS resolves live on-chain state and renders a verdict for that `(badge, holder)` pair plus every badge the holder holds |

A `/badges/*.svg` miss proxies to the render service (`@render`), which renders
on demand and caches to GCS — see [`cache.md`](cache.md).

## Standalone pages

| URL | Source | What it is |
|---|---|---|
| `/badges/how-to-share` | `generator/explainers.py` | Holder-facing: what the badge proves, and every way to share it |
| `/badges/how-to-check` | `generator/explainers.py` | Verifier-facing: how to confirm a badge **without trusting Andamio**. Wording-gated — it must never imply every badge carries a checkable signature |
| `/design/` | `public/` | The interactive credential designer. A hand-built app, not generator output |
| `/embed/andamio-badge.js` | `web-component/` | The `<andamio-badge>` web component a third party loads to embed a badge. Byte-identical to its npm source; CI pins them equal |
| `/` | nginx | Plain-text pointer page. Keeps health probes trivial |
| `/README.md` | `README.md` | Served verbatim |

## Not public URLs

Underscore-prefixed files in `badges/` are infrastructure — the reconciler and
orphan-guard skip them:

| File | Role |
|---|---|
| `_holder.html` | The holder-viewer shell, served for `/badges/{stem}/{alias}` |
| `_holder.js` | Its client module |
| `_registry.json` | `stem -> {course_title, module_title, signed}`, so the viewer can name a holder's badges without 58 page fetches |
| `_placeholder.svg` | Fallback art |

`/holder-api/` is a **same-origin proxy**, not a page: andamioscan sends no CORS
headers, so the holder viewer reads live state through it. Read-only — every
method except GET is denied.

## Design conformance — where the canon has and hasn't reached

| Surface | State |
|---|---|
| `/badges/{stem}` share page | ✅ canon (`v1.3.1`) |
| `/badges/how-to-share`, `/badges/how-to-check` | ✅ canon |
| `/badges/{stem}/{alias}` holder viewer | ✅ canon (tokens only — `#89` will re-lay-out it) |
| `/badges/{stem}.og.png` | ❌ still the per-course dark field. Its own plan; two open questions (per-course or single) |
| `/badges/{stem}.embed` | ❌ deliberately excluded — it renders inside *someone else's* page, where matching our brand is a different question |
| `/design/` | ❌ deferred by decision. Note it is the **only** surface loading external stylesheets (two Google Fonts families), which breaches the no-external-assets invariant the other pages hold |

---

## Keeping this honest

These counts and routes were derived from `nginx/default.conf.template`, the
`Dockerfile` allowlist, and the committed tree — not from memory. They will drift
the moment a route is added, and nothing currently fails when they do.

Making this file generated and pinned (the way `tools/context-freeze.test.ts`
pins contexts and `test_page.py` pins the page count) is the obvious next step
and deliberately not done here — a hand-written map that is accurate today beats
no map, and the generator is a separate piece of work.
