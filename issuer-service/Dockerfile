# credential-badges-issuer (Rung 8.4) — the OB3 issuer service (deployment
# plan Decision 5; the LB routes /credentials/* here). NOT the static host,
# NOT the render service — the third Cloud Run service in this repo (the plan
# predates the render service, so it says "two").
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
#   generator/credentials.json — the badge registry (R5): titles + the set of
#                                badges this service will ever sign for
#   tools/gen-did-json.ts      — the canonical dependency-free multibase/SPKI
#                                encoder (imported by src/signer.ts)

FROM node:24-slim

WORKDIR /app

COPY issuer-service/package.json issuer-service/package-lock.json issuer-service/
RUN cd issuer-service && npm ci --omit=dev

COPY context/v1.jsonld           context/v1.jsonld
COPY .well-known/did.json        .well-known/did.json
COPY status/                     status/
COPY generator/credentials.json  generator/credentials.json
COPY tools/gen-did-json.ts       tools/gen-did-json.ts
COPY issuer-service/contexts/    issuer-service/contexts/
COPY issuer-service/src/         issuer-service/src/

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080

USER node
WORKDIR /app/issuer-service
# The startup drift check runs BEFORE the listener opens (fail closed): a
# drifted did.json / context / unregistered key version kills the container,
# so Cloud Run never routes traffic to a mis-keyed revision.
CMD ["node", "--experimental-strip-types", "src/main.ts"]
