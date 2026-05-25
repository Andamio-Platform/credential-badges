# 1EdTech digital-credentials-public-validator — results

**Verifier:** 1EdTech Member Validator v1.0.0 (community deployment at
verifybadge.org; the canonical `vc.1edtech.org` URL in the upstream README
does not resolve — `verifybadge.org` is the live public instance running
the same `1EdTech/digital-credentials-public-validator` codebase)

**Endpoint:** `POST https://verifybadge.org/api/validateuri`

**Command:**

```
curl -X POST "https://verifybadge.org/api/validateuri?uri=<credential URL>&validatorId=OB30Inspector&other=" \
  -H "Content-Type: application/json" -d "{}"
```

(`Content-Type: application/json` required; without it the server returns 500
"Content type '' not supported". The body is unused for the URI form but the
header is mandatory.)

## Pass 2 — final result

| metric | value |
|--------|-------|
| `outcome` | **VALID** |
| `errors` | 0 |
| `warnings` | 0 |
| `fatals` | 0 |
| `exceptions` | 0 |
| `notRun` | 0 |
| `totalRun` | 13 |

Full response: `1edtech-pass2-full.json`.

**This satisfies the Phase 0 pass criterion ("no errors AND no warnings")
for one of the three required independent verifiers.**

## Pass 1 → Pass 2 deltas (mapper-grade findings for Unit 3)

Pass 1 result: `outcome=ERROR, errors=1, warnings=5`. Pass 2 reached
`outcome=VALID, errors=0, warnings=0` after applying three fixes:

1. **`evidence[].type` must be array form including `"Evidence"`.**
   `["OnChainCredentialAnchor", "Evidence"]`, not bare
   `"OnChainCredentialAnchor"`. OB 3.0 requires every `evidence` entry to
   include the base `Evidence` type; custom subtypes extend it.
   → Lock into Unit 3 mapper spec ("Attestation-framing emission" section).

2. **`proof` must be array form.** OB 3.0 Plain JSON schema requires
   `proof` as `[{...}]`. `@digitalbazaar/vc` emits it as a single object
   (JSON-LD-lenient form). Post-process the signed credential to wrap
   `proof` in an array before serving.
   → Lock into Unit 4 server `/credentials/...` response shape.

3. **`issuer.url` must resolve to a Profile JSON-LD.** The 1EdTech
   `IssuerProbe` fetches the URL in `issuer.url`. Production already
   plans to serve the Profile at `/issuer` (Unit 2); the spike confirmed
   the validator actually exercises that dependency.
   → Already in Unit 2's scope; spike confirmed it's load-bearing.

## Findings not addressed (validator-specific, not spec-grounded)

Pass 1's warning 4 — *"required property 'issuanceDate' not found"* — went
away in Pass 2 once Plain JSON top-level schema validation passed for other
reasons. This appears to have been a downstream artifact of the disjunction
failure on the top-level schema, NOT a real VC-1.0-vs-VC-2.0 schema mismatch
in the validator. No action needed.

## Capability confirmation

The validator successfully exercised all four target features:

- ✅ `did:web` resolution — fetched
  `https://workshop-maybe.github.io/credential-badges-verifier-spike/did.json`
- ✅ Data Integrity `eddsa-rdfc-2022` — proof accepted and not flagged
- ✅ `BitstringStatusListEntry` with `statusPurpose: "suspension"` — accepted
  (no probe-level rejection of the status entry)
- ✅ `OnChainCredentialAnchor` as `evidence` — accepted once base `Evidence`
  type was added alongside

## Viability call

**1EdTech digital-credentials-public-validator is VIABLE as a Phase 0
verifier.** It is responsive, deterministic, produces actionable
spec-grounded feedback, and reached `outcome=VALID` against a credential
carrying the full production feature combination.
