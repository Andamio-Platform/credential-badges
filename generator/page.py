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
import base64
import json
import os
import sys
from urllib.parse import quote

import canon
import colors
from gen import esc, HOST, ISSUER
from render import sanitize_title
from build import SKIP_COURSES

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "credentials.json")
DEFAULT_OUT = os.path.join(HERE, "..", "badges")

OG_W, OG_H = 1200, 630

# The canon page faces (Inter + JetBrains Mono), base64-embedded by
# embed_fonts.py. DELIBERATELY NOT gen.FONT_FACE: that constant comes from
# fonts.css, which the badge SVGs, OG cards, explainers and holder viewer all
# inline — and the badge SVGs are the signed class artifacts. Sharing the file
# would mean a page-styling change rewrote 58 signed credentials.
_PAGE_FONTCSS = os.path.join(HERE, "page_fonts.css")
PAGE_FONT_FACE = (open(_PAGE_FONTCSS, encoding="utf-8").read()
                  if os.path.exists(_PAGE_FONTCSS) else "")

# The Andamio brand mark, base64-inlined as a data: URI.
#
# It is a RASTER, and that is not a shortcut — no vector form of this logo
# exists. Every "*.svg" logo in the landing repo is a base64 PNG wrapped in an
# <svg> element (andamio-logo.svg is 8.8 MB of it), and there is no path-based
# logo component in that repo's source either. So the choice was a raster or a
# hand-drawn approximation, and an approximation of a brand mark is worse than a
# faithful raster.
#
# Committed here at 239x44 (2x for the 22px nav) quantized to a 32-colour
# palette: 2.4 KB, ~3.3 KB as base64. The no-external-assets invariant is about
# where bytes come FROM, not what format they are — a data: URI ships inside the
# page, makes no request, and beacons to nobody. The plan's U2 step 1 said
# "inline SVG, never an <img src>"; this is an <img> whose src is a data: URI,
# which honours the invariant's purpose while its letter assumed a vector that
# does not exist.
_LOGO_PNG = os.path.join(HERE, "andamio-logo.png")
LOGO_DATA_URI = (
    "data:image/png;base64," +
    base64.b64encode(open(_LOGO_PNG, "rb").read()).decode()
    if os.path.exists(_LOGO_PNG) else "")

# Holder action order (#101 KTD4/Q1). With no promoted primary, whichever action
# leads IS the page's primary call to action, so the order is stated here rather
# than inherited from the accretion order of #71. Download SVG leads: it is
# present regardless of JS (the copy/share controls ship hidden until their API
# is confirmed) and it is the artifact itself rather than a pointer to it.
# add-to-LinkedIn-profile stays last while ORG_ID is unset and the deep link
# still names the organisation by fallback.

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


def _is_baked(stem):
    """True if the committed badge SVG carries a signed VC (``proofValue``) — a
    Flagship-style signed credential, not presentation-only (CONCEPTS: Baking /
    Flagship Badge). Reads the committed badges/ tree (DEFAULT_OUT), independent
    of the page output dir, so the baked state is a stable property of the
    artifact. Every committed badge now carries a signed class artifact, but the
    presentation-only branch is retained deliberately: it is what keeps the
    Wording Gate honest for any badge rendered before it is signed, and the
    verifiability copy must never overclaim for one."""
    try:
        with open(os.path.join(DEFAULT_OUT, f"{stem}.svg"), encoding="utf-8") as f:
            return "proofValue" in f.read()
    except OSError:
        return False


def _ctx(rec):
    """Per-credential fields shared by the page and embed builders — one source
    for the stem, sanitized titles, palette, canonical page URL, and baked
    state, so the two builders can't drift."""
    course_id, slt_hash = rec["course_id"], rec["slt_hash"]
    stem = f"{course_id}.{slt_hash}"
    return {
        "course_id": course_id, "slt_hash": slt_hash, "stem": stem,
        "course_title": sanitize_title(rec["course_title"]) or ISSUER,
        "module_title": sanitize_title(rec["module_title"]) or "Credential",
        "pal": colors.palette_for(course_id),
        "page_url": f"{HOST}/badges/{stem}",
        "baked": _is_baked(stem),
    }


