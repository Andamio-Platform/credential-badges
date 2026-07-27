---
title: "fix: centre the embedded badge and de-duplicate the verification caveat"
type: fix
status: active
date: 2026-07-27
depth: standard
issues:
  - "Andamio-Platform/credential-badges#81 — Embedded badge is not horizontally centred"
  - "Andamio-Platform/credential-badges#82 — The verification caveat appears twice, in developer language"
parent: "Andamio-Platform/product-circle#150 (internal)"
---

# fix: centre the embedded badge and de-duplicate the verification caveat

## Summary

Two independent, already-diagnosed defects on the v1.2 badge surfaces, both owned by a single generator module (`generator/page.py`):

- **#81** — in the iframe embed variant, the badge image sits left of centre while the "View credential" link beneath it centres correctly. A CSS fix in one rule.
- **#82** — the signed-VC / DI-capable-verifier caveat is rendered twice on the badge share page, ~100px apart, in the densest technical language on a page whose primary visitor is the holder who just earned the credential.

They share a file, a regeneration step (`make pages`), and a byte-parity guard, so they ship together as one change rather than two conflicting regenerations of the same 116 committed artifacts.

---

## Problem Frame

### #81 — Embedded badge is not horizontally centred

`generator/page.py::_embed_html` renders a flex-column body (`align-items:center`) containing two anchors: one wrapping the badge `<img>`, one carrying "View credential →". The link centres; the image does not, and the offset grows with iframe width — modest at 340px, near flush-left at 620px. Vertical centring is correct.

The reporter's non-binding diagnosis (recorded on the issue, verified in a side-by-side reproduction): the `<img>` carries a percentage width (`width:min(240px,72%)`) that cannot be resolved during intrinsic sizing, so the wrapping anchor falls back to the image's intrinsic width and clamps to the full available width. The `display:block` image inside then sits hard left of an anchor that is now wider than it. An auto inline margin on the image rule resolved it.

The badge artwork is dead-centred in its own square canvas, so this is not a generator/rasterization issue — it is purely the embed page's CSS.

### #82 — The verification caveat appears twice, in developer language

Two paragraphs on the badge share page carry the same clause:

- `.actions-note` (`generator/page.py:149` `_svg_note`) — sits under the download buttons.
- `.verify` (`generator/page.py:188` `_verify_note`) — sits below the divider at the page foot.

Both are `color:var(--slate)`, `max-width:44ch`, and separated only by the explainer links and a divider, so they read as two near-identical grey paragraphs. Both name "DI-capable OB 3.0 / VC verifiers" and "signed verifiable-credential baking … is rolling out" — precise, load-bearing wording, but written for a verifier, not for the holder standing in front of it.

**Open question from the issue, answered:** yes, the page knows whether a badge is signed. `page._is_baked(stem)` reads the committed SVG for `proofValue` and both notes already branch on it. Today exactly one badge (the Flagship) is baked; the other 57 are presentation-only. So the fix does not need to introduce baked-awareness — it needs to preserve the two existing branches while collapsing the duplication within each.

### Why the two ship together

`make pages` regenerates all 58 `badges/*.html` and all 58 `badges/*.embed.html` from `page.py`. `generator/tests/test_page.py::test_main_output_byte_identical_to_committed_pages` asserts every regenerated file is byte-identical to its committed counterpart. Landing #81 and #82 separately means regenerating and re-committing the same 116 artifacts twice.

The honest reason to bundle is **review economy**, not an unavoidable technical constraint: a conflict across generated artifacts is resolved by discarding both sides and re-running a deterministic `make pages`, which is one command. Bundling buys one regeneration and one reviewable diff instead of two.

Because the constraint is soft, there is an escape hatch: **if the #82 copy needs more than one review round, land U1 alone** (regenerate, and note that the `badges/*.html` pages come back byte-identical when only the embed CSS changed, so parity holds), then rebase #82 by re-running `make pages`. A one-declaration CSS fix with a verified repro should not sit behind a copy debate.

---

## Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| R1 | The badge image is horizontally centred at any iframe width | #81 "Done when" |
| R2 | The badge image and the "View credential" link share the same centre line | #81 "Done when" |
| R3 | The verification caveat appears exactly once on the badge share page | #82 "Done when" |
| R4 | Its wording is readable by someone who is not a developer | #82 "Done when" |
| R5 | The full technical precision stays reachable from the page, with the "How do I check this?" explainer as its home | #82 "Done when" |
| R6 | The replacement copy is no vaguer and no more generous than the truth — it must not overclaim a signature or a verifier class | #82 "Hard constraint" |
| R7 | The baked/unbaked distinction is preserved — a presentation-only badge and a signed badge do not carry identical wording | #82 open question, resolved |
| R8 | The committed `badges/` tree stays byte-identical to generator output | `test_main_output_byte_identical_to_committed_pages` |

---

## Key Technical Decisions

### KTD-1 — Fix #81 with an auto inline margin on the image rule, not by restructuring the embed layout

Add `margin:0 auto` to the `img` rule in `_embed_html`'s inline stylesheet. This is the fix the reporter verified in a side-by-side reproduction, it is a one-declaration change, and it is correct in both states of the anchor: when the anchor is stretched to full width the auto margins centre the image; when the anchor shrink-wraps the image they resolve to zero and nothing moves.

`margin:0 auto` is preferred over `margin-inline:auto` purely for maximum renderer compatibility — the embed runs inside third-party iframes on browsers we do not control, and the img rule has no existing margin to preserve, so the physical shorthand costs nothing.

**Rejected:** restructuring so the wrapping anchor is `display:block;width:min(240px,72%)` with `img{width:100%}`. It would fix the centring *and* shrink the anchor's oversized hit area, but the hit area is a pre-existing behaviour nobody reported, and changing the anchor's box model in an embed rendered on third-party sites is a larger blast radius than the issue warrants. Noted under Deferred.

### KTD-2 — Resolve #82 by splitting concerns, not by deleting one paragraph

The two paragraphs are not redundant by position — they answer different questions. `.actions-note` sits under the download buttons and answers *which file do I download*. `.verify` sits at the page foot and answers *how is this checked*. The duplication is that the verification caveat leaked into the download note.

So: strip the verification clause from `.actions-note`, leaving it a pure download affordance ("SVG carries the credential, PNG is for display"), and keep exactly one caveat in `.verify`, rewritten in the holder's register. This satisfies R3 without losing the download guidance that the note exists to give.

### KTD-3 — Plain-language rewrite replaces the verifier-class name with a plain-language *bound*, and links to where the precision lives

The precise phrase "DI-capable OB 3.0 / VC verifiers" is the densest term on the page. It is not dropped from the product — `generator/explainers.py::_check_page` already carries the full precision (step 2 names the phrase, the JWS-format caveat, and spruce / the 1EdTech validator; the "Status" note already states that most badges prove themselves by their on-chain anchor and that signing is rolling out). The badge page already links that explainer from the `.explainers` slot.

**The bound must survive the rewrite.** Simply deleting "DI-capable OB 3.0 / VC verifiers" and saying the badge "can be checked independently" does *not* narrow the claim — it removes the ceiling and lets the reader supply the broadest one. This repo's own evidence says the ceiling is real: `generator/explainers.py:172` warns that "Verifiers that read only JWS-style credentials will not read this proof format", and `spike/verifier-spike/results/walt-id.md` records a real verifier that is structurally unable to read this Data Integrity JSON-LD proof. An employer who reads "anyone can check it", runs a mainstream OB3 tool, and gets a failure concludes a genuine credential is fraudulent — precisely the harm the wording gate exists to prevent.

So the rewrite (a) keeps a plain-language compatibility bound — "compatible verifier software" — in place of the technical class name, (b) states what the on-chain check actually is rather than implying frictionless checkability, and (c) adds an inline link to `/badges/how-to-check` from the caveat itself, so the precision is one click from the sentence that gestures at it. This is the R5 disposition the issue asks for — the explainer is the home, the page points at it — while honoring the R6 hard constraint that the replacement never reads more generous than the truth.

**Link text.** The inline link must NOT reuse the `.explainers` slot's label. That slot already renders `How do I check this?` → `/badges/how-to-check` (`generator/page.py:291`), immediately above the divider that `.verify` sits below — an identical label and href ~40px apart reads as accidental duplication, and a screen-reader user tabbing through gets two identically-announced destinations back to back. The inline link uses **"How this badge is checked"**, so the page carries one label per affordance: a nav item and an inline citation.

### KTD-4 — The wording gate is relocated, not weakened

