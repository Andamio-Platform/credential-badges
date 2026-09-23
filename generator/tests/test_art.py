#!/usr/bin/env python3
"""Tests for badge art lookup + validation (generator/art.py, #131).

Every art directory here is synthesized in a temp dir from the committed
placeholder fixture, so these keep testing the same thing once real art lands
in generator/art/. Invalid variants are made by rewriting the fixture's bytes —
no image library needed.

No third-party test framework — runnable directly:
    python3 generator/tests/test_art.py
"""
import base64
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import art    # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "art", "placeholder.jpg")
JPEG = open(FIXTURE, "rb").read()

CID = "661274aa715885b4c9789aec179f9a429169eb7be73f7c29a8694402"
SLT_A = "9fa3cdce9eaa801270d42154dcb12b64448bfab826971f1d0e74f9d0e87cc3e9"
SLT_B = "0" * 64
OTHER_CID = "b7795c1b9080507786be4de6cf798de780e0d5cba3244ad1a286f210"
SKIPPED = "5977af642f25cf2872f3938030df03495031783edbaeec62d79ea6dc"  # build.SKIP_COURSES


def _dir(files):
    """Temp art dir from {name: bytes}. Caller removes it."""
    d = tempfile.mkdtemp(prefix="art-test-")
    for name, data in files.items():
        with open(os.path.join(d, name), "wb") as f:
            f.write(data)
    return d


def _load(files, **kw):
    d = _dir(files)
    try:
        return art.load(d, **kw)
    finally:
        shutil.rmtree(d)


def _rejects(files, *needles):
    try:
        _load(files)
    except art.ArtError as e:
        for n in needles:
            assert n in str(e), f"expected {n!r} in error:\n{e}"
        return str(e)
    raise AssertionError(f"expected ArtError for {sorted(files)}")


def _with_segment(marker, payload):
    """The fixture with one extra segment inserted right after SOI."""
    seg = bytes([0xFF, marker]) + (len(payload) + 2).to_bytes(2, "big") + payload
    return JPEG[:2] + seg + JPEG[2:]


def _sof_offset():
    for m in (b"\xff\xc0", b"\xff\xc2"):
        i = JPEG.find(m)
        if i >= 0:
            return i
    raise AssertionError("fixture has no SOF0/SOF2")


def _with_sof(precision=None, h=None, w=None, comps=None):
    b = bytearray(JPEG)
    i = _sof_offset() + 4                       # past marker + length
    if precision is not None:
        b[i] = precision
    if h is not None:
        b[i + 1:i + 3] = h.to_bytes(2, "big")
    if w is not None:
        b[i + 3:i + 5] = w.to_bytes(2, "big")
    if comps is not None:
        b[i + 5] = comps
    return bytes(b)


def _app0_payload_offset():
    """Offset of the fixture's APP0 segment payload (right after its 2-byte
    length field). The fixture's APP0 is a 14-byte clean JFIF header:
    "JFIF\\0"(5) version(2) units(1) Xdensity(2) Ydensity(2) Xthumb(1) Ythumb(1)."""
    i = JPEG.find(b"\xff\xe0")
    assert i >= 0 and JPEG[i + 4:i + 9] == b"JFIF\x00", "fixture must have a clean JFIF APP0"
    return i + 4


def _with_app0(offset, value_bytes):
    """Fixture with APP0 payload bytes overwritten at `offset` (0 = the start
    of the payload, i.e. "J" of "JFIF\\0")."""
    b = bytearray(JPEG)
    base = _app0_payload_offset()
    b[base + offset:base + offset + len(value_bytes)] = value_bytes
    return bytes(b)


# ---- lookup ---------------------------------------------------------------

def test_fixture_is_valid_art():
    assert art.check_jpeg(JPEG) == (824, 824)
    print("  ✅ committed placeholder fixture passes the art spec (824x824)")


