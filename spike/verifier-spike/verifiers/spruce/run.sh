#!/usr/bin/env bash
# Rung 1 · spruce (spruceid/ssi) verifier runner — issue #15.
#
# Verifies the DI eddsa-rdfc-2022 + did:web pre-flight sample and reports the
# outcome. Pass criterion: zero errors AND zero warnings (exit 0). Any finding
# => non-zero.
#
# Prereq:      rustup + cargo   (install: https://rustup.rs)
# Reproduces:  spike/verifier-spike/results/spruce.md
#
# Usage: ./run.sh [path-to-credential.jsonld]
#   Defaults to the git-tracked, did:web-resolvable sample in ../../publish/.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sample="${1:-$here/../../publish/credential.jsonld}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "BLOCKED: cargo not found — install rustup+cargo (https://rustup.rs), then re-run." >&2
  exit 3
fi

echo "# spruce (spruceid/ssi) verify — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "sample: $sample"
echo
cargo run --quiet --manifest-path "$here/Cargo.toml" -- "$sample"
