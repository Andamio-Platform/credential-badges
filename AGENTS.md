# AGENTS.md

Orientation for coding agents working in this repo. Humans should start with
[`README.md`](README.md) for what this is, [`MOC.md`](MOC.md) for a one-screen map of every
component, and [`docs/sitemap.md`](docs/sitemap.md) for every public URL the domain serves — this
file does not repeat them. It covers what an agent needs that a map does not
give: where the accumulated knowledge lives, and which operations destroy things quietly.

## What this repo publishes

Badges served at `credentials.andamio.io` are **signed, publicly served, permanent artifacts**.
A credential in the wild references its context and its signing key by URL for life. That shapes
almost every convention here: published bytes are frozen rather than edited, and anything that
changes what a signature was computed over is a breaking change even when nothing looks broken.

## Where the knowledge lives

| | |
|---|---|
| [`CONCEPTS.md`](CONCEPTS.md) | Shared domain vocabulary — entities, named processes, and status concepts with project-specific meaning. Terms like Baking, Class Achievement, Anchor Gate, and Validation Gate mean something specific here. Relevant when orienting to the codebase or discussing domain concepts. |
| `docs/solutions/` | Documented solutions to past problems — bugs, conventions, best practices, workflow patterns — organised by category with YAML frontmatter (`module`, `tags`, `problem_type`, `applies_when`). Relevant when implementing or debugging in an area someone has already been burned by. |
| `docs/runbooks/` | Operational procedures for things that touch production keys or published artifacts: class-artifact signing, key rotation, the compromise kill-switch, gateway keys. |
| `docs/plans/` · `docs/brainstorms/` | Decision records. A plan carries the reasoning and the rejected alternatives, not just the outcome — including decisions that were later refuted, which are left legible on purpose. |
| `docs/residual-review-findings/` | Review findings deliberately **not** applied, and why. Read this before concluding a guard holds or a weakness is unknown — it is where a known-unfixed thing goes, so its absence from a diff is not evidence it was missed. |

`docs/solutions/` is small enough to skim in full. Searching frontmatter is usually faster than
searching prose: `grep -rl "tags:.*signing" docs/solutions/`.

## Operations that destroy things quietly

These have all happened or come close. None of them fails loudly at the time.

- **`make badges` un-bakes every badge it regenerates.** A badge's signed credential lives inside
  its SVG; regenerating the art replaces the file and the signature is gone. Regenerating derived
  output (pages, registry, OG cards) is safe — `make badges` is not. Re-bake after any deliberate
  regeneration.
- **Never edit a published JSON-LD context in place.** Verifier document caches are unbounded, so
  a mutation makes correctly signed credentials fail deterministically at some verifiers and pass
  at others. Ship a new version URL instead. CI enforces this; see
  `docs/solutions/conventions/never-mutate-published-jsonld-context.md`.
- **Every KMS signing run must be transcribed.** `docs/runbooks/key-compromise.md` treats an
  `asymmetric-sign` entry that is not attributable to a recorded run as a compromise trigger. The
  signing tooling writes transcripts automatically — do not sign by hand around it.
- **Validate one artifact before signing a batch.** A spec permitting a shape is not a verdict
  from the reference validator; the two have disagreed here twice. See
  `docs/solutions/conventions/validate-one-artifact-before-batching.md`.
- **Public copy must not claim more verifiability than an artifact supports.** Qualifiers that
  bound a claim are load-bearing — deleting one widens the claim rather than simplifying it. See
  `docs/solutions/conventions/never-delete-a-qualifier-that-bounds-a-claim.md`.

## Conventions worth knowing before you edit

- **Tests must be wired into CI to count.** A suite that runs nowhere has already let a real
  regression land green here (`docs/solutions/workflow-issues/unwired-test-suites-silently-rot.md`).
- **Test fixtures should not depend on transitional repo state.** Several suites once hunted for an
  unbaked badge; when every badge became baked they would have gone green by no longer testing
  anything. Synthesize the state a test needs.
- **The served-file allowlist is explicit.** `Dockerfile` copies allowlisted paths only, and
  `scripts/ci/check-allowlist.sh` fails the build if anything else would be served. Adding a public
  path is a deliberate, reviewed act.
- **Deploy lanes are tag-routed** with non-overlapping patterns — see [`DEPLOY.md`](DEPLOY.md).
- **Release names come from `product-circle` board 28; the version number comes from this repo.**
  A tag is the fact about what shipped, so it belongs here; a Release takes its number from the
  tag line and adds what the line cannot carry — scope, audience, visibility, done-ness — and
  names its tags before it closes. There is **one historical exception**: the `v1.1` Release
  shipped inside `v1.0.9` and no `v1.1.x` tag was ever cut. `v1.0`, `v1.2` and `v1.3` line up
  with `v1.0.0`, `v1.2.0` and `v1.3.0`/`v1.3.1`, and everything from `v1.3.0` on is kept aligned
  — do not read the `v1.1` exception as an expectation that the two drift. Mapping table and the
  rule: `product-circle`'s `roadmap/roadmap-board-reference.md`.