`generator/tests/test_page.py::test_wording_gate` currently asserts both halves of the gate on the badge page:

```
assert "any OB3 verifier" not in html          # the real invariant
assert "DI-capable OB 3.0 / VC verifiers" in html   # a proxy for "we named the class"
```

KTD-3 removes the precise phrase from the page's visible copy, so the positive assertion would fail. It must not simply be deleted — the invariant it proxies for (we never let the page imply broader verifiability than exists) is load-bearing trust copy.

Disposition:
- The **negative** assertion stays on the page and is *strengthened* with additional no-overclaim assertions (see U3 test scenarios).
- The **positive** assertion moves to where the phrase now lives. `generator/tests/test_explainers.py:116` and `generator/tests/test_holder.py:75` already assert it on the explainer and the holder viewer; the page test gains an assertion that the **`.verify` paragraph itself** links the explainer that carries it. Asserting page-wide link presence would be satisfied by the pre-existing `.explainers` slot and by `test_explainer_links_present` (`generator/tests/test_page.py:130`), so the inline citation could silently drop with all tests green — the assertion must be scoped to the extracted `.verify` paragraph, on both the baked and unbaked branches.

**`test_verifiability_copy_is_baked_aware` must be re-anchored, not left alone.** This is a correction to an earlier reading of this plan: the test does **not** survive U2 untouched. `generator/tests/test_page.py:178` asserts `"anchored on-chain" in unbaked` and `:183` asserts `"is the signed verifiable credential" in baked`. Both strings live only in `_svg_note`, which U2 rewrites — so both assertions go red. That matters beyond the red itself: an implementer hitting an unexpected failure on a test the plan promised would pass has a strong pull toward the fastest green, which is deleting the positive R7 assertions — the exact trust guard this KTD argues must never simply be deleted.

Two requirements follow:

1. **R7's positive half stays positive.** It must be re-anchored onto strings that exist in the new copy, never reduced to negative-only guards. The unbaked `.actions-note` deliberately retains the literal `anchored on-chain` (it is a property of the data, not a verification caveat, so keeping it costs no plainness and no precision) which preserves the unbaked anchor for free.
2. **The baked discriminator must be absent from the unbaked branch.** The bare word "signed" now appears in *both* variants — the unbaked copy says a signed copy "is rolling out". Re-anchoring the baked assertion to `"signed"` would silently convert R7 into a tautology. Use the full phrase `the SVG you can download is signed`, and assert it is *absent* from the unbaked page.

The module docstrings in `page.py` that describe the wording gate are updated to describe the relocated shape, so the next reader does not restore the old assertion.

### KTD-5 — Regenerate committed artifacts in the same commit as the generator change

`make pages` and commit the resulting 116 files. The parity test is the enforcement; skipping regeneration turns it red. Do not run `make badges`, `make pngs`, or `make og-cards` — no SVG, PNG, or OG-card input changes here, and regenerating them would put unrelated churn in the diff.

---

## Proposed Copy

Recorded here so the wording is reviewable as a decision, not discovered in the diff.

An implementer may improve *phrasing*. An implementer may **not**, without coming back through review: drop the compatibility bound ("compatible verifier software"), promote checkability to an unqualified "anyone", or introduce a claim the R6 audit below does not cover. R6 is a hard constraint from the issue, and the only automated control is a negative substring list that catches enumerated phrasings — so the audit, not the test, is what holds the line.

### Unbaked — the 57-badge majority

| Slot | Current | Proposed |
|------|---------|----------|
| `.actions-note` | Download the **SVG** — it carries this credential's data, anchored on-chain. (Signed verifiable-credential baking, checkable by DI-capable OB 3.0 / VC verifiers, is rolling out; the PNG is for display.) | Download the **SVG** — it carries this credential's data, anchored on-chain. The PNG is for display. |
| `.verify` | This badge is anchored on Cardano — the on-chain record is the proof. Signed verifiable-credential baking, checkable by DI-capable OB 3.0 / VC verifiers, is rolling out. | This badge is anchored on Cardano — the public blockchain record is the proof, and anyone can look it up on a public Cardano explorer. A signed copy you can check with compatible verifier software is rolling out. [How this badge is checked](/badges/how-to-check) |

### Baked — the Flagship

