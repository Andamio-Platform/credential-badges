# Share-page mockups — 2026-07-27 · **retired 2026-08-01**

**The files are gone. The work they were for shipped.** This page stays so that the links
to it from `#99`, `#101`, `#103` and `product-circle#150` still resolve to an explanation
rather than a 404.

Two interactive mockups of the per-badge share page lived here — `brand-conformant.html`
(the reference one) and `two-column.html`, plus PNG renders. Built by Product on
2026-07-27 as conversation pieces for a refinement want, and landed here by
[`#98`](https://github.com/Andamio-Platform/credential-badges/pull/98) because GitHub does
not accept HTML as an issue attachment.

**They did their job.** The restructure they argued for shipped in
[`#103`](https://github.com/Andamio-Platform/credential-badges/pull/103) as `v1.3.1`,
planned in [`#101`](https://github.com/Andamio-Platform/credential-badges/pull/101),
closing `#99`. **The live page at `credentials.andamio.io/badges/{stem}` is the reference
now** — it is current by construction, which no committed mockup can be.

## Why they were removed rather than kept

Their copy was wrong in four ways their own README documented — `PREPROD` when badges are
on mainnet, a bare `VERIFIED` stamp that overclaims what the page checks, *"signed
verification is rolling out"* (false at 58 of 58 since `v1.3.0`), and a verification claim
missing the Data-Integrity-capable ceiling that bounds it. `brand-conformant.html` also
depicted an issuer attribution naming the course owner, which has not shipped.

None of that was a defect while they were live design input, and the README said so at the
file. It becomes one once the design question is settled: a renderable page carrying a
false `VERIFIED` stamp, in a public repo, with nothing left to argue for, gets read as
intent by the next person or agent who finds it. Retiring it is cheaper than maintaining
it against a page that will keep moving.

They remain in git history if anyone needs them.

## What they got right, and where it lives now

**Identifiers wrap and are shown in full** — the full course id and credential hash, no
ellipsis, no truncation. If a layout cannot hold a full identifier, the layout changes.
This survived into `v1.3.1`, is pinned by the page tests, and is recorded as a hard
constraint on `#99`.

**Which share action is primary stays deliberately unresolved.** No research settles which
one earners actually choose, and Product would rather it be measured than designed — which
is why neither mockup had an orange primary. Hierarchy comes from grouping and ordering
until there is data.

## Issuer attribution

The one thing in `brand-conformant.html` that has *not* shipped is issuer attribution — it
named the course owner rather than the platform. That is tracked at `product-circle#181`,
is unplanned, and carries a data dependency. It is not blocked on anything here: when it is
planned it should be specified against the page as it exists then, not against a mockup
that predates it.
