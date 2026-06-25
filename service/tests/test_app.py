#!/usr/bin/env python3
"""U4 tests for serve_badge — stdlib only, render + cache injected.

Runnable directly:
    python3 service/tests/test_app.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE = os.path.dirname(HERE)
REPO = os.path.dirname(SERVICE)
sys.path.insert(0, SERVICE)
sys.path.insert(0, os.path.join(REPO, "generator"))   # app.py imports render/api_client

import app  # noqa: E402
from app import serve_badge, application  # noqa: E402
from cache import MemoryCache  # noqa: E402
from api_client import GatewayError  # noqa: E402

CID = "a" * 56
SLT = "b" * 64
NAME = f"{CID}.{SLT}.svg"
KEY = f"{CID}.{SLT}.svg"


def ok_render(record=None):
    def fn(course_id, slt_hash, network):
        if record is not None:
            record.append(network)
        return f"<svg>{course_id}.{slt_hash}@{network}</svg>"
    return fn


def raise_render(*errs):
    """Raise the given GatewayErrors in sequence across successive network tries."""
    seq = list(errs)

    def fn(course_id, slt_hash, network):
        e = seq.pop(0) if len(seq) > 1 else seq[0]
        raise e
    return fn


def boom_if_called(course_id, slt_hash, network):
    raise AssertionError("render_fn must NOT be called on a cache hit")


def h(headers):
    return {k.lower(): v for k, v in headers.items()}


def test_malformed_id_is_400():
    st, _, _ = serve_badge("not-a-badge.svg", cache=MemoryCache(), networks=["mainnet"],
                           render_fn=ok_render())
    assert st == 400, st
    print("  ✅ malformed badge id -> 400")


def test_cache_hit_serves_without_rendering():
    cache = MemoryCache()
    cache.put(KEY, b"<svg>cached</svg>")
    st, headers, body = serve_badge(NAME, cache=cache, networks=["mainnet"],
                                    render_fn=boom_if_called)
    assert st == 200 and body == b"<svg>cached</svg>"
    hd = h(headers)
    assert hd["content-type"] == "image/svg+xml"
    assert hd["cache-control"] == "public, max-age=86400"
    print("  ✅ cache hit -> 200 from cache, no gateway call, correct headers")


def test_cache_miss_renders_writes_and_serves():
    cache = MemoryCache()
    calls = []
    st, headers, body = serve_badge(NAME, cache=cache, networks=["mainnet"],
                                    render_fn=ok_render(calls))
    assert st == 200 and b"@mainnet" in body
    assert cache.get(KEY) == body, "successful render must be cached"
    assert calls == ["mainnet"]
    assert h(headers)["cache-control"] == "public, max-age=86400"
    print("  ✅ cache miss -> render, write cache, 200")


def test_tries_next_network_on_unresolvable():
    cache = MemoryCache()
    calls = []

    def fn(course_id, slt_hash, network):
        calls.append(network)
        if network == "mainnet":
            raise GatewayError(502, "unresolvable", "Failed to fetch course")
        return f"<svg>{network}</svg>"

    st, _, body = serve_badge(NAME, cache=cache, networks=["mainnet", "preprod"], render_fn=fn)
    assert st == 200 and body == b"<svg>preprod</svg>"
    assert calls == ["mainnet", "preprod"], calls
    print("  ✅ unresolvable on net1 -> tries net2 -> 200")


def test_all_unresolvable_is_404_and_not_cached():
    cache = MemoryCache()
    st, headers, _ = serve_badge(NAME, cache=cache, networks=["mainnet", "preprod"],
                                 render_fn=raise_render(GatewayError(502, "unresolvable")))
    assert st == 404, st
    assert cache.get(KEY) is None, "a failed read must NEVER be cached (KTD-3b)"
    assert h(headers)["cache-control"] == "no-store"
    print("  ✅ unresolvable on all networks -> 404, nothing cached, no-store")


def test_auth_error_is_502_and_not_cached():
    cache = MemoryCache()
    st, _, _ = serve_badge(NAME, cache=cache, networks=["preprod"],
                           render_fn=raise_render(GatewayError(401, "auth")))
    assert st == 502, st
    assert cache.get(KEY) is None
    print("  ✅ auth error -> 502 (ops signal), nothing cached")


def test_transient_error_stops_and_does_not_try_next():
    cache = MemoryCache()
    calls = []

    def fn(course_id, slt_hash, network):
        calls.append(network)
        raise GatewayError(None, "timeout", "curl timed out")

    st, _, _ = serve_badge(NAME, cache=cache, networks=["mainnet", "preprod"], render_fn=fn)
    assert st == 502 and calls == ["mainnet"], (st, calls)
    print("  ✅ transient (timeout) -> 502, stops, does not hammer next network")


def test_placeholder_served_on_failure_when_provided():
    cache = MemoryCache()
    st, headers, body = serve_badge(NAME, cache=cache, networks=["mainnet"],
                                    render_fn=raise_render(GatewayError(502, "unresolvable")),
                                    placeholder=b"<svg>placeholder</svg>")
    assert st == 404 and body == b"<svg>placeholder</svg>"
    assert h(headers)["content-type"] == "image/svg+xml"
    assert h(headers)["cache-control"] == "no-store"
    print("  ✅ placeholder body served on failure, no-store, not cached")


def test_healthz_via_wsgi():
    captured = {}

    def start_response(status, headers):
        captured["status"] = status
        captured["headers"] = headers

    body = application({"PATH_INFO": "/healthz"}, start_response)
    assert captured["status"].startswith("200")
    assert b"ok" in b"".join(body)
    print("  ✅ WSGI /healthz -> 200 ok")


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
