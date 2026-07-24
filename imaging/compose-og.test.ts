// compose-og.test.ts — tests for the OG card rasterizer (#69).
//
// rasterizeCard() is the entry point make og-cards drives; without this its own
// logic (1200x630 fit, font handling, CSS-var inlining of the nested badge) was
// unexercised by CI. Dependency-light node:test. Run:
//   node --experimental-strip-types --test compose-og.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizeCard, OG_WIDTH, OG_HEIGHT } from "./compose-og.ts";
import { loadFontBuffers, pngDims } from "./rasterize.ts";

// A representative 1200x630 composition: brand background (with a var() to prove
// the shared inlining runs on the card path too), an eyebrow, and a title.
const CARD_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" ` +
  `width="${OG_WIDTH}" height="${OG_HEIGHT}">` +
  `<defs><style>.sans{font-family:"Archivo",sans-serif;}</style></defs>` +
  `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="var(--bg, #0C1325)"/>` +
  `<text class="sans" x="600" y="315" font-size="56" fill="#EAE6DD">Test Credential</text>` +
  `</svg>`;

test("rasterizeCard renders a 1200x630 PNG", () => {
  const png = rasterizeCard(CARD_SVG, loadFontBuffers());
  const { w, h } = pngDims(png);
  assert.equal(w, OG_WIDTH);
  assert.equal(h, OG_HEIGHT);
});

test("rasterizeCard produces non-trivial content (not a blank card)", () => {
  // A background fill + rendered text is far larger than an empty canvas; this
  // also proves the var(--bg, …) inlining ran (else resvg would throw on the
  // unresolved var per rasterize.ts's fail-loud guard).
  const png = rasterizeCard(CARD_SVG, loadFontBuffers());
  assert.ok(png.length > 5_000, `card PNG is only ${png.length} bytes`);
});

test("rasterizeCard throws on malformed SVG, not a silent empty PNG", () => {
  assert.throws(() => rasterizeCard("<not-svg>", loadFontBuffers()));
});
