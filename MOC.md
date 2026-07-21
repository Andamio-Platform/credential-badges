# MOC — credential-badges

Map of content for the `credential-badges` stack. One line per component.
Start here when you open the repo for the first time.

## Served at `https://credentials.andamio.io`

| Path | File | Mutable? | Purpose |
|---|---|---|---|
| `/context/v0.jsonld` | `context/v0.jsonld` | no (versioned, `immutable` cache) | Pre-stable JSON-LD context for Andamio's OB 3.0 extension terms (`AttestationHost`, `OnChainCredentialAnchor`, `onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`). `AttestationHost` (Rung 4) is what the issuer `Profile` references; edits propagate in ≤24h despite the `immutable` header (harmless — nothing references it in a signed credential yet). |
| `/issuer` | `issuer/profile.jsonld` | yes (cached, not `immutable`) | Hosted OB 3.0 issuer `Profile`, typed `["Profile","AttestationHost"]` with `id` = `did:web:credentials.andamio.io` (Rung 4 — Profile, `did.json`, and future `issuer.id` name one subject; `url` stays the homepage). Strict verifiers dereference `issuer.url` here; nginx exact-match serves the extensionless path as `application/ld+json`. **Nothing signs against it yet.** `tools/issuer-profile.test.ts` pins the shape. |
| `/.well-known/did.json` | `.well-known/did.json` | yes (cached, not `immutable`; mutable on key rotation) | `did:web:credentials.andamio.io` DID document. Publishes the issuer signing key (`#key-2026-07`, pinned to KMS `vc-sign-ed25519` v1). Served exact-match as `application/did+ld+json`. **The key is only published here, nothing signs yet** (OB 3.0 signing is a later rung). Regenerate with `tools/gen-did-json.ts`; the key-pin invariant test guards drift. |
| `/status/key-epoch-2026-07.json` | `status/key-epoch-2026-07.json` | yes (`max-age=3600`; mutable on a kill-switch flip) | Signed key-epoch `BitstringStatusList` credential (Rung 8.3, plan Decision 3): `statusPurpose: "suspension"`, one bit per signing key version, bit 0 = `#key-2026-07`. Built by `spike/signer-spike/status-list.ts`, signed via `sign-status-list.ts`, sha-pinned in CI. Flipping a bit = the key-compromise kill-switch — see [`docs/runbooks/key-compromise.md`](docs/runbooks/key-compromise.md). |
| `/badges/*.svg` (+ `.png`) | `badges/` | yes (cached, not `immutable`) | Presentation-layer badge imagery referenced by `achievement.image`. Never identity-bearing — the on-chain anchor is the credential's identity. **Build output — see [Badge generator](#badge-generator); regenerate with `make badges`.** |
| `/` | nginx config | n/a | Tiny 200 landing page (keeps health probes trivial; pointer for humans). |

## Static-host infrastructure

| File | Role |
|---|---|
| `Dockerfile` | Nginx-alpine image. **Explicit `COPY` of allowlisted paths only** — never `COPY .`. Currently allows `context/`, `issuer/`, `badges/`, `.well-known/`, `README.md`. |
| `nginx/default.conf.template` | Per-extension MIME map (`application/ld+json` for `.jsonld`), exact-match for `/issuer`, cache headers, root landing page. `^~ /badges/` owns badge serving with `try_files $uri @render` — a miss proxies to `RENDER_UPSTREAM` (injected at container start). |
| `scripts/ci/check-allowlist.sh` | Fails CI if any repo file outside the allowlist would end up served. `IGNORED_PREFIXES` covers tooling/build/docs/spike/`service` paths that are explicitly **not** served. |
| `.github/workflows/ci.yml` | PR check — allowlist + docker build + smoke-test served Content-Types + nginx `@render` fallback e2e. |
| `.github/workflows/deploy.yml` | Tag-triggered deploy (`v[0-9]*.*.*`) via Workload Identity Federation. Builds, pushes SHA + semver tags (never `:latest`), deploys to Cloud Run, verifies Content-Types on the live `*.run.app` URL. |
| `DEPLOY.md` | Two-service topology, WIF ref-constraint (`refs/tags/v*`), deploy triggers, the `andamio-ops#170` infra delta + apply order, versioning + permanence, rollback. |
| `.dockerignore` | Pairs with the allowlist — keeps build context small. |

