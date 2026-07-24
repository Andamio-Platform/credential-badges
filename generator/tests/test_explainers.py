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
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import explainers  # noqa: E402


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
    assert "andamioscan.io" in html and "Cardano explorer" in html, "chase-anchor step missing"
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
        assert "reveal" not in html.lower() or "reveal path" not in html.lower() or \
            'href="reveal' not in html  # no reveal link
        assert 'href="reveal' not in html and "/reveal" not in html
    print("  ✅ hash-and-anchor disclosure; reveal path noted, not linked")


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
