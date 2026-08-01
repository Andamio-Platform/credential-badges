---
title: A guard must assert the emitted artifact, never the source that describes it
date: 2026-08-01
category: conventions
module: generator
problem_type: convention
component: testing_framework
severity: high
applies_when:
  - "Writing a test that guards an invariant by inspecting generator source rather than generated output"
  - "Mirroring a guard test from one surface's suite onto another"
  - "Adding a value guard (contrast, permitted tokens, permitted origins) as a blocklist"
  - "Reviewing a PR whose main deliverable is new guard tests"
symptoms:
  - "A guard passes against output that visibly violates the invariant the guard is named after"
  - "A test asserts a constant's NAME appears in source, and a docstring mentioning it satisfies the assertion"
  - "A mirrored test silently loses a conjunct its reference carried, and the whole suite stays green"
root_cause: inadequate_documentation
resolution_type: test_fix
tags: [testing, guard-tests, invariants, mutation-testing, generator, false-confidence]
---

# A guard must assert the emitted artifact, never the source that describes it

## Context

`generator/` emits self-contained HTML for a forever-public credential host, so a
set of guard tests protects invariants the type system cannot: fonts must be
embedded, no subresource may come from a foreign origin, text must clear AA
contrast, and a page restyle must never reach the font file that is inlined into
the **signed** badge SVGs.

Those guards were written, ran green, and were wrong. A four-lens code review
independently **constructed and executed** cases where a guard passed while the
invariant it names was violated. Four instances, one root cause: each guard
asserted on *source text* or a *proxy* rather than on the *emitted artifact*.

This is the sibling of
[`unwired-test-suites-silently-rot.md`](../workflow-issues/unwired-test-suites-silently-rot.md).
That one is a suite that never runs. This one is a suite that runs, passes, and
protects nothing — the same failure wearing a green tick, which makes it worse.

## Guidance

**Assert against what shipped, not against the code that shipped it.**

The four failures and what each proves:

**1. A fallback made every guard vacuous at once.** `gen.PAGE_FONT_FACE` in
`generator/gen.py` falls back to `""` when its stylesheet is absent. With it
empty, *every* canon guard passed on three fontless pages. `'"Inter" in html'`
was satisfied by the CSS `font-family` stack, not by embedded `@font-face` bytes.
The foreign-subresource scan passed **more easily**, because an empty block has
zero `url()` matches to check. Byte-parity was the only dissenter, and it stops
dissenting the moment the artifacts are regenerated in that same environment — so
CI would have gone fully green on three fontless public pages.

**2. A source grep was defeated by an alias, and its positive half by a
docstring.** A guard asserting "must not inline the signed-SVG font block"
grepped source for `gen.FONT_FACE`. `from gen import FONT_FACE as _FF` defeats
it. Its positive half — "must use `gen.PAGE_FONT_FACE`" — was satisfied by a
**docstring mentioning the name in prose**. The test could not distinguish a file
that used the artifact from one that merely wrote about it.

**3. A mirrored test lost the half that did the work.** An "orange must never be
text colour" guard checked the raw hex form — which a sibling test already makes
unreachable by forbidding that literal in source at all. The load-bearing
`color:var(--orange)` conjunct had been dropped when the test was copied from its
reference in `generator/tests/test_page.py`. Brand orange on canon paper is
~2.9:1.

**4. A blocklist could not see the mechanism most likely to return.** An
AA-contrast guard enumerated forbidden token names in `color:var(--X)`. It was
blind to `opacity` — the exact de-emphasis mechanism the same change had just
*deleted* from both shells, making it the likeliest edit to come back — and to
unlisted tokens, and to `var(--x,fallback)` syntax.

**The fix pattern.** Assert the output:

```python
def _assert_font_isolation(html):
    assert gen.PAGE_FONT_FACE in html, "page must inline the page font artifact"
    assert gen.FONT_FACE not in html, "page must never inline the signed-SVG block"
```

Both are true only if the page really inlined the right bytes. No import alias,
no docstring, and no renamed constant can defeat them. See
`_assert_fonts_really_embedded`, `_assert_font_isolation`,
`_assert_no_foreign_subresource` and `_assert_text_meets_aa` in
`generator/tests/test_explainers.py` and `generator/tests/test_holder.py`.

**Prefer allowlists to blocklists for value guards**, so a token added later
fails closed rather than passing unnoticed.

**Verify the guard by breaking the invariant.** Every fix here was
mutation-verified: break the invariant in a scratch copy, run the suite, confirm
it goes **red**, only then accept the fix. Four mutations, four caught. That step
is what turns "I wrote a guard" into "I know the guard works", and it is cheap —
a temp copy, a sed, a test run.

## Why This Matters

A guard that cannot fail is worse than no guard, because it is *counted*. The
absent test is visible in a coverage conversation; the vacuous one is invisible
and actively reassuring. Reviewers stop looking at the thing it claims to cover.

The blast radius here was real: three public pages rendering in `system-ui` with
CI fully green, on a host whose whole proposition is that its artifacts can be
trusted. The same shape already exists in this repo's live wording gates —
`test_check_page_does_not_overclaim_signature` asserts `"on signed" in
html.lower()`, which has **never matched**, because the page reads *"on a signed
badge"*. That gate has been riding on a different paragraph the whole time (see
[`docs/residual-review-findings/feat-explainers-holder-canon.md`](../../residual-review-findings/feat-explainers-holder-canon.md)).

This repo already pins cross-boundary values against reality rather than against
description — `tools/context-freeze.test.ts` sha256-pins published contexts and
`tools/did-pin.test.ts` pins the committed DID key to KMS. This convention is the
same instinct applied to guards: pin the artifact, not the intent.

## When to Apply

- Any test whose subject is *generated* output — HTML, SVG, JSON-LD, a built file.
- Any assertion of the form "the source contains / does not contain `<symbol>`".
  Ask what an alias, a re-export, a docstring, or a comment would do to it.
- Any time a guard is copied from one suite to another: diff the conjuncts. A
  dropped `and` clause is the single most common way a mirrored test loses the
  half that was doing the work.
- Any blocklist of forbidden values. Invert it to an allowlist so new values fail
  closed.

## Examples

**Substring false positives cut both ways.** While hardening these guards, a
regex intended to find text colours —

```python
re.findall(r"color:var\(--(\w+)\)", html)
```

— also matched `border-color:var(--cell)`, flagging a correct page as broken.
The fix is a boundary assertion, `(?<![-\w])color\s*:`, and the lesson is that a
guard can be wrong in *both* directions. Mutation-verify the true-negative case
too: confirm the guard passes on known-good output, not only that it fails on
known-bad.

**Stripping `#` comments is not stripping prose.** The first attempt at the
source-grep guard removed lines beginning with `#` and still matched the
docstring. That near-miss is the tell that the whole approach was wrong: if a
guard needs increasingly clever source parsing to stay correct, it is asserting
against the wrong thing. Move it to the output.
