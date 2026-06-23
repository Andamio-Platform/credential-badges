#!/usr/bin/env python3
"""
Proof Rings (#04r) — LOCKED design, palette-driven, theme-ready.

Color is one addressable layer (CSS vars + literal fallback, svg-scoped, also
baked into metadata). Tokens split into two groups so the dark FRAME/RING zone
and the INTERIOR card can be themed independently:
  FRAME/RING : deep/ink/raised (field) · prim/prim_lt · sec/sec_lt · hair · extlabel
  INTERIOR   : core1/core2 (plate) · itext · imuted · iline · slt_label · ev_label
Defaults make interior mirror the dark field, so build_svg() with no args is the
canonical dark badge. A white-interior variant overrides only the INTERIOR group.

RINGS (curves only): outer = SLT_HASH, inner = EVIDENCE_HASH (256b/32B). CENTER:
titles hero; hashes small full single strings; "ANDAMIO" base mark. OB3 metadata
baked in. Transparent disc.
"""
import math, json, os

# Fonts: if fonts.css (base64 @font-face, built by embed_fonts.py) exists next to
# this file, inline it so every SVG is self-contained (renders identically with no
# network). Otherwise fall back to the Google Fonts @import (needs network).
_FONTCSS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts.css")
FONT_FACE = (open(_FONTCSS).read() if os.path.exists(_FONTCSS)
             else "@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Spline+Sans+Mono:wght@400;500;600&display=swap');")

COURSE_TITLE = "Andamio for Developers"
MODULE_TITLE = "Transactions"
COURSE_ID    = "6348bba0f9b7d7e0353715ece5946f3b61de433d314e84dad313a677"          # 28 bytes
SLT_HASH     = "a891203913065a08e2c87ea57b808bb0f6efa4e57f36bc1412f7c2cdd846a045"  # 32 bytes (outer ring)
EVIDENCE     = "b60b006844447593f8b0b7fe98ccd5c2bf6e363579f4d273521f8037b5ee2e0f"  # 32 bytes (inner ring) [placeholder]
NETWORK      = "preprod"

CX=CY=512

BASE=["deep","ink","raised","prim","prim_lt","sec","sec_lt","bone","slate","hair"]
INT =["core1","core2","itext","imuted","iline","extlabel","slt_label","ev_label","ctitle","mtitle"]
ALLTOKENS=BASE+INT

PAL_ANDAMIO = dict(name="Andamio Navy",
    deep="#0C1325", ink="#121A2D", raised="#1B2540",
    prim="#EE6C3A", prim_lt="#F6A07A", sec="#5BB8D4", sec_lt="#9ED8E8",
    bone="#EAE6DD", slate="#6E7A98", hair="#2C3858")

def fill_defaults(pal):
    """Interior tokens default to the dark field so existing palettes render
    exactly as before; the white-interior transform overrides only these."""
    P=dict(pal)
    P.setdefault("core1",P["raised"]); P.setdefault("core2",P["ink"])
    P.setdefault("itext",P["bone"]);   P.setdefault("imuted",P["slate"])
    P.setdefault("iline",P["hair"]);   P.setdefault("extlabel",P["slate"])
    P.setdefault("slt_label",P["prim_lt"]); P.setdefault("ev_label",P["sec_lt"])
    P.setdefault("ctitle",P["itext"]);  P.setdefault("mtitle",P["itext"])
    return P

def ring_ticks(R, hexstr, color, hair):
    bytes_=[int(hexstr[i:i+2],16) for i in range(0,len(hexstr),2)]
    gs=360.0/len(bytes_); lead=(gs-8.0)/2.0
    lit=[]; dim=[]
    for bi,bv in enumerate(bytes_):
        g0=-90.0 + bi*gs
        for k in range(8):
            bit=(bv>>(7-k))&1; msb=(k==0)
            a=math.radians(g0+lead+(k+0.5)); c,s=math.cos(a),math.sin(a)
            if bit:
                L=18 if msb else 13; w=3.4 if msb else 2.6; r0,r1=R-L/2,R+L/2
                lit.append(f'<line x1="{CX+r0*c:.2f}" y1="{CY+r0*s:.2f}" x2="{CX+r1*c:.2f}" y2="{CY+r1*s:.2f}" stroke="{color}" stroke-width="{w}" stroke-linecap="round"/>')
            else:
                L=8 if msb else 5; r0,r1=R-L/2,R+L/2
                dim.append(f'<line x1="{CX+r0*c:.2f}" y1="{CY+r0*s:.2f}" x2="{CX+r1*c:.2f}" y2="{CY+r1*s:.2f}" stroke="{hair}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>')
    return lit,dim

def quad_labels(R, color):
    out=[]
    for bi,deg in [(0,-90),(8,0),(16,90),(24,180)]:
        a=math.radians(deg); rr=R+16
        out.append(f'<text class="mono" x="{CX+rr*math.cos(a):.1f}" y="{CY+rr*math.sin(a)+4:.1f}" text-anchor="middle" font-size="12" fill="{color}" opacity="0.5">{bi:02d}</text>')
    return "".join(out)

