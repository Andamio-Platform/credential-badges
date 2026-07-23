#!/usr/bin/env python3
"""U2 parity + safety tests for the gen.py parameterized-render refactor.

Guards the refactor's core promise: render_svg() (parameter-driven, concurrency-
safe) produces byte-identical output to the badges already committed in ../badges/,
which the orphan-shield work verified as the canonical generator output.

No third-party test framework in this repo — runnable directly:
    python3 generator/tests/test_render_parity.py
(Also discoverable by pytest if it is ever added: functions are named test_*.)
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)                      # generator/
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, GEN)

import gen        # noqa: E402
import colors     # noqa: E402
import build      # noqa: E402


def _nonskipped_records():
    data = json.load(open(os.path.join(GEN, "credentials.json")))
    return [r for r in data if r["course_id"] not in build.SKIP_COURSES]


# A BAKED badge (tools/bake-signed-vc.ts) has its <openbadges:credential> block
# replaced with the signed credential, so it legitimately diverges from raw
# generator output in exactly that one element. Detection: only signed
# credentials carry a proofValue. For baked badges the parity check normalizes
# that block out of BOTH sides — everything the generator owns (rings, palette,
# titles, the unsigned <metadata> block) must still match byte-for-byte. The
# credential block itself is guarded by tools/bake-signed-vc.test.ts (committed
# SVG must embed signed-credential.json byte-identically), not by this test.
_CRED_BLOCK = re.compile(rb"<openbadges:credential\b.*?</openbadges:credential>",
                         re.S)


def _without_credential_block(data):
    normalized, n = _CRED_BLOCK.subn(b"<openbadges:credential/>", data)
    assert n == 1, f"expected exactly one openbadges:credential block, found {n}"
    return normalized


def test_build_output_byte_identical_to_committed_badges():
    """Regenerate every badge to a scratch dir via build.py and assert each file
    is byte-identical to the committed badges/ — never write into the live tree.
    Baked badges are compared with the signed credential block normalized out
    (see _CRED_BLOCK above)."""
    records = _nonskipped_records()
    with tempfile.TemporaryDirectory() as out:
        r = subprocess.run([sys.executable, os.path.join(GEN, "build.py"), out],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"build.py failed: {r.stderr}"
        produced = [f for f in os.listdir(out) if f.endswith(".svg")]
        assert len(produced) == len(records), (
            f"expected {len(records)} badges, build produced {len(produced)}")
        mismatches = []
        baked = 0
        for name in produced:
            new = open(os.path.join(out, name), "rb").read()
            committed_path = os.path.join(BADGES, name)
            if not os.path.exists(committed_path):
                mismatches.append(f"{name}: no committed badge to compare")
                continue
            committed = open(committed_path, "rb").read()
            if b"proofValue" in committed:
                baked += 1
                if _without_credential_block(new) != _without_credential_block(committed):
                    mismatches.append(
                        f"{name}: generated portions differ from committed baked badge")
            elif new != committed:
                mismatches.append(f"{name}: bytes differ from committed badge")
        assert not mismatches, "byte-identity broken:\n  " + "\n  ".join(mismatches)
    print(f"  ✅ {len(records)} badges byte-identical to committed badges/ "
          f"({baked} baked, compared modulo the signed credential block)")


def test_build_svg_wrapper_matches_render_svg():
    """The legacy globals-driven build_svg(pal) must equal render_svg() called
    with those same global values — proves the wrapper is a faithful delegate."""
    pal = colors.light_interior(build.palette_for(gen.COURSE_ID))
    via_wrapper = gen.build_svg(pal)
    via_params = gen.render_svg(
        course_title=gen.COURSE_TITLE, module_title=gen.MODULE_TITLE,
        course_id=gen.COURSE_ID, slt_hash=gen.SLT_HASH, network=gen.NETWORK, pal=pal)
    assert via_wrapper == via_params, "build_svg wrapper diverged from render_svg"
    print("  ✅ build_svg(pal) == render_svg(<globals>, pal)")


def test_render_svg_is_concurrency_safe():
    """Many threads render different credentials at once. Because render_svg reads
    no module globals, each result must carry its OWN course_id + title — proving
    no cross-thread interleave (the bug the old global-mutation path risked)."""
    records = _nonskipped_records()[:8]
    assert len(records) >= 2, "need >=2 records to test interleave"
    results = {}
    errors = []

    def work(rec):
        try:
            pal = colors.light_interior(build.palette_for(rec["course_id"]))
            for _ in range(5):
                svg = gen.render_svg(
                    course_title=rec["course_title"] or "Andamio",
                    module_title=rec["module_title"] or "Credential",
                    course_id=rec["course_id"], slt_hash=rec["slt_hash"],
                    network="mainnet", pal=pal)
                # each render must contain its own identity, never a sibling's
                assert rec["course_id"] in svg
                assert rec["slt_hash"] in svg
            results[rec["slt_hash"]] = svg   # slt_hash is unique per credential
        except Exception as e:  # noqa: BLE001
            errors.append(f"{rec['course_id'][:10]}: {e}")

    threads = [threading.Thread(target=work, args=(r,)) for r in records]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, "concurrent render corruption:\n  " + "\n  ".join(errors)
    # cross-check: every thread's final SVG matches a fresh single-threaded render
    for rec in records:
        pal = colors.light_interior(build.palette_for(rec["course_id"]))
        expected = gen.render_svg(
            course_title=rec["course_title"] or "Andamio",
            module_title=rec["module_title"] or "Credential",
            course_id=rec["course_id"], slt_hash=rec["slt_hash"],
            network="mainnet", pal=pal)
        assert results[rec["slt_hash"]] == expected
    print(f"  ✅ {len(records)} credentials rendered concurrently with no interleave")


def test_decode_round_trip_still_holds():
    """A freshly rendered badge must still round-trip: the rings decode (geometry
    only) back to its course_id (outer) and slt_hash (inner)."""
    rec = _nonskipped_records()[0]
    pal = colors.light_interior(build.palette_for(rec["course_id"]))
    svg = gen.render_svg(
        course_title=rec["course_title"] or "Andamio",
        module_title=rec["module_title"] or "Credential",
        course_id=rec["course_id"], slt_hash=rec["slt_hash"], network="mainnet", pal=pal)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as f:
        f.write(svg)
        path = f.name
    try:
        r = subprocess.run([sys.executable, os.path.join(GEN, "decode.py"), path],
                           capture_output=True, text=True)
        assert "❌" not in r.stdout, f"decode reported mismatch:\n{r.stdout}"
        assert r.stdout.count("✅ MATCH") >= 2, f"expected 2 ring matches:\n{r.stdout}"
    finally:
        os.unlink(path)
    print("  ✅ render_svg badge round-trips (outer==course_id, inner==slt_hash)")


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
