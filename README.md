# credential-badges

**Turn an on-chain Andamio credential into a badge you can see, embed, and share.**

A credential badge is the visible face of an Andamio credential: a self-contained SVG that renders a learner's on-chain achievement as something a person can look at, hold, and post anywhere. It is free and open source, and that is the point. Anyone can look at a real badge, understand what an Andamio credential is, and start building with it.

Live on Cardano **mainnet**. Any credential resolves on demand at:

```
https://credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg
```

**[Look at a real one →](https://credentials.andamio.io/badges/203e63f457e0b8088073ec20959c4e0cc188cf90425d4f29ff3f817f.77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b.svg)**

The badge is not just a picture. Its two rings encode the credential's on-chain identity (outer ring = the course policy id, inner ring = the SLT credential hash), so the geometry round-trips back to the chain. **The art *is* the proof.** Run `make verify` to decode a badge and check it against its on-chain hashes.

---

## For developers, start here

Welcome. The fast path in:

| You want to... | Go to |
|---|---|
| See a live badge | the link above, or any `credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg` |
| Map the repo (one line per component) | [`MOC.md`](MOC.md) |
| Regenerate the badges locally (offline, Python 3 only) | `make badges` |
| Set up and contribute | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| See where this is going | [`ROADMAP.md`](ROADMAP.md) |
| Understand the deploy model | [`DEPLOY.md`](DEPLOY.md) |

**The one rule to know first:** badges are **build output, not hand-authored files**. *"If it can be generated, it must be generated."* Each SVG is rendered deterministically from on-chain data by the generator in [`generator/`](generator/README.md). Never hand-edit a file in `badges/`. Change the generator (or the source data) and regenerate.

### What's served

Three things live at `https://credentials.andamio.io`:

| Path | What it is |
|---|---|
| `/badges/<policy_id>.<slt_hash>.svg` | The badge imagery. Static-first, with an on-demand render fallback, so *any* credential resolves without being pre-generated. Referenced by `achievement.image` in the OB 3.0 credential. Presentation-layer only, never identity-bearing. |
| `/context/v0.jsonld` | The JSON-LD context for Andamio's Open Badges 3.0 extension terms (`onChainAnchor`, `onChainAttestation`, `accessToken`, `requires`, `prereqAttestation`). Pre-stable (`v0`). |
| `/issuer` | The hosted OB 3.0 issuer `Profile`. Strict verifiers dereference `issuer.url` here and expect `application/ld+json`. |

> **On naming:** the badge filename's first half is the credential's **course-NFT minting policy id** (56-hex). In Andamio a course is identified by its course-NFT minting policy, so that policy id *is* the course identifier, not a separate one. The second half is the SLT (credential) hash.

### How a badge resolves

Static-first, with an on-demand render fallback, so nothing has to be pre-generated:

1. **Static hit.** If the SVG is in the pre-generated set baked into the static host, nginx serves it from disk.
2. **Miss → render.** A `/badges/` miss returns nginx `404 → @render`, which proxies to a second Cloud Run service (`credential-badges-render`).
3. **Render + cache.** The render service reads the course and module titles from the Andamio API gateway, renders the SVG, and caches it in GCS. Repeat requests serve from cache.

Titles are the only thing fetched. The badge geometry is the proof-ring encoding of the on-chain credential, so the art is reproducible offline (`make badges`).

---

## What's built, what's coming

### ✅ Built: v1.0 (mainnet core), shipped 2026-06-29

A learner's on-chain credential renders as a badge that is visible in the Andamio app and resolves on demand for *any* credential, live on Cardano mainnet.

- Static host live at `credentials.andamio.io` (context, issuer profile, badges).
- Real badge imagery for live credentials, keyed `<policy_id>.<slt_hash>`.
- On-demand generation: any credential, including newly issued ones, renders through the public host (static-first, nginx `404 → @render` to the render service, GCS-cached).
- Badges shown in the Andamio app on the learner's Credentials page.
- Proof-Ring encoding verified to round-trip to on-chain hashes (`make verify`).

### 🔜 Coming: v1.1 (Q3), the portable / verifiable layer

Turns the badge from "Proof-Ring + on-chain anchor" into an independently verifiable OB 3.0 / Verifiable Credential that travels off-platform:

- Ed25519 signing (GCP KMS) and OB 3.0 signed-VC baking.
- `did:web` issuer identity and a hosted verification page.
- A BitstringStatusList for revocation signaling.
- A third-party SDK embed and a standalone wallet-connect viewer.

Until then, a badge's proof is its Proof-Ring encoding plus the on-chain anchor.

> **Two version axes, do not conflate them.** The repo/release tag (`v1.0.0`, which deploys the static host) is separate from the **JSON-LD schema version**. The schema is still `v0` (pre-stable). The first *stable* `v1.jsonld` ships with the v1.1 signing work. Tagging the repo `v1.0.0` does not make the schema stable.

---

## Ongoing work (live checklist)

The authoritative, phase-by-phase checklist lives in **[`ROADMAP.md`](ROADMAP.md)** (tick boxes as items close). Snapshot of what's live now and what's moving next:

- [x] v1.0 mainnet core: render + serve any credential on demand (shipped 2026-06-29)
- [x] Badges shown in the Andamio app (Credentials page)
- [ ] **"Look at this badge" in the app** (in progress, `andamio-app-v2`): show earnable badges on the public course page, the badge in the module learning UX, and an enlarge + metadata + shareable-link path on the Credentials page ([app-v2 #738](https://github.com/Andamio-Platform/andamio-app-v2/issues/738))
- [ ] v1.1 Phase 0: evidence gate (external verifier runs + comprehension cohort) ([#15](https://github.com/Andamio-Platform/credential-badges/issues/15)–[#21](https://github.com/Andamio-Platform/credential-badges/issues/21))
- [ ] v1.1 Phase 1: Ed25519 sign key + `did.json` CI emission
- [ ] v1.1 Phase 2–3: signed-credential service + human verification page

Known issues and good entry points are in [GitHub Issues](https://github.com/Andamio-Platform/credential-badges/issues). Look for [`good first issue`](https://github.com/Andamio-Platform/credential-badges/labels/good%20first%20issue) and [`documentation`](https://github.com/Andamio-Platform/credential-badges/labels/documentation).

---

## How you can use this

Some things you can build on today, and where it's headed:

- **Embed a learner's badge anywhere.** It is a plain SVG at a stable URL, no API key needed to read:
  ```html
  <img src="https://credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg"
       alt="Andamio credential badge" />
  ```
- **Resolve any credential on demand.** You do not need a badge to be pre-generated. Request the URL for any `(policy_id, slt_hash)` pair and the host renders and caches it on first hit.
- **Verify a badge against the chain.** The rings are an encoding, not decoration. `make verify` decodes a built badge and confirms it matches its on-chain hashes, so the image is self-checking.
- **Read the credential's schema.** Fetch `/context/v0.jsonld` to see Andamio's OB 3.0 extension terms and build your own renderer or validator against them.
- **Regenerate or restyle locally.** `make badges` renders the full set offline and deterministically. Fork the generator in [`generator/`](generator/README.md) to experiment with palettes or encodings (`gen.py`, `colors.py`).
- **Coming in v1.1:** import a signed, independently verifiable credential into your own app via the SDK, or point people at the standalone wallet-connect viewer, no Andamio account required.

If you build something with these, or want a surface that does not exist yet, open an issue. We want this to be a thing people pick up and run with.

---

## Contributing

Credential badges are free and open source, and contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for the setup, the build-output rule, and how changes ship (tag-triggered deploy, served-file allowlist). New contributors: the [`good first issue`](https://github.com/Andamio-Platform/credential-badges/labels/good%20first%20issue) and [`documentation`](https://github.com/Andamio-Platform/credential-badges/labels/documentation) labels are the best entry points, and [`ROADMAP.md`](ROADMAP.md) shows what's next. Participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Background

These extension terms came out of the Andamio Open Badges 3.0 spike (April–May 2026). The spike is committed at [`spike/`](spike/README.md) (source of truth), and the full deployment plan that promotes it lives at [`docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md`](docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md).

## License

[Apache License 2.0](LICENSE) © Andamio Platform.
