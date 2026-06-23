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
fetch.py   →  credentials.json   →  build.py   →  ../badges/<course_id>.<slt_hash>.svg
(chain, authed)   (snapshot)        (offline, deterministic)
```

| Command | What it does | Needs |
|---|---|---|
| `make badges` | Render every badge from `credentials.json`. Deterministic + offline. | Python 3 |
| `make verify` | Decode a built badge's rings and check they equal its on-chain hashes. | Python 3 |
| `make fetch`  | Refresh `credentials.json` from chain (andamioscan + Andamio CLI). | network, authed `andamio` CLI |
| `make fonts`  | Rebuild `fonts.css` (subset, base64-embed Archivo + Spline Sans Mono). | network, `fonttools`+`brotli` |

The deterministic split: **`fetch` is the only step that needs auth/network**;
`build` is pure Python and reproduces byte-identical SVGs from the snapshot.

## Files

- `build.py` — render orchestrator (snapshot → SVGs). Per-course palette + light interior.
- `gen.py` — the SVG generator (palette-driven, ring encoder, OB3 metadata, inlines `fonts.css`).
- `colors.py` — the 10 palettes + the light-interior transform.
- `decode.py` — ring-geometry verifier (proves a badge round-trips).
- `fetch.py` — data refresh from chain → `credentials.json`.
- `embed_fonts.py` — subset + base64-embed the fonts → `fonts.css`.
- `credentials.json` — the data snapshot (one row per credential: course_id, slt_hash, titles).
- `fonts.css` — generated `@font-face` block (checked in so `make badges` stays offline).

## Notes

- **Not served.** This directory is build tooling; only `context/`, `issuer/`,
  `badges/`, and `README.md` are copied into the Docker image (see the allowlist
  in the root `Dockerfile` / `scripts/ci/check-allowlist.sh`).
- Badge art is the **mutable presentation layer**, never identity-bearing — an
  issuer may refresh it anytime without invalidating any issued credential.
- `make fonts` wants `fonttools`: `python3 -m venv .venv && .venv/bin/pip install
  fonttools brotli && .venv/bin/python generator/embed_fonts.py`.
