#!/usr/bin/env python3
"""U3 tests for the Open Graph card composition (generator/og.py, #69).

Guards the card SVG's shape and content: correct 1200x630 canvas, credential
title + course title + issuer wordmark present, long titles wrapped to fit, the
brand background tied to the badge's own palette, and out-of-subset glyphs
sanitized. Rasterization fidelity is verified visually in the PR + by the
imaging suite; this covers the vector authoring.

No third-party test framework — runnable directly:
    python3 generator/tests/test_og.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import og        # noqa: E402
import colors    # noqa: E402

REC = {
    "course_id": "661274aa715885b4c9789aec179f9a429169eb7be73f7c29a8694402",
    "slt_hash": "9fa3cdce9eaa801270d42154dcb12b64448bfab826971f1d0e74f9d0e87cc3e9",
    "course_title": "Run GovTool Locally (Minikube + K8s)",
    "module_title": "Prepare a local environment for GovTool development",
}


def test_card_is_1200x630():
    svg = og._card_svg(REC)
    assert 'viewBox="0 0 1200 630"' in svg
    assert 'width="1200"' in svg and 'height="630"' in svg
    print("  ✅ card canvas is 1200x630")


def test_card_contains_titles_and_wordmark():
    svg = og._card_svg(REC)
    assert "Run GovTool Locally (Minikube + K8s)" in svg, "course title missing"
    assert "Prepare a local environment for GovTool development" in svg or \
           "Prepare a local environment for GovTool" in svg, "module title missing"
    assert "ANDAMIO" in svg, "issuer wordmark missing"
    assert "CREDENTIAL" in svg, "eyebrow label missing"
    print("  ✅ course title, credential title, and ANDAMIO wordmark present")


def test_long_title_wraps_to_multiple_lines():
    long_rec = dict(REC, module_title=(
        "Prepare a local environment for GovTool development with Docker, "
        "Minikube, and kubectl installed and configured end to end"))
    lines, size = og.gen.lay_title(long_rec["module_title"], 56, og.COL_W, 0.58, 34)
    assert len(lines) >= 2, f"expected a long title to wrap, got {lines}"
    # And the composition emits that many hero <text> runs for the module title.
    svg = og._card_svg(long_rec)
    assert svg.count('font-weight="800"') >= 2, "wrapped hero lines not emitted"
    print(f"  ✅ long credential title wraps to {len(lines)} lines")


def test_background_uses_badge_palette():
    """The card's brand gradient stops are the badge's own palette (same
    palette_for(course_id)) — the card and badge read as one identity."""
    pal = colors.palette_for(REC["course_id"])
    svg = og._card_svg(REC)
    for token in ("deep", "ink", "raised"):
        assert pal[token] in svg, f"expected palette {token} {pal[token]} in card bg"
    print("  ✅ card background uses the badge's palette (deep/ink/raised)")


def test_out_of_subset_glyphs_sanitized():
    """A title carrying characters outside the embedded font subset is sanitized
    (accents stripped/transliterated) so no missing-glyph box reaches the card."""
    rec = dict(REC, course_title="Café résumé — Ñoño ×2", module_title="Prüfung")
    svg = og._card_svg(rec)
    for ch in "éüñ×":
        assert ch not in svg, f"un-sanitized glyph {ch!r} leaked into the card"
    assert "Cafe resume" in svg  # accents stripped, em dash kept in subset
    print("  ✅ out-of-subset title glyphs sanitized")


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
