#!/usr/bin/env python3
"""Badge art — the hand-set image drawn inside a badge's core plate (#131).

Andamio sets art by hand, per badge or per course, by dropping a JPEG into
generator/art/ named by its key:

    <course_id>.<slt_hash>.jpg   one badge
    <course_id>.jpg              every badge of the course (fallback)

Lookup is per-badge, then per-course, then none. The filename IS the mapping —
there is no manifest, so git review shows every add, swap, and removal. Art lives
under generator/ because that ships in the render image (service/Dockerfile
copies it whole) and is never served by the static host (root Dockerfile
allowlist). Never put art under badges/.

Art is drawn only. It never enters the credential JSON or any signature, so
changing it means rebuild + re-bake, never re-sign (docs/runbooks/badge-art.md).

Validation is a stdlib JPEG marker walk (no Pillow — the generator is
stdlib-only). Every file must be a clean baseline/progressive 8-bit JPEG,
grayscale or YCbCr, square, MIN_EDGE..MAX_EDGE px, at most MAX_BYTES, carrying
no EXIF/XMP/ICC/comment segment. WebP is out: the pinned @resvg/resvg-js 2.6.2
has no WebP decoder and silently draws one as blank.

A bad file fails loudly, before any output is written. It never falls back to
"no image", which would make every downstream guard pass on nothing.

Usage:
    python3 art.py --check [<art_dir>]   validate; list what each file reaches
"""
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART_DIR = os.path.join(HERE, "art")

MAX_BYTES = 160 * 1024
MIN_EDGE, MAX_EDGE = 824, 1024

# Same key shapes as service/app.py and scripts/cache-admin.py BADGE_RE:
# course_id 28 bytes (56 hex), slt_hash 32 bytes (64 hex). Lowercase and ".jpg"
# exactly — a case-insensitive macOS match would miss in the Linux container.
_BADGE_ART_RE = re.compile(r"^([0-9a-f]{56})\.([0-9a-f]{64})\.jpg$")
_COURSE_ART_RE = re.compile(r"^([0-9a-f]{56})\.jpg$")

# Segments a clean JPEG may carry. APP0 is the JFIF header; everything else here
# is structural. Anything absent is rejected by name: APP1 (EXIF/XMP, which can
# hold GPS and camera data), APP2 (ICC), APP13/APP14, COM, and every other SOF.
_SOF = {0xC0: "baseline", 0xC2: "progressive"}
_ALLOWED = {0xE0, 0xDB, 0xC4, 0xDD, 0xDA} | set(_SOF)
_NAMES = {0xE1: "APP1 (EXIF/XMP)", 0xE2: "APP2 (ICC profile)", 0xED: "APP13 (Photoshop)",
          0xEE: "APP14 (Adobe)", 0xFE: "COM (comment)"}


class ArtError(ValueError):
    """Raised when badge art does not meet the art spec. Names every bad file."""


def _marker_name(m):
    if m in _NAMES:
        return _NAMES[m]
    if 0xE0 <= m <= 0xEF:
        return f"APP{m - 0xE0}"
    if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
        return f"SOF{m - 0xC0} (unsupported JPEG process)"
    return f"marker 0x{m:02X}"


def check_jpeg(data):
    """Validate JPEG bytes against the art spec. Returns (width, height) or
    raises ArtError naming the first violation."""
    if len(data) > MAX_BYTES:
        raise ArtError(f"{len(data)} bytes, over the {MAX_BYTES}-byte ceiling")
    if data[:3] != b"\xff\xd8\xff":
        raise ArtError("not a JPEG (JPEG is the only accepted format)")
    i, n, dims, scans = 2, len(data), None, 0
    while True:
        if i + 1 >= n or data[i] != 0xFF:
            raise ArtError("truncated or malformed JPEG")
        while i < n and data[i] == 0xFF:        # fill bytes
            i += 1
        if i >= n:
            raise ArtError("truncated JPEG")
        m = data[i]
        i += 1
        if m == 0xD9:                           # EOI
            break
        if m not in _ALLOWED:
            raise ArtError(f"carries {_marker_name(m)}; strip metadata and re-export")
        if i + 2 > n:
            raise ArtError("truncated JPEG")
        seglen = int.from_bytes(data[i:i + 2], "big")
        if seglen < 2 or i + seglen > n:
            raise ArtError("truncated JPEG")
        seg = data[i + 2:i + seglen]
        if m in _SOF:
            if dims:
                raise ArtError("more than one frame header")
            if len(seg) < 6:
                raise ArtError("truncated frame header")
            precision, h = seg[0], int.from_bytes(seg[1:3], "big")
            w, comps = int.from_bytes(seg[3:5], "big"), seg[5]
            if precision != 8:
                raise ArtError(f"{precision}-bit samples; only 8-bit is accepted")
            if comps not in (1, 3):
                raise ArtError(f"{comps} colour components; only grayscale or YCbCr (CMYK is rejected)")
            if w != h:
                raise ArtError(f"{w}x{h}; art must be square")
            if not MIN_EDGE <= w <= MAX_EDGE:
                raise ArtError(f"{w}px edge; must be {MIN_EDGE}-{MAX_EDGE}px")
            dims = (w, h)
        elif m == 0xE0 and not (seg.startswith(b"JFIF\x00") or seg.startswith(b"JFXX\x00")):
            raise ArtError("APP0 is not a JFIF header")
        i += seglen
        if m == 0xDA:                           # SOS: skip entropy-coded data
            if not dims:
                raise ArtError("scan before frame header")
            scans += 1
            while True:
                j = data.find(b"\xff", i)
                if j < 0 or j + 1 >= n:
                    raise ArtError("truncated JPEG (no EOI)")
                nxt = data[j + 1]
                if nxt == 0x00 or 0xD0 <= nxt <= 0xD7:   # stuffed byte / RSTn
                    i = j + 2
                    continue
                i = j
                break
    if not dims or not scans:
        raise ArtError("no image data")
    return dims


