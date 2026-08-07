---
title: "A qualifier is a ceiling — never delete one to make a verifiability claim plainer"
date: 2026-07-27
category: conventions
module: generator
problem_type: convention
component: documentation
severity: high
applies_when:
  - "Editing verifiability, signature, or trust copy on any badge-facing surface"
  - "Simplifying dense technical wording for a non-technical reader"
  - "Writing, relaxing, or re-anchoring a test that guards a user-facing claim"
  - "Adding copy that tells a reader to go look something up"
symptoms:
  - "Deleting a qualifying phrase to make copy plainer silently widens the claim"
  - "A copy guard anchored on a literal sentence passes vacuously after a reword"
  - "An overclaim blacklist misses a paraphrase that drops one qualifying word"
  - "Copy promises a lookup that most artifacts in the set cannot support"
resolution_type: workflow_improvement
related_components: [testing_framework]
tags: [wording-gate, overclaim, verifiability, copy-guards, mutation-testing, ob3, data-integrity, trust-artifact]
---

# A qualifier is a ceiling — never delete one to make a verifiability claim plainer

## Context

Of the 58 committed badges in `badges/`, exactly **one** carries a cryptographic signature. The other 57 are presentation-only: credential data plus an `andamio:onChainAnchor`, nothing more. `generator/page.py::_is_baked()` reads the committed SVG for `proofValue`, and every piece of verifiability copy branches on that boolean, so the signed badge and the unsigned majority can say different things.

Sitting on top of that split is a standing rule this repo calls the **wording gate**: the page must never imply broader verifiability than actually exists. It is not a style preference, and it is not legal caution. It comes from a measurement. The verifier spike (`archive/verifier-spike/results/walt-id.md`) found that walt-id — a real, mainstream OB 3.0 verifier — is *structurally* unable to read Andamio's Data Integrity JSON-LD proof. Its CLI is JWS/SD-JWT-only; every policy fails at the format gate with `"String does not look like JWS"`, at exit code 0. spruce and 1EdTech verify clean; walt-id cannot verify at all. The 2026-07-09 verifier gate launched on those two independents plus loopback and deferred walt-id for exactly this reason *(auto memory [claude])*.

So there exist reasonable tools that report FAIL on a perfectly genuine Andamio badge. That fact is the ceiling.

Issue #82 asked for the caveat to be made plainer — the badge page rendered two near-identical grey paragraphs ~100px apart, both in verifier language, on a page whose primary visitor is the holder who just earned the credential. The constraint attached: **plainer, but never vaguer or more generous than the truth.** Satisfying that surfaced five traps. Three separate drafts during the work introduced overclaims, and two test guards written to prevent overclaims turned out to guard nothing. This document exists so the next editor pays for those discoveries once.

## Guidance

### 1. A technical qualifier is a ceiling. Deleting it widens the claim.

This is the idea a reader will resist, so take it concretely.

The old copy said the badge was "checkable by **DI-capable OB 3.0 / VC verifiers**." The obvious way to make that plainer is to delete the dense phrase: the badge "can be checked independently."

That *reads* narrower. It *is* broader. The phrase was not decoration on the claim — it was the bound. Remove it and you have narrowed nothing; you have removed the ceiling, and the reader now supplies their own, which is always the most generous one available: *any tool will verify this.*

The consequence is not abstract. An employer reads "anyone can check it," runs a mainstream OB3 tool, the tool cannot parse a Data Integrity proof, verification fails — and the employer concludes a genuine credential is fraudulent. Vagueness did not protect the holder; it exposed them.

The resolution is not "keep the jargon." It is **keep a bound; you may translate it**. The shipped copy says a signed copy is one you can check "with compatible verifier software" — the plain-language form of "DI-capable OB 3.0 / VC verifiers." It signals *not all tooling qualifies* without naming the class. The precise class name did not leave the product; it moved to the how-to-check explainer, and the caveat links there inline. (Full before/after under Examples.)

### 2. Check claims about the artifact against the artifact.

A later draft offered holders that "anyone can look it up on a public Cardano explorer." Plausible — the badge *is* anchored on Cardano. Checked against the real files, false for 57 of 58: unsigned SVGs carry `andamio:onChainAnchor` with only `{network, courseId, sltHash}`. One SVG in 58 carries an `evidence` entry; one carries a `claimTxHash`. There is no transaction to look up.

This is deliberate, not an omission — `generator/gen.py`:

```python
    # No evidence_hash (that is per-person and absent from shared badges).
```

