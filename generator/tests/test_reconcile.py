#!/usr/bin/env python3
"""U1 tests for the self-pruning reconciler (generator/reconcile.py, #31).

Guards the orphan-shield contract: every served badges/ artifact must map to a
non-skipped credentials.json record, protected/placeholder and unrecognized
files are never deleted, and a dropped credential's artifacts are pruned across
ALL types (svg + the v1.2 png/og.png).

No third-party test framework in this repo — runnable directly:
    python3 generator/tests/test_reconcile.py
(Also discoverable by pytest: functions are named test_*.)
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)                      # generator/
sys.path.insert(0, GEN)

import reconcile  # noqa: E402
import build      # noqa: E402

# Two well-formed stems (56-hex . 64-hex) drawn from the real registry shape.
CID_A = "203e63f457e0b8088073ec20959c4e0cc188cf90425d4f29ff3f817f"
SLT_A = "77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b"
CID_B = "31d8c4a67671c0d6b580eb5fcd78f92f6fa82d47fcbb052954e6faf5"
SLT_B = "b08b39ac874d68fcec7f98a399d343c5895e17d52921863804cef386a5a1f9ca"
STEM_A = f"{CID_A}.{SLT_A}"
STEM_B = f"{CID_B}.{SLT_B}"

# A course_id in SKIP_COURSES (FCB Fan Engagement) — deliberately withheld.
SKIP_CID = next(iter(build.SKIP_COURSES))
SKIP_STEM = f"{SKIP_CID}.{'a' * 64}"


def _touch(d, name, content="x"):
    open(os.path.join(d, name), "w").write(content)


def _mkdir_badges(files):
    d = tempfile.mkdtemp()
    for name, content in files.items():
        _touch(d, name, content)
    return d


def test_happy_path_no_orphans():
    """A dir holding exactly the expected artifacts prunes nothing."""
    expected = {STEM_A, STEM_B}
    d = _mkdir_badges({
        f"{STEM_A}.svg": "s", f"{STEM_A}.png": "p", f"{STEM_A}.og.png": "o",
        f"{STEM_B}.svg": "s",
        "_placeholder.svg": "placeholder",
    })
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [], f"expected no orphans, got {orphans}"
    assert os.path.exists(os.path.join(d, f"{STEM_A}.og.png"))
    print("  ✅ expected artifacts are kept; nothing pruned")


def test_orphan_svg_pruned():
    """An SVG whose stem is not in the registry is deleted."""
    expected = {STEM_A}
    d = _mkdir_badges({f"{STEM_A}.svg": "s", f"{STEM_B}.svg": "orphan"})
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [f"{STEM_B}.svg"], orphans
    assert not os.path.exists(os.path.join(d, f"{STEM_B}.svg"))
    assert os.path.exists(os.path.join(d, f"{STEM_A}.svg"))
    print("  ✅ orphan svg pruned, in-registry svg kept")


def test_orphan_pruned_across_all_types():
    """Covers R6. Dropping a credential prunes svg + png + og.png for its stem."""
    expected = {STEM_A}  # STEM_B dropped from the registry
    d = _mkdir_badges({
        f"{STEM_A}.svg": "s",
        f"{STEM_B}.svg": "s", f"{STEM_B}.png": "p", f"{STEM_B}.og.png": "o",
    })
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert set(orphans) == {f"{STEM_B}.svg", f"{STEM_B}.png", f"{STEM_B}.og.png"}, orphans
    for suffix in (".svg", ".png", ".og.png"):
        assert not os.path.exists(os.path.join(d, f"{STEM_B}{suffix}"))
    print("  ✅ dropped credential pruned across svg/png/og.png")


def test_protected_names_never_deleted():
    """_placeholder.svg and any _-prefixed file survive even with no record."""
    expected = set()  # nothing expected — only protected files remain
    d = _mkdir_badges({"_placeholder.svg": "ph", "_draft.svg": "d"})
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [], orphans
    assert os.path.exists(os.path.join(d, "_placeholder.svg"))
    assert os.path.exists(os.path.join(d, "_draft.svg"))
    print("  ✅ _placeholder.svg and _-prefixed files are protected")


def test_skipped_course_treated_as_orphan():
    """A file for a SKIP_COURSES course has no expected stem (build.py never
    renders it), so it is an orphan — matching the render filter."""
    expected = reconcile.expected_stems()  # from the real registry, minus SKIP
    assert SKIP_STEM not in expected, "skipped course must not be an expected stem"
    d = _mkdir_badges({f"{SKIP_STEM}.svg": "should-not-exist"})
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [f"{SKIP_STEM}.svg"], orphans
    print("  ✅ skipped-course artifact treated as orphan")


def test_strict_key_match_leaves_unknown_files():
    """Malformed / unrecognized names are skipped, never deleted."""
    expected = {STEM_A}
    d = _mkdir_badges({
        f"{STEM_A}.svg": "s",
        "notes.txt": "n",                       # unknown extension
        "abc.png": "x",                         # bad stem shape
        f"{'a' * 40}.svg": "short-stem",        # 40-hex, not 56.64
        "README.md": "r",
    })
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [], f"unknown files must not be pruned, got {orphans}"
    for name in ("notes.txt", "abc.png", f"{'a' * 40}.svg", "README.md"):
        assert os.path.exists(os.path.join(d, name)), f"{name} was wrongly deleted"
    print("  ✅ malformed/unknown files are never deleted (strict key match)")


def test_baked_badge_kept_when_in_registry():
    """A baked SVG (carries proofValue) whose stem IS in the registry is kept —
    baked badges are never orphans."""
    expected = {STEM_A}
    baked_svg = '<svg><openbadges:credential><![CDATA[{"proofValue":"z"}]]></openbadges:credential></svg>'
    d = _mkdir_badges({f"{STEM_A}.svg": baked_svg})
    orphans = reconcile.reconcile(d, expected=expected, delete=True, log=lambda *_: None)
    assert orphans == [], orphans
    assert os.path.exists(os.path.join(d, f"{STEM_A}.svg"))
    print("  ✅ in-registry baked badge is kept")


def test_check_mode_is_read_only():
    """--check reports orphans but deletes nothing."""
    expected = {STEM_A}
    d = _mkdir_badges({f"{STEM_A}.svg": "s", f"{STEM_B}.svg": "orphan"})
    orphans = reconcile.reconcile(d, expected=expected, delete=False, log=lambda *_: None)
    assert orphans == [f"{STEM_B}.svg"], orphans
    assert os.path.exists(os.path.join(d, f"{STEM_B}.svg")), "check mode must not delete"
    print("  ✅ --check reports orphans without deleting")


def test_expected_stems_matches_build_filter():
    """expected_stems() equals the non-skipped registry records — the same set
    build.py renders."""
    data = json.load(open(os.path.join(GEN, "credentials.json")))
    want = {f"{r['course_id']}.{r['slt_hash']}"
            for r in data if r["course_id"] not in build.SKIP_COURSES}
    assert reconcile.expected_stems() == want
    print(f"  ✅ expected_stems() == {len(want)} non-skipped records (build.py filter)")


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
