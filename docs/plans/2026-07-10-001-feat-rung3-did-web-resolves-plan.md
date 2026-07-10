---
title: "Rung 3 — did:web:credentials.andamio.io resolves"
type: feat
status: completed
date: 2026-07-10
origin: "orch: docs/plans/2026-07-10-credential-badges-rung3-did-web-resolves.md (handoff spec, home = andamio orch; not in this repo)"
tags:
  - plan
  - credential-badges
  - ob3
  - did-web
  - signing-slice-ladder
---

# Rung 3 — `did:web:credentials.andamio.io` resolves

## Summary

Make `did:web:credentials.andamio.io` resolve by committing a **static, single-key
`.well-known/did.json`** (pinned to KMS `vc-sign-ed25519` **version 1**) and serving
it through the existing nginx static host. Ship a deterministic TypeScript
**regenerator** and a **key-pin invariant test** so a wrong or rotated committed key
is a red test, not a silent verification break. The proof is a **real resolver
(spruce)** yielding the pinned `#key-2026-07` verification method — not just a `curl`.

This is one rung of the OB3 signing slice-ladder. It publishes the issuer's key so
OB3 verification has a resolvable issuer identity; **nothing signs a VC here**
(Rungs 6–7), and no status list, AttestationHost profile, or issuer service is in
scope (Rungs 4/8).

---

## Problem Frame

`curl https://credentials.andamio.io/.well-known/did.json` returns **404** today — no
file, no nginx location, not in the served allowlist. OB3 verification requires the
issuer's `did:web` to resolve to a DID document that publishes the signing key. Rung 1
already proved the OB3 sample verifies against two independent verifiers (spruce,
1EdTech) **using the throwaway GitHub-Pages spike host**; Rung 3 stands up the
**production** issuer identity those verifiers will resolve.

**Strategic frame (settled this session):** building on the open W3C VC / DID / OB3
stack buys two things at once — OB3-verifiable credentials now, and a friction-light
future swap to a stronger KERI trust root (`did:webs`, à la Veridian) later. `did:web`
and `did:webs` share the same web-serving substrate, the same DID-document JSON shape,
and the same static-projection pattern (authoritative source → generated `did.json`);
only the trust root under the OB3 interop layer changes. Rung 3 pays the small
optionality cost (single-config issuer DID, swappable key source) and forecloses
nothing.

---

## Requirements

- **R1** — `curl -i https://credentials.andamio.io/.well-known/did.json` returns
  **200** (today 404) with the exact committed JSON and the chosen Content-Type.
- **R2** — The resolved document exposes one verification method `#key-2026-07`
  (`type: Multikey`) whose `publicKeyMultibase` decodes to the **raw 32 bytes of KMS
  `vc-sign-ed25519` version 1** (`318d54e7…d55014`), listed in both
  `verificationMethod` and `assertionMethod`.
- **R3** — A committed `did.json` whose key does **not** match KMS version 1 fails a
  CI test (key-pin invariant). Drift is a red test, not a silent break.
- **R4** — Serving `.well-known/` is a **deliberate, reviewed act**: the three-place
  allowlist (Dockerfile COPY + `check-allowlist.sh` + nginx location) stays honest,
  and the trust-critical files are CODEOWNERS-gated.
- **R5** — The did.json Content-Type is asserted in **both** the CI image smoke test
  and the post-deploy live check.
- **R6** — `did:web:credentials.andamio.io` **resolves via a real resolver (spruce)**
  and yields `#key-2026-07`. This — not a `curl` — is the acceptance proof.
- **R7** — Rollback is trivial and additive: drop the COPY, the location, the file;
  redeploy. No KMS ops, no IAM, no DNS.

---

## Key Technical Decisions

- **KTD-1 — Single-key DID doc pinned to KMS key version 1 (SETTLED, James
  2026-07-10).** One `verificationMethod` (`#key-2026-07`) in both `verificationMethod`
  and `assertionMethod`; rotation later adds a **new** method additively
  (non-breaking). Matches the locked deployment plan's single-key posture, the Rung-1
  spike sample, and the walt-id #977 single-key-did workaround. Do **not** re-litigate
  or "improve" the shape to `Ed25519VerificationKey2020` or multi-key.

