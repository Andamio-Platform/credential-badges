// rasterize.ts — SVG → PNG for the v1.2 build-time image pipeline (#69).
//
// Rasterizes each committed badge SVG to a native-ratio 1024x1024 PNG using
// resvg (deterministic, offline, no Chromium/system-font dependency).
//
// Font handling (KTD-8): the badge SVGs bake their fonts as base64 woff2
// @font-face rules (generator/fonts.css, inlined by gen.py). resvg does NOT
// parse base64 @font-face from CSS — it matches font-family names against fonts
// it is given. So we decode the woff2 blobs out of fonts.css and hand them to
// resvg as fontBuffers with loadSystemFonts:false: exactly our embedded fonts,
// no system-font dependency, deterministic. (embed_fonts.py strips the name
// table, so a defaultFontFamily is set as the match fallback.)
//
// The work-list is the set of committed badges/*.svg (excluding _-prefixed
// protected files) — build.py writes exactly the non-skipped registry set and
// reconcile.py prunes orphans, so the SVGs on disk ARE the authoritative
// non-skipped set. This keeps SKIP_COURSES single-sourced in build.py; no
// registry re-read in Node.
//
// Dependency: @resvg/resvg-js (pinned). Usage:
//   node --experimental-strip-types rasterize.ts            # all badges → badges/*.png
//   node --experimental-strip-types rasterize.ts <in.svg> <out.png>   # one file

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const FONTS_CSS = join(REPO, "generator", "fonts.css");
const BADGES_DIR = join(REPO, "badges");

export const PNG_SIZE = 1024;

/** Inline CSS custom properties so resvg can render the badge.
 *
 *  The badge SVGs color everything with `var(--token, <fallback>)` (gen.py's
 *  `c(k)` helper), plus a per-element `style="--token:value;"` var-definition
 *  block. resvg does NOT support CSS custom properties — every `var()` would
 *  collapse to the default fill (black), producing a solid disc. But gen.py
 *  ALWAYS emits the literal palette value as the var() fallback, so replacing
 *  `var(--x, VALUE)` with `VALUE` reproduces the exact intended colors,
 *  deterministically and losslessly. (The now-inert `--token:value;` style
 *  block is left in place; resvg ignores unknown custom properties.) */
export function inlineCssVars(svg: string): string {
  let prev: string;
  let out = svg;
  // Loop to a fixed point in case a fallback ever itself contained a var()
  // (gen.py never nests today, but this stays correct if it ever does).
  do {
    prev = out;
    out = out.replace(/var\(\s*--[A-Za-z0-9_-]+\s*,\s*([^()]*?)\s*\)/g, "$1");
  } while (out !== prev);
  return out;
}

/** Decode every `data:font/woff2;base64,...` blob in fonts.css into a Buffer.
 *  These are the exact fonts the SVGs embed, so resvg renders identical glyphs. */
export function loadFontBuffers(fontsCssPath: string = FONTS_CSS): Buffer[] {
  const css = readFileSync(fontsCssPath, "utf8");
  const re = /data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g;
  const buffers: Buffer[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    buffers.push(Buffer.from(m[1], "base64"));
  }
  if (buffers.length === 0) {
    throw new Error(`no base64 woff2 @font-face found in ${fontsCssPath}`);
  }
  return buffers;
}

/** Rasterize an SVG string to a PNG Buffer at `width`x`width` (badges are
 *  square, viewBox 0 0 1024 1024). Fonts are supplied explicitly. */
export function rasterize(
  svg: string,
  fontBuffers: Buffer[],
  width: number = PNG_SIZE,
): Buffer {
  const resvg = new Resvg(inlineCssVars(svg), {
    fitTo: { mode: "width", value: width },
    font: {
      loadSystemFonts: false, // determinism: never depend on the host's fonts
      fontBuffers,
      defaultFontFamily: "Archivo",
    },
  });
  return resvg.render().asPng();
}

/** True for protected / non-badge files that must not be rasterized. */
function isProtected(name: string): boolean {
  return name.startsWith("_");
}

function main(argv: string[]): void {
  const fontBuffers = loadFontBuffers();

  if (argv.length >= 2) {
    // Single-file mode (used by the spot-check and tests).
    const [inPath, outPath] = argv;
    const png = rasterize(readFileSync(inPath, "utf8"), fontBuffers);
    writeFileSync(outPath, png);
    console.error(`rasterized ${inPath} -> ${outPath} (${png.length} bytes)`);
    return;
  }

  // Full-tree mode: every committed badge SVG -> sibling .png.
  const svgs = readdirSync(BADGES_DIR).filter(
    (n) => n.endsWith(".svg") && !isProtected(n),
  );
  let count = 0;
  for (const name of svgs) {
    const svg = readFileSync(join(BADGES_DIR, name), "utf8");
    const png = rasterize(svg, fontBuffers);
    writeFileSync(join(BADGES_DIR, name.replace(/\.svg$/, ".png")), png);
    count++;
  }
  console.error(`wrote ${count} PNGs -> badges/ (${PNG_SIZE}x${PNG_SIZE})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
