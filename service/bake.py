"""Byte-exact OB 3.0 bake splice — Python port of tools/bake-signed-vc.ts.

Why a port rather than reuse (plan U5, KTD-7 posture): holder artifacts are
produced on the render path, and the alternative — serving baked images from
the issuer — would put image serving and cache reads inside the one process
holding KMS sign permission. Keeping that process narrow is the same posture
that put the anchor gate inside the sign boundary in issue #54. The cost is a
second implementation of trust-critical code, which
``generator/tests/test_bake.py`` holds to the TypeScript original's exact
output on real inputs.

The contract, unchanged from the original:

* The signed credential is inserted **verbatim** — never parsed and
  reserialized, never reformatted, never escaped. Any mutation breaks the
  ``eddsa-rdfc-2022`` signature.
* Embedded-proof form per OB 3.0 5.3.2.1: the ``verify`` attribute is omitted
  and the JSON goes in the CDATA body.
* Framing is exactly ``<![CDATA[\\n`` + payload + ``\\n]]>``, matching what
  ``generator/gen.py`` emits, and ``extract`` strips exactly one leading and
  one trailing framing newline.
* A payload containing ``]]>`` is **refused**, never escaped — re-encoding
  trust-critical bytes is not a transformation this code will make.
* Everything outside the single ``<openbadges:credential>`` element is
  preserved byte-identically.

Stdlib only.
"""
import json

OPEN_PREFIX = "<openbadges:credential"
CLOSE_TAG = "</openbadges:credential>"
CDATA_OPEN = "<![CDATA["
CDATA_CLOSE = "]]>"

__all__ = ["BakeError", "extract_vc", "bake_signed_vc"]


class BakeError(ValueError):
    """Raised when an SVG or credential does not meet the bake contract."""


def _locate_credential_element(svg):
    """Return ``(start, end, raw_payload)`` for the single credential element.

    OB 3.0 5.3.2.1: "There MUST be only one <openbadges:credential> tag in an
    SVG" — so zero or more than one is a refusal, not a best-effort pick.
    """
    start = svg.find(OPEN_PREFIX)
    if start == -1:
        raise BakeError("no <openbadges:credential> element found in SVG")
    if svg.find(OPEN_PREFIX, start + len(OPEN_PREFIX)) != -1:
        raise BakeError(
            "more than one <openbadges:credential> element found — "
            "OB3 5.3.2.1 requires exactly one")

    open_tag_end = svg.find(">", start)
    close_start = svg.find(CLOSE_TAG, start)
    if open_tag_end == -1 or close_start == -1 or open_tag_end > close_start:
        raise BakeError("malformed <openbadges:credential> element")

    body = svg[open_tag_end + 1:close_start]
    if not body.startswith(CDATA_OPEN) or not body.endswith(CDATA_CLOSE):
        raise BakeError(
            "<openbadges:credential> body is not a single <![CDATA[...]]> section")

    raw_payload = body[len(CDATA_OPEN):len(body) - len(CDATA_CLOSE)]
    if CDATA_CLOSE in raw_payload:
        raise BakeError("nested CDATA terminator inside credential body")
    return start, close_start + len(CLOSE_TAG), raw_payload


def _unframe(raw_payload):
    """Strip exactly one leading and one trailing framing newline."""
    s = raw_payload
    if s.startswith("\n"):
        s = s[1:]
    if s.endswith("\n"):
        s = s[:-1]
    return s


def extract_vc(svg):
    """Return the embedded credential bytes exactly as they were baked."""
    return _unframe(_locate_credential_element(svg)[2])


def bake_signed_vc(svg, vc):
    """Bake ``vc`` into ``svg``, replacing the existing credential element.

    ``vc`` is inserted byte-for-byte. Returns the baked SVG.
    """
    if CDATA_CLOSE in vc:
        raise BakeError(
            'credential contains "]]>" — cannot be embedded in CDATA without '
            "transforming signed bytes; refusing")

    try:
        parsed = json.loads(vc)
    except ValueError:
        raise BakeError("credential is not valid JSON") from None
    if not isinstance(parsed, dict) or "proof" not in parsed:
        raise BakeError(
            "credential has no proof block — refusing to bake an unsigned credential")

    start, end, _ = _locate_credential_element(svg)
    baked = (
        svg[:start]
        + f"{OPEN_PREFIX}>{CDATA_OPEN}\n{vc}\n{CDATA_CLOSE}{CLOSE_TAG}"
        + svg[end:]
    )

    # Self-check the round trip before returning anything. A splice that does
    # not round-trip has produced an artifact whose signature cannot verify.
    if extract_vc(baked) != vc:
        raise BakeError("internal error: extract(bake(svg, vc)) != vc")
    return baked
