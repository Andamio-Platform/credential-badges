#!/usr/bin/env python3
"""Regenerate the credential-badge SVGs from credentials.json.

Deterministic and offline — pure Python, no Chrome, no network. Reads the data
snapshot and renders one self-contained SVG per credential, named
<course_id>.<slt_hash>.svg. Each badge: light interior, a per-course palette,
two encoded rings (outer = course_id, inner = slt_hash), OB3 metadata baked in,
and fonts embedded from fonts.css.

Usage:
    python3 build.py            # write to ../badges/
    python3 build.py <outdir>   # write elsewhere (e.g. to verify reproduction)
"""
import json
import os
import sys

import gen
import colors

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "credentials.json")
DEFAULT_OUT = os.path.join(HERE, "..", "badges")


def palette_for(course_id):
    """Stable per-course palette: course_id is hex, so this is deterministic."""
    return colors.PALETTES[int(course_id[:8], 16) % len(colors.PALETTES)]


def render(rec):
    gen.COURSE_TITLE = rec["course_title"] or "Andamio"
    gen.MODULE_TITLE = rec["module_title"] or "Credential"
    gen.COURSE_ID = rec["course_id"]
    gen.SLT_HASH = rec["slt_hash"]
    gen.NETWORK = "mainnet"
    return gen.build_svg(colors.light_interior(palette_for(rec["course_id"])))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    data = json.load(open(DATA))
    for rec in data:
        svg = render(rec)
        open(os.path.join(out, f"{rec['course_id']}.{rec['slt_hash']}.svg"), "w").write(svg)
    print(f"wrote {len(data)} badges -> {os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
