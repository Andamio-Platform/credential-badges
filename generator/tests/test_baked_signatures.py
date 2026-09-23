#!/usr/bin/env python3
"""Signature guard (#131): every signed class artifact is still baked, byte-exact,
into its committed badge SVG.

Giving a signed badge art means rebuilding its SVG and re-baking its class
artifact (docs/runbooks/badge-art.md). Forget the re-bake and the badge silently
loses its signature — and test_render_parity.py cannot see it, because it
compares an unbaked committed SVG byte-for-byte and so passes. This guard reads
what ships: for each signing/class-artifacts/<badge_id>.json, the credential
extracted from badges/<badge_id>.svg (service/bake.py, held to the TypeScript
splice by test_bake.py) must equal the artifact's bytes.

No third-party test framework — runnable directly:
    python3 generator/tests/test_baked_signatures.py
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
ARTIFACTS = os.path.join(REPO, "signing", "class-artifacts")
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, os.path.join(REPO, "service"))
sys.path.insert(0, GEN)

import bake   # noqa: E402
import build  # noqa: E402


def unbaked_signatures(artifact_dir=ARTIFACTS, badges_dir=BADGES):
    """badge_ids whose committed SVG does not carry their class artifact
    byte-exact, with the reason. Empty means every signature is in place."""
    problems = []
    for name in sorted(os.listdir(artifact_dir)):
        if not name.endswith(".json"):
            continue
        badge_id = name[:-len(".json")]
        svg_path = os.path.join(badges_dir, f"{badge_id}.svg")
        if not os.path.exists(svg_path):
            problems.append(f"{badge_id}: signed artifact has no committed SVG")
            continue
        with open(os.path.join(artifact_dir, name), encoding="utf-8") as f:
            artifact = f.read()
        with open(svg_path, encoding="utf-8") as f:
            svg = f.read()
        try:
            embedded = bake.extract_vc(svg)
        except bake.BakeError as e:
            problems.append(f"{badge_id}: {e}")
            continue
        if embedded != artifact:
            problems.append(f"{badge_id}: SVG does not carry its signed class artifact "
                            "(rebuilt without `npm run bake:class -- --badge`?)")
    return problems


def test_every_class_artifact_is_baked():
    problems = unbaked_signatures()
    assert not problems, "signatures missing from committed badges:\n  " + "\n  ".join(problems)
    n = len([f for f in os.listdir(ARTIFACTS) if f.endswith(".json")])
    assert n > 0, "no class artifacts found — guard would pass on nothing"
    print(f"  ✅ all {n} class artifacts extract byte-exact from their committed SVGs")


def _one_badge_tree():
    """A temp copy of one signed artifact and its badge SVG."""
    name = sorted(f for f in os.listdir(ARTIFACTS) if f.endswith(".json"))[0]
    badge_id = name[:-len(".json")]
    arts, badges = tempfile.mkdtemp(), tempfile.mkdtemp()
    shutil.copy(os.path.join(ARTIFACTS, name), arts)
    shutil.copy(os.path.join(BADGES, f"{badge_id}.svg"), badges)
    return badge_id, arts, badges


def test_unbaked_rebuild_is_caught():
    """The likeliest runbook mistake: a scratch build copied over a signed SVG."""
    badge_id, arts, badges = _one_badge_tree()
    try:
        cid, slt = badge_id.split(".")
        rec = next(r for r in json.load(open(os.path.join(GEN, "credentials.json")))
                   if r["course_id"] == cid and r["slt_hash"] == slt)
        with open(os.path.join(badges, f"{badge_id}.svg"), "w") as f:
            f.write(build.render(rec))
        problems = unbaked_signatures(arts, badges)
        assert len(problems) == 1 and badge_id in problems[0], problems
    finally:
        shutil.rmtree(arts)
        shutil.rmtree(badges)
    print("  ✅ an unbaked rebuild over a signed SVG fails and names the badge")


def test_tampered_proof_is_caught():
    badge_id, arts, badges = _one_badge_tree()
    try:
        path = os.path.join(badges, f"{badge_id}.svg")
        svg = open(path, encoding="utf-8").read()
        i = svg.index('"proofValue": "') + len('"proofValue": "')
        flipped = "A" if svg[i + 5] != "A" else "B"
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg[:i + 5] + flipped + svg[i + 6:])
        problems = unbaked_signatures(arts, badges)
        assert len(problems) == 1 and badge_id in problems[0], problems
    finally:
        shutil.rmtree(arts)
        shutil.rmtree(badges)
    print("  ✅ one changed byte inside an embedded proof fails the guard")


def test_missing_svg_is_caught():
    badge_id, arts, badges = _one_badge_tree()
    try:
        os.unlink(os.path.join(badges, f"{badge_id}.svg"))
        problems = unbaked_signatures(arts, badges)
        assert len(problems) == 1 and "no committed SVG" in problems[0], problems
    finally:
        shutil.rmtree(arts)
        shutil.rmtree(badges)
    print("  ✅ a signed artifact whose SVG is gone fails the guard")


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
