#!/usr/bin/env python3
"""The canon-pin invariant (generator/canon.py, #101 KTD3/U1).

The canon colour literals are hand-transcribed from another repo
(`landing-page-and-blog`, `src/styles/globals.css`) because there is no shared
token package. A recorded commit ref in a comment detects drift only if somebody
thinks to run the diff — it fails no test and blocks no merge. This repo already
answered that class of problem twice, both times after a silent breakage:
`tools/context-freeze.test.ts` sha256-pins every published JSON-LD context and
`tools/did-pin.test.ts` pins the committed DID key to KMS. This is the same
discipline for the same reason.

Hermetic: no network, no other repo required.

    python3 generator/tests/test_canon.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
sys.path.insert(0, GEN)

import canon  # noqa: E402

# The pin. Moving a canon value means updating BOTH this digest and
# canon.SOURCE_COMMIT, in the same commit, having actually looked at the source.
PINNED_DIGEST = "ab50edc7babda509357e2d8feb9d22a55df0e35d352fec74a81e9bc0545b9f25"
PINNED_SOURCE_COMMIT = "cff82bb966be744d082e6cff879f02fa97b4a0ec"


def test_canon_digest_matches_pin():
    got = canon.digest()
    assert got == PINNED_DIGEST, (
        f"canon literals changed.\n  pinned:  {PINNED_DIGEST}\n  current: {got}\n"
        "If this is a deliberate re-transcription, update PINNED_DIGEST and "
        "canon.SOURCE_COMMIT together, after reading the source.")
    print("  ✅ canon literals match their sha256 pin")


def test_source_commit_recorded_and_pinned():
    assert re.fullmatch(r"[0-9a-f]{40}", canon.SOURCE_COMMIT), \
        "SOURCE_COMMIT must be a full 40-char sha"
    assert canon.SOURCE_COMMIT == PINNED_SOURCE_COMMIT, \
        "SOURCE_COMMIT moved without the digest pin being reviewed"
    assert canon.SOURCE_FILE.endswith("globals.css")
    print("  ✅ transcription provenance recorded and pinned")


def test_light_only_no_dark_theme_values():
    """#101 KTD3 — the domain is light-first and canon.py carries no dark theme.
    Adding one is a deliberate amendment reviewed on its own merits, never a
    transcription made in passing while restyling another surface."""
    dark = ("#0f1419", "#ededed", "#ff7a52", "#5b8bff", "rgb(255 122 82")
    blob = " ".join(str(v) for v in canon.TOKENS.values())
    for value in dark:
        assert value not in blob, f"dark-theme value {value} leaked into canon.py"
    print("  ✅ light theme only; no dark values present")


def test_coral_tint_is_not_derived_from_brand_orange():
    """The live transcription trap: coralTint is rgb(255 107 74 / .055) — hue 74,
    not the brand orange's 53. Re-deriving it from #ff6b35 shifts the plate."""
    assert canon.CORAL_TINT == "rgba(255,107,74,.055)"
    assert "107,53" not in canon.CORAL_TINT
    print("  ✅ coralTint carries its own hue, not a tint of brand orange")


def test_canon_blue_is_not_legacy_foundation_blue():
    """The other trap: the landing repo still carries #004E89 'Foundation Blue'
    in its legacy shadcn layer, so a grep-based transcription can take the wrong
    one."""
    assert canon.BLUE == "#2f6bff"
    blob = " ".join(str(v) for v in canon.TOKENS.values()).lower()
    assert "#004e89" not in blob
    print("  ✅ canon blue is #2f6bff, not legacy Foundation Blue")


def test_text_legal_steps_meet_aa():
    """Only `ink` and `muted` are legal for text. Computed against canon paper:
    ink is 19.8:1, muted (.60) is 5.25:1 — both pass AA for normal text — while
    faint (.45) is 3.16:1 and fails. This test is the arithmetic, not a note."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    def lum(rgb):
        return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])

    ink = tuple(int(x) for x in canon.INK_RGB.split(","))
    paper = (255, 255, 255)

    def ratio(alpha):
        over = tuple(alpha * ink[i] + (1 - alpha) * paper[i] for i in range(3))
        l1, l2 = lum(paper), lum(over)
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)

    assert ratio(1.0) >= 4.5, "ink fails AA"
    assert ratio(0.60) >= 4.5, f"muted is {ratio(0.60):.2f}:1 — below AA"
    assert ratio(0.45) < 4.5, "faint unexpectedly passes AA — re-check the ramp"
    print(f"  ✅ ink {ratio(1.0):.1f}:1, muted {ratio(0.60):.2f}:1 pass AA; "
          f"faint {ratio(0.45):.2f}:1 correctly excluded from text")


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
