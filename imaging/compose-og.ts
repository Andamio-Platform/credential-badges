// compose-og.ts — rasterize the 1200x630 OG card composition SVGs to PNG (#69).
//
// generator/og.py authors one {stem}.og.svg per non-skipped credential (badge
// art + title + wordmark on a brand background), reusing the badge palette and
// embedded fonts. This rasterizes each to badges/{stem}.og.png at 1200x630,
// reusing rasterize.ts's font handling and CSS-custom-property inlining (the
// nested badge still carries var(--token, fallback)).
//
// The composition SVGs are build intermediates (a gitignored temp dir) — only
// the .og.png is committed. Usage:
//   node --experimental-strip-types compose-og.ts <composition-dir>

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFontBuffers, inlineCssVars } from "./rasterize.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BADGES_DIR = join(dirname(HERE), "badges");

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** Rasterize a 1200x630 composition SVG to a PNG Buffer. Width-fit at OG_WIDTH
 *  reproduces the 1200x630 viewBox exactly (aspect ratio is authored in). */
export function rasterizeCard(svg: string, fontBuffers: Buffer[]): Buffer {
  const resvg = new Resvg(inlineCssVars(svg), {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: { loadSystemFonts: false, fontBuffers, defaultFontFamily: "Archivo" },
  });
  return resvg.render().asPng();
}

function main(argv: string[]): void {
  const compDir = argv[0];
  if (!compDir) throw new Error("usage: compose-og.ts <composition-dir>");
  const fontBuffers = loadFontBuffers();

  const cards = readdirSync(compDir).filter((n) => n.endsWith(".og.svg"));
  let count = 0;
  for (const name of cards) {
    const svg = readFileSync(join(compDir, name), "utf8");
    const png = rasterizeCard(svg, fontBuffers);
    const out = join(BADGES_DIR, basename(name).replace(/\.og\.svg$/, ".og.png"));
    writeFileSync(out, png);
    count++;
  }
  console.error(`wrote ${count} OG cards -> badges/ (${OG_WIDTH}x${OG_HEIGHT})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
