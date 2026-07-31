# Residual review findings — `feat/explainers-holder-canon`

Source: `ce-code-review` (correctness, testing, project-standards, adversarial) over
the canon conformance of `generator/explainers.py` and `generator/holder.py`,
2026-07-31. Nine findings were applied on the branch; these two were not.

Cross-model adversarial peer: **not run** — the operator prohibits outbound calls
to external services unless explicitly requested. The in-process
`adversarial-reviewer` ran as the sanctioned fallback.

---

## R1 — The holder viewer's `<h1>` claims a credential the stem-less route never names

**P3 · human decision · `generator/holder.py` (the `<h1>`)**

`_holder.html` is served for `/badges/{stem}/{alias}`, but nginx's
`location ~ \.html$` also serves it directly at `/badges/_holder.html`. On that
path `parsePath` returns null, `boot()` disables the input and returns before
`renderVerdict` runs, so the verdict region stays empty and hidden — while the
static heading still reads *"This credential, and every badge held by this
holder"* above a body that says *"Open a holder view from a badge page."*

The previous wording (*"Badges held by …"*) was true on both routes. The new
wording was a deliberate product change — the route answers two questions and the
heading named only one — so this is a phrasing trade, not a defect. Recorded
rather than reverted because the change was requested.

Options if it is worth closing: have `boot()`'s `!route` branch rewrite the
heading, or split the credential clause into an element that branch hides.

## R2 — `test_check_page_does_not_overclaim_signature` rides on the wrong paragraph

**P2 · pre-existing · `generator/tests/test_explainers.py`**

Not introduced by this change, and left alone to keep the diff scoped — but it
weakens a claim ceiling on the surface linked from all 58 badge pages, so it
should not stay hidden in a review log.

The gate asserts `"on signed" in html.lower() or "signed</strong> badges" in html`.
The first arm **has never matched**: step 2 of the check page reads *"(on a signed
badge)"*, which does not contain the substring `on signed`. So the whole assertion
rides on the second arm, which is satisfied by the **Status** note — a different
paragraph from the step being gated.

Demonstrated: deleting the *"(on a signed badge)"* qualifier from step 2 turns a
scoped instruction into a universal one, and the gate still passes.

Two sibling weaknesses of the same shape, also pre-existing:

- `assert "any OB3 verifier" not in html` is a one-literal blocklist. *"any OB 3.0
  verifier"*, *"any OB3-compatible verifier"* and *"works with any Open Badges 3.0
  verifier"* all clear it while making exactly the forbidden claim.
- `test_hash_and_anchor_level_no_reveal_link` loops both pages, but both satisfy
  it from the single shared `_REVEAL_NOTE` constant — so the disclosure statement
  could be removed from either page's own copy with the gate green.

The fix shape is the same in each case: assert the qualifier **inside the sentence
it qualifies** (slice the `<li>` and assert within it), and match a pattern rather
than one literal. Natural companion to U2, the deferred copy-tightening unit,
since that unit will be editing this copy under these gates.

---

### Applied on the branch (for context, not action)

Font-embedding assertion and 80 KB ceiling on both surfaces; font-isolation
asserted against the emitted artifact instead of source text; orange pinned to the
one permitted rule rather than an occurrence count; `color:var(--orange)` banned;
AA guard flipped from a token blocklist to an allowlist plus an `opacity` check;
subresource scan made quote-agnostic and protocol-relative-aware; canon-inlining
guard widened from 4 hand-picked tokens to every entry in `canon.TOKENS`; a
no-accent guard added for the explainers; and the alias input's boundary raised
from `--cell` (~1.40:1) to `--ghost` for WCAG 1.4.11.

Each was verified by mutation: the invariant was broken in a scratch copy and the
suite confirmed red before the fix was accepted.
