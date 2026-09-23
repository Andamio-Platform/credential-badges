# Runbook — giving a badge art, changing it, removing it

Badge art is a hand-set JPEG drawn inside a badge's core plate, behind a scrim
that keeps the titles readable. Andamio sets it per badge or per course
(credential-badges#131). This runbook puts art on live badges without losing a
baked signature, and clears every cache that would otherwise keep serving the
old picture.

> **Art is drawn only.** It never enters the credential JSON or any signature.
> Changing it is rebuild + re-bake, never re-sign. If any file under
> `signing/class-artifacts/` changes at any step, **stop**: something is wrong.
> Art proves nothing about a credential. Public copy must never say or imply
> that it is signed or verifiable.

## 1. The art spec

`generator/art.py` enforces all of this. A bad file fails the build, the OG
build, CI and the render image build before anything is written.

| Rule | Value |
|---|---|
| Format | JPEG only. WebP draws as blank in the pinned rasterizer (`@resvg/resvg-js` 2.6.2), with no error. PNG makes the SVG about five times heavier. |
| Encoding | 8-bit, baseline or progressive, grayscale or YCbCr (no CMYK, no 12-bit) |
| Shape | Square, 824–1024 px per edge |
| Size | At most 160 KiB on disk |
| Metadata | None. No EXIF/XMP (APP1), ICC (APP2), Photoshop (APP13), Adobe (APP14) or comment (COM) segments |

**Where files go.** Under `generator/art/`, named by key. Lowercase hex, `.jpg`
exactly.

| File | Applies to |
|---|---|
| `generator/art/<course_id>.<slt_hash>.jpg` | one badge |
| `generator/art/<course_id>.jpg` | every badge of the course that has no per-badge file |

Lookup order: per-badge file, then course file, then no art. There is no
per-badge opt-out: removing a per-badge file makes that badge fall back to the
course art, not to no art.

Never put art under `badges/`. That directory is publicly served.
`generator/` ships in the render image and is never served.

## 2. Export the file (macOS)

Convert to sRGB first, then strip every metadata segment.

```bash
# 1. Resize to a square edge (824–1024) and convert to sRGB.
sips -z <edge> <edge> -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" \
  -s format jpeg -s formatOptions 80 in.png --out tmp.jpg

# 2. Strip all metadata. jpegtran comes from libjpeg-turbo: brew install jpeg-turbo
jpegtran -copy none -optimize tmp.jpg > generator/art/<key>.jpg

# 3. Validate. Lists each file and how many credentials.json badges it reaches.
python3 generator/art.py --check
```

- **Convert before you strip.** Stripping a Display P3 or Adobe RGB profile
  without converting shifts the colours.
- **Plain `sips` or Preview output is rejected.** It carries APP1 (and APP13).
  Step 2 is not optional.
- **Over 160 KiB?** Busy art compresses badly. Lower `formatOptions` or the
  edge, and re-run all three steps.
- "no credentials.json badge" in the check output is not a failure. It means
  the key is on-demand only, or mistyped. Check which before you go on.

## 3. Rules before you start

- **Committing art publishes it.** This repo is public. A course's art lands in
  the same change that releases or updates its badges, never before.
- **Try one badge first.** Add a per-badge file, run the procedure, look at the
  result. Only then promote it to the course file. A course file changes every
  badge of the course at once.
- **Legibility gate.** Before any bake, scratch-build the badge and view it at
  1024 px (step 4.2). Every title and hash line must be readable over the real
  art. If not, change the art. The scrim is fixed.
- **Never run `make badges`.** It regenerates every badge and strips every baked
  signature (credential-badges#128). Build only the stems you mean to change.
- Work on a feature branch with a clean tree. Run `npm ci` in `imaging/` and
  `signing/` once. Set `export PYTHONDONTWRITEBYTECODE=1` and clear
  `generator/__pycache__` so a stale bytecode file cannot mask the new art
  (`docs/solutions/runtime-errors/stale-pycache-bytecode-masks-source-edits.md`).

## 4. Procedure

### 4.1 Classify every stem the change reaches

A per-badge file reaches one stem. A course file reaches every stem of the
course that has no per-badge file. List a course's committed stems:

```bash
python3 -c "import json,sys; [print(r['course_id']+'.'+r['slt_hash']) for r in json.load(open('generator/credentials.json')) if r['course_id']==sys.argv[1]]" <course_id>
```

Drop any stem that has its own per-badge file. Then sort each remaining stem:

| Stem is… | How to tell | Path |
|---|---|---|
| committed + signed | `badges/<stem>.svg` and `signing/class-artifacts/<stem>.json` both exist | 4.2 → 4.3 → 4.4 → 4.6 |
| committed + unsigned | `badges/<stem>.svg` exists, no class artifact | 4.2 → 4.4 → 4.6 |
| on-demand | no `badges/<stem>.svg` (served by the render service) | 4.5 |

**A course file always takes the render lane (4.5) too**, even when every
current badge of the course is committed. A module credential added later is
served on demand. Without the render deploy it would render and cache with no
art.

### 4.2 Scratch-build the committed stems (signed and unsigned)

```bash
S=$(mktemp -d)
python3 generator/build.py "$S" --only <stem> [--only <stem> ...]

# Legibility gate: view each at 1024 px over the real art.
node --experimental-strip-types imaging/rasterize.ts "$S/<stem>.svg" "$S/<stem>.png"
open "$S/<stem>.png"

# Copy only those SVGs in. Nothing else.
cp "$S/<stem>.svg" badges/
```

`build.py` validates the whole art directory before it writes anything. A bad
file exits non-zero with every problem listed.

### 4.3 Re-bake each signed stem

The copied SVG is unbaked. Put its signed class artifact back:

```bash
cd signing && npm run bake:class -- --badge <stem> && cd ..
```

Run it once per signed stem. It refuses a dry-run artifact, a mismatched id and
an artifact without a proof, and re-reads the file from disk to confirm the
round trip.

**Gates. All must pass before you continue:**

```bash
git diff --exit-code main -- signing/class-artifacts/   # zero diff: art never touches a signed artifact
python3 generator/tests/test_baked_signatures.py        # every class artifact extracts byte-exact from its SVG
make verify                                             # rings decode, committed badge and a placeholder-art badge
python3 generator/tests/test_render_parity.py           # committed badges match a fresh build
git diff --stat main -- badges/                         # only the intended stems
```

A failure in the first two means a signed badge went out unbaked, or a signed
artifact changed. Stop and fix it. Never commit around it.

### 4.4 Re-rasterize each committed stem's PNG and OG card

Run after the bake, so the rasters come from the shipped SVG.

```bash
# Download PNG (1024x1024)
node --experimental-strip-types imaging/rasterize.ts badges/<stem>.svg badges/<stem>.png

# OG card (1200x630): og.py writes every card; compose only the ones you changed.
python3 generator/og.py "$S/og"
mkdir -p "$S/og1" && cp "$S/og/<stem>.og.svg" "$S/og1/"
(cd imaging && node --experimental-strip-types compose-og.ts "$S/og1")   # writes badges/<stem>.og.png
```

Then re-run the last gate: `git diff --stat main -- badges/` should list only
`<stem>.svg`, `<stem>.png` and `<stem>.og.png` for the intended stems.

Commit the art file, the SVGs, PNGs and OG cards together, open a PR, and merge
it. Tags go on the merged commit on `main`.

### 4.5 Render lane (on-demand stems, and every course file)

On-demand SVGs render in the render service and are cached in GCS. The new art
reaches them only through a render deploy, then a cache clear.

1. **Deploy the render service.** Push the next `vrender-*` tag on the merged
   commit (`DEPLOY.md`, "Deploy = push a version tag"):

   ```bash
   git tag -l 'vrender-*' --sort=-v:refname | head -1   # current; bump it
   git tag vrender-<next> && git push origin vrender-<next>
   ```

   `deploy-render.yml` builds `service/Dockerfile`. Its art check fails the
   image build on bad art, so a green build means the art is valid.

2. **Wait until the new revision serves 100% of traffic.** Read-only check:

   ```bash
   gcloud run services describe credential-badges-render \
     --region us-central1 --project andamio-credentials \
     --format='yaml(status.latestReadyRevisionName,status.traffic,spec.template.spec.containers[0].image)'
   ```

   The image must end in your tag, and the traffic entry for the latest ready
   revision must show `percent: 100`. Do not invalidate before that. The old
   revision would re-render without art and re-cache it.

3. **List the course's cache keys.** Cache objects are named
   `<course_id>.<slt_hash>.svg`. The bucket is the render service's
   `BADGE_CACHE_BUCKET` env var (visible in the describe output with
   `--format=yaml`).

   ```bash
   gcloud storage ls "gs://$BADGE_CACHE_BUCKET/<course_id>.*" | sed 's|.*/||'
   ```

   For a per-badge file, the one key is `<stem>.svg`. Check the listing's
   output shape before piping it on; this command has not been run against the
   live bucket.

4. **Invalidate.**

   ```bash
   python3 scripts/cache-admin.py invalidate <course_id>.<slt_hash>.svg [...]
   ```

   It skips committed badge names (they are served from disk, never the cache)
   and malformed names. Deletion is safe: a badge re-renders on the next
   request. Setup is in `docs/cache.md`.

5. **Invalidate again after a short drain.** A request that was in flight on
   the old revision can still write an art-less SVG to the cache. Wait longer
   than the request timeout
   (`gcloud run services describe credential-badges-render --region us-central1 --project andamio-credentials --format='value(spec.template.spec.timeoutSeconds)'`),
   list the keys again and run `invalidate` a second time.

### 4.6 Static lane (committed stems)

Committed SVGs, PNGs and OG cards are served from disk by the static host.
Push the next `v[0-9]*.*.*` tag on the merged commit (`DEPLOY.md`). Check
`AGENTS.md` for how version numbers are chosen.

```bash
git tag -l 'v[0-9]*' --sort=-v:refname | head -1   # current; bump it
git tag v<next> && git push origin v<next>
```

When both lanes apply, run 4.5 first, then 4.6.

## 5. Verify on the public host

Check one committed and one on-demand badge of the course:

```bash
curl -s https://credentials.andamio.io/badges/<stem>.svg | grep -c '<image'   # expect 1
```

A removed art file expects `0`. Also open `https://credentials.andamio.io/badges/<stem>.png`
for a committed stem and look at it.

## 6. What stays stale

- **Browsers and CDNs:** up to 24 hours. Every `/badges/` response is
  `Cache-Control: public, max-age=86400`, from disk or from the render service.
- **Social scrapers** hold OG images longer and on their own schedule.
  Re-scrape the share page URL (`https://credentials.andamio.io/badges/<stem>`)
  with [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) and
  the [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).
  X has no manual re-scrape.

## 7. Changing or removing art

Same procedure. Replace or delete the file, then classify, rebuild, re-bake,
re-rasterize, deploy and invalidate exactly as above.

- Removing a per-badge file falls back to the course art, if there is one.
- Removing the course file leaves badges with no per-badge file at no art.
  Their rebuilt SVG is byte-identical to the pre-art badge.

## Why no re-sign

A signed class artifact commits to the credential's content. The art is not
part of that content. It is drawn in the SVG outside the credential block and
outside the rings the decoder reads, and no signed credential carries
`achievement.image` (`docs/badge-registry.md` I3). So a rebuild changes only
drawn bytes, and a re-bake splices the unchanged artifact back in. A change to
any `signing/class-artifacts/*.json` file is a stop condition, not a step.

## Related

- Plan: [`../plans/2026-09-23-1740-feat-badge-plate-image-plan.md`](../plans/2026-09-23-1740-feat-badge-plate-image-plan.md)
- Art module: [`../../generator/art.py`](../../generator/art.py)
- Deploy lanes: [`../../DEPLOY.md`](../../DEPLOY.md)
- Cache tooling: [`../cache.md`](../cache.md)
- Baking and signing: [`class-artifact-signing.md`](class-artifact-signing.md)
- Vocabulary: [`../../CONCEPTS.md`](../../CONCEPTS.md) (Badge Art, Baking)
