#!/usr/bin/env python3
"""Tests for render-core — offline, with injected titles (no network).

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
        assert False, "expected GatewayError to propagate (never a blank badge)"
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


def test_injected_art_is_drawn():
    """render_badge resolves art through its injectable lookup, like fetch_titles."""
    import art
    import base64
    import shutil
    d = tempfile.mkdtemp()
    try:
        shutil.copy(os.path.join(HERE, "fixtures", "art", "placeholder.jpg"),
                    os.path.join(d, f"{CID}.jpg"))
        badge_art = art.load(d)
    finally:
        shutil.rmtree(d)
    t = titles("C", {"slt_hash": SLT, "title": "M"})
    with_art = render_badge(CID, SLT, "preprod", fetch_titles=t, badge_art=badge_art)
    assert with_art.count("<image") == 1
    uri = "data:image/jpeg;base64," + base64.b64encode(
        open(os.path.join(HERE, "fixtures", "art", "placeholder.jpg"), "rb").read()).decode()
    assert f'href="{uri}"' in with_art
    other = "b" * 56
    plain = render_badge(other, SLT, "preprod", fetch_titles=t, badge_art=badge_art)
    assert "<image" not in plain
    assert plain == render_badge(other, SLT, "preprod", fetch_titles=t, badge_art=art.NO_ART)
    print("  ✅ render_badge draws injected course art; an uncovered course is unchanged")


def test_module_art_loaded_from_repo():
    """The service's default lookup is the validated repo art dir, loaded once."""
    import art
    assert isinstance(render.BADGE_ART, art.Art)
    assert render.BADGE_ART.keys() == art.load().keys()
    print("  ✅ render.BADGE_ART is the validated generator/art/ map")


def test_missing_fonts_css_fails_instead_of_falling_back():
    """No fonts.css → importing gen fails loudly; it never falls back to Google Fonts."""
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(GEN, "gen.py")) as src, open(os.path.join(d, "gen.py"), "w") as dst:
            dst.write(src.read())
        r = subprocess.run([sys.executable, os.path.join(d, "gen.py")],
                           capture_output=True, text=True)
    assert r.returncode != 0, "gen imported without fonts.css"
    assert "fonts.css is missing" in r.stderr, r.stderr
    assert "googleapis" not in r.stdout + r.stderr
    print("  ✅ missing fonts.css raises a clear error, no external fallback")


# --- badge designs (credential-badges: title-only + CREDENTIAL label) -------

import re  # noqa: E402
import style  # noqa: E402

STYLED_CID = "2e546938ef46d69d4ba978b83c488924ca6be110504474bb83f092fd"   # has a logo


def _design_svg(design, course, module, cid=CID, **kw):
    return gen.render_svg(course_title=course, module_title=module, course_id=cid,
                          slt_hash=SLT, network="mainnet", design=design, **kw)


def test_no_design_keeps_course_and_module_labels():
    svg = _design_svg(None, "Some Course", "Some Module")
    assert ">COURSE<" in svg and ">MODULE<" in svg and ">CREDENTIAL<" not in svg
    print("  ✅ no design: COURSE / MODULE face")


def test_course_credential_labels_the_credential():
    plain = _design_svg(None, "Some Course", "Some Module")
    svg = _design_svg(gen.DESIGN_COURSE_CREDENTIAL, "Some Course", "Some Module")
    assert ">COURSE<" in svg and ">CREDENTIAL<" in svg and ">MODULE<" not in svg
    assert svg.replace(">CREDENTIAL<", ">MODULE<") == plain, "only the label may change"
    print("  ✅ course-credential: CREDENTIAL replaces MODULE and nothing else moves")


def test_title_only_shows_one_unlabelled_title():
    svg = _design_svg(gen.DESIGN_TITLE_ONLY, "Stand Alone", "Stand Alone")
    assert ">COURSE<" not in svg and ">MODULE<" not in svg and ">CREDENTIAL<" not in svg
    face = svg.split("</openbadges:credential>", 1)[1]
    assert face.count(">Stand Alone<") == 1, "the title is drawn once"
    assert 'aria-label="Andamio credential — Stand Alone"' in svg
    assert CID in face and SLT in face, "hashes stay on the face"
    print("  ✅ title-only: one title, no labels, hashes kept")


def test_title_only_centres_between_logo_and_divider():
    """Equal space above and below the title: logo bottom to the first line's cap
    top, and the last line's baseline to the divider, within a pixel of rounding,
    for a short, a mid and a wrapping title."""
    kw = style.committed().render_kwargs(STYLED_CID)
    for title in ("Short", "Agentic Coding on Cardano",
                  "A Much Longer Stand Alone Credential Title That Wraps Twice Over"):
        svg = _design_svg(gen.DESIGN_TITLE_ONLY, title, title, cid=STYLED_CID, **kw)
        logo_y = float(re.search(r'<svg x="[^"]+" y="([0-9.]+)" width', svg).group(1))
        size = int(re.search(r'font-size="(\d+)" fill="var\(--mtitle', svg).group(1))
        ys = [float(y) for y in re.findall(
            r'<text class="sans" x="512" y="([0-9.]+)" text-anchor="middle" '
            r'font-size="%d" fill="var\(--mtitle' % size, svg)]
        div = float(re.search(r'<line x1="362" y1="([0-9.]+)"', svg).group(1))
        assert ys, title
        above = (min(ys) - int(size * 0.72)) - (logo_y + kw["logo"]["height"])
        below = div - max(ys)
        assert abs(above - below) <= 1, f"{title!r}: above {above} vs below {below}"
    print("  ✅ title-only: title centered between logo and divider")


def test_unknown_design_is_refused():
    try:
        _design_svg("fancy", "A", "B")
    except ValueError as e:
        assert "fancy" in str(e)
    else:
        raise AssertionError("an unknown design must raise")
    print("  ✅ unknown design raises")


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
