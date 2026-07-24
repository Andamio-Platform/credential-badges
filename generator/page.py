#!/usr/bin/env python3
"""Generate the static badge display / share page per credential (#70, v1.2).

One self-contained HTML file per non-skipped credential, written into the served
``badges/`` tree and served at the extensionless URL ``/badges/{course_id}.
{slt_hash}`` (nginx serves ``{stem}.html`` there; the ``.svg``/``.png`` URLs are
unchanged). This is the badge-CLASS page — the substrate the share actions (#71)
and explainers (#72) hang on, with a URL scheme the holder viewer (#73) nests
under (``/badges/{stem}/{alias}``).

Server-delivered Open Graph tags live in ``<head>`` so a shared link unfurls with
image + title on X / LinkedIn / Discord / Slack — crawlers do not run JS. The
``og:image`` is the 1200x630 card from #69, referenced by ABSOLUTE HTTPS URL on
the forever-public host.

Presentation-only, never identity-bearing: the SVG carries the verifiable
credential; this page is a human landing surface. Reuses the badge palette
(colors.palette_for) and the title sanitizer (render.sanitize_title) so theming
and glyphs stay single-sourced. No external assets — inline CSS keeps every page
one file and the web root a pure static trust surface.

Usage:
    python3 page.py            # write to ../badges/
    python3 page.py <outdir>   # write elsewhere
"""
import json
import os
import sys
from urllib.parse import quote

import colors
from gen import esc
from render import sanitize_title
from build import SKIP_COURSES

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "credentials.json")
DEFAULT_OUT = os.path.join(HERE, "..", "badges")

# The forever-public host. Single source here, matching gen.py's hard-coded
# https://credentials.andamio.io/context/v1.jsonld and the did:web issuer.
HOST = "https://credentials.andamio.io"
ISSUER = "Andamio"

OG_W, OG_H = 1200, 630

# Share-action config (#71). LinkedIn add-to-profile targets the Andamio Teams
# org: the numeric organizationId is an external input (a Page admin reads it
# from the admin console) — until it is captured, LinkedIn accepts the
# organizationName fallback, so the deep link works now and upgrades in place
# when ORG_ID is set. HASHTAGS are comma-separated with NO '#' (X intent format).
ORG_NAME = "Andamio Teams"
ORG_ID = None                    # numeric LinkedIn organizationId — TBD (external)
HASHTAGS = "Andamio,Cardano"
EMBED_W, EMBED_H = 340, 380      # iframe embed variant dimensions


def _q(s):
    """Percent-encode a query-string value (encode everything non-alphanumeric,
    including '/'), so it is safe inside a share-intent URL."""
    return quote(str(s), safe="")


def _embed_snippet(stem):
    """The iframe embed snippet a third party pastes into their own page. Points
    at the minimal embed variant (U2), served at the extensionless
    /badges/{stem}.embed by the #70 routing."""
    src = f"{HOST}/badges/{stem}.embed"
    return (f'<iframe src="{src}" width="{EMBED_W}" height="{EMBED_H}" '
            f'style="border:0" loading="lazy" title="Andamio credential badge">'
            f'</iframe>')


