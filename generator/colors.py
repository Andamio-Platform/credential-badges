#!/usr/bin/env python3
"""10 color identities for the LOCKED Proof Rings badge. Structure unchanged —
only the palette dict varies. Each is a deliberate, coherent scheme (dark field,
two distinct ring hues, legible text) — not random. Renders into colors/."""
import os
from gen import build_svg, wrap, CHECKER

# deep=outer field · ink=mid · raised=inner · prim=outer ring · sec=inner ring
PALETTES = [
 dict(slug="01-andamio-navy",   name="Andamio Navy",   deep="#0C1325", ink="#121A2D", raised="#1B2540",
      prim="#EE6C3A", prim_lt="#F6A07A", sec="#5BB8D4", sec_lt="#9ED8E8", bone="#EAE6DD", slate="#6E7A98", hair="#2C3858"),
 dict(slug="02-cardano-blue",   name="Cardano Blue",   deep="#091022", ink="#0F1A33", raised="#172742",
      prim="#3B82F0", prim_lt="#86B4F7", sec="#33D6C4", sec_lt="#8FE9DF", bone="#E9EDF5", slate="#6E7E9C", hair="#26324E"),
 dict(slug="03-indigo-violet",  name="Indigo Violet",  deep="#0E0A1F", ink="#15112B", raised="#201A3C",
      prim="#8B6CF0", prim_lt="#B9A6F7", sec="#E86CA8", sec_lt="#F2A6CC", bone="#ECE7F2", slate="#7A7196", hair="#2E2A4A"),
 dict(slug="04-pine-gold",      name="Pine Gold",      deep="#08140F", ink="#0E1E18", raised="#163026",
      prim="#E9B23C", prim_lt="#F3CE80", sec="#46D6A0", sec_lt="#92E8C6", bone="#E7EDE6", slate="#6E8478", hair="#244236"),
 dict(slug="05-wine-crimson",   name="Wine Crimson",   deep="#170A12", ink="#22101B", raised="#341A29",
      prim="#F0524D", prim_lt="#F59390", sec="#F2A0B5", sec_lt="#F7C4D2", bone="#F2E7EA", slate="#9A7E86", hair="#3A2230"),
 dict(slug="06-mono-ember",     name="Mono Ember",     deep="#0C1020", ink="#121826", raised="#1B2334",
      prim="#EE6C3A", prim_lt="#F6A07A", sec="#F0A24A", sec_lt="#F7C98A", bone="#EAE6DD", slate="#7A8092", hair="#2C3344"),
 dict(slug="07-teal-ice",       name="Teal Ice",       deep="#08151C", ink="#0E2029", raised="#163039",
      prim="#5FD0E8", prim_lt="#A6E6F2", sec="#7FA8C8", sec_lt="#B4CBE0", bone="#E6EEF0", slate="#6E8490", hair="#23404A"),
 dict(slug="08-plum-sunset",    name="Plum Sunset",    deep="#14091C", ink="#1E1029", raised="#2E1A3C",
      prim="#F58A3C", prim_lt="#F8B580", sec="#C56CE0", sec_lt="#DEA6EE", bone="#F0E8F2", slate="#86749A", hair="#3A2A4A"),
 dict(slug="09-onyx-emerald",   name="Onyx Emerald",   deep="#0A0D0B", ink="#101310", raised="#1A201A",
      prim="#E7C24A", prim_lt="#F1D98A", sec="#3FB985", sec_lt="#86D6B4", bone="#ECEAE0", slate="#7E8478", hair="#2A332A"),
 dict(slug="10-graphite-electric", name="Graphite Electric", deep="#0C0E12", ink="#14171C", raised="#1E232A",
      prim="#FF6B4A", prim_lt="#FF9E86", sec="#34E0D0", sec_lt="#86EFE4", bone="#ECEEF0", slate="#7A828E", hair="#2A2F38"),
]

def _mix(hexc, toward, t):
    """Blend hexc toward another hex color by fraction t (0..1)."""
    a=hexc.lstrip("#"); b=toward.lstrip("#")
    r=tuple(int(a[i:i+2],16) for i in (0,2,4)); s=tuple(int(b[i:i+2],16) for i in (0,2,4))
    m=tuple(round(r[i]+(s[i]-r[i])*t) for i in range(3))
    return "#%02X%02X%02X" % m

def light_interior(pal):
    """CANONICAL interior: near-white plate with a faint same-hue tinge gradient
    (white at top -> ~8% palette-primary at bottom), dark text. The saturated
    field + rings (the border band) are kept EXACTLY — color lives only in the
    border. Ring/label hues tie text to the ring it names."""
    p=dict(pal)
    p.update(core1="#FFFFFF",                       # top of interior: white
             core2=_mix("#FFFFFF", pal["prim"], 0.08),  # bottom: faint primary tinge
             itext="#15203A", imuted="#5C6680",     # dark ink / muted on light
             iline="#E5E9F0",                        # light divider
             slt_label=pal["sec"], ev_label=pal["sec"])  # SLT label tied to inner ring (sec)
    p["name"]=pal["name"]+" (light interior)"
    return p

def white_interior(pal):
    """Dark ring-band kept EXACTLY (field + rings unchanged); only the INTERIOR
    plate goes white, with dark text. Overrides only interior tokens."""
    p=dict(pal)
    p.update(core1="#FFFFFF", core2="#FFFFFF",      # white plate
             itext="#16213A", imuted="#5C6680",     # dark text / muted on white
             iline="#E2E6EC",                        # light divider on white
             slt_label=pal["prim"], ev_label=pal["sec"])  # full-hue labels for contrast
    p["name"]=pal["name"]+" (white interior)"
    return p

if __name__=="__main__":
    os.makedirs("colors", exist_ok=True)
    for pal in PALETTES:
        svg=build_svg(pal)
        open(f"colors/{pal['slug']}.svg","w").write(svg)
        open(f"colors/{pal['slug']}.html","w").write(wrap(svg,512,CHECKER))
        wpal=white_interior(pal); wsvg=build_svg(wpal); wslug=pal['slug']+"-white-interior"
        open(f"colors/{wslug}.svg","w").write(wsvg)
        open(f"colors/{wslug}.html","w").write(wrap(wsvg,512,CHECKER))
        print("wrote", pal['slug'], "+ white-interior —", pal['name'])
