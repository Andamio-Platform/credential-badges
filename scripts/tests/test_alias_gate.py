#!/usr/bin/env python3
"""U4 tests for the alias safety gate — stdlib only, no network.

The gate is the only thing standing between a hostile on-chain alias and a
generated SVG (plan KTD-5). Two aliases in the live holder set are unusable
and both appear here as fixtures: one is an XSS payload, one contains a space.

Runnable directly:
    python3 scripts/tests/test_alias_gate.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
sys.path.insert(0, SCRIPTS)

import alias_gate as ag  # noqa: E402

# The two live-set aliases the gate exists for (observed 2026-07-28).
XSS_ALIAS = "'\"name123'' onload='alert()'"
SPACE_ALIAS = "Tevo Saks"

# Ordinary aliases from the same live read — these must keep working.
LIVE_SAFE = ["james", "sebastianpabon", "njuguna", "dcm", "Newman5",
             "gZero", "naturedopes", "mayanhavoc", "Nori", "james2"]

STEM = "a" * 56 + "." + "1" * 64
KEY_VERSION = "key-2026-07"


# ------------------------------- refusals ---------------------------------- #

def test_live_xss_alias_is_refused():
    """Covers AE1. The alias that is literally an XSS payload never passes."""
    assert ag.alias_refusal(XSS_ALIAS) is not None
    assert not ag.is_safe_alias(XSS_ALIAS)
    print("  ✅ live XSS-shaped alias refused")


def test_live_space_alias_is_refused():
    assert ag.alias_refusal(SPACE_ALIAS) is not None
    assert not ag.is_safe_alias(SPACE_ALIAS)
    print("  ✅ alias containing a space refused")


def test_ordinary_live_aliases_pass_unchanged():
    for a in LIVE_SAFE:
        assert ag.alias_refusal(a) is None, f"{a!r} should be safe"
    print(f"  ✅ {len(LIVE_SAFE)} ordinary live aliases pass")


def test_overlong_alias_is_refused():
    assert ag.alias_refusal("a" * (ag.MAX_ALIAS_LEN + 1)) == ag.REFUSAL_TOO_LONG
    assert ag.alias_refusal("a" * ag.MAX_ALIAS_LEN) is None, "boundary must pass"
    print(f"  ✅ >{ag.MAX_ALIAS_LEN} refused, =={ag.MAX_ALIAS_LEN} passes")


def test_empty_and_whitespace_aliases_are_refused():
    for a in ["", "   ", "\t", "\n"]:
        assert ag.alias_refusal(a) is not None, f"{a!r} should be refused"
    assert ag.alias_refusal("") == ag.REFUSAL_EMPTY
    print("  ✅ empty / whitespace-only refused")


def test_non_string_input_is_refused_not_raised():
    """Chain reads are untrusted; a non-string must refuse, not explode."""
    for a in [None, 42, ["james"]]:
        assert ag.alias_refusal(a) is not None, f"{a!r} should be refused"
    print("  ✅ non-string input refused without raising")


# --------------------------- distinct reasons ------------------------------ #

def test_refusal_reasons_are_distinguishable():
    """A human triaging the skip report can tell these apart."""
    reasons = {
        ag.alias_refusal(XSS_ALIAS),
        ag.alias_refusal("a" * 100),
        ag.alias_refusal(""),
    }
    assert len(reasons) == 3, f"reasons collapsed: {reasons}"
    print(f"  ✅ three distinct refusal reasons: {sorted(reasons)}")


def test_skip_report_names_alias_and_reason():
    refusals = [(XSS_ALIAS, ag.alias_refusal(XSS_ALIAS)),
                (SPACE_ALIAS, ag.alias_refusal(SPACE_ALIAS))]
    report = ag.format_skip_report(refusals)
    assert ag.REFUSAL_CHARSET in report
    assert "2" in report, "report should state how many were skipped"
    # The hostile alias is reported quoted/escaped, never raw-interpolated.
    assert "onload=" not in report or repr(XSS_ALIAS) in report
    print("  ✅ skip report names each alias with its reason")


def test_partition_splits_safe_from_refused():
    safe, refused = ag.partition_aliases(LIVE_SAFE + [XSS_ALIAS, SPACE_ALIAS])
    assert safe == LIVE_SAFE, safe
    assert [a for a, _ in refused] == [XSS_ALIAS, SPACE_ALIAS]
    print(f"  ✅ partition: {len(safe)} safe, {len(refused)} refused")


# ------------------- refuses before any concatenation ---------------------- #

def test_cache_key_refuses_unsafe_alias_before_building_anything():
    """The gate runs before the alias reaches a key — no path is ever formed."""
    for bad in [XSS_ALIAS, SPACE_ALIAS, "", "a" * 100]:
        try:
            ag.holder_cache_key(STEM, bad, KEY_VERSION)
        except ag.UnsafeAlias:
            continue
        raise AssertionError(f"holder_cache_key accepted {bad!r}")
    print("  ✅ holder_cache_key refuses before constructing a key")


def test_cache_key_shape_matches_ktd8():
    key = ag.holder_cache_key(STEM, "james", KEY_VERSION)
    assert key == f"{STEM}.james.{KEY_VERSION}.svg", key
    print(f"  ✅ cache key shape: {key[:24]}…")


def test_cache_key_includes_key_version_so_rotation_invalidates():
    a = ag.holder_cache_key(STEM, "james", "key-2026-07")
    b = ag.holder_cache_key(STEM, "james", "key-2027-01")
    assert a != b, "rotation must produce a different cache key"
    print("  ✅ key version participates in the cache key")


# ------------------- parity with the shipped issuer regex ------------------ #

def test_gate_agrees_with_issuer_alias_re():
    """The issuer already enforces this charset; a third definition must not drift.

    issuer-service/src/server.ts: ALIAS_RE = /^[A-Za-z0-9_-]{1,64}$/
    """
    import re
    repo = os.path.dirname(SCRIPTS)
    server = os.path.join(repo, "issuer-service", "src", "server.ts")
    src = open(server, encoding="utf-8").read()
    m = re.search(r"const ALIAS_RE\s*=\s*/\^(.+?)\$/", src)
    assert m, "could not find ALIAS_RE in issuer-service/src/server.ts"
    issuer_re = re.compile("^" + m.group(1) + "$")

    fixtures = LIVE_SAFE + [XSS_ALIAS, SPACE_ALIAS, "", "a" * 65, "a" * 64]
    for a in fixtures:
        assert (issuer_re.match(a) is not None) == ag.is_safe_alias(a), (
            f"gate and issuer ALIAS_RE disagree on {a!r}")
    print(f"  ✅ gate matches issuer ALIAS_RE on {len(fixtures)} fixtures")


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
