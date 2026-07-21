// bake-signed-vc.ts — bake a signed OB3 VC into a badge SVG / extract it back.
//
// Rung 7 of the v1.1 signing ladder. The generator (generator/gen.py) emits
// every badge with an empty credential hook:
//
//   <openbadges:credential verify=""><![CDATA[\n{unsigned presentation JSON}\n]]></openbadges:credential>
//
// This tool swaps that ONE element for the signed credential, per the OB 3.0
// baking spec (section 5.3.2.1 "Baking"):
//
//   - VC-JWT proof            -> Compact JWS goes in the verify attribute.
//   - EMBEDDED proof (ours,   -> "omit the verify attribute, and the JSON
//     eddsa-rdfc-2022 Data       representation of the OpenBadgeCredential
//     Integrity)                 MUST go into the body of the tag, wrapped in
//                                <![CDATA[...]]>"
//
// So the baked element is `<openbadges:credential><![CDATA[\n{signed VC}\n]]>
// </openbadges:credential>` — no verify attribute. (gen.py's hard-coded
// `verify=""` anticipated a VC-JWT; Rung 6 signed with an embedded Data
// Integrity proof, so the spec-conformant fill of that hook is the CDATA body
// with the attribute omitted.)
//
// Byte-transparency contract (what makes the badge self-verifying):
//   - The signed VC is IMMUTABLE input. It is inserted byte-for-byte — never
//     parsed-and-reserialized, never reformatted, never escaped. Any mutation
//     would break the eddsa-rdfc-2022 signature.
//   - CDATA needs no escaping unless the payload contains "]]>". If it ever
//     does, this tool REFUSES (it will not transform trust-critical bytes;
//     re-encoding schemes are a Rung-8+ decision if ever needed).
//   - Everything outside the single <openbadges:credential> element — the
//     visual layers, the <metadata> presentation block with the theme tokens —
//     is preserved byte-identically.
//   - Framing matches gen.py exactly: `<![CDATA[\n` + payload + `\n]]>`.
//     extract() strips exactly one leading and one trailing framing "\n", so
//     extract(bake(svg, vc)) === vc for any vc (with or without a trailing
//     newline of its own).
//
// Dependency-free by design (see tools/README.md): Node >= 22.18 native
// type-stripping, node: builtins only.
//
// Usage:
//   node --experimental-strip-types tools/bake-signed-vc.ts bake <badge.svg> <signed-vc.json> <out.svg>
//   node --experimental-strip-types tools/bake-signed-vc.ts extract <badge.svg> [out.json]
//
// `bake` writes the baked SVG to <out.svg> (may equal <badge.svg> to bake in
// place). `extract` writes the embedded credential bytes to [out.json], or to
// stdout when omitted.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OPEN_PREFIX = "<openbadges:credential";
const CLOSE_TAG = "</openbadges:credential>";
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

interface CredentialElement {
  /** index of "<openbadges:credential" */
  start: number;
  /** index just past "</openbadges:credential>" */
  end: number;
  /** raw CDATA payload (framing newlines still attached) */
  rawPayload: string;
}

/** Locate the single <openbadges:credential> element (OB3: "There MUST be
 *  only one <openbadges:credential> tag in an SVG"). Throws on 0 or >1. */
function locateCredentialElement(svg: string): CredentialElement {
  const start = svg.indexOf(OPEN_PREFIX);
  if (start === -1) {
    throw new Error("no <openbadges:credential> element found in SVG");
  }
  if (svg.indexOf(OPEN_PREFIX, start + OPEN_PREFIX.length) !== -1) {
    throw new Error(
      "more than one <openbadges:credential> element found — OB3 5.3.2.1 requires exactly one",
    );
  }
  const openTagEnd = svg.indexOf(">", start);
  const closeStart = svg.indexOf(CLOSE_TAG, start);
  if (openTagEnd === -1 || closeStart === -1 || openTagEnd > closeStart) {
    throw new Error("malformed <openbadges:credential> element");
  }
  const body = svg.slice(openTagEnd + 1, closeStart);
  if (!body.startsWith(CDATA_OPEN) || !body.endsWith(CDATA_CLOSE)) {
    throw new Error(
      "<openbadges:credential> body is not a single <![CDATA[...]]> section",
    );
  }
  const rawPayload = body.slice(CDATA_OPEN.length, body.length - CDATA_CLOSE.length);
  if (rawPayload.includes(CDATA_CLOSE)) {
    throw new Error("nested CDATA terminator inside credential body");
  }
  return { start, end: closeStart + CLOSE_TAG.length, rawPayload };
}

/** Strip exactly one leading and one trailing framing "\n" (gen.py wraps the
 *  payload as `<![CDATA[\n` + payload + `\n]]>`). */
function unframe(rawPayload: string): string {
  let s = rawPayload;
  if (s.startsWith("\n")) s = s.slice(1);
  if (s.endsWith("\n")) s = s.slice(0, -1);
  return s;
}

/** Extract the embedded credential bytes exactly as they were baked. */
export function extractVc(svg: string): string {
  return unframe(locateCredentialElement(svg).rawPayload);
}

/** Bake `vc` (the signed credential, byte-for-byte) into `svg`, replacing the
 *  existing <openbadges:credential> element. Embedded-proof form: no verify
 *  attribute, JSON in CDATA (OB3 5.3.2.1). Returns the baked SVG. */
export function bakeSignedVc(svg: string, vc: string): string {
  if (vc.includes(CDATA_CLOSE)) {
    throw new Error(
      'credential contains "]]>" — cannot be embedded in CDATA without transforming signed bytes; refusing',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(vc);
  } catch {
    throw new Error("credential is not valid JSON");
  }
  const cred = parsed as Record<string, unknown>;
  if (!cred || typeof cred !== "object" || !("proof" in cred)) {
    throw new Error("credential has no proof block — refusing to bake an unsigned credential");
  }

  const el = locateCredentialElement(svg);
  const baked =
    svg.slice(0, el.start) +
    `${OPEN_PREFIX}>${CDATA_OPEN}\n${vc}\n${CDATA_CLOSE}${CLOSE_TAG}` +
    svg.slice(el.end);

  // Self-check the round trip before returning anything.
  if (extractVc(baked) !== vc) {
    throw new Error("internal error: extract(bake(svg, vc)) !== vc");
  }
  return baked;
}

function main(argv: string[]): void {
  const [mode, ...args] = argv;
  if (mode === "bake") {
    const [svgPath, vcPath, outPath] = args;
    if (!svgPath || !vcPath || !outPath) {
      throw new Error("usage: bake <badge.svg> <signed-vc.json> <out.svg>");
    }
    const svg = readFileSync(svgPath, "utf8");
    const vc = readFileSync(vcPath, "utf8");
    const baked = bakeSignedVc(svg, vc);
    writeFileSync(outPath, baked);
    console.error(`baked ${vcPath} into ${outPath} (${Buffer.byteLength(baked)} bytes)`);
  } else if (mode === "extract") {
    const [svgPath, outPath] = args;
    if (!svgPath) {
      throw new Error("usage: extract <badge.svg> [out.json]");
    }
    const vc = extractVc(readFileSync(svgPath, "utf8"));
    if (outPath) {
      writeFileSync(outPath, vc);
      console.error(`extracted ${Buffer.byteLength(vc)} bytes -> ${outPath}`);
    } else {
      process.stdout.write(vc);
    }
  } else {
    throw new Error("usage: bake-signed-vc.ts <bake|extract> ...");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
