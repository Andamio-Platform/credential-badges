#!/usr/bin/env bash
#
# U5 integration test — nginx static-first serving with on-demand render
# fallback (#33, KTD-4). Proves the four U5 contract points:
#
#   1. A baked badge is served straight from disk (NO proxy hop).
#   2. A /badges/ cache-miss proxies to @render and returns the upstream SVG
#      with Content-Type image/svg+xml.
#   3. The badge Cache-Control (max-age=86400) is preserved through the proxy.
#   4. A non-badge unknown path still returns a plain 404 — the fallback is
#      scoped to /badges/, not over-broad.
#
# Offline by design: a stub container stands in for the render service, so no
# live gateway key, GCS bucket, or #17 credential is needed. Requires docker.
#
# CI reuses the already-built image via IMAGE=...; locally the script builds
# its own throwaway tag.
set -euo pipefail

cd "$(dirname "$0")/../.."

NET=cb-u5-net
STUB=cb-u5-stub
APP=cb-u5-app
SENTINEL='RENDERED-BY-RENDER-STUB'
IMAGE="${IMAGE:-}"

cleanup() {
  docker rm -f "$STUB" "$APP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

if [ -z "$IMAGE" ]; then
  IMAGE=credential-badges:u5-fallback-test
  echo "Building $IMAGE ..."
  docker build -t "$IMAGE" .
fi

docker network create "$NET" >/dev/null

# Stub render service: returns a sentinel SVG (image/svg+xml + the badge
# Cache-Control) for ANY path — standing in for the on-demand render service.
docker run -d --name "$STUB" --network "$NET" nginx:alpine >/dev/null
docker exec "$STUB" sh -c "cat >/etc/nginx/conf.d/default.conf <<'EOF'
server {
  listen 80;
  location / {
    default_type image/svg+xml;
    add_header Cache-Control \"public, max-age=86400\";
    return 200 \"<svg xmlns='http://www.w3.org/2000/svg'>$SENTINEL</svg>\";
  }
}
EOF
nginx -s reload"

# Real static host, with the render fallback pointed at the stub.
docker run -d --name "$APP" --network "$NET" \
  -e RENDER_UPSTREAM="http://$STUB:80" \
  -p 8080:8080 "$IMAGE" >/dev/null

# Wait for nginx to accept connections.
for i in $(seq 1 30); do
  curl -sf http://localhost:8080/context/v0.jsonld >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "FAIL: app did not come up"; docker logs "$APP"; exit 1; }
  sleep 0.5
done

fails=0
check() { # description, condition-already-evaluated ($1 desc, $2 ok/empty)
  if [ -n "$2" ]; then echo "  ok   — $1"; else echo "  FAIL — $1"; fails=$((fails+1)); fi
}

baked="$(ls badges/*.svg | grep -v _placeholder | head -1 | xargs -n1 basename)"
# A well-formed (56-hex course_id . 64-hex slt_hash) badge id that is NOT baked.
miss="$(printf 'a%.0s' $(seq 56)).$(printf 'b%.0s' $(seq 64)).svg"

echo "1. baked badge served from disk (no proxy hop): /badges/$baked"
baked_body="$(curl -s "http://localhost:8080/badges/$baked")"
baked_ct="$(curl -sI "http://localhost:8080/badges/$baked" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
# Byte-equality with the on-disk file proves it came from disk, not the proxy
# (the stub would have returned the sentinel SVG instead).
check "body is byte-identical to the on-disk SVG (not the stub sentinel)" \
  "$([ "$baked_body" = "$(cat "badges/$baked")" ] && echo ok)"
check "Content-Type image/svg+xml" "$([ "$baked_ct" = "image/svg+xml" ] && echo ok)"

echo "2. cache-miss badge proxies to @render: /badges/$miss"
miss_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/badges/$miss")"
miss_body="$(curl -s "http://localhost:8080/badges/$miss")"
miss_ct="$(curl -sI "http://localhost:8080/badges/$miss" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
miss_cc="$(curl -sI "http://localhost:8080/badges/$miss" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')"
check "200 from the render upstream" "$([ "$miss_code" = 200 ] && echo ok)"
check "body is the stub sentinel (proves the proxy hop)" "$(echo "$miss_body" | grep -q "$SENTINEL" && echo ok)"
check "Content-Type image/svg+xml" "$([ "$miss_ct" = "image/svg+xml" ] && echo ok)"
check "Cache-Control max-age=86400 preserved through proxy" "$(echo "$miss_cc" | grep -q 'max-age=86400' && echo ok)"

echo "3. fallback is scoped to /badges/ (not over-broad)"
nonbadge_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/not-a-badge.svg")"
ctxmiss_code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8080/context/does-not-exist.jsonld")"
check "unknown non-badge .svg -> plain 404 (no render fallback)" "$([ "$nonbadge_code" = 404 ] && echo ok)"
check "unknown .jsonld -> plain 404" "$([ "$ctxmiss_code" = 404 ] && echo ok)"

echo
if [ "$fails" -eq 0 ]; then
  echo "U5 nginx fallback: ALL CHECKS PASSED"
else
  echo "U5 nginx fallback: $fails CHECK(S) FAILED"
  docker logs "$APP" || true
  exit 1
fi