def _embed_snippet(stem):
    """The iframe embed snippet a third party pastes into their own page. Points
    at the minimal embed variant (U2), served at the extensionless
    /badges/{stem}.embed by the #70 routing."""
    src = f"{HOST}/badges/{stem}.embed"
    return (f'<iframe src="{src}" width="{EMBED_W}" height="{EMBED_H}" '
            f'style="border:0" loading="lazy" title="Andamio credential badge">'
            f'</iframe>')


def _web_component_snippet(stem, module_title, course_title, baked):
    """The <andamio-badge> web-component snippet (#74) — the upgrade path from the
    iframe embed. A third party loads the component from OUR origin and drops one
    element; it renders the badge card + honest baked-aware state + a link back.
    Attribute-driven: the component runs cross-origin and can't fetch our host, so
    the titles + signed flag travel in the snippet. ``baked`` gates the ``signed``
    attribute — never present for a presentation-only badge, so the component can't
    overclaim a signature. Inner titles are HTML-escaped for the snippet's own
    attribute context; the whole snippet is escaped again when it lands in the
    data-* container (see _share_controls)."""
    signed = " signed" if baked else ""
    return (f'<script type="module" src="{HOST}/embed/andamio-badge.js"></script>\n'
            f'<andamio-badge stem="{stem}" module-title="{esc(module_title)}" '
            f'course-title="{esc(course_title)}"{signed}></andamio-badge>')


def _share_controls(stem, module_title, course_title, page_url, baked):
    """The share-actions region: downloads + copy + social + Web Share + embed +
    LinkedIn add-to-profile. Downloads and social links are plain anchors (work
    with JS disabled); copy-link / Web Share / copy-embed are buttons revealed by
    the inline script only when their browser API exists (no dead buttons).

    ``baked`` gates what the download note may claim: only a signed/baked SVG
    *is* the credential itself (CONCEPTS: Flagship Badge); for the
    presentation-only majority the SVG carries the credential's data, anchored
    on-chain. Either way this note makes NO verification claim — that lives once,
    in _verify_note, so the page doesn't repeat the same caveat twice (#82)."""
    x_url = (f"https://twitter.com/intent/tweet?url={_q(page_url)}"
             f"&text={_q(module_title)}&hashtags={HASHTAGS}")
    li_share = f"https://www.linkedin.com/sharing/share-offsite/?url={_q(page_url)}"
    org = f"organizationId={ORG_ID}" if ORG_ID else f"organizationName={_q(ORG_NAME)}"
    li_add = (f"https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME"
              f"&name={_q(module_title)}&{org}&certUrl={_q(page_url)}"
              f"&certId={_q(stem)}")
    embed = esc(_embed_snippet(stem))    # HTML-attribute-escaped for data-embed
    embed_wc = esc(_web_component_snippet(stem, module_title, course_title, baked))
    # NOTE ON ATTRIBUTE ORDER: every new attribute goes BEFORE the data-* hook.
    # test_progressive_enhancement_buttons_hidden_and_script_present asserts the
    # literal substrings 'data-share-copy hidden' / 'data-share-web hidden' /
    # 'data-share-embed data-embed=', so anything inserted between a hook and
    # `hidden` fails the test with every hook intact. Same for the download
    # anchor: .github/workflows/ci.yml greps `href="/badges/{{stem}}.svg" download`
    # against the delivered page, a required check that lives outside this suite.
    return f"""<p class="glabel" id="holder-actions-label">For the person who earned this</p>
  <div class="actions" data-slot="share-actions" role="group" aria-labelledby="holder-actions-label">
    <a class="btn" href="/badges/{stem}.svg" download>Download SVG</a>
    <a class="btn" href="/badges/{stem}.png" download>Download PNG</a>
    <button class="btn" type="button" data-share-copy hidden>Copy link</button>
    <button class="btn" type="button" data-share-web hidden>Share&hellip;</button>
    <a class="btn" href="{esc(li_share)}" target="_blank" rel="noopener">Share on LinkedIn</a>
    <a class="btn" href="{esc(x_url)}" target="_blank" rel="noopener">Share on X</a>
    <a class="btn" href="{esc(li_add)}" target="_blank" rel="noopener">Add to LinkedIn profile</a>
  </div>
  <p class="actions-note">{_svg_note(baked)}</p>
  <details class="embed-group">
    <summary><span class="glabel">Embed this badge</span><span class="chev" aria-hidden="true"></span></summary>
    <div class="actions embed-actions">
      <button class="btn" type="button" data-share-embed data-embed="{embed}" hidden>Copy embed code</button>
      <button class="btn" type="button" data-share-embed-wc data-embed="{embed_wc}" hidden>Copy web-component embed</button>
    </div>
  </details>"""