def _share_controls(stem, module_title, page_url):
    """The share-actions region: downloads + copy + social + Web Share + embed +
    LinkedIn add-to-profile. Downloads and social links are plain anchors (work
    with JS disabled); copy-link / Web Share / copy-embed are buttons revealed by
    the inline script only when their browser API exists (no dead buttons)."""
    x_url = (f"https://twitter.com/intent/tweet?url={_q(page_url)}"
             f"&text={_q(module_title)}&hashtags={HASHTAGS}")
    li_share = f"https://www.linkedin.com/sharing/share-offsite/?url={_q(page_url)}"
    org = f"organizationId={ORG_ID}" if ORG_ID else f"organizationName={_q(ORG_NAME)}"
    li_add = (f"https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME"
              f"&name={_q(module_title)}&{org}&certUrl={_q(page_url)}"
              f"&certId={_q(stem)}")
    embed = esc(_embed_snippet(stem))    # HTML-attribute-escaped for data-embed
    return f"""<div class="actions" data-slot="share-actions">
    <a class="btn" href="/badges/{stem}.svg" download>Download SVG</a>
    <a class="btn" href="/badges/{stem}.png" download>Download PNG</a>
    <button class="btn" type="button" data-share-copy hidden>Copy link</button>
    <a class="btn" href="{esc(x_url)}" target="_blank" rel="noopener">Share on X</a>
    <a class="btn" href="{esc(li_share)}" target="_blank" rel="noopener">Share on LinkedIn</a>
    <button class="btn" type="button" data-share-web hidden>Share&hellip;</button>
    <button class="btn" type="button" data-share-embed data-embed="{embed}" hidden>Copy embed code</button>
    <a class="btn" href="{esc(li_add)}" target="_blank" rel="noopener">Add to LinkedIn profile</a>
  </div>
  <p class="actions-note">The <strong>SVG</strong> is the verifiable credential —
     download it and check it with DI-capable OB 3.0 / VC verifiers. The PNG is
     for display.</p>"""


# Inline progressive-enhancement script: reveals + wires the three JS-only
# controls when their API exists. No external calls; copies location.href / the
# embed snippet; Web Share uses the native sheet on a real click.
_SHARE_SCRIPT = """<script>
(function(){
  function flash(b,m){var t=b.textContent;b.textContent=m;setTimeout(function(){b.textContent=t;},1500);}
  var copy=document.querySelector('[data-share-copy]');
  if(copy&&navigator.clipboard){copy.hidden=false;copy.addEventListener('click',function(){
    navigator.clipboard.writeText(location.href).then(function(){flash(copy,'Copied!');});});}
  var emb=document.querySelector('[data-share-embed]');
  if(emb&&navigator.clipboard){emb.hidden=false;emb.addEventListener('click',function(){
    navigator.clipboard.writeText(emb.getAttribute('data-embed')).then(function(){flash(emb,'Embed copied!');});});}
  var ws=document.querySelector('[data-share-web]');
  if(ws&&navigator.share){ws.hidden=false;ws.addEventListener('click',function(){
    navigator.share({title:document.title,url:location.href}).catch(function(){});});}
})();
</script>"""


def _description(course_title, module_title):
    # Wording-gated: "DI-capable OB 3.0 / VC verifiers", never "any OB3 verifier".
    return (f"{module_title} — a credential from {course_title}, anchored on "
            f"Cardano and independently checkable by DI-capable OB 3.0 / VC "
            f"verifiers.")


def _page_html(rec):
    course_id, slt_hash = rec["course_id"], rec["slt_hash"]
    stem = f"{course_id}.{slt_hash}"
    course_title = sanitize_title(rec["course_title"]) or ISSUER
    module_title = sanitize_title(rec["module_title"]) or "Credential"
    desc = _description(course_title, module_title)

    pal = colors.palette_for(course_id)
    deep, ink, raised = pal["deep"], pal["ink"], pal["raised"]
    prim, prim_lt, sec = pal["prim"], pal["prim_lt"], pal["sec"]
    bone, slate, hair = pal["bone"], pal["slate"], pal["hair"]

    page_url = f"{HOST}/badges/{stem}"
    card_url = f"{HOST}/badges/{stem}.og.png"      # absolute og:image (#69 card)
    svg_url = f"/badges/{stem}.svg"                 # root-relative badge image

    # Head: OG/Twitter tags early, then inline theme.
    head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(module_title)} — {esc(course_title)} · {ISSUER}</title>
