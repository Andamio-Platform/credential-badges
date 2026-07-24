#!/usr/bin/env python3
"""Generate the standalone holder credential viewer (#73).

  /badges/{policy_id}.{slt_hash}/{alias}   ->  the committed shell _holder.html

A single static, branded shell served for any holder path by the #73 nginx
route (KTD-7 of the #70 plan reserved this subpath). Its client JS
(``badges/_holder.js``) reads {stem}+{alias} from ``location.pathname``, resolves
the holder's LIVE on-chain state (same-origin via the ``/holder-api/`` proxy,
because andamioscan.io sends no CORS headers) and the suspension status list
(same-origin ``/status/``), then renders each badge with honest verified /
suspended / couldn't-verify state. This viewer OWNS the human-facing
suspension-rendering UX (v1.1 tradeoff P1bis-02).

Two artifacts, both ``_``-prefixed so the reconciler / orphan-guard skip them:
  - ``_holder.html``   the branded shell (byte-parity tested, like explainers)
  - ``_registry.json`` a compact ``stem -> {course_title, module_title, signed}``
                       map so the client can name/link a holder's badges and
                       know which carry a checkable signature (only the flagship
                       today) without N page fetches.

Wording-gated like the check-this explainer (#72): never overclaim a universal
signature; a suspension flag is a KEY-VERSION issue, not "didn't earn it", and
the chain stays authoritative.

Usage:
    python3 holder.py            # write to ../badges/
    python3 holder.py <outdir>
"""
import json
import os
import sys

import gen
from gen import HOST, ISSUER
from build import SKIP_COURSES
from page import _is_baked

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "badges")
DATA = os.path.join(HERE, "credentials.json")

# The canonical technical reference the viewer links for verification depth,
# mirroring the how-to-check explainer (#72).
GUIDANCE_URL = f"{HOST}/badges/how-to-check"

PAL = gen.PAL_ANDAMIO   # Andamio Navy — the viewer is not per-credential


def build_registry():
    """``stem -> {course_title, module_title, signed}`` for every built badge
    (same SKIP_COURSES filter as page.py/build.py). ``signed`` is True only for a
    baked/signed SVG (CONCEPTS: Flagship Badge) — the client uses it to scope the
    suspension check (only signed badges are covered by the key-epoch status
    list) and the signature-depth link. Keys sorted for deterministic output."""
    recs = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    reg = {}
    for r in recs:
        stem = f"{r['course_id']}.{r['slt_hash']}"
        reg[stem] = {
            "course_title": r["course_title"],
            "module_title": r["module_title"],
            "signed": _is_baked(stem),
        }
    return {k: reg[k] for k in sorted(reg)}


