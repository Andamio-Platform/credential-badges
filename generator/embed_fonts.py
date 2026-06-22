#!/usr/bin/env python3
"""Build a self-contained @font-face block (base64 woff2) → fonts.css.

The badge SVGs use Archivo + Spline Sans Mono. By default gen.py @imports them
from Google Fonts, which breaks when the SVG is loaded standalone (browsers block
external font loads in <img> secure-static mode). This fetches both variable
fonts, subsets them to the glyphs badges actually use, base64-embeds them, and
writes d04r/fonts.css. gen.py inlines that file when present, so every generated
SVG is fully self-contained (no network, identical fonts in any renderer).

Both families are *variable* fonts — one woff2 covers all weights — so only two
files are embedded. Re-run to refresh.

Requires fonttools + brotli (a venv is fine):
    python3 -m venv .fontvenv && .fontvenv/bin/pip install fonttools brotli
    .fontvenv/bin/python embed_fonts.py
"""
import base64
import os
import re
import subprocess

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
CSS_URL = ("https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800"
           "&family=Spline+Sans+Mono:wght@400;500;600&display=swap")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"

# glyphs badges can contain: printable ASCII + a little punctuation seen in titles
CHARS = set(chr(c) for c in range(0x20, 0x7F)) | set("‘’“”·•–—…")
UNICODES = sorted(ord(c) for c in CHARS)


def fetch(url):
    # curl, not urllib: macOS Python's cert store rejects these hosts.
    return subprocess.run(["curl", "-s", "-m", "30", "-A", UA, url],
                          capture_output=True).stdout


def latin_woff2_urls():
    """family -> latin-range woff2 URL (one per family; both are variable fonts)."""
    css = fetch(CSS_URL).decode()
    out = {}
    for b in css.split("@font-face")[1:]:
        fam = re.search(r"font-family: '([^']+)'", b)
        url = re.search(r"url\((https[^)]+\.woff2)\)", b)
        rng = re.search(r"unicode-range: ([^;]+)", b)
        if fam and url and rng and "U+0000" in rng.group(1):  # the base latin block
            out.setdefault(fam.group(1), url.group(1))
    return out


def subset_woff2(raw_woff2, out_path):
    tmp_in = out_path + ".in.woff2"
    open(tmp_in, "wb").write(raw_woff2)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.name_IDs = []           # drop name table cruft
    opts.notdef_outline = True
    font = TTFont(tmp_in)
    ss = subset.Subsetter(options=opts)
    ss.populate(unicodes=UNICODES)
    ss.subset(font)
    font.save(out_path)
    os.remove(tmp_in)
    return os.path.getsize(out_path)


def main():
    urls = latin_woff2_urls()
    faces = []
    for family, url in urls.items():
        raw = fetch(url)
        out = os.path.join(HERE, "_" + family.replace(" ", "") + ".sub.woff2")
        size = subset_woff2(raw, out)
        b64 = base64.b64encode(open(out, "rb").read()).decode()
        os.remove(out)
        faces.append("@font-face{font-family:'%s';font-style:normal;font-weight:100 900;"
                     "src:url(data:font/woff2;base64,%s) format('woff2');font-display:block}"
                     % (family, b64))
        print(f"  {family}: subset woff2 {size//1024} KB -> {len(b64)//1024} KB base64")
    open(os.path.join(HERE, "fonts.css"), "w").write("".join(faces))
    total = os.path.getsize(os.path.join(HERE, "fonts.css"))
    print(f"wrote fonts.css ({total//1024} KB, {len(faces)} faces)")


if __name__ == "__main__":
    main()
