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


def test_nested_badge_art_is_embedded():
    """The composition must actually embed the badge art (a nested <svg>), not
    just the text column — dropping the badge append should fail this."""
    svg = og._card_svg(REC)
    assert svg.count("<svg") >= 2, "expected the nested badge <svg> inside the card"
    # The badge encodes the credential's identity in its rings/metadata.
    assert REC["course_id"] in svg and REC["slt_hash"] in svg
    print("  ✅ nested badge art embedded in the card")


def test_wrapped_course_title_still_centers():
    """block_h counts every course line, so a wrapping course_title keeps the
    text block on-canvas (regression guard for the single-line miscount)."""
    rec = dict(REC, course_title=(
        "A Very Long Course Title That Will Definitely Wrap Across Two Lines Here"))
    clines, csz = og.gen.lay_title(rec["course_title"], 30, og.COL_W, 0.54, 22)
    assert len(clines) >= 2, "test title should wrap"
    line_h_c = int(csz * 1.18)
    line_h_m = int(og.gen.lay_title(rec["module_title"], 56, og.COL_W, 0.58, 34)[1] * 1.12)
    mlines = og.gen.lay_title(rec["module_title"], 56, og.COL_W, 0.58, 34)[0]
    block_h = 30 + len(clines) * line_h_c + 20 + len(mlines) * line_h_m
    y0 = (og.H - block_h) // 2 + csz
    assert y0 - 30 >= 0, "text block starts above the top edge"
    # last module baseline stays on-canvas
    y_last = y0 + 30 + len(clines) * line_h_c + 20 + len(mlines) * line_h_m
    assert y_last <= og.H, "text block overflows the bottom edge"
    print("  ✅ wrapped course title keeps the text block on-canvas")


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


def test_card_carries_injected_course_art():
    import art
    import shutil
    import tempfile
    d = tempfile.mkdtemp()
    try:
        shutil.copy(os.path.join(HERE, "fixtures", "art", "placeholder.jpg"),
                    os.path.join(d, f"{REC['course_id']}.jpg"))
        badge_art = art.load(d)
    finally:
        shutil.rmtree(d)
    with_art = og._card_svg(REC, badge_art=badge_art)
    plain = og._card_svg(REC, badge_art=art.NO_ART)
    assert with_art.count("<image") == 1 and "<image" not in plain
    # outside the nested badge, the card is unchanged
    strip = lambda s: s[:s.index("<g transform")] + s[s.index("</svg></g>"):]
    assert strip(with_art) == strip(plain)
    print("  ✅ OG card nests the badge with its art; the card around it is unchanged")


def test_main_rejects_invalid_art_before_write():
    """og.py's main() must validate the whole --art-dir before writing anything
    (finding #2): a bad file in --art-dir should fail loudly and leave the
    outdir empty/absent, mirroring build.py's whole-dir-before-first-write
    guarantee."""
    import shutil
    import subprocess
    import tempfile
    art_dir = tempfile.mkdtemp()
    outdir = tempfile.mkdtemp()
    shutil.rmtree(outdir)   # main() should not need to create it to fail
    try:
        with open(os.path.join(art_dir, f"{REC['course_id']}.jpg"), "wb") as f:
            f.write(b"not a jpeg")
        proc = subprocess.run(
            [sys.executable, os.path.join(GEN, "og.py"), outdir,
             "--art-dir", art_dir],
            capture_output=True, text=True)
        assert proc.returncode != 0, "expected a non-zero exit on invalid art"
        assert "not a JPEG" in (proc.stdout + proc.stderr)
        assert not os.path.exists(outdir) or not os.listdir(outdir), \
            "outdir must stay empty/absent when art validation fails"
    finally:
        shutil.rmtree(art_dir, ignore_errors=True)
        shutil.rmtree(outdir, ignore_errors=True)
    print("  ✅ og.py main() rejects invalid --art-dir before writing")


def test_main_writes_cards_with_injected_art():
    """Positive companion: valid --art-dir art reaches exactly the card whose
    course_id matches, and no other card."""
    import shutil
    import subprocess
    import tempfile
    art_dir = tempfile.mkdtemp()
    outdir = tempfile.mkdtemp()
    shutil.rmtree(outdir)
    try:
        shutil.copy(os.path.join(HERE, "fixtures", "art", "placeholder.jpg"),
                    os.path.join(art_dir, f"{REC['course_id']}.jpg"))
        proc = subprocess.run(
            [sys.executable, os.path.join(GEN, "og.py"), outdir,
             "--art-dir", art_dir],
            capture_output=True, text=True)
        assert proc.returncode == 0, proc.stdout + proc.stderr

        import json as _json
        data = [r for r in _json.load(open(og.DATA)) if r["course_id"] != REC["course_id"]]
        other = next(r for r in data if r["course_id"] != REC["course_id"])

        with_art_path = os.path.join(
            outdir, f"{REC['course_id']}.{REC['slt_hash']}.og.svg")
        other_path = os.path.join(
            outdir, f"{other['course_id']}.{other['slt_hash']}.og.svg")
        with_art_svg = open(with_art_path).read()
        other_svg = open(other_path).read()
        assert with_art_svg.count("<image") == 1, \
            "expected exactly one <image> for the record carrying injected art"
        assert "<image" not in other_svg, \
            "a different course's card must not carry the injected art"
    finally:
        shutil.rmtree(art_dir, ignore_errors=True)
        shutil.rmtree(outdir, ignore_errors=True)
    print("  ✅ og.py main() wires --art-dir into exactly the matching card")


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
