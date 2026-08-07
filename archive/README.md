# Andamio OB 3.0 Prototype Spike

Phase 1 prototype for the [Open Badge 3.0 integration plan](../2026-04-16-open-badge-3-integration-one-pager.md). Generates and validates a signed Open Badges 3.0 credential for a real Andamio Cardano preprod course.

This is a **reference artifact** — not production code. Throwaway keys, narrow scope, validated end-to-end.

## What it does

1. Reads a real on-chain Andamio credential reference (preprod course `76bab08...8157742`, "Give Feedback on This App").
2. Maps the Andamio credential model (`policy_id`, `asset_name`, `slt_hash`, course/teacher/SLT data) into an `OpenBadgeCredential` JSON-LD document (W3C VC 2.0 + OB 3.0 contexts).
3. Generates a fresh Ed25519 keypair and a `did:key` issuer identity, persists them to `out/issuer-key.json`.
4. Signs the credential as a VC-JWT (per W3C VC-JWT-2.0 / OB 3.0).
5. Runs three validation layers — structural field checks, JSON-LD context expansion, JWT signature verification — and writes a results table.
6. Submits the signed document to the public IMS Global Open Badges validator and records the response.

## Quick start

```bash
cd <the ob3-prototype spike directory>
npm install
npm run build
npm run generate    # writes out/ + sample-credential.jsonld
npm run validate    # writes out/automated-results.md
```

End-to-end: `npm run all`.

Outputs land in:
- `out/issuer-key.json` — the throwaway keypair (gitignored; regenerated per machine, NEVER use elsewhere)
- `out/credential.unsigned.json` — the JSON-LD document with no proof
- `out/credential.signed.json` — same document with a JWT proof block
- `out/credential.jwt.txt` — the bare compact JWS (`vc+jwt`)
- `out/automated-results.md` — pass/fail table from `npm run validate`
- `out/1edtech-validator-response.html` — the raw response from openbadgesvalidator.imsglobal.org
- `sample-credential.jsonld` — the canonical signed sample (deliverable file)

## Stack choices

- **TypeScript / Node 20+** — keeps the spike portable; the production service will be Go (`andamio-api/pkg/ob3`) but the mapping is identical.
- **`jose`** for JWT signing (EdDSA / Ed25519). Picked over `@digitalbazaar/vc` + `eddsa-rdfc-2022-cryptosuite` because:
  - JWT proof is explicitly OB 3.0–compliant and is the simplest path through the spec.
  - The digitalbazaar Linked Data Proof stack adds context-loader plumbing and a remote document loader; it's the right call for production but heavyweight for a 2-hour spike.
  - We left `@digitalbazaar/*` packages in the dependency list so the next iteration can swap in a Linked Data Proof variant without touching `package.json`.
- **`@noble/ed25519`** for raw key generation and the multibase-encoded public key embedded in `did:key`.
- **`jsonld`** (digitalbazaar) for context expansion — confirms both the W3C VC 2.0 and OB 3.0 v3.0.3 contexts resolve and the document is valid RDF.
- **No `dotenv` use yet** — the prototype doesn't need Blockfrost calls at runtime (the on-chain anchor is hard-coded from a verified live query). `.env.example` is committed for the next iteration that fetches asset data from Blockfrost dynamically.

## Reference credential

| Field | Value |
|---|---|
| Network | Cardano preprod |
| Course | "Give Feedback on This App" (Cardano XP feedback course) |
| `course_id` (== Cardano native asset `policy_id`) | `76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742` |
| `slt_hash` | `77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b` |
| Recipient | `lynx` (preprod test wallet) |
| Recipient state asset | `4a3cefbf...6c796e78` (live UTXO, quantity 1) |
| Explorer | https://preprod.cexplorer.io/policy/76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742 |

We deliberately did **not** use a Midnight PBL credential. The Midnight PBL course is currently only minted on mainnet (`dd29e3da...`), and the task constraints forbid mainnet. See [open-questions.md](./open-questions.md) for the rationale and the "what to do when a real claim happens" follow-up.

## Reproducing on a clean machine

1. Node 20+, npm 11+.
2. `npm install` (no global packages required).
3. `npm run all`.
4. The keypair persists in `out/issuer-key.json` between runs — delete it to rotate and regenerate.

No network calls are required at runtime. JSON-LD validation does fetch the W3C VC 2.0 context (`https://www.w3.org/ns/credentials/v2`) and the OB 3.0 v3.0.3 context (`https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json`); both are public and unauthenticated.

If a future variant fetches Blockfrost data live, copy `.env.example` to `.env.local` and fill in `BLOCKFROST_PREPROD_PROJECT_ID`. **Never commit `.env.local`.**

## File map

```
ob3-prototype/
├── README.md                      this file
├── mapping.md                     field-by-field Andamio -> OB 3.0 mapping
├── validation-results.md          narrative + raw results from each validator
├── open-questions.md              gaps surfaced during the spike
├── sample-credential.jsonld       the deliverable signed credential
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── src/
│   ├── credential.ts              the reference Andamio credential data
│   ├── mapper.ts                  Andamio -> OB 3.0 transform
│   ├── keys.ts                    throwaway Ed25519 + did:key
│   ├── sign.ts                    VC-JWT signing
│   ├── generate.ts                npm run generate entry
│   ├── validate.ts                npm run validate entry
│   └── jsonld.d.ts                ambient declaration for jsonld
└── out/                           generated artifacts (gitignored)
```

## Time spent

~120 minutes focused, end-to-end (read plan + memory; pick credential; build; validate; write up; commit).