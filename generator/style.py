#!/usr/bin/env python3
"""Hand-set badge styles (credential-badges#157): a course's palette and an
optional partner logo, set by Andamio. The one lookup every badge path reads
(build.py, render.py, og.py, page.py), so a styled course looks the same in the
committed SVG, the on-demand render, the OG card and the embed.

A style is drawn only. It never enters a signed class artifact (those are built
from generator/credentials.json alone), so changing one is rebuild + re-bake,
never re-sign. Courses without a style keep `colors.palette_for` exactly.

Files live in styles/, keyed by course id:

    styles/<course_id>.json       the style record (below)
    styles/<course_id>.logo.svg   the logo, when the record names one

The record:

    {
      "name": "...",
      "approval": "where the partner's written approval for the logo lives",
      "base": {<every colors.BASE token>},     # the field, rings, OG card
      "interior": {<every gen.INT token>},     # the plate and its text
      "logo": {"height": 62, "dx": -12, "gap": 44}   # optional
    }

A logo may contain only <svg>, <g>, <circle> and <path>, with presentation
attributes. Never <line>: decode.py reads ring ticks as <line> elements, so a
logo line could corrupt the decoded on-chain hashes. Nothing that loads or runs
anything (no href, style, script or event attribute) is accepted, because badge
SVGs are opened directly in browsers.

    python3 style.py --check     validate styles/ on its own
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

import colors
import gen

STYLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "styles")

_NAME_RE = re.compile(r"^([0-9a-f]{56})\.json$")
_LOGO_RE = re.compile(r"^([0-9a-f]{56})\.logo\.svg$")
_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_SVG_NS = "{http://www.w3.org/2000/svg}"
_LOGO_TAGS = {"svg", "g", "circle", "path"}
_LOGO_ATTRS = {
    "svg": {"viewBox"},
    "g": {"fill", "fill-rule"},
    "circle": {"cx", "cy", "r", "fill"},
    "path": {"d", "fill", "fill-rule"},
}
_NUM_RE = re.compile(r"^-?[0-9]+(\.[0-9]+)?$")
_PATH_RE = re.compile(r"^[MLCZmlcz0-9 .,-]+$")
LOGO_MAX_BYTES = 32 * 1024
LOGO_KEYS = {"height", "dx", "gap"}


class StyleError(Exception):
    pass


def _check_palette(where, pal, tokens):
    problems = []
    missing = [t for t in tokens if t not in pal]
    extra = [t for t in pal if t not in tokens]
    if missing:
        problems.append(f"{where}: missing tokens {missing}")
    if extra:
        problems.append(f"{where}: unknown tokens {extra}")
    for k, v in pal.items():
        if k in tokens and not (isinstance(v, str) and _HEX_RE.match(v)):
            problems.append(f"{where}.{k}: {v!r} is not a #RRGGBB colour")
    return problems


def check_logo(data):
    """Validate a logo SVG and return (viewbox_w, viewbox_h, inner_markup).
    Raises StyleError listing every problem."""
    if len(data) > LOGO_MAX_BYTES:
        raise StyleError(f"logo is {len(data)} bytes, over {LOGO_MAX_BYTES}")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise StyleError(f"logo is not well-formed XML: {e}")
    problems = []
    if root.tag != _SVG_NS + "svg":
        problems.append(f"root is {root.tag}, not an SVG <svg>")
    for el in root.iter():
        tag = el.tag[len(_SVG_NS):] if el.tag.startswith(_SVG_NS) else el.tag
        if tag not in _LOGO_TAGS:
            problems.append(f"<{tag}> is not allowed in a logo (only {sorted(_LOGO_TAGS)})")
            continue
        if (el.text or "").strip() or (el.tail or "").strip():
            problems.append(f"<{tag}> carries text; a logo is shapes only")
        for a, v in el.attrib.items():
            if a not in _LOGO_ATTRS[tag]:
                problems.append(f"<{tag}> attribute {a!r} is not allowed")
            elif a in ("fill",) and not _HEX_RE.match(v):
                problems.append(f"<{tag}> fill {v!r} is not a #RRGGBB colour")
            elif a == "fill-rule" and v not in ("evenodd", "nonzero"):
                problems.append(f"<{tag}> fill-rule {v!r}")
            elif a in ("cx", "cy", "r") and not _NUM_RE.match(v):
                problems.append(f"<{tag}> {a}={v!r} is not a number")
            elif a == "d" and not _PATH_RE.match(v):
                problems.append(f"<path> d uses commands outside M L C Z")
    vb = (root.get("viewBox") or "").split()
    if len(vb) != 4 or not all(_NUM_RE.match(x) for x in vb) or vb[:2] != ["0", "0"]:
        problems.append(f"viewBox {root.get('viewBox')!r} must be '0 0 <w> <h>'")
    if problems:
        raise StyleError("; ".join(problems))
    inner = "".join(ET.tostring(c, encoding="unicode") for c in root)
    # ElementTree re-serializes with an ns0: prefix; the logo is inlined into an
    # SVG that already declares the SVG namespace as default, so drop it.
    inner = inner.replace("ns0:", "").replace(' xmlns:ns0="http://www.w3.org/2000/svg"', "")
    return float(vb[2]), float(vb[3]), inner


class Styles:
    def __init__(self, records):
        self._records = records

    def __len__(self):
        return len(self._records)

    def keys(self):
        return sorted(self._records)

    def base_palette(self, course_id):
        """Field/ring palette: the OG card's background and the page chrome."""
        rec = self._records.get(course_id)
        if rec is None:
            return colors.palette_for(course_id)
        return dict(rec["base"], name=rec["name"])

    def badge_palette(self, course_id):
        """The full palette a badge renders with."""
        rec = self._records.get(course_id)
        if rec is None:
            return colors.light_interior(colors.palette_for(course_id))
        return dict(rec["base"], **rec["interior"], name=rec["name"])

    def logo_for(self, course_id):
        rec = self._records.get(course_id)
        return None if rec is None else rec.get("logo")

    def render_kwargs(self, course_id):
        """The style half of gen.render_svg's keyword arguments."""
        kw = {"pal": self.badge_palette(course_id)}
        logo = self.logo_for(course_id)
        if logo is not None:
            kw["logo"] = logo
        return kw


