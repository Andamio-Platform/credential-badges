// rasterize.test.ts — U2 tests for the SVG→PNG rasterizer (#69).
//
// Dependency-light node:test suite. Runs against the real committed badges and
// generator/fonts.css, so it also guards the two failure modes the spot-check
// caught: CSS custom properties collapsing to a black disc, and fonts not
// loading. Run:  node --experimental-strip-types --test rasterize.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";
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

// ---------------------------------------------------------------------------
// Plate art (#131): prove the committed rasterizer actually DRAWS the image
// gen.py clips into the core plate. check-artifacts.ts only checks existence,
// dimensions and a byte floor, so a dropped image would pass it silently.
//
// The SVGs come from the real generator (build.py --only --art-dir), with and
// without the committed placeholder art, so this exercises gen.py's actual
// output rather than a hand-written <image>. Assertions compare mean pixel
// values with tolerances, never bytes: resvg raster is not byte-stable across
// platforms.
// ---------------------------------------------------------------------------

const REPO = dirname(HERE);
// A built (non-SKIP_COURSES) credential from generator/credentials.json.
const ART_COURSE = "661274aa715885b4c9789aec179f9a429169eb7be73f7c29a8694402";
const ART_BADGE = `${ART_COURSE}.9fa3cdce9eaa801270d42154dcb12b64448bfab826971f1d0e74f9d0e87cc3e9`;
const PLACEHOLDER_JPG = join(REPO, "generator", "tests", "fixtures", "art", "placeholder.jpg");

// 16x16 lossy WebP (RIFF....WEBPVP8 ), solid rgb(198,21,19) when decoded, and
// the same colour as a 16x16 baseline JPEG for the control. Both were encoded
// with Pillow; decoded pixel verified there.
const RED_WEBP_B64 =
  "UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoQABAAAUAmJaACdLoB+AADsAD+9Bi3/hV8bkLW//voB70A96Af4IAA";
const RED_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzeiiivnT9nP/Z";

type Rgba = { w: number; h: number; px: Uint8Array };

/** Minimal PNG decoder for resvg's output: 8-bit RGBA (colour type 6),
 *  non-interlaced. Enough to read pixels back without adding a dependency. */
function decodePng(buf: Buffer): Rgba {
  const { w, h } = pngDims(buf);
  assert.equal(buf[24], 8, "expected 8-bit samples");
  assert.equal(buf[25], 6, "expected RGBA colour type");
  assert.equal(buf[28], 0, "expected non-interlaced");
  const idat: Buffer[] = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("latin1", i + 4, i + 8);
    if (type === "IDAT") idat.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[out + x - 4] : 0;
      const b = y > 0 ? px[out - stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[out - stride + x - 4] : 0;
      let p = raw[src + x];
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else assert.equal(f, 0, `unknown PNG filter ${f}`);
      px[out + x] = p & 0xff;
    }
  }
  return { w, h, px };
}

/** Mean absolute per-channel (RGB) difference between two renders over the
 *  pixels `keep(x, y)` selects. */
function meanDiff(a: Rgba, b: Rgba, keep: (x: number, y: number) => boolean): number {
  let sum = 0, n = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (!keep(x, y)) continue;
      const i = (y * a.w + x) * 4;
      for (let k = 0; k < 3; k++) sum += Math.abs(a.px[i + k] - b.px[i + k]);
      n += 3;
    }
  }
  assert.ok(n > 0, "empty sample region");
  return sum / n;
}

// Text-free patches inside the core plate (r <= 411 around 512,512): above the
// COURSE eyebrow (y~353), and left of the module title (x>=~310). Both sit well
// inside the plate and away from its anti-aliased edge.
const inPlatePatch = (x: number, y: number) =>
  (x >= 452 && x < 572 && y >= 170 && y < 290) || (x >= 130 && x < 250 && y >= 452 && y < 572);
// The encoded rings: inner ring r=440, outer r=472, plus the r=424 and r=488
// hairlines. Starts 13px outside the plate edge so the scrim's anti-aliasing is
// excluded.
const inRingBand = (x: number, y: number) => {
  const r = Math.hypot(x + 0.5 - 512, y + 0.5 - 512);
  return r >= 424 && r <= 490;
};

