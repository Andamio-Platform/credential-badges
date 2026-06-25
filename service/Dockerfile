# On-demand badge render service (#33). NOT the static host — this is a separate
# Cloud Run service. Build context MUST be the repo root so it can ship the
# generator render-core:
#   docker build -f service/Dockerfile -t credential-badges-render .
#
# Ships generator/ (gen, render, api_client, colors, fetch AND fonts.css — without
# fonts.css the SVGs are not self-contained and rendering breaks) and service/.
# curl + ca-certificates are required: api_client reads titles via curl (matching
# fetch.py, avoiding a stdlib-SSL cert gap).
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY service/requirements.txt service/requirements.txt
RUN pip install --no-cache-dir -r service/requirements.txt

COPY generator/ generator/
COPY service/   service/
COPY badges/_placeholder.svg badges/_placeholder.svg

ENV PORT=8080 BADGE_NETWORKS=mainnet,preprod
EXPOSE 8080

# app.py adds ../generator to sys.path; gunicorn serves the stdlib WSGI callable.
WORKDIR /app/service
HEALTHCHECK --interval=30s --timeout=3s \
  CMD curl -fsS "http://localhost:${PORT}/healthz" >/dev/null || exit 1
CMD exec gunicorn --bind ":${PORT}" --workers 2 --threads 8 --timeout 60 app:application