def test_per_badge_wins_over_course():
    other = _with_app0(8, b"\x00\x02")            # a distinct but still-valid file (Xdensity 1 -> 2)
    a = _load({f"{CID}.{SLT_A}.jpg": JPEG, f"{CID}.jpg": other})
    badge_uri, course_uri = a.image_for(CID, SLT_A), a.image_for(CID, SLT_B)
    assert badge_uri != course_uri
    assert base64.b64decode(badge_uri.split(",", 1)[1]) == JPEG
    assert base64.b64decode(course_uri.split(",", 1)[1]) == other
    assert a.image_for(OTHER_CID, SLT_A) is None
    print("  ✅ per-badge art wins; other badges of the course get the course art")


def test_course_file_covers_every_slt():
    a = _load({f"{CID}.jpg": JPEG})
    assert a.image_for(CID, SLT_A) and a.image_for(CID, SLT_B)
    print("  ✅ a course file resolves for every slt_hash of that course")


def test_missing_dir_is_no_art():
    a = art.load(os.path.join(tempfile.gettempdir(), "no-such-art-dir-131"))
    assert len(a) == 0 and a.image_for(CID, SLT_A) is None
    print("  ✅ a missing art directory means no art, not an error")


def test_data_uri_round_trips_bytes():
    uri = _load({f"{CID}.jpg": JPEG}).image_for(CID, SLT_A)
    prefix = "data:image/jpeg;base64,"
    assert uri.startswith(prefix)
    assert base64.b64decode(uri[len(prefix):]) == JPEG
    print("  ✅ data URI is image/jpeg and decodes to the file's exact bytes")


def test_dotfiles_ignored():
    a = _load({f"{CID}.jpg": JPEG, ".DS_Store": b"junk"})
    assert len(a) == 1
    print("  ✅ dotfiles (Finder .DS_Store) are ignored")


# ---- rejection ------------------------------------------------------------

def test_over_ceiling_rejected():
    art.check_jpeg(JPEG)                          # the valid fixture is well under the ceiling
    big = JPEG + b"\x00" * (art.MAX_BYTES - len(JPEG) + 1)
    assert len(big) == art.MAX_BYTES + 1
    _rejects({f"{CID}.jpg": big}, f"{CID}.jpg", "ceiling")
    # A file of exactly MAX_BYTES must not be rejected FOR SIZE. Padding with
    # trailing zero bytes (the only cheap way to hit an exact byte count) does
    # make it invalid — but for carrying bytes after the EOI marker, not for
    # size, so the ceiling message must not appear.
    at = JPEG + b"\x00" * (art.MAX_BYTES - len(JPEG))
    assert len(at) == art.MAX_BYTES
    try:
        art.check_jpeg(at)
    except art.ArtError as e:
        assert "ceiling" not in str(e), f"exactly-at-ceiling must not fail the size check: {e}"
    else:
        raise AssertionError("expected the zero-padded exactly-at-ceiling file to be rejected "
                              "(for trailing bytes, not size)")
    print("  ✅ one byte over 160 KiB fails the size ceiling; exactly 160 KiB does not")


def test_other_formats_rejected():
    webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><line x1="0"/></svg>'
    for name, data in (("webp", webp), ("png", png), ("svg", svg)):
        _rejects({f"{CID}.jpg": data}, "not a JPEG")
    print("  ✅ WebP, PNG and SVG named .jpg are all rejected by magic bytes")


def test_metadata_segments_rejected():
    _rejects({f"{CID}.jpg": _with_segment(0xE1, b"Exif\x00\x00" + b"\x00" * 16)}, "APP1")
    _rejects({f"{CID}.jpg": _with_segment(0xE2, b"ICC_PROFILE\x00" + b"\x00" * 16)}, "ICC")
    _rejects({f"{CID}.jpg": _with_segment(0xFE, b"made with camera X")}, "COM")
    _rejects({f"{CID}.jpg": _with_segment(0xEE, b"Adobe\x00" + b"\x00" * 6)}, "APP14")
    print("  ✅ EXIF/XMP, ICC, comment and Adobe segments are rejected")


