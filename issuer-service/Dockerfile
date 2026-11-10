# The OB3 issuer service (Rung 8.4; /credentials/* routes here). NOT the
# static host, NOT the render service — the third Cloud Run service in this
# repo.
#
# Build context MUST be the repo root, so the image bakes the trust-critical
# repo artifacts the service pins at runtime:
#   docker build -f issuer-service/Dockerfile -t credential-badges-issuer .
#
#   context/v1.jsonld          — the committed Andamio context (closed loader
#                                serves these bytes; boot check verifies live)
#   .well-known/did.json       — bundled drift-check fallback (lockstep CI
#                                artifact; live did.json is authoritative)
#   status/                    — the served key-epoch status list (post-sign
#                                status check reads these bytes)
#   generator/credentials.json — the badge registry: titles + the set of
#                                badges this service will ever sign for
#   tools/gen-did-json.ts      — the canonical dependency-free multibase/SPKI
#                                encoder (imported by src/signer.ts)

# Builds on the Debian slim node image and runs on distroless, both pinned by
# digest. The runtime has no shell or package manager and runs as nonroot; its
# entrypoint is node, so CMD names only the script. Move both images together,
# to digests carrying the Node patch in the repo's .nvmrc.
FROM node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS deps
WORKDIR /app/issuer-service
COPY issuer-service/package.json issuer-service/package-lock.json ./
RUN npm ci --omit=dev

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3

WORKDIR /app

COPY --from=deps --chown=nonroot:nonroot /app/issuer-service/node_modules issuer-service/node_modules
COPY --chown=nonroot:nonroot issuer-service/package.json   issuer-service/package.json
COPY --chown=nonroot:nonroot context/v1.jsonld           context/v1.jsonld
COPY --chown=nonroot:nonroot .well-known/did.json        .well-known/did.json
COPY --chown=nonroot:nonroot status/                     status/
COPY --chown=nonroot:nonroot generator/credentials.json  generator/credentials.json
COPY --chown=nonroot:nonroot tools/gen-did-json.ts       tools/gen-did-json.ts
COPY --chown=nonroot:nonroot issuer-service/contexts/    issuer-service/contexts/
COPY --chown=nonroot:nonroot issuer-service/src/         issuer-service/src/

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080

WORKDIR /app/issuer-service
# The startup drift check runs BEFORE the listener opens (fail closed): a
# drifted did.json / context / unregistered key version kills the container,
# so Cloud Run never routes traffic to a mis-keyed revision. Node 26 strips
# TypeScript types by default.
CMD ["src/main.ts"]
