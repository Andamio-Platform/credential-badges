# Runbook — signing and baking class artifacts

Produces the **Class Achievement** for every registered badge: a signed,
holder-free credential describing what a badge means, baked into the shared
badge SVG. This is the release procedure for the class-artifact half of
[the fully-baked-badges plan](../plans/2026-07-28-004-feat-fully-baked-badges-plan.md).

Not to be confused with the per-holder path. A **Holder Artifact** asserts that
a named person earned a badge and is produced by the sweep; a Class Achievement
names nobody. See `CONCEPTS.md`.

> **The single-artifact gate is the point of this procedure.** The identityless
> shape is schema-conformant on paper, but that is not the same claim as "the
> reference validator accepts it". Sign **one**, validate it, and only then sign
> the rest. A failed validation after 58 signatures and a full bake is expensive
> to unwind; after one, it costs nothing.

## Preconditions

| | |
|---|---|
| KMS sign access | The key's only IAM binding is the sign SA; `james@andamio.io` reaches it via `roles/owner`. Confirm with a read: `gcloud kms keys versions get-public-key 1 --key vc-sign-ed25519 --keyring credential-badges-issuer --location us-central1 --project andamio-credentials` |
| Live artifacts resolve | `did.json`, `/issuer`, `/context/v1.jsonld`, and the key-epoch status list must all be serving — the signer verifies against them and the validator dereferences them |
| Working tree | Clean, on a feature branch. Baking rewrites committed badge SVGs |

**Every KMS run writes a transcript.** `docs/runbooks/key-compromise.md` treats
an `asymmetric-sign` entry not attributable to a transcribed run as a compromise
trigger. The tooling writes one automatically; do not bypass it, and do not
sign by hand.

## Phase 1 — Dry run (no KMS)

```bash
cd spike/signer-spike
npm run sign:class -- --signer local --badge <courseId>.<sltHash>
```

**Verify:** ends `DRY RUN SIGN + LOOPBACK VERIFY OK`. Output lands in
`spike/signer-spike/out/` — gitignored, so a dry-run artifact cannot be
committed. It carries a `did:example` issuer and the bake step refuses it by
design.

This proves the build → sign → verify path without spending a signature.

## Phase 2 — Sign exactly one, for real

```bash
npm run sign:class -- --signer kms --badge <courseId>.<sltHash>
```

Clears the context cache, asserts the KMS key is pinned to the live DID, signs,
loopback-verifies against the **live** status list, and asserts the signer seam
was invoked exactly once for that artifact.

**Verify:** `KMS SIGN + VERIFY OK`, and the transcript exists under
`spike/signer-spike/transcripts/`. Artifact lands in
`spike/signer-spike/class-artifacts/`.

## Phase 3 — Validate the shape externally

**No hosting required.** The validator accepts a direct multipart upload, so a
shape can be checked before anything is published. (The Phase 0 spike used the
URI form, which meant publishing first; the upload form is strictly better for a
pre-release gate.) Everything the validator dereferences from inside the
credential — the DID document, issuer Profile, signing context, key-epoch status
list — already resolves live.

```bash
npm run validate:1edtech -- class-artifacts/<badgeId>.json
```

**Pass criterion:** `VALID`, **0 errors and 0 warnings** — the Phase 0 bar
(`spike/verifier-spike/results/onedtech.md`), not merely "no errors".

If it fails, stop. Do not batch-sign. The response is saved under
`spike/signer-spike/out/validation/`.

**This gate has already caught one refuted design decision.** The first shape
omitted `credentialSubject.id` — the identityless form the OB 3.0 implementation
guide recommends and the published schema permits — and the validator errored
with `no id in credentialSubject` (CredentialSubjectProbe). The guide and the
validator disagree; the validator wins. Evidence and the fix are in
[`../../spike/signer-spike/validation/README.md`](../../spike/signer-spike/validation/README.md).
Treat "the spec says this is fine" as a hypothesis this gate tests, not a
reason to skip it.

## Phase 4 — Sign the rest, then bake

```bash
npm run sign:class -- --signer kms --all
npm run bake:class -- --all
```

Baking refuses three things, each guarding a mistake that is hard to spot later:
a dry-run artifact (wrong issuer), an artifact whose id does not match the badge
it is going into, and any artifact with no proof. Round-trip is re-verified from
disk after every write.

**Verify, before committing anything:**

```bash
node --experimental-strip-types --test tools/bake-signed-vc.test.ts
python3 generator/tests/test_render_parity.py
python3 generator/tests/test_bake.py
```

Render parity compares baked badges modulo the credential block, so it should
stay green across the bake.

## Phase 5 — Ship

Commit the badges and the class artifacts together — the artifact is the
evidence for what is baked into the badge, and splitting them makes the pair
unverifiable at a later commit.

Then tag to deploy the static host. Tag naming: the repo went `v1.0.9` →
`v1.2.0`, so **`v1.1` was never cut** and is a roadmap phase name, not a
release. The next static-host release is `v1.3.0`.

**Verify live:** fetch a badge, extract its credential, and re-run the validator
against the deployed URL.

## If a key rotates or is suspended

Class artifacts are signed under the key epoch and carry a `credentialStatus`
entry, so a kill-switch flip covers them (plan KTD-6). Rotation means re-signing
and re-committing all of them — see
[`issuer-provisioning.md`](issuer-provisioning.md) for the order, and
[`key-compromise.md`](key-compromise.md) for the destructive path.

## Related

- Plan: [`../plans/2026-07-28-004-feat-fully-baked-badges-plan.md`](../plans/2026-07-28-004-feat-fully-baked-badges-plan.md)
- Requirements: [`../brainstorms/2026-07-28-fully-baked-badges-requirements.md`](../brainstorms/2026-07-28-fully-baked-badges-requirements.md)
- Prior verifier evidence: [`../../spike/verifier-spike/results/onedtech.md`](../../spike/verifier-spike/results/onedtech.md)
- Vocabulary: [`../../CONCEPTS.md`](../../CONCEPTS.md)