def test_geometry_rejected():
    _rejects({f"{CID}.jpg": _with_sof(w=900)}, "square")
    _rejects({f"{CID}.jpg": _with_sof(h=823, w=823)}, "823px")
    _rejects({f"{CID}.jpg": _with_sof(h=1025, w=1025)}, "1025px")
    art.check_jpeg(_with_sof(h=1024, w=1024))    # upper bound itself passes the header check
    print("  ✅ non-square, 823px and 1025px are rejected; 1024px passes")


def test_sample_format_rejected():
    _rejects({f"{CID}.jpg": _with_sof(precision=12)}, "12-bit")
    _rejects({f"{CID}.jpg": _with_sof(comps=4)}, "CMYK")
    print("  ✅ 12-bit and 4-component (CMYK) frames are rejected")


def test_trailing_bytes_rejected():
    _rejects({f"{CID}.jpg": JPEG + b"\x00"}, "end-of-image")
    print("  ✅ a byte appended after the EOI marker is rejected (motion-photo/vendor trailers)")


def test_jfif_thumbnail_rejected():
    _rejects({f"{CID}.jpg": _with_app0(12, b"\x01\x00")}, "thumbnail")
    print("  ✅ a JFIF APP0 carrying a nonzero thumbnail is rejected")


def test_jfxx_rejected():
    jfxx = _with_segment(0xE0, b"JFXX\x00" + b"\x00" * 16)
    _rejects({f"{CID}.jpg": jfxx}, "JFXX")
    print("  ✅ a JFXX-flavoured APP0 is rejected (JFIF-only)")


def test_bad_filenames_rejected():
    for name in (f"{CID.upper()}.jpg", f"{CID}.JPG", f"{CID}.jpeg",
                 f"{CID}.{SLT_A}.v2.jpg", "cover.jpg", f"{CID[:-1]}.jpg"):
        _rejects({name: JPEG}, "filename must be")
    print("  ✅ uppercase hex, .JPG, .jpeg, suffixed and malformed keys are rejected")


def test_skip_course_rejected():
    _rejects({f"{SKIPPED}.jpg": JPEG}, "withheld")
    _rejects({f"{SKIPPED}.{SLT_A}.jpg": JPEG}, "withheld")
    print("  ✅ art for a SKIP_COURSES course is rejected (course or badge file)")


def test_all_problems_reported_together():
    msg = _rejects({f"{CID}.jpg": b"nope", f"{OTHER_CID}.JPG": JPEG,
                    f"{OTHER_CID}.{SLT_A}.jpg": _with_sof(comps=4)})
    assert msg.count("\n  ") == 3, msg
    print("  ✅ several bad files produce one error listing all of them")


def test_check_cli():
    ok = _dir({f"{CID}.jpg": JPEG})
    bad = _dir({f"{CID}.jpg": b"nope"})
    try:
        r = subprocess.run([sys.executable, os.path.join(GEN, "art.py"), "--check", ok],
                           capture_output=True, text=True)
        assert r.returncode == 0, r.stdout + r.stderr
        assert "1 art file(s) valid" in r.stdout and "credentials.json badge" in r.stdout
        r = subprocess.run([sys.executable, os.path.join(GEN, "art.py"), "--check", bad],
                           capture_output=True, text=True)
        assert r.returncode == 1 and "not a JPEG" in r.stdout, r.stdout + r.stderr
    finally:
        shutil.rmtree(ok)
        shutil.rmtree(bad)
    print("  ✅ art.py --check exits 0 on valid art and 1 on invalid art")


def test_repo_art_dir_valid():
    art.load()                                    # raises if committed art is bad
    print(f"  ✅ committed generator/art/ is valid ({len(art.load())} file(s))")


def _main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        print(f"• {t.__name__}")
        try:
            t()
        except AssertionError as e:
            failed += 1
            print(f"  ❌ FAIL: {e}")
    print(f"\n{'❌' if failed else '✅'} {len(tests)-failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    _main()