| Slot | Current | Proposed |
|------|---------|----------|
| `.actions-note` | The **SVG** is the signed verifiable credential — download it and check it with DI-capable OB 3.0 / VC verifiers, no need to trust Andamio. The PNG is for display. | The **SVG** is the signed credential itself — download it to keep or share. The PNG is for display. |
| `.verify` | This badge is anchored on Cardano, and its SVG is a signed, self-contained credential — download it and check it with DI-capable OB 3.0 / VC verifiers, no need to trust Andamio. | This badge is anchored on Cardano, and the SVG you can download is signed — check it with compatible verifier software, without taking Andamio's word for it. [How this badge is checked](/badges/how-to-check) |

**Accuracy audit against R6.** Clause by clause, because R6 is the hard constraint and an unaudited clause reaching implementation is the failure this section exists to prevent:

- *"anchored on Cardano / the public blockchain record is the proof"* — restates the existing claim verbatim in plainer words.
- *"anyone can look it up on a public Cardano explorer"* — replaces an earlier draft's bare "anyone can check it", which was a **new, unaudited claim**. Checking an unbaked badge means extracting the OB3 document, finding the evidence entry, and matching a claim transaction — explainer step 3, which is a real lookup on a public explorer but not a frictionless one. Naming the actual action keeps the promise honest and matches what the explainer tells the reader to do.
- *"a signed copy you can check with compatible verifier software is rolling out"* — restates "signed verifiable-credential baking … is rolling out" while **keeping the compatibility bound**. "Compatible verifier software" is the plain-language form of "DI-capable OB 3.0 / VC verifiers": it signals that not all tooling qualifies, without naming the class. Dropping the bound entirely would have read *more* generous than the current wording, not less — see KTD-3.
- *Baked `.verify`, "check it with compatible verifier software, without taking Andamio's word for it"* — keeps both claims the Flagship actually earns (it is signed; it needs no trust in the issuer) and keeps the compatibility bound.
- *Baked `.actions-note`, "the signed credential itself — download it to keep or share"* — a pure download affordance. An earlier draft said "download it to check this badge independently", which repeated the `.verify` check claim in the same two grey paragraphs ~100px apart and so left R3 **unmet on the Flagship** while contradicting KTD-2's own stated principle. It now makes no verification claim at all.

Neither variant asserts that arbitrary verifier tooling will read the proof — the thing the gate exists to prevent — and neither promotes checkability to an unqualified "anyone".

`.actions-note` retains the literal substrings "PNG is for display" (asserted by `test_download_controls_present`) and, on the unbaked branch, "anchored on-chain" (the re-anchor point for R7 — see KTD-4).

`_description()` (the `<meta name="description">` / OG description) is **left unchanged**. It is crawler-facing metadata, not one of the two visible grey paragraphs the issue is about, and its baked branch is the last place the precise phrase appears in the page HTML. Touching it would widen the diff without advancing any requirement.

---

## Implementation Units

### U1. Centre the embedded badge image

**Goal:** the badge image in the iframe embed is horizontally centred at any width, sharing a centre line with the link beneath it.

**Requirements:** R1, R2

**Dependencies:** none

**Files:**
- `generator/page.py` — the `img` rule in `_embed_html`'s inline `<style>` (around line 322)
- `generator/tests/test_page.py` — new regression test

**Approach:** add `margin:0 auto` to the existing `img{width:min(240px,72%);height:auto;display:block;}` rule. Do not change the flex container, the anchor, or the image's width expression — the flex centring is already correct and does centre the anchors (per the issue's diagnosis); the image just needs to centre within an anchor that may be wider than it.

**Patterns to follow:** the badge share page's own `.badge` rule (`generator/page.py:252`) already uses `margin:0 auto 28px` on a `display:block` image for exactly this reason — the fix makes the embed consistent with the page it mirrors.

**Test scenarios:**
- `_embed_html` output's `img` rule contains an auto horizontal margin — the image can centre within a wider anchor.
- The `img` rule still carries `display:block` and the `min(240px,72%)` width — the fix adds a declaration rather than replacing the sizing behaviour.
- The embed body retains `align-items:center` — the fix does not regress the anchor centring that already works.
- Existing `test_embed_variant_minimal_and_links_back` still passes: root-relative `src`, link back to the page, no share chrome.

**Verification:** regenerated `badges/*.embed.html` carry the auto margin; opening one at 340px and 620px widths shows the badge and the "View credential" link on the same centre line.

### U2. Split the download note from the verification caveat

