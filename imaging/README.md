# imaging — badge raster pipeline (#69)

Build-time rasterization for the credential badges. Turns the deterministic
badge SVGs (`../generator/`) into the raster artifacts social platforms and
download buttons need:

- `rasterize.ts` — each `badges/*.svg` → `badges/*.png` at **1024×1024** (`make pngs`).
- `compose-og.ts` — rasterizes the 1200×630 Open Graph card SVGs authored by
  `../generator/og.py` → `badges/*.og.png` (`make og-cards`).
- `check-artifacts.ts` — CI coverage guard: every badge SVG has a matching PNG +
  OG card at the right dimensions (existence + dimensions, **not** byte-identity).

**Never served.** Like `../tools/`, this is build tooling — the committed
`badges/*.png` / `*.og.png` are what ship, not this directory (it is in
`scripts/ci/check-allowlist.sh` `IGNORED_PREFIXES`).

## Why a separate package

The Python generator (`../generator/`) is deliberately stdlib-only and hermetic.
Rasterization needs a native dependency (`@resvg/resvg-js`, pinned), so it lives
here with its own `npm ci` CI job, leaving `generator-tests` untouched.

## Two things resvg needs that the badges do unusually

1. **CSS custom properties.** The badges color everything with
   `var(--token, <fallback>)`; resvg does not support `var()`, so it would render
   a solid black disc. `inlineCssVars()` replaces each with `gen.py`'s literal
   palette fallback (lossless, deterministic).
2. **Embedded fonts.** Fonts are base64 `@font-face` in `generator/fonts.css`;
   resvg does not parse those. `loadFontBuffers()` decodes the woff2 blobs and
   hands them to resvg (`loadSystemFonts: false`) so glyphs render from the exact
   embedded fonts — no system-font dependency.

## Determinism

Raster output is byte-stable for repeated renders on one machine but not
guaranteed across platforms (fonts, libc). The committed PNGs are the build
output; CI checks existence + dimensions, and the SVG byte-parity test
(`generator/tests/test_render_parity.py`) remains the guarantor of visual
correctness.

```
npm ci
npm test        # rasterize.test.ts — font fidelity, var inlining, dimensions
```
