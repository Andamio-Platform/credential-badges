# Badge generator

Regenerates the credential badge SVGs in `../badges/` from on-chain data. *"If it
can be generated, it must be generated"* — the badges are build output, not
hand-authored files.

Each badge is the **d04 "Proof Rings"** design: light interior, a per-course
palette, two encoded rings (**outer = `course_id`, inner = `slt_hash`**), OB3
credential metadata baked into the SVG, and fonts embedded so the file is fully
self-contained. The ring tick geometry round-trips back to the on-chain hashes —
the art *is* the proof (`make verify`).

## Pipeline

```
fetch.py   →  credentials.json   →  build.py    →  ../badges/<course_id>.<slt_hash>.svg
(chain, authed)   (snapshot)         (offline)   ┐
                                                  ├→ rasterize.ts  → ../badges/<stem>.png     (1024x1024)
                                     og.py ───────┼→ compose-og.ts → ../badges/<stem>.og.png  (1200x630)
                                     (imaging/, resvg)
                                     page.py ─────┴→ ../badges/<stem>.html  (display/share page, served at /badges/<stem>)
```

Per credential, `badges/` holds four artifacts: the **SVG** (the badge, and the
verifiable-credential carrier), a **download PNG**, a **1200x630 Open Graph
card** for social unfurls, and a static **display/share page** (`.html`). The
SVG is the source of truth; the PNGs are raster presentation output; the page is
a human landing surface served at the extensionless `/badges/{stem}` URL.

| Command | What it does | Needs |
|---|---|---|
| `make badges` | Render every badge from `credentials.json`, then self-prune orphans. Deterministic + offline. | Python 3 |
| `make pngs` | Rasterize `badges/*.svg` → `badges/*.png` (1024x1024) via resvg. | Node ≥ 24, `npm ci` in `../imaging/` |
| `make og-cards` | Compose + rasterize 1200x630 Open Graph cards → `badges/*.og.png`. | Node ≥ 24, `npm ci` in `../imaging/` |
| `make pages` | Generate the static display/share page per badge → `badges/*.html`, with server-delivered Open Graph tags. | Python 3 |
| `make reconcile` | Prune `badges/` artifacts (svg/png/og.png/html) with no `credentials.json` record. | Python 3 |
| `make verify` | Decode a built badge's rings and check they equal its on-chain hashes. | Python 3 |
| `make fetch`  | Refresh `credentials.json` from chain (andamioscan + Andamio CLI). | network, authed `andamio` CLI |
| `make fonts`  | Rebuild `fonts.css` (subset, base64-embed Archivo + Spline Sans Mono). | network, `fonttools`+`brotli` |

The deterministic split: **`fetch` is the only step that needs auth/network**;
`build` is pure Python and reproduces byte-identical SVGs from the snapshot. PNG
raster is deterministic per-machine but not guaranteed byte-stable across
platforms, so CI checks PNG/OG **existence + dimensions**, not byte-identity —
the SVG byte-parity test owns visual correctness.

**Self-pruning (#31).** `build.py` was additive-only; a credential dropped from
`credentials.json` used to leave its art served forever. `reconcile.py` (run by
`make badges`, or standalone via `make reconcile`) deletes any `badges/` artifact
— across **all** types (svg/png/og.png) — whose stem has no non-skipped record,
guarding `_placeholder.svg`. `scripts/ci/check-orphans.sh` (a `--check` mode)
fails CI on any orphan.

**Rasterization lives in `../imaging/`** (a separate Node package, `@resvg/resvg-js`)
so this Python generator stays stdlib-only and hermetic. resvg needs two things
the badges do unusually: colors are CSS custom properties (`var(--token, …)`) and
fonts are base64 `@font-face` — `imaging/rasterize.ts` inlines the var fallbacks
and hands resvg the decoded font buffers. See `../imaging/`.

## Files

- `build.py` — render orchestrator (snapshot → SVGs), then self-prunes. Per-course palette + light interior.
- `gen.py` — the SVG generator (palette-driven, ring encoder, OB3 metadata, inlines `fonts.css`).
- `colors.py` — the 10 palettes + the light-interior transform.
- `og.py` — composes the 1200x630 Open Graph card SVG per credential (reuses palette + fonts).
- `page.py` — generates the static display/share page per credential (#70): server-delivered Open Graph tags in `<head>`, served at the extensionless `/badges/{stem}` URL. Reserves `/badges/{stem}/{alias}` for the holder viewer (#73).
- `reconcile.py` — self-pruning reconciler (#31): deletes `badges/` orphans across svg/png/og.png/html.
- `decode.py` — ring-geometry verifier (proves a badge round-trips).
- `fetch.py` — data refresh from chain → `credentials.json`.
- `embed_fonts.py` — subset + base64-embed the fonts → `fonts.css`.
- `credentials.json` — the data snapshot (one row per credential: course_id, slt_hash, titles).
- `fonts.css` — generated `@font-face` block (checked in so `make badges` stays offline).

The raster tooling lives in `../imaging/` (`rasterize.ts`, `compose-og.ts`) and
`../tools/bake-png-vc.ts` (optional: bake the signed VC into a PNG via an iTXt
chunk, the PNG analog of `../tools/bake-signed-vc.ts`).

## Notes

- **Not served.** This directory is build tooling; only `context/`, `issuer/`,
  `badges/`, and `README.md` are copied into the Docker image (see the allowlist
  in the root `Dockerfile` / `scripts/ci/check-allowlist.sh`).
- Badge art is the **mutable presentation layer**, never identity-bearing — an
  issuer may refresh it anytime without invalidating any issued credential.
- `make fonts` wants `fonttools`: `python3 -m venv .venv && .venv/bin/pip install
  fonttools brotli && .venv/bin/python generator/embed_fonts.py`.
