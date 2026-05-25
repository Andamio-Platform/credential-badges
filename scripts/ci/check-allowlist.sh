#!/usr/bin/env bash
# Fails if any file outside the Dockerfile allowlist would be baked into the
# served image. Run as a required PR check AND in the deploy workflow.
#
# The allowlist is the set of top-level paths the Dockerfile COPYs into
# /usr/share/nginx/html. Keep this in sync with the Dockerfile by hand —
# the whole point is that adding a served path is a deliberate, reviewed act.
set -euo pipefail

# Top-level repo entries that ARE allowed to be served.
ALLOWED=("context" "issuer" "badges" "README.md")

# Repo paths that exist for tooling/build and are never served — ignore them.
IGNORED_PREFIXES=(".git" ".github" "nginx" "scripts" "Dockerfile" ".dockerignore" "DEPLOY.md" ".gitignore" "docs" "spike")

cd "$(dirname "$0")/../.."

fail=0
while IFS= read -r entry; do
  entry="${entry#./}"
  [ -z "$entry" ] && continue

  top="${entry%%/*}"

  # Skip tooling/build paths.
  skip=0
  for p in "${IGNORED_PREFIXES[@]}"; do
    if [ "$top" = "$p" ] || [ "$entry" = "$p" ]; then skip=1; break; fi
  done
  [ "$skip" = 1 ] && continue

  # Anything left must be in the allowlist.
  ok=0
  for a in "${ALLOWED[@]}"; do
    if [ "$top" = "$a" ] || [ "$entry" = "$a" ]; then ok=1; break; fi
  done

  if [ "$ok" != 1 ]; then
    echo "DISALLOWED (would be served but not in allowlist): $entry"
    fail=1
  fi
done < <(git ls-files | awk -F/ '{print $1}' | sort -u)

if [ "$fail" != 0 ]; then
  echo ""
  echo "A file outside the served allowlist exists. If it SHOULD be public+forever,"
  echo "add an explicit COPY line in the Dockerfile and add it to ALLOWED here."
  echo "If not, it must not be in the repo root that gets served."
  exit 1
fi

echo "allowlist OK — only ${ALLOWED[*]} would be served"