- **KTD-2 — Commit-static now; defer CI-live-KMS-emit to Rung 8 (SETTLED this
  session).** Because we pin a single key at version 1, its public bytes are
  **immutable**, so the smallest verifying slice is a **committed static** `did.json` —
  no KMS-read-in-CI, no `roles/cloudkms.publicKeyViewer` grant, no ops-repo Terraform
  delta. Decision 4's full CI-live-emit form is **anti-drift hardening whose value only
  appears once keys rotate**, and it is needed anyway at Rung 8 for the issuer-service
  startup drift check. The commit-static-vs-live-emit fork is **orthogonal to the
  KERI/Veridian question** — both branches are `did:web`, KMS-rooted, KERI-neutral — so
  picking the cheaper branch costs nothing in future optionality. Corroborated by
  `did:webs` (ToIP), whose own pattern is "generate a static DID doc from an
  authoritative key source, serve it statically" — exactly this shape.

- **KTD-3 — Content-Type `application/did+ld+json`, resolver is the arbiter.** DID-Core
  names `application/did+ld+json` for a JSON-LD DID document; follow the existing
  explicit-type pattern used for `/issuer`. `application/json` (and `application/ld+json`)
  are the **proven-safe fallback** — the Rung-1 spike host served the DID doc as
  `application/json` and spruce resolved it. The **definitive check is the spruce
  resolver in R6**, not the header string; if the chosen type ever regresses
  resolution, fall back. Assert the chosen type in **both** `ci.yml` and `deploy.yml`
  (see KTD-6 rationale on CI parity).

- **KTD-4 — Reuse the encoding tail; only the SPKI-strip is net-new.** The
  `0xed01`-multicodec + base58btc encoding is already solved (`spike/src/keys.ts`, and
  `@digitalbazaar/ed25519-multikey` used by the Rung-1 spike). The only genuinely new
  logic in `tools/gen-did-json.ts` is stripping the **raw 32 bytes out of the Ed25519
  SPKI DER** (they are the trailing 32 bytes of the SPKI structure). Prefer the library
  over a hand-rolled base58 encoder; pin the expected `z6Mk…` output in the test.

- **KTD-5 — Repo-root `.well-known/` layout.** The deployment plan's file tree writes
  `static/.well-known/did.json`, but **this repo has no `static/` dir** — the Dockerfile
  COPYs top-level dirs (`context/ issuer/ badges/`). Place `.well-known/` at the **repo
  root**, matching that convention. (Layout-note deviation from the deployment plan,
  intentional.)

- **KTD-6 — CODEOWNERS created net-new at `.github/CODEOWNERS`, document-only gate.**
  No CODEOWNERS file exists anywhere in the repo today. Create one at `.github/CODEOWNERS`
  (workflows already live under `.github/`). Gate the trust-critical paths this rung
  adds (`.well-known/did.json`, `tools/gen-did-json.ts`) plus the nginx/allowlist config
  it touches. **Document-only in v1** — no required-reviewer branch protection.

- **KTD-7 — Key-pin test is decode-only by default, live-KMS opt-in.** The fast unit
  path decodes the committed `publicKeyMultibase` and asserts it equals the known raw
  hex `318d54e7…d55014` (no network, runs in CI). An **opt-in** live check re-fetches
  KMS version 1 and re-derives, for use where `gcloud` is authed. This keeps CI hermetic
  while still supporting a real KMS round-trip.

---

## High-Level Technical Design

The DID document is a **deterministic static projection of an authoritative key
source**, guarded by a drift-detecting invariant test. This is the same pattern
`did:webs` uses (KEL → did.json); only the source (KMS) is swappable later.

