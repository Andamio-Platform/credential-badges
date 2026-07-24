#!/usr/bin/env bash
# Fails if any served badges/ artifact has no matching credentials.json record.
#
# The served-file allowlist (check-allowlist.sh) allowlists badges/ WHOLESALE —
# it is structurally blind to files *inside* badges/, so it catches neither an
# orphan nor an accidental deletion. This guard closes that gap for every
# generated artifact type (svg + the v1.2 png/og.png), resolving #31: a
# credential dropped from credentials.json must not leave art served forever.
#
# Read-only: reports orphans and exits non-zero; deletes nothing. The fix is
# `make reconcile` (or `make badges`, which prunes as it builds).
set -euo pipefail

cd "$(dirname "$0")/../.."

python3 generator/reconcile.py --check
