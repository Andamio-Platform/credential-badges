#!/usr/bin/env python3
"""Refresh credentials.json from chain.

Enumerates every Andamio V2 credential and its course/module titles, writing the
data snapshot that build.py renders from. Two read-only sources:

  - andamioscan (public)  — list all courses + course details (slt_hashes, on-chain SLTs)
  - andamio CLI (authed)  — course titles + published module titles

Requires network and an authenticated `andamio` CLI (`andamio user status`).
This is the only step that needs auth; rendering (build.py) is offline.

Hand-set records survive a refresh. A record that carries a `design` (see
gen.DESIGNS) was set by Andamio: its course_title, module_title and design are
kept as they are, because Andamio Issuer credentials have no titles on chain.
A hand-set record the chain no longer returns is kept too, with a warning;
removing one is a deliberate edit, never a side effect of a refresh.

Usage:
    python3 fetch.py        # rewrite credentials.json (all defined credentials)
"""
import json
import os
import subprocess

import gen

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "credentials.json")
SCAN = "https://andamioscan.io"


def scan(path):
    out = subprocess.run(["curl", "-s", "-m", "30", SCAN + path], capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except Exception:
        return None


def cli(*args):
    out = subprocess.run(["andamio", *args, "--output", "json"], capture_output=True, text=True, timeout=60)
    try:
        d = json.loads(out.stdout)
        return d.get("data", d) if isinstance(d, dict) else d
    except Exception:
        return None


def clean_title(s):
    """Decode chain-only SLT titles stored as hex(ascii); strip stray control bytes."""
    if s and len(s) % 2 == 0 and len(s) >= 8 and all(c in "0123456789abcdefABCDEF" for c in s):
        try:
            txt = "".join(ch for ch in bytes.fromhex(s).decode("utf-8", "ignore") if ch.isprintable()).strip()
            if sum(ch.isalpha() for ch in txt) >= 3:
                return txt
        except ValueError:
            pass
    return s


def course_titles(course_id):
    """(course_title, {slt_hash: module_title}) via the authed CLI. Best-effort."""
    ctitle = ""
    got = cli("course", "get", course_id)
    if isinstance(got, dict):
        ctitle = (got.get("content") or {}).get("title", "") or ""
    mtitles = {}
    for m in (cli("course", "modules", course_id) or []):
        if m.get("slt_hash"):
            mtitles[m["slt_hash"]] = ((m.get("content") or {}).get("title", "") or "")
    return ctitle, mtitles


HAND_SET = ("course_title", "module_title", "design")


def keep_hand_set(fetched, previous):
    """Return `fetched` with every hand-set record of `previous` (one carrying a
    `design`) kept: its HAND_SET fields win over the chain's, and a record the
    chain no longer returns stays. Raises ValueError on an unknown design, so a
    typo fails here instead of rendering the default face."""
    hand = {}
    for r in previous:
        if "design" in r:
            gen.check_design(r["design"])
            hand[(r["course_id"], r["slt_hash"])] = r
    out = []
    for r in fetched:
        h = hand.pop((r["course_id"], r["slt_hash"]), None)
        out.append({**r, **{k: h[k] for k in HAND_SET}} if h else r)
    for key, h in sorted(hand.items()):
        print(f"warning: hand-set {key[0]}.{key[1]} is no longer on chain; kept")
        out.append(h)
    out.sort(key=lambda r: (r["course_id"], r["slt_hash"]))
    return out


def main():
    # andamioscan wraps the course list in {"data": [...]} (the details endpoint
    # is still bare). Accept both shapes: iterating the wrapper dict yields its
    # keys, which crashes on c["course_id"] before anything is written.
    courses = scan("/api/v2/courses") or []
    if isinstance(courses, dict):
        courses = courses.get("data") or []
    out = []
    for c in courses:
        cid = c["course_id"]
        details = scan(f"/api/v2/courses/{cid}/details") or {}
        ctitle, mtitles = course_titles(cid)
        for m in (details.get("modules") or []):
            slt = m.get("slt_hash")
            if not slt:
                continue
            slts = (m.get("module") or {}).get("slts") or []
            title = mtitles.get(slt) or (slts[0] if slts else "")
            out.append({"course_id": cid, "slt_hash": slt,
                        "course_title": ctitle, "module_title": clean_title(title)})
    previous = json.load(open(OUT)) if os.path.exists(OUT) else []
    out = keep_hand_set(out, previous)
    json.dump(out, open(OUT, "w"), indent=2, ensure_ascii=False)
    print(f"wrote credentials.json: {len(out)} credentials across {len(courses)} courses")


if __name__ == "__main__":
    main()