```mermaid
flowchart LR
    KMS["KMS vc-sign-ed25519\nversion 1 (SPKI PEM)"] -->|gen-did-json.ts:\nSPKI → raw32 → 0xed01 → base58btc| DID[".well-known/did.json\n(committed static)"]
    DID -->|COPY (allowlist) + nginx location| NGINX["nginx static host\napplication/did+ld+json"]
    NGINX -->|HTTPS| RESOLVER["spruce resolver\n(R6 proof)"]
    DID -.->|key-pin invariant test| GUARD{"decodes to\n318d54e7…d55014?"}
    KMS -.->|opt-in live re-fetch| GUARD
    GUARD -.->|no ⇒ red test| FAIL["CI fails (R3)"]

    subgraph gates["reviewed-act gates (R4)"]
      ALLOW["check-allowlist.sh\n(Dockerfile ⇄ ALLOWED)"]
      CO["CODEOWNERS"]
    end
    ALLOW -.-> NGINX
    CO -.-> DID
```

*Directional guidance for reviewers — not implementation specification.*

---

## Output Structure

New paths this rung introduces (per-unit `**Files:**` remain authoritative):

```text
credential-badges/
├── .well-known/
│   └── did.json                 # NEW — committed static DID doc (U1)
├── tools/                       # NEW dir — build-only, never served
│   ├── gen-did-json.ts          # NEW — deterministic regenerator (U2)
│   ├── gen-did-json.test.ts     # NEW — encoding unit tests (U2)
│   ├── did-pin.test.ts          # NEW — key-pin invariant (U3)
│   └── README.md                # NEW — what tools/ is, how to run (U2)
└── .github/
    └── CODEOWNERS               # NEW — document-only gate (U7)
# modified: nginx/default.conf.template (U4), Dockerfile + scripts/ci/check-allowlist.sh (U5),
#           .github/workflows/{ci.yml,deploy.yml} (U6), MOC.md / DEPLOY.md (U8)
```

---

## Implementation Units

### U1. Commit the static `.well-known/did.json`

- **Goal:** Land the exact DID document at repo root so the resolvable artifact exists.
- **Requirements:** R1, R2.
- **Dependencies:** none (anchor unit).
- **Files:** `.well-known/did.json` (create).
- **Approach:** Byte-for-byte the document below. `@context` + `Multikey` /
  `publicKeyMultibase` shape mirrors the Rung-1 spike `publish/did.json` that spruce
  already resolves; only the host/fragment/key differ.

  ```json
  {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1"
    ],
    "id": "did:web:credentials.andamio.io",
    "verificationMethod": [
      {
        "id": "did:web:credentials.andamio.io#key-2026-07",
        "type": "Multikey",
        "controller": "did:web:credentials.andamio.io",
        "publicKeyMultibase": "z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7"
      }
    ],
    "assertionMethod": [
      "did:web:credentials.andamio.io#key-2026-07"
    ]
  }
  ```

- **Patterns to follow:** `spike/verifier-spike/publish/did.json`,
  `spike/verifier-spike/src/did-web.ts` (`buildDidDocument`).
- **Test scenarios:** `Test expectation: none — static data artifact. Its correctness
  is enforced by U3's key-pin invariant test and the U6/R6 resolver check.`
- **Verification:** File present at repo root; `id`/`controller`/fragment internally
  consistent; `publicKeyMultibase` = `z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7`.

### U2. `tools/gen-did-json.ts` — deterministic regenerator

- **Goal:** The **source-of-truth generator** that produces U1's bytes from the KMS
  Ed25519 public key. The committed file is its output.
- **Requirements:** R2, R3 (supplies the derivation the invariant checks against).
- **Dependencies:** U1 (target output to match).
- **Files:** `tools/gen-did-json.ts` (create), `tools/gen-did-json.test.ts` (create),
  `tools/README.md` (create), and a `tools/`-scoped TS/deps setup (see Approach).
