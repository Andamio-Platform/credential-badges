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
import hashlib
import json
import os
import re
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))

# TWO TARGETS, TWO ARTIFACTS — and they must never merge.
#
# `fonts.css` is NOT the page's private asset. gen.py reads it into the
# module-level gen.FONT_FACE, which is inlined by the badge SVGs (gen.py), the
# OG cards (og.py), the explainers (explainers.py) and the holder viewer
# (holder.py). The badge SVGs are the SIGNED class artifacts — they carry
# proofValue. Widening CSS_URL to add the canon families would therefore rewrite
# 58 signed artifacts for a page-styling reason, go red on render parity, and
# make re-baking 58 credentials look like the fix. On a trust surface,
# unexplained signature churn is exactly the signal a verifier should distrust.
#
# So the canon page families get their own file, read only by page.py. The
# default target is the page; rebuilding the badge fonts takes an explicit flag,
# because this script curls live binaries and is not reproducible across runs.
CSS_URL = ("https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800"
           "&family=Spline+Sans+Mono:wght@400;500;600&display=swap")
PAGE_CSS_URL = ("https://fonts.googleapis.com/css2?family=Inter:wght@400;600"
                "&family=JetBrains+Mono:wght@400&display=swap")

TARGETS = {
    # name: (css_url, output css, integrity manifest)
    "page": (PAGE_CSS_URL, "page_fonts.css", "page_fonts.lock.json"),
    "badges": (CSS_URL, "fonts.css", "fonts.lock.json"),
}

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"

# glyphs badges can contain: printable ASCII + a little punctuation seen in titles
CHARS = set(chr(c) for c in range(0x20, 0x7F)) | set("‘’“”·•–—…")
UNICODES = sorted(ord(c) for c in CHARS)


def fetch(url):
    """Fetch bytes, FAILING LOUD. curl, not urllib: macOS Python's cert store
    rejects these hosts.

    The exit-code and empty-body checks are not defensive padding. Without them a
    transient failure writes an empty or truncated @font-face into a file that is
    then base64-baked into 58 forever-public pages and committed — and the golden
    byte-parity test re-baselines around it, so the repo's own drift detector
    ratifies the damage instead of catching it."""
    r = subprocess.run(["curl", "-sS", "--fail", "-m", "30", "-A", UA, url],
                       capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f"fetch failed ({r.returncode}) for {url}: "
                         f"{r.stderr.decode(errors='replace').strip()}")
    if not r.stdout:
        raise SystemExit(f"fetch returned an empty body for {url}")
    return r.stdout


def latin_woff2_urls(css_url):
    """family -> latin-range woff2 URL (one per family; these are variable fonts)."""
    css = fetch(css_url).decode()
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


def build(target, accept_new_hashes=False):
    """Build one target's @font-face artifact and its integrity manifest.

    The manifest pins the sha256 of each RAW upstream woff2. On every rebuild the
    fetched bytes are checked against it: a changed hash means the upstream file
    moved under us, and that is a decision for a human, not a silent re-bake into
    a forever-public trust surface. Pass accept_new_hashes to record a new pin
    deliberately."""
    css_url, css_name, lock_name = TARGETS[target]
    lock_path = os.path.join(HERE, lock_name)
    pinned = {}
    if os.path.exists(lock_path):
        pinned = json.load(open(lock_path)).get("families", {})

    faces, manifest = [], {}
    for family, url in sorted(latin_woff2_urls(css_url).items()):
        raw = fetch(url)
        got = hashlib.sha256(raw).hexdigest()
        want = pinned.get(family, {}).get("sha256")
        if want and want != got and not accept_new_hashes:
            raise SystemExit(
                f"INTEGRITY MISMATCH for {family}\n"
                f"  pinned: {want}\n  fetched: {got}\n"
                f"The upstream font changed. Review the change, then re-run with "
                f"--accept-new-hashes to move the pin deliberately.")
        out = os.path.join(HERE, "_" + family.replace(" ", "") + ".sub.woff2")
        size = subset_woff2(raw, out)
        b64 = base64.b64encode(open(out, "rb").read()).decode()
        os.remove(out)
        faces.append("@font-face{font-family:'%s';font-style:normal;font-weight:100 900;"
                     "src:url(data:font/woff2;base64,%s) format('woff2');font-display:block}"
                     % (family, b64))
        manifest[family] = {"sha256": got, "subset_bytes": size, "source": url}
        print(f"  {family}: subset woff2 {size//1024} KB -> {len(b64)//1024} KB base64")

    css_path = os.path.join(HERE, css_name)
    open(css_path, "w").write("".join(faces))
    json.dump({"families": manifest}, open(lock_path, "w"), indent=2, sort_keys=True)
    open(lock_path, "a").write("\n")
    total = os.path.getsize(css_path)
    print(f"wrote {css_name} ({total//1024} KB, {len(faces)} faces) + {lock_name}")
    return total


def main():
    args = sys.argv[1:]
    accept = "--accept-new-hashes" in args
    args = [a for a in args if not a.startswith("--")]
    target = args[0] if args else "page"
    if target not in TARGETS:
        raise SystemExit(f"unknown target {target!r}; choose from {sorted(TARGETS)}")
    if target == "badges":
        print("WARNING: rebuilding fonts.css regenerates the font block inlined by "
              "every badge SVG, OG card, explainer and holder page. Those are "
              "committed artifacts — one of them is signed. Expect render-parity "
              "failures and re-commit them deliberately.")
    build(target, accept_new_hashes=accept)


if __name__ == "__main__":
    main()
