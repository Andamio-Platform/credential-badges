#!/usr/bin/env python3
"""U6 tests for the cache-admin tool — stdlib only, gateway + GCS injected.

Runnable directly:
    python3 scripts/tests/test_cache_admin.py
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
REPO = os.path.dirname(SCRIPTS)
sys.path.insert(0, os.path.join(REPO, "service"))
sys.path.insert(0, os.path.join(REPO, "generator"))

from cache import MemoryCache          # noqa: E402
from api_client import GatewayError    # noqa: E402

# cache-admin.py has a hyphen → load it by path.
_spec = importlib.util.spec_from_file_location(
    "cache_admin", os.path.join(SCRIPTS, "cache-admin.py"))
ca = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ca)

CID_A = "a" * 56
CID_B = "b" * 56
SLT_1 = "1" * 64
SLT_2 = "2" * 64
KEY_A = f"{CID_A}.{SLT_1}.svg"   # course A
KEY_B = f"{CID_B}.{SLT_2}.svg"   # course B


def _cache(*keys):
    c = MemoryCache()
    for k in keys:
        c.put(k, b"<svg/>")
    return c


def _quiet(*_a, **_k):
    pass


# ----------------------------- invalidate ---------------------------------- #

def test_invalidate_removes_and_re_misses():
    c = _cache(KEY_A, KEY_B)
    removed = ca.invalidate(c, [KEY_A], protected=set(), log=_quiet)
    assert removed == [KEY_A], removed
    assert c.get(KEY_A) is None, "deleted object must re-miss (re-renders next request)"
    assert c.get(KEY_B) == b"<svg/>", "other objects untouched"
    print("  ✅ invalidate deletes the named object; next get is a miss")


def test_invalidate_refuses_protected_and_malformed():
    c = _cache(KEY_A)
    protected = {"_placeholder.svg", KEY_A}
    removed = ca.invalidate(
        c, ["_placeholder.svg", KEY_A, "not-a-badge.svg"], protected=protected, log=_quiet)
    assert removed == [], removed
    assert c.get(KEY_A) == b"<svg/>", "a protected name must never be deleted"
    print("  ✅ invalidate refuses protected names + malformed ids (nothing deleted)")


def test_invalidate_absent_is_idempotent():
    c = _cache()
    removed = ca.invalidate(c, [KEY_A], protected=set(), log=_quiet)
    assert removed == [], "absent object → nothing removed, no error"
    print("  ✅ invalidate of an absent object is a no-op, not an error")


# ------------------------------ reconcile ---------------------------------- #

def test_reconcile_flags_unresolvable_course():
    c = _cache(KEY_A, KEY_B)
    # A resolves, B does not.
    resolves = lambda cid, nets: cid == CID_A
    orphaned = ca.reconcile(c, ["mainnet", "preprod"], resolves=resolves,
                            protected=set(), log=_quiet)
    assert orphaned == [KEY_B], orphaned
    assert c.get(KEY_B) == b"<svg/>", "report-only mode must NOT delete"
    print("  ✅ reconcile flags the unresolvable course; report-only keeps the object")


def test_reconcile_delete_removes_orphans():
    c = _cache(KEY_A, KEY_B)
    resolves = lambda cid, nets: cid == CID_A
    orphaned = ca.reconcile(c, ["mainnet"], resolves=resolves, protected=set(),
                            delete=True, log=_quiet)
    assert orphaned == [KEY_B]
    assert c.get(KEY_B) is None, "--delete removes the orphaned object"
    assert c.get(KEY_A) == b"<svg/>", "resolving course is kept"
    print("  ✅ reconcile --delete removes only the orphaned object")


def test_reconcile_skips_protected_and_non_badge_keys():
    c = _cache(KEY_A, "_placeholder.svg", "README.md")
    # Everything would be 'unresolvable' if checked — but protected + non-badge
    # keys must never even be checked, let alone flagged.
    calls = []

    def resolves(cid, nets):
        calls.append(cid)
        return False

    orphaned = ca.reconcile(c, ["mainnet"], resolves=resolves,
                            protected={"_placeholder.svg"}, log=_quiet)
    assert orphaned == [KEY_A], orphaned
    assert calls == [CID_A], f"only the badge-shaped, unprotected key is probed: {calls}"
    print("  ✅ reconcile skips protected names + non-badge keys (never probed)")


def test_reconcile_resolves_each_course_once():
    c = _cache(KEY_A, f"{CID_A}.{SLT_2}.svg")   # two badges, same course
    calls = []

    def resolves(cid, nets):
        calls.append(cid)
        return True

    ca.reconcile(c, ["mainnet"], resolves=resolves, protected=set(), log=_quiet)
    assert calls == [CID_A], f"a course_id is probed once, not per-object: {calls}"
    print("  ✅ reconcile resolves each unique course_id once")


def test_reconcile_aborts_loudly_on_gateway_failure():
    c = _cache(KEY_A)

    def broken(cid, nets):
        raise ca.CacheAdminError("gateway down")

    try:
        ca.reconcile(c, ["mainnet"], resolves=broken, protected=set(), log=_quiet)
    except ca.CacheAdminError:
        assert c.get(KEY_A) == b"<svg/>", "a broken gateway must delete NOTHING"
        print("  ✅ reconcile aborts loudly on gateway failure (no flag, no delete)")
        return
    raise AssertionError("reconcile should have raised CacheAdminError")


# -------------------- gateway_resolves fail-loud logic --------------------- #

def _raiser(kind):
    def gt(course_id, network):
        raise GatewayError(None, kind, f"simulated {kind}")
    return gt


def test_gateway_resolves_true_on_success():
    got = []
    ok = lambda cid, net: got.append((cid, net))   # returns None == success
    assert ca.gateway_resolves(CID_A, ["mainnet", "preprod"], get_titles=ok) is True
    assert got == [(CID_A, "mainnet")], "stops at the first resolving network"
    print("  ✅ gateway_resolves → True on first success (short-circuits)")


def test_gateway_resolves_false_only_on_clean_miss_everywhere():
    assert ca.gateway_resolves(CID_A, ["mainnet", "preprod"],
                               get_titles=_raiser("unresolvable")) is False
    assert ca.gateway_resolves(CID_A, ["mainnet"],
                               get_titles=_raiser("not_found")) is False
    print("  ✅ gateway_resolves → False only when every network is a clean miss")


def test_gateway_resolves_raises_loudly_on_infra_errors():
    for kind in ("auth", "timeout", "transport", "config", "other"):
        try:
            ca.gateway_resolves(CID_A, ["mainnet"], get_titles=_raiser(kind))
        except ca.CacheAdminError:
            continue
        raise AssertionError(f"{kind} must raise (inconclusive → fail loudly), not return")
    print("  ✅ gateway_resolves raises loudly on auth/timeout/transport/config/other")


def test_gateway_resolves_auth_then_miss_still_raises():
    # mainnet → auth (couldn't check), preprod → clean miss. We could NOT confirm
    # mainnet, so the course is NOT provably orphaned → must fail loudly.
    nets = ["mainnet", "preprod"]
    seq = {"mainnet": "auth", "preprod": "unresolvable"}

    def gt(course_id, network):
        raise GatewayError(None, seq[network], network)

    try:
        ca.gateway_resolves(CID_A, nets, get_titles=gt)
    except ca.CacheAdminError:
        print("  ✅ gateway_resolves: an auth error anywhere → loud abort, never 'orphaned'")
        return
    raise AssertionError("auth on any network must abort, not fall through to False")


def test_gateway_resolves_no_networks_raises():
    try:
        ca.gateway_resolves(CID_A, [], get_titles=_raiser("unresolvable"))
    except ca.CacheAdminError:
        print("  ✅ gateway_resolves with no networks configured → loud abort")
        return
    raise AssertionError("empty network list must raise")


def test_baked_badges_are_protected():
    protected = ca.baked_badge_names()
    assert "_placeholder.svg" in protected
    # The repo ships real badges; at least one .svg beyond the placeholder.
    assert any(n != "_placeholder.svg" and n.endswith(".svg") for n in protected), \
        "baked badge set should include the checked-in badges/*.svg"
    print(f"  ✅ baked_badge_names protects _placeholder.svg + {len(protected)-1} baked badge(s)")


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