- **Approach:** Read the KMS pubkey via
  `gcloud kms keys versions get-public-key 1 --location us-central1 --keyring
  credential-badges-issuer --key vc-sign-ed25519 --project andamio-credentials`, **or**
  a PEM on stdin for offline use. Pipeline: **SPKI DER → raw 32 bytes** (net-new;
  trailing 32 bytes of the SPKI structure) **→ `0xed01` multicodec → base58btc →
  `publicKeyMultibase`**, then emit the U1 document. **Pure / deterministic — no
  timestamps, no randomness** (same key in ⇒ same bytes out). Prefer
  `@digitalbazaar/ed25519-multikey` (already a Rung-1 spike dep) or the working encoder
  in `spike/src/keys.ts` for the multicodec+base58 tail (KTD-4). Decide where the
  toolchain lives (reuse `spike/verifier-spike` TS setup vs a minimal `tools/` package)
  at execution time — deferred; must run where Node ≥20 is available.
- **Execution note:** Implement the SPKI-strip + encoding test-first — it's the only
  net-new cryptographic logic and a wrong byte offset silently produces a plausible-but-
  wrong multibase.
- **Patterns to follow:** `spike/src/keys.ts` (multicodec `[0xed,0x01]` + base58btc,
  leading-zero preservation), `spike/verifier-spike/src/keys.ts` (multikey lib usage).
- **Test scenarios** (`tools/gen-did-json.test.ts`):
  - Happy path: given the KMS v1 SPKI PEM (from the ground-truth block), the SPKI-strip
    yields raw bytes = `318d54e7…d55014` (32 bytes).
  - Happy path: raw `318d54e7…d55014` → multibase =
    `z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7`.
  - Determinism: two runs on the same PEM produce byte-identical output (no timestamp/
    nonce drift).
  - Full emit: generator output deep-equals the committed `.well-known/did.json` (U1).
  - Edge: a malformed / non-Ed25519 PEM (wrong OID or wrong length) is rejected with a
    clear error rather than emitting a truncated key.
  - Edge: base58btc leading-zero bytes are preserved (guards the encoder tail).
- **Verification:** `gen-did-json` (PEM-on-stdin mode) reproduces U1 byte-for-byte;
  tests green.

### U3. Key-pin invariant test

- **Goal:** Make a wrong/rotated committed key a **red test** — the drift guard.
- **Requirements:** R3.
- **Dependencies:** U1, U2.
- **Files:** `tools/did-pin.test.ts` (create); wire into the test runner used by U2.
- **Approach:** Decode the committed `.well-known/did.json` `publicKeyMultibase` and
  assert it equals the known raw hex `318d54e7…d55014` (**decode-only, hermetic, runs in
  CI** — KTD-7). Assert `id`/`controller`/fragment are internally consistent and the
  method appears in both `verificationMethod` and `assertionMethod`. Add an **opt-in**
  live check (env-gated) that re-fetches KMS version 1 via the `get-public-key` command
  and re-derives, for authed environments.
- **Execution note:** Start from a failing test — mutate one multibase character and
  confirm red — before pinning green, so the guard is proven to actually catch drift.
- **Patterns to follow:** the raw-hex ground truth in the Problem Frame / handoff;
  `spike/src/keys.ts` decode path.
