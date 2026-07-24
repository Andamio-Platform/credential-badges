# `@andamio/andamio-badge`

The `<andamio-badge>` web component — embed an Andamio credential badge on any
site with a `<script>` tag and one element. It renders the badge card (image +
titles + an honest, baked-aware verified-state line) and links back to the
credential's display page. It's the upgrade path from the iframe embed snippet.

## Quick start (script tag)

Paste this where the badge should appear — the [badge display page][disp] gives
you a snippet with the values already filled in:

```html
<script type="module" src="https://credentials.andamio.io/embed/andamio-badge.js"></script>
<andamio-badge
  stem="ae192632…df.e9b53431…db"
  module-title="I can find a bug in the Cardano XP app."
  course-title="Join Cardano XP"
  signed></andamio-badge>
```

## Or install from npm

```sh
npm install @andamio/andamio-badge
```

```js
import "@andamio/andamio-badge"; // defines <andamio-badge>
```

The package is dependency-free vanilla JS — no build step required.

## Attributes

| Attribute | Required | Meaning |
|-----------|----------|---------|
| `stem` | yes | The badge id `{course_id}.{slt_hash}` (56 hex `.` 64 hex). A malformed stem renders an inert placeholder. |
| `module-title` | recommended | The learning-target title shown on the card. |
| `course-title` | recommended | The course title shown under it. |
| `signed` | no (boolean) | Present only for a **signed** (baked) credential. Controls the state label. |
| `host` | no | Override the badge host origin (must be `https://…`, no path). Defaults to `https://credentials.andamio.io`. A non-https or malformed value falls back to the default. |

## Verified state is presentational — the link is the trust anchor

The `signed` attribute sets the state label (`Signed & verifiable` vs
`Anchored on-chain`) and is provided by the badge host when it generates the
snippet. It is **presentational**: the load-bearing trust is the **View
credential** link, which opens the credential's display page on
`credentials.andamio.io`, where the real, baked-aware verification copy lives and
links to the full [how-to-check guide][check]. Only signed badges carry a
cryptographic proof you can check with a DI-capable OB 3.0 / VC verifier; most
badges are presentation-only and prove themselves by their on-chain anchor. The
component never claims a signature that isn't there.

## Styling

The component renders in a shadow root, so host-page CSS can't leak in. Size it
by styling the `<andamio-badge>` element (it's `display:inline-block`); the inner
card exposes a `::part(card)` for light customization.

[disp]: https://credentials.andamio.io
[check]: https://credentials.andamio.io/badges/how-to-check
