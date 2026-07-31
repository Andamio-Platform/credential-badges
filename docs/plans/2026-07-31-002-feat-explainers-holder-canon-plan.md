---
title: "feat: Bring the explainers and holder viewer to the canon, and tighten the explainer copy"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: credential-badges#99 (sibling follow-up)
created: 2026-07-31
plan_depth: standard
---

# feat: Bring the explainers and holder viewer to the canon, and tighten the explainer copy

**Target repo:** `credential-badges`
**Depends on:** `docs/plans/2026-07-31-001-feat-share-page-brand-canon-plan.md` — specifically its U1, which creates `generator/canon.py`. **This plan cannot start until that module exists.**

---

## Summary

Three app-like pages at `credentials.andamio.io` keep the old dark language after the share page becomes canon: the two explainers (`/badges/how-to-share`, `/badges/how-to-check`) and the holder viewer (`/badges/_holder.html`). This plan conforms all three to the same tokens the share page uses, importing them from `canon.py` rather than transcribing them again. It then tightens the explainer copy — separately, and under the existing wording gates.

**The restyle changes no copy, and the copy pass changes no styling.** They are separate units so a wording debate cannot block the visual work, and so a copy regression is never hidden inside a 3-file restyle diff.

**Not in scope:** the Open Graph card (its own plan — it is a raster with two live design questions), the embed variant (renders inside third-party pages; conforming it to our brand is a different question), and the credential designer at `/design/` (a hand-built app, deferred by decision).

---

## Problem Frame

The share page becomes canon paper; these three stay dark. All three are one click from it — and the explainers are where the share page's single orange accent *points*. A stranger asking "is this real?" follows the most emphasised element on the page and lands in a different design era, at the exact moment trust is being decided.

Underneath the visual problem there is a copy problem, but only on one page. `how-to-share` (283 words) carries sentences where labels would do and one comparative marketing line that does no work. `how-to-check` (546 words) is close to right: it is a trust model, a four-step independent verification procedure, and a signing-status caveat. Its length is mostly earned.

**The real risk in a "brevity" pass is not verbosity — it is cutting a qualifier.** `how-to-check` is linked from all 58 badge pages, and only the flagship badge is signed today. The `Status.` caveat and the "the chain still backs the badge" clause are what keep the page honest for the other 57. `docs/solutions/conventions/never-delete-a-qualifier-that-bounds-a-claim.md` records why: a qualifier is a ceiling, so removing it *widens* the claim rather than shortening it.

---

## Requirements

| ID | Requirement |
|---|---|
| R1 | All three pages draw colour, type and component treatment from `generator/canon.py` — the same values the share page uses, imported, never re-transcribed |
| R2 | The accent discipline holds identically: orange only in the roles the share page's R2 permits, always as a non-text mark, never as text colour. Blue is never a fill |
| R3 | Every claim on all three pages is unchanged in meaning. The existing wording-gate suites (`test_explainers.py`, `test_holder.py`) stay green **without modification** through the restyle unit |
| R4 | The explainer copy is tightened to its stated word budget without removing any gated phrase, any named party, or any qualifier that bounds a claim |
| R5 | Neither page gains decorative structure — no cards, icon rows, feature grids, hero bands, or pull quotes. They are one column of prose and stay that way |
| R6 | Every text-bearing element meets AA on the canon paper ground, and every interactive control has a visible focus state |
| R7 | All three pages remain self-contained: no `<link>`, no `@import`, no foreign-origin `src`/`url()` other than `data:` |
| R8 | The holder viewer's existing behaviour is untouched — its registry fetch, its cross-link to `how-to-check`, and its refusal to claim it cryptographically verifies anything |

---

## Key Technical Decisions

**KTD1 — `canon.py` is imported, never re-transcribed.**
The share-page plan puts the canon literals in `generator/canon.py` under a sha256 pin precisely so these three surfaces do not become three more independent hand-copies with three more drift clocks. Import it. If a value is missing from it, add it there and update the pin — do not inline a literal here.

**KTD2 — The explainers keep the Andamio palette's *role*, not its values.**
`explainers.py` uses `gen.PAL_ANDAMIO` today rather than a per-credential palette, because the explainers are general pages. That decision stands and gets simpler: they are canon paper like every other page, with no per-course variation to reconcile. Drop the `PAL` binding from the page path.

