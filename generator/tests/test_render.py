#!/usr/bin/env python3
"""U3 tests for render-core — offline, with injected titles (no network).

Runnable directly:
    python3 generator/tests/test_render.py
"""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import gen        # noqa: E402
import colors     # noqa: E402
import render     # noqa: E402
from render import sanitize_title, render_badge, SAFE  # noqa: E402
from api_client import GatewayError  # noqa: E402

CID = "6348bba0f9b7d7e0353715ece5946f3b61de433d314e84dad313a677"
SLT = "a891203913065a08e2c87ea57b808bb0f6efa4e57f36bc1412f7c2cdd846a045"


def titles(course_title, mod):
    """Build a fetch_titles stub returning (course_title, {SLT: mod})."""
    return lambda course_id, network: (course_title, {SLT: mod} if mod is not None else {})


def test_happy_path_renders_with_titles():
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles(
        "Andamio for Developers",
        {"slt_hash": SLT, "title": "Run the App Template", "on_chain_slts": [], "source": "merged"}))
    assert CID in svg and SLT in svg
    assert "Run the App Template" in svg and "Andamio for Developers" in svg
    print("  ✅ happy path: titles render into the SVG")


def test_empty_db_title_falls_back_to_on_chain_slt():
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles(
        "Andamio for Developers",
        {"slt_hash": SLT, "title": "", "on_chain_slts": ["I can obtain an Andamio API key."],
         "source": "chain_only"}))
    assert "I can obtain an Andamio API key." in svg
    print("  ✅ chain_only / empty DB title -> on_chain_slts fallback")


def test_no_title_anywhere_falls_back_to_generic():
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles(
        "", {"slt_hash": SLT, "title": "", "on_chain_slts": [], "source": "chain_only"}))
    assert ">Credential<" in svg, "module title should fall back to 'Credential'"
    assert "Andamio" in svg, "course title should fall back to 'Andamio'"
    print("  ✅ empty everything -> 'Credential' / 'Andamio' generics")


def test_slt_not_in_module_set_falls_back_to_generic():
    # fetch returns no modules at all (slt_hash absent) -> generic module title
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles("Some Course", None))
    assert ">Credential<" in svg
    print("  ✅ slt_hash absent from module set -> 'Credential'")


def test_non_ascii_title_is_sanitized_to_subset():
    raw = "Café — Über señor → ½ ™ ✅ 你好"
    out = sanitize_title(raw)
    assert all(ch in SAFE for ch in out), f"unsafe glyph survived: {out!r}"
    assert "Cafe" in out and "Uber" in out and "senor" in out  # accents stripped
    assert "->" in out and "(tm)" in out                        # transliterated
    assert "—" in out                                           # em dash is in subset, kept
    assert "✅" not in out and "你" not in out                  # unknowns dropped
    # and it actually renders without raising
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles(
        raw, {"slt_hash": SLT, "title": raw, "on_chain_slts": [], "source": "merged"}))
    assert "你" not in svg and "✅" not in svg
    print("  ✅ non-ASCII title sanitized to the embedded subset (no box glyphs)")


def test_palette_is_deterministic_and_matches_build():
    a = render_badge(CID, SLT, "preprod", fetch_titles=titles("C", {"slt_hash": SLT, "title": "M"}))
    b = render_badge(CID, SLT, "preprod", fetch_titles=titles("C", {"slt_hash": SLT, "title": "M"}))
    assert a == b, "same inputs must render identically"
    # palette chosen by render must equal the one build.py/colors uses for this course
    expected = colors.light_interior(colors.palette_for(CID))
    direct = gen.render_svg(course_title="C", module_title="M", course_id=CID,
                            slt_hash=SLT, network="preprod", pal=expected)
    assert a == direct, "render_badge palette diverged from colors.palette_for"
    print("  ✅ palette deterministic and matches colors.palette_for")


def test_gateway_error_propagates():
    def boom(course_id, network):
        raise GatewayError(502, "unresolvable", "Failed to fetch course")
    try:
        render_badge(CID, SLT, "mainnet", fetch_titles=boom)
        assert False, "expected GatewayError to propagate (KTD-3b: never a blank badge)"
    except GatewayError as e:
        assert e.kind == "unresolvable"
    print("  ✅ title-read GatewayError propagates (no blank-badge fabrication)")


def test_rendered_badge_round_trips():
    svg = render_badge(CID, SLT, "preprod", fetch_titles=titles(
        "Andamio for Developers", {"slt_hash": SLT, "title": "Run the App Template"}))
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg)
        path = f.name
    try:
        r = subprocess.run([sys.executable, os.path.join(GEN, "decode.py"), path],
                           capture_output=True, text=True)
        assert "❌" not in r.stdout, r.stdout
        assert r.stdout.count("✅ MATCH") >= 2, r.stdout
    finally:
        os.unlink(path)
    print("  ✅ on-demand badge round-trips (outer==course_id, inner==slt_hash)")


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