def _shell():
    """The branded holder-viewer shell (dark theme, badge palette + fonts). All
    dynamic content is filled by /badges/_holder.js from the live state; the
    static frame carries the suspension legend + verification framing so they
    render even before (or without) JS."""
    p = PAL
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credential holder · {ISSUER} Credentials</title>
<meta name="description" content="A holder's Andamio credential badges with live on-chain and suspension state, read from Andamio's public indexer. To verify a badge without trusting Andamio, follow the independent check.">
<meta name="theme-color" content="{p['deep']}">
<meta name="robots" content="noindex">
<style>
{gen.FONT_FACE}
:root{{--deep:{p['deep']};--ink:{p['ink']};--raised:{p['raised']};--prim:{p['prim']};--prim-lt:{p['prim_lt']};--sec:{p['sec']};--sec-lt:{p['sec_lt']};--bone:{p['bone']};--slate:{p['slate']};--hair:{p['hair']};}}
*{{box-sizing:border-box;}}
html,body{{margin:0;}}
body{{background:radial-gradient(140% 100% at 50% 0%,var(--raised) 0%,var(--ink) 60%,var(--deep) 100%);color:var(--bone);font-family:Archivo,"Helvetica Neue",Arial,sans-serif;line-height:1.6;min-height:100vh;}}
main{{max-width:720px;margin:0 auto;padding:56px 22px 72px;}}
.eyebrow{{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.28em;color:var(--slate);text-transform:uppercase;margin:0 0 10px;}}
h1{{font-size:clamp(26px,5vw,36px);font-weight:800;line-height:1.15;margin:0 0 6px;}}
h1 .alias{{color:var(--sec);}}
h2{{font-size:20px;font-weight:700;margin:34px 0 8px;}}
.lead{{font-size:17px;margin:0 0 18px;color:var(--bone);opacity:.9;}}
p,li{{opacity:.92;}}
a{{color:var(--sec);}}
strong{{color:var(--bone);}}
.resolve{{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;}}
.resolve input{{flex:1 1 200px;min-width:0;background:var(--ink);border:1px solid var(--hair);color:var(--bone);border-radius:8px;padding:10px 12px;font:inherit;}}
.resolve button,.wallet{{background:var(--prim);color:#12131a;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;}}
.wallet{{background:transparent;color:var(--slate);border:1px solid var(--hair);cursor:not-allowed;}}
.status{{border-left:2px solid var(--hair);padding:10px 14px;margin:16px 0;color:var(--slate);font-size:14px;}}
.status.error{{border-color:var(--prim);color:var(--prim-lt);}}
.badges{{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:12px;}}
.badge{{display:flex;gap:14px;align-items:center;background:rgba(27,37,64,.5);border:1px solid var(--hair);border-radius:12px;padding:12px 14px;}}
.badge img{{width:64px;height:64px;flex:none;border-radius:8px;background:var(--ink);}}
.badge .meta{{flex:1 1 auto;min-width:0;}}
.badge .mt{{font-weight:700;margin:0 0 2px;}}
.badge .ct{{font-size:13px;color:var(--slate);margin:0;}}
.state{{display:inline-block;font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-top:6px;}}
.state.anchored{{background:rgba(91,184,212,.15);color:var(--sec-lt);}}
.state.signed{{background:rgba(91,184,212,.22);color:var(--sec-lt);}}
.state.suspended{{background:rgba(238,108,58,.16);color:var(--prim-lt);}}
.state.unknown{{background:rgba(110,122,152,.16);color:var(--slate);}}
.badge .li{{font-size:12px;margin-top:6px;display:inline-block;}}
.note{{font-size:13px;color:var(--slate);border-left:2px solid var(--hair);padding-left:14px;margin:26px 0;}}
.back{{display:inline-block;margin-top:30px;font-size:13px;color:var(--sec);text-decoration:none;}}
noscript{{display:block;margin:16px 0;color:var(--prim-lt);}}
</style>
</head>
<body>
<main>
<p class="eyebrow">Credential holder</p>
<h1>Badges held by <span class="alias" data-holder-alias>this holder</span></h1>
<p class="lead">A live view of one holder's Andamio credential badges — each shown
   with its current on-chain and suspension state, read live from Andamio's
   public indexer.</p>

<form class="resolve" data-holder-form>
  <input type="text" data-holder-input placeholder="Look up a holder by alias"
         aria-label="Holder alias" autocomplete="off"
         pattern="[A-Za-z0-9_-]{{1,64}}">
  <button type="submit">View badges</button>
  <button type="button" class="wallet" disabled
          title="Wallet-connect resolution is coming; look up by alias for now">
    Connect wallet (coming soon)
  </button>
</form>

<noscript>This view reads live blockchain state in your browser, so it needs
  JavaScript. With it off, verify any badge from its page instead — see
  <a href="/badges/how-to-check">how to check a badge</a>.</noscript>

<div class="status" data-holder-status role="status" aria-live="polite">
  Loading live credential state&hellip;</div>

<ul class="badges" data-holder-list hidden></ul>

<h2>What "verified" and "suspended" mean here</h2>
<p>Each badge is checked against live public data when this page loads:</p>
<ul>
  <li><strong>Anchored on-chain</strong> — this holder's on-chain state records
      the credential. That anchor is the identity; it needs no trust in
      {ISSUER}.</li>
  <li><strong>Signed</strong> — the badge additionally carries a cryptographic
      Data Integrity proof you can verify with an independent
      DI-capable OB 3.0 / VC verifier. Most badges are presentation-only for now
      and prove themselves by their anchor; signing is rolling out.</li>
  <li><strong>Suspended (key-version)</strong> — the signing key that covers this
      badge is currently flagged on the status list. This is a
      <strong>key-version</strong> signal (the key-compromise kill-switch), <em>not</em>
      a statement that the holder did not earn the credential. The chain remains
      authoritative.</li>
</ul>
<p class="note"><strong>Status.</strong> This viewer reads live state from
   Andamio's own public indexer — it is a convenience view, not an independent
   verifier, and it does not itself assert a signature is cryptographically
   valid. To confirm a badge <strong>without trusting {ISSUER}</strong> — chase
   its on-chain anchor on a public explorer and check any signature with a
   DI-capable OB 3.0 / VC verifier — follow the
   <a href="{GUIDANCE_URL}">guide to checking a badge</a>. If live state can't be
   loaded, this page says so plainly rather than showing anything as verified.</p>

<p><a class="back" href="/badges/how-to-check">How do I check a badge myself? &rarr;</a></p>
</main>
<script type="module" src="/badges/_holder.js"></script>
</body>
</html>
"""


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "_holder.html"), "w", encoding="utf-8") as f:
        f.write(_shell())
    with open(os.path.join(out, "_registry.json"), "w", encoding="utf-8") as f:
        json.dump(build_registry(), f, ensure_ascii=False, indent=0, sort_keys=True)
        f.write("\n")
    print(f"wrote holder viewer shell + registry -> {os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