**KTD3 — The restyle unit changes no copy. The copy unit changes no styling.**
Two reasons, both load-bearing. A wording debate about the check page must not hold the visual work hostage. And a copy regression must never be reviewable only as part of a 3-file restyle diff — the wording gates catch claim changes, but reviewers catch tone, and reviewers need a small diff to do it.

**KTD4 — Brevity is bounded by the gates, and the gates are a floor, not a ceiling.**
`test_explainers.py` asserts specific phrases must be present: the four parties (issuer, assessor, chain, Andamio), `did:web:credentials.andamio.io`, the status-list step, the andamioscan link, `hash-and-anchor`, "stays private to the holder", `<strong>Status.</strong>`, "the chain still backs", and every share-option label. These are not stylistic preferences — each one was added because its absence let the page overclaim. **The copy pass may not modify a single one of these tests to make a cut land.** If a cut requires editing a gate, the cut is wrong.

**KTD5 — Word budgets, stated per page, because "brief" is not testable and "under N words" is.**

| Page | Today | Budget | Where the cut comes from |
|---|---|---|---|
| `how-to-share` | 283 | **≤ 225** | Option descriptions become label + one clause. The comparative line ("That is why it beats a certificate: the proof lives on a public ledger, not on anyone's server") goes — it argues rather than informs, and the preceding sentence already made the point. |
| `how-to-check` | 546 | **≤ 470** | Connective tissue only. The trust model, the four steps, the four parties, and the `Status.` caveat all stay whole. |

The check-page budget is deliberately modest. That page is a verification procedure, and 546 words is not bloat for one — the honest saving is phrasing, not content. **If a deeper cut is wanted, it is a content decision about what the page is for, and it belongs in a conversation, not in an implementation unit.**

**KTD6 — The holder viewer gets tokens now and may need layout again later.**
`#89` is open and structural: badge images are keyed `(course_id, slt_hash)`, credentials are keyed `(course_id, slt_hash, recipient)`, and the per-holder artifact lands on this page. The canon tokens will survive that; the layout may not. Restyling now is still right — the page is one click from a canon share page today — but expect a second pass, and do not invest in layout refinements here that `#89` would discard.

---

## Implementation Units

### U1. Conform the two explainers — styling only

**Goal:** both explainers render in the canon, with copy byte-identical in substance.
**Requirements:** R1, R2, R3, R5, R6, R7
**Dependencies:** share-page plan U1 (`canon.py` must exist)
**Files:** `generator/explainers.py`, `generator/tests/test_explainers.py`

**Approach:**
1. Replace `_shell`'s `:root` block and `PAL` binding with imports from `canon.py`. Drop the radial-gradient body background for canon paper.
2. Type: Inter for prose, JetBrains Mono for identifiers. **The `.eyebrow` rule is the retired mono-uppercase kicker** (`font-family:"Spline Sans Mono"; letter-spacing:.28em; text-transform:uppercase`) — replace it with Inter 13px semibold sentence case, no tile, matching the share page's group labels.
3. Fonts come from the share page's `page_fonts.css`, not `gen.FONT_FACE` — reusing the shared constant would re-couple these pages to the file that feeds the signed badge SVGs.
4. Remove `border-radius` from containers. Keep the 680px prose measure — it is already right for reading, and widening it would be a change nobody asked for.
5. Add a `:focus-visible` outline in ink. Neither page has a focus rule today.
6. **Change no text.** Every word, every `<strong>`, every link label stays as-is.

**Test scenarios:**
- Both pages' body background is the canon paper value; neither contains `Archivo`, `Spline Sans Mono`, or a radial gradient.
- Both import from `canon.py`; no canon hex is inlined in `explainers.py`.
- Neither page declares a foreign-origin subresource.
- No text-bearing rule uses an ink alpha below `.60`.
- A `:focus-visible` rule exists for anchors; no rule sets `outline:none` without a replacement.
- **The full existing `test_explainers.py` passes unmodified** — all eight gates, including the byte-parity guard after re-baselining.
- Extracted body text is byte-identical to the pre-restyle extraction. This is the KTD3 guard: assert the *prose* did not move while the *styling* did.

---

### U2. Tighten the explainer copy — copy only

**Goal:** both pages meet their word budget with every gated phrase and every qualifier intact.
**Requirements:** R3, R4
**Dependencies:** U1
**Files:** `generator/explainers.py`, `generator/tests/test_explainers.py`

