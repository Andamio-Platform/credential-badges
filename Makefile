PY ?= python3
GEN := generator
IMG := imaging

# Never write .pyc: a stale __pycache__ can mask a source edit on a local build
# whose output gets committed (docs/solutions/runtime-errors/
# stale-pycache-bytecode-masks-source-edits.md). CI is immune (fresh checkout);
# this protects local badges/png/og-card regeneration.
export PYTHONDONTWRITEBYTECODE := 1

WC := web-component

.PHONY: help badges verify fetch fonts reconcile pngs og-cards pages explainers holder web-component

help:
	@echo "Credential badge generator:"
	@echo "  make badges    - regenerate badges/ from $(GEN)/credentials.json (offline, deterministic; self-prunes orphans)"
	@echo "  make pngs      - rasterize badges/*.svg -> badges/*.png at 1024x1024 (resvg; needs 'npm ci' in $(IMG)/)"
	@echo "  make og-cards  - compose + rasterize 1200x630 Open Graph cards -> badges/*.og.png (needs 'npm ci' in $(IMG)/)"
	@echo "  make pages     - generate the display/share page (*.html) + embed variant (*.embed.html) per badge"
	@echo "  make explainers- generate the two explainers -> badges/how-to-share.html, how-to-check.html"
	@echo "  make holder    - generate the holder viewer shell + registry -> badges/_holder.html, _registry.json"
	@echo "  make web-component - copy the andamio-badge source -> embed/andamio-badge.js (served bundle; byte-identical, CI-pinned)"
	@echo "  make reconcile - prune badges/ artifacts (svg/png/og.png/html/embed.html) with no credentials.json record"
	@echo "  make verify    - round-trip a committed badge's rings, and a fresh placeholder-art badge's, back to their on-chain hashes"
	@echo "  make fetch     - refresh $(GEN)/credentials.json from chain (needs network + authed 'andamio' CLI)"
	@echo "  make fonts     - rebuild $(GEN)/fonts.css from Google Fonts (needs network + fonttools)"

badges:
	$(PY) $(GEN)/build.py

pngs:
	cd $(IMG) && node --experimental-strip-types rasterize.ts

og-cards:
	$(PY) $(GEN)/og.py $(IMG)/.og-build
	cd $(IMG) && node --experimental-strip-types compose-og.ts .og-build
	rm -rf $(IMG)/.og-build

pages:
	$(PY) $(GEN)/page.py

explainers:
	$(PY) $(GEN)/explainers.py

holder:
	$(PY) $(GEN)/holder.py

# The served embed bundle is a byte-identical copy of the web-component source
# (dependency-free vanilla ESM — no transpile). CI pins them equal (`cmp`).
web-component:
	@mkdir -p embed
	cp $(WC)/andamio-badge.js embed/andamio-badge.js

reconcile:
	$(PY) $(GEN)/reconcile.py

# Decodes a committed badge AND a freshly built one carrying the placeholder art
# (#131), so an image in the plate can never silently break the rings. The art
# badge is built into a temp dir from the test fixture via --art-dir; placeholder
# art never enters badges/. decode.py exits non-zero on any ring mismatch.
verify:
	@set -e; f=$$(ls badges/*.*.svg | head -1); stem=$$(basename "$$f" .svg); \
	echo "decoding $$f"; $(PY) $(GEN)/decode.py "$$f"; \
	out=$$(mktemp -d); art=$$(mktemp -d); trap 'rm -rf "$$out" "$$art"' EXIT; \
	cp $(GEN)/tests/fixtures/art/placeholder.jpg "$$art/$${stem%%.*}.jpg"; \
	$(PY) $(GEN)/build.py "$$out" --only "$$stem" --art-dir "$$art" >/dev/null; \
	grep -q '<image ' "$$out/$$stem.svg" || { echo "❌ placeholder-art badge carries no <image>"; exit 1; }; \
	echo "decoding $$stem with placeholder plate art"; $(PY) $(GEN)/decode.py "$$out/$$stem.svg"

fetch:
	$(PY) $(GEN)/fetch.py

fonts:
	$(PY) $(GEN)/embed_fonts.py