The shared badge is a badge-*class* artifact; per-person evidence is excluded by design. The clause promised a check the artifact cannot support. It was caught by looping over `badges/*.svg` and counting — not by reasoning about what an anchored credential "should" contain.

### 3. Guard the claim *shape*, not the sentence.

The first guard against a false signature claim anchored on a literal string:

```python
SIGNED_CLAIM = "the SVG you can download is signed"
```

Two reviewers independently escaped it with the whole suite green — an unbaked `.verify` rewritten to "its SVG is signed," and an unbaked `.actions-note` rewritten to "is the signed credential itself." Same false claim, different words.

The trap underneath is worse: the naive fix, asserting bare `"signed" not in unbaked`, is a **tautology**, because the honest unbaked copy legitimately says a signed copy "is rolling out." Anchoring a discriminator on a token that appears in both branches guards nothing. Guard the grammatical shape instead:

```python
SIGNATURE_CLAIM_RE = re.compile(r"\b(?:is|are)\s+(?:(?:a|the)\s+)?signed\b")
```

It matches "is signed" / "is a signed" / "is the signed" / "are signed," and deliberately does *not* match "A signed copy … is rolling out," where the verb attaches to the roll-out rather than to this badge. Pair it with a liveness assertion so it can never silently guard nothing:

```python
    assert SIGNATURE_CLAIM_RE.search(page._verify_note(True)) is not None, (
        "pattern must actually match a real signature claim, else it guards nothing")
```

### 4. Blacklists catch enumerated phrasings. Add a structural invariant.

The negative list is real but partial:

```python
OVERCLAIMS = ("any OB3 verifier", "any OB 3.0", "any verifier",
              "anyone can check it")
```

A demonstrated bypass sailed through: drop just the word "DI-capable" from `_description()` and ship "checkable by OB 3.0 / VC verifiers" into three meta tags. No enumerated phrase appears; the ceiling is gone. The fix is structural — wherever the verifier class is named *anywhere* in the output, the qualifier must travel with it:

```python
        for m in re.finditer(r"OB ?3\.?0? ?/ ?VC verifier", html):
            window = html[max(0, m.start() - 24):m.start()]
            assert "DI-capable" in window, ...
```

Anchor blacklist entries at word boundaries (`rf"\b{re.escape(phrase)}\b"`) so legitimate copy containing "many verifiers" does not trip "any verifier" and fail loudly for the wrong reason.

### 5. When a gate's subject moves, relocate the gate — never drop it.

Once the precise phrase legitimately left the holder page, the old positive assertion `assert "DI-capable OB 3.0 / VC verifiers" in html` became wrong *by construction*. Deleting it would have quietly retired the only check that the precision exists at all. It was **relocated**: the positive half now lives where the phrase lives (`test_explainers.py`, `test_holder.py`), and the page gained a narrower replacement — the `.verify` paragraph itself must link the explainer.

The scoping is load-bearing. A page-wide "does the page link how-to-check" assertion was *already satisfied* by an unrelated nav link, so the inline citation could have vanished with everything green. Extract the one paragraph first:

```python
        verify = _slot(html, "verify")
        assert 'href="/badges/how-to-check"' in verify, (
            "the caveat itself must link the explainer that carries the precision")
```

### 6. Mutation-test copy guards before trusting them.

Every escape above was found the same way: apply the bypass, run the suite, confirm it now **fails**; revert, confirm the shipped copy still passes. Five bypasses plus a reverted CSS fix were each confirmed to fail. Without that step, three of these guards were vacuous while reporting green.

## Why This Matters

**The asymmetry of harm is stark.** Copy that is too precise costs a holder some confusion, which the explainer link resolves in one click. Copy that is too generous costs a holder a job — the employer's failed verification looks exactly like fraud, and the holder never learns why. There is no symmetric "too cautious" failure of comparable weight.

**This is a generator.** `_verify_note` and `_description` are single functions rendering across 58 badge pages and three meta tags each, plus OG and Twitter cards that propagate into LinkedIn and X previews. A one-word deletion is a several-hundred-surface claim change, with no incremental rollout and no reader-side correction.

**Copy guards fail differently from logic tests.** A broken logic test usually goes red. A broken copy guard usually stays *green* — it asserts on strings that a copy edit is free to reshape. Every guard here that was not mutation-tested turned out to be escapable, and the escapes were found by two reviewers independently, which suggests they are the natural next edit rather than exotic adversarial cases.

