#!/usr/bin/env python3
"""Hand-set badge styles (credential-badges#157): the logo validator, the
style lookup, and the two properties a style must never break:

  * an unstyled badge is byte-identical to what it was before styles existed;
  * a styled badge's rings still decode to its on-chain identity.

Stdlib only, runnable directly:  python3 generator/tests/test_style.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import colors  # noqa: E402
import gen     # noqa: E402
import og      # noqa: E402
import render  # noqa: E402
import style   # noqa: E402

CID = "2e546938ef46d69d4ba978b83c488924ca6be110504474bb83f092fd"
SLT = "bc135966aa3694eef38df7a656a319bc5f60865dee9f677e5546a8a709ba5e8e"
OTHER = "0fd31fc3346e0ccf65465dff82a82e233f32eb7f1c495a3d66468550"

GOOD_LOGO = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">'
             '<g fill="#3E3E3E"><circle cx="10" cy="10" r="5"/></g>'
             '<path d="M 0 0 L 10 0 L 10 10 Z" fill="#0084FF" fill-rule="evenodd"/></svg>')


def _kw(course_id=CID, slt=SLT):
    return dict(course_title="Cardano for the Real World", module_title="Submit Your Pitch",
                course_id=course_id, slt_hash=slt, network="mainnet")


def _decode(svg):
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg)
        path = f.name
    try:
        return subprocess.run([sys.executable, os.path.join(GEN, "decode.py"), path],
                              capture_output=True, text=True)
    finally:
        os.unlink(path)


def _rejects(markup, why):
    try:
        style.check_logo(markup.encode())
    except style.StyleError as e:
        return str(e)
    raise AssertionError(f"logo validator accepted {why}")


def test_logo_validator_accepts_shapes():
    vw, vh, inner = style.check_logo(GOOD_LOGO.encode())
    assert (vw, vh) == (100.0, 50.0)
    assert "ns0" not in inner and "<circle" in inner and "<path" in inner
    print("  ✅ a shapes-only logo is accepted and re-serialized without a namespace prefix")


def test_logo_validator_rejects_line_and_active_content():
    ns = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"'
    assert "<line>" in _rejects(f'<svg {ns}><line x1="0" y1="0" x2="1" y2="1"/></svg>', "<line>")
    _rejects(f'<svg {ns}><script>alert(1)</script></svg>', "<script>")
    _rejects(f'<svg {ns}><image href="https://x/y.png"/></svg>', "<image>")
    _rejects(f'<svg {ns}><circle cx="1" cy="1" r="1" onload="x()"/></svg>', "an event attribute")
    _rejects(f'<svg {ns}><g style="fill:red"/></svg>', "a style attribute")
    _rejects(f'<svg {ns}><text>CARDANO</text></svg>', "<text>")
    _rejects(f'<svg {ns}><path d="M 0 0 A 1 1 0 0 0 2 2"/></svg>', "an arc command")
    _rejects(f'<svg {ns}><g fill="url(#x)"/></svg>', "a paint server fill")
    _rejects('<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 0 10 10"/>', "an offset viewBox")
    print("  ✅ <line>, scripts, images, events, styles, text, arcs and paint servers are refused")


def _write_style(d, cid=CID, with_logo=True, **over):
    rec = {"name": "Test", "approval": "test fixture",
           "base": {k: "#112233" for k in gen.BASE},
           "interior": {k: "#FFFFFF" for k in gen.INT}}
    if with_logo:
        rec["logo"] = {"height": 62, "dx": -12, "gap": 44}
        open(os.path.join(d, f"{cid}.logo.svg"), "w").write(GOOD_LOGO)
    rec.update(over)
    json.dump(rec, open(os.path.join(d, f"{cid}.json"), "w"))


def test_load_refuses_incomplete_records():
    cases = {
        "missing token": dict(base={k: "#112233" for k in gen.BASE[1:]}),
        "bad colour": dict(interior=dict({k: "#FFFFFF" for k in gen.INT}, core1="white")),
        "logo without approval": dict(approval=""),
        "logo out of range": dict(logo={"height": 500, "dx": 0, "gap": 44}),
    }
    for why, over in cases.items():
        d = tempfile.mkdtemp()
        try:
            _write_style(d, **over)
            try:
                style.load(d)
            except style.StyleError:
                continue
            raise AssertionError(f"style.load accepted a record with {why}")
        finally:
            shutil.rmtree(d)
    d = tempfile.mkdtemp()
    try:
        open(os.path.join(d, f"{CID}.logo.svg"), "w").write(GOOD_LOGO)
        try:
            style.load(d)
            raise AssertionError("style.load accepted a logo no record names")
        except style.StyleError:
            pass
    finally:
        shutil.rmtree(d)
    print("  ✅ missing tokens, bad colours, unapproved or out-of-range logos and orphan logos are refused")


def test_unstyled_course_falls_back_to_palette_for():
    s = style.committed()
    assert OTHER not in s.keys()
    assert s.badge_palette(OTHER) == colors.light_interior(colors.palette_for(OTHER))
    assert s.base_palette(OTHER) == colors.palette_for(OTHER)
    assert s.render_kwargs(OTHER) == {"pal": colors.light_interior(colors.palette_for(OTHER))}
    print("  ✅ a course without a style renders with colors.palette_for, unchanged")


def test_logo_none_is_byte_identical():
    pal = colors.light_interior(colors.palette_for(OTHER))
    kw = _kw(OTHER)
    assert gen.render_svg(**kw, pal=pal) == gen.render_svg(**kw, pal=pal, logo=None)
    print("  ✅ render_svg(logo=None) is byte-identical")


def test_committed_style_is_valid_and_styles_its_badge():
    s = style.committed()
    assert CID in s.keys(), "the Cardano Academy style should be committed"
    logo = s.logo_for(CID)
    assert logo and "<line" not in logo["markup"]
    svg = gen.render_svg(**_kw(), **s.render_kwargs(CID))
    assert svg.count('aria-hidden="true"') == 1 and "#0084FF" in svg
    r = _decode(svg)
    assert r.returncode == 0 and r.stdout.count("✅ MATCH") >= 2, r.stdout
    print("  ✅ the styled Cardano Academy badge carries its logo and its rings decode")


def test_every_path_renders_the_same_style():
    """build.py, the on-demand render service and the OG card all resolve the
    style from the same lookup, so a course cannot look one way committed and
    another way on demand."""
    import build
    rec = {"course_id": CID, "slt_hash": SLT,
           "course_title": "Cardano for the Real World", "module_title": "Submit Your Pitch"}
    built = build.render(rec)
    on_demand = render.render_badge(
        CID, SLT, "mainnet",
        fetch_titles=lambda c, n: ("Cardano for the Real World",
                                   {SLT: {"title": "Submit Your Pitch", "on_chain_slts": []}}))
    assert built == on_demand, "committed and on-demand renders of a styled badge diverge"
    card = og._card_svg(rec)
    assert style.committed().logo_for(CID)["markup"] in card
    print("  ✅ build, render service and OG card draw the same styled badge")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
    print(f"\n{len(tests)} style tests passed")
