#!/usr/bin/env python3
"""Refresh credentials.json from chain.

Enumerates every Andamio V2 credential and its course/module titles, writing the
data snapshot that build.py renders from. Two read-only sources:

  - andamioscan (public)  — list all courses + course details (slt_hashes, on-chain SLTs)
  - andamio CLI (authed)  — course titles + published module titles

Requires network and an authenticated `andamio` CLI (`andamio user status`).
This is the only step that needs auth; rendering (build.py) is offline.

Usage:
    python3 fetch.py        # rewrite credentials.json (all defined credentials)
"""
import json
import os
import subprocess

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


def main():
    courses = scan("/api/v2/courses") or []
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
    out.sort(key=lambda r: (r["course_id"], r["slt_hash"]))
    json.dump(out, open(OUT, "w"), indent=2, ensure_ascii=False)
    print(f"wrote credentials.json: {len(out)} credentials across {len(courses)} courses")


if __name__ == "__main__":
    main()
