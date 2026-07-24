#!/usr/bin/env python3
"""Generate the two badge explainers (#72), linked from every badge page (#70).

  How do I share this?  (holder)   -> ../badges/how-to-share.html
  How do I check this?  (verifier) -> ../badges/how-to-check.html

Two GENERAL static pages (not per-credential), served at the extensionless
/badges/how-to-share and /badges/how-to-check by the #70 routing. The check-this
page adapts docs/verifier-guidance.md into a plain-language, employer-facing path
to confirm a badge is genuine WITHOUT trusting Andamio, at the hash-and-anchor
disclosure level — the raw artifact stays holder-private; the holder-controlled
reveal path is coming (Track B, #123), noted but not linked.

Wording-gated: "DI-capable OB 3.0 / VC verifiers", never "any OB3 verifier".
Editorial prose lives here (the pages are stable, not data-driven); branding
reuses the badge palette + fonts so the explainers match the badge pages.

Usage:
    python3 explainers.py            # write to ../badges/
    python3 explainers.py <outdir>
"""
import os
import sys

import gen
from gen import esc
from page import HOST, ISSUER

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "badges")

# The canonical technical reference the check-this page adapts + links to.
GUIDANCE_URL = ("https://github.com/Andamio-Platform/credential-badges/blob/"
                "main/docs/verifier-guidance.md")

PAL = gen.PAL_ANDAMIO   # Andamio Navy — the explainers are not per-credential