GCP project: `andamio-credentials` (dedicated, project-deletion lien). Cloud Run service: `credential-badges` (us-central1). Infra source of truth: Terraform in a private operations repository.

## Render service — on-demand badge generation (#33)

The second Cloud Run service (`credential-badges-render`). A `/badges/` miss on the static host falls back here, which renders the badge on demand (titles from the andamio-api gateway) and caches the SVG in GCS. See [`DEPLOY.md`](DEPLOY.md) for the topology and [README "How badges resolve"](README.md#how-badges-resolve).

| File | Role |
|---|---|
| `service/app.py` | Stdlib WSGI app (gunicorn). `/healthz` + `/badges/<name>.svg` → `serve_badge` (cache-first, gateway on cold miss, network-ordered, never caches non-200). |
| `service/cache.py` | `GCSCache` — `get`/`put`/`list_keys`/`delete` against the render cache bucket. |
| `service/Dockerfile` | **Root build context** — ships `generator/` (render-core + `fonts.css`) + `service/`. Runtime env: `BADGE_NETWORKS`, `BADGE_CACHE_BUCKET`, `ANDAMIO_*_API_KEY` (TF-wired secrets). |
| `service/requirements.txt` | gunicorn + google-cloud-storage. |
| `scripts/cache-admin.py` | `invalidate` (delete cache objects — non-destructive re-render) + `reconcile [--delete]` (flag/remove orphaned objects). Mirrors `serve_badge` network logic; fails loud on inconclusive gateway errors. |
| `.github/workflows/deploy-render.yml` | Tag-triggered deploy (`vrender-*`) via the same WIF + CICD SA. Builds `service/Dockerfile`, image-only `gcloud run deploy credential-badges-render` (preserves TF-managed SA/secrets/bucket), verifies `/healthz` + a live-rendered badge. |
| `docs/cache.md` | TTL story (max-age + GCS lifecycle), orphan-guard, cache-admin usage. |
| `docs/runbooks/gateway-key.md` | Gateway `X-API-Key` provisioning + rotation + compromise response (Secret Manager, network-scoped keys, dedicated service key). |

Infra (out of repo): GCS cache bucket, render runtime SA (`credential-badges-render-sa`, `secretAccessor` on the two gateway keys only), two gateway-key secrets — Terraform in `andamio-ops#170`.

## Badge generator

`badges/*.svg` are **build output**, regenerated from chain data — not hand-authored. **Start at [`generator/README.md`](generator/README.md)**; run `make help`.

| File | Role |
|---|---|
| `Makefile` | `make badges` (offline, deterministic) · `verify` · `fetch` (authed) · `fonts`. |
| `generator/README.md` | The pipeline (fetch → `credentials.json` → build → `badges/`). Start here to regenerate. |
| `generator/build.py` | Snapshot → SVGs (per-course palette, light interior). |
| `generator/gen.py` · `colors.py` | The d04 "Proof Rings" generator + the 10 palettes. |
| `generator/decode.py` | Ring-geometry verifier — proves a badge round-trips to its on-chain hashes (`make verify`). |
| `generator/fetch.py` | Refresh `credentials.json` from andamioscan (public) + the Andamio CLI (authed). |
| `generator/embed_fonts.py` · `fonts.css` | Subset + base64-embed the fonts so SVGs are self-contained. |
| `generator/credentials.json` | Data snapshot — one row per credential (course_id, slt_hash, titles). |

Not served (build tooling) — excluded from the Docker allowlist.

## Runbooks

| File | Role |
|---|---|
| `docs/runbooks/key-compromise.md` | **Signing-key compromise kill-switch** (Rung 8.6; production-signing precondition). Trigger criteria, status-bit-flip containment via `tools/flip-status-bit.ts` (prepares, never signs) + hardened re-sign, required cross-verifier read of the flipped live list, DID-method removal + additive key replacement, re-issuance, false-alarm stand-down. |
| `docs/runbooks/gateway-key.md` | Gateway `X-API-Key` provisioning + rotation + compromise response (Secret Manager, network-scoped keys, dedicated service key). |

## Planning

| File | Role |
|---|---|
| `ROADMAP.md` | **Living public checklist** of what's next, by phase. Tick boxes as items close. Start here if you want the "where are we right now" view. |
| `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md` | The Andamio OB 3.0 Issuer deployment plan — the "why" behind ROADMAP. Promotes the spike into a deployed signing service (`credential-badges-issuer`) sitting next to the static host behind an external HTTPS LB. 5 strategic decisions + 2 `/document-review` passes + 10 P1bis findings (resolved 2026-05-25). Prototype posture documented; production-hardening checklist tracks the upgrade path. **Status when this MOC was written:** P1bis-refined; Phase 0 pre-flight verifier spike closed (PR #12). |
| `docs/plans/2026-06-25-002-feat-dynamic-on-demand-badge-generation-plan.md` + `…-002-on-demand-generation-RESUME.md` | The #33 on-demand render plan (U1–U8) + resume note. The "why" behind the [Render service](#render-service--on-demand-badge-generation-33) section. |

## Original spike — OB 3.0 prototype

Reference artifact. Validates the end-to-end mapping + signing pipeline against a real preprod Cardano credential. **Not** baked into the served image.

| Path | Role |
|---|---|
| `spike/README.md` | Overview, stack choices, reference credential, reproducing locally. |
| `spike/mapping.md` | Field-by-field Andamio → OB 3.0 mapping. |
| `spike/validation-results.md` | Narrative + raw results from each validator. |
| `spike/open-questions.md` | 14 questions surfaced during the spike (Q3/Q4 resolved, others tracked in the plan). |
| `spike/CORNERS-CUT.md` | The 8 deliberate corners. The plan hardens 1, 2, 4, 5, 6, 7. |
| `spike/credential-imagery.md` | The v1 design decision for the `badges/` directory. |
| `spike/prerequisite-chaining.md` | PQ1–PQ6 prerequisite-chain defaults. |
| `spike/sample-credential.jsonld` | Canonical signed sample (deliverable). |
| `spike/samples/` | Per-recipient samples (real preprod data) — `james` and `njuguna`, plus HTML renders + policy metadata. |
| `spike/src/` | TS implementation: `mapper.ts`, `sign.ts` (VC-JWT), `sign-di.ts` (Data Integrity), `path-b.ts` (programmatic builder), `verify.ts`, `plutus.ts`, `keys.ts`, `credential.ts`, `validate.ts`, `inspect.ts`, `render.ts`, `build.ts`, `generate.ts`. |
| `spike/package.json` + `spike/tsconfig.json` | Build config. |

## Phase 0 pre-flight verifier spike

Pre-flight verifier spike — confirms the target verifier set actually handles the production feature combination (did:web + DI `eddsa-rdfc-2022` + `BitstringStatusListEntry` suspension + `OnChainCredentialAnchor` evidence) before Phase 0 locks the set.

| Path | Role |
|---|---|
| `spike/verifier-spike/README.md` | Test surface, throwaway did:web host, layout, run instructions. |
| `spike/verifier-spike/src/` | Generate keys + did.json + status list + credential, sign, self-loopback verify. |
| `spike/verifier-spike/publish/` | Files pushed to the throwaway GitHub Pages host (`workshop-maybe/credential-badges-verifier-spike`). |
| `spike/verifier-spike/results/SUMMARY.md` | Phase 0 viability decision. 1EdTech green; spruce + walt-id blocked on local toolchain install. **Verifier set preliminarily viable; no replacement needed.** |
| `spike/verifier-spike/results/onedtech.md` | Per-verifier capture for 1EdTech. |

## Conventions

- **Allowlist or it doesn't ship.** To serve a new path, add an explicit `COPY` line in `Dockerfile`, the matching entry in `scripts/ci/check-allowlist.sh`, **and** a `!`-re-include in `.dockerignore` (its `*` base excludes everything, including dot-dirs like `.well-known/`). All must change together; CI enforces the allowlist, and trust-critical served paths are CODEOWNERS-gated.
- **Versioned `vN.jsonld` files are immutable once published.** Fix typos by shipping a new version. Artifact Registry has `immutable_tags = true`; re-pushing an existing image tag is rejected.
- **No `:latest`, no branch deploy, no `workflow_dispatch` deploy.** Only `git tag vX.Y.Z && git push origin vX.Y.Z` deploys, and the WIF binding is ref-constrained to `refs/tags/v*` at the OIDC layer.
- **Spike is committed source of truth, not served.** `docs/`, `spike/`, and tooling are in `IGNORED_PREFIXES` — they live in the repo for transparency and history but never ship in the Docker image.
