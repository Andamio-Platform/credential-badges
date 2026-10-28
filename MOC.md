# MOC — credential-badges

Map of content for the `credential-badges` stack. One line per component.
Start here when you open the repo for the first time.

**Looking for the URLs rather than the components?** [`docs/sitemap.md`](docs/sitemap.md)
lists every public route the domain serves — what produces it, whether it may
change, and which surfaces the canon design has reached. This file maps the
repo; that one maps the website.

## Served at `https://credentials.andamio.io`

| Path | File | Mutable? | Purpose |
|---|---|---|---|
| `/context/v1.jsonld` | `context/v1.jsonld` | no (versioned, `immutable` cache, sha256-pinned in `tools/context-freeze.test.ts`) | The CURRENT signing context — JSON-LD context for Andamio's OB 3.0 extension terms (`AttestationHost`, `OnChainCredentialAnchor`, `onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`, `courseOwner`, flat evidence terms). Referenced by every signed credential; byte-frozen forever. New terms ship as `/context/v2.jsonld`, never as an edit. |
| `/context/v0.jsonld` | `context/v0.jsonld` | no (frozen forever, `immutable` cache, sha256-pinned in `tools/context-freeze.test.ts`) | Retired signing context. Mutated in place on 2026-07-21 (the incident behind `docs/solutions/conventions/never-mutate-published-jsonld-context.md`); superseded by the byte-identical v1 at a fresh URL so caching verifiers converge. Keeps serving 200 forever, but nothing signs against it. |
| `/issuer` | `issuer/profile.jsonld` | yes (cached, not `immutable`) | Hosted OB 3.0 issuer `Profile`, typed `["Profile","AttestationHost"]` with `id` = `did:web:credentials.andamio.io` (Rung 4 — Profile, `did.json`, and future `issuer.id` name one subject; `url` stays the homepage). Strict verifiers dereference `issuer.url` here; nginx exact-match serves the extensionless path as `application/ld+json`. **This subject signs:** all 58 committed `OpenBadgeCredential` class artifacts and the key-epoch status list name `did:web:credentials.andamio.io` as their `issuer.id`. `tools/issuer-profile.test.ts` pins the shape. |
| `/.well-known/did.json` | `.well-known/did.json` | yes (cached, not `immutable`; mutable on key rotation) | `did:web:credentials.andamio.io` DID document. Publishes the issuer signing key (`#key-2026-07`, held in Cloud KMS). Served exact-match as `application/did+ld+json`. **`#key-2026-07` is the active signing key** — every committed OB 3.0 credential resolves its `proof.verificationMethod` to it, and the key-epoch status list can suspend everything signed under it. Regenerate with `tools/gen-did-json.ts`; the key-pin invariant test guards drift. |
| `/status/key-epoch-2026-07.json` | `status/key-epoch-2026-07.json` | yes (`max-age=3600`; mutable on a kill-switch flip) | Signed key-epoch `BitstringStatusList` credential (Rung 8.3): `statusPurpose: "suspension"`, one bit per signing key version, bit 0 = `#key-2026-07`. Built by `signing/status-list.ts`, signed via `sign-status-list.ts`, sha-pinned in CI. Flipping a bit = the key-compromise kill-switch — see the key-compromise runbook in the private `andamio-ops` repo. |
| `/badges/*.svg` (+ `.png`) | `badges/` | yes (cached, not `immutable`) | Presentation-layer badge imagery, shared and embedded by URL (no signed credential carries `achievement.image`). Never identity-bearing — the on-chain anchor is the credential's identity. **Build output — see [Badge generator](#badge-generator). `make badges` strips baked signatures; refresh signed badges with the single-badge procedure in the badge-art runbook (private `andamio-ops` repo).** |
| `/` | nginx config | n/a | Tiny 200 landing page (keeps health probes trivial; pointer for humans). |

## Static-host infrastructure

| File | Role |
|---|---|
| `Dockerfile` | Nginx-alpine image. **Explicit `COPY` of allowlisted paths only** — never `COPY .`. Currently allows `context/`, `issuer/`, `badges/`, `.well-known/`, `README.md`. |
| `nginx/default.conf.template` | Per-extension MIME map (`application/ld+json` for `.jsonld`), exact-match for `/issuer`, cache headers, root landing page. `^~ /badges/` owns badge serving with `try_files $uri @render` — a miss proxies to `RENDER_UPSTREAM` (injected at container start). |
| `scripts/ci/check-allowlist.sh` | Fails CI if any repo file outside the allowlist would end up served. `IGNORED_PREFIXES` covers tooling/build/docs/signing/archive/`service` paths that are explicitly **not** served. |
| `.github/workflows/ci.yml` | PR check — allowlist + docker build + smoke-test served Content-Types + nginx `@render` fallback e2e. |
| `.github/workflows/deploy.yml` | Tag-triggered deploy (`v[0-9]*.*.*`) via Workload Identity Federation. Builds, pushes SHA + semver tags (never `:latest`), deploys to Cloud Run, verifies Content-Types on the live host. |
| `DEPLOY.md` | Pointer to the deploy workflows. |
| `.dockerignore` | Pairs with the allowlist — keeps build context small. |

