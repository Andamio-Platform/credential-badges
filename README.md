# credential-badges

Static assets served at `https://credentials.andamio.io`. Hosts the JSON-LD context and supporting documents for Andamio Open Badges 3.0 credentials.

## What's here

| Path | Served at | Purpose |
|---|---|---|
| `context/v0.jsonld` | `credentials.andamio.io/context/v0.jsonld` | **Pre-stable** JSON-LD context for Andamio's OB 3.0 extension terms (`onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`). Used by spike credentials while the schema iterates toward v1. |

## Planned: badge imagery

A `badges/` directory will live alongside `context/`, holding the visual artifacts referenced by `achievement.image` in OB 3.0 credentials:

```
credentials.andamio.io/context/v0.jsonld       ← schema
credentials.andamio.io/badges/{...}.png        ← imagery
```

The `image` field is part of standard OB 3.0 (no `andamio:` extension needed), but the *hosting* lives here so badges sit next to the schema they belong to. Open questions still to settle before content lands:

- Naming convention (by policyId? by human-readable slug? per-achievement-version?)
- Format and sizing (likely SVG primary + PNG fallback at ~512×512)
- Whether issuer-org-owned badges live here or in per-issuer repos long-term

These get answered as part of the badge-design workstream — separate from this repo's infrastructure setup.

## Versioning

- **`v0`** is the **pre-stable** schema. Expect breaking changes. Demo credentials issued against v0 (e.g. the OB 3.0 spike's james and njuguna samples) are explicitly snapshots of in-flight work, not durable references.
- **`v1`** is the first stable schema. Once published, `v1.jsonld` never changes — any further change ships as `v2.jsonld`. Credentials reference a specific version in their `@context` array, so locking a version locks the schema the credential was signed against.
- Both `v0` and `v1` (and any subsequent versions) are hosted indefinitely once published — credentials in the wild reference their version forever, so the URL must keep resolving.

## How it gets deployed

Hosted on Google Cloud Run with a custom domain mapping to `credentials.andamio.io`. DNS is managed in [`andamio-ops`](https://github.com/Andamio-Platform/andamio-ops). Deployment is a `gcloud run deploy` from this repo's `main` branch.

For the deploy command and Cloud Run service config, see [`DEPLOY.md`](DEPLOY.md) (TODO once service is created).

## How to update

1. Open a PR. Context files are immutable — only fix typos or add a new version file; never edit a published version in place.
2. Merge to `main`.
3. Run `gcloud run deploy` (or trigger via Cloud Build, once wired).
4. Verify the URL resolves with `Content-Type: application/ld+json` and the file is byte-identical to the repo copy.

## Background

These extension terms came out of the Andamio Open Badges 3.0 spike (April–May 2026). The full mapping and design rationale lives in the spike directory in the `andamio` orchestration vault.
