# DEPLOY

How `credential-badges` gets to `https://credentials.andamio.io/`.

## Two services, one domain

Badge serving is **static-first with an on-demand render fallback** (#33). Two
Cloud Run services back `credentials.andamio.io`:

1. **Static host** (`credential-badges`) — serves the pre-generated badge set,
   the JSON-LD context, and `/issuer`. A `/badges/<name>.svg` **miss** returns
   nginx `404 → @render`, proxying to the render service via `RENDER_UPSTREAM`.
2. **Render service** (`credential-badges-render`) — renders any credential on
   demand (reads titles from the andamio-api gateway, caches the SVG in GCS),
   so "any credential generates + serves on demand" holds without pre-baking.

A request resolves static-first; only a cache+disk miss reaches the render
service, which renders once and caches. Each service ships + deploys
independently (separate image, separate tag prefix — see below).

| Piece | Static host | Render service |
|---|---|---|
| GCP project | `andamio-credentials` (dedicated, permanent — project-deletion lien) | same |
| Cloud Run service | `credential-badges` | `credential-badges-render` |
| Image | `.../credential-badges/app:<tag>` | `.../credential-badges/render:<tag>` |
| Dockerfile | `Dockerfile` (allowlisted COPY, root context) | `service/Dockerfile` (**root context** — ships `generator/` + `service/`) |
| Deploy trigger | `v[0-9]*.*.*` tag → `deploy.yml` | `vrender-*` tag → `deploy-render.yml` |
| Auth | WIF, **ref-constrained to `refs/tags/v*`** (same pool/provider/CICD SA) | same |
| Runtime SA | TF-managed | `credential-badges-render-sa` (TF), `secretAccessor` on the two gateway keys only |
| Secrets | none | `ANDAMIO_MAINNET_API_KEY` / `ANDAMIO_PREPROD_API_KEY` ← Secret Manager (TF-wired) |
| GCS cache | none | render cache bucket (TF-managed, lifecycle TTL) |
| Domain | `google_cloud_run_domain_mapping`, Google-managed cert, `force_override = false` | reached via the static host's `RENDER_UPSTREAM`, not a public domain |
| Infra source of truth | Terraform, private ops repo | Terraform, private ops repo (`andamio-ops#170`) |

Both deploy workflows reuse the **same** WIF pool/provider + `credential-badges-cicd-sa`
(no new identity). `vrender-*` satisfies the `refs/tags/v*` OIDC constraint;
`v[0-9]*.*.*` (the static trigger) deliberately does **not** match a `vrender-*`
ref, so a render release never double-fires the static deploy.

## Render-service infra delta — `andamio-ops#170`

The render service's GCP surface lives in the private ops repo, PR
[`andamio-ops#170`](https://github.com/Andamio-Platform/andamio-ops/pull/170)
(branch `feat/credential-badges-render-service`, stacked on the unmerged
`#147`/`feat/146-credentials-jsonld-context`). It adds, under
`terraform/credentials/`: the render Cloud Run service (placeholder image
first), the GCS cache bucket, the `credential-badges-render-sa` runtime SA, two
gateway-key **secret shells** + `secretAccessor` bindings, and the Secret
Manager API enable (in `foundation`). `terraform fmt`+`validate` clean; plan =
**12 add / 0 destroy / 1 cosmetic** (static-host `client` metadata null-out).

### Apply order (run from `andamio-ops`; needs the gitignored real `envs/credentials.tfvars`)

```
# A. foundation — enables the Secret Manager API (must precede B)
cd terraform/credentials/foundation
terraform init -backend-config=backends/credentials.tfbackend
terraform apply -var-file=envs/credentials.tfvars            # + secretmanager.googleapis.com

# B. credential-badges — bucket, render SA, empty secret shells, IAM,
#    render service on the hello PLACEHOLDER image (no secret values yet)
cd ../credential-badges
terraform init -backend-config=backends/credentials.tfbackend
terraform apply -var-file=envs/credentials.tfvars            # 12 add / 1 cosmetic / 0 destroy

# C. add both gateway-key values (out-of-band; never in git/state)
printf %s '<MAINNET_KEY>' | gcloud secrets versions add andamio-api-mainnet-key --data-file=- --project andamio-credentials
printf %s '<PREPROD_KEY>' | gcloud secrets versions add andamio-api-preprod-key --data-file=- --project andamio-credentials

# D. (this repo) cut the first render image:  git tag vrender-0.1.0 && git push origin vrender-0.1.0
#    deploy-render.yml builds service/Dockerfile from root, pushes render:<tag>, deploys, verifies /healthz.

# E. real-image cutover — in envs/credentials.tfvars set
#      render_use_placeholder_image = false
#      render_image_tag             = "vrender-0.1.0"
#    then re-apply credential-badges (attaches secrets, real probe, real image).

# F. wire the static host: read the render_service_url output, set the static
#    host's RENDER_UPSTREAM to it, cut a v[0-9]*.*.* tag to redeploy. A
#    /badges/ miss now renders on demand. → #33 done.
```

## Deploy = push a version tag

**Static host:**

```
git tag v0.1.2
git push origin v0.1.2
```

**Render service:**

```
git tag vrender-0.1.0
git push origin vrender-0.1.0
```

`.github/workflows/deploy.yml` triggers **only** on `v[0-9]*.*.*` tags;
`.github/workflows/deploy-render.yml` triggers **only** on `vrender-*` tags. The static-host flow:

1. Runs the served-file allowlist check.
2. Authenticates to GCP via WIF (no keys). Token mint fails unless the ref is `refs/tags/v*` — enforced at the OIDC layer, not just in CI.
3. Builds the image, tags it with **both** the commit SHA and the semver tag. Never `:latest`.
4. Pushes both tags. Artifact Registry rejects any re-push of an existing tag (immutable) — bump the version instead.
5. `gcloud run deploy` the semver tag.
6. Verifies `Content-Type: application/ld+json` on the deployed `*.run.app` URL.

There is **no** `main`-push or `workflow_dispatch` deploy path by design.

The **render-service** flow (`deploy-render.yml`, on `vrender-*`) is the same
shape: allowlist check → WIF auth → build `service/Dockerfile` from repo root,
tag with SHA + the `vrender-*` tag → push both → `gcloud run deploy` **image-only**
(preserves the TF-managed runtime SA, secret-env wiring, and cache bucket) →
verify `/healthz` (200) **and** a live-rendered badge returns `image/svg+xml`
(the smoke target is derived from the first `generator/credentials.json` entry).

## Served-file allowlist (load-bearing)

The `Dockerfile` uses **explicit `COPY` of allowlisted paths only** (`context/`, `issuer/`, `badges/`, `.well-known/`, `README.md`) — never `COPY .`. `scripts/ci/check-allowlist.sh` fails CI if any repo file outside the allowlist would end up served. This prevents a future draft/notes file from leaking to a forever-public URL. To serve a new path, add an explicit `COPY` line to the `Dockerfile`, the `ALLOWED` array in the check script, **and** a `!`-re-include in `.dockerignore` (its `*` base excludes everything, including dot-dirs like `.well-known/`) — a deliberate, reviewed act, and CODEOWNERS-gated.

## Versioning & permanence

`vN.jsonld` files are immutable once published. Add a new version as a new file (`v1.jsonld`); never edit a published one. Immutable AR tags + the GCP project-deletion lien + an off-org mirror back the "resolves forever" commitment.

## First deploy / rollback notes

- Initial bootstrap (project, WIF, AR, Cloud Run, domain mapping) was done via Terraform; the first image was built and deployed manually as `v0.1.1` (equivalent to what this workflow does).
- Render service first deploy follows the **Apply order** above (A–F): TF stands the service up on the placeholder image, then `vrender-0.1.0` ships the real image, then TF flips `render_use_placeholder_image = false`.
- Rollback (either service): re-pin the previous tag in the Terraform vars and `terraform apply`, or `gcloud run deploy` the previous tag. Cloud Run rolls back in <60s. For the render service, dropping `RENDER_UPSTREAM` on the static host disables on-demand fallback entirely (a `/badges/` miss reverts to a plain 404) without touching the render service.
- `/` returns a tiny 200 landing page (keeps health probes trivial); the deliverable is `/context/v0.jsonld`.

## Versioning ops debt (non-blocking)

Intended `v0.1.0`/`v0.1.1` are permanently squatted by undeletable May-15 dev images under Artifact Registry tag-immutability; the static host shipped on `v0.1.2`+. Render tags start at `vrender-0.1.0` (separate image, no collision). Revisit the AR immutability toggle when next touching credential-badges infra.
