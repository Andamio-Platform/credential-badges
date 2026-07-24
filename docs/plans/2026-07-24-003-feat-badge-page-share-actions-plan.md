---
title: "feat: v1.2 share actions on the badge page (downloads, copy, social, Web Share, embed, LinkedIn)"
status: active
date: 2026-07-24
type: feat
issue: "#71"
parent: "Andamio-Platform/product-circle#123 (Credential Badges v1.2, Track A)"
---

# feat: v1.2 share actions on the badge page (downloads, copy, social, Web Share, embed, LinkedIn)

## Summary

Fill the `data-slot="share-actions"` region reserved on the badge display page (#70) with the share controls: **download SVG** (the credential itself) and **PNG**, **copy link**, **share to X / LinkedIn** (pure intent URLs, no API keys), **Web Share** (mobile-native sheet, progressive enhancement), **copy embed code** (an iframe against a minimal per-badge embed variant), and a **LinkedIn add-to-profile** deep link. All controls are generated per badge into the static page by `generator/page.py`, with a small self-contained inline `<script>` for the three JS-dependent actions (copy link, Web Share, copy embed). No API keys, no runtime service.

The one new artifact type is a **minimal embed page** per badge (`badges/{stem}.embed.html`) that the iframe snippet targets — served for free by #70's existing extensionless routing (`/badges/{stem}.embed` → `{stem}.embed.html`) and folded into the self-pruning reconciler.

---

## Problem Frame

#70 shipped the badge display page with an empty share-actions slot. #71 makes the page actually *shareable*: a holder can download their credential, copy a link, push it to X / LinkedIn, use the native mobile share sheet, grab an embed snippet for their own site, and start a LinkedIn "add certification" flow. These are the controls the page exists to host.

Design constraints from the issue:
- **No API keys / no runtime service.** Social sharing is pure intent URLs; Web Share and clipboard are browser APIs. The page stays static.
- **All preview quality lives in the OG tags** (#70), not these buttons — a shared link unfurls from the page's `<head>`.
- **The SVG *is* the verifiable credential** — the download-SVG control must say so; the PNG is "for display."
- **LinkedIn add-to-profile is a deep link only** — LinkedIn deprecated per-cert autofill, so it lands on a (mostly blank) form; no autofill promise. It targets the **Andamio Teams** org; the numeric `organizationId` is an external input a Page admin must read from the admin console.
- **Wording gate** on any verifiability-adjacent copy: "DI-capable OB 3.0 / VC verifiers," never "any OB3 verifier."

---

## Requirements

Traced from issue #71:

- **R1** — **Download SVG**: a control that downloads `/badges/{stem}.svg`, with copy stating the baked SVG *is* the verifiable credential.
- **R2** — **Download PNG**: a control that downloads `/badges/{stem}.png`, labelled "for display; the SVG is the verifiable credential" (PNG-baking has not landed for the general set).
- **R3** — **Copy link**: a button that copies the badge page URL via the Clipboard API, with visible success feedback.
- **R4** — **Share to X**: an intent link `twitter.com/intent/tweet?url=&text=&hashtags=` (hashtags comma-separated, no `#`).
- **R5** — **Share to LinkedIn**: an intent link `linkedin.com/sharing/share-offsite/?url=` (only `url`; everything else comes from the OG tags).
- **R6** — **Web Share API**: a button calling `navigator.share`; shown only when supported (progressive enhancement); requires HTTPS + a real click; use `navigator.canShare()` before sharing files.
- **R7** — **Embed**: a "copy embed code" button emitting an `<iframe>` snippet pointing at a **minimal per-badge embed variant**; the full web component is out of scope (#74).
- **R8** — **LinkedIn add-to-profile**: a deep link to LinkedIn's add-certification flow (no autofill promise), targeting the Andamio Teams org, with `certUrl` pointing at the badge page today (repoints to the holder-grain page when #73 lands).
- **R9** — Each control works; a shared link previews correctly on the target platforms (manual acceptance); the download/social hrefs and the embed variant are asserted in tests / docker smoke.

**Wording gate** throughout: "DI-capable OB 3.0 / VC verifiers."

---

## Key Technical Decisions

### KTD-1 — Controls generated into the page by `page.py`; progressive-enhancement JS inline
The share controls render into the existing `data-slot="share-actions"` div at generation time, with per-badge URLs baked in. Downloads (`<a download>`) and social intents (`<a href>`) are **plain anchors that work with JavaScript disabled**. Only three controls need JS — copy link (Clipboard API), Web Share (`navigator.share`), copy embed (clipboard) — handled by one small **inline `<script>`** at the end of the page (self-contained, no external asset, consistent with the one-file-per-page static-trust-surface ethos). JS-only buttons are rendered hidden and revealed by the script when the API exists, so a no-JS client never sees a dead button.

### KTD-2 — Intent URLs: percent-encode query values, then HTML-escape the attribute
Share/deep-link hrefs embed the page URL and title in a query string *inside* an HTML attribute — two encoding layers. `page.py` percent-encodes each query value (`urllib.parse.quote`), assembles the URL, then HTML-escapes the whole href (`gen.esc`, so `&`→`&amp;`) for the attribute. Browsers decode `&amp;`→`&` when following the link. Exact formats (from the issue): X `twitter.com/intent/tweet?url=&text=&hashtags=Andamio,Cardano` (comma-separated, no `#`); LinkedIn share `linkedin.com/sharing/share-offsite/?url=` (url only).

### KTD-3 — Minimal embed variant at `badges/{stem}.embed.html`, served by #70's existing routing
The embed iframe targets a **minimal page** — just the badge image linking back to the display page, no chrome, sized for an iframe. It is generated as `badges/{stem}.embed.html` and served at the extensionless **`/badges/{stem}.embed`** by #70's existing `try_files $uri $uri.html` (`/badges/{stem}.embed` → `{stem}.embed.html`, `text/html`). **No nginx change.** This deliberately avoids `/badges/{stem}/embed` (a subpath), which would collide with the `/badges/{stem}/{alias}` scheme reserved for the holder viewer (#73). The embed snippet is `<iframe src="https://credentials.andamio.io/badges/{stem}.embed" width=… height=… loading="lazy" …></iframe>`.

### KTD-4 — `.embed.html` registered in the self-pruning reconciler (longest-match first)
`reconcile.py`'s `KNOWN_SUFFIXES` gains `".embed.html"` **before** `".html"` (longest-match: `.embed.html` ends with `.html`), so `split_stem` classifies `{stem}.embed.html` to stem `{stem}` and it prunes with the credential. The `orphan-guard` CI job then covers it. This mirrors the `.og.png`-before-`.png` ordering already in place.

### KTD-5 — LinkedIn add-to-profile: works now via `organizationName`, upgrades to `organizationId`
LinkedIn's add-to-profile deep link (`linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=&organizationName=|organizationId=&certUrl=&certId=`) accepts either the numeric `organizationId` (preferred) or `organizationName` (fallback). The numeric id for the Andamio Teams org is an **external input** (a Page admin reads it from the admin console) — not blocking. Ship now with `organizationName="Andamio Teams"` from a single generator constant; when the numeric id is captured, set the `ORG_ID` constant and it takes precedence. `certUrl` is the badge page URL today; a one-line change repoints it to the holder-grain page when #73 lands (noted, not built here). No autofill is promised in the copy.

### KTD-6 — CSP/headers unchanged; inline script is acceptable on the current static host
The static host sets no Content-Security-Policy today, so an inline `<script>` runs. The script is tiny, self-authored, and touches only clipboard/navigator.share/DOM — no external fetch. Adding a CSP is a separate hardening decision (out of scope); noted as a risk so a future CSP author knows the pages rely on an inline script + inline styles.

---

## High-Level Technical Design

The controls are static anchors plus a thin JS enhancement layer; the embed variant is a second generated page reusing the display page's routing.

```mermaid
flowchart TD
    R[credentials.json] --> P[page.py]
    P --> PAGE[badges/{stem}.html<br/>display page + share-actions slot filled]
    P --> EMBED[badges/{stem}.embed.html<br/>minimal iframe variant]
    R --> RC[reconcile.py<br/>KNOWN_SUFFIXES += .embed.html]
    RC --> B[(badges/)]
    PAGE --> B
    EMBED --> B

    subgraph CONTROLS["share-actions slot (in the page)"]
      direction TB
      DL["Download SVG / PNG<br/>&lt;a download&gt; (no JS)"]
      SOC["Share to X / LinkedIn<br/>&lt;a href&gt; intent URLs (no JS)"]
      LI["LinkedIn add-to-profile<br/>&lt;a href&gt; deep link (no JS)"]
      JS["Copy link · Web Share · Copy embed<br/>inline &lt;script&gt;, revealed when API present"]
    end
    PAGE -.contains.-> CONTROLS

    EMBED -->|served extensionless by #70 routing| URL["/badges/{stem}.embed (text/html)"]
    CONTROLS -->|iframe snippet points at| URL
```

---

## Implementation Units

### U1. Share controls + inline JS in `page.py`

**Goal:** Render the download / copy / social / Web Share / embed / LinkedIn-add-to-profile controls into the badge page's share-actions slot, with a small inline progressive-enhancement script.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, KTD-1, KTD-2, KTD-5, KTD-6.

**Dependencies:** none (the slot exists from #70). The embed button's target URL is produced by U2; U1 may render the button/snippet referencing `/badges/{stem}.embed` before U2 lands.

**Files:**
- `generator/page.py` (modify — fill the share-actions slot + add the inline script + CSS for the controls)
- `generator/tests/test_page.py` (modify)

**Approach:**
- Build a `_share_controls(stem, module_title, course_title, page_url)` fragment: download SVG (`href="/badges/{stem}.svg" download`, copy: "Download SVG — this file *is* the verifiable credential"), download PNG (`href="/badges/{stem}.png" download`, "PNG — for display; the SVG is the verifiable credential"), copy-link button (hidden-until-JS), X + LinkedIn intent anchors (KTD-2 encoding), Web Share button (hidden-until-JS), copy-embed button (hidden-until-JS), LinkedIn add-to-profile anchor (KTD-5).
- Inline `<script>`: on load, feature-detect and reveal the copy-link / copy-embed buttons (Clipboard API) and the Web Share button (`navigator.share`, and `navigator.canShare` before any file share); wire click handlers that copy the page URL / embed snippet / call `navigator.share`, with brief visible feedback. No external calls.
- Constants: `ORG_NAME = "Andamio Teams"`, `ORG_ID = None` (numeric id TBD — external), `HASHTAGS = "Andamio,Cardano"`. The embed snippet string is built once per badge (also needed by the copy-embed button's data).
- Keep the wording gate; escape/encode all interpolated values.

**Patterns to follow:** `generator/page.py` (existing head/body build, `esc`, palette CSS vars, slot markup); `generator/render.py` `sanitize_title`; `generator/og.py` for encoding discipline.

**Test scenarios (`test_page.py`, stdlib-only):**
- Download links: page contains `href="/badges/{stem}.svg"` with `download` and `href="/badges/{stem}.png"` with `download`; SVG copy asserts "verifiable credential", PNG copy asserts "for display".
- X intent: an `href` to `twitter.com/intent/tweet` containing a percent-encoded `url=` (the page URL) and `hashtags=Andamio,Cardano` (no `#`).
- LinkedIn share: an `href` to `linkedin.com/sharing/share-offsite/?url=` with **only** the url param.
- LinkedIn add-to-profile: an `href` to `linkedin.com/profile/add` with `startTask=CERTIFICATION_NAME`, `name=`, `organizationName=Andamio+Teams` (or `organizationId` when set), and `certUrl=` (the page URL today).
- Encoding: a title with `&`/space/`"` is percent-encoded in the query and the href attribute stays well-formed (no attribute breakout).
- Progressive enhancement: the copy-link / Web Share / copy-embed buttons are present but rendered hidden (a marker class/attr) so a no-JS client sees no dead button; the inline `<script>` is present.
- Web Share guard: the script references `navigator.share` / `navigator.canShare` (feature-detect), not an unconditional call.
- Wording gate: no "any OB3 verifier".
- `Covers R1,R2,R4,R5,R8.` Each control's href/target is present and correctly encoded.

**Verification:** opening a generated page shows the controls; downloads fetch the SVG/PNG; social links open the correct intent pages; on a JS-enabled HTTPS context copy-link/Web-Share/copy-embed work; no dead buttons with JS disabled.

---

### U2. Minimal embed variant + self-pruning coverage

**Goal:** Generate a minimal per-badge embed page the iframe snippet targets, and register `.embed.html` as a pruned/guarded artifact type.

**Requirements:** R7, KTD-3, KTD-4.

**Dependencies:** U1 (the embed snippet references the embed URL).

**Files:**
- `generator/page.py` (modify — emit `badges/{stem}.embed.html` in `main()`, add an `_embed_html` builder)
- `generator/reconcile.py` (modify — add `.embed.html` to `KNOWN_SUFFIXES`, longest-first)
- `generator/tests/test_page.py` (modify), `generator/tests/test_reconcile.py` (modify)
- `imaging/check-artifacts.ts` (modify — require `{stem}.embed.html` per badge)

**Approach:**
- `_embed_html(rec)`: a minimal HTML doc — the badge image (`/badges/{stem}.svg`) as a link to the display page (`target="_blank" rel="noopener"`), transparent/auto background, no share chrome, `viewport` meta, tiny inline CSS. `main()` writes `badges/{stem}.embed.html` alongside `{stem}.html` (same `SKIP_COURSES` filter, `encoding="utf-8"`).
- `reconcile.py`: `KNOWN_SUFFIXES = (".embed.html", ".og.png", ".png", ".svg", ".html")` — `.embed.html` first so it matches before `.html`. `split_stem` then classifies `{stem}.embed.html` to `{stem}`.
- `check-artifacts.ts`: for each badge SVG, also require `{stem}.embed.html` exists (existence + small size floor + links back to the page).

**Patterns to follow:** the `.html` page + `.og.png` handling in `reconcile.py`/`test_reconcile.py`/`check-artifacts.ts` (all from #70/#69); `page.py`'s existing `main()`.

**Test scenarios:**
- `_embed_html`: well-formed minimal HTML referencing `/badges/{stem}.svg` and linking to the display page URL; no share controls; carries a viewport meta.
- reconcile: a dropped credential prunes `{stem}.embed.html` along with svg/png/og.png/html (extend the cross-type case); an in-registry `.embed.html` is kept; a malformed `.embed.html` name is skipped (strict key).
- reconcile ordering: `split_stem("{stem}.embed.html")` returns stem `{stem}` (not misclassified via `.html`).
- check-artifacts: fails when a badge's `{stem}.embed.html` is missing; passes on the complete set.
- `Covers R7.` The embed variant exists per badge and is prunable/guarded.

**Verification:** `make pages` writes one `.embed.html` per non-skipped badge; `/badges/{stem}.embed` serves it (verified in U3 smoke); `reconcile --check` stays green; dropping a record prunes the embed too.

---

### U3. Serving verification, CI smoke, and docs

**Goal:** Verify the embed URL serves via the existing routing, assert the share controls + embed in CI, and document the share actions.

**Requirements:** R7, R9.

**Dependencies:** U1, U2.

**Files:**
- `.github/workflows/ci.yml` (modify — docker smoke: `/badges/{stem}.embed` is `text/html`; the display page body contains the share controls; a share intent href)
- `generator/README.md` (modify — document the share actions + the `.embed.html` artifact + `/badges/{stem}.embed` URL)
- `nginx/default.conf.template` — **no change expected** (the extensionless routing already serves `.embed`); confirm in smoke.

**Approach:**
- Docker smoke additions (reuse the existing `$STEM` + `assert_ct`): `assert_ct /badges/$STEM.embed text/html`; the page body (already fetched) contains `twitter.com/intent/tweet` and `/badges/$STEM.svg` download and a `data-slot="share-actions"` that is non-empty; the embed page body links back to `/badges/$STEM`.
- Confirm no nginx edit is needed (the `.embed` request resolves through `try_files $uri $uri.html`); if the smoke shows otherwise, add a scoped nested location (fallback, not expected).
- `generator/README.md`: note the share-actions controls, the minimal embed variant, the `/badges/{stem}.embed` URL, and the external `organizationId` follow-up.

**Patterns to follow:** the #70 docker-smoke page assertions and `assert_ct` helper; `generator/README.md` pipeline docs.

**Test scenarios (docker smoke):**
- `/badges/{stem}.embed` → 200, `text/html`, body links to `/badges/{stem}`.
- `/badges/{stem}` body contains the share controls (a download link + an X intent href).
- Regression: `/badges/{stem}.svg` still `image/svg+xml`; extensionless page still `text/html` with OG tags (from #70).
- `Covers R7,R9.` The embed URL serves and the page carries the controls.

**Verification:** the `docker-build` job is green with the new assertions; `/badges/{stem}.embed` renders the minimal badge; the display page shows the controls.

---

## Scope Boundaries

**In scope:** the share controls on the badge page, the minimal per-badge embed variant + its self-pruning coverage, and CI/docs.

**Out of scope (separate issues):**
- **`andamio-badge` web component + npm embed** (#74) — the embed here is a plain iframe snippet; the web component is the upgrade path.
- **The two explainers** (#72) — separate slot; not touched here.
- **Holder-grain viewer** (#73) — `certUrl` repoints to it when it lands (KTD-5); not built here.

### Deferred to Follow-Up Work
- **Numeric LinkedIn `organizationId`** — external input (a Page admin reads it); ship with `organizationName` now, set `ORG_ID` when captured (KTD-5).
- **`certUrl` repoint to the holder page** — one-line change when #73 ships.
- **Content-Security-Policy** on the static host — the pages rely on an inline script + inline styles; a CSP is a separate hardening decision (KTD-6 risk).

---

## Risks & Mitigations

- **A dead JS-only button for no-JS / non-HTTPS clients.** *Mitigation:* KTD-1 — copy/Web-Share/embed buttons render hidden and are revealed by the inline script only when the API exists; downloads and social links are plain anchors that always work.
- **Double-encoding breaks a share link or an attribute.** *Mitigation:* KTD-2 — percent-encode query values, then HTML-escape the href; test a title with `&`/space/`"` (U1 encoding scenario).
- **Embed URL collides with the #73 `/{alias}` scheme.** *Mitigation:* KTD-3 — embed lives at `/badges/{stem}.embed` (a sibling "file"), not `/badges/{stem}/embed` (a subpath).
- **Shipping the embed variant before pruning covers it (new orphan type).** *Mitigation:* U2 lands `.embed.html` in `KNOWN_SUFFIXES` as a stated dependency; the orphan guard then covers it.
- **LinkedIn add-to-profile lands on a blank form / no autofill.** *Mitigation:* KTD-5 — copy promises no autofill; the deep link still pre-navigates to the Andamio Teams add-certification flow.
- **Inline script relies on no CSP.** *Mitigation:* KTD-6 risk noted so a future CSP author allows the inline script/style (or the script moves to a hashed/nonced form).

---

## Dependencies / Prerequisites

- **#70 shipped** (`main`): the badge page, its share-actions slot, the extensionless `/badges/{stem}` routing (which also serves `.embed`), and the `reconcile.py`/`check-artifacts.ts` artifact-coverage this extends.
- Python 3 stdlib only for `page.py` (`urllib.parse.quote` for encoding) — keeps `generator-tests` hermetic.
- The forever-public host `credentials.andamio.io` (unchanged).

---

## Sources & Research

- Issue **#71** (origin); parent product-circle#123 (v1.2 Track A). Related: #70 (page substrate), #73 (`certUrl` target), #74 (web-component embed).
- `generator/page.py` — the display page with the `data-slot="share-actions"` div, palette CSS, `esc`, and `main()` this extends.
- `generator/reconcile.py` (`KNOWN_SUFFIXES`, `split_stem`) and `generator/tests/test_reconcile.py` — the self-pruning the `.embed.html` type registers into.
- `imaging/check-artifacts.ts` — the coverage guard extended for the embed variant.
- `nginx/default.conf.template` — the extensionless `try_files $uri $uri.html` (#70) that serves `/badges/{stem}.embed` with no change.
- `.github/workflows/ci.yml` (`docker-build` + `assert_ct`) — the smoke this extends.
- Share-intent formats (from the issue, verified external contracts): X `twitter.com/intent/tweet?url=&text=&hashtags=`; LinkedIn share `linkedin.com/sharing/share-offsite/?url=`; LinkedIn add-to-profile `linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=&organizationName=|organizationId=&certUrl=&certId=`. Web Share API: `navigator.share` + `navigator.canShare`, HTTPS + user-gesture required.
