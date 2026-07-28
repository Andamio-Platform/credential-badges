#!/usr/bin/env python3
"""Tests for the holder viewer generator (generator/holder.py, #73).

Guards the shell frame (well-formed branded HTML with the client-JS hooks the
_holder.js DOM bootstrap targets), the suspension-UX framing + signature-honesty
gate (this viewer OWNS the human suspension rendering, P1bis-02, and must not
overclaim a universal signature — mirrors test_explainers), the badge registry
shape (stem -> {course_title, module_title, signed}, SKIP_COURSES-filtered,
flagship signed), and byte-parity to the committed artifacts.

No third-party framework — runnable directly:
    python3 generator/tests/test_holder.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, GEN)

import holder  # noqa: E402
from build import SKIP_COURSES  # noqa: E402

STEM_RE = re.compile(r"^[0-9a-f]{56}\.[0-9a-f]{64}$")
FLAGSHIP = ("ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df."
            "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db")


def test_shell_well_formed():
    html = holder._shell()
    assert html.startswith("<!doctype html>")
    assert "<title>" in html and 'name="theme-color"' in html
    assert html.rstrip().endswith("</html>")
    print("  ✅ holder shell is well-formed branded HTML")


def test_shell_carries_client_js_hooks():
    """The DOM bootstrap in _holder.js targets these selectors + loads the module
    by ABSOLUTE path (the page is served two segments deep, so a relative src
    would 404)."""
    html = holder._shell()
    assert 'src="/badges/_holder.js"' in html, "must load _holder.js by absolute path"
    for hook in ("data-holder-alias", "data-holder-status", "data-holder-list",
                 "data-holder-form", "data-holder-input", "data-holder-verdict"):
        assert hook in html, f"missing client hook: {hook}"
    print("  ✅ shell carries the client-JS hooks + absolute module src")


def test_verdict_region_starts_hidden():
    """The verdict is the answer to 'does THIS holder hold THIS credential?'. It
    must be empty + hidden until the live read completes — a pre-filled or
    visible region would imply a state before anything was read."""
    html = holder._shell()
    m = re.search(r"<div class=\"verdict[^\"]*\" data-holder-verdict[^>]*>(.*?)</div>",
                  html, re.S)
    assert m, "verdict region missing or not a <div> with the hook"
    assert "hidden" in m.group(0), "verdict region must start hidden"
    assert m.group(1).strip() == "", "verdict region must start empty (JS fills it)"
    print("  ✅ verdict region starts empty + hidden")


def test_legend_names_every_surfaced_state():
    """Deployment plan Unit 5 wants designed copy per state, not raw state names.
    The legend must describe every state the client can render."""
    norm = " ".join(holder._shell().split())
    for phrase in ("Anchored on-chain",
                   "signature not checked here",
                   "Suspended (key-version)",
                   "Not found for this holder",
                   "Indeterminate"):
        assert phrase in norm, f"legend does not describe: {phrase}"
    print("  ✅ legend describes all five surfaced states")


def test_legend_disclaims_the_two_states_it_cannot_produce():
    """The honesty core of Phase 3: this page never checks a Data Integrity proof
    (so no 'signature valid'), and absence is indistinguishable from indexer lag
    here (so no 'revoked'). Both are said out loud, not merely omitted."""
    norm = " ".join(holder._shell().split())
    assert "Two states you will never see here" in norm
    assert "nothing on this page checks a signature" in norm
    assert "absence is reported as <em>not found</em>, never as revoked" in norm
    assert "indexer lag" in norm
    print("  ✅ legend disclaims 'signature valid' and 'revoked' explicitly")


def test_shell_makes_the_multi_party_process_visible():
    """Unit 5: courseOwner + assessor + chain + Andamio visible in the rendered
    output. The assessor is NOT derivable from any on-chain surface, so it is
    named as absent rather than dropped — and the teacher roster must not be
    passed off as the assessor."""
    norm = " ".join(holder._shell().split())
    assert "Who stands behind each credential" in norm
    assert "The course owner" in norm
    assert "The assessor" in norm
    assert "Not recorded on-chain for these credentials" in norm, \
        "the assessor's absence must be stated, not silently dropped"
    assert "teacher roster is not the same fact" in norm, \
        "must refuse to present the teacher roster as the assessor"
    assert "minting policy" in norm, "the on-chain course id must be explained"
    print("  ✅ multi-party process is visible, with the assessor named as absent")


def test_shell_owns_suspension_framing():
    """Covers P1bis-02: the viewer explains suspension for a human as a
    key-version issue, NOT 'didn't earn it', with the chain authoritative.
    Prose is checked against whitespace-normalized text (the shell wraps lines)."""
    html = holder._shell()
    norm = " ".join(html.split())
    assert "key-version" in norm.lower()
    assert "did not earn the credential" in norm, "suspension is not 'didn't earn it'"
    assert "chain remains authoritative" in norm
    print("  ✅ shell owns the human suspension framing (key-version, not 'didn't earn')")


def test_shell_does_not_overclaim_signature():
    """Mirrors test_explainers: the viewer must not imply it cryptographically
    verifies every badge's signature — it confirms anchor + suspension and points
    at an independent verifier for signature depth."""
    html = holder._shell()
    norm = " ".join(html.split())
    assert "<strong>Status.</strong>" in html, "missing the signing-status caveat"
    assert "does not itself assert a signature" in norm
    assert "DI-capable OB 3.0 / VC verifier" in norm
    assert "any OB3 verifier" not in norm
    # The viewer reads Andamio's own indexer — it must NOT claim it independently
    # verifies "without trusting Andamio"; that belongs to the how-to-check path.
    assert "convenience view, not an independent verifier" in norm, \
        "viewer must not overclaim independent verification"
    assert "verifiable independently, without trusting" not in norm, \
        "the no-trust claim belongs to how-to-check, not this convenience view"
    print("  ✅ shell is signature-honest + indexer-honest (no independent-verify overclaim)")


def test_shell_cross_links_check_page():
    html = holder._shell()
    assert 'href="/badges/how-to-check"' in html
    print("  ✅ shell cross-links the how-to-check explainer")


def test_registry_shape_and_signed_flag():
    reg = holder.build_registry()
    assert len(reg) == 58, f"expected 58 built badges, got {len(reg)}"
    for stem, meta in reg.items():
        assert STEM_RE.match(stem), f"registry key not a valid stem: {stem}"
        assert set(meta) == {"course_title", "module_title", "signed"}, f"bad entry: {stem}"
        assert isinstance(meta["signed"], bool)
    assert reg[FLAGSHIP]["signed"] is True, "flagship must be signed"
    # Every committed badge now carries a signed class artifact, so the flag
    # should read True across the board. This asserted the opposite while the
    # rollout was partial; the flag's *derivation* is still exercised, and the
    # presentation-only rendering path is covered by the synthetic fixture in
    # test_page.py rather than by depending on an unsigned badge existing.
    unsigned = [s for s, m in reg.items() if not m["signed"]]
    assert not unsigned, f"expected every badge signed, {len(unsigned)} are not: {unsigned[:3]}"
    print(f"  ✅ registry: 58 badges, valid stems, all signed")


def test_registry_excludes_skip_courses():
    reg = holder.build_registry()
    for stem in reg:
        course_id = stem.split(".")[0]
        assert course_id not in SKIP_COURSES, f"SKIP_COURSES leaked into registry: {course_id}"
    print("  ✅ registry excludes SKIP_COURSES (matches the built badge set)")


def test_output_byte_identical_to_committed():
    """Parity guard (mirrors test_explainers/test_page): regenerate via
    holder.main() into a scratch dir and assert byte-identity to the committed
    badges/_holder.html and badges/_registry.json — catches generator<->committed
    drift (a badge added without regenerating the registry, a shell edit not
    re-emitted)."""
    with tempfile.TemporaryDirectory() as out:
        r = subprocess.run([sys.executable, os.path.join(GEN, "holder.py"), out],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"holder.py failed: {r.stderr}"
        for name in ("_holder.html", "_registry.json"):
            new = open(os.path.join(out, name), "rb").read()
            committed = os.path.join(BADGES, name)
            assert os.path.exists(committed), f"no committed {name}"
            assert new == open(committed, "rb").read(), f"{name} differs from committed"
    print("  ✅ _holder.html + _registry.json byte-identical to committed")


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