def _svg_note(baked):
    """Baked-aware download copy — a PURE DOWNLOAD AFFORDANCE (#82).

    This note answers "which file do I download"; _verify_note answers "how is
    this checked". The verification caveat used to leak into BOTH, so the page
    carried two near-identical grey paragraphs ~100px apart, in the densest
    technical language on a page whose primary visitor is the holder who just
    earned the credential. The caveat now lives once, in _verify_note.

    Keep it free of verification claims — no verifier class, no "rolling out".
    The unbaked branch's "anchored on-chain" stays: that is a property of the
    data being downloaded, not a claim about who can check it (and it is the
    positive anchor test_verifiability_copy_is_baked_aware reads for R7)."""
    if baked:
        return ("The <strong>SVG</strong> is the signed credential itself — "
                "download it to keep or share. The PNG is for display.")
    return ("Download the <strong>SVG</strong> — it carries this credential's "
            "data, anchored on-chain. The PNG is for display.")


# Inline progressive-enhancement script: reveals + wires the three JS-only
# controls when their API exists. No external calls; copies location.href / the
# embed snippet; Web Share uses the native sheet on a real click.
_SHARE_SCRIPT = """<script>
(function(){
  // Capture the true label once (data-label) so a rapid re-click can't strand
  // the button on the transient 'Copied!' text.
  function flash(b,m){if(!b.dataset.label)b.dataset.label=b.textContent;b.textContent=m;
    clearTimeout(b._t);b._t=setTimeout(function(){b.textContent=b.dataset.label;},1500);}
  function copyTo(b,text,ok){navigator.clipboard.writeText(text)
    .then(function(){flash(b,ok);}).catch(function(){flash(b,'Copy failed');});}
  var copy=document.querySelector('[data-share-copy]');
  if(copy&&navigator.clipboard){copy.hidden=false;copy.addEventListener('click',function(){
    copyTo(copy,location.href,'Copied!');});}
  var emb=document.querySelector('[data-share-embed]');
  if(emb&&navigator.clipboard){emb.hidden=false;emb.addEventListener('click',function(){
    copyTo(emb,emb.getAttribute('data-embed'),'Embed copied!');});}
  var embw=document.querySelector('[data-share-embed-wc]');
  if(embw&&navigator.clipboard){embw.hidden=false;embw.addEventListener('click',function(){
    copyTo(embw,embw.getAttribute('data-embed'),'Embed copied!');});}
  var ws=document.querySelector('[data-share-web]');
  if(ws&&navigator.share){ws.hidden=false;ws.addEventListener('click',function(){
    navigator.share({title:document.title,url:location.href}).catch(function(){});});}
})();
</script>"""


