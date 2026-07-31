#!/usr/bin/env python3
"""Generate the standalone holder credential viewer (#73).

  /badges/{policy_id}.{slt_hash}/{alias}   ->  the committed shell _holder.html

A single static, branded shell served for any holder path by the #73 nginx
route (KTD-7 of the #70 plan reserved this subpath). Its client JS
(``badges/_holder.js``) reads {stem}+{alias} from ``location.pathname``, resolves
the holder's LIVE on-chain state (same-origin via the ``/holder-api/`` proxy,
because andamioscan.io sends no CORS headers) and the suspension status list
(same-origin ``/status/``), then renders an explicit VERDICT for the badge named
in the URL plus every badge the holder holds. This viewer OWNS the human-facing
suspension-rendering UX (v1.1 tradeoff P1bis-02).

Phase 3 (docs/plans/2026-07-28-003-feat-phase3-verification-states-plan.md) gave
the shell the verdict region and the named-state legend. The states it can
honestly produce are anchored / anchored-signature-not-checked / suspended /
not-found / indeterminate. It never produces "signature valid" (nothing here
checks a Data Integrity proof) and never produces "revoked" (absence and indexer
lag are indistinguishable from the browser) — the legend says both out loud.

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

import canon
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

# The viewer is a general page, never per-credential. Under the canon there is
# no palette to choose: every surface is canon paper (see canon.py).


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
    """The branded holder-viewer shell (canon paper/ink + canon type). All
    dynamic content is filled by /badges/_holder.js from the live state; the
    static frame carries the suspension legend + verification framing so they
    render even before (or without) JS.

    Colour comes from ``canon.py``; type from ``gen.PAGE_FONT_FACE``, never
    ``gen.FONT_FACE`` — that one is inlined into the signed badge SVGs."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credential holder · {ISSUER} Credentials</title>
<meta name="description" content="A holder's Andamio credential badges with live on-chain and suspension state, read from Andamio's public indexer. To verify a badge without trusting Andamio, follow the independent check.">
<meta name="theme-color" content="{canon.PAPER}">
<meta name="robots" content="noindex">
<style>
{gen.PAGE_FONT_FACE}
:root{{{canon.root_block()}}}
*{{box-sizing:border-box;}}
html,body{{margin:0;}}
body{{background:var(--paper);color:var(--ink);font-family:{canon.SANS};line-height:1.6;min-height:100vh;}}
main{{max-width:720px;margin:0 auto;padding:56px 22px 72px;}}
/* Sentence-case label — the mono-uppercase kicker was retired upstream. */
.eyebrow{{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 10px;}}
h1{{font-size:clamp(26px,5vw,36px);font-weight:600;letter-spacing:{canon.DISPLAY_TRACKING};line-height:1.15;margin:0 0 6px;}}
h1 .alias{{color:var(--blue);}}
h2{{font-size:20px;font-weight:600;margin:34px 0 8px;}}
.lead{{font-size:17px;margin:0 0 18px;color:var(--muted);}}
a{{color:var(--blue);}}
strong{{color:var(--ink);}}
.resolve{{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 12px;}}
/* The field's fill matches the page ground, so its border is the only thing
   rendering the control. --cell (.15) composites to ~1.40:1 on paper, under
   WCAG 1.4.11's 3:1 for UI-component boundaries; --ghost (.30) clears it. */
.resolve input{{flex:1 1 200px;min-width:0;background:var(--paper);border:1px solid var(--ghost);color:var(--ink);padding:10px 12px;font:inherit;}}
.resolve input:hover{{border-color:var(--ink);}}
/* The page's ONE orange role: a single primary action (canon whitelist). */
.resolve button{{background:var(--orange);color:var(--ink);border:1px solid var(--orange);padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;}}
/* The wallet control is a DISABLED secondary, and it must out-specify
   `.resolve button` to say so. It previously did not: `.resolve button` (0,1,1)
   beat `.wallet` (0,1,0), so the intended transparent treatment never applied
   and a disabled control rendered as a second filled primary — two orange CTAs
   on one view, which the canon's accent whitelist does not allow. */
.resolve button.wallet{{background:transparent;color:var(--muted);border:1px solid var(--cell);cursor:not-allowed;font-weight:400;}}
.status{{border-left:2px solid var(--cell);padding:10px 14px;margin:16px 0;color:var(--muted);font-size:14px;}}
.status.error{{border-left-color:var(--ink);color:var(--ink);}}
.verdict{{border:1px solid var(--hairline);border-left-width:3px;padding:16px 18px;margin:18px 0 6px;background:var(--grid);}}
.verdict .vlabel{{font-size:12px;font-weight:600;color:var(--muted);margin:0 0 6px;}}
.verdict .vhead{{font-size:17px;font-weight:600;color:var(--ink);margin:0 0 6px;}}
.verdict .vdetail{{font-size:14px;color:var(--muted);margin:0;}}
.verdict .vlink{{font-size:13px;margin:10px 0 0;}}
/* State is carried by the label text and heading, which name it outright; the
   rule weight is reinforcement, never the only signal. Attention states take
   solid ink, settled states the neutral cell hairline — the same two-way split
   the dark theme had, where suspended and not-found already shared one colour. */
