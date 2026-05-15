# DEPLOY

How `credential-badges` gets to `https://credentials.andamio.io/`.

## Topology

| Piece | Value |
|---|---|
| GCP project | `andamio-credentials` (dedicated, permanent — has a project-deletion lien) |
| Cloud Run service | `credential-badges`, region `us-central1`, port 8080, `allUsers` invoker |
| Image | `us-central1-docker.pkg.dev/andamio-credentials/credential-badges/app:<tag>` |
| Artifact Registry | `immutable_tags = true`, no cleanup policy — published tags are retrievable forever |
| Auth | Workload Identity Federation, **ref-constrained to `refs/tags/v*`** |
| Domain | `google_cloud_run_domain_mapping`, Google-managed cert, `force_override = false` |
| Infra source of truth | Terraform, in a private operations repository |

## Deploy = push a version tag

```
git tag v0.1.2
git push origin v0.1.2
```

`.github/workflows/deploy.yml` triggers **only** on `v*.*.*` tags:

1. Runs the served-file allowlist check.
2. Authenticates to GCP via WIF (no keys). Token mint fails unless the ref is `refs/tags/v*` — enforced at the OIDC layer, not just in CI.
3. Builds the image, tags it with **both** the commit SHA and the semver tag. Never `:latest`.
4. Pushes both tags. Artifact Registry rejects any re-push of an existing tag (immutable) — bump the version instead.
5. `gcloud run deploy` the semver tag.
6. Verifies `Content-Type: application/ld+json` on the deployed `*.run.app` URL.

There is **no** `main`-push or `workflow_dispatch` deploy path by design.

## Served-file allowlist (load-bearing)

The `Dockerfile` uses **explicit `COPY` of allowlisted paths only** (`context/`, `README.md`) — never `COPY .`. `scripts/ci/check-allowlist.sh` fails CI if any repo file outside the allowlist would end up served. This prevents a future draft/notes file from leaking to a forever-public URL. To serve a new path, add an explicit `COPY` line to the `Dockerfile` **and** the `ALLOWED` array in the check script — a deliberate, reviewed act.

## Versioning & permanence

`vN.jsonld` files are immutable once published. Add a new version as a new file (`v1.jsonld`); never edit a published one. Immutable AR tags + the GCP project-deletion lien + an off-org mirror back the "resolves forever" commitment.

## First deploy / rollback notes

- Initial bootstrap (project, WIF, AR, Cloud Run, domain mapping) was done via Terraform; the first image was built and deployed manually as `v0.1.1` (equivalent to what this workflow does).
- Rollback: re-pin the previous tag in the Terraform vars and `terraform apply`, or `gcloud run deploy` the previous tag. Cloud Run rolls back in <60s.
- `/` returns a tiny 200 landing page (keeps health probes trivial); the deliverable is `/context/v0.jsonld`.
