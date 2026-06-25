#!/usr/bin/env python3
"""andamio-api client — non-interactive, network-scoped X-API-Key title reads.

The on-demand render service reads course + per-module titles at request time
(what fetch.py does offline via the interactive CLI, done here with a service
key). Two read-only endpoints (KTD-3):

  GET /api/v2/course/user/course/get/{course_id}  -> data.content.title
  GET /api/v2/course/user/modules/{course_id}     -> data[].content.title,
                                                     data[].slt_hash,
                                                     data[].on_chain_slts,
                                                     data[].source

Keys are NETWORK-SCOPED (U1 gate finding): a mainnet key returns 401 on the
preprod gateway. The key is resolved from the environment
(ANDAMIO_{NETWORK}_API_KEY), falling back to .env.local for local dev. HTTP goes
through curl — matching fetch.py — to avoid the macOS stdlib-SSL cert gap and
stay dependency-free. (The render container must therefore ship curl; see U4.)

Any non-200 raises GatewayError so a failed read never silently produces a blank
badge (KTD-3b); the caller decides placeholder-vs-error and must not cache it.
"""
import json
import os
import subprocess

GATEWAYS = {
    "preprod": "https://preprod.api.andamio.io",
    "mainnet": "https://api.andamio.io",
    "dev": "https://dev.api.andamio.io",
}

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


class GatewayError(Exception):
    """A non-200 (or transport failure) from andamio-api. `kind` classifies it so
    callers can apply KTD-3b: 'unresolvable' (502/503/504 — wrong network or
    upstream down), 'auth' (401/403 — wrong-network or invalid key), 'not_found'
    (404), 'timeout', 'transport', or 'config'."""
    def __init__(self, status, kind, message=""):
        super().__init__(f"andamio-api {status} ({kind}): {message}")
        self.status = status
        self.kind = kind


def _classify(status):
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    if status in (502, 503, 504):
        return "unresolvable"  # gateway can't resolve the course / upstream down
    return "other"


def load_env_local(path=None):
    """Tiny stdlib .env loader (KEY=VALUE lines). Values are never logged."""
    path = path or os.path.join(REPO, ".env.local")
    out = {}
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def api_key(network):
    """Network-scoped key from env, falling back to .env.local. Returns None if
    unset (callers raise a config GatewayError)."""
    name = f"ANDAMIO_{network.upper()}_API_KEY"
    return os.environ.get(name) or load_env_local().get(name)


def _curl(url, key, timeout=30):
    """Default transport. Returns (status_code, body_text). Raises GatewayError on
    curl-level failure (timeout, DNS, TLS)."""
    p = subprocess.run(
        ["curl", "-s", "-m", str(timeout), "-w", "\n__HTTP__%{http_code}",
         "-H", f"X-API-Key: {key}", url],
        capture_output=True, text=True)
    if p.returncode != 0:
        kind = "timeout" if p.returncode == 28 else "transport"
        raise GatewayError(None, kind, p.stderr.strip() or f"curl exit {p.returncode}")
    out = p.stdout
    code = 0
    if "__HTTP__" in out:
        out, raw = out.rsplit("__HTTP__", 1)
        code = int(raw.strip() or 0)
    return code, out


def _get_json(network, path, *, transport=None, key=None):
    base = GATEWAYS.get(network)
    if not base:
        raise GatewayError(None, "config", f"unknown network {network!r}")
    key = key or api_key(network)
    if not key:
        raise GatewayError(None, "config",
                           f"no API key for {network} (set ANDAMIO_{network.upper()}_API_KEY)")
    status, body = (transport or _curl)(base + path, key)
    if status != 200:
        raise GatewayError(status, _classify(status), (body or "").strip()[:160])
    try:
        return json.loads(body)
    except ValueError as e:
        raise GatewayError(status, "transport", f"non-JSON body: {e}")


def get_titles(course_id, network, *, transport=None, key=None):
    """Read course + per-module titles for `course_id` on `network`.

    Returns (course_title, modules) where modules maps slt_hash -> dict with keys
    slt_hash, title, on_chain_slts, source. Raises GatewayError on any non-200.
    `transport`/`key` are injection seams for tests."""
    cg = _get_json(network, f"/api/v2/course/user/course/get/{course_id}",
                   transport=transport, key=key)
    course_title = ((cg.get("data") or {}).get("content") or {}).get("title") or ""

    md = _get_json(network, f"/api/v2/course/user/modules/{course_id}",
                   transport=transport, key=key)
    modules = {}
    for m in (md.get("data") or []):
        slt = m.get("slt_hash")
        if not slt:
            continue
        modules[slt] = {
            "slt_hash": slt,
            "title": ((m.get("content") or {}).get("title") or ""),
            "on_chain_slts": m.get("on_chain_slts") or [],
            "source": m.get("source") or "",
        }
    return course_title, modules
