# DEPLOY

Deploys run from the GitHub Actions workflows in [`.github/workflows/`](.github/workflows/):
`deploy.yml` (static host), `deploy-render.yml` (render service) and
`deploy-issuer.yml` (issuer service), each triggered by its own release-tag pattern.

Production is operated by the maintainers.
