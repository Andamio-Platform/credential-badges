# Share-page mockups — 2026-07-27

Two interactive mockups of the per-badge share page, built by Product on 2026-07-27 as
conversation pieces for a refinement want. **Neither is a spec.** They exist to make one
question concrete — can the page fit a single screen and give a holder one obvious next
step — and to prove the answer is yes. Solve it differently if that is better.

They are committed here rather than attached to an issue because GitHub does not accept
HTML as an issue attachment, and because this is the repo where the work would happen.

| File | What it is |
|---|---|
| [`brand-conformant.html`](./brand-conformant.html) | The restructure rendered against the Andamio brand canon — light ground, Inter / JetBrains Mono, the specimen-frame and stitch component contracts. This is the reference one. |
| [`brand-conformant.png`](./brand-conformant.png) | The above, rendered at 1440×1000 on 2026-07-31 |
| [`two-column.html`](./two-column.html) | The same restructure in the **current live styling**, so the difference you see is the layout and nothing else. Off-canon — dark ground, Archivo / Spline Sans Mono, `#EE6C3A` rather than brand orange `#FF6B35`, rounded corners against a canon that is square. Kept for the layout idea only. |
| [`two-column.png`](./two-column.png) | The above, rendered 2026-07-27 |

Both pull the real badge artwork from the live site, so they need a network connection and
they render exactly as production does. Resize the window to see the single-screen behaviour
and the collapse to one column.

## The want they illustrate

Nine actions currently sit in one row, identically styled, with no hierarchy. Seven serve
someone who earned the credential; two serve a developer embedding a badge. Those are
different visits competing for the same attention. Both mockups put the badge left and the
credential identity plus actions right, sized to one screen, with the embed actions
collapsed behind a disclosure.

**Which action should be primary is deliberately unresolved.** No research settles which
share action earners actually choose, and Product would rather it be measured than designed —
which is also why neither mockup has an orange primary button. Hierarchy comes from grouping
and ordering until there is data.

## Read the layout. Do not read the copy.

The mockups predate the current release and their text is out of date in four specific ways.
None of this is a proposal:

- **`PREPROD` in the frame footer is wrong.** Badges are on mainnet.
- **The bare `VERIFIED` stamp overclaims.** The live page does not assert that a signature is
  cryptographically valid, because it does not check one.
- **"Signed verification is rolling out" is now false** — every badge carries a signature as
  of the current release.
- **"Anyone can check this credential" is missing its ceiling.** The claim is bounded to
  Data-Integrity-capable OB 3.0 / VC verifiers, and that qualifier is load-bearing. See
  `docs/solutions/conventions/never-delete-a-qualifier-that-bounds-a-claim.md`.

**One further thing the mockups show that has not shipped:** `brand-conformant.html` names
*Gimbalabs · COURSE OWNER* as the issuer. That is a separate, currently unplanned product
want with a data dependency behind it — not part of the layout question, and not something
to build from this file. The live page's issuer attribution is unchanged by anything here.

## What the mockups get right and should survive

Identifiers wrap and are shown in full — the 64-character course id and credential hash are
complete, with no ellipsis and no truncation anywhere. If a layout cannot hold a full
identifier, the layout changes.