The static host, the render service and the issuer service each run on Cloud Run.

## Render service — on-demand badge generation (#33)

The second Cloud Run service. A `/badges/` miss on the static host falls back here, which renders the badge on demand (titles from the andamio-api gateway) and caches the SVG in GCS. See [README "How badges resolve"](README.md#how-badges-resolve).

| File | Role |
|---|---|
| `service/app.py` | Stdlib WSGI app (gunicorn). `/healthz` + `/badges/<name>.svg` → `serve_badge` (cache-first, gateway on cold miss, network-ordered, never caches non-200). |
| `service/cache.py` | `GCSCache` — `get`/`put`/`list_keys`/`delete` against the render cache bucket. |
| `service/Dockerfile` | **Root build context** — ships `generator/` (render-core + `fonts.css`) + `service/`. Runtime env: `BADGE_NETWORKS`, `BADGE_CACHE_BUCKET`, `ANDAMIO_*_API_KEY`. |
| `service/requirements.txt` | gunicorn + google-cloud-storage. |
| `scripts/cache-admin.py` | `invalidate` (delete cache objects — non-destructive re-render) + `reconcile [--delete]` (flag/remove orphaned objects). Mirrors `serve_badge` network logic; fails loud on inconclusive gateway errors. |
| `.github/workflows/deploy-render.yml` | Tag-triggered deploy (`vrender-*`). Builds `service/Dockerfile`, image-only `gcloud run deploy` (preserves the service's runtime config), verifies `/healthz` + a live-rendered badge. |
| `docs/cache.md` | TTL story (max-age + GCS lifecycle), orphan-guard, cache-admin usage. |

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
| `generator/credentials.json` | Data snapshot — one row per credential (course_id, slt_hash, titles). **The badge registry's source of truth** — see [`docs/badge-registry.md`](docs/badge-registry.md). |

Not served (build tooling) — excluded from the Docker allowlist.

## Verification

Local verification (hermetic, in CI) and live verification (network, run by a human after a deploy) are different jobs. Both are needed — a badge can be byte-perfect in the repo and still fail against what production serves.

| File | Role |
|---|---|
| `tools/*.test.ts` | **Local invariants, in CI, no install.** Context sha256 freeze, the KMS key pin, the baked-credential byte match. Hermetic — no network. See [`tools/README.md`](tools/README.md). |
| `scripts/verify-live/verify-live.mjs` | **Post-deploy gate, live network.** Fetches a deployed badge, extracts the embedded OB3 credential, verifies its `eddsa-rdfc-2022` proof against the **live** context + `did:web` document + status list (every fetch `no-store`). Catches deploy drift nothing else sees: wrong context tag, drifted `did.json`, an unintended status-bit flip. Not in CI (needs a real deploy); not in `tools/` (that path is dependency-free by design). |
| `docs/verifier-guidance.md` | What third-party verifiers should expect from an Andamio credential. |
| `docs/third-party-display-research.md` | **Research only, nothing decided.** Where an Andamio credential can be displayed off-platform — LinkedIn `certUrl`, Open Badges 3.0, Credly, Europass — and the recipient-identifier problem that gates all of them. Separates verified-here claims from platform-documentation claims, which are hypotheses until spiked. |

## Runbooks

Operational runbooks live in the private `andamio-ops` repo, `runbooks/credential-badges/`.

## Planning

| File | Role |
|---|---|
| `ROADMAP.md` | **Living public checklist** of what's next, by phase. Tick boxes as items close. Start here if you want the "where are we right now" view. |
| `docs/badge-registry.md` | **Normative.** The `badge_id` = `<course_id>.<slt_hash>` convention, where the three registry artifacts live, and 11 invariants — chiefly *the name is frozen, the picture is not* (I3/I4) and *registry membership gates signing, not rendering* (I8). Closes #11. |
| `docs/mapping.md` | Field-by-field Andamio → OB 3.0 mapping, the URN convention, and `slt_hash` semantics. Cited by `docs/badge-registry.md` as current authority. Written during the OB 3.0 prototype; moved out of `archive/` by #117. |
| `docs/credential-imagery.md` | The v1 design decision for the `badges/` directory: imagery is presentation, never identity. Moved out of `archive/` by #117. |

## Signing package — `signing/`

**Production.** The operator-run signing CLI: maps a registered badge to OB 3.0, signs it through KMS behind a live on-chain anchor gate, builds and signs the key-epoch status list, and bakes signed credentials into `badges/*.svg`. Holds the 58 signed class artifacts, the flagship holder credential, and the KMS run transcripts. Two CI jobs run out of it. **Not** baked into the served image.

Distinct from `issuer-service/`, which signs on demand per holder as a long-running service. `signing/` is the batch CLI an operator runs; `issuer-service/` is the server.

| Path | Role |
|---|---|
| `signing/README.md` | Why the package lives at top level, what each entry point does, and its provenance. |
| `signing/sign.ts`, `sign-class.ts`, `sign-status-list.ts` | The KMS signing entry points (holder credential, class artifacts, status list). |
| `signing/status-list.ts` | Key-version registry + `BitstringStatusList` builder. The kill-switch surface — CODEOWNERS-gated. |
| `signing/class-artifacts/` | The 58 signed Class Achievement credentials, 1:1 with `badges/_registry.json`. |
| `signing/transcripts/` | Verbatim KMS run captures. Every signing run must be transcribed; never rewritten. |
| `signing/validation/` | External 1EdTech validator captures. |
| `signing/expansion-pin.dep-test.ts` | Canonicalizes the committed signed artifacts and pins the RDF dataset hash. |
| `signing/repo-root.test.ts` | Guards the repo-root arithmetic the package depends on after the move out of `spike/`. |

## Archive — OB 3.0 prototype

**History, superseded.** Validated the end-to-end mapping + signing pipeline against a real preprod Cardano credential. Nothing here runs; no CI job executes out of it. **Not** baked into the served image. Its two still-current design notes moved to `docs/mapping.md` and `docs/credential-imagery.md` (#117).

| Path | Role |
|---|---|
| `archive/README.md` | Overview, stack choices, reference credential, reproducing locally. |
| `archive/validation-results.md` | Narrative + raw results from each validator. |
| `archive/open-questions.md` | 14 questions surfaced during the spike (Q3/Q4 resolved). |
| `archive/CORNERS-CUT.md` | The 8 deliberate corners the prototype cut. |
| `archive/prerequisite-chaining.md` | PQ1–PQ6 prerequisite-chain defaults. |
| `archive/sample-credential.jsonld` | Canonical signed sample (deliverable). |
| `archive/samples/` | Per-recipient samples (real preprod data), plus HTML renders + policy metadata. |
| `archive/src/` | TS implementation: `mapper.ts`, `sign.ts` (VC-JWT), `sign-di.ts` (Data Integrity), `path-b.ts` (programmatic builder), `verify.ts`, `plutus.ts`, `keys.ts`, `credential.ts`, `validate.ts`, `inspect.ts`, `render.ts`, `build.ts`, `generate.ts`. |
| `archive/package.json` + `archive/tsconfig.json` | Build config. |

## Phase 0 pre-flight verifier spike

Pre-flight verifier spike — confirms the target verifier set actually handles the production feature combination (did:web + DI `eddsa-rdfc-2022` + `BitstringStatusListEntry` suspension + `OnChainCredentialAnchor` evidence) before Phase 0 locks the set.

| Path | Role |
|---|---|
| `archive/verifier-spike/README.md` | Test surface, throwaway did:web host, layout, run instructions. |
| `archive/verifier-spike/src/` | Generate keys + did.json + status list + credential, sign, self-loopback verify. |
| `archive/verifier-spike/publish/` | Files pushed to the throwaway GitHub Pages host (`workshop-maybe/credential-badges-verifier-spike`). |
| `archive/verifier-spike/results/SUMMARY.md` | Phase 0 viability decision. 1EdTech green; spruce + walt-id blocked on local toolchain install. **Verifier set preliminarily viable; no replacement needed.** |
| `archive/verifier-spike/results/onedtech.md` | Per-verifier capture for 1EdTech. |

## Conventions

- **Allowlist or it doesn't ship.** To serve a new path, add an explicit `COPY` line in `Dockerfile`, the matching entry in `scripts/ci/check-allowlist.sh`, **and** a `!`-re-include in `.dockerignore` (its `*` base excludes everything, including dot-dirs like `.well-known/`). All must change together; CI enforces the allowlist, and trust-critical served paths are CODEOWNERS-gated.
- **Versioned `vN.jsonld` files are immutable once published.** Fix typos by shipping a new version. Image tags are immutable; re-pushing an existing image tag is rejected.
- **No `:latest`, no branch deploy, no `workflow_dispatch` deploy.** Only `git tag vX.Y.Z && git push origin vX.Y.Z` deploys.
- **Signing code and history are committed but not served.** `docs/`, `signing/`, `archive/`, and tooling are in `IGNORED_PREFIXES` — they live in the repo for transparency and history but never ship in the Docker image. `signing/` is production; `archive/` is history.
