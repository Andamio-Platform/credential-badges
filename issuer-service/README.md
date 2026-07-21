# credential-badges-issuer (Rung 8.4)

The production issuer service: serves a **signed OB3 Verifiable Credential**
for any registered Andamio badge on demand. TypeScript, Cloud Run, KMS-signed
Data Integrity proofs (`eddsa-rdfc-2022`).

This service **inherits the hardened `spike/signer-spike/` logic** (Rung 6,
hardened at Rung 8 per issue #54, finalized at Rung 8.3): the anchor gate with
SLT Blake2b verification, the live-did key pin, the narrow vc.issue error
handling, the single-sign assertion, the key-epoch status-list integration,
and the flat evidence dialect. Each `src/` module's header comment names its
spike origin. The spike stays in place as the reference implementation and
CLI harness; the service is a clean port (the spike is a one-shot CLI pinned
to one subject, the service is a long-running server generalized to any
registered badge — sharing code directly would have broken the spike's
hermetic tests and its pinned-subject posture).

## The contract

```
GET /credentials/{network}/{policyId}/{sltHash}/{recipient}
```

The deployment plan's Unit-4 route, verbatim
(`docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`).
`policyId` **is** the course id (Andamio V2: a course's id is its mint
policy); `recipient` is the on-chain alias. The `{recipient}` segment is
load-bearing: a badge `(course_id, slt_hash)` alone does not identify a
credential — the reference badge
`ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db`
has five distinct on-chain holders (verified live 2026-07-21).

Response: the signed credential, `application/ld+json`, `proof` in array form
(1EdTech Plain-JSON schema). `validFrom` and `proof.created` are pinned to
the claim-tx `block_time` derived from the slot — re-derivation is
byte-identical.

| status | body `error`          | meaning |
|--------|-----------------------|---------|
| 200    | —                     | signed credential |
| 400    | `invalid-params`      | malformed path — refused before any upstream call |
| 404    | `wrong-network`       | valid network enum, not this deployment's |
| 404    | `unknown-badge`       | not in the repo badge registry (`generator/credentials.json`) |
| 404    | `unknown-claim`       | the chain has nothing at this coordinate (not in the recipient's global-state credential map / no claim event) |
| 422    | `anchor-mismatch`     | chain data exists but **conflicts** — e.g. SLT text no longer hashes to the on-chain commitment; the body says why |
| 502    | `signing-unavailable` | KMS failure — never a partial artifact |
| 503    | `upstream-unavailable`| Andamioscan / badge host unreachable — never surfaced as a refusal |

`GET /healthz` is the Cloud Run liveness endpoint. Nothing else is served:
`/.well-known/did.json`, `/status/*`, `/context/*`, `/badges/*` belong to the
static host (the LB routes only `/credentials/*` here).

## Security posture

- **The anchor gate lives INSIDE the sign boundary** (issue #54 finding 4):
  this service is the only code path that will ever hold sign permission, and
  the KMS call is unreachable unless a live Andamioscan read proves, for the
  requested coordinate: the recipient's **current global-state credential
  map** contains the course with a byte-equal credential hash; the claim tx
  is **discovered server-side** (never caller-supplied) and re-verified by
  slot binary search over the tx index (decay-proof, finding 5); the module's
  SLT texts **Blake2b-hash to the on-chain `slt_hash`** (finding 3) — the
  text signed into `criteria.narrative` is exactly what the chain commits to.
  There is **no caller-supplied subject override**: every signed field is
  re-derived from chain reads.
- **Fail-closed startup drift check** (plan Decision 4 / P1-06): before the
  listener opens, the service proves its KMS key version's public key is the
  one published in the **live** `did.json` (bounded retry; the bundled
  lockstep CI copy is the reference only when the static host is unreachable),
  that the live Andamio context equals the committed bytes, and that the
  active key version has a bit position in the key-version registry. Any
  mismatch kills the boot — drift is a loud startup failure, never a silently
  broken signature.
- **Cache-no-double-sign**: signed artifacts are cached keyed by
  `(network, courseId, sltHash, recipientAsset, keyVersion)` — a re-request
  serves byte-identical bytes with **zero** KMS calls. Per issuance, the
  signer seam is asserted to have been invoked **exactly once** before the
  artifact is cached or served (finding 1). An optional second-level
  `ArtifactStore` seam (GCS-shaped) exists for cross-instance persistence;
  no GCS client ships in this build.
- **Closed document loader**: the W3C/OB3/security contexts are vendored and
  integrity-pinned (`contexts/manifest.json`); the Andamio context is the
  committed repo bytes; the did:web document is the boot-verified pin. The
  loader performs zero network fetches — an unlisted URL is refused.
- **Post-sign verify**: every signed credential is loopback-verified
  (including its status bit) before it leaves the process.
- **Registered badges only**: requests outside `generator/credentials.json`
  are refused before any chain read.

## Signing seam

`{ id, algorithm: "Ed25519", async sign({data}) }` — constructor-injected.

- **`KmsSigner`** (production): the spike proved the KMS semantics with
  `gcloud kms asymmetric-sign` (PureEdDSA over the raw `data` bytes, raw
  64-byte signature). The service calls the same AsymmetricSign API over REST
  with a metadata-server token, because the runtime image carries no gcloud.
  **Identity assumption: the service runs AS the sign-only SA** — the ops
  gate attaches it to the Cloud Run service; no impersonation anywhere.
- **`makeEphemeralSigner()`** (tests/CI/local): an in-process Ed25519 key
  through the same seam — the spike's loopback pattern. CI runs the full
  request path with it against recorded Andamioscan fixtures.

## The ops gate — required before `service-v0.1.0` can ever be tagged

1. **Region decision** (us-central1 vs europe-west4; may move the KMS key,
   which re-runs the did.json pipeline).
2. **Sign-SA attach** — the Cloud Run service runs as the sign-only SA;
   deploy identity and sign identity stay distinct.
3. **Sign-only WIF** ref-constrained to `refs/tags/service-v*`,
   non-overlapping with the static-host and render lanes.
4. **LB delta** — external HTTPS LB URL map: `/credentials/*` → this
   service's serverless NEG; default → static host.
5. **KMS IAM scope-down (8b)** — the sign SA holds
   `cloudkms.signerVerifier` + `cloudkms.publicKeyViewer` on the one key
   version only; KMS Cloud Audit Logs enabled.
6. **Repo variables** consumed by `.github/workflows/deploy-issuer.yml`
   (`ISSUER_GCP_REGION`, `ISSUER_AR_IMAGE`, `ISSUER_WIF_PROVIDER`,
   `ISSUER_CICD_SA`, `ISSUER_KMS_KEY_VERSION`). The workflow refuses to run
   while any is unset.

## Local run (ephemeral signer — no KMS, no GCP)

```
cd issuer-service
npm ci
npm test                 # hermetic: fixtures + ephemeral signer
npm run start:ephemeral  # serves :8080; signs with a throwaway key,
                         # did:example issuer — loudly NOT production
curl -s localhost:8080/healthz
curl -s localhost:8080/credentials/mainnet/ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df/e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db/james | head -50
```

The ephemeral server still runs the real anchor gate against live
Andamioscan — only the key material and issuer id differ from production.

Docker (build context = repo root):

```
docker build -f issuer-service/Dockerfile -t credential-badges-issuer .
docker run --rm -p 8080:8080 -e SIGNER_MODE=ephemeral credential-badges-issuer
```

Production mode (`SIGNER_MODE=kms`, the default) requires
`KMS_KEY_VERSION_NAME` (full CryptoKeyVersion resource name — provided by
the ops gate; deliberately no default) and a metadata server, i.e. it only
meaningfully runs on Cloud Run as the sign SA.