**Goal:** the verification caveat appears exactly once, in plain language, linking to the explainer that carries the full precision — with the baked/unbaked distinction preserved.

**Requirements:** R3, R4, R5, R6, R7

**Dependencies:** none (independent of U1; sequenced first only by convention)

**Files:**
- `generator/page.py` — `_svg_note` (line 149), `_verify_note` (line 188), and the module/function docstrings describing the wording gate

**Approach:** apply the Proposed Copy table. `_svg_note` loses its verification clause in both branches and becomes a pure download affordance (the unbaked branch keeps "anchored on-chain", which is a property of the data, not a verification caveat). `_verify_note` keeps both branches, rewritten in the holder's register with the compatibility bound intact, each ending with an inline anchor to `/badges/how-to-check` labelled **"How this badge is checked"** — deliberately *not* the `.explainers` slot's "How do I check this?", see KTD-3.

The `.verify a` CSS rule already exists (`generator/page.py:259-260`) and styles inline links in that paragraph, so no stylesheet change is needed for the new link. The `.explainers` slot links stay as they are.

Update the `_svg_note` / `_verify_note` docstrings and the `_share_controls` docstring paragraph about the baked gate to describe the new split, so the intent survives the next reader.

**Test scenarios:**
- Unbaked page: "DI-capable" appears zero times in the whole document — the unbaked `_description()` branch does not contain it either, so the caveat is genuinely gone from that page. Scope this assertion to the unbaked page only: the **baked** page's `_description()` is deliberately unchanged and still carries the phrase three times (meta description, `og:description`, `twitter:description`), so generalizing the assertion to `FLAGSHIP_REC` produces a red test that is not a real defect.
- Unbaked page: `.actions-note` contains no verification claim — assert the absence of "rolling out" and "verifier" within the extracted `.actions-note` paragraph. ("anchored on-chain" is expected and must remain.)
- Unbaked page: `.verify` contains the anchor claim and the rolling-out claim exactly once.
- Baked page (`FLAGSHIP_REC`): `.verify` claims the SVG is signed and checkable with compatible verifier software; the extracted `.actions-note` contains no check claim at all — assert absence of "check" within it, so the R3-on-Flagship regression that an earlier copy draft carried cannot come back.
- **Both** branches: the extracted `.verify` paragraph contains an `href="/badges/how-to-check"`. Assert against the extracted paragraph, not page-wide — page-wide is already satisfied by the `.explainers` slot, so a page-wide assertion would let the inline citation drop silently.
- Both branches: the inline `.verify` link text is not character-identical to the `.explainers` slot label — guards the duplicate-label regression KTD-3 rules out.
- Baked and unbaked `.verify` text differ — R7 regression guard, so the two states cannot converge on identical wording.
- `.actions-note` still contains "PNG is for display" in both branches — `test_download_controls_present` continues to pass.
- No-overclaim guard on the new strings, both branches: neither note contains "any OB3 verifier", "any verifier", "any OB 3.0", or the unqualified "anyone can check it". The last is the phrasing an earlier copy draft shipped, and it is the reason the guard cannot be a fixed list alone — see the Risks table.

**Verification:** rendering an unbaked and the baked page shows one caveat paragraph each, in the holder's register, with a working link to the check explainer.

### U3. Relocate the wording gate and add the no-overclaim guards

**Goal:** the wording-gate invariant is enforced in its new shape — the page never overclaims, and the page's link to the precision is itself test-enforced.

**Requirements:** R5, R6, R7, KTD-4

**Dependencies:** U2

**Files:**
- `generator/tests/test_page.py` — `test_wording_gate` **and `test_verifiability_copy_is_baked_aware`** (both require edits, see below), plus the new tests from U1 and U2

**Approach — two edits, not one.**

*`test_wording_gate`:* rewrite to assert the invariant rather than the proxy. Keep and extend the negative assertions; replace the positive phrase assertion with an assertion that the extracted `.verify` paragraph links `/badges/how-to-check` (whose own test, `test_explainers.py:116`, asserts the precise phrase is there). Note in the comment that this is deliberately narrower than `test_explainer_links_present` (`generator/tests/test_page.py:130`), which already covers page-wide link presence — so a future reader does not delete it as redundant.