def _verify_note(baked):
    """Baked-aware footer copy about how this badge is checked — the page's ONE
    verification caveat (#82), written for the holder rather than a verifier.

    The precise class name ("DI-capable OB 3.0 / VC verifiers") lives on the
    how-to-check explainer, which this note links inline. But the BOUND it
    carries must survive the plainer wording: dropping the qualifier entirely
    does not narrow the claim, it removes the ceiling and lets the reader supply
    the broadest one. That ceiling is real — the explainer warns that verifiers
    reading only JWS-style credentials will not read this proof format, and the
    verifier spike recorded one that structurally cannot. An employer who reads
    "anyone can check it", runs a mainstream OB3 tool and gets a failure
    concludes a genuine credential is fraudulent. So: "compatible verifier
    software" — plain, but still a bound. Never "anyone", never "any verifier".

    The link label deliberately differs from the .explainers slot's "How do I
    check this?" (which sits just above the divider): identical label + href a
    few lines apart reads as accidental duplication and announces twice to a
    screen reader. One label per affordance — a nav item and an inline citation.
    """
    link = ('<a href="/badges/how-to-check">How this badge is checked</a>')
    if baked:
        return (f"This badge is anchored on Cardano, and the SVG you can "
                f"download is signed — check it with compatible verifier "
                f"software, without taking {ISSUER}'s word for it. {link}")
    # NB: no explorer-lookup invitation on this branch. An unbaked SVG carries
    # andamio:onChainAnchor with only {network, courseId, sltHash} — no claim
    # transaction hash and no on-chain asset — so there is nothing for a reader
    # to look up. Only a baked credential carries the evidence entry the
    # explainer's step 3 walks through.
    return ("This badge is anchored on Cardano — the public blockchain record "
            "is the proof. A signed copy you can check with compatible "
            f"verifier software is rolling out. {link}")


def _description(course_title, module_title, baked):
    # Wording-gated: "DI-capable OB 3.0 / VC verifiers", never "any OB3 verifier".
    # Only a baked/signed badge is claimed checkable; the rest are anchored-only.
    if baked:
        return (f"{module_title} — a signed credential from {course_title}, "
                f"anchored on Cardano and checkable by DI-capable OB 3.0 / VC "
                f"verifiers.")
    return (f"{module_title} — a credential from {course_title}, anchored on "
            f"Cardano.")


def _page_html(rec):
    ctx = _ctx(rec)
    stem, course_title, module_title = ctx["stem"], ctx["course_title"], ctx["module_title"]
    baked, page_url = ctx["baked"], ctx["page_url"]
    desc = _description(course_title, module_title, baked)

    # The per-course palette no longer feeds this page's chrome (#101 KTD2). It
    # still feeds the badge artwork, the embed variant and the OG card, so
    # colors.palette_for stays imported and ctx["pal"] stays populated —
    # _embed_html reads it.
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
<meta name="theme-color" content="{canon.PAPER}">
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
{PAGE_FONT_FACE}
:root{{{canon.root_block()}}}
*{{box-sizing:border-box;}}
html,body{{margin:0;}}
/* [hidden] must beat any author display rule. The four progressive-enhancement
   controls rely on the UA's [hidden]{{display:none}}, which an author-origin
   `display` on .btn would silently override — shipping four dead buttons to a
   no-JS visitor while the markup-only test stays green. Declared first, !important. */
[hidden]{{display:none!important;}}
body{{background:var(--paper);color:var(--ink);font-family:{canon.SANS};font-size:15px;line-height:1.55;min-height:100vh;}}
.nav{{display:flex;align-items:center;gap:10px;padding:0 24px;height:{canon.NAV_CLEARANCE};border-bottom:1px solid var(--rule);}}
/* Cross-host navigation off the static trust surface, same tab, deliberate
   (#101 KTD10). The mark is inline SVG, never an <img src>: a logo pulled from
   another origin would breach the no-external-assets invariant and make every
   credential view beacon to a host this page's integrity does not cover. */
.brand{{display:inline-flex;align-items:center;text-decoration:none;}}
/* The brand mark carries brand orange — a role the canon's accent whitelist
   permits explicitly ("Brand mark, the single primary CTA, the live pulse dot,
   the VERIFIED stamp"). It is raster, so it is not a CSS accent: the page's one
   stylesheet-controlled accent is still the verification tile, and nothing else
   in this stylesheet paints orange. */
