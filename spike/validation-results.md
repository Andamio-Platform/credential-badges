# Validation Results

End-to-end validation of `sample-credential.jsonld`.

## Summary

| Validator | Status | Notes |
|---|---|---|
| Local structural checks (Appendix A cheatsheet) | **PASS** (14/14) | Required OB 3.0 fields all populated. |
| JSON-LD context resolution + expansion (`jsonld` library) | **PASS** | Both W3C VC 2.0 and OB 3.0 v3.0.3 contexts publicly resolvable; document expands to a single normalized RDF node. |
| Local VC-JWT signature verification (`jose` + `did:key`) | **PASS** | Signature verifies against the issuer's `did:key` public key; `iss`/`sub`/`jti` claims match the document. |
| **IMS Global public Open Badges Validator** (`openbadgesvalidator.imsglobal.org`) | **FAIL — validator is OB 2.0 only** | The publicly hosted validator at this URL only validates Open Badges 2.0 assertions. It cannot interpret OB 3.0 / W3C VC 2.0 contexts. See "What didn't" below. |
| 1EdTech OB 3.0 Conformance Validator | **NOT RUN** | The OB 3.0 conformance test kit appears to live behind 1EdTech membership — public access not found in the time available. Documented as a follow-up. |
| W3C VC Test Suite | **NOT RUN** | The `vc-test-suite` is a Mocha-based runner; integrating it would have eaten the spike's remaining time. Documented as a follow-up. |

**Overall: PASS for the layers we can run unauthenticated. The signed document is well-formed OB 3.0, the contexts resolve, and the JWT signature verifies. The 1EdTech conformance step is gated on membership, which is the expected procurement path documented in Plan §4.**

## Layer 1 — Structural checks (PASS)

Verified by `src/validate.ts`. Each required field from Appendix A of the [plan](../2026-04-16-open-badge-3-integration-one-pager.md) is checked for presence and shape.

```
[PASS] field: @context: present
[PASS] field: id: present
[PASS] field: type: present
[PASS] field: issuer.id: present
[PASS] field: issuer.type: present
[PASS] field: validFrom: present
[PASS] field: name: present
[PASS] field: credentialSubject.id: present
[PASS] field: credentialSubject.type: present
[PASS] field: credentialSubject.achievement.id: present
[PASS] field: credentialSubject.achievement.type: present
[PASS] field: credentialSubject.achievement.name: present
[PASS] field: credentialSubject.achievement.description: present
[PASS] field: credentialSubject.achievement.criteria: present
```

## Layer 2 — JSON-LD expansion (PASS)

```
[PASS] json-ld expansion: expanded to 1 top-level node(s); 5013 chars
[PASS] json-ld: contexts resolvable:
       loaded https://www.w3.org/ns/credentials/v2
       loaded https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json
```

The `jsonld` library uses a remote document loader and successfully resolves both contexts over HTTPS, then expands the credential into a single normalized JSON-LD node graph. This catches malformed `@context` declarations, unknown terms, and conflicting type definitions — none triggered.

## Layer 3 — VC-JWT signature (PASS)

```
[PASS] jwt signature: alg=EdDSA
       kid=did:key:z6MksHZrZ6m838iDJ6wfBdNDiEdAeKXYDMW3sDWVpfZuMiBc#z6MksHZrZ6m838iDJ6wfBdNDiEdAeKXYDMW3sDWVpfZuMiBc
[PASS] jwt payload.vc matches document:
       payload.vc.id=urn:andamio:preprod:credential:76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742:6c796e78
```

`jose.jwtVerify` validates the EdDSA signature against the issuer's public JWK (recovered from the `did:key`), confirms the `iss` claim equals the issuer DID, the `sub` claim equals the credential subject ID, and that the `vc` claim payload matches the unsigned document byte-for-byte.

The compact JWS (`out/credential.jwt.txt`) is the conventional VC-JWT serialization that an OB 3.0 verifier would consume independently of the JSON-LD wrapper.

