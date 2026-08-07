# 1EdTech digital-credentials-public-validator — Rung 6 result

**Verifier:** 1EdTech Member Validator (community deployment at verifybadge.org,
running `1EdTech/digital-credentials-public-validator`)
**Endpoint:** `POST https://verifybadge.org/api/validate` (multipart part `file`)
**Sample:** `spike/signer-spike/signed-credential.json` (KMS-signed production credential)
**Run:** 2026-07-21T17:25Z · full response: `1edtech-full.json`

## Command

```
curl -X POST "https://verifybadge.org/api/validate?validatorId=OB30Inspector&other=" \
  -F "file=@signed-credential.json;type=application/json"
```

(Headless file-upload form discovered this run; rung 1 used `/api/validateuri`,
which requires the credential at a public URL.)

## Result

| metric | value |
|--------|-------|
| `outcome` | ERROR |
| `fatals` | 0 |
| `errors` | **1** |
| `warnings` | 0 |
| `exceptions` | 0 |
| `notRun` | 0 |
| `totalRun` | 13 |

12 of 13 probes pass — including OB3 schema/spec conformance, the
`["OnChainCredentialAnchor", "Evidence"]` evidence entry, and context
validation. The single error, from `EmbeddedProofProbe`:

> Key document not found at did:web:credentials.andamio.io#key-2026-07.
> URI: https://credentials.andamio.io/did.json doesn't return a valid document.

## Arbitration (deployment-plan rule: specs are the tiebreaker)

The validator resolves the **bare-domain** did:web
`did:web:credentials.andamio.io` at `https://credentials.andamio.io/did.json`.
The did:web method spec (section Read/Resolve) maps a bare-domain DID to
`https://<domain>/.well-known/did.json` — which is live and serves the correct
key document (HTTP 200, pins KMS key version 1; spruce resolves it and reaches
VALID). `https://credentials.andamio.io/did.json` is 404 by design (the nginx
allowlist serves the spec-correct path only).

Verdict: **verifier resolver deviation, not a credential defect.** Rung 1 did
not hit this because the throwaway host used a path-form did:web, for which the
spec and the validator agree on `<path>/did.json`.

## Follow-ups

1. **Rung 8 mitigation (recommended):** also serve `/did.json` as an alias of
   `/.well-known/did.json` on the static host — a spec-compatible superset that
   turns this validator green with zero credential changes.
2. Optionally report the resolver deviation upstream to
   `1EdTech/digital-credentials-public-validator`.
3. Re-run this validator after the alias ships; expected outcome then is
   VALID / errors=0 (all other 12 probes already pass on the credential bytes).