<meta name="description" content="{esc(desc)}">
<meta name="theme-color" content="{deep}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{ISSUER} Credentials">
<meta property="og:title" content="{esc(module_title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{page_url}">
<meta property="og:image" content="{card_url}">
<meta property="og:image:width" content="{OG_W}">
<meta property="og:image:height" content="{OG_H}">
<meta property="og:image:alt" content="{esc(module_title)} — {esc(course_title)} credential badge">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(module_title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{card_url}">
<style>
:root{{--deep:{deep};--ink:{ink};--raised:{raised};--prim:{prim};--prim-lt:{prim_lt};--sec:{sec};--bone:{bone};--slate:{slate};--hair:{hair};}}
*{{box-sizing:border-box;}}
html,body{{margin:0;}}
body{{background:radial-gradient(120% 90% at 50% 0%,var(--raised) 0%,var(--ink) 55%,var(--deep) 100%);color:var(--bone);font-family:Archivo,"Helvetica Neue",Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 20px;}}
.card{{width:100%;max-width:560px;text-align:center;}}
.badge{{width:min(360px,80vw);height:auto;display:block;margin:0 auto 28px;}}
.eyebrow{{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.28em;color:var(--slate);text-transform:uppercase;margin:0 0 10px;}}
h1{{font-size:clamp(24px,5vw,34px);font-weight:800;line-height:1.15;margin:0 0 8px;color:var(--bone);}}
.course{{font-size:16px;color:var(--prim-lt);margin:0 0 4px;}}
.issuer{{font-size:13px;color:var(--slate);margin:0 0 28px;}}
.divider{{height:1px;background:var(--hair);border:0;margin:28px auto;max-width:220px;}}
.verify{{font-size:13px;line-height:1.6;color:var(--slate);max-width:44ch;margin:0 auto;}}
.verify a{{color:var(--sec);text-decoration:none;border-bottom:1px solid transparent;}}
.verify a:hover{{border-bottom-color:var(--sec);}}
/* Slots for the share actions (#71) and explainer links (#72). */
.actions:empty,.explainers:empty{{display:none;}}
.actions{{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:0 0 12px;}}
.btn{{appearance:none;cursor:pointer;font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid var(--hair);background:rgba(255,255,255,.04);color:var(--bone);text-decoration:none;}}
.btn:hover{{border-color:var(--sec);color:var(--sec);}}
.actions-note{{font-size:12px;line-height:1.6;color:var(--slate);max-width:44ch;margin:0 auto 22px;}}
.actions-note strong{{color:var(--bone);}}
a{{color:var(--sec);}}
</style>
</head>"""

    # Body: badge image + titles + issuer, then the reserved slots and a
    # wording-gated verify note. #71/#72 attach into the marked slots.
    body = f"""
<body>
<main class="card">
  <img class="badge" src="{svg_url}" width="360" height="360"
       alt="{esc(module_title)} — {esc(course_title)} credential badge"
       loading="eager" decoding="async">
  <p class="eyebrow">Credential</p>
  <h1>{esc(module_title)}</h1>
  <p class="course">{esc(course_title)}</p>
  <p class="issuer">Issued by {ISSUER}</p>

  {_share_controls(stem, module_title, page_url)}
  <!-- explainer links (#72) attach here -->
  <div class="explainers" data-slot="explainers"></div>

  <hr class="divider">
  <p class="verify">This badge is anchored on Cardano. The badge image is a
     self-contained credential you can download and check with DI-capable
     OB 3.0 / VC verifiers — no need to trust {ISSUER}.</p>
</main>
{_SHARE_SCRIPT}
</body>
</html>
"""
    return head + body


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    data = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    for rec in data:
        html = _page_html(rec)
        # encoding pinned: the template always carries non-ASCII (em dash,
        # middot), so a C/POSIX-locale build must not fall back to a lossy codec.
        open(os.path.join(out, f"{rec['course_id']}.{rec['slt_hash']}.html"),
             "w", encoding="utf-8").write(html)
    print(f"wrote {len(data)} badge pages -> {os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
