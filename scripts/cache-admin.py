#!/usr/bin/env python3
"""Admin the on-demand badge GCS cache (#33, U6 — KTD-7).

On-demand+cache (KTD-1) dissolves the old orphan class — a credential dropped
on-chain simply stops resolving and is never re-cached — but introduces a new
staleness surface: a cached SVG whose on-chain title later changes. This tool is
the explicit invalidation path for that surface.

  cache-admin.py invalidate <cid>.<slt>.svg [...]   delete named cache objects
  cache-admin.py reconcile [--delete]               flag (or delete) cache
                                                     objects whose course_id no
                                                     longer resolves on-chain

Invalidation is non-destructive: a badge is re-derivable, so a deleted object
just re-renders on the next request.

GATEWAY FAILURES FAIL LOUDLY. reconcile decides "orphaned" only when a course_id
returns a clean unresolvable/not_found on EVERY configured network (mirrors
app.serve_badge). If the gateway client errors for any other reason
(auth/timeout/transport/config), the check is *inconclusive* — so reconcile
aborts with a non-zero exit instead of guessing, because mis-flagging a live
course would delete a real badge. We count on the gateway client; if it breaks,
we stop, not soldier on.

Protected names (`_placeholder.svg` and every baked badge in `badges/`) and any
object whose name is not a well-formed badge key are NEVER targeted.

Pure core (reconcile/invalidate) is dependency-injected and unit-tested offline;
only the CLI wiring touches GCS + the live gateway.
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "service"))
sys.path.insert(0, os.path.join(REPO, "generator"))

# Badge cache-key contract: course_id 28 bytes (56 hex) . slt_hash 32 bytes
# (64 hex) . svg. Sibling of service/app.py:BADGE_RE — same documented shape.
BADGE_RE = re.compile(r"^([0-9a-f]{56})\.([0-9a-f]{64})\.svg$")

# Gateway error kinds that mean "this course genuinely isn't here" (a clean
# miss) vs. "we couldn't actually check" (everything else -> fail loudly).
_CLEAN_MISS = {"unresolvable", "not_found"}


class CacheAdminError(Exception):
    """A condition under which the tool must stop loudly rather than risk a
    destructive false positive (e.g. a broken/misconfigured gateway)."""


def parse_badge_key(name):
    """(course_id, slt_hash) for a well-formed badge cache key, else None."""
    m = BADGE_RE.match(name)
    return (m.group(1), m.group(2)) if m else None


def baked_badge_names(badges_dir=None):
    """The protected set: every checked-in badge plus `_placeholder.svg`. These
    are served statically by nginx and must never be touched by the cache tool,
    even if a name collides into the cache bucket."""
    badges_dir = badges_dir or os.path.join(REPO, "badges")
    protected = {"_placeholder.svg"}
    if os.path.isdir(badges_dir):
        protected.update(n for n in os.listdir(badges_dir) if n.endswith(".svg"))
    return protected


def gateway_resolves(course_id, networks, *, get_titles=None):
    """True if `course_id` resolves on any network; False only if EVERY network
    returns a clean unresolvable/not_found.

    Raises CacheAdminError if any network fails for a reason that leaves
    resolution undetermined (auth/timeout/transport/config) — a broken gateway
    must not be read as 'orphaned'. `get_titles` is the injection seam (defaults
    to the real api_client.get_titles)."""
    if not networks:
        raise CacheAdminError("no networks configured to check resolution against")
    from api_client import GatewayError
    get_titles = get_titles or _default_get_titles()
    for net in networks:
        try:
            get_titles(course_id, net)
            return True
        except GatewayError as e:
            if e.kind in _CLEAN_MISS:
                continue          # not on this network — maybe another; keep checking
            raise CacheAdminError(
                f"gateway check for course {course_id} on {net!r} failed "
                f"({e.kind}: {e}); refusing to treat it as orphaned — fix the "
                f"gateway/key and re-run") from e
    return False                  # clean miss on every configured network


def _default_get_titles():
    import api_client
    return api_client.get_titles


def invalidate(cache, names, *, protected=None, log=print):
    """Delete named cache objects. Refuses protected and malformed names (those
    are reported, not deleted). Returns the list of names actually removed."""
    protected = protected if protected is not None else baked_badge_names()
    removed = []
    for name in names:
        if name in protected:
            log(f"  skip (protected): {name}")
            continue
        if not parse_badge_key(name):
            log(f"  skip (not a badge key): {name}")
            continue
        existed = cache.delete(name)
        log(f"  {'deleted' if existed else 'absent'}: {name}")
        if existed:
            removed.append(name)
    return removed


def reconcile(cache, networks, *, resolves=gateway_resolves, protected=None,
              delete=False, log=print):
    """List cache objects and flag (or, with delete=True, remove) those whose
    course_id no longer resolves on-chain. Protected names and non-badge keys are
    skipped. `resolves(course_id, networks)` is the injection seam; it RAISES
    CacheAdminError on an inconclusive gateway result and that propagates — the
    run aborts before any flag/delete decision can be made on bad data.

    Returns the list of orphaned keys (flagged, and deleted if delete=True)."""
    protected = protected if protected is not None else baked_badge_names()
    keys = cache.list_keys()
    # Resolve each unique course_id once (cheaper, and kinder to the rate limit).
    verdict = {}        # course_id -> bool resolves
    orphaned = []
    for key in keys:
        if key in protected:
            continue
        parsed = parse_badge_key(key)
        if not parsed:
            log(f"  skip (not a badge key): {key}")
            continue
        course_id, _ = parsed
        if course_id not in verdict:
            verdict[course_id] = resolves(course_id, networks)   # may raise -> abort
        if verdict[course_id]:
            continue
        orphaned.append(key)
        if delete:
            cache.delete(key)
        log(f"  {'deleted' if delete else 'orphaned'}: {key} (course {course_id} unresolvable)")
    return orphaned


# --------------------------------- CLI -------------------------------------- #

def _live_cache():
    from cache import GCSCache
    return GCSCache(os.environ["BADGE_CACHE_BUCKET"])


def _networks():
    raw = os.environ.get("BADGE_NETWORKS", "mainnet,preprod")
    return [n.strip() for n in raw.split(",") if n.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_inv = sub.add_parser("invalidate", help="delete named cache objects")
    p_inv.add_argument("names", nargs="+", metavar="<cid>.<slt>.svg")

    p_rec = sub.add_parser("reconcile",
                           help="flag cache objects whose course_id no longer resolves")
    p_rec.add_argument("--delete", action="store_true",
                       help="delete the orphaned objects (default: report only)")

    args = ap.parse_args(argv)
    try:
        cache = _live_cache()
        if args.cmd == "invalidate":
            removed = invalidate(cache, args.names)
            print(f"invalidate: {len(removed)} object(s) removed")
        elif args.cmd == "reconcile":
            orphaned = reconcile(cache, _networks(), delete=args.delete)
            verb = "deleted" if args.delete else "orphaned (re-run with --delete to remove)"
            print(f"reconcile: {len(orphaned)} {verb}")
    except CacheAdminError as e:
        print(f"ABORTED: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
