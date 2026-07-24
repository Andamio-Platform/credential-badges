// rasterize.test.ts — U2 tests for the SVG→PNG rasterizer (#69).
//
// Dependency-light node:test suite. Runs against the real committed badges and
// generator/fonts.css, so it also guards the two failure modes the spot-check
// caught: CSS custom properties collapsing to a black disc, and fonts not
// loading. Run:  node --experimental-strip-types --test rasterize.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFontBuffers, rasterize, inlineCssVars, PNG_SIZE, pngDims } from "./rasterize.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BADGES = join(dirname(HERE), "badges");

function aRealBadge(): string {
  const name = readdirSync(BADGES).find(
    (n) => n.endsWith(".svg") && !n.startsWith("_"),
  );
  assert.ok(name, "expected at least one committed badge SVG");
  return readFileSync(join(BADGES, name!), "utf8");
}

test("loadFontBuffers decodes both embedded woff2 families", () => {
  const buffers = loadFontBuffers();
  assert.equal(buffers.length, 2, "expected Archivo + Spline Sans Mono");
  for (const b of buffers) assert.ok(b.length > 1000, "font buffer looks empty");
});

test("inlineCssVars replaces var(--x, fallback) with the fallback", () => {
  assert.equal(inlineCssVars('fill="var(--prim, #EE6C3A)"'), 'fill="#EE6C3A"');
  assert.equal(inlineCssVars("stop-color=\"var(--ink, #121A2D)\""), 'stop-color="#121A2D"');
  // No var(): unchanged.
  assert.equal(inlineCssVars('fill="#000"'), 'fill="#000"');
});

test("inlineCssVars throws (not silent-black) on unresolvable var() forms", () => {
  // Fallback-less var() and paren-containing fallbacks are the forms resvg
  // would render as default-fill black. Fail loud instead.
  assert.throws(() => inlineCssVars('fill="var(--prim)"'), /unresolved CSS var/);
  assert.throws(
    () => inlineCssVars('fill="var(--prim, rgba(0,0,0,.5))"'),
    /unresolved CSS var/,
  );
});

test("happy path: a badge rasterizes to a 1024x1024 PNG", () => {
  const png = rasterize(aRealBadge(), loadFontBuffers());
  const { w, h } = pngDims(png);
  assert.equal(w, PNG_SIZE);
  assert.equal(h, PNG_SIZE);
  assert.ok(png.length > 1000, "PNG is empty");
});

test("regression: colors render — inlined output is far larger than the black-disc failure", () => {
  // With var() unresolved, resvg renders a near-uniform black disc (~18KB). A
  // correct render of the gradients + rings + text is an order of magnitude
  // larger. This is the automated tripwire for the CSS-custom-property bug the
  // spot-check caught; the PR carries the visual confirmation of font fidelity.
  const png = rasterize(aRealBadge(), loadFontBuffers());
  assert.ok(
    png.length > 100_000,
    `PNG is only ${png.length} bytes — colors/text likely did not render`,
  );
});

test("determinism: two renders of the same badge are byte-identical (this runner)", () => {
  const svg = aRealBadge();
  const fonts = loadFontBuffers();
  assert.ok(rasterize(svg, fonts).equals(rasterize(svg, fonts)));
});

test("error path: malformed SVG throws, not a silent empty PNG", () => {
  assert.throws(() => rasterize("<not-an-svg>", loadFontBuffers()));
});