## When to Apply

- **`_svg_note`, `_verify_note`, or `_description` in `generator/page.py`** — the three functions carrying verifiability claims to holders and social previews.
- **Sibling surfaces in the same register**: `generator/explainers.py` (now hosts the precision), `generator/holder.py`, `web-component/andamio-badge.js` and `embed/andamio-badge.js`.
- **Any request to "simplify," "soften," or "make plainer"** copy about signing, verification, trust, or on-chain proof. That request is the exact trigger for trap 1.
- **Any new instruction telling a reader to go check something** ("look it up on…", "paste it into…"). Verify against the artifacts first, by counting, not by reasoning.
- **Any test edit that relaxes, re-anchors, or removes a copy assertion.** If a positive assertion became wrong because the phrase moved, relocate it to the surface that now carries the phrase.

Two standing don'ts, also recorded in the test docstrings so they survive this document:

- Do **not** "restore" `assert "DI-capable OB 3.0 / VC verifiers" in html` on the badge page. That re-introduces developer language in front of the holder, which is the defect #82 fixed.
- Do **not** relax the `.verify`-scoped link assertion to a page-wide one. Page-wide is already satisfied elsewhere.

**Known open gap:** `generator/holder.py` still renders the DI-capable phrasing at two points, so two registers currently ship — plain language on the badge page, verifier language on the holder viewer. Accepted knowingly, not overlooked.

## Examples

### The qualifier as ceiling

**Before** (`git show 4bdd1c9:generator/page.py`, unbaked branch):

```python
    return ("This badge is anchored on Cardano — the on-chain record is the "
            "proof. Signed verifiable-credential baking, checkable by DI-capable "
            "OB 3.0 / VC verifiers, is rolling out.")
```

**The tempting simplification** — plainer, and strictly worse:

```python
    return ("This badge is anchored on Cardano. A signed copy you can check "
            "independently is rolling out.")   # ← ceiling deleted; reader fills it in
```

**After** — plainer *and* still bounded:

```python
    return ("This badge is anchored on Cardano — the public blockchain record "
            "is the proof. A signed copy you can check with compatible "
            f"verifier software is rolling out. {link}")
```

Three things happened at once: "on-chain" became "public blockchain record" (jargon, genuinely droppable); "DI-capable OB 3.0 / VC verifiers" became "compatible verifier software" (ceiling, translated not deleted); and `link` carries the reader to the exact class name in one click. Note what is *absent*: no explorer invitation on this branch, because 57 of 58 badges have no transaction to look up.

### The vacuous guard

**Before:** unbaked `.verify` rewritten to "its SVG **is signed**" → suite green, false claim shipped.

**After:** the same mutation trips `SIGNATURE_CLAIM_RE`, while the honest hedge "A signed copy … is rolling out" still passes — the pattern requires `is|are` immediately governing `signed`.

### The blacklist bypass

**Before:** delete "DI-capable" from `_description()`, ship "checkable by OB 3.0 / VC verifiers" into `<meta name="description">`, `og:description`, and `twitter:description` → 33/33 passing, three social surfaces overclaiming.

**After:** the structural assertion walks every match of the verifier class in the rendered page and requires "DI-capable" within the preceding 24 characters. The bypass fails in all three tags.

The pattern in all three: the assertion moved from *"is this exact sentence present"* to *"does this claim shape, or this structural invariant, hold anywhere in the output."* Sentences get rewritten. Claims are what you actually mean to guard.

## Related

- `docs/verifier-guidance.md` — the canonical statement of what "DI-capable OB 3.0 / VC verifiers" means, including the JWS-only limitation. The target the caveat's inline citation links to.
- `archive/verifier-spike/results/SUMMARY.md` (and `walt-id.md`, `spruce.md`) — the empirical origin of the qualifier: walt-id structurally cannot parse the DI JSON-LD sample; spruce and 1EdTech verify clean.
- `docs/solutions/workflow-issues/unwired-test-suites-silently-rot.md` — the general case of trap 5. There, a suite stopped protecting because it was never wired into CI; here, a gate nearly stopped protecting because its subject moved surfaces. Both are about a protection surviving a change rather than silently vanishing.
- `docs/solutions/conventions/never-mutate-published-jsonld-context.md` — same trust-artifact family, same verifier-heterogeneity reality. Useful to a reader auditing what verifiers can and cannot do.
- Issue #82 (the hard constraint and the open question about signed-vs-unsigned wording), issue #81, PR #83.