def _shell(title, description, body):
    """The branded page shell (dark theme, badge palette + fonts, readable prose
    column), shared by both explainers."""
    p = PAL
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)} · {ISSUER} Credentials</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="{p['deep']}">
<style>
{gen.FONT_FACE}
:root{{--deep:{p['deep']};--ink:{p['ink']};--raised:{p['raised']};--prim:{p['prim']};--sec:{p['sec']};--bone:{p['bone']};--slate:{p['slate']};--hair:{p['hair']};}}
*{{box-sizing:border-box;}}
html,body{{margin:0;}}
body{{background:radial-gradient(140% 100% at 50% 0%,var(--raised) 0%,var(--ink) 60%,var(--deep) 100%);color:var(--bone);font-family:Archivo,"Helvetica Neue",Arial,sans-serif;line-height:1.6;min-height:100vh;}}
main{{max-width:680px;margin:0 auto;padding:56px 22px 72px;}}
.eyebrow{{font-family:"Spline Sans Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.28em;color:var(--slate);text-transform:uppercase;margin:0 0 10px;}}
h1{{font-size:clamp(26px,5vw,36px);font-weight:800;line-height:1.15;margin:0 0 10px;}}
h2{{font-size:20px;font-weight:700;margin:34px 0 8px;}}
.lead{{font-size:18px;margin:0 0 8px;}}
p,li{{opacity:.92;}}
ol,ul{{padding-left:22px;}}
li{{margin:7px 0;}}
a{{color:var(--sec);}}
strong{{color:var(--bone);}}
.note{{font-size:13px;color:var(--slate);border-left:2px solid var(--hair);padding-left:14px;margin:26px 0;}}
.back{{display:inline-block;margin-top:36px;font-size:13px;color:var(--sec);text-decoration:none;}}
</style>
</head>
<body>
<main>
{body}
</main>
</body>
</html>
"""


_REVEAL_NOTE = ('<p class="note">Today a badge surfaces its evidence at the '
                '<strong>hash-and-anchor</strong> level — enough to prove the '
                'evidence exists and is anchored, without exposing the raw work, '
                'which stays private to the holder. A holder-controlled way to '
                'reveal the underlying artifact is on the way.</p>')


def _share_page():
    body = f"""<p class="eyebrow">For the holder</p>
<h1>How do I share this badge?</h1>
<p class="lead">This badge is proof of a specific thing you did — not a
   participation sticker.</p>

<h2>What it proves</h2>
<p>Every Andamio badge records that you met one <strong>learning target</strong>
   (an SLT) and that the work was <strong>assessed</strong> — an evaluator signed
   off, and the whole thing is anchored on the Cardano blockchain. Four parties
   stand behind it: the <strong>issuer</strong> who created the course, the
   <strong>assessor</strong> who evaluated your work, the <strong>chain</strong>
   that records it immutably, and <strong>{ISSUER}</strong>, which anchors the
   record and signs a portable copy. That is why it beats a certificate: the
   proof lives on a public ledger, not on anyone's server.</p>
{_REVEAL_NOTE}

<h2>Ways to share it</h2>
<ul>
  <li><strong>Download the SVG or PNG.</strong> The SVG is the credential itself
      — a self-contained file anyone can check; the PNG is for display.</li>
  <li><strong>Copy the link</strong> to your badge page and paste it anywhere —
      it unfurls with the badge image and title on X, LinkedIn, Discord, and
      Slack.</li>
  <li><strong>Share to X or LinkedIn</strong> with one click.</li>
  <li><strong>Use your phone's share sheet</strong> (the Share button) to send
      it to any app.</li>
  <li><strong>Embed it</strong> on your own site — copy the embed code for a
      small iframe that shows the badge and links back.</li>
  <li><strong>Add it to your LinkedIn profile</strong> as a certification.</li>
</ul>
<p>All of these live on your badge page — the buttons under the badge.</p>

<p><a class="back" href="how-to-check">How does someone check this badge? &rarr;</a></p>
"""
    return _shell(
        "How do I share this badge?",
        "How to share your Andamio credential badge — download, social, embed, "
        "and add it to your LinkedIn profile.",
        body)


def _check_page():
    body = f"""<p class="eyebrow">For an employer or verifier</p>
<h1>How do I check this badge?</h1>
<p class="lead">You can confirm this badge is genuine <strong>without trusting
   {ISSUER}</strong> — the proof lives on the Cardano blockchain, and the badge
   is a portable copy you can verify independently.</p>

<h2>Who stands behind it</h2>
<p>Four parties produce an Andamio credential, each carrying a different part of
   the trust: an <strong>issuer</strong> (the pseudonymous person who created the
   course and stands behind what its credentials mean), an <strong>assessor</strong>
   (the evaluator named on-chain, where the record yields one), the
   <strong>chain</strong> (Cardano, the immutable record of what happened and
   when), and <strong>{ISSUER}</strong> (which anchors the credential on-chain and
   signs this portable copy). {ISSUER} attests that the on-chain record is real
   and that this document matches it — not that the achievement is significant.
   That meaning belongs to the issuer and the assessor.</p>

<h2>What you can rely on</h2>
<p>If this badge verifies, a clear, narrow set of facts holds: a real person
   holds it; they completed a process recorded on Cardano at a specific time,
   naming an assessor; and it stays verifiable for as long as they hold it. What
   you should <em>not</em> assume is that {ISSUER} vouches for the rigor — that is
   the course owner's and the assessor's to stand behind.</p>

<h2>How to check it (no {ISSUER} trust required)</h2>
<ol>
  <li><strong>Read the credential.</strong> The badge SVG carries an Open Badges
      3.0 / W3C Verifiable Credential document. Its issuer is
      <code>did:web:credentials.andamio.io</code>; its evidence entry carries the
      on-chain anchor (network, course id, the recipient's on-chain asset, and
      the claim transaction hash).</li>
  <li><strong>Resolve the issuer and check the signature.</strong>
      <code>did:web:credentials.andamio.io</code> resolves to a published signing
      key; verify the Data Integrity proof against it with a
      <strong>DI-capable OB 3.0 / VC verifier</strong> (for example spruce or the
      1EdTech validator). Verifiers that read only JWS-style credentials will not
      read this proof format.</li>
  <li><strong>Chase the anchor on-chain.</strong> Look up the claim transaction
      on a public Cardano explorer or on
      <a href="https://andamioscan.io">andamioscan.io</a>, and confirm it matches
      the credential's course id and on-chain asset. This step needs no trust in
      {ISSUER} at all — the ledger is the source of truth.</li>
  <li><strong>Check status, if you want to.</strong> The credential points to a
      hosted status list that flags signing-key freshness (a key-version signal,
      not a statement that the badge wasn't earned). The chain stays
      authoritative.</li>
</ol>
{_REVEAL_NOTE}

<p>For the full technical walk-through — the exact fields, the verification-result
   meanings, and a worked example — see the
   <a href="{GUIDANCE_URL}">verifier guidance</a>.</p>

<p><a class="back" href="how-to-share">How does the holder share this badge? &rarr;</a></p>
"""
    return _shell(
        "How do I check this badge?",
        "How to independently verify an Andamio credential badge — resolve the "
        "issuer, check the signature with a DI-capable OB 3.0 / VC verifier, and "
        "confirm the on-chain anchor, without trusting Andamio.",
        body)


PAGES = {
    "how-to-share.html": _share_page,
    "how-to-check.html": _check_page,
}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)
    for name, build in PAGES.items():
        open(os.path.join(out, name), "w", encoding="utf-8").write(build())
    print(f"wrote {len(PAGES)} explainer pages -> {os.path.relpath(out, HERE)}/")


if __name__ == "__main__":
    main()
