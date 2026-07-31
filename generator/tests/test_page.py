#!/usr/bin/env python3
"""U1 tests for the badge display / share page generator (generator/page.py, #70).

Guards the page's shape and the server-delivered Open Graph contract: a
well-formed HTML doc, the full OG/Twitter tag set with an ABSOLUTE og:image on
the public host, the badge image + titles, palette-derived theme-color, HTML
escaping, glyph-subset sanitization, and the wording gate.

No third-party test framework — runnable directly:
    python3 generator/tests/test_page.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.dirname(HERE)
REPO = os.path.dirname(GEN)
BADGES = os.path.join(REPO, "badges")
sys.path.insert(0, GEN)

import page      # noqa: E402
import canon     # noqa: E402
import colors    # noqa: E402
import build     # noqa: E402

# A SYNTHETIC unbaked badge. Its stem deliberately matches no committed SVG, so
# `page._is_baked` reads False and the presentation-only branch is exercised
# deterministically.
#
# This used to point at a real committed badge, which worked only while some
# badge was still unbaked. Every badge now carries a signed class artifact, so a
# real-badge fixture would silently stop testing the unbaked branch — and that
# branch is exactly where the Wording Gate lives (copy must never claim a
# signature that is not there). Keeping it synthetic keeps the guard alive
# permanently, independent of how much of the set is signed.
REC = {
    "course_id": "f" * 56,
    "slt_hash": "0" * 64,
    "course_title": "Synthetic Course (no committed SVG)",
    "module_title": "Synthetic Unbaked Module",
}
STEM = f"{REC['course_id']}.{REC['slt_hash']}"

# A really-baked badge — every committed badge now carries a signed class artifact.
FLAGSHIP_REC = {
    "course_id": "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df",
    "slt_hash": "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db",
    "course_title": "Andamio Issuer",
    "module_title": "About Andamio Issuer",
}
FLAGSHIP_STEM = f"{FLAGSHIP_REC['course_id']}.{FLAGSHIP_REC['slt_hash']}"


def test_well_formed_html():
    html = page._page_html(REC)
    assert html.startswith("<!doctype html>")
    assert "<title>" in html and "</title>" in html
    assert html.rstrip().endswith("</html>")
    print("  ✅ well-formed HTML document")


def test_open_graph_tags_present():
    html = page._page_html(REC)
    card = f"https://credentials.andamio.io/badges/{STEM}.og.png"
    assert f'property="og:title" content="{page.esc(REC["module_title"])}"' in html
    assert 'property="og:description"' in html
    assert f'property="og:image" content="{card}"' in html, "og:image must be absolute on the public host"
    assert 'property="og:image:width" content="1200"' in html
    assert 'property="og:image:height" content="630"' in html
    assert f'property="og:url" content="https://credentials.andamio.io/badges/{STEM}"' in html
    assert 'name="twitter:card" content="summary_large_image"' in html
    assert 'name="theme-color"' in html
    print("  ✅ full OG/Twitter tag set with absolute og:image")


def test_badge_and_titles_rendered():
    html = page._page_html(REC)
    assert f'src="/badges/{STEM}.svg"' in html, "body must reference the badge SVG image"
    assert page.esc(REC["module_title"]) in html
    assert page.esc(REC["course_title"]) in html
    print("  ✅ badge image + credential/course titles present")


def test_theme_color_is_canon_paper_not_per_course():
    """Supersedes test_theme_color_matches_palette (#101 U1 step 7). The page
    ground is canon paper for every credential now — the per-course palette
    stopped feeding page chrome (KTD2) — so theme-color is a constant, and two
    credentials with different course_ids must agree on it."""
    html = page._page_html(REC)
    assert f'name="theme-color" content="{canon.PAPER}"' in html
    other = dict(REC, course_id="b" * 56)
    assert f'name="theme-color" content="{canon.PAPER}"' in page._page_html(other)
    # and it is no longer the palette's value
    assert f'name="theme-color" content="{colors.palette_for(REC["course_id"])["deep"]}"' not in html
    print("  ✅ theme-color is canon paper, identical across credentials")


def test_page_chrome_is_course_independent():
    """KTD2's actual contract: nothing in the page's own chrome varies by course.
    The badge ARTWORK still does (it is a different artifact), and the embed
    variant still reads the palette — so ctx must keep carrying it."""
    a = page._page_html(REC)
    b = page._page_html(dict(REC, course_id="c" * 56))
    for pal_key in ("deep", "raised", "prim", "bone", "slate", "hair"):
        v = colors.palette_for(REC["course_id"])[pal_key]
        assert v not in a, f"per-course {pal_key} ({v}) still reaches page chrome"
    assert "--paper:" in a and "--paper:" in b
    assert page._ctx(REC)["pal"], "ctx must keep the palette — _embed_html reads it"
    print("  ✅ page chrome is course-independent; palette still available to the embed")


def test_canon_tokens_are_imported_not_inlined():
    """The canon literals live in generator/canon.py so the deferred explainer,
    holder-viewer and OG-card restyles import one copy instead of each carrying
    its own transcription with its own drift clock."""
    src = open(os.path.join(GEN, "page.py"), encoding="utf-8").read()
    for literal in (canon.PAPER, canon.ORANGE, canon.BLUE, canon.CORAL_TINT):
        assert literal not in src, (
            f"canon literal {literal} is inlined in page.py — import it from canon.py")
    assert "import canon" in src
    print("  ✅ canon values imported from canon.py, never inlined")


def test_html_escaping():
    rec = dict(REC, module_title='A & B <script> "x"')
    html = page._page_html(rec)
    # The page carries a legitimate inline enhancement <script>; what must NEVER
    # appear is the user's injected markup rendered raw.
    assert '<script> "x"' not in html, "user markup must be escaped, never injected"
    assert "&amp;" in html and "&lt;script&gt;" in html
    print("  ✅ interpolated user text is HTML-escaped (injection blocked)")


def test_quote_escaped_in_attribute_context():
    """A double-quote in a title must become &quot; so it cannot break out of a
    content="..."/alt="..." attribute — the OG tags carry the title in double-
    quoted attributes, so this is the real injection boundary."""
    rec = dict(REC, module_title='Deploy "the" Pillar')
    html = page._page_html(rec)
    assert '&quot;' in html, "raw double-quote must be escaped to &quot; in attributes"
    assert 'content="Deploy "the" Pillar"' not in html, "attribute must not break open"
    print("  ✅ double-quote escaped to &quot; (attribute breakout blocked)")


def test_empty_title_falls_back():
    """A title that sanitizes to empty (all out-of-subset) falls back to the
    generic, never a blank og:title / heading."""
    rec = dict(REC, module_title="中文", course_title="日本語")
    html = page._page_html(rec)
    assert 'property="og:title" content="Credential"' in html, "empty module title -> 'Credential'"
    assert '>Andamio<' in html or 'Andamio' in html  # course falls back to issuer
    print("  ✅ sanitize-to-empty title falls back to generic, never blank")


def test_alt_text_present_and_escaped():
    """og:image:alt and the <img alt> carry the credential description and are
    escaped like every other interpolated field."""
    rec = dict(REC, module_title='Deploy & <Pillar>')
    html = page._page_html(rec)
    assert 'property="og:image:alt"' in html
    assert '<img' in html and 'alt="' in html
    assert "<Pillar>" not in html, "alt text must be escaped too"
    print("  ✅ og:image:alt + img alt present and escaped")


def test_explainer_links_present():
    """Covers R3 (#72). The badge page links both explainers from the (now
    populated) explainers slot."""
    html = page._page_html(REC)
    assert 'href="/badges/how-to-share"' in html, "share explainer link missing"
    assert 'href="/badges/how-to-check"' in html, "check explainer link missing"
    assert "How do I share this?" in html and "How do I check this?" in html
    # slot is no longer empty (the .explainers:empty hide rule no longer applies):
    # an <a> tag appears inside the explainers div, whitespace-insensitively.
    slot = html.split('data-slot="explainers"')[1].split("</div>")[0]
    assert "<a " in slot, "explainers slot should contain links, not be empty"
    print("  ✅ badge page links both explainers")


def test_download_controls_present():
    html = page._page_html(REC)
    assert f'href="/badges/{STEM}.svg" download' in html, "download-SVG control missing"
    assert f'href="/badges/{STEM}.png" download' in html, "download-PNG control missing"
    assert "PNG is for display" in html
    print("  ✅ download SVG/PNG controls present")


def test_web_component_snippet_baked_aware():
    """The <andamio-badge> snippet (#74) carries the real per-badge attributes and
    gates `signed` on baked state — an unbaked badge's snippet must not mark the
    element signed (no overclaim), the flagship's must."""
    unbaked = page._web_component_snippet(STEM, REC["module_title"], REC["course_title"], False)
    assert f'src="{page.HOST}/embed/andamio-badge.js"' in unbaked, "loads the component from our origin"
    assert f'stem="{STEM}"' in unbaked and "andamio-badge" in unbaked
    assert "signed" not in unbaked, "unbaked snippet must not mark the element signed"
    baked = page._web_component_snippet(FLAGSHIP_STEM, "About", "Andamio Issuer", True)
    assert "><andamio-badge" in baked or "<andamio-badge" in baked
    assert " signed>" in baked, "flagship snippet marks the element signed"
    print("  ✅ web-component snippet is baked-aware (signed gated on baked state)")


def test_web_component_control_in_page():
    """The badge page offers the web-component copy control with the snippet in a
    data-* container (escaped), alongside the iframe embed."""
    html = page._page_html(REC)
    assert "data-share-embed-wc" in html, "web-component copy control missing"
    # the snippet is double-escaped into the data attribute; its escaped script src appears
    assert "/embed/andamio-badge.js" in html, "component script src missing from the page"
    assert "Copy web-component embed" in html
    print("  ✅ badge page carries the web-component embed control")


SIGNED_CLAIM = "the SVG you can download is signed"
BAKED_SVG_CLAIM = "is the signed credential itself"

# A signature claim in ANY phrasing, not just the two the copy happens to use.
# Anchoring the R7 guard on literal sentences let an unbaked badge claim a
# signature in different words with the whole suite green — both an unbaked
# .verify reading "its SVG is signed" and an unbaked .actions-note reading "is
# the signed credential itself" slipped through. Matches "is signed", "is a
# signed …", "is the signed …", "are signed"; deliberately does NOT match the
# legitimate unbaked hedge "A signed copy … is rolling out", where the verb
# attaches to the roll-out, not to this badge.
SIGNATURE_CLAIM_RE = re.compile(r"\b(?:is|are)\s+(?:(?:a|the)\s+)?signed\b")


def test_verifiability_copy_is_baked_aware():
    """Only a signed/baked badge may claim its SVG *is* signed (CONCEPTS:
    Flagship Badge). The presentation-only majority must NOT overclaim a
    signature that isn't there.

    The positive anchors were re-pointed when #82 rewrote the copy — they were
    NOT dropped. Two traps to keep in mind if this test ever needs re-anchoring
    again:

      * The discriminator must be a phrase ABSENT from the unbaked branch. Bare
        "signed" is not: the unbaked copy says a signed copy "is rolling out",
        so anchoring on it would make this guard a tautology that passes even
        when an unbaked badge claims a signature. Hence the full SIGNED_CLAIM.
      * The unbaked positive ("anchored on-chain") lives in _svg_note. Keep it
        there — it is a property of the data, not a verification claim, so it
        costs the #82 plain-language rewrite nothing."""
    unbaked = page._page_html(REC)              # REC is unbaked
    assert SIGNED_CLAIM not in unbaked, "must not overclaim a signature for unbaked"
    assert BAKED_SVG_CLAIM not in unbaked, "unbaked download note must not claim a signature"
    assert "anchored on-chain" in unbaked, "unbaked must still state the on-chain anchor"
    assert page._is_baked(STEM) is False

    baked = page._page_html(FLAGSHIP_REC)       # flagship carries proofValue
    assert page._is_baked(FLAGSHIP_STEM) is True, "flagship should read as baked"
    assert SIGNED_CLAIM in baked, "flagship claims its SVG is signed"
    assert BAKED_SVG_CLAIM in baked, "flagship download note names the signed credential"
    # wording gate holds in both
    assert "any OB3 verifier" not in unbaked and "any OB3 verifier" not in baked
    print("  ✅ verifiability copy gated on baked/signed state (no overclaim)")


def test_unbaked_copy_never_claims_a_signature_in_any_phrasing():
    """The R7 guard above anchors on the exact sentences today's copy uses, so
    it only catches a regression that keeps that phrasing. This one catches the
    claim itself however it is worded — the failure mode that matters, since a
    copy edit is exactly how an unbaked badge would start implying a signature.

    Both notes are checked: the caveat and the download note are the two places
    a signature claim can appear, and the #82 split moved copy between them."""
    unbaked = page._svg_note(False) + " " + page._verify_note(False)
    hit = SIGNATURE_CLAIM_RE.search(unbaked)
    assert hit is None, (
        f"unbaked copy claims a signature: {hit.group(0)!r} in {unbaked!r}")
    # The roll-out hedge is what keeps the unbaked signature mention honest —
    # without it, "a signed copy you can check" reads as available today.
    assert "rolling out" in page._verify_note(False), (
        "unbaked copy must hedge the signed copy as still rolling out")
    # ...and the guard is not vacuous: the baked copy DOES trip the pattern.
    assert SIGNATURE_CLAIM_RE.search(page._verify_note(True)) is not None, (
        "pattern must actually match a real signature claim, else it guards nothing")
    print("  ✅ unbaked copy claims no signature in any phrasing")


def test_verifier_class_mentions_stay_qualified():
    """The wording gate's negative list only catches phrasings someone
    enumerated. This asserts the structural invariant instead: wherever the page
    names the OB 3.0 / VC verifier class — today only the baked page's meta and
    OG descriptions — the 'DI-capable' qualifier travels with it. Dropping that
    qualifier is the realistic regression, and no substring blacklist sees it."""
    for rec in (REC, FLAGSHIP_REC):
        html = page._page_html(rec)
        for m in re.finditer(r"OB ?3\.?0? ?/ ?VC verifier", html):
            window = html[max(0, m.start() - 24):m.start()]
            assert "DI-capable" in window, (
                f"unqualified verifier-class mention at offset {m.start()}: "
                f"{html[max(0, m.start() - 60):m.end() + 20]!r}")
    print("  ✅ every verifier-class mention keeps its DI-capable qualifier")


def test_x_intent_link():
    html = page._page_html(REC)
    assert "twitter.com/intent/tweet?url=" in html
    assert page._q(f"https://credentials.andamio.io/badges/{STEM}") in html, "page url must be percent-encoded"
    assert "hashtags=Andamio,Cardano" in html, "hashtags comma-separated, no #"
    assert "%23" not in html.split("hashtags=")[1][:40], "hashtags must not contain #"
    print("  ✅ X intent link: encoded url + comma hashtags, no #")


def test_linkedin_share_link_url_only():
    html = page._page_html(REC)
    assert "linkedin.com/sharing/share-offsite/?url=" in html
    # the share-offsite href carries only url= (title/desc come from OG tags)
    frag = html.split("share-offsite/?")[1].split('"')[0]
    assert frag.startswith("url="), frag
    assert "&amp;text" not in frag and "&text" not in frag, "share-offsite must be url-only"
    print("  ✅ LinkedIn share link is url-only")


def test_linkedin_add_to_profile_link():
    html = page._page_html(REC)
    assert "linkedin.com/profile/add?startTask=CERTIFICATION_NAME" in html
    assert "organizationName=Andamio%20Teams" in html, "org falls back to name until ORG_ID set"
    assert f"certUrl={page._q('https://credentials.andamio.io/badges/' + STEM)}" in html
    assert f"certId={page._q(STEM)}" in html
    print("  ✅ LinkedIn add-to-profile deep link (org name fallback, certUrl=page)")


def test_share_encoding_no_attribute_breakout():
    rec = dict(REC, module_title='Deploy & "the" Pillar')
    html = page._page_html(rec)
    # percent-encoded in the query (space -> %20, quote -> %22, & -> %26)
    assert "%22" in html and "%20" in html
    # the intent hrefs stay well-formed (no raw quote breaking the attribute)
    assert 'href="https://twitter.com/intent/tweet?url=' in html
    print("  ✅ share URLs percent-encode title; hrefs stay well-formed")


def test_progressive_enhancement_buttons_hidden_and_script_present():
    html = page._page_html(REC)
    for marker in ("data-share-copy", "data-share-web", "data-share-embed"):
        assert marker in html, f"{marker} button missing"
    # JS-only buttons ship hidden so a no-JS client sees no dead button
    assert 'data-share-copy hidden' in html
    assert 'data-share-web hidden' in html
    assert 'data-share-embed data-embed=' in html and 'hidden>' in html
    assert "<script>" in html and "navigator.share" in html and "navigator.clipboard" in html
    print("  ✅ JS-only controls hidden until enhanced; inline script present")


def test_embed_data_attribute_escaped():
    html = page._page_html(REC)
    # the iframe snippet is HTML-escaped inside data-embed (no raw < breaking out)
    assert f"data-embed=\"&lt;iframe src=&quot;https://credentials.andamio.io/badges/{STEM}.embed" in html
    print("  ✅ embed snippet HTML-escaped in data-embed")


def test_hostile_title_never_renders_raw_anywhere():
    """Whole-page escaping invariant: a classic XSS payload as the title must not
    appear raw in ANY context of the rendered page — text, attributes, share
    hrefs, or data-embed."""
    payload = '"><img src=x onerror=alert(1)>'
    html = page._page_html(dict(REC, module_title=payload, course_title=payload))
    # The payload's raw <img tag must never appear live — only entity-escaped
    # (&lt;img…) as inert text or percent-encoded in share URLs. (The badge's own
    # <img class="badge"…> is ours, not the payload, so match the payload's src=x.)
    assert "<img src=x" not in html, "raw injected <img> tag leaked"
    assert '"><img' not in html, "attribute-breakout payload leaked"
    assert "onerror=alert(1)>" not in html, "raw onerror handler leaked"
    assert "&lt;img src=x" in html, "payload should survive only entity-escaped"
    print("  ✅ hostile title never renders as a live tag in any page context")


def test_share_script_is_a_constant_no_per_badge_interpolation():
    """The inline enhancement script must be identical across badges — no title/
    stem is ever interpolated into JS (would be an injection channel)."""
    a = page._page_html(REC)
    b = page._page_html(dict(REC, module_title='evil");alert(1)//'))
    assert page._SHARE_SCRIPT in a and page._SHARE_SCRIPT in b, "script must be the shared constant"
    # the script block is byte-identical in both pages
    assert a.count(page._SHARE_SCRIPT) == 1
    print("  ✅ inline script is a constant (no per-badge JS interpolation)")


def test_empty_title_share_urls_use_fallback():
    """A title that sanitizes to empty must carry the 'Credential' fallback into
    the X text= and LinkedIn name= params — never an empty share URL."""
    html = page._page_html(dict(REC, module_title="中文"))  # sanitizes to empty
    assert f"text={page._q('Credential')}" in html, "X intent text= must use fallback"
    assert f"name={page._q('Credential')}" in html, "LinkedIn name= must use fallback"
    print("  ✅ empty title falls back to 'Credential' in share URLs")


def test_ctx_shared_derivation_agrees_across_builders():
    """The page and embed builders derive from one _ctx, so their page_url/stem
    agree for the same record (regression guard against the old duplication)."""
    ctx = page._ctx(REC)
    assert ctx["page_url"] == f"https://credentials.andamio.io/badges/{STEM}"
    assert f'href="{ctx["page_url"]}"' in page._embed_html(REC)
    assert f'content="{ctx["page_url"]}"' in page._page_html(REC)  # og:url
    print("  ✅ page + embed share one _ctx derivation (no drift)")


def test_embed_variant_minimal_and_links_back():
    html = page._embed_html(REC)
    assert html.startswith("<!doctype html>") and html.rstrip().endswith("</html>")
    # ROOT-relative img src (not absolute) so it resolves against the iframe's
    # own origin (credentials.andamio.io) when embedded on a third-party page.
    assert f'src="/badges/{STEM}.svg"' in html, "embed img must be root-relative"
    assert f'src="https://credentials.andamio.io/badges/{STEM}.svg"' not in html
    assert f'href="https://credentials.andamio.io/badges/{STEM}"' in html, "embed must link back to the page"
    assert 'name="viewport"' in html, "embed needs a viewport meta for the iframe"
    # minimal: no share chrome
    assert "data-share-copy" not in html and "twitter.com/intent" not in html
    print("  ✅ embed variant: minimal, shows badge, links back to the page")


def _slot(html, cls):
    """Extract one paragraph's inner HTML by class — lets the #82 tests assert
    on a specific note rather than page-wide, which is the whole point (the two
    notes used to say the same thing)."""
    return html.split(f'<p class="{cls}">')[1].split("</p>")[0]


def test_caveat_appears_once_in_plain_language():
    """Covers R3/R4 (#82). The verification caveat used to render twice ~100px
    apart — once under the download buttons, once in the footer — in the same
    colour and measure. It now lives only in .verify; .actions-note is a pure
    download affordance."""
    unbaked = page._page_html(REC)
    # The developer-register phrase is gone from the unbaked page entirely.
    # Scope this to unbaked ONLY: the baked page's _description() is
    # deliberately untouched and still carries the phrase in three meta tags.
    assert "DI-capable" not in unbaked, "unbaked page must not carry the class name"

    note = _slot(unbaked, "actions-note")
    assert "rolling out" not in note and "verifier" not in note, (
        "the download note must make no verification claim")
    assert "anchored on-chain" in note, "the on-chain anchor is data, not a caveat — keep it"

    verify = _slot(unbaked, "verify")
    assert verify.count("rolling out") == 1, "the caveat states the roll-out exactly once"
    assert "anchored on Cardano" in verify
    print("  ✅ caveat appears once, in the holder's register")


def test_caveat_keeps_its_compatibility_bound():
    """Covers R6 (#82's hard constraint). Plainer must not mean more generous.
    Dropping the verifier qualifier entirely would not narrow the claim — it
    removes the ceiling and lets the reader assume any tool works. The explainer
    itself warns JWS-only verifiers can't read this proof format."""
    for rec in (REC, FLAGSHIP_REC):
        verify = _slot(page._page_html(rec), "verify")
        assert "compatible verifier software" in verify, (
            "the plain-language bound must survive the rewrite")
    print("  ✅ caveat keeps a compatibility bound in both baked states")


def test_baked_download_note_makes_no_check_claim():
    """Covers R3 on the Flagship. The baked page is the one badge that earns the
    strong claim, so it is the easiest place to accidentally state it twice."""
    baked = page._page_html(FLAGSHIP_REC)
    note = _slot(baked, "actions-note")
    assert "check" not in note, "the baked download note must not repeat the check claim"
    assert "PNG is for display" in note
    verify = _slot(baked, "verify")
    assert "check it with compatible verifier software" in verify, (
        "the check claim belongs in .verify, once")
    print("  ✅ Flagship states the check claim once, in .verify")


def test_inline_caveat_link_differs_from_explainer_label():
    """Covers R5. The caveat links its own elaboration inline, but must not
    reuse the .explainers slot's label — that slot sits a few lines above the
    divider, so an identical label + href reads as accidental duplication and
    announces twice to a screen reader."""
    for rec in (REC, FLAGSHIP_REC):
        html = page._page_html(rec)
        verify = _slot(html, "verify")
        assert 'href="/badges/how-to-check"' in verify
        assert "How this badge is checked" in verify
        assert "How do I check this?" not in verify, (
            "inline citation must not reuse the explainer nav label")
        # ...and the nav link is still there, unchanged.
        assert "How do I check this?" in html
    print("  ✅ inline caveat link is distinct from the explainer nav label")


def test_verify_note_differs_by_baked_state():
    """Covers R7. A bare `baked != unbaked` inequality passes trivially — it
    held before #82 too, so it never signalled anything. Assert the specific
    claims that must NOT cross between the two states instead."""
    baked_v, unbaked_v = page._verify_note(True), page._verify_note(False)
    assert baked_v != unbaked_v and page._svg_note(True) != page._svg_note(False)
    # The roll-out hedge belongs only to the badges still waiting on a signature.
    assert "rolling out" in unbaked_v
    assert "rolling out" not in baked_v, "a signed badge is not still 'rolling out'"
    # ...and the no-trust-required claim only to the one that earns it.
    assert "without taking" in baked_v
    assert "without taking" not in unbaked_v, (
        "unbaked must not claim verification without trusting the issuer")
    print("  ✅ verify/download copy makes state-specific claims, not just different ones")


def test_embed_badge_image_is_horizontally_centred():
    """Covers R1/R2 (#81). The embed's flex `align-items:center` centres the
    ANCHORS, but the image's percentage width can't resolve during intrinsic
    sizing, so the wrapping anchor takes the badge's intrinsic width and clamps
    to the iframe width — leaving the block image hard left, with the offset
    growing as the iframe widens. An auto horizontal margin on the image centres
    it inside whatever width the anchor ends up with."""
    html = page._embed_html(REC)
    img_rule = html.split("img{")[1].split("}")[0]
    assert "margin:0 auto" in img_rule, (
        "embed img needs an auto horizontal margin to centre inside a wider anchor")
    # The fix ADDS a declaration — it must not replace the sizing behaviour.
    assert "display:block" in img_rule, "embed img must stay a block box"
    assert "width:min(240px,72%)" in img_rule, "embed img sizing must be unchanged"
    # ...and must not regress the anchor centring that already works.
    assert "align-items:center" in html, "embed body must keep flex cross-axis centring"
    print("  ✅ embed badge image centres horizontally (auto margin, sizing intact)")


def test_no_legacy_type_stack_or_dark_chrome():
    html = page._page_html(REC)
    for gone in ("Archivo", "Spline Sans Mono", "radial-gradient", "border-radius"):
        assert gone not in html, f"legacy chrome survived: {gone}"
    assert '"Inter"' in html and '"JetBrains Mono"' in html
    print("  ✅ canon type stack; no legacy dark chrome, no radius")


def test_canon_fonts_embedded_within_ceiling():
    """KTD7: the page subset-embeds the canon variable faces, under an 80 KB
    per-page ceiling, from its OWN artifact — never gen.FONT_FACE, which feeds
    the signed badge SVGs."""
    assert page.PAGE_FONT_FACE, "page_fonts.css missing — run embed_fonts.py"
    assert "@font-face" in page.PAGE_FONT_FACE
    kb = len(page.PAGE_FONT_FACE.encode()) / 1024
    assert kb <= 80, f"embedded faces are {kb:.0f} KB, over the 80 KB ceiling"
    # Ignore comments: page.py names gen.FONT_FACE in prose to explain why it
    # does NOT use it, and that explanation is worth keeping.
    src = open(os.path.join(GEN, "page.py"), encoding="utf-8").read()
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    assert "gen.FONT_FACE" not in code, \
        "page.py must not read the shared fonts.css constant"
    assert '"page_fonts.css"' in code, "page.py must read its own font artifact"
    print(f"  ✅ canon faces embedded ({kb:.0f} KB, ceiling 80 KB), isolated from fonts.css")


def test_shared_fonts_css_untouched_by_page_path():
    """The KTD7 isolation guard. generator/fonts.css is inlined by the badge
    SVGs (signed artifacts), the OG cards, the explainers and the holder viewer.
    Nothing on the page path may write it."""
    ef = open(os.path.join(GEN, "embed_fonts.py"), encoding="utf-8").read()
    assert '"page": (PAGE_CSS_URL, "page_fonts.css"' in ef, "page target missing"
    assert os.path.exists(os.path.join(GEN, "page_fonts.lock.json")), \
        "font integrity manifest missing — the fetch must be hash-pinned"
    print("  ✅ page fonts are a separate artifact with a pinned manifest")


def test_no_foreign_origin_subresource():
    """The load-bearing no-external-assets invariant, asserted for the first
    time. Scoped to SUBRESOURCES: the absolute og:image on our own host and the
    outbound <a href> targets (X, LinkedIn, andamio.io) are not subresources."""
    html = page._page_html(REC)
    assert "<link" not in html, "external stylesheet/link on a self-contained page"
    assert "@import" not in html
    for m in re.finditer(r'src="([^"]+)"', html):
        v = m.group(1)
        assert not re.match(r"https?://", v), f"foreign-origin src: {v}"
    for m in re.finditer(r"url\(([^)]+)\)", html):
        v = m.group(1).strip("'\"")
        assert v.startswith("data:"), f"foreign-origin url(): {v[:40]}"
    print("  ✅ no foreign-origin subresource (page stays self-contained)")


def test_hidden_beats_author_display():
    """The 44px control minimum forces a `display` onto .btn, and an
    author-origin display beats the UA's [hidden]{display:none}. Without an
    explicit override a no-JS visitor sees four dead buttons while the
    markup-only progressive-enhancement test stays green."""
    html = page._page_html(REC)
    assert "[hidden]{display:none!important;}" in html
    assert html.index("[hidden]{display:none!important;}") < html.index(".btn{"), \
        "[hidden] override must precede the .btn display rule"
    print("  ✅ [hidden] overrides author display rules")


def test_embed_disclosure_collapses_when_controls_hidden():
    """:empty cannot express this — the buttons are always emitted and merely
    hidden — and revealing from JS would mean editing the frozen _SHARE_SCRIPT."""
    html = page._page_html(REC)
    assert ".embed-group:not(:has(button:not([hidden])))" in html
    assert "<details class=\"embed-group\">" in html and "<summary>" in html
    print("  ✅ embed disclosure collapses via :has() when both controls are hidden")


def test_holder_action_order_is_the_stated_order():
    """#101 Q1. With no promoted primary, whichever action leads IS the primary
    call to action, so the order is a stated decision, not accretion order."""
    html = page._page_html(REC)
    order = ["Download SVG", "Download PNG", "Copy link", "Share&hellip;",
             "Share on LinkedIn", "Share on X", "Add to LinkedIn profile"]
    pos = [html.index(label) for label in order]
    assert pos == sorted(pos), f"holder actions out of stated order: {order}"
    # the two embed controls live behind the disclosure, after every holder action
    assert html.index("Copy embed code") > pos[-1]
    print("  ✅ holder actions in the stated order; embed controls behind them")


def test_single_css_orange_accent_on_verification_route_as_non_text_mark():
    """KTD9, restated honestly now that the real brand mark is in the nav.

    The mark carries brand orange, and the canon's accent whitelist permits
    exactly that role ("Brand mark, the single primary CTA, the live pulse dot,
    the VERIFIED stamp"). But it is a raster, so it cannot be caught by counting
    hex literals — a test that only counted `#ff6b35` would pass while the page
    showed two orange marks, which is a test lying by omission.

    So the contract is stated in the terms that are actually checkable: the
    stylesheet paints orange exactly once, on the verification affordance, as a
    non-text tile. Brand orange on paper is ~2.8:1 and fails AA for text, and the
    canon reserves links for blue — so the accent may never be text colour."""
    html = page._page_html(REC)
    css = html.split("<style>")[1].split("</style>")[0]
    assert css.count(canon.ORANGE) == 1, \
        "the stylesheet must define brand orange exactly once (the --orange token)"
    assert css.count("var(--orange)") == 1, \
        "exactly one rule may paint the accent"
    assert ".tile{width:8px;height:8px;background:var(--orange)" in css, \
        "the one accent rule must be the non-text tile"
    assert '<a class="explainer" href="/badges/how-to-check"><span class="tile">' in html
    assert f"color:{canon.ORANGE}" not in html and "color:var(--orange)" not in css, \
        "the accent must never be text colour"
    print("  ✅ one CSS accent, on the verification route, as a non-text mark; "
          "brand mark is the canon's own whitelisted orange role")


def test_no_text_uses_ink_below_muted():
    """On white, ink .45 computes to 3.16:1 and fails AA for normal text; .60
    gives 5.25:1. Steps below .60 are for rules, hairlines and non-text marks."""
    html = page._page_html(REC)
    for decl in re.findall(r"color:var\(--(\w+)\)", html):
        assert decl not in ("faint", "ghost", "cell", "hairline", "grid"), \
            f"text colour uses sub-AA ink step --{decl}"
    print("  ✅ no text-bearing rule uses an ink alpha below .60")


def test_nav_band_carries_the_brand_mark_inlined():
    """The mark is the real Andamio logo, inlined as a data: URI.

    No vector form of it exists — every "*.svg" logo in the landing repo is a
    base64 PNG wrapped in <svg> — so the plan's "inline SVG, never an <img src>"
    assumed an asset that isn't there. What that clause was actually protecting
    is the no-external-assets invariant, and a data: URI satisfies it: the bytes
    ship inside the page, make no request, and beacon to nobody. The assertion
    that matters is therefore the ORIGIN of the src, not its element type."""
    html = page._page_html(REC)
    brand = html.split('class="brand"')[1].split("</a>")[0]
    assert '<a class="brand" href="https://www.andamio.io">' in html
    assert 'src="data:image/png;base64,' in brand, "mark must be inlined, not fetched"
    assert "http" not in brand.split('src="')[1].split('"')[0], \
        "mark must never load from another origin"
    assert f'alt="{page.ISSUER}"' in brand, "the mark is the accessible name of the link"
    assert page.LOGO_DATA_URI and len(page.LOGO_DATA_URI) < 8 * 1024, \
        "inlined mark should stay small — it ships on all 58 pages"
    print("  ✅ nav band: real brand mark inlined as data: URI, links to andamio.io")


def test_two_column_layout_with_single_column_collapse():
    html = page._page_html(REC)
    assert "grid-template-columns:minmax(0,5fr) minmax(0,7fr)" in html
    assert "@media (max-width:900px)" in html
    assert "grid-template-columns:1fr" in html
    assert "min-height:44px" in html, "44px control minimum missing below the breakpoint"
    assert ".badge{{max-width:200px;}}".replace("{{", "{").replace("}}", "}") in html, \
        "specimen must be capped below the breakpoint (fold guard)"
    print("  ✅ two-column grid, single-column collapse, capped specimen, 44px controls")


def test_course_id_shown_in_full_and_slt_hash_is_not():
    """KTD8. One identifier, labelled with the job it does, wrapping, never
    truncated — and rendered as a SIBLING of .verify, never inside it (_slot
    splits to the first </p>)."""
    html = page._page_html(REC)
    assert REC["course_id"] in html
    assert "match on-chain" in html
    assert "overflow-wrap:anywhere" in html
    assert "text-overflow" not in html and "white-space:nowrap" not in html
    # slt_hash stays in URLs and the stem (expected); what it must not be is
    # rendered TEXT the reader is invited to act on. Strip tags and check.
    visible = re.sub(r"<[^>]+>", " ", html.split("<body>")[1])
    assert REC["slt_hash"] not in visible, "slt_hash must not render as visible text"
    assert REC["course_id"] in visible, "course id must render as visible text"
    verify_slot = html.split('<p class="verify">')[1].split("</p>")[0]
    assert REC["course_id"] not in verify_slot, \
        "course id must be a sibling of .verify, not inside its wording-gated slot"
    print("  ✅ course id in full, labelled, wrapping, outside the .verify slot")


def test_no_holder_identity_rendered():
    """KTD5 — this page is keyed (course_id, slt_hash) and resolves no holder."""
    html = page._page_html(REC)
    for forbidden in ("HOLDER", "alias", "Held by"):
        assert forbidden not in html, f"holder identity leaked: {forbidden}"
    print("  ✅ no holder identity on the class page")


def test_issuer_line_unchanged():
    """Guard that the restyle did not quietly absorb product-circle#181."""
    assert f"Issued by {page.ISSUER}" in page._page_html(REC)
    print("  ✅ issuer line still reads 'Issued by Andamio'")


def test_focus_visible_present_and_never_suppressed():
    html = page._page_html(REC)
    assert ":focus-visible{outline:" in html
    assert "outline:none" not in html
    print("  ✅ visible focus state; outline never suppressed")


def test_embed_variant_untouched_by_the_restyle():
    """KTD6. The embed renders inside third-party pages; this plan does not
    restyle it, and it must still read the per-course palette."""
    e = page._embed_html(REC)
    pal = colors.palette_for(REC["course_id"])
    assert pal["ink"] in e and "Archivo" in e, "embed variant must be unchanged"
    assert canon.PAPER not in e, "canon chrome leaked into the embed variant"
    print("  ✅ embed variant unchanged (still per-course, still Archivo)")


def test_main_output_byte_identical_to_committed_pages():
    """Parity guard (mirrors test_render_parity.py): regenerate every page via
    page.main() into a scratch dir and assert each is byte-identical to the
    committed badges/*.html. Pages are pure-deterministic from the registry (no
    baking), so byte-identity must hold — this exercises the main() write path
    and catches page.py <-> committed drift."""
    records = [r for r in json.load(open(os.path.join(GEN, "credentials.json")))
               if r["course_id"] not in build.SKIP_COURSES]
    with tempfile.TemporaryDirectory() as out:
        r = subprocess.run([sys.executable, os.path.join(GEN, "page.py"), out],
                           capture_output=True, text=True)
        assert r.returncode == 0, f"page.py failed: {r.stderr}"
        produced = [f for f in os.listdir(out) if f.endswith(".html")]
        pages = [f for f in produced if not f.endswith(".embed.html")]
        embeds = [f for f in produced if f.endswith(".embed.html")]
        assert len(pages) == len(records), (
            f"expected {len(records)} pages, main() produced {len(pages)}")
        assert len(embeds) == len(records), (
            f"expected {len(records)} embed variants, main() produced {len(embeds)}")
        mismatches = []
        for name in produced:
            new = open(os.path.join(out, name), "rb").read()
            committed_path = os.path.join(BADGES, name)
            if not os.path.exists(committed_path):
                mismatches.append(f"{name}: no committed page to compare")
                continue
            if new != open(committed_path, "rb").read():
                mismatches.append(f"{name}: bytes differ from committed page")
        assert not mismatches, "page parity broken:\n  " + "\n  ".join(mismatches)
    print(f"  ✅ {len(records)} pages byte-identical to committed badges/*.html")


def test_out_of_subset_title_sanitized():
    rec = dict(REC, course_title="Café résumé — Ñoño", module_title="Prüfung ×2")
    html = page._page_html(rec)
    for ch in "éüñ×":
        assert ch not in html, f"un-sanitized glyph {ch!r} leaked into the page"
    print("  ✅ out-of-subset title glyphs sanitized")


OVERCLAIMS = ("any OB3 verifier", "any OB 3.0", "any verifier",
              "anyone can check it")


def test_wording_gate():
    """The wording gate asserts the INVARIANT (the page never implies broader
    verifiability than exists), not the old proxy for it.

    #82 moved the precise class name off the holder's page — it was the densest
    term there — so the positive half now lives where the phrase lives:
    test_explainers.py and test_holder.py assert it on those surfaces. Here the
    page must instead prove the ROUTE to that precision still exists.

    Do NOT 'restore' `assert "DI-capable OB 3.0 / VC verifiers" in html` — that
    re-introduces developer language in front of the holder, which is the defect
    #82 fixed. Do NOT relax the .verify-scoped link assertion to a page-wide one
    either: page-wide is already satisfied by the .explainers slot (and by
    test_explainer_links_present), so the inline citation could silently drop
    with everything green. This test is deliberately narrower than that one."""
    for rec in (REC, FLAGSHIP_REC):             # unbaked and baked
        html = page._page_html(rec)
        for phrase in OVERCLAIMS:
            # Word-anchored: a bare substring test flags legitimate copy that
            # merely contains the phrase ("many verifiers" contains "any
            # verifier"), which would fail loudly for the wrong reason.
            assert not re.search(rf"\b{re.escape(phrase)}\b", html), (
                f"page must never imply {phrase!r}")
        verify = _slot(html, "verify")
        assert 'href="/badges/how-to-check"' in verify, (
            "the caveat itself must link the explainer that carries the precision")
    print("  ✅ wording gate: no overclaim, and .verify links the precise explainer")


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