def credential_json(P):
    return json.dumps({
        "@context":["https://www.w3.org/ns/credentials/v2",
                    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
                    "https://credentials.andamio.io/context/v0.jsonld"],
        "type":["VerifiableCredential","OpenBadgeCredential"],
        "issuer":"did:web:credentials.andamio.io","name":MODULE_TITLE,
        "credentialSubject":{"type":["AchievementSubject"],
            "achievement":{"type":["Achievement"],"name":MODULE_TITLE,
                           "description":f"{MODULE_TITLE} — {COURSE_TITLE}"}},
        "andamio:course":COURSE_TITLE,
        "andamio:onChainAnchor":{"network":NETWORK,"courseId":COURSE_ID,"sltHash":SLT_HASH},
        "andamio:theme":{k:P[k] for k in ALLTOKENS},
        "_note":"Presentation artifact. Colors are CSS vars (--token) overridable for theming; signed VC-JWT bakes into openbadges:credential verify= at issue time."
    },indent=2)

def esc(s):
    return (str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            .replace('"',"&quot;").replace("'","&#39;"))

def fit_title(text, base, maxw=384.0, factor=0.56, floor=16):
    """Shrink a title's font-size so it fits maxw px; never grows past base.
    Short titles keep `base` (canonical renders unchanged)."""
    n=max(len(text),1)
    return max(min(base, int(maxw/(factor*n))), floor)

def _wrap2(text):
    """Split into at most 2 lines, breaking at the space nearest the middle."""
    mid=len(text)//2
    l=text.rfind(" ",0,mid); r=text.find(" ",mid)
    if l<0 and r<0: return [text]
    cut = r if l<0 else l if r<0 else (l if mid-l<=r-mid else r)
    return [text[:cut].strip(), text[cut:].strip()]

def lay_title(text, base, maxw, factor, min_one, floor=15):
    """Lay a title as 1 line at the largest size up to `base`; if that would drop
    below `min_one`, wrap to 2 lines instead (still sized to fill `maxw`).
    Returns (lines, font_size)."""
    n=max(len(text),1)
    one=min(base, int(maxw/(factor*n)))
    if one>=min_one or " " not in text:
        return [text], max(one, floor)
    lines=_wrap2(text)
    if len(lines)==1:
        return lines, max(one, floor)
    longest=max(len(l) for l in lines)
    return lines, max(min(base, int(maxw/(factor*longest))), floor)