*`test_verifiability_copy_is_baked_aware`:* re-anchor, do not delete. Its two positive assertions both break under U2 (`"anchored on-chain" in unbaked` at line 178, `"is the signed verifiable credential" in baked` at line 183). Re-anchor as:
- unbaked positive: `"anchored on-chain"` — still present, since U2 deliberately keeps it in the unbaked `.actions-note`
- baked positive: `"the SVG you can download is signed"` — the full phrase, **not** bare `"signed"`, which now appears in the unbaked copy too ("a signed copy … is rolling out") and would make the assertion a tautology
- unbaked negative: the baked discriminator phrase is absent from the unbaked page

Leave `test_explainers.py` and `test_holder.py` untouched — they already hold the positive half of the gate on the surfaces that still carry the phrase.

Add a comment in both tests explaining *why* each assertion moved, so a future reader does not "restore" the old form and re-introduce developer language onto the holder's page.

**Execution note:** re-anchor `test_verifiability_copy_is_baked_aware` in the same edit that lands U2's copy, and run the suite before moving on. If the test is left red between steps, the fastest path back to green is deleting the R7 positive assertions — the trust guard KTD-4 exists to preserve.

**Patterns to follow:** the existing assertion style in `generator/tests/test_page.py` — plain `assert` with a failure message, a `print("  ✅ …")` line per test, no third-party framework.

**Test scenarios:**
- `test_wording_gate` fails if the page ever says "any OB3 verifier" (unchanged invariant), on both the unbaked and the baked page.
- `test_wording_gate` fails if the `.verify` paragraph stops linking `/badges/how-to-check` — the route to the precision cannot silently break.
- `test_verifiability_copy_is_baked_aware` passes on the re-anchored strings, and its R7 discrimination is real: mutating the unbaked copy to carry the baked signature phrase turns it red.
- Re-anchoring to bare `"signed"` instead of the full baked phrase would pass on both branches — confirm by inspection that the chosen discriminator is absent from the unbaked page, so the guard is not a tautology.
- `python3 generator/tests/test_explainers.py` still passes unchanged — the precise phrase is still asserted where it now lives.

**Verification:** `python3 generator/tests/test_page.py` and `python3 generator/tests/test_explainers.py` both pass; deliberately reverting U2's copy change turns the new assertions red.

### U4. Regenerate the committed badge artifacts

**Goal:** the committed `badges/` tree matches generator output, so the byte-parity guard passes.

**Requirements:** R8

**Dependencies:** U1, U2

**Files:**
- `badges/*.html` (58 files) — regenerated by U2's copy change
- `badges/*.embed.html` (58 files) — regenerated by U1's CSS change

**Approach:** run `make pages`. Nothing else — no `make badges`, `make pngs`, `make og-cards`, `make explainers`, or `make holder`; none of their inputs changed, and regenerating them would add unrelated churn.

Note the repo-wide `PYTHONDONTWRITEBYTECODE` guard in the `Makefile`: a stale `__pycache__` can mask a source edit on a local regeneration whose output then gets committed. Use `make pages` rather than invoking `page.py` directly so the guard applies.

**Test scenarios:**
- `test_main_output_byte_identical_to_committed_pages` passes — all 58 pages and 58 embed variants regenerate byte-identically.
- Spot-check one regenerated `badges/*.embed.html` for the auto margin and one `badges/*.html` for the single caveat.
- The diff touches exactly 116 files under `badges/` plus the generator and test files — no SVG, PNG, or OG-card churn.

**Verification:** `python3 generator/tests/test_page.py` passes end to end, including the parity test; `git status` shows only the expected file set.

---

## Scope Boundaries

**In scope:** `generator/page.py` (`_embed_html` CSS, `_svg_note`, `_verify_note`, docstrings), `generator/tests/test_page.py`, and the 116 regenerated files under `badges/`.

**Not in scope:**

