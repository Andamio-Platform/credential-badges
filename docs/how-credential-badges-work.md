# How Credential Badges Work

> **Canonical copy:** this narrative is mirrored from the public docs at
> [andamio.io/docs/credential-badges/how-it-works](https://andamio.io/docs/credential-badges/how-it-works).
> Edit it there first; this repo copy is kept short and in sync for readers who
> clone the repo. For the build itself, see [`README.md`](../README.md) and
> [`generator/README.md`](../generator/README.md).

A **credential badge** is the visible face of an on-chain Andamio credential: a
self-contained image that shows a learner's achievement as something a person can
look at, hold, and post anywhere. It is free and open source, and that is the
point. Anyone can look at a real badge, understand what an Andamio credential is,
and start building with it.

The important thing to internalize first: **the art *is* the proof.** A badge is
not a decorative stand-in for a record kept somewhere else — its geometry encodes
the credential's on-chain identity and round-trips back to the chain.

> **Live on Cardano mainnet (v1.0).** Any credential resolves on demand at
> `https://credentials.andamio.io/badges/<policy_id>.<slt_hash>.svg` — a badge does
> not have to be pre-generated. What is **not** yet live is off-platform independent
> verification (signing, `did:web`); that's the v1.1 work at the end. Every claim
> below is labelled **live**, **in dev**, or **coming**.

## The four layers

A badge is four things stacked on top of each other. Only the top one is a picture.

### 1. The image — presentation *(live)*

Each badge is a self-contained SVG. Fonts are embedded, so it renders standalone in
any browser or `<img>` tag with **no call back to Andamio and no client library**.
The imagery is deliberately presentation-layer: an issuer can refresh a badge's art
without invalidating a single issued credential, because the image is a *pointer*
to the credential, never the credential's identity (see layer 4).

The SVGs are **build output, not hand-authored files** — each one is rendered
deterministically from on-chain data by the generator in [`generator/`](../generator/README.md).
Change the generator or the source data and regenerate; never hand-edit a badge.

### 2. The Proof-Ring encoding — the "art is proof" layer *(live)*

The two rings around the badge are not decoration. They encode the credential's
on-chain identity directly into the geometry:

- the **outer ring** encodes the course's on-chain minting-policy id, and
- the **inner ring** encodes the Student Learning Target (SLT) credential hash.

Because the encoding is deterministic, a badge **round-trips back to the chain**:
`make verify` (which runs [`generator/decode.py`](../generator/decode.py)) reads the
rings off the image and confirms they match the credential's real on-chain hashes.
The image checks itself — no server, no trust in Andamio required for this step.
Most "verified" badges pair a picture with a *separate* record it points at, whether
a hosted database or an on-chain token whose image is only attached metadata. Here
the geometry itself is the proof, decodable straight back to the chain.

### 3. The Open Badges 3.0 form — the portable standard *(live: format · in dev: signature)*

Underneath the image, a badge is expressed as an **Open Badges 3.0 / W3C Verifiable
Credential 2.0** JSON-LD object. The OB 3.0 `achievement.image` field points at the
badge SVG; Andamio's extension terms (`onChainAnchor`, `onChainAttestation`,
`accessToken`, `requires`, `prereqAttestation`) carry the Cardano-native facts that
plain OB 3.0 has no vocabulary for. The extension context is published at
`/context/v0.jsonld` and the hosted issuer identity at `/issuer`.

The **format** is delivered and has passed the 1EdTech Open Badges validator. The
**cryptographic signature** that lets an outside verifier trust the object without
calling Andamio is the v1.1 work below — today the object is correct OB 3.0 but not
yet independently signed.

### 4. The on-chain anchor — where identity actually lives *(live)*

The credential's real identity is not in the image or the JSON — it is anchored in
the learner's **Access Token global state on Cardano mainnet**. An Andamio
credential is an attestation written into that on-chain state by a multi-party
process (the course owner, an assessor, the chain itself, and Andamio's signer).
Everything above — the image, the rings, the OB 3.0 object — is a portable *view* of
that anchor, so a non-Cardano audience can read a fact that lives on Cardano.

## How a badge resolves

Serving is **static-first with an on-demand render fallback**, so every valid
credential resolves whether or not its badge was pre-built *(live)*:

1. **Hit** — if the badge is in the pre-generated set, nginx serves it from disk.
2. **Miss** — the request falls through to a render service, which reads the course
   and module **titles** from the Andamio gateway (titles are the only thing
   fetched), renders the SVG, and caches it. First request renders; repeats serve
   from cache.

The response is the same `image/svg+xml` either way, and the badge *geometry* is
reproducible entirely offline (`make badges`) because the proof is the
on-chain-anchored ring encoding, not anything the render service adds.

## The one idea to keep

**The image is presentation-layer; the on-chain anchor is identity.** Art can be
restyled without breaking credentials, badges embed anywhere as plain images, and
"verification" means checking the rings (and soon the signature) back against the
chain — not trusting a hosted database.

## Where it's going — v1.1 portability *(in dev / coming)*

Today a badge's proof is its **Proof-Ring encoding plus the on-chain anchor** —
Cardano-native. v1.1 makes a badge **independently verifiable off-platform**:

- **Ed25519 signing** with a managed key, and a **signed OB 3.0 Verifiable Credential
  baked into the badge** — self-verifying, no call to our server.
- **`did:web:credentials.andamio.io`** as a resolvable issuer identity.
- A **status list** for suspension / revocation signalling.
- A **third-party embed component** and a **standalone wallet-connect viewer**.

> **Honest scope.** When v1.1 lands, the accurate claim is that badges are verifiable
> by **Data-Integrity-capable OB 3.0 / VC verifiers** (e.g. spruce, 1EdTech), not by
> *every* tool that calls itself an OB 3.0 verifier — many read only JWS-style
> credentials and will not read Andamio's Data Integrity JSON-LD credential. Until
> v1.1 ships, the honest proof story remains Proof-Ring + on-chain anchor. Track it in
> [`ROADMAP.md`](../ROADMAP.md).