## Layer 4 — IMS Global public validator (FAIL — wrong validator)

Submitted both the JSON-LD document and the bare JWT to `https://openbadgesvalidator.imsglobal.org/results` via POST. Both forms returned `valid: false`.

The page title and response confirm this validator is **Open Badges 2.0 only**:

```
<title>IMS Global Open Badges 2.0 Validator</title>
<h1>IMS Global Open Badges 2.0 Validator</h1>
```

The error from the JSON-LD submission is a `pyld.jsonld.JsonLdError: Invalid JSON-LD syntax; @context property values must be strings or objects` — this happens because the validator's pinned `pyld` cache pre-dates the W3C VC 2.0 context's nested `@context` term definitions. The validator is not the right tool; this is not a problem with our document.

The error from the JWT submission is `<class 'TypeError'> [TypeError: object of type 'NoneType' has no len()]` — the validator can't decode a `vc+jwt` envelope at all.

Raw response saved at `out/1edtech-validator-response.html` (75 lines).

**Conclusion**: openbadgesvalidator.imsglobal.org is not the correct validator for OB 3.0. The 1EdTech conformance test suite (used for certification per Plan §4) is the right tool, but it is gated by membership — which we cannot create in a spike. **This is the expected outcome and matches the plan.**

## Layer 5 — 1EdTech OB 3.0 Conformance Validator (NOT RUN)

The OB 3.0 spec ([imsglobal.org/spec/ob/v3p0/cert/](https://www.imsglobal.org/spec/ob/v3p0/cert/)) describes a conformance suite. From a brief review:

- The conformance documentation is public.
- The test platform itself appears to require 1EdTech membership credentials.
- Per task constraints, we did not create accounts.

**Action item**: route to Sebastian (per Plan §5 team table) for membership cost + access to the conformance kit. He'll need a fresh credential generated against whatever the kit's input format is — `npm run generate` will produce one on demand.

## Layer 6 — W3C VC Test Suite (NOT RUN)

The W3C maintains [vc-test-suite-data-model](https://github.com/w3c/vc-test-suite-data-model) as the canonical conformance suite for VC 2.0. It runs as a Mocha-based test harness against an HTTP endpoint that returns a verifiable credential — i.e., the credential service must be running.

For this spike, integrating vc-test-suite would have required:
1. Standing up an HTTP server that returns the credential.
2. Configuring the test suite's issuer config.
3. Running ~150 tests, most of which exercise functionality (revocation, refresh, presentations) we deliberately scoped out.

Documented as a follow-up — appropriate for Phase 2 once the credential service ships.

## Reproducing

```bash
cd <the ob3-prototype spike directory>
npm install && npm run build
npm run generate                        # produces sample-credential.jsonld + out/*
npm run validate                        # writes out/automated-results.md

# Optional re-run of the IMS public validator (returns OB 2.0 errors as documented):
JSONLD=$(cat sample-credential.jsonld)
curl -s -X POST --data-urlencode "data=$JSONLD" \
  "https://openbadgesvalidator.imsglobal.org/results" \
  > out/1edtech-validator-response.html
```

## What this validates and what it doesn't

**Validates**:
- The Andamio credential model can be losslessly serialized into a well-formed OB 3.0 document.
- Both required contexts load over HTTPS and the document expands to RDF without errors.
- An EdDSA / Ed25519 / `did:key` issuer signs and verifies as VC-JWT.
- The mapping in `src/mapper.ts` is reproducible.

**Does NOT validate**:
- 1EdTech conformance certification — requires their hosted test kit (membership-gated).
- Linked Data Proof (LDP) variant — we shipped JWT only. LDP is a Phase 2 follow-up.
- A real `credential_claim` transaction was minted on preprod — none has been claimed under any course we have credentials for. The mapping is faithful to the documented protocol; verifying against a real claimed credential is a follow-up once Cardano XP feedback course (or another preprod course) sees its first claim.
- Revocation — no `credentialStatus` populated; deferred per Plan §2.4.
