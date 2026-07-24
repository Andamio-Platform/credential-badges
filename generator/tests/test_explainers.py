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
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
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
