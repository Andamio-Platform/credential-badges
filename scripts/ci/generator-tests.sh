#!/usr/bin/env bash
# The generator test suite: hermetic, stdlib-only (no pip install). CI's
# generator-tests job and `make ci-local` both run this file, so the list of
# suites lives in one place. A new suite added here runs in both.
set -euo pipefail
cd "$(dirname "$0")/../.."

python3 generator/tests/test_render_parity.py
python3 generator/tests/test_render.py
python3 generator/tests/test_api_client.py
python3 generator/tests/test_fetch.py
python3 generator/tests/test_reconcile.py
python3 generator/tests/test_og.py
python3 generator/tests/test_page.py
python3 generator/tests/test_explainers.py
python3 generator/tests/test_holder.py
python3 generator/tests/test_bake.py
python3 generator/tests/test_art.py
python3 generator/tests/test_baked_signatures.py
python3 generator/art.py --check
python3 generator/tests/test_style.py
python3 generator/style.py --check
python3 scripts/tests/test_alias_gate.py
python3 scripts/tests/test_cache_admin.py
