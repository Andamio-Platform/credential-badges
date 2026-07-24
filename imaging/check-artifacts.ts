// check-artifacts.ts — CI coverage guard for the generated badge artifacts (#69, #70).
//
// Asserts every committed badge SVG has a matching download PNG (1024x1024), an
// Open Graph card (1200x630) with the correct dimensions AND a plausible byte
// size, and a display/share page ({stem}.html, #70). The PNG checks are an
// EXISTENCE + DIMENSION + SANITY check, NOT byte-identity:
// resvg raster output is not guaranteed byte-stable across platforms (fonts,
// libc), whereas the committed PNGs are built locally — so byte-parity across a
// CI runner would be flaky. The SVG byte-identity guarantee
// (generator/tests/test_render_parity.py) stays the guarantor of visual
// correctness; this guards completeness, shape, and gross corruption.
//
// The MIN_BYTES floor is a tripwire for the failure the correct pipeline can't
// otherwise catch here: a blank / solid-black (the CSS-var regression) /
// truncated PNG that still has the right IHDR dimensions. Real badge PNGs are
// ~200-360 KB; a black disc is ~18 KB. A generous floor flags those without
// risking a false positive on a legitimately simple badge.
//
// The #31 orphan guard covers the other direction (no png/og.png without an
// SVG). Together they pin the 1:1:1 svg:png:og.png mapping.
//
// Run: node --experimental-strip-types check-artifacts.ts

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG_SIZE, pngDims } from "./rasterize.ts";
import { OG_WIDTH, OG_HEIGHT } from "./compose-og.ts";

const BADGES = join(dirname(dirname(fileURLToPath(import.meta.url))), "badges");

// Gross-corruption floor (bytes). Well below the smallest real artifact,
// comfortably above a blank/black/truncated PNG.
const MIN_BYTES = 40_000;

const svgs = readdirSync(BADGES).filter((n) => n.endsWith(".svg") && !n.startsWith("_"));
const problems: string[] = [];

for (const svg of svgs) {
  const stem = svg.replace(/\.svg$/, "");
  const checks: Array<[string, number, number]> = [
    [`${stem}.png`, PNG_SIZE, PNG_SIZE],
    [`${stem}.og.png`, OG_WIDTH, OG_HEIGHT],
  ];
  for (const [name, w, h] of checks) {
    const path = join(BADGES, name);
    if (!existsSync(path)) {
      problems.push(`missing ${name}`);
      continue;
    }
    const bytes = statSync(path).size;
    if (bytes < MIN_BYTES) {
      problems.push(`${name}: ${bytes} bytes (< ${MIN_BYTES}) — likely blank/black/truncated`);
      continue;
    }
    const d = pngDims(readFileSync(path));
    if (d.w !== w || d.h !== h) {
      problems.push(`${name}: ${d.w}x${d.h}, expected ${w}x${h}`);
    }
  }
  // The display/share page (#70) — existence only (HTML has no dimensions).
  if (!existsSync(join(BADGES, `${stem}.html`))) {
    problems.push(`missing ${stem}.html (badge page)`);
  }
}

console.error(
  `checked ${svgs.length} badges — png/og-card existence + dimensions + byte-floor, ` +
    `and page (.html) existence (not byte-identity; resvg raster is not byte-stable cross-platform).`,
);
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.error(`OK: every badge has a 1024x1024 .png, a 1200x630 .og.png (all >= ${MIN_BYTES}B), and a .html page`);
