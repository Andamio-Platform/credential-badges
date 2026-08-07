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

## `bake-signed-vc.ts` — bake / extract a signed VC in a badge SVG

Swaps the single `<openbadges:credential>` element the generator emits (the
unsigned `verify=""` hook) for a **signed** OB3 credential, per OB 3.0
section 5.3.2.1: our proof is an embedded Data Integrity proof
(`eddsa-rdfc-2022`), so the `verify` attribute is **omitted** and the
credential JSON goes in the CDATA body (`verify=` is only for VC-JWT compact
JWS). The signed VC is immutable input — inserted byte-for-byte, never
reformatted (a mutation would break the signature); everything outside the
element (visual layers, the `<metadata>` presentation block) is preserved
byte-identically. `extract` reverses the bake exactly.

```sh
node --experimental-strip-types tools/bake-signed-vc.ts bake <badge.svg> <signed-vc.json> <out.svg>
node --experimental-strip-types tools/bake-signed-vc.ts extract <badge.svg> [out.json]
```

Transcripts for the first baked badge (Rung 7) live in `transcripts/`.
**`make badges` re-emits the unsigned hook** — regenerating over a baked badge
un-bakes it; `bake-signed-vc.test.ts` (below) goes red if that ever happens.

## `bake-png-vc.ts` — bake / extract a signed VC in a badge PNG

The PNG analog of `bake-signed-vc.ts` (#69, v1.2). Embeds the signed OB3
credential in an **uncompressed `iTXt` chunk** with keyword
`openbadgecredential`, per OB 3.0 section 5.3.1, inserted immediately before
`IEND`. Same byte-transparency contract: the VC goes in byte-for-byte (never
reformatted — a mutation breaks the signature), the image pixels
(`IHDR`/`IDAT`/`IEND`) are preserved exactly, and `extract` reverses it. It
refuses to bake an unsigned credential, keeps exactly one credential chunk on a
re-bake, and verifies the chunk's CRC-32 on extract (a corrupt chunk fails loud
rather than returning as the "signed VC"). Same dependency-free rule — only
`node:fs` / `node:zlib` / `node:url`.

```sh
node --experimental-strip-types tools/bake-png-vc.ts bake <badge.png> <signed-vc.json> <out.png>
node --experimental-strip-types tools/bake-png-vc.ts extract <badge.png> [out.json]
```

Presentation-only, never identity-bearing: the on-chain anchor is identity; the
VC-in-PNG is a transport convenience. **`make pngs` re-rasterizes from the SVG**,
so it un-bakes the PNG the same way `make badges` un-bakes the SVG — a PNG bake
must follow any regeneration of a signed badge.

## Tests

```sh
cd tools && npm test        # == node --experimental-strip-types --test *.test.ts
```

- **`gen-did-json.test.ts`** — encoding units (SPKI strip, multibase, round-trip,
  determinism, malformed-key rejection, byte-match against the committed file).
  Hermetic: no network, no KMS.
- **`context-freeze.test.ts`** — the **context-freeze invariant**: every file
  in `context/` must be byte-identical to its sha256 pin (`PINNED_CONTEXTS`).
  Published context versions are immutable forever — an in-place edit, a
  deleted version, or an unpinned new file is a **red test**, not a silent
  verification break at caching verifiers. Includes a guard-bites self-test.
  Deliberately excludes `/status/*` (kill-switch mutability). Hermetic.
- **`did-pin.test.ts`** — the **key-pin invariant**: the committed
  `.well-known/did.json` must decode to the raw bytes of KMS `vc-sign-ed25519`
  version 1. A wrong or rotated committed key is a **red test**, not a silent
  verification break. Decode-only by default; set `KMS_LIVE_PIN=1` (with an
  authed gcloud) to additionally re-fetch and compare against live KMS.
- **`bake-signed-vc.test.ts`** — the **baked-badge invariant**: the committed
  badge SVG for the signed subject credential must embed
  `signing/signed-credential.json` byte-for-byte (proof block and
  anchor identifiers asserted field-by-field), in the OB3 embedded-proof form.
  Plus hermetic bake/extract round-trip units. No network.
- **`bake-png-vc.test.ts`** — hermetic bake/extract units for the PNG iTXt bake:
  round-trip byte-identity on the real flagship PNG, refuse-unsigned, single
  credential chunk on re-bake, image-pixel preservation, valid CRC on the
  written chunk, fail-loud on a bit-flipped (CRC-mismatch) chunk, and rejection
  of a compressed chunk. No network.