let built: { art: string; noArt: string } | undefined;
function builtSvgs(): { art: string; noArt: string } {
  if (built) return built;
  const tmp = mkdtempSync(join(tmpdir(), "plate-art-"));
  try {
    const artDir = join(tmp, "art");
    const emptyArtDir = join(tmp, "no-art");
    mkdirSync(artDir);
    mkdirSync(emptyArtDir);
    copyFileSync(PLACEHOLDER_JPG, join(artDir, `${ART_COURSE}.jpg`));
    const build = (out: string, dir: string) => {
      execFileSync(
        "python3",
        [join(REPO, "generator", "build.py"), out, "--only", ART_BADGE, "--art-dir", dir],
        { cwd: REPO, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, stdio: "pipe" },
      );
      return readFileSync(join(out, `${ART_BADGE}.svg`), "utf8");
    };
    built = { art: build(join(tmp, "out-art"), artDir), noArt: build(join(tmp, "out-no-art"), emptyArtDir) };
    return built;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const JPEG_URI_RE = /data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g;

function withImage(svg: string, uri: string): string {
  assert.equal(svg.match(JPEG_URI_RE)?.length, 1, "expected exactly one JPEG data URI");
  return svg.replace(JPEG_URI_RE, uri);
}

test("plate art: the rasterizer draws the art in the plate and leaves the rings alone", (t) => {
  const { art, noArt } = builtSvgs();
  assert.match(art, /<image href="data:image\/jpeg;base64,/, "build.py emitted no plate image");
  assert.doesNotMatch(noArt, /<image /, "no-art build unexpectedly carries an image");
  const fonts = loadFontBuffers();
  const withArt = decodePng(rasterize(art, fonts));
  const without = decodePng(rasterize(noArt, fonts));
  const plate = meanDiff(withArt, without, inPlatePatch);
  const rings = meanDiff(withArt, without, inRingBand);
  t.diagnostic(`plate patch mean |diff| = ${plate.toFixed(2)}, ring band = ${rings.toFixed(3)}`);
  // Threshold sits between scrim-only (~1.9: the image dropped but the scrim
  // drawn, which is how a resvg decode failure would look) and the placeholder
  // art (~26.6 on macOS arm64).
  assert.ok(plate > 8, `plate art not drawn: plate patch mean |diff| is only ${plate.toFixed(2)}`);
  assert.ok(rings < 0.5, `plate art bled into the rings: ring band mean |diff| is ${rings.toFixed(3)}`);
});

test("plate art: resvg 2.6.2 silently drops a WebP data URI (why art is JPEG-only)", (t) => {
  // If this test fails because the WebP render now differs from scrim-only, a resvg
  // bump has started decoding WebP: revisit the JPEG-only rule in
  // generator/art.py (and its docs) rather than loosening this assertion.
  const webp = Buffer.from(RED_WEBP_B64, "base64");
  assert.equal(webp.toString("latin1", 0, 4), "RIFF");
  assert.equal(webp.toString("latin1", 8, 16), "WEBPVP8 ", "expected a lossy VP8 WebP");
  // Baseline is the art SVG with its <image> removed, not the no-art SVG: the
  // scrim is still drawn over the plate, so "image dropped" means "scrim only".
  const { art } = builtSvgs();
  const scrimOnly = art.replace(/<image [^>]*\/>/, "");
  assert.notEqual(scrimOnly, art, "could not strip the plate <image>");
  const fonts = loadFontBuffers();
  const without = decodePng(rasterize(scrimOnly, fonts));
  const asWebp = decodePng(rasterize(withImage(art, `data:image/webp;base64,${RED_WEBP_B64}`), fonts));
  const asJpeg = decodePng(rasterize(withImage(art, `data:image/jpeg;base64,${RED_JPEG_B64}`), fonts));
  const webpDiff = meanDiff(asWebp, without, inPlatePatch);
  const jpegDiff = meanDiff(asJpeg, without, inPlatePatch);
  t.diagnostic(`plate patch mean |diff| vs scrim-only: red WebP = ${webpDiff.toFixed(2)}, red JPEG = ${jpegDiff.toFixed(2)}`);
  // Control: the same red as a JPEG in the same slot is plainly visible, so a
  // near-zero WebP difference means "not drawn", not "too faint to measure".
  assert.ok(jpegDiff > 10, `control failed: red JPEG plate mean |diff| only ${jpegDiff.toFixed(2)}`);
  assert.ok(webpDiff < 0.5, `WebP now renders (plate mean |diff| ${webpDiff.toFixed(2)}): revisit JPEG-only`);
});