NO_STYLES = Styles({})

_COMMITTED = None


def committed():
    """The validated styles/ directory, loaded once. Raises StyleError on a bad
    style rather than falling back, so a broken style can never ship as an
    unstyled badge without anyone noticing."""
    global _COMMITTED
    if _COMMITTED is None:
        _COMMITTED = load()
    return _COMMITTED


def load(style_dir=STYLE_DIR):
    """Load and validate every style. Raises StyleError listing every problem."""
    if not os.path.isdir(style_dir):
        return NO_STYLES
    names = sorted(os.listdir(style_dir))
    problems, records = [], {}
    logos = {m.group(1) for m in map(_LOGO_RE.match, names) if m}
    for name in names:
        if name.startswith("."):
            continue
        m = _NAME_RE.match(name)
        if not m:
            if not _LOGO_RE.match(name):
                problems.append(f"{name}: not <course_id>.json or <course_id>.logo.svg")
            continue
        cid = m.group(1)
        try:
            rec = json.load(open(os.path.join(style_dir, name), encoding="utf-8"))
        except ValueError as e:
            problems.append(f"{name}: not JSON ({e})")
            continue
        known = {"name", "approval", "base", "interior", "logo"}
        if set(rec) - known:
            problems.append(f"{name}: unknown keys {sorted(set(rec) - known)}")
        if not (isinstance(rec.get("name"), str) and rec["name"].strip()):
            problems.append(f"{name}: needs a name")
        problems += _check_palette(f"{name} base", rec.get("base") or {}, gen.BASE)
        problems += _check_palette(f"{name} interior", rec.get("interior") or {}, gen.INT)
        out = {"name": rec.get("name"), "base": rec.get("base"), "interior": rec.get("interior")}
        if "logo" in rec:
            spec = rec["logo"] or {}
            if not (isinstance(rec.get("approval"), str) and rec["approval"].strip()):
                problems.append(f"{name}: a logo needs 'approval' saying where the partner's written approval lives")
            if set(spec) != LOGO_KEYS or not all(isinstance(spec[k], (int, float)) for k in spec):
                problems.append(f"{name}: logo needs exactly numeric {sorted(LOGO_KEYS)}")
            elif not (24 <= spec["height"] <= 120 and -40 <= spec["dx"] <= 40 and 16 <= spec["gap"] <= 96):
                problems.append(f"{name}: logo height/dx/gap out of range")
            if cid not in logos:
                problems.append(f"{name}: names a logo but {cid}.logo.svg is missing")
            else:
                try:
                    vw, vh, inner = check_logo(open(os.path.join(style_dir, f"{cid}.logo.svg"), "rb").read())
                    out["logo"] = dict(spec, vw=vw, vh=vh, markup=inner)
                except StyleError as e:
                    problems.append(f"{cid}.logo.svg: {e}")
        records[cid] = out
    for cid in logos - set(records):
        problems.append(f"{cid}.logo.svg: no {cid}.json names it")
    if problems:
        raise StyleError("bad badge style(s):\n  " + "\n  ".join(problems))
    return Styles(records)


if __name__ == "__main__":
    if sys.argv[1:] != ["--check"]:
        sys.exit("usage: style.py --check")
    try:
        s = load()
    except StyleError as e:
        sys.exit(f"❌ {e}")
    for cid in s.keys():
        print(f"  {cid}: {'logo' if s.logo_for(cid) else 'palette only'}")
    print(f"✅ {len(s)} style(s) valid")
