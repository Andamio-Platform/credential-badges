// check-artifacts.ts — CI coverage guard for the raster artifacts (#69).
//
// Asserts every committed badge SVG has a matching download PNG (1024x1024) and
// Open Graph card (1200x630) with the correct dimensions. This is an
// EXISTENCE + DIMENSION check, NOT byte-identity: resvg raster output is not
// guaranteed byte-stable across platforms (fonts, libc), whereas the committed
// PNGs are built locally — so byte-parity across a CI runner would be flaky.
// The SVG byte-identity guarantee (generator/tests/test_render_parity.py) stays
// the guarantor of visual correctness; this guards completeness + shape.
//
// The #31 orphan guard covers the other direction (no png/og.png without an
// SVG). Together they pin the 1:1:1 svg:png:og.png mapping.
//
// Run: node --experimental-strip-types check-artifacts.ts

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BADGES = join(dirname(dirname(fileURLToPath(import.meta.url))), "badges");

function pngDims(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const svgs = readdirSync(BADGES).filter((n) => n.endsWith(".svg") && !n.startsWith("_"));
const problems: string[] = [];

for (const svg of svgs) {
  const stem = svg.replace(/\.svg$/, "");
  const checks: Array<[string, number, number]> = [
    [`${stem}.png`, 1024, 1024],
    [`${stem}.og.png`, 1200, 630],
  ];
  for (const [name, w, h] of checks) {
    const path = join(BADGES, name);
    if (!existsSync(path)) {
      problems.push(`missing ${name}`);
      continue;
    }
    const d = pngDims(path);
    if (d.w !== w || d.h !== h) {
      problems.push(`${name}: ${d.w}x${d.h}, expected ${w}x${h}`);
    }
  }
}

console.error(
  `checked ${svgs.length} badges — existence + dimensions only ` +
    `(not byte-identity; resvg raster is not guaranteed byte-stable cross-platform).`,
);
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.error(`OK: every badge has a 1024x1024 .png and a 1200x630 .og.png`);
