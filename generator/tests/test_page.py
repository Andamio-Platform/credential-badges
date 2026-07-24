#!/usr/bin/env python3
"""U1 tests for the badge display / share page generator (generator/page.py, #70).

Guards the page's shape and the server-delivered Open Graph contract: a
well-formed HTML doc, the full OG/Twitter tag set with an ABSOLUTE og:image on
the public host, the badge image + titles, palette-derived theme-color, HTML
escaping, glyph-subset sanitization, and the wording gate.

No third-party test framework — runnable directly:
    python3 generator/tests/test_page.py
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, GEN)

import page      # noqa: E402
import colors    # noqa: E402
import build     # noqa: E402

REC = {
    "course_id": "661274aa715885b4c9789aec179f9a429169eb7be73f7c29a8694402",
    "slt_hash": "9fa3cdce9eaa801270d42154dcb12b64448bfab826971f1d0e74f9d0e87cc3e9",
    "course_title": "Run GovTool Locally (Minikube + K8s)",
    "module_title": "Deploy the Proposal Pillar",
}
STEM = f"{REC['course_id']}.{REC['slt_hash']}"


def test_well_formed_html():
    html = page._page_html(REC)
    assert html.startswith("<!doctype html>")
    assert "<title>" in html and "</title>" in html
    assert html.rstrip().endswith("</html>")
    print("  ✅ well-formed HTML document")


def test_open_graph_tags_present():
    html = page._page_html(REC)
    card = f"https://credentials.andamio.io/badges/{STEM}.og.png"
    assert f'property="og:title" content="{page.esc(REC["module_title"])}"' in html
    assert 'property="og:description"' in html
    assert f'property="og:image" content="{card}"' in html, "og:image must be absolute on the public host"
    assert 'property="og:image:width" content="1200"' in html
    assert 'property="og:image:height" content="630"' in html
    assert f'property="og:url" content="https://credentials.andamio.io/badges/{STEM}"' in html
    assert 'name="twitter:card" content="summary_large_image"' in html
    assert 'name="theme-color"' in html
    print("  ✅ full OG/Twitter tag set with absolute og:image")


def test_badge_and_titles_rendered():
    html = page._page_html(REC)
    assert f'src="/badges/{STEM}.svg"' in html, "body must reference the badge SVG image"
    assert page.esc(REC["module_title"]) in html
    assert page.esc(REC["course_title"]) in html
    print("  ✅ badge image + credential/course titles present")


def test_theme_color_matches_palette():
    html = page._page_html(REC)
    pal = colors.palette_for(REC["course_id"])
    assert f'name="theme-color" content="{pal["deep"]}"' in html
    print("  ✅ theme-color derives from the badge palette")


def test_html_escaping():
    rec = dict(REC, module_title='A & B <script> "x"')
    html = page._page_html(rec)
    assert "<script>" not in html, "raw markup must be escaped, never injected"
    assert "&amp;" in html and "&lt;script&gt;" in html
    print("  ✅ interpolated text is HTML-escaped")


def test_quote_escaped_in_attribute_context():
    """A double-quote in a title must become &quot; so it cannot break out of a
    content="..."/alt="..." attribute — the OG tags carry the title in double-
    quoted attributes, so this is the real injection boundary."""
    rec = dict(REC, module_title='Deploy "the" Pillar')
    html = page._page_html(rec)
    assert '&quot;' in html, "raw double-quote must be escaped to &quot; in attributes"
    assert 'content="Deploy "the" Pillar"' not in html, "attribute must not break open"
    print("  ✅ double-quote escaped to &quot; (attribute breakout blocked)")


def test_empty_title_falls_back():
    """A title that sanitizes to empty (all out-of-subset) falls back to the
    generic, never a blank og:title / heading."""
    rec = dict(REC, module_title="中文", course_title="日本語")
    html = page._page_html(rec)
    assert 'property="og:title" content="Credential"' in html, "empty module title -> 'Credential'"
    assert '>Andamio<' in html or 'Andamio' in html  # course falls back to issuer
    print("  ✅ sanitize-to-empty title falls back to generic, never blank")


def test_alt_text_present_and_escaped():
    """og:image:alt and the <img alt> carry the credential description and are
    escaped like every other interpolated field."""
    rec = dict(REC, module_title='Deploy & <Pillar>')
    html = page._page_html(rec)
    assert 'property="og:image:alt"' in html
    assert '<img' in html and 'alt="' in html
    assert "<Pillar>" not in html, "alt text must be escaped too"
    print("  ✅ og:image:alt + img alt present and escaped")


def test_main_output_byte_identical_to_committed_pages():
    """Parity guard (mirrors test_render_parity.py): regenerate every page via
    page.main() into a scratch dir and assert each is byte-identical to the
    committed badges/*.html. Pages are pure-deterministic from the registry (no
    baking), so byte-identity must hold — this exercises the main() write path
    and catches page.py <-> committed drift."""
    records = [r for r in json.load(open(os.path.join(GEN, "credentials.json")))
               if r["course_id"] not in build.SKIP_COURSES]
    with tempfile.TemporaryDirectory() as out:
        r = subprocess.run([sys.executable, os.path.join(GEN, "page.py"), out],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"page.py failed: {r.stderr}"
        produced = [f for f in os.listdir(out) if f.endswith(".html")]
        assert len(produced) == len(records), (
            f"expected {len(records)} pages, main() produced {len(produced)}")
        mismatches = []
        for name in produced:
            new = open(os.path.join(out, name), "rb").read()
            committed_path = os.path.join(BADGES, name)
            if not os.path.exists(committed_path):
                mismatches.append(f"{name}: no committed page to compare")
                continue
            if new != open(committed_path, "rb").read():
                mismatches.append(f"{name}: bytes differ from committed page")
        assert not mismatches, "page parity broken:\n  " + "\n  ".join(mismatches)
    print(f"  ✅ {len(records)} pages byte-identical to committed badges/*.html")


def test_out_of_subset_title_sanitized():
    rec = dict(REC, course_title="Café résumé — Ñoño", module_title="Prüfung ×2")
    html = page._page_html(rec)
    for ch in "éüñ×":
        assert ch not in html, f"un-sanitized glyph {ch!r} leaked into the page"
    print("  ✅ out-of-subset title glyphs sanitized")


def test_wording_gate():
    html = page._page_html(REC)
    assert "any OB3 verifier" not in html
    assert "DI-capable OB 3.0 / VC verifiers" in html
    print("  ✅ wording gate: DI-capable OB 3.0 / VC verifiers, never 'any OB3 verifier'")


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
