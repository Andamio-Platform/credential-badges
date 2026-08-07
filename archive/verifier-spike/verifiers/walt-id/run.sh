#!/usr/bin/env bash
# Rung 1 · walt-id (waltid-identity) verifier runner — issue #16.
#
# Runs waltid-identity's `vc verify` against the OB 3.0 sample and reports the
# outcome. Pass criterion: zero errors AND zero warnings.
#
# EMPIRICAL FINDING (2026-07-09, waltid-cli built from tag v0.20.5): waltid-cli's
# `vc verify` is JWS/SD-JWT-only — it does NOT parse a W3C Data Integrity
# (`DataIntegrityProof`/`eddsa-rdfc-2022`) JSON-LD credential. Against our DI
# sample every policy fails at the format gate ("String does not look like JWS").
# This is the documented DI gap (a finding, not a plan failure): spruce +
# 1EdTech carry DI green by independence-of-coverage. See ../../results/walt-id.md.
#
# DISTRIBUTION: there is NO official waltid-cli docker image (Docker Hub `waltid/`
# publishes services, not the CLI; ghcr/releases have no CLI artifact). Build the
# CLI from source, then point this runner at the launcher via $WALTID_CLI:
#
#   git clone --depth 1 --branch v0.20.5 https://github.com/walt-id/waltid-identity
#   cd waltid-identity/waltid-applications/waltid-cli && ../../gradlew installJvmDist
#   export WALTID_CLI="$PWD/build/install/waltid-jvm/bin/waltid"
#
# EXIT-CODE NOTE: waltid-cli `vc verify` exits 0 even when a policy FAILS (it only
# exits non-zero on argument errors), so this runner gates on parsed stdout
# (Success!/Fail!), never the bare exit code. It fails CLOSED.
#
# Usage: ./run.sh [path-to-credential.jsonld]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sample="${1:-$here/../../publish/credential.jsonld}"

# Locate a built waltid CLI: $WALTID_CLI, else `waltid` on PATH.
cli="${WALTID_CLI:-}"
if [ -z "$cli" ] && command -v waltid >/dev/null 2>&1; then
  cli="$(command -v waltid)"
fi
if [ -z "$cli" ] || [ ! -x "$cli" ]; then
  cat >&2 <<'EOF'
BLOCKED: waltid CLI not found. There is no official waltid-cli docker image;
build it from source and set $WALTID_CLI (see the header of this script and
verifiers/walt-id/README.md):
  git clone --depth 1 --branch v0.20.5 https://github.com/walt-id/waltid-identity
  cd waltid-identity/waltid-applications/waltid-cli && ../../gradlew installJvmDist
  export WALTID_CLI="$PWD/build/install/waltid-jvm/bin/waltid"
EOF
  exit 3
fi

echo "# walt-id (waltid-identity) verify — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "cli:    $cli"
echo "sample: $sample"
echo

# Apply the two policies this runner exists to confirm (signature carries the DI
# proof; revoked-status-list carries the suspension status list). Needs network
# egress to resolve the did:web issuer + status list.
set +e
out="$("$cli" vc verify -p signature -p revoked-status-list "$sample" 2>&1)"
set -e
printf '%s\n' "$out"
echo

# --- gate on parsed stdout, fail-closed (exit code is unreliable) ------------
# Structural DI-format finding: waltid-cli rejects DI JSON-LD as non-JWS.
if grep -qiE 'does not look like JWS|Invalid SD-JWT' <<<"$out"; then
  echo "outcome=FINDING errors=1 warnings=0" >&2
  echo "FINDING: waltid-cli vc verify is JWS/SD-JWT-only and cannot ingest the" >&2
  echo "  W3C Data Integrity (eddsa-rdfc-2022) JSON-LD sample. Documented DI gap;" >&2
  echo "  independence-of-coverage holds (spruce + 1EdTech carry DI). Not a clean" >&2
  echo "  verify — see ../../results/walt-id.md." >&2
  exit 1
fi

fail=0
if grep -qiE '\bFail!\b' <<<"$out"; then
  echo "FAIL: a verification policy reported Fail!." >&2
  fail=1
fi
if ! grep -qiE '\bSuccess!\b' <<<"$out"; then
  echo "FAIL: no policy reported Success! — nothing verified clean." >&2
  fail=1
fi
if grep -qiE '\bwarn(ing)?s?\b' <<<"$out"; then
  echo "FAIL: verifier emitted a warning — any warning is a finding." >&2
  fail=1
fi
[ "$fail" -eq 0 ] && echo "outcome=VALID errors=0 warnings=0"
exit "$fail"
