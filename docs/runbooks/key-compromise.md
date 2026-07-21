# Runbook — signing-key compromise kill-switch (did:web issuer)

The production signing key (`did:web:credentials.andamio.io#key-2026-07`) signs
every OB3 credential and the key-epoch status list. This runbook is the
response to a suspected compromise of that key: suspend everything it signed
(fast, reversible), then remove it from the DID document and replace it
(destructive, permanent). It is the deployment plan's hard precondition for
production signing — the kill-switch must exist before the key signs at scale.

**Flip on suspicion.** `statusPurpose: "suspension"` is the W3C reversible
purpose; a false alarm is undone by the same tool ([stand-down](#false-alarm-stand-down)).
Waiting for certainty is the expensive mistake.

## What the kill-switch touches

| Fact | Value |
|---|---|
| Signing key | KMS `vc-sign-ed25519` version 1, keyring `credential-badges-issuer`, `us-central1`, project `andamio-credentials` |
| Published as | `#key-2026-07` in `.well-known/did.json` (+ `/did.json` alias) — `Cache-Control: public, max-age=3600` |
| Status list | `status/key-epoch-2026-07.json`, served at `/status/key-epoch-2026-07.json` — `max-age=3600`; **bit 0 = key-2026-07** (one bit per key version, positions 0–63) |
| Flip tool | `tools/flip-status-bit.ts` — prepares the flipped unsigned payload; **never signs** |
| Suspension state in code | `SUSPENDED_KEY_VERSION_POSITIONS` in `spike/signer-spike/status-list.ts` — builder + CI read it; the served list can never silently disagree |
| Hardened re-sign | `spike/signer-spike` → `npm run sign:status` (cache clear → live anchor gate → live-DID key pin → exactly one KMS call → atomic write) |
| Stale-proof guard | `COMMITTED_STATUS_FILE_SHA256` pin in `spike/signer-spike/status-list.test.ts` — update on every legitimate re-sign |
| Deploy | `git tag vX.Y.Z && git push origin vX.Y.Z` — the only deploy path (WIF ref-constrained to `refs/tags/v*`) |
| KMS sign access | **James direct-only today** (personal gcloud). When the issuer service ships, the dedicated sign SA (deployment plan Decision 5) joins; a service compromise then also triggers this runbook |
| Key-version creation | Terraform in `andamio-ops` (`terraform/credentials/`) — same infra source of truth as the [gateway keys](gateway-key.md) |

## Trigger criteria

Any of these counts as suspected compromise. One is enough.

- A KMS Cloud Audit Log `asymmetric-sign` entry not attributable to a known,
  transcribed run (every legitimate KMS call in this repo lands in
  `spike/signer-spike/transcripts/`; the count per rung is documented in the
  merging PR).
- A signed credential or status list surfaces in the wild that verifies under
  `#key-2026-07` but is not the committed `signed-credential.json` or
  `status/key-epoch-2026-07.json`.
- Compromise of any identity holding `cloudkms.signerVerifier` on the key
  (today: James's account; later: the sign SA or its WIF trust chain).
- An unexpected IAM change on the `credential-badges-issuer` keyring or the
  `andamio-credentials` project.

## What flipping bit 0 does — and does not

**Does:** every credential signed under `key-2026-07` reads as **suspended**
in status-honoring verifiers — there is exactly one bit for the whole epoch,
by design. Today that population includes the flagship badge:
`https://credentials.andamio.io/badges/ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db.svg`
(the baked `signed-credential.json`, `statusListIndex: "0"`). Flipping the bit
knowingly suspends the flagship credential. That is the intended cost;
re-issuance under the replacement key restores it ([Phase 4](#phase-4--re-issuance-under-the-replacement-key)).

**Does not:**
- Stop a forger who **omits** `credentialStatus` from a forged credential —
  status is a convenience signal a forger controls in their own artifact. The
  DID-method removal ([Phase 3](#phase-3--did-document-response)) is what kills
  forged signatures for every verifier; the flip is the fast signal for the
  legitimate population.
- Make the flipped list self-authenticating: the status list itself is signed
  under the compromised key, so post-compromise its own proof proves nothing
  (an attacker holding the key can sign a clean-looking list). Phase 3
  re-signs the flipped list under the replacement key.
- Touch the chain. On-chain anchors are unaffected and remain authoritative
  ([scope](#what-this-runbook-does-not-cover)).

## Phase 1 — Immediate containment (status-bit flip)

Target: **~40 minutes** from decision to the flipped list being served, plus
the **3600 s status-cache window** (`max-age=3600`) before every warm verifier
cache has expired — plan on all status-honoring verifiers seeing *suspended*
within **~1 h 40 m** end to end.

1. Prepare the flip (~5 min). The tool derives the unsigned payload from the
   committed list — one bit flipped, everything else byte-stable — and prints
   the exact next commands. It does not sign and touches no network:
   ```bash
   node --experimental-strip-types tools/flip-status-bit.ts \
     key-epoch-2026-07 0 compromised-key > /tmp/flipped-review.json
   ```
   **Verify:** stderr reports `bit 0 (key-2026-07): 0 -> 1 (SUSPENDED)` and the
   sha256 of the committed input; review the stdout payload — only
   `encodedList` differs from the committed file, and `proof` is stripped.
2. Record the flip in code, per the tool's output:
   `spike/signer-spike/status-list.ts` →
   `SUSPENDED_KEY_VERSION_POSITIONS = [0]`.
3. Re-sign through the hardened path (~5 min; requires KMS sign access —
   James):
   ```bash
   cd spike/signer-spike && npm run sign:status
   ```
   **Verify:** output ends `KMS SIGN + LIVE-DID VERIFY OK` with
   `KMS asymmetric-sign calls: 1`; `status/key-epoch-2026-07.json` now decodes
   with bit 0 = 1.
4. Update the sha pin: `shasum -a 256 status/key-epoch-2026-07.json` →
   `COMMITTED_STATUS_FILE_SHA256` in `spike/signer-spike/status-list.test.ts`.
5. Prove coherence, ship (~25 min for CI + deploy):
   ```bash
   node --experimental-strip-types --test spike/signer-spike/*.test.ts tools/*.test.ts
   ```
   Commit the constant + re-signed list + sha pin together, push a branch,
   open a PR (CODEOWNERS gates `/status/**` and the flip tool), merge, then:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
   **Verify:** deploy workflow green;
   `curl -sI https://credentials.andamio.io/status/key-epoch-2026-07.json`
   returns 200 `application/ld+json`.
6. Optional but recommended (deployment plan P1bis-03): publish an incident
   note alongside the flip PR so verifiers who see *suspended* have a
   human-readable why.

## Phase 2 — Cross-verifier read of the flipped list (REQUIRED)

The bitstring's MSB-first bit-order has **never been exercised by a production
flip** — it is unfalsifiable until a bit actually flips (PR #59 residual
risk). A bit-order bug would suspend the wrong position and leave bit 0
fresh while every local test passes. **Do not rely on propagation until both
directions below pass against the LIVE list.**

1. Independent decode of the live list — deliberately not via
   `status-list.ts` (the code that wrote the bit must not be its own witness):
   ```bash
   curl -s https://credentials.andamio.io/status/key-epoch-2026-07.json | node -e '
     let d = "";
     process.stdin.on("data", (c) => (d += c)).on("end", () => {
       const el = JSON.parse(d).credentialSubject.encodedList;
       if (!el.startsWith("u")) throw new Error("not multibase-u");
       const bits = require("node:zlib").gunzipSync(Buffer.from(el.slice(1), "base64url"));
       console.log("bit 0 =", bits[0] & 0x80 ? "1 (SUSPENDED)" : "0 (fresh)");
     });'
   ```
   **Verify:** prints `bit 0 = 1 (SUSPENDED)`.
2. A status-honoring verifier reports the **subject credential** suspended:
   ```bash
   cd spike/signer-spike && npm run verify -- --status live
   ```
   **Verify:** the loopback now **fails** with
   `credential SUSPENDED at statusListIndex 0` — success here means the flip
   propagated through a real `credentialStatus` evaluation. Re-run the
   independent verifier set (spruce on the live list; 1EdTech OB30Inspector on
   the extracted flagship credential, per
   `spike/signer-spike/transcripts/`) and confirm at least one third-party
   verifier surfaces the suspension.
3. Remember the cache tail: a verifier that fetched the list up to an hour
   before deploy may still hold the fresh list until `max-age=3600` expires.
   Re-check after the window before treating a stale read as a defect.

## Phase 3 — DID-document response

Rotation is normally **additive** — old verification methods stay published so
old credentials keep verifying. Compromise is the one case where removal is
correct: deleting `#key-2026-07` from `did.json` intentionally breaks
signature verification for **everything** it signed, forged or legitimate
(deployment plan: "removing a verification method is reserved for the
compromise kill-switch"). The flip (Phase 1) is the fast reversible signal;
this is the permanent kill. `did.json` carries `max-age=3600`, so removal
propagates within the same one-hour window.

1. Create the replacement KMS key version — `andamio-ops` Terraform
   (`terraform/credentials/`), same keyring, `EC_SIGN_ED25519`, no automatic
   rotation. **Never reuse version 1.**
2. Update the generator + registry (one PR — these move together):
   - `tools/gen-did-json.ts`: it currently emits a single-key document pinned
     to KMS version 1 (`KEY_FRAGMENT = "key-2026-07"`, `KMS_GET_PUBKEY_ARGS`
     version `"1"`). Point it at the new version with a new dated fragment
     (`#key-YYYY-MM`), **omitting the compromised method** from both
     `verificationMethod` and `assertionMethod`.
   - `spike/signer-spike/status-list.ts`: add the new key version to
     `KEY_VERSION_POSITIONS` (next free position, e.g. `"key-YYYY-MM": 1`) and
     move `ACTIVE_KEY_VERSION` to it. Stand up the new epoch's list file
     `status/key-epoch-YYYY-MM.json` (all zeros; new credentials'
     `statusListEntry` points there). The nginx `^~ /status/` location serves
     any new file in the tree with the right headers automatically.
   - Regenerate `.well-known/did.json` via the gen tool and update the
     `tools/did-pin.test.ts` pin.
3. Re-sign the **flipped old-epoch list** under the replacement key. The
   compromised key's signature on the suspension list is worthless
   post-compromise; the list must verify under a surviving DID method. (The
   list's `issuer` is the DID, not the fragment, so a new
   `proof.verificationMethod` is valid without changing the document.)
4. Deploy (tag) and verify: `curl -s https://credentials.andamio.io/did.json`
   no longer contains `#key-2026-07`; a verifier run against the flagship
   credential now **fails DID resolution of its verification method** — that
   failure is the kill-switch working.
5. **Flush and redeploy the issuer-service instances.** Every rotation
   (routine or compromise) requires it: the issuer's drift check — live
   did.json pin, committed context, status list, active-key freshness — runs
   **only at boot**, so a running instance keeps signing against its
   boot-pinned view (old key, old status list, warm signed-artifact cache)
   until its container is replaced.

## Phase 4 — Re-issuance under the replacement key

Every legitimate credential signed under the compromised key stays suspended
until re-issued. Today that is the flagship credential; at scale it is every
credential in the epoch.

1. Re-sign each affected credential through the hardened subject path
   (`spike/signer-spike` → `npm run sign:kms`) — the anchor gate re-proves
   each credential against the chain before the new key touches it, so a
   forged credential cannot ride the re-issuance wave.
2. Re-bake baked badges:
   `node --experimental-strip-types tools/bake-signed-vc.ts bake <badge.svg> <signed-vc.json> <out.svg>`,
   then confirm round-trip byte-identity (`extract` sha256 = artifact sha256).
3. Re-run the launch verifier set on the re-issued artifact: spruce + 1EdTech
   green, loopback `verified: YES` (now against the new epoch's list).
4. Update the committed pins (signed-credential expectations, baked-badge
   invariants, sha pins) in the same PR; tag deploy.

## Who does what

| Actor | Responsibility |
|---|---|
| James | Declares the trigger; runs Phases 1–2 end to end (sole holder of KMS sign + merge + tag rights today); decision authority for the flip and for stand-down |
| `andamio-ops` (Terraform) | New KMS key version (Phase 3.1); IAM changes; audit-log retention |
| Sign SA (future, Decision 5) | When the issuer service ships, the SA holds sign rights — an SA/WIF compromise triggers this same runbook, and revoking the SA's `signerVerifier` binding joins Phase 1 as containment step 0 |
| CODEOWNERS review | The flip PR and the DID PR touch gated paths (`/status/**`, `tools/`, `.well-known/`); document-only gate in v1 — James self-merges in an emergency and the PR record is the audit trail |

## False alarm stand-down

Suspension is reversible by design. If investigation clears the key:

```bash
node --experimental-strip-types tools/flip-status-bit.ts key-epoch-2026-07 0 restore
```

Then the same pipeline: constant back to `[]`, hardened re-sign, sha pin,
PR, tag deploy, and the Phase 2 read in reverse (bit 0 = 0; loopback
`verified: YES` again). Only stand down **before** Phase 3 — once the DID
method is removed, there is no un-remove; recovery is re-issuance.

## What this runbook does NOT cover

- **On-chain anchors are unaffected.** The Cardano `credential_claim` records
  this signature layer attests to do not change when a signing key is
  compromised — the chain remains authoritative for whether a credential was
  earned, and `evidence` anchor-chasing keeps working throughout. The
  signature layer is defense-in-depth on top of chain truth, not the truth
  itself (verifier-guidance two-layer model).
- **Gateway API keys** — the render service's `X-API-Key` compromise path is
  [`gateway-key.md`](gateway-key.md).
- **Per-credential revocation.** No per-credential off-chain state exists
  anywhere (Decision 3); a chain-level burn/transfer is observable on-chain
  and is not a status-list event.

## Related

- Flip tool: [`../../tools/flip-status-bit.ts`](../../tools/flip-status-bit.ts) (prepares; never signs)
- Hardened signer: [`../../spike/signer-spike/sign-status-list.ts`](../../spike/signer-spike/sign-status-list.ts)
- Status-list semantics + committed suspension state: [`../../spike/signer-spike/status-list.ts`](../../spike/signer-spike/status-list.ts)
- Deploy mechanics: [`../../DEPLOY.md`](../../DEPLOY.md)
- Decision 3 / kill-switch design: [`../plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](../plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md)
