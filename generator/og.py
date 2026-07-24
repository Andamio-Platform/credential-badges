#!/usr/bin/env python3
"""Compose the 1200x630 Open Graph card SVG per credential (#69, v1.2 Track A).

A social unfurl (Slack/X/LinkedIn/Discord) wants a raster og:image at a fixed
1200x630. This authors the card as a self-contained SVG — the badge art on the
left, the credential title + issuer wordmark on a brand background on the right
— reusing the badge palette (colors.palette_for) and the embedded fonts
(gen.FONT_FACE) so palette and font stay single-sourced and deterministic. The
Node imaging/ layer rasterizes these to badges/{stem}.og.png.

Colors are authored as LITERAL palette values here (no CSS var(), unlike the
badge itself) so the card is renderer-agnostic; the nested badge keeps its
var(--token, fallback) form and is inlined by imaging/rasterize.ts at raster
time. Titles are sanitized into the embedded glyph subset (render.sanitize_title).

Usage:
    python3 og.py <outdir>   # write {course_id}.{slt_hash}.og.svg per non-skipped record
"""
import json
import os
import sys

import gen
import colors
from render import sanitize_title
from build import SKIP_COURSES

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "credentials.json")

W, H = 1200, 630
PAD = 72
BADGE_BOX = 486                     # rendered badge edge (px) on the card
BADGE_X = PAD                       # left inset
BADGE_Y = (H - BADGE_BOX) // 2      # vertically centered
COL_X = BADGE_X + BADGE_BOX + 64    # right text column start
COL_W = W - COL_X - PAD             # right column width


def _card_svg(rec):
    course_title = sanitize_title(rec["course_title"]) or "Andamio"
    module_title = sanitize_title(rec["module_title"]) or "Credential"
    course_id, slt_hash = rec["course_id"], rec["slt_hash"]

    pal = colors.palette_for(course_id)                 # base (dark field) palette
    badge = gen.render_svg(
        course_title=course_title, module_title=module_title,
        course_id=course_id, slt_hash=slt_hash, network="mainnet",
        pal=colors.light_interior(pal))

    deep, ink, raised = pal["deep"], pal["ink"], pal["raised"]
    prim, bone, slate, hair = pal["prim"], pal["bone"], pal["slate"], pal["hair"]

    def esc(s):
        return gen.esc(s)

    # Right column: eyebrow (course) -> hero (module title, wrapped) -> wordmark.
    clines, csz = gen.lay_title(course_title, 30, COL_W, 0.54, 22)
    mlines, msz = gen.lay_title(module_title, 56, COL_W, 0.58, 34)

    p = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" '
             f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
             f'aria-label="Andamio credential — {esc(module_title)} ({esc(course_title)})">')
    p.append('<defs>'
             '<style>' + gen.FONT_FACE +
             '.sans{font-family:"Archivo",sans-serif;}'
             '.mono{font-family:"Spline Sans Mono",monospace;}</style>'
             f'<radialGradient id="ogfield" cx="32%" cy="38%" r="90%">'
             f'<stop offset="0%" stop-color="{raised}"/>'
             f'<stop offset="66%" stop-color="{ink}"/>'
             f'<stop offset="100%" stop-color="{deep}"/></radialGradient>'
             '</defs>')
    # Brand background + a thin accent hairline down the column gutter.
    p.append(f'<rect width="{W}" height="{H}" fill="url(#ogfield)"/>')
    p.append(f'<rect width="{W}" height="{H}" fill="none" stroke="{hair}" '
             f'stroke-width="2"/>')

    # Nested badge art on the left, scaled to fit BADGE_BOX.
    scale = BADGE_BOX / 1024.0
    p.append(f'<g transform="translate({BADGE_X},{BADGE_Y}) scale({scale:.5f})">')
    p.append(badge)
    p.append('</g>')

    # Right text column, vertically centered as one block.
    line_h_c = int(csz * 1.18)
    line_h_m = int(msz * 1.12)
    block_h = (line_h_c + 18) + len(mlines) * line_h_m + 30 + 26
    y = (H - block_h) // 2 + csz

    p.append(f'<text class="mono" x="{COL_X}" y="{y}" font-size="14" '
             f'letter-spacing="4" fill="{slate}">CREDENTIAL</text>')
    y += 30
    for ln in clines:
        p.append(f'<text class="sans" x="{COL_X}" y="{y}" font-size="{csz}" '
                 f'font-weight="600" fill="{bone}">{esc(ln)}</text>')
        y += line_h_c
    y += 20
    for ln in mlines:
        p.append(f'<text class="sans" x="{COL_X}" y="{y}" font-size="{msz}" '
                 f'font-weight="800" fill="{prim}">{esc(ln)}</text>')
        y += line_h_m
    y += 24
    p.append(f'<text class="sans" x="{COL_X}" y="{H - PAD}" font-size="20" '
             f'font-weight="600" letter-spacing="6" fill="{bone}" '
             f'opacity="0.85">ANDAMIO</text>')

    p.append('</svg>')
    return "".join(p)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: og.py <outdir>")
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    data = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    for rec in data:
        svg = _card_svg(rec)
        open(os.path.join(out, f"{rec['course_id']}.{rec['slt_hash']}.og.svg"),
             "w").write(svg)
    print(f"wrote {len(data)} OG composition SVGs -> {out}/")


if __name__ == "__main__":
    main()
