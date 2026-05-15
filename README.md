# credential-badges

Static assets served at `https://credentials.andamio.io`. Hosts the JSON-LD context and supporting documents for Andamio Open Badges 3.0 credentials.

## What's here

| Path | Served at | Purpose |
|---|---|---|
| `context/v0.jsonld` | `credentials.andamio.io/context/v0.jsonld` | **Pre-stable** JSON-LD context for Andamio's OB 3.0 extension terms (`onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`). Used by spike credentials while the schema iterates toward v1. |
| `issuer/profile.jsonld` | `credentials.andamio.io/issuer` | Hosted OB 3.0 issuer `Profile`. Credentials carry `issuer.url` = this URL; strict verifiers (e.g. 1EdTech) dereference it and expect `application/ld+json`. Served at the extensionless path `/issuer` via an nginx exact-match. **Mutable** (unlike versioned contexts) — cached but not `immutable`. |
| `badges/*.svg` (+ `.png`) | `credentials.andamio.io/badges/...` | Presentation-layer badge imagery referenced by `achievement.image` in OB 3.0 credentials. **Never identity-bearing** — the on-chain anchor is the credential's identity; the image is a mutable pointer. SVG-primary (git-diffable, no history bloat). **Mutable** — cached but not `immutable`. `_placeholder.svg` is a demo asset. |

## Badge imagery

The `badges/` directory holds the visual artifacts referenced by
`achievement.image` in OB 3.0 credentials:

```
credentials.andamio.io/context/v0.jsonld          ← schema (immutable, versioned)
credentials.andamio.io/badges/{...}.svg           ← imagery (mutable)
```

The `image` field is standard OB 3.0 (no `andamio:` extension). Hosting lives
here so badges sit next to the schema they belong to. **v1 design decision**
(full rationale in the `credential-imagery` design doc in the OB 3.0 spike;
work tracked as repo issues):

- **Presentation-layer only.** The image is *never* identity-bearing. A
  credential's identity is its on-chain anchor; the image is a pointer the
  credential carries. An issuer may refresh badge art at any time without
  invalidating any issued credential — hence the non-`immutable` cache.
- **Keys off `badge_id`** (a badge = any subset of 1+ modules), not the
  course or the SLT.
- **SVG-primary**, optional small PNG fallback (~512×512). SVG is text:
  git-diffable, no history bloat, scales crisply.

Still to settle (tracked as issues, decision-coupled to the issuer-identity
work): final naming convention (policyId vs human slug vs per-version), and
whether per-org badges live in this repo or per-issuer repos long-term.

## Versioning

- **`v0`** is the **pre-stable** schema. Expect breaking changes. Demo credentials issued against v0 (e.g. the OB 3.0 spike's james and njuguna samples) are explicitly snapshots of in-flight work, not durable references.
- **`v1`** is the first stable schema. Once published, `v1.jsonld` never changes — any further change ships as `v2.jsonld`. Credentials reference a specific version in their `@context` array, so locking a version locks the schema the credential was signed against.
- Both `v0` and `v1` (and any subsequent versions) are hosted indefinitely once published — credentials in the wild reference their version forever, so the URL must keep resolving.

## How it gets deployed

Hosted on Google Cloud Run (`andamio-credentials` GCP project) with a custom domain mapping to `credentials.andamio.io`. Infra is managed with Terraform in a private operations repository. Deployment is **tag-triggered** via GitHub Actions + Workload Identity Federation — pushing a `vX.Y.Z` tag builds the image and deploys it. There is intentionally **no branch/`main` deploy**: the WIF binding is ref-constrained to `refs/tags/v*` at the OIDC assertion level, so only tag pushes can mint a deploy token.

For the full deploy mechanism, allowlist rule, and tag policy, see [`DEPLOY.md`](DEPLOY.md).

## How to update

1. Open a PR. Context files are immutable — only fix typos or add a **new** version file; never edit a published version in place. CI enforces the served-file allowlist.
2. Merge to `main`.
3. Push a version tag: `git tag v0.1.2 && git push origin v0.1.2`. GitHub Actions builds, pushes (SHA + semver tags, never `:latest`), and deploys. Artifact Registry has immutable tags — re-pushing an existing tag is rejected, so always bump.
4. Verify `https://credentials.andamio.io/context/v0.jsonld` resolves with `Content-Type: application/ld+json` and is byte-identical to the repo copy.

## Background

These extension terms came out of the Andamio Open Badges 3.0 spike (April–May 2026). The full mapping and design rationale lives in the spike directory in the `andamio` orchestration vault.
