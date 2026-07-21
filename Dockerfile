# Static host for the Andamio OB 3.0 JSON-LD context.
#
# ALLOWLIST COPY ONLY. Never `COPY .` or `COPY *`. This is a forever-public
# endpoint; an accidental `COPY .` of a future NOTES.md / draft would leak
# internal content to strict verifiers worldwide. Add a path here only after
# deciding it is safe to serve publicly and forever.
#
# Currently allowlisted: context/ (the deliverable), issuer/ (the hosted
# OB 3.0 issuer Profile), badges/ (presentation-layer badge imagery),
# status/ (the key-epoch BitstringStatusList credential), .well-known/ (the
# did:web DID document), public/ (the interactive credential designer,
# served under /design/ — never merged into the web root, so it can never
# shadow a trust path), and README.md.
# When schemas/ land and are confirmed public, add an explicit COPY line
# here AND update scripts/ci/check-allowlist.sh.

FROM nginx:alpine

# Strip the stock site so only allowlisted files can ever be served.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# The config is a TEMPLATE: the nginx image's docker-entrypoint runs envsubst
# over /etc/nginx/templates/*.template at startup, writing the result to
# /etc/nginx/conf.d/ (extension stripped). This injects the on-demand render
# service URL (#33, U5) without baking a deploy-specific host into the image.
#
# RENDER_UPSTREAM is where a /badges/ cache-miss is proxied (KTD-4). The real
# Cloud Run URL is injected at deploy (U7 / private-ops Terraform). The default
# must be an IP literal, NOT a domain: nginx resolves a literal proxy_pass
# hostname at STARTUP and fails to boot if it can't — so a placeholder domain
# would break the container (and the CI smoke test) whenever the env var is
# unset. 127.0.0.1:9 (discard) needs no DNS, so nginx always boots; with the
# render service not yet wired, the baked badges still serve from disk and a
# cache-miss simply returns 502 (connection refused) until U7 sets the URL.
# NGINX_ENVSUBST_FILTER restricts substitution to RENDER_UPSTREAM so nginx's
# own runtime $variables ($uri, $host, $proxy_host, $scheme, …) are untouched.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
ENV RENDER_UPSTREAM="http://127.0.0.1:9"
ENV NGINX_ENVSUBST_FILTER="RENDER_UPSTREAM"

COPY context/   /usr/share/nginx/html/context/
COPY issuer/    /usr/share/nginx/html/issuer/
COPY badges/    /usr/share/nginx/html/badges/
# Key-epoch BitstringStatusList credential (Rung 8.3, deployment plan
# Decision 3) — the suspension-signal convenience surface; forever-public.
COPY status/    /usr/share/nginx/html/status/
# did:web DID document — a forever-public endpoint (did:web:credentials.andamio.io).
COPY .well-known/ /usr/share/nginx/html/.well-known/
# Interactive credential designer (#37, PR #50) — its own subtree, NOT the
# web root: the root belongs to the did:web trust surface, and a root-merge
# would let a future public/ file silently shadow .well-known/, issuer/, or
# context/.
COPY public/    /usr/share/nginx/html/design/
COPY README.md  /usr/share/nginx/html/README.md

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/context/v0.jsonld >/dev/null 2>&1 || exit 1
