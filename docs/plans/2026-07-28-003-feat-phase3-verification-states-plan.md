---
title: "feat: Phase 3 verification states + multi-party visibility on the hosted surface"
type: feat
status: active
date: 2026-07-28
depth: deep
roadmap: "Phase 3 — Verification surface (Unit 5)"
plan_reference: "docs/plans/2026-05-16-001-feat-andamio-ob3-issuer-deployment-plan.md#phase-3--verification-surface--status-list-emission--verifier-guidance-unit-5"
---

# feat: Phase 3 verification states + multi-party visibility on the hosted surface

## Summary

Phase 3 asks for **five explicit verification states with designed copy** and a
**multi-party process visible in the rendered output**. What shipped in v1.2 is a
static badge-class page (`/badges/{stem}`) plus a holder viewer
(`/badges/{stem}/{alias}`) that resolves live on-chain + suspension state
client-side — effectively two states, `verified` and `suspended`, plus a
fail-loud error.

This plan closes the part of that gap that can be closed **honestly**, and
records — with the reason and the evidence — which part cannot.

**The headline conclusion: three of the five states are genuinely achievable on
the current static host, one is deliberately not emitted, and one is not
achievable at all in this pass.**

| Plan state | Achievable now? | Mechanism / reason |
|---|---|---|
| `anchored+signature-valid` | **No** | Requires verifying an `eddsa-rdfc-2022` Data Integrity proof, which requires JSON-LD expansion + RDFC (URDNA2015) canonicalization. Not implementable in-browser without vendoring a large JSON-LD/RDF-canonicalization stack into the served allowlist. The correct home is a server-side verify endpoint on `credential-badges-issuer` (which is deployed and live — the ops gate closed 2026-07-23; the remaining gate is a trust-surface review, not infrastructure). **Deferred — see [Why signature validity is not achievable here](#why-signature-validity-is-not-achievable-here).** |
| `anchored+signature-unavailable` | **Yes** | Already the substance of today's `anchored` / `signed` / `unknown` states. Renamed and re-copied so no label reads as a validity claim. |
| `not-found` | **Yes — and it is the important gap** | The holder-state read already in flight answers it. `/badges/{stem}/{alias}` is the LinkedIn `certUrl` target — the exact URL an employer opens to ask "does this person hold this credential?" — and today it silently answers a *different* question when the answer is no. |
| `revoked-signal` | **No — deliberately, per the plan's own rule** | Defined as "claim tx exists but the pair is now absent from the recipient's current global state". Distinguishing that from indexer lag requires a freshness / confirmation-depth signal Andamioscan does not expose, plus the O(index-pages) claim-discovery scan the issuer service runs server-side. The plan mandates `indeterminate`, never `revoked`, when freshness is inconclusive — so the honest client-side output is `not-found` / `indeterminate`. |
| `indeterminate` | **Yes** | Already the fail-loud path plus the `unknown` suspension degrade. Named, given designed copy, and extended to cover an unreadable arrival verdict. |

For the multi-party requirement: **courseOwner is achievable and ships here**
(verified live against Andamioscan on 2026-07-28); **assessor is not derivable
from any on-chain surface and is explicitly named as absent rather than
blank-filled**; **the on-chain anchor ships as a verified Andamioscan course
link plus the copyable course id**, because the credential's *claim transaction
hash* is not reachable client-side.

---

## Problem Frame

### What the deployment plan asked for

Unit 5 specifies `service/src/verify-view.ts` — a **server-rendered** page
inside the issuer service, which by construction has the anchor gate, the KMS
signer, and the post-sign verifier all in-process. In that setting all five
states fall out naturally: the gate decides `not-found` / `revoked-signal`
before any KMS operation, the signer decides
`anchored+signature-valid` / `anchored+signature-unavailable`, and freshness
decides `indeterminate`.

### Why that shape is not available

> **CORRECTION (2026-07-28, post-merge).** This section was written against a
> stale `issuer-service/README.md`, which still framed the ops gate as a
> precondition for tagging. **The ops gate is CLOSED and the service is live** —
> `service-v0.1.1` deployed 2026-07-23; `/credentials/*` returns 200 today. The
> conclusion below that a server-side verify endpoint is unavailable is therefore
> **void on the infrastructure ground**. What still stands is the trust-surface
> argument: adding a public route to the one process holding KMS sign permission
> is a deliberate decision, not a free one. See [#87](https://github.com/Andamio-Platform/credential-badges/issues/87)-adjacent discussion and the corrected README.

`credential-badges-issuer` was, at the time of writing, believed built but not
deployed. So there
is no server that can render a verification view today.

What *is* deployed is the static nginx host plus the render service. The v1.2
holder viewer (#73) solved the same "state must be live on a static host"
problem with a committed shell + client JS reading through the same-origin
`/holder-api/` reverse proxy. **This plan reuses that substrate**: it is the
only mechanism that produces live verification state without standing up new
per-request infrastructure.

### The specific hole in what shipped

`/badges/{stem}/{alias}` is generated as LinkedIn's `certUrl` — the "this person
holds this, verified" target (`certUrlFor` in `badges/_holder.js`). An employer
who follows that link is asking one question: *does this alias hold this
credential?*

Today the page never answers it. It lists every badge the alias **does** hold.
If the alias does not hold the badge in the URL, that badge simply does not
appear in the list, with no statement of any kind. A reader who does not notice
an absence in an unordered list will read the page as confirmation. **An
unanswered question rendered as a page full of green state is worse than an
error** — it is the same failure mode the fail-loud rule (R6 of the #73 plan)
exists to prevent, one level up.

---

## Evidence — live probes, 2026-07-28

Every claim in this plan about upstream data availability was probed live
against `andamioscan.io` (read-only GET) on 2026-07-28. Recording them here so a
future reader does not have to re-derive them.

| Probe | Result |
|---|---|
| `GET /api/v2/courses/{course_id}/details` | **200.** Returns `course_address`, `course_id`, `owner`, `student_state_id`, `modules[{slt_hash, module:{slts, prerequisites}, created_by}]`, `teachers`, `students`, `past_students`. **`owner` is present** — this closes the open "does the course endpoint return an owner?" question. |
| `GET /api/v2/users/{alias}/courses/completed` | **200.** Returns, per completed course: `tx_hash`, `slot`, `course_id`, `owner`, `teachers`, `course_address`, `student_state_id`. **One request yields the course owner for every badge a holder holds** — no per-course fan-out needed. |
| `tx_hash` in `courses/completed` | **Is the course-creation transaction, not the credential-claim transaction.** For course `ae1926…` it is `42bfbfd4…`, whereas the flagship claim tx is `7cb75099…`. The issuer service does not use it as the claim tx either — `anchor.ts` discovers the claim tx by scanning the transactions index. |
| `GET /api/v2/events/credential-claims/alias/{alias}`, `…/credential-claims` (root) | **404 both.** There is no by-holder or by-course claim-event index. The only claim-event route is by known tx hash (`…/claim/{txHash}`), which is why the issuer service needs the discovery scan. |
| `GET /api/v2/openapi.json` | 404 — no machine-readable surface listing to check against. |
| Response headers on `/api/v2/users/james/state` | **No `access-control-allow-origin`.** The `/holder-api/` same-origin proxy remains required; unchanged from #73. |
| `https://andamioscan.io/courses/{course_id}` | **200**, `<title>Course Dashboard - Andamioscan</title>`; a bogus id returns **404**. Verified as a real, validity-discriminating human URL. |
| Koios `policy_asset_list` for the course id `ae1926…` | One asset, `LocalStateNFT`. The course id is a real on-chain minting policy. |
| Koios `policy_asset_list` for `student_state_id` `48344bd7…` | Per-alias assets named with the **bare alias** hex (`6a616d6573` = "james"), several with `total_supply: 0` (burned). |
| Koios `asset_addresses` for `student_state_id` + `g{alias}` | **Empty.** The recipient's Access Token global-state asset (`g` + alias, the `evidence.asset` value) is **not** under the course's `student_state_id` policy — it lives under a protocol-level policy that no Andamioscan payload in play here exposes. **Do not synthesize an asset explorer URL from these fields.** |
| `cardanoscan.io` deep links | **403** to any non-browser client, for valid and invalid paths alike. |
| `cexplorer.io` deep links | **200** for valid *and* bogus paths (SPA). |

The last two rows are why this plan does **not** ship a public-explorer deep
link: neither candidate explorer can be probed server-side in a way that
distinguishes a working URL shape from a broken one, and shipping an unverified
link shape onto a trust surface is exactly the kind of unearned claim this
work exists to avoid.

---

## Why signature validity is not achievable here

This is the load-bearing negative conclusion, so it is argued rather than
asserted.

**There is exactly one signed credential on the live host.** The flagship badge
`ae192632….e9b5343186….svg` is baked (`proofValue` present in its
`<openbadges:credential>` CDATA); the other 57 are presentation-only
(`badges/_registry.json`: 1 × `"signed": true`, 57 × `"signed": false`). So the
state is not vacuous — there *is* something to verify — but the population is one.

**Verifying it genuinely requires RDF canonicalization.** The proof is
`eddsa-rdfc-2022`: the signature is over the hash of the canonical
(URDNA2015/RDFC-1.0) N-Quads serialization of the JSON-LD document. There is no
shortcut. You cannot check it against the raw JSON bytes, and you cannot infer
it from the presence of a `proof` block. Doing it correctly needs:

1. **Full JSON-LD expansion** against the three production contexts
   (`w3.org/ns/credentials/v2`, the OB 3.0 3.0.3 context, and
   `credentials.andamio.io/context/v1.jsonld`).
2. **RDF dataset canonicalization** — URDNA2015, including the blank-node
   labelling algorithm.
3. **Ed25519 verify** over the resulting hash.

Step 3 alone is fine: `crypto.subtle` now supports Ed25519 in current browsers,
behind a capability check. Steps 1 and 2 are the blocker. The only correct route
is to vendor a real implementation (`jsonld` + `rdf-canonize`, the same stack
`issuer-service/package.json` already depends on) — hundreds of kilobytes of
bundled third-party JavaScript, which would have to be added to the Docker
`COPY` allowlist and `scripts/ci/check-allowlist.sh`, i.e. become
**served, trust-critical code on the forever-public host**. Hand-rolling
URDNA2015 to get the bundle smaller is not a serious option for a trust surface.

**Inferring validity is forbidden, and the difference is not cosmetic.** A badge
being baked proves an issuance pipeline ran; it proves nothing about whether the
bytes now on disk still match the signature. The two failure modes this repo
already guards against elsewhere — a mutated published context
(`docs/solutions/conventions/never-mutate-published-jsonld-context.md`) and
signing-key drift (the issuer service's fail-closed boot check) — both produce
a badge that *looks* baked and *fails* verification. A "signature valid" label
derived from `signed: true` would be wrong in precisely the cases it matters.

**The correct home already exists.** `issuer-service/src/issue.ts` exports
`verifyWith`, and the service already loopback-verifies every credential it
signs (including the status bit) before it leaves the process, using a closed,
integrity-pinned document loader that performs zero network fetches. A
`GET /verify` route there is a small, well-understood addition. It is **not**
built in this pass because:

- ~~The service cannot be deployed until the Phase 2 ops gate closes, so the
  endpoint would be dead code behind an LB route that does not exist.~~
  **Void — see the correction above.** The gate closed 2026-07-23 and the route
  is live; the endpoint would not be dead code.
- `issuer-service/README.md` states the service registers **no** route outside
  `/credentials/*` (plan Unit 4). Adding a public route to the one process that
  will ever hold KMS sign permission is a trust-surface change that belongs with
  the ops-gate review, not ahead of it.

So `anchored+signature-valid` is **deferred to Phase 2 close**, and the hosted
surface says `signature not checked here` — which is true, and which is the
correct answer under the honesty posture.

---

## Requirements

- **R1** — The holder view answers the question its URL asks: for the stem in
  the URL, an explicit verdict for that specific `(badge, holder)` pair,
  rendered before the badge list.
- **R2** — `not-found` exists as a designed, first-class state: the holder's
  live on-chain state does not record this credential.
- **R3** — `indeterminate` exists as a designed, first-class state: the live
  read did not complete, or completed in a way that leaves the answer unknown.
- **R4** — No state label asserts a signature is cryptographically valid. The
  state that today reads "Signed & anchored" is re-copied to say what is
  actually true: anchored, signature present, **not checked here**.
- **R5** — `revoked-signal` is **not** emitted by this surface, and the reason
  is recorded in the code so a future contributor does not add it casually.
- **R6** — Multi-party process visible in the rendered output: the **course
  owner** pseudonym per badge, an explicit statement that the **assessor** is
  not recorded on-chain for these credentials, and an **on-chain anchor**
  affordance for the course id.
- **R7** — Every new state degrades honestly. A soft dependency that fails
  never upgrades a state; it downgrades it or omits the field. No blank-filling
  (matching `map-credential.ts`'s omit-never-blank rule for `assessor`).
- **R8** — `docs/verifier-guidance.md` states which states the Andamio-hosted
  surfaces can and cannot produce, so a verifier reading the state table is not
  misled into thinking the hosted view produces all of them.

---

## Key Technical Decisions

### KTD-1 — Arrival verdict is computed from the holder-state read, not the registry

The verdict for the URL's stem is derived from `holderStems(holderState)` —
the raw on-chain claim set — **not** from the intersection with
`badges/_registry.json`. The registry is repo metadata (titles + baked flag); a
stem missing from it means "we have no badge art", not "the holder does not hold
it". Deriving the verdict from the registry would report `not-found` for a
credential the holder genuinely holds. The badge *list* keeps the registry
intersection (it needs art and titles to render a card); the *verdict* does not.

### KTD-2 — `revoked-signal` is never emitted, and the code says why

Absence from the holder's current global state is exactly what a burn/transfer
looks like — and exactly what indexer lag and a very recent claim look like. The
deployment plan is explicit: surfacing a held, valid credential as revoked is
worse than an outage, so `indeterminate` is required whenever freshness is
inconclusive. Client-side, freshness is **always** inconclusive (no freshness or
confirmation-depth signal exists on the Andamioscan responses, and no by-holder
claim-event index exists to establish that a claim ever happened). Therefore the
holder view emits `not-found` for absence, with copy that names indexer lag and
a recent claim as live possibilities, and never `revoked-signal`.

### KTD-3 — Course owner comes from one extra request, and is a soft dependency

`/holder-api/users/{alias}/courses/completed` returns `owner` for every course
the holder completed — one request covers all badges. It is fetched in the same
`Promise.all` as the state + registry reads but is **soft**: a failure leaves
`courseOwner` null and the attribution line is omitted, never blank-filled and
never fabricated. The holder-state read stays the only hard dependency, so R6 of
the #73 plan is untouched.

### KTD-4 — On-chain anchor: the verified Andamioscan course link plus the copyable id

The credential's claim transaction hash is not reachable client-side (see
Evidence). What *is* reachable and verified is the course id — the on-chain
minting policy that **is** the course's identity, per `docs/verifier-guidance.md`
— and `https://andamioscan.io/courses/{course_id}`, probed as a real,
validity-discriminating URL. The course id is also rendered as a copyable
monospace value so a reader can take it to any public Cardano explorer, which is
the route `/badges/how-to-check` already walks. **A public-explorer deep link is
deliberately not shipped**: neither cardanoscan (403 to non-browsers) nor
cexplorer (200 for bogus paths) could be probed in a way that proves the URL
shape resolves, and an unverified link on a trust surface is an unearned claim.

### KTD-5 — Assessor is named as absent, not omitted silently

`map-credential.ts` omits `assessor` from the signed credential because the
on-chain claim event carries `alias` / `course_id` / `credential_hash` /
`credentials` only. The course-details payload does carry a `teachers` roster,
but a course teacher is not "the person who assessed this credential" — binding
them would be an inference the chain does not support, and rendering a roster
under an "Assessor" heading is exactly the overclaim this work exists to
prevent. The rendered output therefore **names the absence** rather than
dropping the party from the four-party story the page already tells.

### KTD-6 — State names track the plan's vocabulary

`anchored` / `signed` / `suspended` / `unknown` become
`anchored` / `signature-unavailable` / `suspended` / `indeterminate`, plus the
new `not-found` on the verdict. The mapping to the plan's five:

| Plan state | Surface value | Copy |
|---|---|---|
| `anchored+signature-valid` | *(not emitted)* | — |
| `anchored+signature-unavailable` | `anchored` (no signature on the artifact) | "Anchored on-chain" |
| `anchored+signature-unavailable` | `signature-unavailable` (proof present, unchecked) | "Anchored · signature not checked here" |
| *(suspension overlay, P1bis-02/03)* | `suspended` | "Suspended · key-version" |
| `indeterminate` | `indeterminate` | "Indeterminate · state unavailable" |
| `not-found` | `not-found` (verdict only) | "Not found for this holder" |
| `revoked-signal` | *(never emitted — KTD-2)* | — |

Suspension stays an overlay rather than one of the five, matching the plan: the
five states are about the anchor + signature, while the key-epoch bit is a
separate, orthogonal signal (P1bis-03 specifies suspended-state rendering as its
own bullet).

---

## Scope Boundaries

**In scope:** the arrival verdict and its three reachable states on the holder
viewer; the state-vocabulary rename and copy; the course-owner attribution and
its soft-dependency fetch; the assessor-absent statement; the on-chain anchor
affordance; the shell legend rewrite; tests on both the client module and the
generator; the verifier-guidance state-surface mapping; CI smoke assertions.

**Explicitly not in scope:**

- **Client-side Data Integrity verification.** See
  [Why signature validity is not achievable here](#why-signature-validity-is-not-achievable-here).
- **A `GET /verify` endpoint on `credential-badges-issuer`.** Designed above.
  **Not** blocked on the ops gate — that closed 2026-07-23 and the service is
  live. Blocked only on a trust-surface review of adding a public route to the
  sign-permissioned process.
- **`revoked-signal`.** KTD-2. Blocked on an upstream freshness /
  confirmation-depth signal and a by-holder claim-event index, neither of which
  exists.
- **The claim transaction hash on the hosted surface.** Blocked on the same
  missing claim-event index; the alternative (the O(index-pages) discovery scan)
  is a server-side operation, not a browser one.
- **A public-explorer deep link.** KTD-4 — unverifiable URL shape.
- **`badges/how-to-check` and the badge-class page.** The class-grain page makes
  no per-holder claim, so it has no verdict to render. Left alone.
- **The `<andamio-badge>` web component.** It runs cross-origin and cannot fetch
  the host, so it has no live state and its existing attribute-driven
  never-overclaim gate is already correct. Left alone.
- **`ROADMAP.md`.** Two PRs are in flight against it (#88, #90); the Phase 3
  checklist update lands with whichever settles last.

---

## Implementation Units

### U1 — State vocabulary + arrival verdict (`badges/_holder.js`)

- Export `BADGE_STATES` and `VERDICTS` as the named vocabulary, so tests and
  future callers reference constants rather than string literals.
- `badgeStateFor({signed, keyEpochSuspended})` — extract today's inline
  branching into a named pure function, with the explicit-boolean rule intact
  (only a confirmed `false` reads as not-suspended; `null`/non-boolean falls to
  `indeterminate`).
- `arrivalVerdict({ok, holderState, arrivedStem, keyEpochSuspended, registry})`
  — new pure function returning `{state, stem}`. `not-found` when the stem is
  well-formed and absent from `holderStems`; `indeterminate` when the read
  failed or the stem is missing/malformed; otherwise the badge's own state.
- `loadHolderView` gains the soft `courses/completed` fetch and returns
  `verdict` alongside `badges`.
- `renderVerdict` writes the verdict into the shell's new
  `[data-holder-verdict]` region, before the list.
- Per-badge card gains the course-owner line, the anchor link, and — on the
  arrived-from badge — nothing extra (the verdict carries it).

### U2 — Shell copy + hooks (`generator/holder.py` → `badges/_holder.html`)

- New `[data-holder-verdict]` region with a static pre-JS placeholder.
- Legend rewritten from three bullets to the five surfaced states plus the
  suspension overlay, with the `not-found` bullet naming indexer lag and a
  recent claim as live possibilities.
- New "Who stands behind this credential" section: course owner (shown per
  badge), assessor (named as not recorded on-chain), chain, Andamio — mirroring
  the four-party language already in `generator/explainers.py` and
  `docs/verifier-guidance.md`.
- Existing honesty caveat preserved verbatim — the wording gate in
  `generator/tests/test_holder.py` (`does not itself assert a signature`,
  `convenience view, not an independent verifier`, no `any OB3 verifier`) must
  keep passing untouched.
- Regenerate via `make holder`; byte-parity test enforces the commit.

### U3 — Tests

- `tools/holder-viewer.test.ts`: verdict matrix (held / not-held / read-failed /
  malformed stem), the rename, the soft owner dependency (failure → null owner,
  view still ok), and a **negative test that no code path can produce
  `revoked-signal`**.
- `generator/tests/test_holder.py`: new hook present, five state labels present
  in the legend, assessor-absent statement present, and the existing
  no-overclaim assertions unchanged.

### U4 — Verifier guidance + CI

- `docs/verifier-guidance.md`: a short subsection under "What does a
  verification result mean?" mapping each state to where it is produced, and
  stating plainly that **no Andamio-hosted surface asserts signature validity
  today**.
- `.github/workflows/ci.yml`: extend the existing holder-shell docker smoke to
  assert the verdict hook and the not-found copy are in the delivered HTML.

---

## Risks

| Risk | L | I | Mitigation |
|---|---|---|---|
| A reader takes "Anchored on-chain" as "fully verified" | Med | Med | The verdict region states the anchor claim and the signature caveat in one place, above the list; the existing page-level caveat is unchanged and still links `/badges/how-to-check`. |
| `not-found` shown for a genuine credential during indexer lag | Med | Med | The `not-found` copy names indexer lag and a recent claim explicitly and says the chain is authoritative — the same treatment suspension already gets. This is the honest failure direction: an under-claim, not an over-claim. |
| The extra `courses/completed` request slows the view | Low | Low | Issued in the same `Promise.all` as the existing two reads; soft-failing, under the same abort timeout. |
| `courses/completed` shape drifts upstream | Low | Low | Soft dependency — a shape change yields a null owner and an omitted line, never a wrong owner. Same posture as the status-list degrade. |
| Someone later adds `revoked-signal` from absence alone | Low | High | KTD-2 recorded in the module header **and** enforced by a negative test in `tools/holder-viewer.test.ts`. |

## Dependencies

- ~~**Phase 2 ops gate** (6 items, private ops repo)~~ — **CLOSED 2026-07-23**;
  the issuer service is deployed and `/credentials/*` is live. This is no longer
  a dependency of `anchored+signature-valid`.
- **Upstream Andamioscan**: a by-holder or by-course credential-claim index, and
  a response freshness / confirmation-depth signal. Together these unblock the
  claim-tx explorer link and `revoked-signal`. Neither exists today.

## Sequencing

U1 → U2 (the shell hooks must exist before the client can write into them) →
U3 → U4. U2 requires `make holder` and a committed regeneration; the byte-parity
test fails loudly otherwise.
