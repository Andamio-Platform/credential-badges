#!/usr/bin/env python3
"""Tests for fetch.keep_hand_set — offline, no chain or CLI calls.

A registry refresh rebuilds credentials.json from the chain. Andamio Issuer
credentials have no titles there, so a record Andamio set by hand (one carrying
a `design`) must keep its titles and design across the refresh.

Runnable directly:
    python3 generator/tests/test_fetch.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import fetch  # noqa: E402

A = {"course_id": "a" * 56, "slt_hash": "1" * 64}
B = {"course_id": "b" * 56, "slt_hash": "2" * 64}
C = {"course_id": "c" * 56, "slt_hash": "3" * 64}


def test_hand_set_titles_and_design_survive_a_refresh():
    previous = [dict(A, course_title="Set Course", module_title="Set Credential",
                     design="course-credential")]
    fetched = [dict(A, course_title="", module_title="I can do the first statement.")]
    out = fetch.keep_hand_set(fetched, previous)
    assert out == previous, out
    print("  ✅ hand-set titles and design win over the chain's")


def test_records_without_a_design_take_the_chain():
    previous = [dict(B, course_title="Old", module_title="Old")]
    fetched = [dict(B, course_title="New", module_title="New")]
    assert fetch.keep_hand_set(fetched, previous) == fetched
    print("  ✅ a record without a design is rewritten from the chain")


def test_hand_set_record_missing_from_chain_is_kept():
    hand = dict(C, course_title="T", module_title="T", design="title-only")
    out = fetch.keep_hand_set([dict(A, course_title="x", module_title="y")], [hand])
    assert hand in out and len(out) == 2
    assert out == sorted(out, key=lambda r: (r["course_id"], r["slt_hash"]))
    print("  ✅ a hand-set record the chain dropped is kept, output stays sorted")


def test_unknown_design_is_refused():
    try:
        fetch.keep_hand_set([], [dict(A, course_title="t", module_title="t", design="nope")])
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown design must raise")
    print("  ✅ an unknown design fails the refresh")


def test_committed_registry_designs_are_known():
    import json
    import gen
    for r in json.load(open(fetch.OUT)):
        gen.check_design(r.get("design"))
        if r.get("design") == gen.DESIGN_TITLE_ONLY:
            assert r["course_title"] == r["module_title"], r
    print("  ✅ every design in credentials.json is known; title-only rows repeat one title")


def _main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        print(f"• {t.__name__}")
        try:
            t()
        except (AssertionError, ValueError) as e:
            failed += 1
            print(f"  ❌ FAIL: {e}")
    print(f"\n{'❌' if failed else '✅'} {len(tests)-failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    _main()
