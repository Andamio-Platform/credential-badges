#!/usr/bin/env python3
"""U3 tests for api_client — offline, via an injected fake transport (no network).

Runnable directly (no test framework in this repo):
    python3 generator/tests/test_api_client.py
"""
import json
import os
import sys
import tempfile
from urllib.parse import urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import api_client  # noqa: E402
from api_client import GatewayError, get_titles  # noqa: E402

COURSE_OK = {"data": {"course_id": "abc", "content": {"title": "Andamio for Developers"},
                      "source": "merged"}}
MODULES_OK = {"data": [
    {"slt_hash": "a891", "content": {"title": "Run the App Template"},
     "on_chain_slts": ["I can clone and run the app."], "source": "merged"},
    {"slt_hash": "b60b", "content": {"title": ""},
     "on_chain_slts": ["I can obtain an Andamio API key."], "source": "chain_only"},
    {"slt_hash": None, "content": {"title": "no hash — skipped"}},
]}


def fake(course_body, modules_body, status=200, calls=None):
    """Build a transport returning canned JSON, routed by path. Records URLs."""
    def transport(url, key):
        if calls is not None:
            calls.append(url)
        body = course_body if "/course/get/" in url else modules_body
        return status, json.dumps(body) if isinstance(body, (dict, list)) else body
    return transport


def test_parses_course_and_module_titles():
    calls = []
    ct, mods = get_titles("abc", "preprod", transport=fake(COURSE_OK, MODULES_OK, calls=calls), key="k")
    assert ct == "Andamio for Developers"
    assert set(mods) == {"a891", "b60b"}, "module without slt_hash must be skipped"
    assert mods["a891"]["title"] == "Run the App Template"
    assert mods["b60b"]["source"] == "chain_only"
    assert mods["b60b"]["on_chain_slts"] == ["I can obtain an Andamio API key."]
    print("  ✅ parses course title + module title/slt_hash/on_chain_slts/source")


def test_selects_correct_gateway_per_network():
    calls = []
    get_titles("abc", "preprod", transport=fake(COURSE_OK, MODULES_OK, calls=calls), key="k")
    assert all(urlsplit(u).netloc == "preprod.api.andamio.io" for u in calls), calls
    calls.clear()
    get_titles("abc", "mainnet", transport=fake(COURSE_OK, MODULES_OK, calls=calls), key="k")
    assert all(urlsplit(u).netloc == "api.andamio.io" for u in calls), calls
    print("  ✅ network selects the matching gateway base URL")


def test_502_maps_to_unresolvable():
    try:
        get_titles("abc", "mainnet", transport=fake("BAD_GATEWAY", "BAD_GATEWAY", status=502), key="k")
        assert False, "expected GatewayError"
    except GatewayError as e:
        assert e.status == 502 and e.kind == "unresolvable", (e.status, e.kind)
    print("  ✅ 502 -> GatewayError(kind=unresolvable)")


def test_401_maps_to_auth():
    try:
        get_titles("abc", "preprod", transport=fake("Unauthorized", "Unauthorized", status=401), key="wrong")
        assert False, "expected GatewayError"
    except GatewayError as e:
        assert e.status == 401 and e.kind == "auth", (e.status, e.kind)
    print("  ✅ 401 -> GatewayError(kind=auth) (wrong-network/invalid key)")


def test_unknown_network_is_config_error():
    try:
        get_titles("abc", "testnet", transport=fake(COURSE_OK, MODULES_OK), key="k")
        assert False, "expected GatewayError"
    except GatewayError as e:
        assert e.kind == "config", e.kind
    print("  ✅ unknown network -> GatewayError(kind=config)")


def test_missing_key_is_config_error():
    """With no key in env and an empty .env.local, a real read is a config error
    (no silent unauthenticated call)."""
    empty = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
    empty.close()
    orig = api_client.load_env_local
    api_client.load_env_local = lambda path=None: {}
    saved = os.environ.pop("ANDAMIO_PREPROD_API_KEY", None)
    try:
        get_titles("abc", "preprod", transport=fake(COURSE_OK, MODULES_OK))
        assert False, "expected GatewayError"
    except GatewayError as e:
        assert e.kind == "config", e.kind
    finally:
        api_client.load_env_local = orig
        if saved is not None:
            os.environ["ANDAMIO_PREPROD_API_KEY"] = saved
        os.unlink(empty.name)
    print("  ✅ missing key -> GatewayError(kind=config), no unauthenticated call")


def test_non_json_body_is_transport_error():
    try:
        get_titles("abc", "mainnet", transport=fake("<html>500</html>", "<html>", status=200), key="k")
        assert False, "expected GatewayError"
    except GatewayError as e:
        assert e.kind == "transport", e.kind
    print("  ✅ 200 with non-JSON body -> GatewayError(kind=transport)")


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