def build_svg(pal=PAL_ANDAMIO):
    P=fill_defaults(pal)
    def c(k): return f'var(--{k}, {P[k]})'
    R_OUT,R_IN=472,440
    # Per-credential badge (not per-person): both rings encode the credential's
    # on-chain identity — outer = course_id, inner = slt_hash (credential hash).
    # No evidence_hash (that is per-person and absent from shared badges).
    lit_o,dim_o=ring_ticks(R_OUT,COURSE_ID,c("prim"),c("hair"))
    lit_i,dim_i=ring_ticks(R_IN,SLT_HASH,c("sec"),c("hair"))
    cred=credential_json(P)
    # palette vars live in a per-element style attribute (NOT a global `svg{}` rule)
    # so many SVGs can be inlined on one page without their colors colliding.
    var_style="".join(f"--{k}:{P[k]};" for k in ALLTOKENS)
    p=[]
    p.append('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
             'xmlns:openbadges="https://purl.imsglobal.org/ob/v3p0" '
             'viewBox="0 0 1024 1024" width="1024" height="1024" role="img" '
             f'style="{var_style}" '
             f'aria-label="Andamio credential — {esc(MODULE_TITLE)} ({esc(COURSE_TITLE)})">')
    p.append('<metadata><![CDATA[\n'+cred+'\n]]></metadata>')
    p.append('<openbadges:credential verify=""><![CDATA[\n'+cred+'\n]]></openbadges:credential>')
    p.append('<defs>'
        '<style>'
        +FONT_FACE+
        '.sans{font-family:"Archivo",sans-serif;}.mono{font-family:"Spline Sans Mono",monospace;}'
        '</style>'
        f'<radialGradient id="field" cx="50%" cy="44%" r="62%"><stop offset="0%" stop-color="{c("raised")}"/><stop offset="70%" stop-color="{c("ink")}"/><stop offset="100%" stop-color="{c("deep")}"/></radialGradient>'
        f'<linearGradient id="core" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="{c("core1")}"/><stop offset="100%" stop-color="{c("core2")}"/></linearGradient>'
        '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        '</defs>')

    p.append(f'<circle cx="{CX}" cy="{CY}" r="500" fill="url(#field)" stroke="{c("hair")}" stroke-width="2"/>')
    p.append(f'<circle cx="{CX}" cy="{CY}" r="488" fill="none" stroke="{c("hair")}" stroke-width="1.25" opacity="0.7"/>')
    p.append(f'<circle cx="{CX}" cy="{CY}" r="{R_IN}" fill="none" stroke="{c("sec")}" stroke-width="1" opacity="0.16"/>')
    p.append('<g>'+''.join(dim_o)+''.join(dim_i)+'</g>')
    p.append('<g filter="url(#glow)">'+''.join(lit_i)+''.join(lit_o)+'</g>')
    # One small start marker at 12 o'clock (where byte 0 begins). No byte-index
    # numbers, no "BIT 0 CLOCKWISE" words — the read convention (top, clockwise)
    # lives in the baked metadata, not cluttering the face.
    p.append(f'<path d="M {CX} {CY-R_OUT-19} l 6 -11 l -12 0 z" fill="{c("prim")}" opacity="0.85"/>')

    p.append(f'<circle cx="{CX}" cy="{CY}" r="424" fill="none" stroke="{c("hair")}" stroke-width="1.25" opacity="0.55"/>')
    p.append(f'<circle cx="{CX}" cy="{CY}" r="412" fill="url(#core)" stroke="{c("hair")}" stroke-width="1.5"/>')

    def T(y,s,size,fill,cls="mono",w=None,ls=None):
        a=f'<text class="{cls}" x="{CX}" y="{y}" text-anchor="middle" font-size="{size}" fill="{fill}"'
        if w: a+=f' font-weight="{w}"'
        if ls is not None: a+=f' letter-spacing="{ls}"'
        return a+f'>{s}</text>'

    # Center content: titles are the heroes (big, wrap to 2 lines when long);
    # course_id/slt_hash sit below the divider. The whole block is measured and
    # vertically centered, with the ANDAMIO maker's mark tiny at the very bottom.
    items=[]               # (rel_y, render(absolute_y))
    cur=[0.0]
    def emit(fn, advance): items.append((cur[0], fn)); cur[0]+=advance
    def text(s,size,fill,cls,w=None,ls=None):
        return lambda y,s=s,size=size,fill=fill,cls=cls,w=w,ls=ls: p.append(T(y,s,size,fill,cls,w,ls))

    clines,csz = lay_title(COURSE_TITLE,34,500,0.54,24)
    mlines,msz = lay_title(MODULE_TITLE,60,520,0.58,40)
    EG=18  # gap from an eyebrow label's baseline to the title's cap-top (scales with title size)

    emit(text("COURSE",11,c("imuted"),"mono",None,4), int(EG+csz*0.72))
    for ln in clines: emit(text(esc(ln),csz,c("ctitle"),"sans",600,None), int(csz*1.12))
    cur[0]+=22
    emit(text("MODULE",11,c("imuted"),"mono",None,4), int(EG+msz*0.72))
    for ln in mlines: emit(text(esc(ln),msz,c("mtitle"),"sans",800,None), int(msz*1.06))
    cur[0]+=40
    div_rel=cur[0]; cur[0]+=54                                    # hashes pushed further down
    emit(text("COURSE_ID",11,c("ctitle"),"mono",None,3), 24)      # dark outer-ring (course) hue
    emit(text(COURSE_ID,15,c("itext"),"mono",None,0), 42)         # slightly larger
    emit(text("SLT_HASH",11,c("mtitle"),"mono",None,3), 24)       # dark inner-ring (module) hue
    emit(text(SLT_HASH,13,c("itext"),"mono",None,0), 0)           # slightly smaller

    start = 532 - cur[0]/2.0     # block shifted down (module title nearer circle center)
    for rel,fn in items: fn(start+rel)
    dy=start+div_rel
    p.append(f'<line x1="{CX-150}" y1="{dy:.1f}" x2="{CX+150}" y2="{dy:.1f}" stroke="{c("iline")}" stroke-width="1.25"/>')
    p.append(T(884,"ANDAMIO",9,c("imuted"),"sans",600,6))         # tiny, at the bottom
    p.append('</svg>')
    return ''.join(p)

def wrap(svg,px,bg):
    return ('<!doctype html><meta charset=utf-8>'
            f'<style>html,body{{margin:0;overflow:hidden}}body{{{bg}}}div{{width:{px}px;height:{px}px}}svg{{width:100%;height:100%;display:block}}</style>'
            f'<div>{svg}</div>')

CHECKER=("background-color:#20242e;background-image:"
         "linear-gradient(45deg,#2c313c 25%,transparent 25%,transparent 75%,#2c313c 75%),"
         "linear-gradient(45deg,#2c313c 25%,transparent 25%,transparent 75%,#2c313c 75%);"
         "background-size:48px 48px;background-position:0 0,24px 24px;")

if __name__=="__main__":
    svg=build_svg()
    open("badge.svg","w").write(svg)
    open("wrap-1024.html","w").write(wrap(svg,1024,CHECKER))
    open("wrap-white.html","w").write(wrap(svg,512,"background:#ffffff"))
    open("wrap-128.html","w").write(wrap(svg,128,"background:#0c1020"))
    print("wrote canonical badge.svg (frame/interior token split; dark canonical unchanged)")
