# Contributing to credential-badges

This repo hosts Andamio's Open Badges 3.0 credential assets — the JSON-LD context, the issuer profile, and the badge imagery served at [`credentials.andamio.io`](https://credentials.andamio.io). Badges are **free and open source**: a credential badge is the visible, shareable face of an on-chain Andamio credential, and the source being open is part of the invitation. Thanks for taking a look.

New here? Read [`README.md`](README.md) for what this is, [`MOC.md`](MOC.md) for a one-screen map of every component, and [`ROADMAP.md`](ROADMAP.md) for where it's going. Then skim the **Good first issues** below.

## The one thing to know first

**Badges are build output, not hand-authored files.** *"If it can be generated, it must be generated."* Each badge SVG is rendered deterministically from on-chain credential data by the generator in [`generator/`](generator/README.md) — the ring geometry round-trips back to the on-chain hashes, so the art *is* the proof. Never hand-edit a file in `badges/`; change the generator (or the source data) and regenerate.

## Getting set up

Most contributions need only **Python 3** — the generator is offline and deterministic.

```bash
git clone https://github.com/Andamio-Platform/credential-badges.git
cd credential-badges
make help          # list the available targets
make badges        # render every badge from credentials.json (offline)
make verify        # decode a built badge's rings, check they equal its on-chain hashes
```

| Command | What it does | Needs |
|---|---|---|
| `make badges` | Render every badge from `credentials.json`. Deterministic + offline. | Python 3 |
| `make verify` | Decode a built badge's rings and confirm they match its on-chain hashes. | Python 3 |
| `make fetch`  | Refresh `credentials.json` from chain (andamioscan + Andamio CLI). | network, authed `andamio` CLI |
| `make fonts`  | Rebuild `fonts.css` (subset + base64-embed the badge fonts). | network, `fonttools` + `brotli` |

See [`generator/README.md`](generator/README.md) for the full pipeline.

## How changes ship

The deploy is **tag-triggered**, and there is intentionally **no `main`/branch deploy** — pushing a `vX.Y.Z` tag is the only thing that builds and ships the image (the Workload Identity binding is ref-constrained to `refs/tags/v*`). So merging to `main` is safe and never deploys on its own.

1. **Branch** off `main`. Name it `feature/…`, `fix/…`, `docs/…`, or `refactor/…`.
2. **Open a PR.** CI runs the served-file allowlist check and the nginx fallback test. Keep PRs focused.
3. **Merge to `main`** once reviewed.
4. **Deploy** is a separate, deliberate step (maintainers): bump and push a version tag — `git tag v1.0.3 && git push origin v1.0.3`. Artifact Registry tags are immutable, so always bump; never re-push an existing tag.

Full deploy mechanism, the allowlist rule, and tag policy live in [`DEPLOY.md`](DEPLOY.md).

### The served-file allowlist

Only an allowlisted set of files is baked into the served image (`Dockerfile` + `scripts/ci/check-allowlist.sh` enforce it). Repo material that is *not* served — `README.md`, `ROADMAP.md`, `MOC.md`, `docs/`, `spike/`, this file — lives in the repo without being deployed. If you add a new file that *should* be served, update the allowlist in the same PR; CI will fail otherwise.

### Hosted files are versioned, never edited in place

Context files (`context/*.jsonld`) are immutable once published — credentials in the wild reference a specific version forever, and verifier document caches never expire. Never change a published version, not even for a typo; ship a **new** version file and add its sha256 pin to `tools/context-freeze.test.ts` in the same PR (the freeze test and the deploy workflow enforce this). The issuer profile (`issuer/profile.jsonld`) is the documented exception (mutable, cached but not `immutable`).

## Commit messages

Conventional commits: `type(scope): description`. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

```
feat(generator): add per-org palette lookup
fix(nginx): add resolver so @render survives an upstream IP change
docs(readme): clarify the two version axes
```

## Good first issues

Issues labeled [`good first issue`](https://github.com/Andamio-Platform/credential-badges/labels/good%20first%20issue) and [`documentation`](https://github.com/Andamio-Platform/credential-badges/labels/documentation) are the best place to start. [`help wanted`](https://github.com/Andamio-Platform/credential-badges/labels/help%20wanted) marks work that's ready for an outside hand. When in doubt, open an issue describing what you'd like to do before writing code — for anything touching the schema, the served set, or the deploy path, a short design note saves a round trip.

## Code of conduct

By participating you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE), the same license that covers this project.
