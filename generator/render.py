#!/usr/bin/env python3
"""Render-core: course_id + slt_hash -> on-demand badge SVG.

Collapses the offline fetch/build split into one request-time call: read the
titles (api_client, network-scoped key), apply the KTD-6 fallback chain and
font-subset sanitization, pick the per-course palette, and render via
gen.render_svg (U2). Deterministic given the title inputs.

A failed title read raises GatewayError (KTD-3b) — render_badge never invents a
blank badge; the service layer (U4) decides placeholder-vs-error and must not
cache the failure.
"""
import re
import unicodedata

import gen
import colors
import api_client
from fetch import clean_title   # hex(ascii) chain-title decode — reused, not reinvented

# The exact glyph set embed_fonts.py subsets into fonts.css. A title character
# outside this set renders as a missing-glyph box, so sanitize_title maps every
# title into it before rendering.
SAFE = set(chr(c) for c in range(0x20, 0x7F)) | set("‘’“”·•–—…")

# Transliterations for glyphs the subset lacks but course titles plausibly carry.
# (Accents are handled generically by NFKD below; these are symbols NFKD leaves.)
_TRANSLIT = {
    "×": "x", "÷": "/", "→": "->", "←": "<-", "↔": "<->",
    "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "™": "(tm)", "®": "(r)",
    "©": "(c)", "€": "EUR", "£": "GBP", "°": "deg", "±": "+/-", " ": " ",
}


def sanitize_title(s):
    """Map an arbitrary title into the embedded font subset so it always renders.
    Accents are stripped via NFKD (é -> e); known symbols are transliterated;
    anything still outside the subset is dropped; runs of whitespace collapse."""
    if not s:
        return s
    s = "".join(_TRANSLIT.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))  # drop accents
    s = "".join(ch if ch in SAFE else "" for ch in s)            # drop the rest
    return re.sub(r"\s{2,}", " ", s).strip()


def _module_title(rec):
    """KTD-6 fallback chain for a module title:
    DB content.title -> first on_chain_slt (hex-decoded if needed) -> generic.
    `rec` is a module dict from api_client.get_titles, or None when the slt_hash
    isn't in the course's module set."""
    if rec and rec.get("title"):
        return rec["title"]
    for s in (rec or {}).get("on_chain_slts", []):
        t = clean_title(s)
        if t:
            return t
    return "Credential"


def render_badge(course_id, slt_hash, network="mainnet", *, fetch_titles=None):
    """Render the badge SVG for one credential. `fetch_titles` is an injection
    seam (defaults to api_client.get_titles) taking (course_id, network) and
    returning (course_title, modules). GatewayError from the read propagates."""
    fetch = fetch_titles or api_client.get_titles
    course_title, modules = fetch(course_id, network)

    ct = sanitize_title(course_title) or "Andamio"
    mt = sanitize_title(_module_title(modules.get(slt_hash))) or "Credential"
    pal = colors.light_interior(colors.palette_for(course_id))
    return gen.render_svg(course_title=ct, module_title=mt,
                          course_id=course_id, slt_hash=slt_hash,
                          network=network, pal=pal)


if __name__ == "__main__":
    import sys
    cid, slt = sys.argv[1], sys.argv[2]
    net = sys.argv[3] if len(sys.argv) > 3 else "mainnet"
    sys.stdout.write(render_badge(cid, slt, net))
