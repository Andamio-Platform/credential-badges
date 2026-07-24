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
  // The display/share page (#70). HTML has no dimensions, so guard against a
  // blank/truncated/stale page with a size floor + the required og:image tag —
  // an independent corruption tripwire alongside test_page.py's byte-parity.
  const pagePath = join(BADGES, `${stem}.html`);
  if (!existsSync(pagePath)) {
    problems.push(`missing ${stem}.html (badge page)`);
  } else {
    const html = readFileSync(pagePath, "utf8");
    if (html.length < 800) {
      problems.push(`${stem}.html: ${html.length} bytes — likely blank/truncated`);
    } else if (!html.includes('property="og:image"')) {
      problems.push(`${stem}.html: missing og:image tag — page malformed`);
    }
  }
  // The minimal embed variant (#71) — served at /badges/{stem}.embed.
  const embedPath = join(BADGES, `${stem}.embed.html`);
  if (!existsSync(embedPath)) {
    problems.push(`missing ${stem}.embed.html (embed variant)`);
  } else {
    const embed = readFileSync(embedPath, "utf8");
    if (embed.length < 200) {
      problems.push(`${stem}.embed.html: ${embed.length} bytes — likely blank/truncated`);
    } else if (!embed.includes(`href="https://credentials.andamio.io/badges/${stem}"`)) {
      // Check the ANCHOR back-link specifically — a bare /badges/{stem} substring
      // is also satisfied by the img src (/badges/{stem}.svg), so match the
      // absolute page href to prove the link-back is really present.
      problems.push(`${stem}.embed.html: missing anchor link back to the badge page`);
    }
  }
}

// The two explainers (#72) are general editorial pages (non-hex stems), so the
// per-credential orphan guard is blind to them — check them here so a deleted OR
// body-wiped explainer fails CI. Content markers are the real check: a byte-size
// floor is useless (the ~56KB inlined font CSS keeps even an empty-body page
// well over any floor), so require distinctive body content per page.
const EXPLAINERS: Array<[string, string[]]> = [
  ["how-to-share.html", ["How do I share this badge?", "learning target"]],
  ["how-to-check.html",
   ["without trusting", "did:web:credentials.andamio.io", "andamioscan.io"]],
];
for (const [name, markers] of EXPLAINERS) {
  const path = join(BADGES, name);
  if (!existsSync(path)) {
    problems.push(`missing ${name} (explainer)`);
    continue;
  }
  const html = readFileSync(path, "utf8");
  for (const m of markers) {
    if (!html.includes(m)) problems.push(`${name}: missing content marker "${m}" — page malformed`);
  }
}
// The check page links docs/verifier-guidance.md for depth; guard the mirrored
// doc still exists so the trust page's depth link can't silently 404 on a rename.
if (!existsSync(join(dirname(BADGES), "docs", "verifier-guidance.md"))) {
  problems.push("docs/verifier-guidance.md missing — how-to-check's depth link would 404");
}

// The holder viewer (#73): three general `_`-prefixed served files the
// per-credential orphan guard is blind to. A deleted or body-wiped shell / JS /
// registry would silently break the per-holder view; content markers are the
// real check (size floors are useless — the shell's inlined font CSS dwarfs any
// floor, and the registry/JS have no natural minimum).
const HOLDER: Array<[string, string[]]> = [
  ["_holder.html", ["data-holder-list", 'src="/badges/_holder.js"', "key-version"]],
  ["_holder.js", ["parsePath", "loadHolderView", "/holder-api/"]],
  ["_registry.json", ["course_title", "module_title", "signed"]],
];
for (const [name, markers] of HOLDER) {
  const path = join(BADGES, name);
  if (!existsSync(path)) {
    problems.push(`missing ${name} (holder viewer)`);
    continue;
  }
  const body = readFileSync(path, "utf8");
  for (const m of markers) {
    if (!body.includes(m)) problems.push(`${name}: missing content marker "${m}" — file malformed`);
  }
}

console.error(
  `checked ${svgs.length} badges — png/og-card existence + dimensions + byte-floor, ` +
    `page (.html) + embed (.embed.html) existence, and the two explainers ` +
    `(not byte-identity; resvg raster is not byte-stable cross-platform).`,
);
if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.error(`OK: every badge has a 1024x1024 .png, a 1200x630 .og.png (all >= ${MIN_BYTES}B), a .html page, and a .embed.html variant; both explainers present`);
