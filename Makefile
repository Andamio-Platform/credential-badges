PY ?= python3
GEN := generator
IMG := imaging

.PHONY: help badges verify fetch fonts reconcile pngs og-cards

help:
	@echo "Credential badge generator:"
	@echo "  make badges    - regenerate badges/ from $(GEN)/credentials.json (offline, deterministic; self-prunes orphans)"
	@echo "  make pngs      - rasterize badges/*.svg -> badges/*.png at 1024x1024 (resvg; needs 'npm ci' in $(IMG)/)"
	@echo "  make og-cards  - compose + rasterize 1200x630 Open Graph cards -> badges/*.og.png (needs 'npm ci' in $(IMG)/)"
	@echo "  make reconcile - prune badges/ artifacts (svg/png/og.png) with no credentials.json record"
	@echo "  make verify    - round-trip a built badge's rings back to its on-chain hashes"
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

reconcile:
	$(PY) $(GEN)/reconcile.py

verify:
	@f=$$(ls badges/*.*.svg | head -1); echo "decoding $$f"; $(PY) $(GEN)/decode.py "$$f"

fetch:
	$(PY) $(GEN)/fetch.py

fonts:
	$(PY) $(GEN)/embed_fonts.py