- **Test scenarios** (`tools/did-pin.test.ts`):
  - Happy path: committed multibase decodes to `318d54e7…d55014` → pass.
  - Failure path: a one-character-mutated multibase (or a different key's bytes) → the
    test **fails** (this is the whole point).
  - Consistency: `#key-2026-07` fragment is identical across `id`, `verificationMethod[0].id`,
    and `assertionMethod[0]`; `controller` == `id`.
  - Opt-in live: when the live-KMS env flag is set and `gcloud` is authed, the re-fetched
    version-1 key matches the committed bytes. `Covers R3.`
- **Verification:** Decode-only test green in CI with no network; mutating the committed
  key turns it red.

### U4. nginx location for `.well-known/did.json`

- **Goal:** Serve the committed file with the correct Content-Type and cache posture.
- **Requirements:** R1, R5.
- **Dependencies:** U1.
- **Files:** `nginx/default.conf.template` (modify).
- **Approach:** Add an **exact-match** `location = /.well-known/did.json` mirroring the
  existing `location = /issuer` pattern: set `default_type application/did+ld+json`
  (KTD-3) and `try_files` the real file. Cache `public, max-age=3600` — mutable on
  rotation, so **not** `immutable` and shorter than the 86400 used for immutable
  contexts. Do **not** add a `types {}` mapping for `.json` (stock mime.types already
  covers it; re-listing warns "duplicate extension").
- **Patterns to follow:** `nginx/default.conf.template` `location = /issuer` block
  (extensionless exact path with forced `default_type`).
- **Test scenarios:**
  - Local container / `test-nginx-fallback.sh`-style check: `GET /.well-known/did.json`
    → 200, body == committed JSON, `Content-Type: application/did+ld+json`,
    `Cache-Control: public, max-age=3600`.
  - Edge: `GET /.well-known/other` → 404 (location is exact-match, does not over-capture
    `.well-known/`).
- **Verification:** Built image serves the path with the chosen type; existing nginx
  fallback tests still green.

### U5. Dockerfile allowlist COPY + `check-allowlist.sh` sync

- **Goal:** Bake `.well-known/` into the image **and** keep the allowlist gate honest —
  the two must land together (three-place hand-sync with U4).
- **Requirements:** R4.
- **Dependencies:** U1, U2 (introduces `tools/`).
- **Files:** `Dockerfile` (modify), `scripts/ci/check-allowlist.sh` (modify).
- **Approach:** Add `COPY .well-known/ /usr/share/nginx/html/.well-known/` to the
  Dockerfile allowlist block with a one-line comment (forever-public endpoint). Add
  `.well-known` to the `ALLOWED` array in `check-allowlist.sh`. Add `tools` to
  `IGNORED_PREFIXES` (build-only, **never served**). Do not `COPY .`.
- **Patterns to follow:** existing `COPY context/ … issuer/ … badges/` block and the
  Dockerfile allowlist header comment; `ALLOWED` / `IGNORED_PREFIXES` arrays.
- **Test scenarios:**
  - `bash scripts/ci/check-allowlist.sh` passes with `.well-known` present and `tools/`
    ignored. `Covers R4.`
  - Failure path: temporarily add an un-allowlisted top-level file → script exits
    non-zero (gate still bites).
  - Edge: `tools/` present in the repo does **not** trip the allowlist (it's ignored,
    not served).
- **Verification:** Allowlist check green; built image contains
  `/usr/share/nginx/html/.well-known/did.json` and no `tools/`.

### U6. CI + post-deploy Content-Type assertions

- **Goal:** Assert did.json reachability + Content-Type at **PR time and post-deploy**,
  so a type regression fails before it reaches production verifiers.
- **Requirements:** R5.
- **Dependencies:** U4, U5.
- **Files:** `.github/workflows/deploy.yml` (modify), `.github/workflows/ci.yml`
  (modify).
- **Approach:** Extend the existing `assert_ct` blocks with
  `assert_ct /.well-known/did.json application/did+ld+json` in **both** the `ci.yml`
  image smoke test and the `deploy.yml` post-deploy live check (keep the two lists
  identical — KTD-3 CI parity; the handoff only named `deploy.yml`).
- **Patterns to follow:** `deploy.yml` `assert_ct()` (lines ~71–79) and the mirror block
  in `ci.yml`.
- **Test scenarios:**
  - CI image smoke test asserts `/.well-known/did.json` → 200 + chosen type (fails if
    the nginx location or Dockerfile COPY is missing). `Covers R5.`
  - Post-deploy assert on the `*.run.app` URL passes for the live service.
  - Edge: if the chosen `application/did+ld+json` ever regresses resolution (R6),
    the fallback to `application/json` updates **both** workflow lines together.
- **Verification:** Both workflows assert the path; a deliberately wrong expected type
  fails the assertion.

### U7. CODEOWNERS (net-new, document-only gate)

- **Goal:** Gate the trust-critical files this rung adds.
- **Requirements:** R4.
- **Dependencies:** U1, U2, U4, U5 (the paths to gate must exist).
- **Files:** `.github/CODEOWNERS` (create).
- **Approach:** Create `.github/CODEOWNERS` (net-new — none exists). Gate
  `/.well-known/did.json`, `/tools/gen-did-json.ts`, and the nginx/allowlist config
  (`/nginx/default.conf.template`, `/scripts/ci/check-allowlist.sh`). Assign to the
  appropriate owner handle (confirm the exact owner at execution time — deferred).
  **Document-only in v1** — no branch-protection / required-reviewer change (KTD-6).
- **Patterns to follow:** deployment plan Decision 5 / P1bis-09 CODEOWNERS scope (glob
  patterns, document-only).
- **Test scenarios:** `Test expectation: none — governance metadata file, no runtime
  behavior. Correctness is that the glob paths match the real files (verify by
  inspection).`
- **Verification:** File present; globs resolve to the intended paths (spot-check each
  pattern matches an existing file).

### U8. Docs touch

- **Goal:** Record the new served endpoint where operators look.
- **Requirements:** none directly (operability).
- **Dependencies:** U4.
- **Files:** `MOC.md` and/or `DEPLOY.md` (modify).
- **Approach:** One line noting `/.well-known/did.json` joins `/context`, `/issuer`,
  `/badges` on the static host, with its Content-Type and the "published key, nothing
  signs yet" caveat. (`tools/README.md` is created in U2.)
- **Patterns to follow:** existing served-endpoint listings in `MOC.md` / `DEPLOY.md`.
- **Test scenarios:** `Test expectation: none — documentation.`
- **Verification:** The endpoint appears in the docs' served-path list.

---

## Verified When (acceptance)

1. `curl -i https://credentials.andamio.io/.well-known/did.json` → **200** (today 404),
   chosen Content-Type, exact committed JSON. **(R1, R5)**
2. **`did:web:credentials.andamio.io` resolves via the spruce resolver** (Rung-1
   verifier set's did:web resolution) and yields the pinned `#key-2026-07` verification
   method. *Real proof — a resolver, not a curl.* Expect to re-point the Rung-1 harness
   from the spike host to production, and (per `spike/verifier-spike/results/spruce.md`)
   possibly re-apply the `ssi` 0.16.0 adapter — a rebuild, not just a URL swap. **(R6)**
3. **Key-pin invariant test green** — committed multibase decodes to `318d54e7…d55014`,
   matching KMS version 1; mutating it turns the test red. **(R2, R3)**
4. Allowlist check + existing CI green; both workflows' did.json Content-Type assertions
   pass. **(R4, R5)**

---

## Scope Boundaries

### Deferred to Follow-Up Work (this repo, later rungs)

- **CI-live-KMS-emit + `roles/cloudkms.publicKeyViewer` grant + ops-repo Terraform
  delta** — Decision 4's full form; folds into **Rung 8**'s issuer-service startup
  drift check (`service/expected-did.json`, P1-06), where it's needed anyway (KTD-2). If
  you ever want it sooner, it's a bolt-on: a dedicated `publicKeyViewer` SA + a
  pre-`docker build` CI step.
- **Re-pointing the Rung-1 verifier harness** at production `credentials.andamio.io`
  end-to-end (part of acceptance step 2, but the harness rebuild itself is follow-up).

### Outside this rung's identity (do NOT pull in)

- Signing any VC / filling `proof` / `verify=` (Rungs 6–7). did.json only *publishes*
  the key; nothing signs.
- `BitstringStatusList` / `/status/*` (Rung 8, Decision 3).
- Issuer Profile `["Profile","AttestationHost"]` (**Rung 4**, next rung).
- The `credential-badges-issuer` service, external HTTPS LB, `service-v*` WIF (Rung 8).
- CODEOWNERS branch-protection / required-reviewer enforcement (document-only in v1).
- Any KERI / `did:webs` substrate (witnesses, AIDs, KEL, pre-rotation). Kept
  friction-light by KTD-1/KTD-5's single-config issuer DID and swappable key source —
  but **not built here**.

---

## Risks & Dependencies

- **Content-Type choice could regress resolution.** `application/did+ld+json` is
  DID-Core-correct but less battle-tested than the spike's `application/json`. Mitigation:
  R6's resolver is the arbiter; fallback is a one-line change in both workflows (KTD-3).
- **Harness re-point is not free.** `ssi` 0.16.0 API drift needed a thin adapter in
  Rung 1; acceptance step 2 may need a rebuild, not just a URL swap. Flagged, not a
  blocker for the deliverables.
- **Three-place allowlist hand-sync.** Missing any of Dockerfile COPY / `check-allowlist.sh`
  ALLOWED / nginx location fails CI loudly — by design (U5 lands them together).
- **Dependency (external, verified live 2026-07-10):** KMS `vc-sign-ed25519` version 1
  is live and returns the pinned key. did.json only *publishes* it; it is never *used*
  here, so no KMS runtime dependency at serve time.

---

## Rollback

Trivial and additive. did.json is a new static file behind a new nginx location +
allowlist entry; it changes nothing existing. Revert = drop the `COPY`, the location,
and the file, redeploy. No KMS operations, no IAM changes, no DNS. The key is only
*published* here, never *used*.

---

## Boundary & Lifecycle

Executes in `credential-badges` via compound engineering — **not** an orch PR. Report
each "Verified When" back so orch ticks Rung 3 on the owning task and scopes Rung 4
(AttestationHost profile). The upstream handoff doc (home = orch,
`docs/plans/2026-07-10-credential-badges-rung3-did-web-resolves.md`) is disposable —
delete on delivery; residue lives in the PR, the slice-ladder overlay, and the compound
record. Since `docs/solutions/` does not yet exist in this repo, capturing this rung
with `/compound` (a did:web / Content-Type solution doc) would be its first structured
entry and directly reusable for the future `did:webs` swap.

---

## Sources & Research

- **Ground truth (verified live 2026-07-10):** KMS `vc-sign-ed25519` v1 SPKI →
  raw `318d54e79ed163967f189e649abbcd2241dc64bf6cbfe98d7c3b1a60fed55014` →
  `z6Mkhnh1woBUSSQHjknh8jvjKax5hNAEZ37LEfWfnC2FYjt7`; `credentials.andamio.io/.well-known/did.json`
  = 404 today (handoff spec).
- **Repo grounding:** `Dockerfile` (allowlist COPY discipline), `nginx/default.conf.template`
  (`location = /issuer` exact-match + `types {}` accumulation note),
  `scripts/ci/check-allowlist.sh` (ALLOWED / IGNORED_PREFIXES),
  `.github/workflows/deploy.yml` + `ci.yml` (`assert_ct` blocks),
  `spike/verifier-spike/publish/did.json` + `src/did-web.ts` (proven did.json shape),
  `spike/src/keys.ts` (multicodec+base58 encoder), `spike/verifier-spike/results/spruce.md`
  (resolver behavior + `ssi` 0.16.0 adapter note).
- **Deployment plan (this repo):** `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`
  Decision 4 (DID-doc location, CI-emit → deferred here), Decision 5 (CODEOWNERS scope,
  topology), single-key rotation posture.
- **Veridian / `did:webs` prior-art (this session):** Veridian is KERI/ACDC with
  **live** witness + KERIA infrastructure — the opposite pole from static did:web, and it
  never faces our fork. The relevant analog is **`did:webs`** (ToIP:
  <https://trustoverip.github.io/tswg-did-method-webs-specification/>), whose "generate a
  static DID doc from an authoritative key source, serve it statically" pattern endorses
  commit-static and keeps the `did:web → did:webs` swap friction-light. Refs:
  <https://github.com/cardano-foundation/veridian-wallet/blob/main/README.md>,
  <https://deepwiki.com/cardano-foundation/veridian-wallet/4-infrastructure>.
