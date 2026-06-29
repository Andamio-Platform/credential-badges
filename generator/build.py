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

# Courses to skip for now (kept in credentials.json). FCB Fan Engagement is done
# last with a custom Barça palette; remove from this set when that lands.
SKIP_COURSES = {"5977af642f25cf2872f3938030df03495031783edbaeec62d79ea6dc"}


# Per-course palette selection now lives in colors.py so the on-demand render
# service (render.py) shares the exact same mapping. Re-exported here for
# back-compat with existing callers/tests that reference build.palette_for.
palette_for = colors.palette_for


def render(rec):
    # Concurrency-safe: pass inputs as parameters instead of mutating gen's
    # module globals, so the render path is reusable per-request (the on-demand
    # service reuses gen.render_svg + palette_for the same way).
    return gen.render_svg(
        course_title=rec["course_title"] or "Andamio",
        module_title=rec["module_title"] or "Credential",
        course_id=rec["course_id"],
        slt_hash=rec["slt_hash"],
        network="mainnet",
        pal=colors.light_interior(palette_for(rec["course_id"])),
    )


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    data = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    for rec in data:
        svg = render(rec)
        open(os.path.join(out, f"{rec['course_id']}.{rec['slt_hash']}.svg"), "w").write(svg)
    print(f"wrote {len(data)} badges -> {os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
