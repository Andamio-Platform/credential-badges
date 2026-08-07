# verifier-spike

Phase 0 pre-flight verifier spike. Confirms the target verifier set actually
handles the production feature combination on a constructed credential before
Phase 0 locks the set. Plan reference: P1bis-10 + the "Pre-Phase-0 spike" item
under Phase 0 in `docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`.

## What this tests

Four features simultaneously:

1. `did:web` resolution (issuer DID)
2. Data Integrity `eddsa-rdfc-2022` cryptosuite
3. `BitstringStatusListEntry` with `statusPurpose: "suspension"`
4. `OnChainCredentialAnchor` typed `evidence` (opaque custom type)

Against four verifiers (three independent + one self-loopback):

| Verifier | Role | Counts toward "≥3 independent"? |
|----------|------|---------------------------------|
| `1EdTech/digital-credentials-public-validator` | Spec-driven OB3 check | Yes |
| `spruceid/ssi` (Rust) | DI eddsa-rdfc-2022 authority | Yes |
| `walt-id/waltid-identity` (Kotlin/JVM) | OB3 + suspension primary | Yes |
| `@digitalbazaar/vc` (TS) | Self-loopback sanity check | No |

Pass criterion (Phase 0 gate): all three independent verifiers verify the
credential bytes with **no errors AND no warnings**. Any warning is a finding.

## Throwaway did:web host

`did:web:workshop-maybe.github.io:credential-badges-verifier-spike`

did:web path-form resolution: `<path>/did.json` (NOT `.well-known/did.json` —
that's only for the bare-domain form). So:

| Path-form DID URL | Resolved HTTPS URL |
|-------------------|-------------------|
| `did:web:workshop-maybe.github.io:credential-badges-verifier-spike` | `https://workshop-maybe.github.io/credential-badges-verifier-spike/did.json` |

Repo to be created: `workshop-maybe/credential-badges-verifier-spike` (GitHub
Pages from `main`). Delete when the spike closes.

## Layout

```
spike/verifier-spike/
  README.md                      # this file
  package.json                   # TS + signing deps
  tsconfig.json
  src/
    keys.ts                      # Ed25519 generation (adapted from spike/src/keys.ts)
    did-web.ts                   # builds did.json from the keypair
    status-list.ts               # builds 131,072-bit BitstringStatusList credential
    credential.ts                # builds the target OB3 credential
    sign.ts                      # eddsa-rdfc-2022 signer (adapted from spike/src/sign-di.ts)
    verify-loopback.ts           # @digitalbazaar/vc self-verify
  publish/                       # files to be pushed to the throwaway GitHub Pages repo
    did.json                     # CI output (generated)
    status/key-epoch-2026-05.json
    context/v0.jsonld
  out/
    issuer-key.json              # generated keypair (gitignored)
    credential.jsonld            # the signed target credential (sent to each verifier)
  results/
    digitalbazaar.md             # per-verifier capture
    spruce.md
    walt-id.md
    onedtech.md
    SUMMARY.md                   # Phase 0 viability decision
```

## Running

```
cd spike/verifier-spike
npm install
npm run generate    # keypair + did.json + status list + credential, all signed
npm run verify      # self-loopback (digitalbazaar)
# spruce and walt-id verifiers have their own subdirectories under verifiers/
```

### did:web resolution smoke test (`verifiers/spruce`, `resolve` bin)

A second binary alongside `spruce-verify` resolves a `did:web` DID through the
**same** ssi `AnyDidMethod` resolver the credential verifier uses, and asserts the
resolved verification method's fragment and `publicKeyMultibase`. Unlike
`spruce-verify` (which needs a full signed credential), this checks did:web
resolution on its own — the cheap "does production still resolve correctly" probe.
Used to close Rung 3's R6 against the live host:

```
cd spike/verifier-spike/verifiers/spruce
cargo run --bin resolve -- did:web:credentials.andamio.io
# → outcome=PASS: resolves did:web:credentials.andamio.io → #key-2026-07 pinning KMS v1
```

## Cleanup

When the spike closes:

1. Delete the throwaway GitHub repo.
2. Move the verifier-set decision into `docs/plans/.../P1bis-10` follow-up.
3. `spike/verifier-spike/` stays committed as evidence (the plan treats `spike/`
   as the historical source of truth, gitignored from production deploys).
