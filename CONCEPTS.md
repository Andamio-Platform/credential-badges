# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Credential artifacts

### Signing Context
The versioned JSON-LD vocabulary that credentials reference by URL to define Andamio's extension terms. Exactly one version is *current* (referenced by everything newly signed); every previously published version keeps serving byte-identical content forever, because credentials in the wild reference their version for life and verifier document caches never expire. Vocabulary changes ship as a new version, never as an edit.

### Flagship Badge
The single signed badge — the end-to-end proof artifact whose embedded credential carries a cryptographic proof and is exercised against third-party verifiers. It is a Holder Artifact sitting at a shared badge address, which is why it reads as true for one of its holders and false for the rest; every other badge is presentation-only.

### Baking
Embedding a signed object byte-transparently into a badge SVG's credential block, replacing the unsigned hook the generator emits. The embedded object is either a Class Achievement or a Holder Artifact — the two are never interchangeable. Regenerating a badge un-bakes it, so a bake must follow any regeneration of a signed badge. Extraction must round-trip byte-identical to the signed artifact.

### Class Achievement
The signed, holder-free object describing what a badge *means* — its achievement, issuer, and on-chain anchor — with no subject identity and no assertion that anyone earned it. One per badge, immutable (a badge's identity commits to its content, so changed content is a different badge), and safe to publish at a shared address because it names nobody.

### Holder Artifact
The signed credential asserting that one named holder earned one specific badge. Identified by badge *and* holder, because a badge coordinate alone does not identify a credential — a single badge routinely has many holders. Carries the holder's Access Token alias by necessity; a shared, holder-agnostic address can never serve one truthfully.

### Key-Epoch Status List
The revocation/suspension status credential covering everything signed under one signing-key epoch. Mutable **by design** — the key-compromise kill-switch flips its bits in an emergency — so it is deliberately excluded from byte-freeze invariants that protect other published artifacts.

## Integrity invariants and processes

### Version Freeze
The enforced invariant that a published, versioned artifact's bytes never change — an in-place edit, a deletion, or an unpinned new version fails loudly before merge and again at deploy time. Exists because an in-place mutation makes correctly signed credentials fail deterministically at caching verifiers.
*Avoid:* freeze pin (the pin is the mechanism; the freeze is the invariant)

### Expansion Pin
The pinned fingerprint of a signed artifact's canonical RDF form. It changes only alongside a legitimate re-sign of the covered artifact; a pin that moves on its own means the canonicalization pipeline drifted — a defect, not an update.

### Drift Check
Fail-closed verification that the live, publicly served copy of a trust artifact equals the committed/bundled copy. The issuer refuses to boot on a mismatch or a missing live artifact; the signing path refuses to canonicalize. Unreachability degrades to a warning; a confirmed mismatch never does.

### Anchor Gate
The refusal to sign a credential unless its on-chain claim is re-verified live — the claim transaction exists, belongs to the subject, and the credential's content hashes match what is anchored. Signing is downstream of the chain, never of trusted local state.

### Deterministic Re-sign
A same-key re-issue whose outcome is predicted before signing and enforced after: when nothing canonically visible changed, the new signature must be byte-identical to the old, expansion pins must not move, and the artifact diff must be exactly the intended lines. Any deviation stops the line. Distinct from key-compromise re-issuance, which uses a new key.

## Operations

### Deploy Lane
One tag-prefix-routed deploy pipeline per service, with non-overlapping tag patterns so no tag can trigger another lane's deploy. Each lane owns its own post-deploy verification, which probes the public hostname (what users and verifiers actually fetch), not internal service URLs.
