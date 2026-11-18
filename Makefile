PY ?= python3
GEN := generator
IMG := imaging

# Never write .pyc: a stale __pycache__ can mask a source edit on a local build
# whose output gets committed (docs/solutions/runtime-errors/
# stale-pycache-bytecode-masks-source-edits.md). CI is immune (fresh checkout);
# this protects local badges/png/og-card regeneration.
export PYTHONDONTWRITEBYTECODE := 1

WC := web-component

.PHONY: help badges verify fetch fonts designer-fonts reconcile pngs og-cards pages explainers holder web-component sign-badge ci-local

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
	@echo "  make designer-fonts - copy $(GEN)/fonts.css -> public/styles/badge_fonts.css (designer preview faces; byte-identical, CI-pinned)"
	@echo "  make sign-badge BADGE=<id> - dry-run, KMS-sign, validate and bake ONE badge's class artifact, then rebuild its page + registry"
	@echo "  make ci-local  - run the CI suites locally (everything except the Docker image builds and the npm pack check)"

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
# (#131): proves the art build path leaves the ring geometry and the baked
# metadata intact. It cannot see visual bleed into the ring band; that is the
# ring-band check in imaging/rasterize.test.ts. The art badge is built into a temp
# dir from the test fixture via --art-dir, so placeholder art never enters
# badges/. decode.py exits non-zero on any ring mismatch.
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

# The /design/ preview renders with the badge faces. It is a static app under
# public/, so it gets a byte copy of fonts.css rather than a second build; CI
# pins them equal (`cmp`). Outfit, its UI face, is the `designer` target of
# embed_fonts.py.
designer-fonts:
	cp $(GEN)/fonts.css public/styles/badge_fonts.css

# Signs one badge's class artifact end to end. The badge must already be in
# $(GEN)/credentials.json (that is the signing gate; nothing needs to be
# deployed first, so a new badge can be registered, signed and baked in one PR).
# Order matters: the 1EdTech validator runs on the KMS-signed artifact BEFORE it
# is baked, and a failed validation stops here. The expansion pin is left as a
# deliberate manual step: a pin records the artifact as signed, it does not
# check it, so compare the printed sha256 against the transcript line first.
# Needs gcloud credentials for the signing key and `npm ci` in signing/. See the
# class-artifact signing runbook (private andamio-ops repo).
sign-badge:
	@test -n "$(BADGE)" || { echo "usage: make sign-badge BADGE=<courseId>.<sltHash>"; exit 2; }
	cd signing && npm run -s sign:class -- --signer local --badge $(BADGE)
	cd signing && npm run -s sign:class -- --signer kms --badge $(BADGE)
	cd signing && npm run -s validate:1edtech -- class-artifacts/$(BADGE).json --label sign-badge
	cd signing && npm run -s bake:class -- --badge $(BADGE)
	$(MAKE) pages holder
	@echo ""
	@echo "artifact sha256: $$(shasum -a 256 signing/class-artifacts/$(BADGE).json | cut -c1-16)"
	@echo "transcript line: $$(grep -h '$(BADGE)' $$(ls -t signing/transcripts/class-sign-kms-*.txt | head -1) | head -1)"
	@echo "If they match, add this pin to signing/class-artifact-pins.json in the same commit:"
	@cd signing && npm run -s test:expansion-pin 2>&1 | grep -E '"$(BADGE)\.json": "[0-9a-f]{64}"' | head -1 || true
	@echo "Then run: make ci-local"

# Runs what .github/workflows/ci.yml runs, minus the Docker image builds (and the
# smoke tests that need them) and the web-component npm pack check. The generator
# suite list is shared with CI through scripts/ci/generator-tests.sh; the other
# steps are one-liners over globs. A new CI step needs a line here too.
ci-local:
	bash scripts/ci/check-allowlist.sh
	bash scripts/ci/check-orphans.sh
	node --experimental-strip-types --test tools/*.test.ts
	node --experimental-strip-types --test signing/*.test.ts
	cd signing && npm ci --silent && npm run -s test:expansion-pin && npm run -s test:class-expansion
	cd issuer-service && npm ci --silent && npm test --silent
	bash scripts/ci/generator-tests.sh
	cmp generator/fonts.css public/styles/badge_fonts.css
	cd $(IMG) && npm ci --silent && npm test --silent && node --experimental-strip-types check-artifacts.ts
	node --experimental-strip-types --test $(WC)/andamio-badge.test.ts
	cmp $(WC)/andamio-badge.js embed/andamio-badge.js
	@echo "ci-local: all suites passed"