.mark{{display:block;height:22px;width:auto;}}
.wrap{{max-width:{canon.MEASURE};margin:0 auto;padding:28px 24px 40px;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:0;align-items:start;}}
.specimen{{padding-right:36px;}}
.detail{{padding-left:36px;border-left:1px solid var(--cell);min-width:0;}}
.frame{{border:1px solid var(--hairline);}}
.frame-head{{font-size:13px;font-weight:600;padding:10px 14px;border-bottom:1px solid var(--hairline);}}
.plate{{background:var(--coral);padding:26px;}}
.badge{{width:100%;max-width:320px;height:auto;display:block;margin:0 auto;}}
.frame-cap{{font-size:13px;color:var(--muted);padding:10px 14px;border-top:1px solid var(--hairline);}}
h1{{font-size:clamp(24px,3.2vw,34px);font-weight:600;line-height:1.15;letter-spacing:{canon.DISPLAY_TRACKING};margin:0 0 6px;}}
.glabel{{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 8px;}}
.course{{font-size:16px;margin:0 0 2px;}}
.issuer{{font-size:13px;color:var(--muted);margin:0 0 22px;}}
.divider{{height:1px;background:var(--hairline);border:0;margin:22px 0;}}
.verify{{font-size:13px;line-height:1.6;color:var(--muted);max-width:56ch;margin:0;}}
.verify a{{color:var(--blue);text-decoration:none;border-bottom:1px solid transparent;}}
.verify a:hover{{border-bottom-color:var(--blue);}}
/* The course id, adjacent to the inline verification citation and labelled with
   the job it does — the value the explainer asks a reader to match on-chain.
   A sibling of .verify, never inside it: _slot() splits to the first </p>. */
.cid{{font-size:12px;color:var(--muted);max-width:56ch;margin:10px 0 0;}}
.cid code{{font-family:{canon.MONO};overflow-wrap:anywhere;color:var(--ink);}}
.actions:empty,.explainers:empty{{display:none;}}
.actions{{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 12px;}}
.btn{{appearance:none;cursor:pointer;font:inherit;font-size:13px;display:inline-flex;align-items:center;padding:9px 14px;border:1px solid var(--cell);background:var(--paper);color:var(--ink);text-decoration:none;}}
.btn:hover{{border-color:var(--ink);}}
.actions-note{{font-size:12px;line-height:1.6;color:var(--muted);max-width:56ch;margin:0 0 18px;}}
.actions-note strong{{color:var(--ink);}}
/* Collapse the disclosure when both its controls are hidden. :empty cannot do
   this — the buttons are always emitted as children and merely `hidden` — and
   revealing it from JS would mean editing _SHARE_SCRIPT, which is frozen. */
.embed-group:not(:has(button:not([hidden]))){{display:none;}}
.embed-group{{border-top:1px solid var(--hairline);padding-top:14px;}}
.embed-group summary{{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;}}
.embed-group summary::-webkit-details-marker{{display:none;}}
.embed-group summary .glabel{{margin:0;}}
.chev{{width:8px;height:8px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);transition:transform .15s;}}
.embed-group[open] .chev{{transform:rotate(-135deg);}}
.embed-actions{{margin:12px 0 0;}}
.explainers{{display:flex;flex-wrap:wrap;gap:18px;margin:18px 0 0;}}
.explainer{{font-size:13px;color:var(--blue);text-decoration:none;border-bottom:1px solid transparent;display:inline-flex;align-items:center;gap:8px;}}
.explainer:hover{{border-bottom-color:var(--blue);}}
/* The page's ONE orange accent (#101 KTD9), on the verification route — the
   stranger's whole reason for being here. It marks the PATH, never the
   conclusion: nothing here may read as "a signature was checked". Carried by a
   non-text tile, never text colour — brand orange on paper is ~2.8:1 and fails
   AA, and the canon reserves links for blue. */
.tile{{width:8px;height:8px;background:var(--orange);flex:none;}}
a{{color:var(--blue);}}
:focus-visible{{outline:2px solid var(--ink);outline-offset:3px;}}
@media (max-width:900px){{
  .wrap{{grid-template-columns:1fr;padding:20px 18px 32px;}}
  .specimen{{padding-right:0;}}
  .detail{{padding-left:0;border-left:0;border-top:1px solid var(--cell);margin-top:22px;padding-top:22px;}}
  /* Cap the specimen so the first holder action stays above the fold on a
     phone — the holder's most likely visit, and the one viewport R3 omits. */
  .badge{{max-width:200px;}}
  .plate{{padding:16px;}}
  .btn{{min-height:44px;}}
}}
</style>
</head>"""

    # Body: badge image + titles + issuer, then the reserved slots and a
    # wording-gated verify note. #71/#72 attach into the marked slots.
    body = f"""
