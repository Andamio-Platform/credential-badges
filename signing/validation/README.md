# Class-artifact validation — 1EdTech OB30Inspector

Evidence that the **Class Achievement** shape is accepted by the OB 3.0
reference validator. Same verifier and pass criterion as the Phase 0 holder
credential (`spike/verifier-spike/results/onedtech.md`): **VALID with 0 errors
AND 0 warnings**, not merely "no errors".

**Verifier:** 1EdTech Member Validator, `OB30Inspector`, at `verifybadge.org`
**Date:** 2026-07-28
**Subject:** `203e63f457e0…77547ab066d5…` — "I can find a bug in the Cardano XP app." (Join Cardano XP)
**Signed by:** `did:web:credentials.andamio.io#key-2026-07` (production KMS)

## Invocation

The credential is uploaded directly — **no hosting required**:

```bash
curl -X POST "https://verifybadge.org/api/validate?validatorId=OB30Inspector" \
  -F "file=@<artifact>.json"
```

This supersedes the URI form used in Phase 0
(`POST /api/validateuri?uri=…`), which required the credential to be publicly
fetchable first. The multipart form takes the bytes directly, so a shape can be
validated before anything is published. Note the URI form's content-type quirk
does not apply here; `-F` sets multipart automatically, and passing
`Content-Type: application/json` is rejected outright.

## Pass 1 — ERROR (`1edtech-class-artifact-pass1.json`)

| metric | value |
|--------|-------|
| outcome | **ERROR** |
| errors | 1 |
| warnings | 0 |
| totalRun | 13 |

```
ERROR  "no id in credentialSubject"  — CredentialSubjectProbe
```

**The finding.** The artifact used the *identityless* shape: `credentialSubject`
with no `id`. That is what the OB 3.0 implementation guide explicitly recommends
for badges delivered by URL sharing and download, and the published JSON schema
permits it outright — `AchievementSubject` requires only `type` and
`achievement`.

The reference validator rejects it anyway. **The guide and the validator
disagree**, and the validator is what the ecosystem runs.

Twelve of thirteen probes passed, including issuer resolution, `did:web`, the
`eddsa-rdfc-2022` Data Integrity proof, the key-epoch status list, and the
evidence shape. This was the only failure.

## Pass 2 — VALID (`1edtech-class-artifact-pass2.json`)

| metric | value |
|--------|-------|
| outcome | **VALID** |
| errors | 0 |
| warnings | 0 |
| fatals | 0 |
| exceptions | 0 |
| notRun | 0 |
| totalRun | 13 |

**The fix.** `credentialSubject.id` is the achievement's own URN
(`urn:andamio:course:<courseId>:<sltHash>`) — the subject is the *thing being
defined*, never a person. No holder identifier appears anywhere in the artifact.

The fix was isolated cheaply before spending a second signature: the id was
injected into the already-signed pass-1 artifact and re-validated. The
`CredentialSubjectProbe` error disappeared and only `EmbeddedProofProbe`
remained — the expected consequence of mutating signed bytes — which confirmed
the subject id was the sole cause.

## Why this matters beyond one badge

This is the gate the class-artifact release turns on. Validating **one** artifact
rather than batching found a refuted design decision for the cost of a single
KMS signature, instead of 58 signatures plus a full bake that would then have
needed unwinding.

The residual semantic wrinkle is recorded rather than hidden: an
`AchievementSubject` whose `id` is the achievement reads slightly circularly. It
remains the most honest option available, because omitting the id means "an
earner we cannot name" — a claim about a person that a definition should not
make.

## Related

- Procedure: [`../../../docs/runbooks/class-artifact-signing.md`](../../../docs/runbooks/class-artifact-signing.md)
- Phase 0 holder-credential evidence: [`../../verifier-spike/results/onedtech.md`](../../verifier-spike/results/onedtech.md)
- Builder: [`../class-credential.ts`](../class-credential.ts)
