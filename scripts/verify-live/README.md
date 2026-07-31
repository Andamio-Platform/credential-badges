# `verify-live` — post-deploy verification against the live stack

Every other verification in this repo is **local**. `tools/*.test.ts` pin build
artifacts against constants (context sha256s, the KMS key, the baked credential
bytes); the spikes verify credentials through a *local* document loader. All of
that is hermetic by design — and none of it proves the **served** stack is
coherent.

This does. It fetches a badge from production, extracts the embedded OB 3.0
credential, and verifies its Data Integrity proof (`eddsa-rdfc-2022`) while
resolving the **live** JSON-LD context, the **live** `did:web` document, and the
**live** `BitstringStatusList` over the network — every fetch `no-store`. A
drifted deploy fails here and nowhere else:

- a context served from the wrong tag (canonicalization diverges → proof fails)
- a `did.json` that no longer matches the signing key
- a status bit flipped by mistake, or a kill-switch flip that never took

```sh
cd scripts/verify-live && npm ci

node verify-live.mjs                            # the flagship badge
node verify-live.mjs <badge-id> [<badge-id>…]   # <course_id>.<slt_hash>
node verify-live.mjs <url> [<url>…]             # any absolute badge URL
node verify-live.mjs --host https://staging.example.com <badge-id>
node verify-live.mjs --allow-suspended <badge-id>
```

Absolute URLs are used as-is, so a one-off artifact (a re-baked SVG on a preview
URL) can be checked without a deploy.

| Exit | Meaning |
|---|---|
| `0` | Verified, not suspended |
| `1` | The proof failed to verify — **investigate before shipping anything else** |
| `2` | Could not get far enough to check (fetch / extract / key error) |
| `3` | Verified, but the suspension bit is set (suppress with `--allow-suspended`) |

An un-checkable badge exits non-zero: a smoke check that can't reach its target
must not read as a pass.

## Why it lives here and not in `tools/`

`tools/` is **dependency-free by design** — a CODEOWNERS-gated, security-sensitive
path that runs in CI with no install and carries no third-party packages. Data
Integrity verification requires RDF canonicalization, which cannot be
hand-rolled, so this carries the `@digitalbazaar` stack (exact-pinned) and stays
outside that boundary. It is never served (`scripts` is in `IGNORED_PREFIXES`)
and is not part of the signing path — it only reads.

It is **not wired into CI**, deliberately: it depends on the live network and on
a deploy having happened. It's a post-deploy gate a human runs, alongside
`verifybadge.org` and `spruce`.

## Provenance

Written 2026-07-22 as a ground-truth stand-in for the 13th `verifybadge.org`
probe while that validator held a stale copy of the mutated `v0` context — see
[`docs/solutions/conventions/never-mutate-published-jsonld-context.md`](../../docs/solutions/conventions/never-mutate-published-jsonld-context.md).
That incident closed with the `v1` bump (PRs #64/#65) and a clean `VALID 13/13`.
The live check outlived its incident: it is the only thing in the repo that
looks at what production actually serves.
