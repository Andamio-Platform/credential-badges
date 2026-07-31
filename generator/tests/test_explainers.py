#!/usr/bin/env python3
"""U1 tests for the two badge explainers (generator/explainers.py, #72).

Guards the audience framing + the verification contract: well-formed branded
HTML, the holder share walk-through, the check-this NON-ANDAMIO path end to end
(read -> resolve did:web + verify signature -> chase the on-chain anchor ->
status), the four-party anchor, hash-and-anchor disclosure (no reveal URL), and
the wording gate.

No third-party test framework — runnable directly:
    python3 generator/tests/test_explainers.py
"""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, GEN)

import explainers  # noqa: E402
import canon  # noqa: E402
import gen  # noqa: E402


def test_both_pages_well_formed():
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        assert html.startswith("<!doctype html>")
        assert "<title>" in html and 'name="theme-color"' in html
        assert html.rstrip().endswith("</html>")
    print("  ✅ both explainer pages are well-formed branded HTML")


def test_share_page_covers_options_and_framing():
    html = explainers._share_page()
    assert "learning target" in html and "participation sticker" in html
    for opt in ("Download the SVG", "Copy the link", "Share to X or LinkedIn",
                "share sheet", "Embed it", "Add it to your LinkedIn profile"):
        assert opt in html, f"share option missing: {opt}"
    print("  ✅ share page: what-it-proves framing + every share option")


def test_check_page_walks_non_andamio_path():
    """Covers R6. The check page walks the full independent path."""
    html = explainers._check_page()
    assert "without trusting" in html and "Andamio" in html
    assert "did:web:credentials.andamio.io" in html, "resolve-issuer step missing"
    assert "signature" in html.lower(), "verify-signature step missing"
    assert 'href="https://andamioscan.io"' in html and "Cardano explorer" in html, "chase-anchor step missing"
    assert "status list" in html.lower(), "status step missing"
    print("  ✅ check page walks the non-Andamio path end to end")


def test_check_page_names_four_party_anchor():
    html = explainers._check_page()
    for party in ("issuer", "assessor", "chain", "Andamio"):
        assert party in html, f"four-party anchor missing: {party}"
    print("  ✅ check page names the four-party anchor")


def test_hash_and_anchor_level_no_reveal_link():
    """Covers KTD-6. Both pages state the hash-and-anchor level and note the raw
    artifact stays private / reveal path coming — with NO reveal URL linked."""
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        assert "hash-and-anchor" in html
        assert "private to the holder" in html or "stays private" in html
        # the reveal path is NOTED but never LINKED (no reveal href/route)
        assert 'href="reveal' not in html and "/reveal" not in html
    print("  ✅ hash-and-anchor disclosure; reveal path noted, not linked")


def test_check_page_does_not_overclaim_signature():
    """Only the flagship badge is signed today (CONCEPTS: Flagship Badge); the
    check page — linked from every badge, mostly presentation-only — must NOT
    imply every badge carries a checkable signature. It must carry the v1.1
    signing-status caveat and say the on-chain anchor backs an unsigned badge."""
    html = explainers._check_page()
    assert "<strong>Status.</strong>" in html, "missing the signing-status caveat"
    assert "on signed" in html.lower() or "signed</strong> badges" in html, \
        "signature step must be scoped to signed badges"
    assert "the chain still backs" in html, "must say the chain backs an unsigned badge"
    print("  ✅ check page is signing-status honest (no universal-signature overclaim)")


def test_back_cross_links_resolve():
    """Each explainer links to the other via a relative URL that resolves from
    /badges/how-to-share and /badges/how-to-check (base /badges/)."""
    assert 'href="how-to-check"' in explainers._share_page()
    assert 'href="how-to-share"' in explainers._check_page()
    print("  ✅ the two explainers cross-link each other")


