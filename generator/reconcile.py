#!/usr/bin/env python3
"""Self-pruning reconciler for the served ``badges/`` tree (#31, generalized).

``build.py`` is additive-only: it writes one SVG per ``credentials.json`` record
but never removes art for records that have been dropped. On a forever-public,
immutable-tagged host that means any credential removed from the registry leaves
its artifacts served indefinitely (the shield-orphan incident, #29). v1.2 adds
two more generated artifact types under ``badges/`` (the download PNG and the
1200x630 Open Graph card), each multiplying that orphan surface — so pruning must
cover ALL artifact types, not just SVG.

The source of truth is ``credentials.json`` (offline, deterministic) minus
``SKIP_COURSES`` — the same filter ``build.py`` applies when rendering. Every
served ``badges/`` file must map to a non-skipped record by its stem; anything
else is an orphan.

Safety rails (mirrored from ``scripts/cache-admin.py``):
  - Protected names (``_placeholder.svg`` and any ``_``-prefixed file) are NEVER
    deleted — ``_placeholder.svg`` is the deploy-asserted render fallback.
  - Strict key match: a file whose name does not parse to
    ``<56-hex>.<64-hex><known-suffix>`` is SKIPPED, never deleted. We do not
    delete a file we do not understand.
  - Baked badges are never at risk: a baked SVG still matches its record's stem,
    so it is kept like any other in-registry artifact.

Usage:
    python3 reconcile.py            # prune orphans from ../badges/
    python3 reconcile.py --check    # report orphans, exit 1 if any (deletes nothing)
    python3 reconcile.py <dir>      # operate on a different badges dir (tests)
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "credentials.json")
DEFAULT_BADGES = os.path.join(HERE, "..", "badges")

# Import the single source of truth for withheld courses (also imported by
# service/app.py) so the reconciler and the renderer agree on what exists.
from build import SKIP_COURSES  # noqa: E402

# Known generated artifact suffixes under badges/. Ordered longest-first so a
# stem is matched against a longer suffix before a shorter one it ends with:
# ".og.png" before ".png", and ".embed.html" (the #71 embed variant) before
# ".html" (the #70 page). Both must precede their shorter tail.
KNOWN_SUFFIXES = (".embed.html", ".og.png", ".png", ".svg", ".html")

# A well-formed badge stem: course_id 28 bytes (56 hex) . slt_hash 32 bytes
# (64 hex). Sibling of service/app.py:BADGE_RE and cache-admin's BADGE_RE.
STEM_RE = re.compile(r"^[0-9a-f]{56}\.[0-9a-f]{64}$")


class ReconcileError(Exception):
    """A condition under which pruning must stop loudly rather than risk a
    destructive false positive (e.g. an empty/corrupt registry that would
    authorize wiping the whole committed badges/ tree). Mirrors
    scripts/cache-admin.py's CacheAdminError posture."""


def expected_stems(data_path=DATA):
    """The set of ``{course_id}.{slt_hash}`` stems that SHOULD have artifacts —
    every registry record except the withheld ``SKIP_COURSES`` (matching
    build.py's render filter)."""
    data = json.load(open(data_path))
    return {f"{r['course_id']}.{r['slt_hash']}"
            for r in data if r["course_id"] not in SKIP_COURSES}


def is_protected(name):
    """``_placeholder.svg`` and any other ``_``-prefixed file are never touched."""
    return name.startswith("_")


def split_stem(name):
    """(stem, suffix) for a well-formed artifact name, else ``None``. A name is
    well-formed only if it ends with a known suffix AND its stem matches the
    strict ``<56-hex>.<64-hex>`` shape — anything else we refuse to classify (and
    therefore never delete)."""
    for suffix in KNOWN_SUFFIXES:
        if name.endswith(suffix):
            stem = name[: -len(suffix)]
            if STEM_RE.match(stem):
                return stem, suffix
            return None
    return None


def find_orphans(badges_dir, expected=None):
    """Return the sorted list of orphan filenames in ``badges_dir``: well-formed
    artifacts whose stem is not in ``expected``. Protected and unrecognized
    files are excluded (never orphans)."""
    expected = expected if expected is not None else expected_stems()
    if not os.path.isdir(badges_dir):
        return []
    orphans = []
    for name in os.listdir(badges_dir):
        if is_protected(name):
            continue
        parsed = split_stem(name)
        if parsed is None:
            continue  # not an artifact we own — leave it alone
        stem, _ = parsed
        if stem not in expected:
            orphans.append(name)
    return sorted(orphans)


def reconcile(badges_dir, *, expected=None, delete=False, log=print):
    """Find (and, with ``delete=True``, remove) orphan artifacts. Returns the
    list of orphan filenames. In check mode (``delete=False``) nothing is
    removed — the caller inspects the return / exit code.

    Blast-radius guard: refuses to delete when the expected-stem set is empty
    while recognized artifacts exist on disk. An empty expected set means
    ``credentials.json`` is empty, all-skipped, or truncated — trusting it would
    authorize wiping the entire committed ``badges/`` tree. Like
    ``cache-admin.py`` aborting on an inconclusive oracle, we stop loudly rather
    than let one bad local file zero out the art. (Check mode still reports.)"""
    expected = expected if expected is not None else expected_stems()
    orphans = find_orphans(badges_dir, expected=expected)
    if delete and not expected and orphans:
        raise ReconcileError(
            f"credentials.json yielded 0 expected stems but {len(orphans)} "
            f"recognized artifact(s) exist in {badges_dir} — refusing to prune "
            f"the whole tree. Fix/restore the registry and re-run.")
    for name in orphans:
        if delete:
            os.remove(os.path.join(badges_dir, name))
        log(f"  {'deleted' if delete else 'orphan'}: {name}")
    return orphans


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("badges_dir", nargs="?", default=DEFAULT_BADGES,
                    help="badges directory to reconcile (default: ../badges)")
    ap.add_argument("--check", action="store_true",
                    help="report orphans and exit 1 if any; delete nothing")
    args = ap.parse_args(argv)

    try:
        orphans = reconcile(args.badges_dir, delete=not args.check)
    except ReconcileError as e:
        print(f"ABORTED: {e}", file=sys.stderr)
        return 2
    if args.check:
        if orphans:
            print(f"reconcile --check: {len(orphans)} orphan(s) with no "
                  f"credentials.json record — run `make reconcile` to prune",
                  file=sys.stderr)
            return 1
        print("reconcile --check: no orphans — every badges/ artifact maps to a record")
        return 0
    print(f"reconcile: {len(orphans)} orphan(s) pruned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
