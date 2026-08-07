# CORNERS CUT — OB 3.0 demo signing

What we shortcut to get the **first** working signed credential through the
official 1EdTech verifier for the team demo (2026-05-15). Posture: see the
basic thing work, harden as we go. Each item names what hardens it — most map
to `credential-badges` #3–#8.

| # | Corner cut | Why it's OK for the demo | Risk if shipped as-is | Hardens via |
|---|---|---|---|---|
| 1 | **Throwaway Ed25519 key** (`out/issuer-multikey.json`, gitignored). Not an org key; anyone with the file can forge. | Demo only; no real trust placed in it. | Forgeable; key lost on `out/` wipe → all sigs unverifiable. | Managed signing + `did:web` — cred-badges #3, #5 |
| 2 | **`issuer.id` rewritten** to the throwaway `did:key` so the proof's verificationMethod resolves. The credential now *claims* an issuer whose `name` says "Cardano XP" but whose `id` is a random demo key. | 1EdTech only checks the key binds; samples already framed "throwaway issuer". | Identity/display mismatch; not the real issuing authority (which on-chain is the policy ID). | Issuer-identity decision — cred-badges #3 (+ #6) |
| 3 | **Permissive custom document loader** with a hand-maintained URL allowlist + naive on-disk cache (`out/ctx-cache/`). did:key resolved by local construction, not a real DID resolver. | Deterministic, offline-after-first-fetch, enough to sign+verify. | Not a real resolver; allowlist drift; cache never invalidated. | Production resolver alongside #5 |
| 4 | **Samples signed in place.** The proof covers the canonicalized doc; any later edit/re-render of the `.jsonld` invalidates it. | Pipeline is run-ordered by hand. | Silent invalidation if someone edits a signed sample. | Build pipeline that signs last + CI proof check |
| 5 | **Sign/verify depend on `credentials.andamio.io` being reachable** (the live `@context` must resolve for RDF canonicalization). | Context is deployed and stable. | If the host is down, signing AND verification fail. | Context perm/mirror already in andamio-ops; pin/cache strategy TBD |
| 6 | **No `credentialStatus` / revocation.** | 1EdTech passes without it; out of demo scope. | No revocation story for real credentials. | Status-list design (post-demo) |
| 7 | **Round-trip verify uses our own loader/did:key resolver.** Proves cryptographic integrity, not that a *strict third-party* resolver accepts a did:key issuer. | 1EdTech (external, strict) is the real check and is run manually each iteration. | Local "verified: YES" ≠ universal acceptance. | did:web issuer (resolves everywhere) — #5 |
| 8 | **Ambient TS shims** for untyped `@digitalbazaar/*` + `jsonld-signatures` (`src/jsonld.d.ts`). | Compiles; runtime is the real test. | No type safety on the signing path. | Typed wrappers if this graduates from spike |

## Pipeline ordering (until #4 is hardened)

Signing must be the **last** mutation of a `*-real.jsonld`:

```
edit sample → npm run build → npm run sign-di → npm run verify (chain, 7/0) → npm run render
```

`npm run verify` and `npm run render` do **not** mutate the `.jsonld`, so they
are safe after signing. Anything that rewrites the sample (re-running the Path
B builder, hand edits) requires re-running `npm run sign-di`.

## Current state (2026-05-15)

Both `*-real.jsonld` samples: `DataIntegrityProof` / `eddsa-rdfc-2022`,
round-trip verified, chain 7/0, issuer profile live. Expected at
`vc.1ed.tech/validate`: **0 errors, 0 warnings** (was 1 error / 1 warning).
