#!/usr/bin/env python3
"""Alias safety gate — the single decision point for whether an on-chain alias
may be baked into an artifact or routed at a URL.

Why this exists (plan KTD-5): baking writes aliases into SVG, a format browsers
execute, and aliases are untrusted chain data. The live holder set observed on
2026-07-28 contains an alias that is literally an XSS payload
(``'"name123'' onload='alert()'``) and another containing a space
(``Tevo Saks``); both also break their own upstream state lookup. So the policy
is an allowlist — refusal is the default and the charset is the exception —
rather than escaping correctly at every render and path-construction site
forever.

The charset is NOT invented here. It is the one already enforced in production
by ``issuer-service/src/server.ts`` (``ALIAS_RE = /^[A-Za-z0-9_-]{1,64}$/``,
applied before any chain call) and matched by the nginx holder-viewer route. A
stricter gate here would skip holders the issuer will happily sign for; a looser
one would bake artifacts at URLs nginx returns 404 for.
``scripts/tests/test_alias_gate.py`` asserts the two stay in agreement.

Stdlib only — this is imported by build-time tooling and the sweep.
"""
import re

__all__ = [
    "MAX_ALIAS_LEN", "SAFE_ALIAS_RE", "UnsafeAlias",
    "REFUSAL_EMPTY", "REFUSAL_TOO_LONG", "REFUSAL_CHARSET", "REFUSAL_NOT_A_STRING",
    "alias_refusal", "is_safe_alias", "partition_aliases",
    "format_skip_report", "holder_cache_key",
]

MAX_ALIAS_LEN = 64

#: Mirrors issuer-service/src/server.ts ALIAS_RE. Keep in lockstep.
SAFE_ALIAS_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# Distinct reasons so a human triaging the skip report can tell "this alias has
# a character we refuse" from "this alias is too long" without re-running.
REFUSAL_NOT_A_STRING = "not-a-string"
REFUSAL_EMPTY = "empty"
REFUSAL_TOO_LONG = "too-long"
REFUSAL_CHARSET = "unsupported-characters"


class UnsafeAlias(ValueError):
    """Raised when an unsafe alias reaches a construction site.

    Carries the refusal reason so callers can report it without re-deriving.
    """

    def __init__(self, alias, reason):
        super().__init__(f"refused alias ({reason}): {alias!r}")
        self.alias = alias
        self.reason = reason


def alias_refusal(alias):
    """Return None when the alias is safe, else a stable reason constant.

    Order matters: the most specific diagnosis wins, so an empty string reports
    ``empty`` rather than the generic charset refusal.
    """
    if not isinstance(alias, str):
        return REFUSAL_NOT_A_STRING
    if not alias.strip():
        return REFUSAL_EMPTY
    if len(alias) > MAX_ALIAS_LEN:
        return REFUSAL_TOO_LONG
    if not SAFE_ALIAS_RE.match(alias):
        return REFUSAL_CHARSET
    return None


def is_safe_alias(alias):
    """True when the alias may be baked into an artifact and routed at a URL."""
    return alias_refusal(alias) is None


def partition_aliases(aliases):
    """Split an iterable into ``(safe, [(alias, reason), ...])``, order preserved."""
    safe, refused = [], []
    for a in aliases:
        reason = alias_refusal(a)
        if reason is None:
            safe.append(a)
        else:
            refused.append((a, reason))
    return safe, refused


def format_skip_report(refusals):
    """Human-actionable report of everything the gate refused.

    Aliases are rendered with ``repr`` so a hostile value cannot smuggle control
    characters or quote-breaks into the report a human or a log reads.
    """
    if not refusals:
        return "alias gate: 0 skipped — every alias in the set is safe."
    lines = [f"alias gate: {len(refusals)} skipped"]
    for alias, reason in refusals:
        lines.append(f"  - {reason}: {alias!r}")
    return "\n".join(lines)


def holder_cache_key(stem, alias, key_version):
    """Cache key for one holder artifact: ``{stem}.{alias}.{keyVersion}.svg``.

    The gate runs here, before any concatenation, so an unsafe alias can never
    reach a key, a filename, or a URL (plan KTD-8). The key version participates
    so a signing-key rotation naturally invalidates rather than serving
    artifacts signed under a retired key.
    """
    reason = alias_refusal(alias)
    if reason is not None:
        raise UnsafeAlias(alias, reason)
    return f"{stem}.{alias}.{key_version}.svg"
