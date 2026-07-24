---
title: "feat: v1.2 static badge display / share page per badge (nginx route + OG tags)"
status: active
date: 2026-07-24
type: feat
issue: "#70"
parent: "Andamio-Platform/product-circle#123 (Credential Badges v1.2, Track A)"
---

# feat: v1.2 static badge display / share page per badge (nginx route + OG tags)

## Summary

Generate one **static HTML display / share page per credential** from the registry (`generator/credentials.json`), served by the existing nginx static host at the **extensionless URL `/badges/{course_id}.{slt_hash}`**. The page carries **server-delivered Open Graph tags** in its `<head>` (title, description, absolute `og:image` pointing at the 1200×630 card from #69, dimensions, `twitter:card`, `theme-color`) so a shared badge link unfurls with image + title on X, LinkedIn, Discord, and Slack — where crawlers do not run JS.

This is the **badge-class page**: the substrate the share actions (#71) and explainers (#72) hang on, with a URL scheme the holder-grain viewer (#73) nests under (`/badges/{stem}/{alias}`). It registers HTML as a new generated artifact type covered by the #69 self-pruning reconciler + CI orphan guard, and adds one nginx location — **without moving the existing `.svg`/`.png` URLs**, which credentials reference forever.

---

## Problem Frame

The badge SVG/PNG/OG-card artifacts exist (#69), but there is no **page** to share — a URL a human lands on, and that a social crawler can unfurl. The presentation issues downstream all need it:

- **#71 (share actions)** hangs its download / copy / social / Web Share / embed / add-to-profile controls on this page.
- **#72 (explainers)** links its "How do I share this?" / "How do I check this?" pages from it.
- **#73 (holder viewer)** nests under this page's URL scheme.

Social unfurl is the forcing function: Slack range-fetches ~32 KB, WhatsApp reads `<head>` in the first 300 KB, and none run JS — so the Open Graph tags must be in the **server-delivered HTML**. Static generation from the registry gives this for free and keeps the web root a static, allowlisted, CODEOWNERS-gated trust surface, consistent with the current host.

**Hard constraint:** the existing `/badges/{stem}.svg` (and `.png`, `.og.png`) URLs must stay byte-for-byte reachable and unchanged — an OB 3.0 credential references its image URL for life. The page takes the **extensionless** sibling URL only.

---

## Requirements

Traced from issue #70:

- **R1** — One static HTML page per non-skipped registry credential, generated from `credentials.json`, written into the served `badges/` tree.
- **R2** — The page is served at the **extensionless** URL `/badges/{course_id}.{slt_hash}` (one nginx location addition). `text/html` content type.
- **R3** — Existing `/badges/{stem}.svg` image URLs (and `.png` / `.og.png`) are **byte-for-byte unaffected** and still served exactly as before (SVG keeps its static-first + `@render` fallback).
- **R4** — Server-delivered Open Graph tags in `<head>`, early: `og:title` (credential title), `og:description` (wording-gated), `og:image` (absolute HTTPS URL to the `.og.png` card), `og:image:width`=1200 / `og:image:height`=630, `og:type`, `og:url`, `twitter:card=summary_large_image`, `theme-color`.
- **R5** — The page renders the badge (its `.svg` image), the credential title, course, and issuer, and is designed as the **badge-class page** with a URL scheme the holder viewer (#73) nests under (`/badges/{stem}/{alias}`) — so #73 is not a separate build.
- **R6** — HTML is registered as a generated artifact type covered by the **#69 self-pruning reconciler + CI orphan guard** (`reconcile.py`); dropping a credential prunes its `.html` too. (The issue: do not add the page before pruning covers it.)
- **R7** — A shared badge URL unfurls with image + title in the X, LinkedIn, Discord, and Slack preview validators (manual acceptance); the served content type + OG tags are asserted in the docker smoke test.

**Wording gate (throughout any verifiability-adjacent copy):** "DI-capable OB 3.0 / VC verifiers," never "any OB3 verifier."

---

## Key Technical Decisions

### KTD-1 — Page lives at `badges/{stem}.html`, served extensionless via `try_files $uri.html`
The generated file is `badges/{course_id}.{slt_hash}.html`. nginx serves it at the extensionless `/badges/{stem}` by adding `$uri.html` to the page location's `try_files`. `badges/` is already allowlisted and `COPY`'d wholesale into the image (#69), so `.html` files ship with **no Dockerfile or allowlist change** — same as the PNGs. The `.svg`/`.png` URLs are untouched (R3).

### KTD-2 — Restructure the `/badges/` nginx block into extension-scoped nested locations
Today `location ^~ /badges/` does `try_files $uri @render` (SVG static-first + render fallback) with a nested `.png` static-only block. To add the extensionless HTML page without disturbing `.svg`, move the SVG behavior into its own nested `location ~ \.svg$` and make the **outer block default to the page**:

```
location ^~ /badges/ {
    add_header Cache-Control "public, max-age=86400";
    # extensionless {stem} -> the generated display page
    try_files $uri $uri.html =404;

    location ~ \.svg$  { … try_files $uri @render; }   # unchanged behavior (#33)
    location ~ \.png$  { … try_files $uri =404; }      # unchanged (#69)
    location ~ \.html$ { … try_files $uri =404; }      # direct .html access
}
```

*(Directional — the implementer writes the real directives.)* The `^~` prefix still owns `/badges/`; nested regex locations select by extension; the extensionless request matches no nested location and falls to the outer `try_files`. The existing `scripts/ci/test-nginx-fallback.sh` (`.svg` miss → `@render`) must still pass.

### KTD-3 — Content type for the extensionless page comes from the `try_files` internal redirect
When `try_files $uri $uri.html` matches `{stem}.html`, nginx internally redirects to that `.html` URI and recomputes the type from `.html` → `text/html` (stock `mime.types`). This is the standard clean-URL pattern; **verify in the docker smoke test** that `/badges/{stem}` returns `Content-Type: text/html`. If the type resolves wrong (some setups need it), pin it with an explicit `default_type text/html; charset utf-8;` on the page path — an execution-time confirmation, not an assumption.

### KTD-4 — Page generation is a new Python generator (`generator/page.py`), reusing palette + title sanitizing
Mirror `generator/og.py`/`build.py`: read `credentials.json` (minus `SKIP_COURSES`), and per record emit a self-contained HTML file reusing `colors.palette_for` (theme-color + accents) and `render.sanitize_title` (titles into the embedded glyph subset / clean text). No external assets — inline CSS keeps each page one file and the web root a pure static surface. `make pages` target orchestrates it.

### KTD-5 — Absolute `og:image` on the known public host
`og:image` must be an absolute HTTPS URL: `https://credentials.andamio.io/badges/{stem}.og.png` (the forever-public host, per `did:web:credentials.andamio.io` and the served `context` URLs). `og:url` is `https://credentials.andamio.io/badges/{stem}`. The host constant lives in the generator (single source), matching how `gen.py` already hardcodes `https://credentials.andamio.io/context/v1.jsonld`.

### KTD-6 — Self-pruning covers `.html` by adding one suffix
`reconcile.py`'s `KNOWN_SUFFIXES` becomes `(".og.png", ".png", ".svg", ".html")` (order only matters for the `.og.png`-before-`.png` longest-match; `.html` is unambiguous). A dropped credential's `.html` then prunes like its other artifacts, and the CI orphan guard covers it — satisfying the issue's "do not ship the page before pruning covers it" (R6).

### KTD-7 — Reserve `/badges/{stem}/{alias}` for the holder viewer (#73); do not implement it here
The page URL is `/badges/{stem}` (a "file"), leaving `/badges/{stem}/{alias}` (a subpath) free for #73's per-holder viewer. This plan neither serves nor generates the `{alias}` subpath — it only avoids a scheme that would collide with it. Noted so #73 nests rather than rebuilds.

---

## High-Level Technical Design

Generation mirrors the existing offline generator; serving adds extension-scoped routing under the existing `/badges/` prefix.

```mermaid
flowchart TD
    R[credentials.json] --> P[page.py<br/>per record → HTML + OG tags]
    P --> H[badges/*.html]
    R --> RC[reconcile.py<br/>KNOWN_SUFFIXES += .html]
    RC -->|prune orphans across svg/png/og.png/html| B[(badges/)]
    H --> B

    subgraph NGINX["location ^~ /badges/"]
      direction TB
      REQ{request path} -->|"{stem} (extensionless)"| PAGE["try_files $uri $uri.html =404<br/>→ badges/{stem}.html (text/html)"]
      REQ -->|"{stem}.svg"| SVG["try_files $uri @render<br/>(static-first + render, #33)"]
      REQ -->|"{stem}.png / .og.png"| PNG["try_files $uri =404 (#69)"]
    end

    B -.served by.-> NGINX
    PAGE -->|og:image absolute| CARD[https://credentials.andamio.io/badges/{stem}.og.png]
```

---

## Implementation Units

### U1. Static page generator (`generator/page.py`) + `make pages`

**Goal:** Generate one self-contained HTML display/share page per non-skipped credential, with server-delivered Open Graph tags and a clean branded layout designed as the badge-class page.

**Requirements:** R1, R4, R5, KTD-4, KTD-5, KTD-7.

**Dependencies:** none (builds on the committed `badges/*.svg` and `.og.png` from #69).

**Files:**
- `generator/page.py` (new)
- `generator/tests/test_page.py` (new)
- `Makefile` (modify — add `pages` target + help)

**Approach:**
- Read `credentials.json`, filter `SKIP_COURSES` (import from `build.py`). Per record, build an HTML document:
  - `<head>`: `<meta charset>`, `<title>`, the full OG/Twitter tag set (KTD-5 absolute URLs), `theme-color` from `colors.palette_for(course_id)`, and inline `<style>`.
  - `<body>`: the badge image (`<img src="{stem}.svg" …>` — relative, so it resolves against `/badges/`), the sanitized credential title (`render.sanitize_title(module_title)`), course title, issuer ("Andamio"), and placeholder anchor slots where #71 (share actions) and #72 (explainer links) will attach — clearly marked, non-functional now.
  - Wording-gated verifiability copy uses "DI-capable OB 3.0 / VC verifiers."
- Write `badges/{course_id}.{slt_hash}.html`. `make pages` iterates the non-skipped registry.
- Escape all interpolated text (reuse `gen.esc`).

**Patterns to follow:** `generator/og.py` (registry iteration, palette + font reuse, `SKIP_COURSES` import, `_card_svg` structure); `generator/build.py` `main()` shape; `render.sanitize_title`.

**Test scenarios (`test_page.py`, stdlib-only, runnable directly):**
- Happy path: `page.py`'s per-record builder emits a well-formed HTML doc containing `<!doctype html>`, `<title>`, and `</html>`.
- OG tags present: the head contains `og:title`, `og:description`, `og:image` (absolute `https://credentials.andamio.io/badges/{stem}.og.png`), `og:image:width` = 1200, `og:image:height` = 630, `og:url`, `twitter:card` = `summary_large_image`, and a `theme-color`.
- Badge + titles: body references `{stem}.svg`, the sanitized module title, and the course title.
- theme-color palette: the `theme-color` value matches `colors.palette_for(course_id)`.
- Escaping: a title with `&`/`<`/`"` is HTML-escaped (no raw injection into the page).
- Glyph-subset safety: an out-of-subset title character is sanitized (matches og.py's discipline).
- Wording gate: no page contains the string "any OB3 verifier".
- `Covers R4.` The delivered HTML carries the full OG tag set in `<head>`.

**Verification:** `make pages` writes one `.html` per non-skipped record; opening one locally shows the badge + title; the head carries the OG tag set with absolute image URLs.

---

### U2. Self-pruning + orphan guard cover `.html`

**Goal:** Register `.html` as a generated artifact type so a dropped credential's page prunes with its other artifacts and CI fails on an orphan page. Prerequisite for shipping the page (R6).

**Requirements:** R6, KTD-6.

**Dependencies:** U1 (the artifact type exists).

**Files:**
- `generator/reconcile.py` (modify — add `.html` to `KNOWN_SUFFIXES`)
- `generator/tests/test_reconcile.py` (modify — extend the cross-type prune case to `.html`)

**Approach:**
- Add `".html"` to `KNOWN_SUFFIXES`. `split_stem` already handles any known suffix + strict `<56hex>.<64hex>` stem; `.html` is unambiguous (no longest-match collision). `build.py`'s post-write prune and `make reconcile` / `--check` then cover pages automatically; the `orphan-guard` CI job needs no change.
- Extend `test_reconcile.py::test_orphan_pruned_across_all_types` (and the happy-path fixture) to include a `.html` artifact for the stem.

**Patterns to follow:** the existing `KNOWN_SUFFIXES` handling and `test_reconcile.py` cross-type cases (added in #69).

**Test scenarios (`test_reconcile.py`):**
- Cross-type prune includes html: a dropped stem's `.svg` + `.png` + `.og.png` + `.html` are all pruned (extends the R6 case).
- In-registry html kept: a `{stem}.html` whose stem is in the registry survives.
- Strict-key safety unchanged: a malformed `.html` name (bad stem) is skipped, never deleted.
- `Covers R6.` Registry drop prunes the page along with the image artifacts.

**Verification:** dropping a record and running `make reconcile` removes its `.html`; `reconcile.py --check` (the `orphan-guard` job) flags a committed orphan `.html`.

---

### U3. nginx route: extensionless page + preserved `.svg`/`.png` + docker smoke

**Goal:** Serve `/badges/{stem}` as the HTML page (`text/html`) while `.svg` keeps its static-first + `@render` behavior and `.png` its static-only 404 — verified on the built image.

**Requirements:** R2, R3, R7, KTD-1, KTD-2, KTD-3.

**Dependencies:** U1 (pages exist to serve).

**Files:**
- `nginx/default.conf.template` (modify — restructure the `/badges/` block per KTD-2)
- `.github/workflows/ci.yml` (modify — docker smoke: assert the page URL + content type; confirm `.svg` unchanged)
- `scripts/ci/test-nginx-fallback.sh` (verify still passes; adjust only if the restructure requires it)

**Approach:**
- Restructure `location ^~ /badges/` (KTD-2): outer default `try_files $uri $uri.html =404` for the extensionless page; nested `~ \.svg$` carries the existing `try_files $uri @render`; nested `~ \.png$` keeps `try_files $uri =404`; add nested `~ \.html$` static-only (direct `.html` access). Preserve the `Cache-Control` header on every path.
- Docker smoke test additions: `GET /badges/{real-stem}` returns `Content-Type: text/html` and a body containing `og:image` and the credential title; `GET /badges/{real-stem}.svg` still returns `image/svg+xml` (byte-for-byte path unchanged); the `.svg` `@render` fallback (`test-nginx-fallback.sh`) still passes.
- Keep the web root allowlisted/CODEOWNERS-gated — no new top-level served path.

**Patterns to follow:** the existing `assert_ct` helper and `docker-build` smoke job; the nested-location pattern established for `.png` in #69; `test-nginx-fallback.sh`.

**Test scenarios (docker smoke, on the built image):**
- Happy path: `/badges/{stem}` → 200, `Content-Type: text/html`, body contains `<meta property="og:image"` and the credential title.
- SVG unchanged: `/badges/{stem}.svg` → 200, `image/svg+xml` (regression guard for R3).
- SVG fallback intact: a `.svg` cache-miss still proxies to `@render` (existing `test-nginx-fallback.sh` green).
- PNG unchanged: `/badges/{stem}.png` → `image/png`; a `.png` miss → 404 (from #69, must still hold).
- Extensionless miss: `/badges/{nonexistent-stem}` → 404 (not a proxy/502).
- `Covers R2 / R3.` Page served extensionless as text/html; image URLs unmoved.

**Verification:** the `docker-build` job is green with the new assertions; `/badges/{stem}` unfurls its `<head>` OG tags; `.svg`/`.png` behavior is byte-identical to pre-#70.

---

### U4. CI wiring + docs

**Goal:** Run the page tests in CI, guard page completeness, and document the new page artifact + URL.

**Requirements:** R1, R6.

**Dependencies:** U1, U2, U3.

**Files:**
- `.github/workflows/ci.yml` (modify — add `test_page.py` to the `generator-tests` job)
- `imaging/check-artifacts.ts` (modify — extend the coverage guard so every badge SVG also has a matching `.html` page)
- `generator/README.md` (modify — document `make pages`, the page artifact, and the extensionless URL)
- `CONCEPTS.md` (modify only if a new canonical term is warranted — e.g., "Badge Page")

**Approach:**
- Add `python3 generator/tests/test_page.py` to the `generator-tests` job (stdlib-only, hermetic — keeps the job's no-install property).
- Extend `imaging/check-artifacts.ts`'s per-SVG coverage check to also require `{stem}.html` exists (existence only; HTML has no dimensions). This pins the 1:1 svg:page mapping alongside the existing svg:png:og.png checks and catches a page that was never generated. (The `.html` is text, not raster — no byte-floor.)
- `generator/README.md`: add `make pages` to the pipeline table, describe the `.html` artifact and the extensionless `/badges/{stem}` URL, and note the reserved `/badges/{stem}/{alias}` for #73.

**Patterns to follow:** the `generator-tests` job wiring and `check-artifacts.ts` structure (both from #69); `generator/README.md` pipeline table.

**Test scenarios:**
- `generator-tests` runs `test_page.py` and it passes in CI.
- `check-artifacts.ts` fails if a committed badge SVG has no matching `.html` page (planted-gap check) and passes on the complete set.
- `Covers R1.` One page per non-skipped badge, enforced in CI.

**Verification:** all CI jobs green; deleting a committed `.html` (leaving its SVG) turns the coverage check red; `generator/README` documents the page pipeline.

---

## Scope Boundaries

**In scope:** the per-credential static HTML page, its server-delivered OG tags, the extensionless nginx route, self-pruning coverage for `.html`, and CI/docs wiring.

**Out of scope (separate v1.2 issues):**
- **Share actions** — downloads, copy link, social intents, Web Share, embed, LinkedIn add-to-profile (#71). This plan leaves marked placeholder slots only.
- **The two explainers** — "How do I share this?" / "How do I check this?" (#72). The page will link them once they exist.
- **Holder-grain viewer** at `/badges/{stem}/{alias}` (#73) — this plan only reserves the scheme (KTD-7).
- **`andamio-badge` web component** (#74).

### Deferred to Follow-Up Work
- **Page visual polish / richer layout** beyond a clean branded display — the page is intentionally minimal until #71/#72 attach their controls and copy.
- **A page-level byte-parity or snapshot test** — deferred; `test_page.py` asserts structure/content, and pages are deterministic from the registry.

---

## Risks & Mitigations

- **Extensionless page mis-types as `octet-stream`.** *Mitigation:* KTD-3 — the `try_files` internal redirect recomputes type from `.html`; the docker smoke test asserts `text/html`, and an explicit `default_type text/html` is the fallback if a given nginx build needs it.
- **nginx restructure breaks the `.svg` render fallback or `.png` 404.** *Mitigation:* KTD-2 keeps each behavior in its own nested location; the existing `test-nginx-fallback.sh` and the #69 `.png` smoke assertions must stay green (regression guards in U3).
- **Shipping the page before self-pruning covers it (reopens #31 for a new type).** *Mitigation:* U2 lands `.html` in `KNOWN_SUFFIXES` and is a stated dependency; the issue's own reconciliation makes this a hard gate.
- **`og:image` served as a non-absolute or wrong-host URL → no unfurl.** *Mitigation:* KTD-5 pins the absolute public-host URL from a single generator constant; R7 validates via the social preview validators and the smoke test asserts the tag is present.
- **A credential title with markup breaks the page or injects.** *Mitigation:* all interpolated text is HTML-escaped (`gen.esc`) and glyph-sanitized (U1 test scenarios).

---

## Dependencies / Prerequisites

- **#69 shipped** (this repo, `main`): the `.og.png` cards the page points at, the `reconcile.py` self-pruning the page plugs into, and the nginx `/badges/` nested-location pattern this extends. All present.
- Python 3 stdlib only for `page.py` (keeps `generator-tests` hermetic).
- The forever-public host `credentials.andamio.io` (unchanged).

---

## Sources & Research

- Issue **#70** (origin); parent product-circle#123 (v1.2 Track A). Downstream consumers: #71, #72, #73, #74.
- `nginx/default.conf.template` — the current `location ^~ /badges/` block (SVG static-first + `@render`, nested `.png` static-only from #69); the extensionless page adds one more nested-location layer.
- `generator/og.py`, `generator/build.py`, `generator/colors.py` (`palette_for`), `generator/render.py` (`sanitize_title`), `generator/gen.py` (`esc`, the `https://credentials.andamio.io/…` host constant) — the generation patterns and reused helpers.
- `generator/reconcile.py` (`KNOWN_SUFFIXES`, `split_stem`) and `generator/tests/test_reconcile.py` — the self-pruning this registers `.html` into (both from #69).
- `imaging/check-artifacts.ts` — the coverage guard extended for page completeness.
- `.github/workflows/ci.yml` (`generator-tests`, `docker-build` + `assert_ct`), `scripts/ci/test-nginx-fallback.sh`, `Dockerfile` + `scripts/ci/check-allowlist.sh` (badges/ already allowlisted).
- `CONCEPTS.md` (Flagship Badge, Baking) — the page is presentation-only, never identity-bearing.
- OB 3.0 baking context: the page's `og:image` is the `.og.png` from #69; the SVG remains the verifiable-credential carrier.