def _default_skip():
    # Lazy: build imports this module, so importing build at load time would cycle.
    from build import SKIP_COURSES
    return SKIP_COURSES


def _key(name):
    """(key, course_id) for a valid art filename, else None."""
    m = _BADGE_ART_RE.match(name)
    if m:
        return f"{m.group(1)}.{m.group(2)}", m.group(1)
    m = _COURSE_ART_RE.match(name)
    if m:
        return m.group(1), m.group(1)
    return None


class Art:
    """Validated art, keyed by badge_id or course_id -> data: URI. Read-only
    after construction, so concurrent lookups are safe."""

    def __init__(self, uris, files=None):
        self._uris = dict(uris)
        self.files = dict(files or {})          # key -> filename, for reporting

    def image_for(self, course_id, slt_hash):
        """Per-badge art, else course art, else None."""
        return self._uris.get(f"{course_id}.{slt_hash}") or self._uris.get(course_id)

    def keys(self):
        return sorted(self._uris)

    def __len__(self):
        return len(self._uris)


NO_ART = Art({})


def load(art_dir=ART_DIR, skip_courses=None):
    """Validate every file in `art_dir` and return an Art. A missing directory is
    no art, not an error. Raises one ArtError listing every bad file. Dotfiles
    (e.g. a Finder .DS_Store) are ignored."""
    if not os.path.isdir(art_dir):
        return NO_ART
    skip = _default_skip() if skip_courses is None else skip_courses
    uris, files, problems = {}, {}, []
    for name in sorted(os.listdir(art_dir)):
        if name.startswith("."):
            continue
        path = os.path.join(art_dir, name)
        key = _key(name)
        if not os.path.isfile(path):
            problems.append(f"{name}: not a file")
            continue
        if key is None:
            problems.append(f"{name}: filename must be <course_id>.jpg or "
                            "<course_id>.<slt_hash>.jpg (lowercase hex, .jpg)")
            continue
        if key[1] in skip:
            problems.append(f"{name}: course is withheld (SKIP_COURSES); its art must not ship")
            continue
        with open(path, "rb") as f:
            data = f.read()
        try:
            check_jpeg(data)
        except ArtError as e:
            problems.append(f"{name}: {e}")
            continue
        uris[key[0]] = "data:image/jpeg;base64," + base64.b64encode(data).decode()
        files[key[0]] = name
    if problems:
        raise ArtError("invalid badge art in " + art_dir + ":\n  " + "\n  ".join(problems))
    return Art(uris, files)


def _check(art_dir):
    try:
        art = load(art_dir)
    except ArtError as e:
        print(f"❌ {e}")
        return 1
    from build import DATA              # lazy, as in _default_skip
    badge_ids = [f"{r['course_id']}.{r['slt_hash']}" for r in json.load(open(DATA))]
    keys = set(art.keys())
    for key in art.keys():
        if "." in key:                          # per-badge file
            reached = [b for b in badge_ids if b == key]
        else:                                   # course file: badges without their own art
            reached = [b for b in badge_ids if b.startswith(key + ".") and b not in keys]
        note = (f"{len(reached)} credentials.json badge(s)" if reached
                else "no credentials.json badge (on-demand only, or a mistyped key)")
        print(f"  {art.files[key]} -> {note}")
    print(f"✅ {len(art)} art file(s) valid in {art_dir}")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] != "--check" or len(args) > 2:
        sys.exit("usage: art.py --check [<art_dir>]")
    sys.exit(_check(args[1] if len(args) == 2 else ART_DIR))