.verdict.anchored,.verdict.signature-unavailable{{border-left-color:var(--cell);}}
.verdict.suspended{{border-left-color:var(--ink);}}
.verdict.not-found{{border-left-color:var(--ink);}}
.verdict.indeterminate{{border-left-color:var(--ghost);}}
.badges{{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:12px;}}
.badge{{display:flex;gap:14px;align-items:center;background:var(--paper);border:1px solid var(--hairline);padding:12px 14px;}}
.badge img{{width:64px;height:64px;flex:none;background:var(--coral);}}
.badge .meta{{flex:1 1 auto;min-width:0;}}
.badge .mt{{font-weight:600;margin:0 0 2px;}}
.badge .ct{{font-size:13px;color:var(--muted);margin:0;}}
.state{{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;margin-top:6px;border:1px solid var(--cell);color:var(--muted);}}
.state.anchored,.state.signature-unavailable{{border-color:var(--cell);color:var(--ink);}}
.state.suspended{{border-color:var(--ink);color:var(--ink);}}
.state.indeterminate{{border-color:var(--hairline);color:var(--muted);}}
.badge .owner,.badge .anchor{{font-size:12px;color:var(--muted);margin:6px 0 0;}}
.badge .pseudonym{{color:var(--ink);}}
.badge code.cid{{font-family:{canon.MONO};font-size:11px;overflow-wrap:anywhere;word-break:break-all;}}
.badge .li{{font-size:12px;margin-top:6px;display:inline-block;}}
.note{{font-size:13px;color:var(--muted);border-left:2px solid var(--cell);padding-left:14px;margin:26px 0;}}
.back{{display:inline-block;margin-top:30px;font-size:13px;color:var(--blue);text-decoration:none;}}
noscript{{display:block;margin:16px 0;color:var(--ink);}}
:focus-visible{{outline:2px solid var(--ink);outline-offset:3px;}}
</style>
</head>
<body>
<main>
<p class="eyebrow">Credential holder</p>
<h1>This credential, and every badge held by <span class="alias" data-holder-alias>this holder</span></h1>
<p class="lead">A live view of one holder's Andamio credential badges — each shown
   with its current on-chain and suspension state, read live from Andamio's
   public indexer.</p>

<!-- Arrival verdict: the explicit answer to the question this URL asks — does
     THIS holder hold THIS credential? Filled by _holder.js on load; hidden
     until then so no state is ever implied before the live read completes. -->
<div class="verdict indeterminate" data-holder-verdict role="status" aria-live="polite" hidden></div>

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

<h2>What each state means here</h2>
<p>Each badge is checked against live public data when this page loads, and lands
   in exactly one of these states:</p>
<ul>
  <li><strong>Anchored on-chain</strong> — this holder's on-chain state records
      the credential. That anchor is the identity; it needs no trust in
      {ISSUER}. This badge carries no cryptographic signature yet, so the chain
      is the proof.</li>
  <li><strong>Anchored · signature not checked here</strong> — the anchor is
      recorded <em>and</em> the badge carries a Data Integrity proof. This page
      does <em>not</em> check that proof. To check it, take the badge to a
      DI-capable OB 3.0 / VC verifier. Most badges are presentation-only for now
      and prove themselves by their anchor; signing is rolling out.</li>
  <li><strong>Suspended (key-version)</strong> — the signing key that covers this
      badge is currently flagged on the status list. This is a
      <strong>key-version</strong> signal (the key-compromise kill-switch), <em>not</em>
      a statement that the holder did not earn the credential. The chain remains
      authoritative.</li>
  <li><strong>Not found for this holder</strong> — this holder's live on-chain
      state does not record the credential named in the address bar. That is
      <em>not</em> proof it was never earned: a very recently claimed credential
      can take time to appear in the indexer, and the chain overrides anything
      this page says.</li>
  <li><strong>Indeterminate</strong> — live state could not be read, so this page
      cannot answer. Nothing is shown as verified. Retry, or read the chain
      directly.</li>
</ul>
<p>Two states you will never see here, deliberately. <strong>"Signature
   valid"</strong> — nothing on this page checks a signature, so it never claims
   one checks out. <strong>"Revoked"</strong> — a credential missing from live
   state and a credential delayed by indexer lag look identical from here, and
   showing a genuine credential as revoked would be worse than saying nothing;
   absence is reported as <em>not found</em>, never as revoked.</p>

<h2>Who stands behind each credential</h2>
<p>An Andamio credential is produced by four parties, and this view names the ones
   the chain actually records:</p>
<ul>
  <li><strong>The course owner</strong> — the pseudonymous person who created the
      course and stands behind what its credentials mean. Shown on each badge
      below, read live from the chain, and omitted rather than guessed if it
      cannot be read.</li>
  <li><strong>The assessor</strong> — the person who evaluated the work.
      <strong>Not recorded on-chain for these credentials</strong>, so this view
      does not name one. A course's teacher roster is not the same fact as "who
      assessed this credential", and {ISSUER} will not present it as if it were.</li>
  <li><strong>The chain</strong> — Cardano, the immutable record of what happened
      and when. Each badge below carries its on-chain course id, which is the
      course's minting policy: look it up on any public Cardano explorer, or open
      it on andamioscan.</li>
  <li><strong>{ISSUER}</strong> — anchors the credential on-chain and signs the
      portable copy. It attests that the on-chain record is real, not that the
      achievement is significant.</li>
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
