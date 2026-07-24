---
title: "feat: v1.2 the two explainers — How do I share this? / How do I check this?"
status: active
date: 2026-07-24
type: feat
issue: "#72"
parent: "Andamio-Platform/product-circle#123 (Credential Badges v1.2, Track A)"
---

# feat: v1.2 the two explainers — How do I share this? / How do I check this?

## Summary

Two audience-specific static explainer pages, linked from every badge display page (#70), both answering **how can I discover the evidence behind this badge?**:

- **"How do I share this?"** (holder) — what the badge proves (the learning target, the assessed accomplishment, why it beats a participation sticker), the four-party anchor at the **hash-and-anchor** level, and how to use the share options (#71).
- **"How do I check this?"** (employer / verifier) — a plain-language, end-to-end path to confirm a badge is genuine **without trusting Andamio**, adapted from the existing `docs/verifier-guidance.md` (mostly a placement + audience-framing job, not net-new writing).

Both are generated as static HTML into the served tree with the badge's branded shell, served at the extensionless `/badges/how-to-share` and `/badges/how-to-check` via #70's existing routing (no nginx change), and linked from the badge page's reserved `explainers` slot. This also gives product-circle#101 ("Verifier guidance") a home and a status.

---

## Problem Frame

The badge page (#70) and its share actions (#71) exist, but a holder landing on their badge has no answer to "what does this actually prove, and how do I show it off?", and an employer has no plain-language path to "is this real, without taking Andamio's word for it?". The repo already has a strong verifier document (`docs/verifier-guidance.md`) — a technical walk-through of the four-party anchor, the on-chain verification path, and what a verification result means — but it lives in `docs/`, is not linked from any badge, and is framed for a developer, not an employer skimming a credential.

#72 turns that into two **audience-shaped, linked-from-the-badge** entry points at the disclosure level v1.2 ships today: **hash-and-anchor** — the learning target (SLT), the four-party anchor (earner, assessor, chain, Andamio signer), the assessment record, and the signature — proving the evidence exists and is anchored, **without revealing the raw artifact** (holder-private by design). Both pages will later gain a link to the holder-controlled reveal path when that Development-lane capability ships (Track B, #123).

---

## Requirements

Traced from issue #72:

- **R1** — A **"How do I share this?"** holder explainer: what the badge proves (SLT / assessed accomplishment / why it beats a participation sticker), the four-party anchor at hash-and-anchor level, and a walk-through of the share options (download / social / embed / add-to-profile).
- **R2** — A **"How do I check this?"** verifier explainer: a plain-language, end-to-end path to confirm the badge is genuine **without trusting Andamio**, adapted from `docs/verifier-guidance.md` — the credential's shape, resolve-issuer-and-check-signature, chase-the-anchor-on-chain, and what a verification result means.
- **R3** — Both explainers are **linked from the badge display page** (the reserved `explainers` slot), and both links resolve.
- **R4** — Both surface the **hash-and-anchor** disclosure level only (no raw artifact); each notes the holder-controlled reveal path is coming (Track B), without linking it yet.
- **R5** — Served as static pages by the existing host (no new top-level served path; consistent with the allowlisted, CODEOWNERS-gated trust surface).
- **R6** — The check-this page **walks a non-Andamio verification path end to end** (read → resolve issuer + check signature → chase the anchor on-chain → check status).

**Wording gate** throughout the check-this page (and anywhere verifiability is mentioned): "DI-capable OB 3.0 / VC verifiers," never "any OB3 verifier."

---

## Key Technical Decisions

### KTD-1 — Two general pages at `badges/how-to-share.html` / `badges/how-to-check.html`, served extensionless
The explainers are **two pages total** (not per-badge), generated into the already-served `badges/` tree and served at the extensionless **`/badges/how-to-share`** and **`/badges/how-to-check`** by #70's existing `try_files $uri $uri.html` routing (`/badges/how-to-share` → `how-to-share.html`, `text/html`). **No nginx change, no Dockerfile/allowlist change** (badges/ is already allowlisted + copied wholesale). Living under `/badges/` keeps them adjacent to the pages that link them and reuses the whole serving path.

### KTD-2 — Non-hex stems are inert to the reconciler (safe by construction)
`reconcile.py`'s `split_stem` only classifies a `badges/` file as an artifact when its stem matches `<56-hex>.<64-hex>`. `how-to-share` / `how-to-check` are not hex stems, so `split_stem` returns `None` and the reconciler **skips them** — never pruned, never orphan-flagged. They are committed editorial pages that ride the wholesale `badges/` copy. A small CI existence check (KTD-5) guards against silent deletion, since the orphan guard is keyed to per-credential artifacts.

### KTD-3 — Generated by `generator/explainers.py` with the badge's branded shell (default palette)
Mirror `generator/page.py`: a small generator emits both pages with the same branded HTML shell (inline CSS, fonts, `theme-color`), using the **canonical Andamio Navy palette** (`colors` default) since these are not per-credential. Content is editorial prose in the generator (the pages are stable, not data-driven), reusing `gen.esc` for any interpolation and the wording gate. `make explainers` builds them. This keeps branding consistent with the badge pages and keeps the pages regenerable rather than hand-maintained divergent HTML.

### KTD-4 — The check-this page adapts `docs/verifier-guidance.md`, reframed for an employer, at hash-and-anchor level
The "How do I check this?" content is a **placement + audience-framing job** on the existing guidance, not net-new verification claims. Carry over its load-bearing structure — the four-party anchor (issuer, assessor, chain, Andamio), *what an employer can rely on* vs. *not assume*, the where-to-check split (chain authoritative; status list a key-freshness convenience), and the non-Andamio developer path (read → resolve+verify signature → chase the anchor on `andamioscan` / a Cardano explorer → optional status) — in plain language. `docs/verifier-guidance.md` stays the canonical technical reference; the page links to it for depth. Wording gate applies. This gives product-circle#101 its home + status.

### KTD-5 — Explainers linked from the badge page's `explainers` slot; CI guards existence + the non-Andamio path
`page.py` fills the reserved `explainers` slot with two links (`/badges/how-to-share`, `/badges/how-to-check`). Because the slot goes from empty to populated, all 58 pages regenerate. A CI check (extend `imaging/check-artifacts.ts` or a small step) asserts both explainer files exist; the docker smoke asserts both URLs serve `text/html` and that the check-this page contains the non-Andamio verification path (e.g., references `did:web` resolution + an on-chain/`andamioscan` check + "without trusting Andamio").

### KTD-6 — Hash-and-anchor level only; reveal path noted, not linked
Both pages describe the evidence at the **hash-and-anchor** level (the SLT, the four-party anchor, the assessment record, the signature) and explicitly say the raw artifact stays holder-private, with the holder-controlled reveal path **coming** (Track B, #123) — a sentence, not a link. This matches the v1.2 disclosure decision and avoids implying a capability that hasn't shipped.

---

## Implementation Units

### U1. `generator/explainers.py` + the two explainer pages

**Goal:** Generate the two audience-shaped explainer pages with the branded shell, adapting `docs/verifier-guidance.md` for the check-this page.

**Requirements:** R1, R2, R4, R6, KTD-1, KTD-3, KTD-4, KTD-6.

**Dependencies:** none (builds on #70's serving + palette).

**Files:**
- `generator/explainers.py` (new)
- `generator/tests/test_explainers.py` (new)
- `Makefile` (modify — add `explainers` target + help)

**Approach:**
- A shared `_shell(title, description, body_html)` builds the branded HTML (inline CSS/fonts/`theme-color` from the canonical Andamio Navy palette, a readable prose layout wider than the badge card), reused by both pages. Escape any interpolation (`gen.esc`).
- **How do I share this?** body: what the badge proves (the SLT / assessed accomplishment / why it beats a participation sticker), the four-party anchor at hash level, and a walk-through of the share options (download SVG/PNG, copy link, X/LinkedIn, Web Share, embed, LinkedIn add-to-profile) — the controls #71 put on the badge page. Note the raw-artifact reveal path is coming (KTD-6).
- **How do I check this?** body: adapt `docs/verifier-guidance.md` (KTD-4) — the four-party anchor, what an employer can rely on vs. not assume, chain-authoritative vs. status-list-convenience, and the non-Andamio path (read the credential → resolve `did:web:credentials.andamio.io` and verify the DI signature with a DI-capable OB 3.0 / VC verifier → chase the anchor on `andamioscan` / a Cardano explorer → optional status). Link to `docs/verifier-guidance.md` for depth. Wording gate.
- `make explainers` writes `badges/how-to-share.html` and `badges/how-to-check.html`.

**Patterns to follow:** `generator/page.py` (branded shell: head/CSS, `esc`, palette, `encoding="utf-8"` writes); `generator/colors.py` (default palette); `docs/verifier-guidance.md` (source content).

**Test scenarios (`test_explainers.py`, stdlib-only):**
- Both pages are well-formed HTML (`<!doctype html>` … `</html>`), `text/html`-shaped, with a `<title>` and `theme-color`.
- Share page content: mentions the learning target / accomplishment framing and each share option (download, copy, X, LinkedIn, embed, add-to-profile).
- Check page content (R6): contains each step of the non-Andamio path — resolve `did:web:credentials.andamio.io`, verify the signature, chase the anchor on-chain (`andamioscan` / Cardano explorer), and the "without trusting Andamio" framing.
- Four-party anchor: the check page names all four (issuer, assessor, chain, Andamio).
- Reveal-path note (KTD-6): both pages note the raw artifact is holder-private / reveal path coming, and neither links a reveal URL.
- Wording gate: neither page contains "any OB3 verifier"; the check page uses "DI-capable OB 3.0 / VC verifiers".
- Escaping: any interpolated value is HTML-escaped.
- `Covers R6.` The check page walks the non-Andamio path end to end.

**Verification:** `make explainers` writes both pages; opening the check page walks a non-Andamio verification path; branding matches the badge pages.

---

### U2. Link the explainers from the badge page

**Goal:** Populate the badge page's reserved `explainers` slot with links to both explainer pages.

**Requirements:** R3, KTD-5.

**Dependencies:** U1 (the pages exist to link).

**Files:**
- `generator/page.py` (modify — fill the `explainers` slot)
- `generator/tests/test_page.py` (modify)

**Approach:**
- Fill the `data-slot="explainers"` div with two links: "How do I share this?" → `/badges/how-to-share`, "How do I check this?" → `/badges/how-to-check`. Root-relative URLs (resolve against the host). Small helper `_explainer_links()`; style consistent with the existing controls.
- Regenerate all 58 pages (+ embeds unaffected) so the slot is populated; the byte-parity test then covers them.

**Patterns to follow:** `page.py`'s existing slot-fill pattern (the `share-actions` slot from #71); the page's CSS.

**Test scenarios (`test_page.py`):**
- The rendered page's `explainers` slot contains both links with the correct `href`s (`/badges/how-to-share`, `/badges/how-to-check`).
- The slot is no longer empty (the `.explainers:empty` hide rule no longer applies).
- `Covers R3.` Both explainer links resolve from the badge page.

**Verification:** every badge page shows the two explainer links; they navigate to the explainer pages.

---

### U3. Serving verification, CI existence guard, and docs

**Goal:** Verify both explainer URLs serve, guard their existence in CI, and document them.

**Requirements:** R3, R5, R6.

**Dependencies:** U1, U2.

**Files:**
- `.github/workflows/ci.yml` (modify — docker smoke: both explainer URLs `text/html`; check-this contains the non-Andamio path; existence guard)
- `imaging/check-artifacts.ts` (modify — assert both explainer files exist) **or** a small dedicated check
- `generator/README.md` (modify — document `make explainers` + the two URLs)
- `nginx/default.conf.template` — **no change expected** (existing extensionless routing serves them); confirm in smoke.

**Approach:**
- Docker smoke (reuse `assert_ct`): `/badges/how-to-share` and `/badges/how-to-check` → `text/html`; fetch the check page body and assert it contains the non-Andamio markers (`did:web`, an on-chain/`andamioscan` reference, "without trusting Andamio"); both link back / are reachable.
- Existence guard: `check-artifacts.ts` (which already runs in the `imaging` CI job) asserts `badges/how-to-share.html` and `badges/how-to-check.html` exist and are non-trivial — since the orphan guard is keyed to per-credential stems and won't catch a deleted editorial page.
- `generator/README.md`: add `make explainers`, the two pages, and their URLs to the pipeline docs.

**Patterns to follow:** the #70/#71 docker-smoke page assertions and `assert_ct`; `check-artifacts.ts` existence checks.

**Test scenarios (docker smoke):**
- `/badges/how-to-share` → 200, `text/html`.
- `/badges/how-to-check` → 200, `text/html`, body contains the non-Andamio verification markers.
- Regression: a badge page still serves and now carries the two explainer links.
- `Covers R3, R6.` Both URLs resolve; the check page walks the non-Andamio path.

**Verification:** the `docker-build` job is green with the new assertions; deleting an explainer page turns the existence guard red; README documents the explainers.

---

## Scope Boundaries

**In scope:** the two explainer pages, their generation, linking from the badge page, and CI/docs.

**Out of scope (separate issues / lanes):**
- **Net-new verifier documentation** — the check-this page *adapts* `docs/verifier-guidance.md`; deep technical verification content stays in that doc (and #101).
- **The holder-controlled raw-artifact reveal path** — Track B / #123; noted on both pages, not built or linked here (KTD-6).
- **Holder-grain viewer** (#73) and **web component** (#74).

### Deferred to Follow-Up Work
- **Link the reveal path** from both explainers when the Track B capability ships (a one-line change per page).
- **Per-badge deep-linking** of the share explainer to that badge's own controls — the explainer is general today; a future enhancement could pass the stem. Not needed for #72.

---

## Risks & Mitigations

- **An editorial page silently deleted (not caught by the orphan guard).** *Mitigation:* KTD-2 + U3 — non-hex stems are inert to the reconciler by construction, and a CI existence guard fails if either explainer file goes missing.
- **The check-this page overclaims verifiability or drifts from `verifier-guidance.md`.** *Mitigation:* KTD-4 — adapt, don't reinvent; the wording gate + a test assert the non-Andamio path and the "DI-capable OB 3.0 / VC verifiers" phrasing; link to the canonical doc for depth.
- **Implying the raw-artifact reveal exists.** *Mitigation:* KTD-6 — both pages state the artifact is holder-private with the reveal path *coming*, and a test asserts no reveal URL is linked.
- **A new top-level served path expands the trust surface.** *Mitigation:* KTD-1 — the pages live under the already-allowlisted `badges/` tree; no Dockerfile/allowlist/nginx change.

---

## Dependencies / Prerequisites

- **#70 shipped** (`main`): the badge page, its `explainers` slot, and the extensionless `/badges/` routing that serves the new pages.
- **#71 shipped** (`main`): the share controls the share explainer walks through.
- **`docs/verifier-guidance.md`** — the source content the check-this page adapts (present).
- Python 3 stdlib only for `explainers.py` (keeps `generator-tests` hermetic).

---

## Sources & Research

- Issue **#72** (origin); parent product-circle#123 (v1.2 Track A). Gives product-circle#101 ("Verifier guidance") a home + status.
- `docs/verifier-guidance.md` — the canonical verifier walk-through (four-party anchor, employer-reliance facts, chain-vs-status split, the developer verify path, verification-result meanings, the worked "Andamio Issuer" example) the check-this page adapts.
- `generator/page.py` — the branded shell + the `data-slot="explainers"` slot this fills; `generator/colors.py` (default palette).
- `generator/reconcile.py` (`split_stem`, `STEM_RE`) — why non-hex editorial pages are inert to pruning (KTD-2).
- `nginx/default.conf.template` — the extensionless `try_files $uri $uri.html` (#70) that serves `/badges/how-to-*` with no change.
- `imaging/check-artifacts.ts`, `.github/workflows/ci.yml` (`docker-build` + `assert_ct`) — the coverage + smoke this extends.
- `CONCEPTS.md` (Flagship Badge, Baking) — the presentation-vs-identity framing the explainers respect; the badges are anchored on-chain, most presentation-only until signed.
