#!/usr/bin/env python3
"""U5 tests for the Python bake splice — stdlib only.

The splice is byte-exact: the signed credential is inserted verbatim, never
parsed and reserialized, because any mutation breaks the eddsa-rdfc-2022
signature. tools/bake-signed-vc.ts is the specification; this suite holds the
port to the same contract and asserts the two implementations agree
byte-for-byte on real inputs.

Runnable directly:
    python3 generator/tests/test_bake.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "service"))

import bake  # noqa: E402

FLAGSHIP = os.path.join(
    REPO, "badges",
    "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df."
    "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db.svg")
# The committed badge now carries its CLASS artifact; signed-credential.json is
# still the committed HOLDER-credential fixture, just no longer what lives in a
# shared badge (a shared badge cannot name one holder without misreporting for
# the others).
FLAGSHIP_STEM = ("ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df."
                 "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db")
CLASS_VC = os.path.join(REPO, "signing", "class-artifacts",
                        f"{FLAGSHIP_STEM}.json")
SIGNED_VC = os.path.join(REPO, "signing", "signed-credential.json")
TS_TOOL = os.path.join(REPO, "tools", "bake-signed-vc.ts")


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _an_unbaked_badge():
    """A committed badge with its hook reset to the generator's unsigned form.

    Synthesized rather than discovered: every committed badge is baked now, and
    a fixture that hunts for an unbaked one silently breaks the whole suite the
    moment that becomes true. Reconstructing the pre-bake shape keeps these
    tests independent of how much of the set has been signed.
    """
    d = os.path.join(REPO, "badges")
    for name in sorted(os.listdir(d)):
        if not name.endswith(".svg") or name.startswith("_"):
            continue
        p = os.path.join(d, name)
        s = _read(p)
        start = s.find("<openbadges:credential")
        end = s.find("</openbadges:credential>")
        if start == -1 or end == -1:
            continue
        unbaked = (s[:start]
                   + '<openbadges:credential verify=""><![CDATA[\n{"unsigned": true}\n]]>'
                   + s[end:])
        return p, unbaked
    raise AssertionError("no badge SVG found to build a fixture from")


# ------------------------------ round trip --------------------------------- #

def test_extract_matches_committed_class_artifact():
    """The committed badge extracts byte-for-byte to its class artifact."""
    assert bake.extract_vc(_read(FLAGSHIP)) == _read(CLASS_VC)
    print("  ✅ badge extract == its class artifact, byte-for-byte")


def test_committed_badge_names_no_holder():
    embedded = bake.extract_vc(_read(FLAGSHIP))
    assert ":recipient:" not in embedded, "a shared badge must not carry a recipient URN"
    assert "gjames" not in embedded, "a shared badge must not name a holder"
    print("  ✅ committed badge is holder-free")


def test_round_trip_on_a_real_signed_credential():
    _, svg = _an_unbaked_badge()
    vc = _read(SIGNED_VC)
    assert bake.extract_vc(bake.bake_signed_vc(svg, vc)) == vc
    print("  ✅ extract(bake(svg, vc)) == vc on a real signed credential")


def test_round_trip_preserves_payloads_with_and_without_trailing_newline():
    _, svg = _an_unbaked_badge()
    inner = json.dumps({"proof": {"type": "DataIntegrityProof"}})
    for vc in (inner, inner + "\n"):
        assert bake.extract_vc(bake.bake_signed_vc(svg, vc)) == vc
    print("  ✅ round trip holds with and without a trailing newline")


# --------------------------- bytes outside the hook ------------------------ #

def test_bake_preserves_every_byte_outside_the_credential_element():
    _, svg = _an_unbaked_badge()
    vc = _read(SIGNED_VC)
    baked = bake.bake_signed_vc(svg, vc)

    before_o = svg.index("<openbadges:credential")
    before_b = baked.index("<openbadges:credential")
    assert svg[:before_o] == baked[:before_b], "prefix bytes changed"

    close = "</openbadges:credential>"
    assert svg[svg.index(close) + len(close):] == baked[baked.index(close) + len(close):], \
        "suffix bytes changed"
    # The presentation metadata block lives outside the hook and must survive.
    if "<metadata" in svg:
        assert "<metadata" in baked
    print("  ✅ bytes outside the credential element preserved exactly")


# -------------------------------- refusals --------------------------------- #

def test_refuses_payload_containing_cdata_terminator():
    _, svg = _an_unbaked_badge()
    hostile = json.dumps({"proof": {}, "note": "]]>"})
    try:
        bake.bake_signed_vc(svg, hostile)
    except bake.BakeError as e:
        assert "]]>" in str(e) or "CDATA" in str(e)
        print("  ✅ payload containing ']]>' refused, not escaped or truncated")
        return
    raise AssertionError("accepted a payload containing the CDATA terminator")


def test_refuses_unsigned_credential():
    _, svg = _an_unbaked_badge()
    try:
        bake.bake_signed_vc(svg, json.dumps({"type": ["VerifiableCredential"]}))
    except bake.BakeError:
        print("  ✅ refuses to bake a credential with no proof block")
        return
    raise AssertionError("accepted an unsigned credential")


def test_refuses_non_json_payload():
    _, svg = _an_unbaked_badge()
    try:
        bake.bake_signed_vc(svg, "not json at all")
    except bake.BakeError:
        print("  ✅ refuses a non-JSON payload")
        return
    raise AssertionError("accepted a non-JSON payload")


def test_refuses_svg_with_no_hook():
    try:
        bake.extract_vc("<svg><metadata/></svg>")
    except bake.BakeError:
        print("  ✅ refuses an SVG with no credential hook")
        return
    raise AssertionError("accepted an SVG with no hook")


def test_refuses_svg_with_two_hooks():
    _, svg = _an_unbaked_badge()
    doubled = svg.replace("</svg>", "<openbadges:credential><![CDATA[\nx\n]]>"
                                    "</openbadges:credential></svg>")
    try:
        bake.extract_vc(doubled)
    except bake.BakeError as e:
        assert "one" in str(e).lower()
        print("  ✅ refuses an SVG with more than one hook (OB3 5.3.2.1)")
        return
    raise AssertionError("accepted an SVG with two hooks")


# ---------------- parity with the TypeScript specification ----------------- #

def test_python_and_typescript_produce_identical_bytes():
    """The port must not drift from tools/bake-signed-vc.ts.

    Skips (rather than fails) when node is unavailable, so the suite stays
    runnable in a bare environment — CI has node and will enforce it.
    """
    node = shutil.which("node")
    if not node:
        print("  ⏭  node unavailable — parity check skipped")
        return

    src, svg = _an_unbaked_badge()
    vc = _read(SIGNED_VC)
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "ts-baked.svg")
        r = subprocess.run(
            [node, "--experimental-strip-types", TS_TOOL, "bake", src, SIGNED_VC, out],
            capture_output=True, text=True, cwd=REPO)
        assert r.returncode == 0, f"ts bake failed: {r.stderr[:400]}"
        ts_baked = _read(out)

    py_baked = bake.bake_signed_vc(svg, vc)
    assert py_baked == ts_baked, "python and typescript bake output differ"
    print("  ✅ python and typescript bake byte-identical output")


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