<body>
<header class="nav">
  <a class="brand" href="https://www.andamio.io">
    <img class="mark" src="{LOGO_DATA_URI}" width="120" height="22" alt="{ISSUER}"
         decoding="async"></a>
</header>
<main class="wrap">
  <section class="specimen">
    <div class="frame">
      <div class="frame-head">Credential</div>
      <div class="plate">
        <img class="badge" src="{svg_url}" width="360" height="360"
             alt="{esc(module_title)} — {esc(course_title)} credential badge"
             loading="eager" decoding="async">
      </div>
      <div class="frame-cap">{esc(course_title)}</div>
    </div>
  </section>
  <section class="detail">
    <h1>{esc(module_title)}</h1>
    <p class="course">{esc(course_title)}</p>
    <p class="issuer">Issued by {ISSUER}</p>

  {_share_controls(stem, module_title, course_title, page_url, baked)}
  <div class="explainers" data-slot="explainers">
    <a class="explainer" href="/badges/how-to-share">How do I share this?</a>
    <a class="explainer" href="/badges/how-to-check"><span class="tile"></span>How do I check this?</a>
  </div>

  <hr class="divider">
  <p class="verify">{_verify_note(baked)}</p>
  <p class="cid">Course id — the value that explainer asks you to match on-chain:
    <code>{esc(ctx["course_id"])}</code></p>
  </section>
</main>
{_SHARE_SCRIPT}
</body>
</html>
"""
    return head + body


def _embed_html(rec):
    """The minimal per-badge embed variant (#71). Just the badge image linking
    to the display page — no share chrome — sized for the iframe snippet. Served
    at the extensionless /badges/{stem}.embed by the #70 routing. Root-relative
    image src resolves against the iframe's own origin (credentials.andamio.io);
    the link breaks out of the iframe (target=_blank) to the full page.

    The image's ``margin:0 auto`` is load-bearing, not decoration (#81): the flex
    ``align-items:center`` centres the ANCHORS, but the image's percentage width
    can't resolve during intrinsic sizing, so the wrapping anchor falls back to
    the badge's intrinsic width (1024) and clamps to the iframe width. The block
    image then sits hard left of an anchor wider than it, offset growing with
    width. The auto margins centre it, and resolve to 0 when the anchor
    shrink-wraps — so they never move the working case. Mirrors the badge page's
    own .badge rule."""
    ctx = _ctx(rec)
    stem, module_title, page_url = ctx["stem"], ctx["module_title"], ctx["page_url"]
    ink, bone, sec = ctx["pal"]["ink"], ctx["pal"]["bone"], ctx["pal"]["sec"]
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(module_title)} — {ISSUER} credential</title>
<style>
html,body{{margin:0;height:100%;}}
body{{background:{ink};color:{bone};font-family:Archivo,Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:12px;box-sizing:border-box;}}
img{{width:min(240px,72%);height:auto;display:block;margin:0 auto;}}
a{{color:{sec};font-size:12px;text-decoration:none;}}
a:hover{{text-decoration:underline;}}
</style>
</head>
<body>
<a href="{page_url}" target="_blank" rel="noopener">
  <img src="/badges/{stem}.svg" alt="{esc(module_title)} — {ISSUER} credential badge"
       loading="lazy" decoding="async">
</a>
<a href="{page_url}" target="_blank" rel="noopener">View credential &rarr;</a>
</body>
</html>
"""


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    data = [r for r in json.load(open(DATA)) if r["course_id"] not in SKIP_COURSES]
    for rec in data:
        stem = f"{rec['course_id']}.{rec['slt_hash']}"
        # encoding pinned: the templates carry non-ASCII (em dash, arrow), so a
        # C/POSIX-locale build must not fall back to a lossy codec.
        open(os.path.join(out, f"{stem}.html"),
             "w", encoding="utf-8").write(_page_html(rec))
        open(os.path.join(out, f"{stem}.embed.html"),
             "w", encoding="utf-8").write(_embed_html(rec))
    print(f"wrote {len(data)} badge pages + {len(data)} embed variants -> "
          f"{os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
