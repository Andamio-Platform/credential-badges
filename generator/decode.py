#!/usr/bin/env python3
"""
Decoder — proves the badge is "readable today."

Reads badge.svg two independent ways and checks they agree:
  1) BAKED METADATA  — the OB3 credential JSON embedded in the file.
  2) RING GEOMETRY   — turns the drawn tick marks back into bits → bytes → hex,
     with NO knowledge of the metadata. If this matches, the rings literally
     ARE the on-chain hashes, not decoration.

Ring model (must match gen.py): N byte-groups x 8 bit-ticks per ring; byte 0 at
the top (12 o'clock), sweeping clockwise; bit k=0 is the MSB; lit tick = 1, dim
tick = 0. Outer ring (≈R472, --prim) = COURSE_ID (28 bytes); inner (≈R440, --sec)
= SLT_HASH / credential hash (32 bytes). No evidence ring (per-credential badge).
"""
import re, json, math

CX=CY=512
import sys
SVG=open(sys.argv[1] if len(sys.argv)>1 else "badge.svg").read()

# ---- 1) baked metadata ------------------------------------------------------
meta=json.loads(re.search(r'<metadata><!\[CDATA\[(.*?)\]\]></metadata>', SVG, re.S).group(1))

# ---- 2) decode the rings from pure geometry ---------------------------------
def decode_ring(stroke_token, r_lo, r_hi, nbytes):
    """Reconstruct `nbytes` bytes from the tick lines in a radius band. A tick is
    a '1' if its stroke is the ring's lit color (stroke_token), else '0'."""
    gs=360.0/nbytes; off=(gs-8.0)/2.0 + 0.5                   # matches gen.ring_ticks
    bits={}  # (byte_index) -> {bit_k: 0/1}
    for x1,y1,x2,y2,stroke in re.findall(
        r'<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="([^"]+)"', SVG):
        mx=(float(x1)+float(x2))/2; my=(float(y1)+float(y2))/2
        r=math.hypot(mx-CX, my-CY)
        if not (r_lo<=r<=r_hi): continue                      # only this ring's band
        ang=math.degrees(math.atan2(my-CY, mx-CX))
        v=(ang+90)%360                                        # 0 at top, clockwise
        bi=int(v//gs)                                         # byte index
        k=round(v - bi*gs - off)                              # bit within byte, MSB=0
        if not (0<=k<=7) or not (0<=bi<nbytes): continue
        lit = stroke_token in stroke                          # lit color → 1
        bits.setdefault(bi,{})[k]=1 if lit else 0
    out=[]
    for bi in range(nbytes):
        byte=0
        for k in range(8):
            byte=(byte<<1)|bits.get(bi,{}).get(k,0)
        out.append(f"{byte:02x}")
    return "".join(out)

_cid=meta["andamio:onChainAnchor"]["courseId"]; _slt=meta["andamio:onChainAnchor"]["sltHash"]
outer = decode_ring("--prim", 456, 486, len(_cid)//2)   # COURSE_ID
inner = decode_ring("--sec",  424, 456, len(_slt)//2)   # SLT_HASH

# ---- report -----------------------------------------------------------------
def line(label,v): print(f"  {label:<16}{v}")
print("\n=== 1) BAKED METADATA (read straight from the file) ===")
line("course",        meta["andamio:course"])
line("module",        meta["name"])
line("network",       meta["andamio:onChainAnchor"]["network"])
line("course_id",     _cid)
line("slt_hash",      _slt)
line("theme",         meta["andamio:theme"]["name"] if "name" in meta["andamio:theme"] else "(tokens)")

print("\n=== 2) DECODED FROM THE RINGS (geometry only, metadata ignored) ===")
line("outer ring →",  outer)
line("inner ring →",  inner)

print("\n=== ROUND-TRIP CHECK ===")
ok1 = outer==_cid
ok2 = inner==_slt
print(f"  outer ring  == course_id   {'✅ MATCH' if ok1 else '❌ MISMATCH'}")
print(f"  inner ring  == slt_hash    {'✅ MATCH' if ok2 else '❌ MISMATCH'}")
print(f"\n  {'✅ The rings ARE the data — decoded from pixels alone.' if ok1 and ok2 else '❌ decode failed'}")