def test_output_byte_identical_to_committed():
    """Parity guard (mirrors test_page.py): regenerate via explainers.main() into
    a scratch dir and assert byte-identity to the committed badges/how-to-*.html —
    exercises the write path and catches explainers.py <-> committed drift."""
    with tempfile.TemporaryDirectory() as out:
        r = subprocess.run([sys.executable, os.path.join(GEN, "explainers.py"), out],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"explainers.py failed: {r.stderr}"
        for name in ("how-to-share.html", "how-to-check.html"):
            new = open(os.path.join(out, name), "rb").read()
            committed = os.path.join(BADGES, name)
            assert os.path.exists(committed), f"no committed {name}"
            assert new == open(committed, "rb").read(), f"{name} differs from committed"
    print("  ✅ both explainers byte-identical to committed badges/how-to-*.html")


def test_wording_gate():
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        assert "any OB3 verifier" not in html
    assert "DI-capable OB 3.0 / VC verifier" in explainers._check_page()
    print("  ✅ wording gate: DI-capable OB 3.0 / VC verifiers, never 'any OB3 verifier'")


def test_check_page_links_full_guidance():
    html = explainers._check_page()
    assert explainers.GUIDANCE_URL in html, "must link the canonical verifier guidance"
    print("  ✅ check page links the full verifier guidance for depth")


# --- guard helpers ----------------------------------------------------------
# These assert on the EMITTED artifact, not on generator source text. Source
# greps proved evadable: a docstring mentioning gen.PAGE_FONT_FACE satisfied the
# "uses the page font artifact" check, and an `from gen import FONT_FACE as _FF`
# alias defeated the "never inlines the signed-SVG block" check.

# Only these may set a text colour. An allowlist fails closed when canon.py
# gains a token; the previous blocklist silently permitted --orange (~2.9:1),
# --paper (1:1) and --coral, and missed `opacity`, which this change removed
# from both shells and is therefore the likeliest de-emphasis edit to return.
_TEXT_OK = {"var(--ink)", "var(--muted)", "var(--blue)", "var(--on-ink)", "inherit",
            canon.INK, canon.MUTED, canon.BLUE, canon.ON_INK}


def _css_of(html):
    return html.split("<style>")[1].split("</style>")[0]


def _assert_fonts_really_embedded(html):
    """gen.PAGE_FONT_FACE falls back to "" when page_fonts.css is absent, and
    every other canon guard stays green on a fontless page — `"Inter" in html`
    is satisfied by the font-family stack, and the subresource scan passes more
    easily with zero url() matches. Byte-parity is the only dissenter, and it
    stops dissenting the moment the artifacts are regenerated in that same
    environment. Assert the bytes, not the name."""
    assert gen.PAGE_FONT_FACE and "@font-face" in gen.PAGE_FONT_FACE, \
        "page_fonts.css missing or empty — run embed_fonts.py"
    assert "@font-face" in html, "page emitted no embedded face"
    kb = len(gen.PAGE_FONT_FACE.encode()) / 1024
    assert kb <= 80, f"embedded faces are {kb:.0f} KB, over the 80 KB ceiling"


def _assert_font_isolation(html):
    """The headline invariant: a prose restyle must never reach fonts.css, which
    is inlined into the SIGNED badge SVGs. Asserted against the output so no
    import alias can defeat it."""
    assert gen.PAGE_FONT_FACE in html, "page must inline the page font artifact"
    assert gen.FONT_FACE not in html, "page must never inline the signed-SVG font block"


def _assert_no_foreign_subresource(html):
    """Scoped to SUBRESOURCES — outbound <a href> to andamioscan/andamio.io is
    legitimate. Quote-agnostic, and rejects protocol-relative //host too."""
    assert "<link" not in html and "@import" not in html
    for m in re.finditer(r"""(?:src|srcset|poster)\s*=\s*["']([^"']+)["']""", html):
        v = m.group(1).strip()
        assert v.startswith("data:") or not re.match(r"^(?:[a-z][a-z0-9+.-]*:)?//", v, re.I), \
            f"foreign-origin subresource: {v[:60]}"
    for m in re.finditer(r"url\(([^)]+)\)", html):
        v = m.group(1).strip("'\"")
        assert v.startswith("data:"), f"foreign url(): {v[:40]}"


def _assert_text_meets_aa(html):
    css = _css_of(html)
    for m in re.finditer(r"(?<![-\w])color\s*:\s*([^;}]+)", css):
        v = m.group(1).strip()
        assert v in _TEXT_OK, f"text colour {v!r} is not an AA-safe canon step"
    for m in re.finditer(r"opacity\s*:\s*([\d.]+)", css):
        assert float(m.group(1)) >= 1, \
            f"opacity:{m.group(1)} dims text past the AA-safe ink step"


def _assert_canon_not_inlined(src):
    """Every token, not four hand-picked ones. A wrong transcription of
    DISPLAY_TRACKING (-0.04em for -0.045em) previously passed."""
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    for name, literal in canon.TOKENS.items():
        if name in ("INK", "INK_RGB"):
            continue          # substrings of the ramp values themselves
        assert literal.lower() not in code.lower(), \
            f"canon {name} ({literal}) inlined — import it from canon.py"


# --- canon conformance (#102 U1) -------------------------------------------
# Mirrors the share page's suite in test_page.py, so the three surfaces cannot
# drift apart without a red test.

def test_canon_values_imported_not_inlined():
    src = open(os.path.join(GEN, "explainers.py"), encoding="utf-8").read()
    _assert_canon_not_inlined(src)
    assert "import canon" in src
    print("  ✅ every canon token imported from canon.py, never inlined")


def test_no_legacy_type_stack_or_dark_chrome():
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        for gone in ("Archivo", "Spline Sans Mono", "radial-gradient", "border-radius"):
            assert gone not in html, f"legacy chrome survived: {gone}"
        assert '"Inter"' in html and f'content="{canon.PAPER}"' in html
    print("  ✅ canon type + paper ground; no legacy chrome, no radius")


def test_fonts_come_from_the_page_artifact_not_the_signed_svg_one():
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        _assert_fonts_really_embedded(html)
        _assert_font_isolation(html)
    print("  ✅ canon faces embedded from the page artifact; signed-SVG block never inlined")


def test_no_foreign_origin_subresource():
    for build in (explainers._share_page, explainers._check_page):
        _assert_no_foreign_subresource(build())
    print("  ✅ no foreign-origin subresource (pages stay self-contained)")


def test_no_text_below_the_muted_ink_step():
    for build in (explainers._share_page, explainers._check_page):
        _assert_text_meets_aa(build())
    print("  ✅ every text colour is an AA-safe canon step; no opacity dimming")


def test_explainers_spend_no_accent():
    """These pages claim in-source that they spend no accent at all — a stricter
    contract than the share page's one-accent rule, and until now the only canon
    surface with no guard on it. The token may be DEFINED in :root; it must never
    be painted."""
    for build in (explainers._share_page, explainers._check_page):
        css = _css_of(build())
        painted = css.split("}", 1)[1] if "}" in css else css   # drop the :root block
        assert "var(--orange)" not in painted, "explainers paint no accent"
        assert f"color:{canon.ORANGE}" not in css
    print("  ✅ explainers spend no accent (orange defined, never painted)")


def test_focus_visible_present_and_never_suppressed():
    for build in (explainers._share_page, explainers._check_page):
        html = build()
        assert ":focus-visible{outline:" in html
        assert "outline:none" not in html
    print("  ✅ visible focus state; outline never suppressed")


def _main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        print(f"• {t.__name__}")
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"  ❌ FAIL: {e}")
    print(f"\n{'❌' if failed else '✅'} {len(tests)-failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    _main()
