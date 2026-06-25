#!/usr/bin/env python3
"""On-demand badge render service (Cloud Run).

  GET /badges/{course_id}.{slt_hash}.svg
    - GCS cache hit  -> serve the cached SVG (no gateway call)
    - cache miss      -> render via the generator render-core (U3), write the SVG
                         to the GCS cache, and serve it
  GET /healthz       -> 200 ok

Keys are network-scoped (U1 finding) and the deployed badge set spans networks,
so the service tries its configured networks in order and uses the typed
GatewayError kind to decide: 'unresolvable'/'not_found' may just be the wrong
network -> try the next; 'auth'/'timeout'/'transport'/'config' is an upstream/ops
problem -> stop. A failed read is NEVER cached (KTD-3b): only a 200 render is
put() into the cache.

The request logic (serve_badge) is a pure, dependency-injected function so it is
testable without a web framework or google-cloud-storage installed. `application`
is a stdlib WSGI wrapper that gunicorn serves in the container.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "generator"))

import render                       # noqa: E402  (generator render-core, U3)
from api_client import GatewayError  # noqa: E402

# course_id = 28 bytes (56 hex), slt_hash = 32 bytes (64 hex).
BADGE_RE = re.compile(r"^([0-9a-f]{56})\.([0-9a-f]{64})\.svg$")

# kinds that may just mean "wrong network" — worth trying the next configured net
_TRY_NEXT = {"unresolvable", "not_found", "auth"}


def _resp(status, body, ctype, cache_control="no-store"):
    if isinstance(body, str):
        body = body.encode("utf-8")
    headers = {"Content-Type": ctype,
               "Content-Length": str(len(body)),
               "Cache-Control": cache_control}
    return status, headers, body


def _svg(status, body, *, cacheable):
    # Match the static host: cached-but-not-immutable on success; no-store on error.
    cc = "public, max-age=86400" if cacheable else "no-store"
    return _resp(status, body, "image/svg+xml", cc)


def serve_badge(name, *, cache, networks, render_fn=render.render_badge, placeholder=None):
    """Resolve one badge request. Returns (status, headers, body).

    `name` is the path segment after /badges/ (e.g. "<cid>.<slt>.svg").
    `cache` has get(key)->bytes|None and put(key, bytes). `networks` is the ordered
    list of networks to try. `render_fn(course_id, slt_hash, network)->svg_str`
    defaults to the U3 render-core. `placeholder` (bytes) is served on failure when
    provided, else a short text body."""
    m = BADGE_RE.match(name)
    if not m:
        return _resp(400, "bad badge id (expected <course_id:56hex>.<slt_hash:64hex>.svg)\n",
                     "text/plain")
    course_id, slt_hash = m.group(1), m.group(2)
    key = f"{course_id}.{slt_hash}.svg"

    cached = cache.get(key)
    if cached is not None:
        return _svg(200, cached, cacheable=True)   # hit: no gateway call, no render

    errors = []
    for net in networks:
        try:
            svg = render_fn(course_id, slt_hash, net).encode("utf-8")
        except GatewayError as e:
            errors.append(e)
            if e.kind in _TRY_NEXT:
                continue           # maybe wrong network — try the next one
            break                  # transient/config — stop hammering
        cache.put(key, svg)        # only a successful render is ever cached (KTD-3b)
        return _svg(200, svg, cacheable=True)

    # Every configured network failed — do NOT cache. 404 only when every error was
    # a clean not-resolvable; anything else (auth/timeout/transport/config) is an
    # ops signal and surfaces as 502.
    only_missing = errors and all(e.kind in ("unresolvable", "not_found") for e in errors)
    status = 404 if only_missing else 502
    if placeholder is not None:
        return _svg(status, placeholder, cacheable=False)
    detail = errors[-1].kind if errors else "no-networks-configured"
    return _resp(status, f"badge unavailable ({detail})\n", "text/plain")


# --- deployment wiring (lazy: tests import serve_badge without touching these) ---

def _load_placeholder():
    path = os.path.join(REPO, "badges", "_placeholder.svg")
    try:
        return open(path, "rb").read()
    except OSError:
        return None


_DEPS = {}


def _deps():
    """Build (once) the production dependency set from env."""
    if not _DEPS:
        from cache import GCSCache
        networks = [n.strip() for n in os.environ.get("BADGE_NETWORKS", "mainnet,preprod").split(",") if n.strip()]
        _DEPS.update(cache=GCSCache(os.environ["BADGE_CACHE_BUCKET"]),
                     networks=networks,
                     placeholder=_load_placeholder())
    return _DEPS


def application(environ, start_response):
    """Stdlib WSGI entry point (served by gunicorn as `app:application`)."""
    path = environ.get("PATH_INFO", "")
    if path == "/healthz":
        status, headers, body = _resp(200, "ok\n", "text/plain")
    elif path.startswith("/badges/"):
        status, headers, body = serve_badge(path[len("/badges/"):], **_deps())
    else:
        status, headers, body = _resp(404, "not found\n", "text/plain")
    start_response(f"{status} ", list(headers.items()))
    return [body]