**Approach:**
1. `how-to-share` to ≤ 225 words. Convert the six share options from sentences to label + one clause. Delete the comparative certificate line. Keep "learning target", "participation sticker", every option label, `hash-and-anchor`, and "stays private to the holder" — all gated.
2. `how-to-check` to ≤ 470 words. Tighten phrasing across "Who stands behind it" and "What you can rely on". **Do not touch:** the `Status.` caveat, "the chain still backs", "without trusting", the four party names, `did:web:credentials.andamio.io`, the andamioscan link, the status-list step, or the "not that the achievement is significant" disclaimer. Each is either gated or bounds a claim.
3. Add a word-count assertion to `test_explainers.py` — the budget from KTD5, asserted against the extracted body text of each page. This is the only test file change either unit makes, and it *adds* a constraint rather than relaxing one.
4. **Stop rule.** If a cut cannot land without editing an existing gate, do not edit the gate — leave the sentence and report it. The gate is the record of a decision made when the claim was written.

**Test scenarios:**
- Each page's extracted body text is within its KTD5 budget.
- Every existing gate in `test_explainers.py` passes **unmodified**; the only diff to that file is the added word-count test.
- The four parties, the signing-status caveat, and the hash-and-anchor disclosure statement are all still present (already gated — restated here because they are what the budget must not buy).
- No page gained a heading, a section, or a list that did not exist before.

---

### U3. Conform the holder viewer

**Goal:** the holder viewer matches the canon, with its behaviour and its claim ceiling untouched.
**Requirements:** R1, R2, R3, R5, R6, R7, R8
**Dependencies:** U1 (same token import path and font artifact)
**Files:** `generator/holder.py`, `generator/tests/test_holder.py`

**Approach:**
1. Same token swap as U1: `canon.py` import, canon paper ground, Inter / JetBrains Mono, no radius, `:focus-visible`, `page_fonts.css`.
2. **Change no copy**, for the same reason as U1 — and with a sharper edge here: `test_holder.py` asserts the viewer does not imply it cryptographically verifies anything, and that the "without trusting Andamio" claim belongs to `how-to-check`, not to this convenience view. That boundary is the page's whole honesty story.
3. Keep the cross-link to `/badges/how-to-check` and the registry fetch behaviour exactly as they are.
4. Per KTD6, do not restructure the layout — tokens only. `#89` will decide what this page's regions are.

**Test scenarios:**
- Canon paper ground; no `Archivo`, no `Spline Sans Mono`, no radial gradient; imports from `canon.py`.
- No foreign-origin subresource; `:focus-visible` present; no text below ink `.60`.
- **The full existing `test_holder.py` passes unmodified**, including the no-cryptographic-claim guard and the cross-link assertion.
- Extracted body text byte-identical to pre-restyle.

---

### U4. Regenerate and re-baseline

**Goal:** the committed artifacts match the generators, and the parity guards are meaningful again.
**Requirements:** all
**Dependencies:** U1, U2, U3
**Files:** `badges/how-to-share.html`, `badges/how-to-check.html`, `badges/_holder.html`

**Approach:**
1. Regenerate all three. `test_output_byte_identical_to_committed` (explainers) and its holder-viewer mirror **will fail by design** — re-baseline by regenerating, never by loosening.
2. **Assert nothing else regenerated.** `generator/fonts.css` byte-unchanged, no badge SVG, no OG card, no share page touched. These generators share `gen.FONT_FACE` today; step U1.3 breaks that coupling for the page path, and this is the guard that it actually broke.
3. Confirm the share page still renders identically — it is regenerated by a different entry point and must not drift.

**Test scenarios:**
- Three artifacts regenerated; byte-parity green.
- `generator/fonts.css`, all 58 badge SVGs, all 58 share pages, all 58 embed variants and all OG cards unchanged.
- Full `generator/tests/` suite passes, with `test_explainers.py`'s added word-count test the only test-file change in the plan.

---

## Verification Contract

**Automated:**
- `generator/tests/` passes in full.
- No existing wording gate in `test_explainers.py` or `test_holder.py` was modified.
- Both explainers within their KTD5 word budgets.
- All three pages import from `canon.py`; no canon hex inlined in any of the three generators.
- No page declares a foreign-origin subresource.
- Orange appears only in permitted roles, as a non-text mark; no text below ink `.60`.
- `generator/fonts.css` and every badge SVG, share page, embed variant and OG card byte-unchanged.

