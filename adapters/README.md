# adapters: evidence adapters and the source-neutral credential core

This package is the first step in extracting a reusable credential layer from
the Andamio-specific implementation. It adds code beside the existing code and
changes no production path. **Nothing here is wired into the issuer service
or the signing CLI yet.**

| Path | What it is |
|---|---|
| `core/types.ts` | The contract: `EvidenceAdapter`, `TrustAssertion`, `EvidenceItem`, `IssuerProfile`, `AdapterRefusal`. |
| `core/assemble.ts` | `assembleCredential(assertion, issuer)`: a source-neutral assertion becomes an unsigned OB 3.0 `OpenBadgeCredential`. It validates the assertion and refuses it rather than repairing it. |
| `cardano-andamio/` | **Reference adapter.** `resolve()` is the existing anchor gate (`issuer-service/src/anchor.ts`), called unchanged. `assertionFromAnchor()` normalizes its output. `issuer-profile.ts` is Andamio's deployment profile. |
| `reference-signed-attestation/` | **Second adapter, non-ledger.** It verifies an Ed25519-signed attestation from a registered source (a training system, an HR workflow) and uses only OB 3.0 evidence terms, so it needs no new vocabulary. |
| `test/` | Hermetic tests, using node builtins only. |

## The equivalence guarantee

`test/cardano-andamio.test.ts` runs the **real** anchor gate against the issuer
service's recorded Andamioscan fixtures and asserts:

```
assembleCredential(cardanoAndamio.resolve(subject), ANDAMIO_ISSUER)
  == mapCredential(anchor)                                     // the production mapper
  == signing/signed-credential.json without its proof          // what was actually signed
```

If anyone changes the issuer profile, the mapper, or the adapter so that they
disagree, this test fails. Switching the issuer service to this path later
(the extraction plan's step 4) therefore cannot silently change a signed
credential for the reference subject. The `expansion-pin` CI job remains the
authority on canonical form.

## Running the tests

```bash
node --experimental-strip-types --test adapters/test/*.test.ts
```

No `npm install` is needed. The package is dependency-free by design, like
`tools/`, so it runs in the hermetic CI job. **Keep it that way:** importing
an npm package here, or adding one to any `issuer-service/src` module this
package imports (`anchor.ts`, `slt-hash.ts`, `config.ts`, `map-credential.ts`,
`status-list.ts`), breaks the job in CI while still passing locally wherever
`node_modules/` exists.

## What the second adapter shows, and what it does not

It shows that the credential-facing surface does not change when the trust
source does. The same core assembles a credential with the same top-level
shape from a non-ledger source, under a different issuer DID, with or without
a status list.

It does **not** yet show:

- a signed credential from this path that passed the external reference
  validator (the [Validation Gate](../CONCEPTS.md#validation-gate) must run
  before any batch);
- a second **ledger** adapter, which is the stronger demonstration and best
  built by an outside contributor;
- a deployed issuer using it.

## Adding an adapter

Follow the rules in the evidence-adapter contract (fail closed, re-derive
rather than trust input, deterministic output, pseudonymous subjects, every term
defined, hermetic and refusal tests). Put it in its own directory here,
add its tests under `test/`, and they run in CI automatically.
