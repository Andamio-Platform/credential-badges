#!/usr/bin/env python3
"""The Andamio canon — colour literals, single-sourced for every canon surface.

Transcribed by hand from ``src/styles/globals.css`` in the ``landing-page-and-blog``
repo, because there is no shared token package (``@andamio/tokens`` is deferred in
the brand guide's §11). This module exists so the share page, the explainers, the
holder viewer and any later surface import ONE copy instead of each carrying its
own transcription with its own drift clock — the same reason ``gen.py`` holds the
shared leaf constants and ``colors.palette_for`` is single-sourced across five
modules.

LIGHT ONLY, deliberately. ``globals.css`` also defines a full ``.dark`` theme
(``--sys-paper:#0f1419``, ``--sys-orange:#ff7a52``, ``--sys-blue:#5b8bff``,
``--sys-coral-tint: rgb(255 122 82 / 0.1)``). It is not here. Every canon surface
at credentials.andamio.io is light-first and ships no ``prefers-color-scheme``
block, per the landing's own ``.sys-light`` forced-light island — the precedent
for rendering a credential specimen on a light plate. If a surface genuinely
needs the dark theme, adding it is a deliberate amendment to this module AND its
pin, reviewed on its own merits — never a transcription made in passing while
restyling something else.

Two transcription traps, both live:

* ``CORAL_TINT`` is NOT a tint of ``ORANGE``. The source writes it as
  ``rgb(255 107 74 / 0.055)`` — hue 74, not 53. Re-deriving it from ``#ff6b35``
  shifts the credential plate.
* The landing repo still carries a second live blue, ``#004E89`` "Foundation
  Blue", in its legacy shadcn layer. A grep-based transcription can pick up the
  wrong one. The canon blue is ``#2f6bff``.

The values are pinned by sha256 in ``generator/tests/test_canon.py``. A hand-edit
that does not also update the pin and ``SOURCE_COMMIT`` is a red test, not a
silent drift — the same discipline ``tools/context-freeze.test.ts`` applies to
published JSON-LD contexts and ``tools/did-pin.test.ts`` to the committed DID key.
"""
import hashlib
import json

# Provenance. SOURCE_COMMIT is the landing-page-and-blog commit that last touched
# SOURCE_FILE, not that repo's HEAD — it is the precise ref these bytes came from.
SOURCE_REPO = "Andamio-Platform/landing-page-and-blog"
SOURCE_FILE = "src/styles/globals.css"
SOURCE_COMMIT = "cff82bb966be744d082e6cff879f02fa97b4a0ec"  # 2026-06-30

# --- the transcribed light :root -------------------------------------------
PAPER = "#ffffff"
INK = "#0a0a0a"
INK_RGB = "10,10,10"
ON_INK = "#ffffff"
RULE = "#0a0a0a"        # solid, full-bleed editorial rule — strong by design
ORANGE = "#ff6b35"
BLUE = "#2f6bff"
CORAL_TINT = "rgba(255,107,74,.055)"

# --- the ink alpha ramp -----------------------------------------------------
# Derived from INK_RGB exactly as the source derives them from --sys-ink-rgb.
# TEXT MAY ONLY USE `ink` OR `muted`. On white, .45 computes to 3.16:1 and fails
# AA for normal text; .60 gives 5.25:1 and passes. Everything below .60 is for
# rules, hairlines and non-text marks.
MUTED = f"rgba({INK_RGB},.60)"      # the lowest step legal for text
FAINT = f"rgba({INK_RGB},.45)"      # NOT for text
GHOST = f"rgba({INK_RGB},.30)"
CELL = f"rgba({INK_RGB},.15)"       # inter-column divider
HAIRLINE = f"rgba({INK_RGB},.10)"   # frame edges
GRID = f"rgba({INK_RGB},.05)"

# --- measure ----------------------------------------------------------------
MEASURE = "1320px"      # the canon's max content width
NAV_CLEARANCE = "5rem"

# --- type -------------------------------------------------------------------
SANS = '"Inter",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif'
MONO = '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace'
DISPLAY_TRACKING = "-0.045em"       # calibrated to Inter 600

# Every value the pin covers. Adding a key here without updating the pin is a
# red test — that is the point.
TOKENS = {
    "PAPER": PAPER, "INK": INK, "INK_RGB": INK_RGB, "ON_INK": ON_INK,
    "RULE": RULE, "ORANGE": ORANGE, "BLUE": BLUE, "CORAL_TINT": CORAL_TINT,
    "MUTED": MUTED, "FAINT": FAINT, "GHOST": GHOST, "CELL": CELL,
    "HAIRLINE": HAIRLINE, "GRID": GRID,
    "MEASURE": MEASURE, "NAV_CLEARANCE": NAV_CLEARANCE,
    "SANS": SANS, "MONO": MONO, "DISPLAY_TRACKING": DISPLAY_TRACKING,
}


def digest():
    """sha256 over the canonical serialization of TOKENS. Stable across runs
    (sort_keys), so the pin only moves when a value moves."""
    payload = json.dumps(TOKENS, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def root_block():
    """The ``:root`` custom-property declarations, for a page's inline <style>.
    One place builds this string so every surface emits identical bytes."""
    return (
        f"--paper:{PAPER};--ink:{INK};--ink-rgb:{INK_RGB};--on-ink:{ON_INK};"
        f"--rule:{RULE};--orange:{ORANGE};--blue:{BLUE};--coral:{CORAL_TINT};"
        f"--muted:{MUTED};--faint:{FAINT};--ghost:{GHOST};--cell:{CELL};"
        f"--hairline:{HAIRLINE};--grid:{GRID};"
    )


if __name__ == "__main__":
    print(f"canon digest: {digest()}")
    print(f"source: {SOURCE_REPO} {SOURCE_FILE} @ {SOURCE_COMMIT[:12]}")