- `generator/explainers.py` — the check explainer already carries the full technical precision (step 2 and the Status note) and is already linked from every badge page. R5 is satisfied by what exists; editing it would be unrequested scope.
- `web-component/andamio-badge.js` and `embed/andamio-badge.js` — the component's card is a fixed 300px box whose image is `width:100%` inside a block container, so it does not have #81's percentage-in-intrinsic-sizing problem. Its `stateNote` is a single line, not a duplicated caveat. Both are byte-pinned equal in CI; changing them would require a version bump and an npm republish for no defect.
- `generator/holder.py` / `badges/_holder.html` — the standalone holder viewer mentions DI-capable verifiers in two places too, but it is a different surface (#73) with a different reader, and #82 is explicitly scoped to the credential share page. Recorded below.
- `_description()` in `page.py` — crawler-facing metadata, not one of the two visible paragraphs. See KTD-3.

### Deferred to Follow-Up Work

- **Holder-viewer caveat review.** `generator/holder.py` renders the DI-capable phrasing at two points (`badges/_holder.html:84` and `:97`). Whether that is the same duplication defect or two legitimately different statements needs its own read of that page's reader model — and the reader is plausibly the same holder, so the deferral is scope discipline, not a claim that the surfaces differ. **File the issue as part of shipping this change**, so the two-register window (see Risks) is bounded rather than open-ended.
- **Make R6 enforceable rather than review-dependent.** A reviewed copy fixture keyed by baked state — the approved strings checked into the test suite — would turn "does this overclaim?" from reviewer attention into a diff. The current negative-substring guard only catches enumerated phrasings. Worth an issue once the copy has settled.
- **Embed anchor hit area.** The anchor wrapping the embed's badge image stretches to the full iframe width, so the clickable region is wider than the badge. Pre-existing, unreported, and orthogonal to the centring fix (KTD-1). If it is worth fixing, the block-anchor restructure rejected in KTD-1 is the shape.

---

## Risks

| Risk | Mitigation |
|------|------------|
| The plain-language rewrite weakens the verifiability claim by dropping the verifier-compatibility bound | This is the live risk, not a theoretical one — an earlier draft of the copy did exactly that ("can be checked independently", "anyone can check it"). The Proposed Copy section now records the exact strings and audits them **clause by clause**, and every variant keeps a plain-language bound ("compatible verifier software"). KTD-3 states why removing the bound reads as broader, not narrower. |
| The no-overclaim guard is a fixed substring list, so it only catches phrasings someone thought to enumerate | Acknowledged and unresolved by this change — the guard catches the known family plus the specific phrasing an earlier draft shipped, and the clause-by-clause audit is the real control. R6 compliance rests on review attention at the point where copy changes. A reviewed copy fixture keyed by baked state would make it enforceable; recorded under Deferred as the durable fix. |
| The plan says prose is authoritative over the exact strings, which hands trust-copy authorship to implementation time | Narrow that licence: an implementer may improve *phrasing*, but may not drop the compatibility bound, promote checkability to an unqualified "anyone", or add a claim the R6 audit does not cover. Any such change comes back through review. |
| Two registers ship simultaneously — plain language on the badge page, "DI-capable OB 3.0 / VC verifier" twice on the holder viewer (`generator/holder.py:157`, `:170`), which back-links to the same explainer | Accepted knowingly for the interim. Both are holder-facing surfaces, so the "different reader" argument for deferring is weaker than it first looks; the split is a voice inconsistency a holder can encounter. Bounded by filing the holder-viewer issue (see Deferred) as part of shipping this, rather than leaving it open-ended. |
| The relocated wording gate is read as a deleted safety test | KTD-4 makes the relocation explicit, the negative assertions are strengthened rather than kept flat, the page→explainer link becomes test-enforced, and the docstrings are updated so the next reader sees the new shape. |
| The 116-file regeneration buries the 3-file logic change in review | Regenerate in the same commit as the generator change (KTD-5) and touch nothing else under `badges/`, so the churn is exactly the mechanical consequence of the source edit and reviewers can read `generator/` alone. |
| `margin:0 auto` does not fix every engine's centring | The reporter verified this exact fix in a side-by-side reproduction across three iframe shapes (340×380, 340×620, 620×300). The declaration is a no-op when the anchor shrink-wraps, so it cannot regress the working case. |

## Dependencies

None external. Regeneration needs only `python3` — no network, no `npm ci` in `imaging/`, no authed `andamio` CLI.

## Sequencing

U1 and U2 are independent source edits and can land in either order.

U3 depends on U2's copy landing, and should land **in the same working state** rather than as a separate later step: U2 turns `test_verifiability_copy_is_baked_aware` red the moment it lands (KTD-4), and a red trust guard sitting between steps invites the wrong fix. Treat U2+U3 as one edit-and-run cycle.

U4 depends on both U1 and U2, and must be the last step before commit — regenerating before the source edits are final produces artifacts that the parity test will reject.
