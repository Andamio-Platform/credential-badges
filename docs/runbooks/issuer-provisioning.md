# Runbook — issuer provisioning & additive key rotation (did:web)

Provisioning and **planned** signing-key changes for
`did:web:credentials.andamio.io`. A planned rotation is **additive**: the
outgoing key stays published so every credential it already signed keeps
verifying forever. Nothing is re-issued and nothing is suspended.

**Removal is a different runbook.** If the key is suspected compromised, stop
here and use [`key-compromise.md`](key-compromise.md) — that path deliberately
*breaks* verification for everything the key signed. The deployment plan's rule:
*"removing a verification method is reserved for the compromise kill-switch."*

> **Read this before you touch anything.** Rotation spans six coupled surfaces
> across two repos and two Cloud Run services, in an order where a mistake either
> refuses the issuer's boot (loud, safe, an outage) or publishes a DID document
> that live credentials cannot verify against (quiet, unsafe). The order in
> [Phase 2](#phase-2--the-rotation-order-order-is-the-whole-runbook) is the
> runbook.

## Current state

| Fact | Value |
|---|---|
| Signing key | KMS `vc-sign-ed25519` **version 1**, keyring `credential-badges-issuer`, `us-central1`, project `andamio-credentials` |
| Protection level | **`SOFTWARE`** — see [#87](https://github.com/Andamio-Platform/credential-badges/issues/87); the plan specifies HSM and the gap is unresolved |
| Algorithm | `EC_SIGN_ED25519`, PureEdDSA over raw data, no automatic rotation |
| Published as | `#key-2026-07` in `.well-known/did.json` (+ the `/did.json` alias) — `max-age=3600` |
| Status epoch | `status/key-epoch-2026-07.json`, **bit 0 = key-2026-07** |
| Sign identity | `credential-badges-sign-sa@andamio-credentials.iam.gserviceaccount.com` |
| Sign grant | `roles/cloudkms.signerVerifier` — **bound on the key, not the key version** ([#87](https://github.com/Andamio-Platform/credential-badges/issues/87)) |
| Deploy identity | `credential-badges-issuer-cicd@…`, WIF-constrained to `refs/tags/service-v*` — distinct from the sign identity by design |
| Key-version creation | Terraform in `andamio-ops` (`terraform/credentials/`) |
| Runtime key selection | Cloud Run env `KMS_KEY_VERSION_NAME`, **owned by Terraform** |

## When to rotate

- **Scheduled hygiene.** No automatic rotation is configured, by design — a
  surprise rotation would break the boot drift check. Rotation is always a
  deliberate, staffed operation.
- **Protection-level migration.** Moving to an HSM-backed key (if supported —
  see [Appendix](#appendix--the-unresolved-hsm-question)) *is* this procedure.
- **Region migration.** Moving the key re-runs the whole did.json pipeline.
- **Staff/blast-radius change.** Any event that argues for a fresh key without
  evidence of compromise. If there *is* evidence, use the compromise runbook.

## Phase 0 — Prerequisite: `gen-did-json.ts` cannot emit two keys

**This blocks every additive rotation and must ship first.**

`tools/gen-did-json.ts` is hard-pinned to a single key:

```ts
export const KEY_FRAGMENT = "key-2026-07";
export const VERIFICATION_METHOD_ID = `${DID}#${KEY_FRAGMENT}`;
export const KMS_GET_PUBKEY_ARGS = [
  "kms", "keys", "versions", "get-public-key", "1", …
];
```

It emits `verificationMethod: [<one entry>]` and
`assertionMethod: [VERIFICATION_METHOD_ID]`. There is no way to express "old key
plus new key" — which is exactly what additive rotation means. `tools/did-pin.test.ts`
is single-key-shaped too: it asserts `verificationMethod[0]` decodes to one
`PINNED_RAW_HEX`.

Required before Phase 1:

1. Generalize the generator to a **list** of `{ fragment, kmsVersion }`, emitting
   one `verificationMethod` entry per key and listing **all** of them in
   `assertionMethod` (a verifier must accept the old key for old credentials and
   the new key for new ones).
2. Generalize `did-pin.test.ts` to pin **every** published key by fragment, not
   `verificationMethod[0]` by position. Position-based pinning silently passes
   whichever key happens to sort first.
3. Decide and fix the **order** of `verificationMethod`. The issuer's drift check
   looks the active fragment up by name, so it does not care — but anything that
   reads `[0]` does. Newest-first is the useful convention; whichever you pick,
   assert it.

This is ordinary additive work with no ops dependency and can land any time
before a rotation is needed. Do not discover it mid-rotation.

## Phase 1 — Provision the new key version

1. **Create the key version** in `andamio-ops` Terraform (`terraform/credentials/`)
   — same keyring, `EC_SIGN_ED25519`, no automatic rotation. **Never reuse a
   retired version number.**
2. **Grant sign access on the new version.** Today this is a no-op *and that is
   the bug*: the `signerVerifier` binding sits on the key, so a new version
   inherits sign rights with no deliberate action ([#87](https://github.com/Andamio-Platform/credential-badges/issues/87)).
   If that is fixed to version-scoped bindings, this step becomes **required** —
   and skipping it surfaces as a KMS permission denial at first sign, not at boot.
3. **Verify** the version exists and is enabled, and that its public key is
   readable by the identity that will use it:
   ```bash
   gcloud kms keys versions list --key vc-sign-ed25519 \
     --keyring credential-badges-issuer --location us-central1 \
     --project andamio-credentials
   ```

## Phase 2 — The rotation order (order is the whole runbook)

The binding constraint: **the issuer's drift check runs only at boot**, and it
refuses to start unless *all* of the following hold at that moment —

1. the active key version has a bit position in the compiled-in registry;
2. the **live** `did.json` carries the active fragment with a `publicKeyMultibase`
   byte-equal to the signer's own KMS public key;
3. the **live** `context/v1.jsonld` equals the image's bundled copy;
4. the **live** key-epoch status list equals the image's bundled copy, **and** the
   active key's own bit reads `0` (fresh).

Checks 2–4 compare *live static-host bytes* against *bytes baked into the issuer
image*. So the static host must publish the new reality **before** the issuer
boots into it. Reverse the order and the issuer refuses to start — safe, but an
outage until you roll forward.

### 2a. Repo changes (one PR)

- `tools/gen-did-json.ts` — add the new `{ fragment: "key-YYYY-MM", kmsVersion }`
  **keeping the outgoing entry**. Both appear in `verificationMethod` and
  `assertionMethod`.
- Regenerate `.well-known/did.json`; update the pins in `tools/did-pin.test.ts`
  for **both** keys.
- `signing/status-list.ts` — add the new key to
  `KEY_VERSION_POSITIONS` at the next free position, and move
  `ACTIVE_KEY_VERSION` to it. Leave `SUSPENDED_KEY_VERSION_POSITIONS` alone: an
  additive rotation suspends nothing.
- Stand up the new epoch list `status/key-epoch-YYYY-MM.json`, all zeros. The
  nginx `^~ /status/` location serves any new file in the tree with correct
  headers automatically.

**Verify:** `node --experimental-strip-types --test tools/*.test.ts signing/*.test.ts`
green; the regenerated `did.json` contains **both** fragments.

### 2b. Sign the new epoch list — after did.json is live, not before

The new list is signed **under the new key**, and a verifier can only check that
signature once the new key is published. If you sign before the DID document is
live, the artifact is unverifiable for as long as the gap lasts.

So the static deploy splits in two:

1. Tag and deploy `did.json` (both keys) **first**.
   **Verify:** `curl -s https://credentials.andamio.io/did.json` contains both
   fragments; `curl -sI …/.well-known/did.json` → 200 `application/did+ld+json`.
2. Then sign the new epoch list through the hardened path and deploy it.
   **Verify:** the signed list's `proof.verificationMethod` names the **new**
   fragment; update the `COMMITTED_STATUS_FILE_SHA256` pin in
   `signing/status-list.test.ts` in the same PR.

The outgoing epoch list stays served, unchanged, with its bit still `0`. Old
credentials point at it and must keep resolving.

### 2c. Point the runtime at the new key version — the two-variable trap

**`ISSUER_KMS_KEY_VERSION` does not configure the runtime.** It is a repo
variable that gates `.github/workflows/deploy-issuer.yml` (the workflow refuses
to run while it is unset). The value the service actually signs with is the
Cloud Run env `KMS_KEY_VERSION_NAME`, **owned by Terraform**.

Update **both**, or you get skew:

| Updated | Result |
|---|---|
| Terraform only | Deploy workflow runs against a stale gate value. Signing is correct. Confusing, not dangerous. |
| Repo variable only | The service still signs with the **old** key version, while `did.json` and the status registry have moved on. The boot drift check catches it — the active fragment's published key will not byte-match the old version's public key — so the revision **refuses to boot**. Loud, safe, and entirely avoidable. |

### 2d. Redeploy the issuer — flushing is mandatory, not hygiene

```bash
git tag service-vX.Y.Z && git push origin service-vX.Y.Z
```

A running instance keeps its boot-pinned view — old did:web resolution, old
status list, old key — until its container is replaced. Confirm **every** old
revision is drained, not just that a new one is serving.

The signed-artifact cache is keyed on
`(network, courseId, sltHash, recipientAsset, keyVersion)`, so a rotation
re-signs naturally on next request. **No cache purge is needed**, and none is
possible from outside the process anyway.

## Phase 3 — Verify the rotation

1. **New credentials sign under the new key.**
   ```bash
   curl -s "https://credentials.andamio.io/credentials/mainnet/<courseId>/<sltHash>/<alias>" \
     | python3 -c 'import json,sys; p=json.load(sys.stdin)["proof"]; p=p[0] if isinstance(p,list) else p; print(p["verificationMethod"])'
   ```
   **Verify:** prints the **new** `#key-YYYY-MM` fragment.
2. **Old credentials still verify.** This is the whole point of an additive
   rotation, and it is the step people skip. Take a credential signed under the
   outgoing key — the baked flagship badge is the standing example — and run the
   independent verifier set. **Verify:** still green, resolving the **outgoing**
   fragment from the live DID document.
3. **Both status epochs resolve.** `curl -sI` each of
   `/status/key-epoch-2026-07.json` and `/status/key-epoch-YYYY-MM.json` → 200.
4. **The issuer is actually on the new revision.** Confirm no old revision is
   still serving traffic:
   ```bash
   gcloud run revisions list --service credential-badges-issuer \
     --region us-central1 --project andamio-credentials
   ```
5. **KMS audit logs show signing on the new version only.** Any
   `asymmetric-sign` against the retired version after the flush means an
   instance was missed.

## Rollback

Additive rotation is low-risk precisely because the outgoing key is still
published. To back out before Phase 2d, revert the Terraform env and redeploy the
issuer — it boots against the old key, which is still in `did.json`. After 2d,
roll forward rather than back: anything already signed under the new key needs
the new key to stay published, so **never remove the new fragment to "undo" a
rotation.** A key that has signed anything is published forever.

## What this runbook does NOT cover

- **Compromise.** [`key-compromise.md`](key-compromise.md) — suspension flip,
  then DID-method removal and re-issuance.
- **Per-credential revocation.** No per-credential off-chain state exists
  (Decision 3). The status list is per-key-epoch, one bit per key version.
- **On-chain anchors.** Unaffected by any key event. The chain remains
  authoritative for whether a credential was earned; the signature layer is
  defense-in-depth on top of it.
- **Gateway API keys.** [`gateway-key.md`](gateway-key.md).
- **Per-org issuer DIDs.** Designed, not built (#4, #6).

## Appendix — the unresolved HSM question

`ROADMAP.md` specifies an HSM-backed key; the deployed key is `SOFTWARE`
([#87](https://github.com/Andamio-Platform/credential-badges/issues/87)).
**Whether Cloud KMS supports `EC_SIGN_ED25519` at the HSM protection level cannot
be determined from public documentation** (checked 2026-07-28): the algorithms
reference, the Cloud HSM page, the protection-levels page, and the release note
introducing Ed25519 (2024-04-15) are all silent on the combination.

One weak signal: the REST reference annotates `EC_SIGN_SECP256K1_SHA256` with
*"This curve is only supported for HSM protection level"* — so it does carry
protection-level notes where restrictions exist, and `EC_SIGN_ED25519` carries
none. Absence of a note is not proof of support.

Settling it requires a create-time API probe, which is a **mutation** and must be
a deliberate decision:

```bash
gcloud kms keys create hsm-ed25519-probe \
  --keyring <SCRATCH_KEYRING> --location us-central1 \
  --purpose asymmetric-signing --default-algorithm ec-sign-ed25519 \
  --protection-level hsm --project <SCRATCH_PROJECT>
```

**Run this in a scratch project, never in `andamio-credentials`.** Cloud KMS key
rings and keys **cannot be deleted** — a failed probe leaves permanent clutter in
the production project's key hierarchy. If the combination is unsupported, the
API rejects the create and the answer costs nothing but a scratch project.

If it is unsupported, amend `ROADMAP.md` to state `SOFTWARE` with the reason,
rather than leaving an unmet HSM claim standing. If it is supported, the
migration is exactly this runbook.

## Related

- Compromise kill-switch: [`key-compromise.md`](key-compromise.md)
- DID generator: [`../../tools/gen-did-json.ts`](../../tools/gen-did-json.ts) · pin test [`../../tools/did-pin.test.ts`](../../tools/did-pin.test.ts)
- Key-version registry + status semantics: [`../../signing/status-list.ts`](../../signing/status-list.ts)
- Boot drift check: [`../../issuer-service/src/drift-check.ts`](../../issuer-service/src/drift-check.ts)
- Issuer service posture: [`../../issuer-service/README.md`](../../issuer-service/README.md)
- Deploy mechanics: [`../../DEPLOY.md`](../../DEPLOY.md)
- Decision 4 / drift-check design: [`../plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](../plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md)
