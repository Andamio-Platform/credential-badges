#!/usr/bin/env python3
"""Regenerate the credential-badge SVGs from credentials.json.

Deterministic and offline — pure Python, no Chrome, no network. Reads the data
snapshot and renders one self-contained SVG per credential, named
<course_id>.<slt_hash>.svg. Each badge: light interior, a per-course palette,
two encoded rings (outer = course_id, inner = slt_hash), OB3 metadata baked in,
and fonts embedded from fonts.css.

Badge art (#131) comes from generator/art/ via art.py, validated as a whole
before the first write so a bad file can never leave the output half rewritten.

Usage:
    python3 build.py            # write to ../badges/
    python3 build.py <outdir>   # write elsewhere (e.g. to verify reproduction)
    python3 build.py <outdir> --only <badge_id> [--only <badge_id> ...]
                                # scratch-build just those stems (the safe way to
                                # refresh one signed badge: docs/runbooks/badge-art.md)
    python3 build.py <outdir> --art-dir <dir>
                                # art from <dir> instead of generator/art/ (tests,
                                # make verify). A flag, never an environment variable,
                                # so a placeholder can't leak into a production build.
"""
import argparse
import json
import os
import sys

import gen
import colors
import art

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


def render(rec, badge_art=art.NO_ART):
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
        image=badge_art.image_for(rec["course_id"], rec["slt_hash"]),
    )


def main():
    ap = argparse.ArgumentParser(description="Regenerate credential-badge SVGs.")
    ap.add_argument("out", nargs="?", default=DEFAULT_OUT)
    ap.add_argument("--only", action="append", metavar="BADGE_ID",
                    help="build only this <course_id>.<slt_hash> (repeatable)")
    ap.add_argument("--art-dir", default=art.ART_DIR)
    args = ap.parse_args()
    out = args.out

    try:
        badge_art = art.load(args.art_dir, skip_courses=SKIP_COURSES)  # whole dir, before any write
    except art.ArtError as e:
        sys.exit(f"❌ {e}")
    data = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    if args.only:
        wanted = set(args.only)
        data = [r for r in data if f"{r['course_id']}.{r['slt_hash']}" in wanted]
        missing = wanted - {f"{r['course_id']}.{r['slt_hash']}" for r in data}
        if missing:
            sys.exit(f"❌ --only: not a built credential in credentials.json: {sorted(missing)}")
    os.makedirs(out, exist_ok=True)
    for rec in data:
        svg = render(rec, badge_art)
        open(os.path.join(out, f"{rec['course_id']}.{rec['slt_hash']}.svg"), "w").write(svg)
    print(f"wrote {len(data)} badges -> {os.path.relpath(out, HERE)}/")

    # Self-pruning (#31): the additive write above never removes art for records
    # dropped from credentials.json. Reconcile the output tree against the
    # registry so a dropped credential's artifacts (svg + the v1.2 png/og.png)
    # cannot linger on the forever-public host. Imported lazily to avoid a
    # circular import (reconcile imports SKIP_COURSES from this module).
    import reconcile
    pruned = reconcile.reconcile(out, delete=True)
    if pruned:
        print(f"pruned {len(pruned)} orphan artifact(s) with no credentials.json record")


if __name__ == "__main__":
    main()