**Human gate — no tooling here can discharge these:**
- All three pages read as the same product as the share page, at 1440×900 and on a phone.
- The explainers still read as prose, not as a landing page — no section gained decorative structure.

## Definition of Done

R1–R8 hold; the three artifacts are regenerated and byte-parity is green; the OG card, embed variant, badge SVGs and share pages are untouched; both explainers are within budget with every gated phrase and every qualifier intact; and no page makes a claim it did not make before.

---

## Scope Boundaries

**In scope:** `generator/explainers.py`, `generator/holder.py`, their tests, and the three regenerated artifacts.

**Not in scope:**
- **The Open Graph card (`og.py`).** Its own plan. It is a 1200×630 raster, not an HTML page — no CSS, no focus states, no breakpoints. Its palette question is now half-settled: the share-page plan's KTD3 makes the domain **light-first** and keeps the canon dark theme out of `canon.py` entirely, so the card goes canon paper unless someone reopens that decision on its own merits. What remains open for the card's plan is whether it stays **per-course** — the share-page plan's KTD2 answered that for the page and explicitly not for the card, which still runs its whole field off `colors.palette_for(course_id)`.
- **The embed variant.** It renders inside third-party pages at 340×380. Imposing Andamio's paper/ink on a host with its own brand is a different question from domain consistency, and probably has a different answer.
- **The credential designer at `/design/`.** Deferred by decision. Note that it is the domain's only surface loading external stylesheets (`fonts.googleapis.com`, two separate families), so it breaches the no-external-assets invariant the share-page plan calls load-bearing. That is a correctness fix worth doing on its own timetable, independent of any restyle.
- **Holder viewer layout** — `#89` owns it (KTD6).
- Any change to what the pages claim (R3).

---

## Open Questions

**Q1 — Is the `how-to-check` budget right?**
KTD5 sets ≤ 470 from 546, a ~15% trim of phrasing. That is the honest saving available without cutting content, and the page's content is a trust model plus a verification procedure plus a caveat that keeps 57 unsigned badges honest. A materially shorter check page means deciding it should do less — for example, moving the four-party trust model to its own page and leaving the procedure here. That is a content decision, not an implementation detail, and it should be settled before U2 starts if the answer is anything other than "the budget is right."

---

## Risks

| Risk | Mitigation |
|---|---|
| A brevity pass removes a qualifier and silently widens a claim | KTD4 makes the gates a floor and forbids editing them to land a cut; U2's stop rule says report, don't edit. `docs/solutions/conventions/never-delete-a-qualifier-that-bounds-a-claim.md` is the precedent |
| Copy changes hide inside a restyle diff where a reviewer cannot see them | KTD3 splits the units; U1 and U3 assert extracted body text is byte-identical |
| The restyle re-couples these pages to `gen.FONT_FACE` and drags the signed badge SVGs with it | U1.3 points them at `page_fonts.css`; U4 asserts `generator/fonts.css` and every SVG unchanged |
| Canon values get hand-copied here, creating a second drift clock | KTD1 requires importing `canon.py`; a test asserts no inlined canon hex |
| The holder viewer is restyled now and re-laid-out by `#89` shortly after | KTD6 accepts this explicitly and limits U3 to tokens, so the discarded work is minimal |
| A `.pyc` cache masks a source edit | `docs/solutions/runtime-errors/stale-pycache-bytecode-masks-source-edits.md` |

---

## Sources & Research

- `docs/plans/2026-07-31-001-feat-share-page-brand-canon-plan.md` — the sibling plan; `canon.py`, `page_fonts.css` and the accent rules all originate there.
- `generator/tests/test_explainers.py` — the eight gates, and the reason each exists. `test_check_page_does_not_overclaim_signature` is the one that matters most: only the flagship badge is signed today.
- `generator/tests/test_holder.py:123` — the viewer must not imply it cryptographically verifies; the no-trust claim belongs to `how-to-check`.
- `docs/solutions/conventions/never-delete-a-qualifier-that-bounds-a-claim.md`
- `#89` — why the holder viewer's layout is not settled.
- `docs/verifier-guidance.md` — the technical reference `how-to-check` adapts.
