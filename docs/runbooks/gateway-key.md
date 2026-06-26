# Runbook — andamio-api gateway keys (render service)

The on-demand render service (`credential-badges-render`, #33) reads course and
module **titles** from the andamio-api gateway using a non-interactive
`X-API-Key`. This runbook covers provisioning and rotating those keys.

## What the service needs

| Fact | Value |
|---|---|
| GCP project | `andamio-credentials` |
| Secrets (Secret Manager) | `andamio-api-mainnet-key`, `andamio-api-preprod-key` |
| Mapped to env | `ANDAMIO_MAINNET_API_KEY`, `ANDAMIO_PREPROD_API_KEY` (version `latest`) |
| Reader | `credential-badges-render-sa` — `roles/secretmanager.secretAccessor` on **these two secrets only** |
| Infra source of truth | Terraform, `andamio-ops` (`terraform/credentials/`) |

**Keys are network-scoped.** A mainnet key `401`s against the preprod gateway and
vice-versa — that's why there are two. The render service tries `BADGE_NETWORKS`
in order (default `mainnet,preprod`) and uses the matching key per network. The
deployed credential set resolves on **mainnet**, so the mainnet key is the one
that gates the live ship; the preprod key powers the full-suite demo.

**Use a dedicated service key, never a personal CLI key.** The value in a
developer's local `.env.local` is fine for local testing, but production must
read a dedicated `andamio-api` service key from Secret Manager.

## Provisioning (first time)

The Terraform in `andamio-ops` creates the **secret shells** (empty containers),
the runtime SA, and the `secretAccessor` bindings — but **not the secret
values** (values never live in git or TF state). After the TF apply stands up
the shells, add a version to each out-of-band:

```bash
printf %s '<MAINNET_KEY>' | gcloud secrets versions add andamio-api-mainnet-key \
  --data-file=- --project andamio-credentials
printf %s '<PREPROD_KEY>' | gcloud secrets versions add andamio-api-preprod-key \
  --data-file=- --project andamio-credentials
```

Notes:
- `printf %s` (not `echo`) — no trailing newline in the key value.
- `--data-file=-` reads from stdin so the key never lands in shell history as an argument.
- The env mapping is pinned to version `latest`, so a new version is picked up
  the next time a Cloud Run instance starts (see Rotation).

Verify (without printing the secret):

```bash
gcloud secrets versions list andamio-api-mainnet-key --project andamio-credentials
gcloud secrets versions list andamio-api-preprod-key --project andamio-credentials
```

## Rotation

1. Add the new key as a **new version** (same command as provisioning). Do not
   disable the old version yet.
2. Roll the render service so running instances pick up `latest`:
   ```bash
   gcloud run services update credential-badges-render \
     --region us-central1 --project andamio-credentials --no-traffic --tag rotate \
     >/dev/null  # or simply redeploy the current image, which restarts instances
   ```
   The simplest reliable roll is to redeploy the current image tag (a no-op
   image change still restarts instances, which re-resolve `latest`).
3. Smoke-test a live render (a `/badges/<course_id>.<slt_hash>.svg` returns
   `image/svg+xml`) — the same check the deploy workflow runs.
4. Once confirmed, **disable** (don't destroy) the previous version so it can be
   re-enabled if the new key proves bad:
   ```bash
   gcloud secrets versions disable <OLD_VERSION> \
     --secret andamio-api-mainnet-key --project andamio-credentials
   ```

## Compromise response

1. Issue a fresh key from the andamio-api side and **revoke the leaked one there**
   (Secret Manager only stores the value; the gateway is what honors it).
2. Add the fresh key as a new version and roll the service (Rotation steps 1–3).
3. `destroy` the compromised version once the new one is confirmed live.

## Related

- Deploy + apply order: [`../../DEPLOY.md`](../../DEPLOY.md)
- Cache operations: [`../cache.md`](../cache.md)
- Plan + resume: [`../plans/2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md`](../plans/2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md)
