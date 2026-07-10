# `tools/` — build-only tooling

Scripts here are **never served**. They are the deterministic *generators* and
*invariants* behind trust-critical artifacts. `scripts/ci/check-allowlist.sh`
lists `tools` under `IGNORED_PREFIXES`, and the Dockerfile never copies it into
the nginx image.

**Dependency-free by design.** These are CODEOWNERS-gated, security-sensitive
paths, so they carry no third-party runtime or dev packages — they run on
Node's native TypeScript type-stripping (Node ≥ 22.18; default in Node 24).
No `npm install`, no `node_modules`, no lockfile, no supply-chain surface.

## `gen-did-json.ts` — regenerate `.well-known/did.json`

The DID document served at `did:web:credentials.andamio.io` is a **deterministic
projection of the KMS signing key** (`vc-sign-ed25519` version 1). This tool is
the source-of-truth generator; the committed `.well-known/did.json` is its
output. **Never hand-edit the key in the committed file — regenerate it here.**

Pipeline: `SPKI DER (PEM) → raw 32-byte Ed25519 key → 0xed01 multicodec →
base58btc → publicKeyMultibase → did.json`. Pure and deterministic (no
timestamps): the same key in produces byte-identical JSON out.

```sh
# Regenerate from the live KMS key (needs an authed gcloud):
gcloud kms keys versions get-public-key 1 \
  --location us-central1 --keyring credential-badges-issuer \
  --key vc-sign-ed25519 --project andamio-credentials \
  | node --experimental-strip-types tools/gen-did-json.ts > .well-known/did.json

# ...or let the tool shell out to that exact gcloud command:
node --experimental-strip-types tools/gen-did-json.ts --from-kms > .well-known/did.json

# ...or offline, from a PEM file:
cat key.pem | node --experimental-strip-types tools/gen-did-json.ts
```

## Tests

```sh
cd tools && npm test        # == node --experimental-strip-types --test *.test.ts
```

- **`gen-did-json.test.ts`** — encoding units (SPKI strip, multibase, round-trip,
  determinism, malformed-key rejection, byte-match against the committed file).
  Hermetic: no network, no KMS.
- **`did-pin.test.ts`** — the **key-pin invariant**: the committed
  `.well-known/did.json` must decode to the raw bytes of KMS `vc-sign-ed25519`
  version 1. A wrong or rotated committed key is a **red test**, not a silent
  verification break. Decode-only by default; set `KMS_LIVE_PIN=1` (with an
  authed gcloud) to additionally re-fetch and compare against live KMS.
