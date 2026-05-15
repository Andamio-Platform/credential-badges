# Static host for the Andamio OB 3.0 JSON-LD context.
#
# ALLOWLIST COPY ONLY. Never `COPY .` or `COPY *`. This is a forever-public
# endpoint; an accidental `COPY .` of a future NOTES.md / draft would leak
# internal content to strict verifiers worldwide. Add a path here only after
# deciding it is safe to serve publicly and forever.
#
# Currently allowlisted: context/ (the deliverable) and README.md.
# When schemas/ or badges/ land and are confirmed public, add explicit
# COPY lines for them here AND update scripts/ci/check-allowlist.sh.

FROM nginx:alpine

# Strip the stock site so only allowlisted files can ever be served.
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

COPY nginx/default.conf /etc/nginx/conf.d/default.conf

COPY context/   /usr/share/nginx/html/context/
COPY README.md  /usr/share/nginx/html/README.md

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/context/v0.jsonld >/dev/null 2>&1 || exit 1
