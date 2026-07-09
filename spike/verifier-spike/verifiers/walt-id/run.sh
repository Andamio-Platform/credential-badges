#!/usr/bin/env bash
# Rung 1 · walt-id (waltid-identity) verifier runner — issue #16.
#
# Runs waltid-identity v0.20.x verify against the OB 3.0 sample via docker.
# Confirms two things the hosted portal cannot (it is OpenID4VP-only):
#   1. DI eddsa-rdfc-2022 cryptosuite verifies (walt-id's DI support is a
#      documented gap — empirical confirmation is the point of this runner).
#   2. BitstringStatusListEntry with statusPurpose: "suspension" is surfaced.
# Pass criterion: zero errors AND zero warnings.
#
# Prereqs:     running docker daemon. Fallback: gradle-from-source (see README.md).
# #977 note:   publish/did.json is single-key (verificationMethod #key-2026-05)
#              to sidestep walt-id issue #977 (multi-key did:web resolution).
# Reproduces:  spike/verifier-spike/results/walt-id.md
#
# Usage: ./run.sh [path-to-credential.jsonld]
#   Defaults to the git-tracked, did:web-resolvable sample in ../../publish/.
set -euo pipefail

WALTID_VERSION="${WALTID_VERSION:-0.20.0}"
IMAGE="${WALTID_IMAGE:-waltid/waltid-cli:${WALTID_VERSION}}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sample="${1:-$here/../../publish/credential.jsonld}"

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: docker not found — install docker, or use the gradle fallback (README.md)." >&2
  exit 3
fi
if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: docker daemon not running — start it, or use the gradle fallback (README.md)." >&2
  exit 3
fi

echo "# walt-id (waltid-identity ${WALTID_VERSION}) verify — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "sample: $sample"
echo
# The credential's directory is mounted read-only at /data; the CLI verifies the
# file in place (needs network egress to resolve the did:web issuer + status list).
# NOTE (adapter point): confirm the `vc verify` subcommand/flags against the
# pinned ${WALTID_VERSION} release — the waltid-cli surface is the only piece
# coupled to the tool version.
docker run --rm --network host \
  -v "$(cd "$(dirname "$sample")" && pwd)":/data:ro \
  "$IMAGE" vc verify --verbose "/data/$(basename "$sample")"
