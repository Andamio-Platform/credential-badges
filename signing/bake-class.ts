// bake-class.ts — bakes signed CLASS artifacts into their badge SVGs.
//
// The splice itself is tools/bake-signed-vc.ts, unchanged and already
// round-trip tested. This script is the batch driver plus the safety checks
// that only matter when you are about to modify committed, publicly served
// artifacts in bulk.
//
// Three refusals, each guarding a mistake that would be expensive to notice
// later:
//
//   1. NEVER BAKE A DRY-RUN ARTIFACT. A local-mode artifact is signed with an
//      ephemeral key and carries a did:example issuer. Baking one into a
//      committed badge would publish a badge whose proof no verifier on earth
//      can resolve. The issuer id is checked against the production DID before
//      any file is touched.
//   2. The artifact's badge id must match the SVG it is being baked into — a
//      transposed pair would put the wrong definition in a badge and still
//      round-trip cleanly.
//   3. Round-trip is re-verified after every bake. bakeSignedVc self-checks,
//      but this re-reads from disk, which is what actually ships.
//
// Usage:
//   npm run bake:class -- --badge <courseId>.<sltHash>
//   npm run bake:class -- --all

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bakeSignedVc, extractVc } from "../../tools/bake-signed-vc.ts";
import { registry, classCredentialId, type BadgeRecord } from "./class-credential.ts";
import { ISSUER_DID } from "./document-loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const ARTIFACT_DIR = path.join(HERE, "class-artifacts");
const BADGES_DIR = path.join(REPO, "badges");

const NETWORK = "mainnet";

function badgeId(rec: BadgeRecord): string {
  return `${rec.course_id}.${rec.slt_hash}`;
}

/** Refuses anything that is not a production-signed artifact for this badge. */
function assertProductionArtifactFor(rec: BadgeRecord, raw: string): void {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${badgeId(rec)}: artifact is not valid JSON`);
  }

  const issuerId = typeof parsed.issuer === "string" ? parsed.issuer : parsed.issuer?.id;
  if (issuerId !== ISSUER_DID) {
    throw new Error(
      `${badgeId(rec)}: issuer is "${issuerId}", expected "${ISSUER_DID}" — ` +
      `this looks like a DRY-RUN artifact and must never be baked into a committed badge`,
    );
  }

  const expectedId = classCredentialId(rec, NETWORK);
  if (parsed.id !== expectedId) {
    throw new Error(
      `${badgeId(rec)}: artifact id is "${parsed.id}", expected "${expectedId}" — ` +
      `refusing to bake one badge's definition into another`,
    );
  }

  const proof = Array.isArray(parsed.proof) ? parsed.proof[0] : parsed.proof;
  if (!proof?.proofValue) {
    throw new Error(`${badgeId(rec)}: artifact carries no proof — refusing to bake`);
  }
}

async function bakeOne(rec: BadgeRecord): Promise<{ badgeId: string; bytes: number }> {
  const id = badgeId(rec);
  const artifactPath = path.join(ARTIFACT_DIR, `${id}.json`);
  const svgPath = path.join(BADGES_DIR, `${id}.svg`);

  let vc: string;
  try {
    vc = await fs.readFile(artifactPath, "utf8");
  } catch {
    throw new Error(`${id}: no signed artifact at ${path.relative(REPO, artifactPath)} — sign first`);
  }
  assertProductionArtifactFor(rec, vc);

  if (!existsSync(svgPath)) {
    throw new Error(
      `${id}: no badge art at ${path.relative(REPO, svgPath)} — this badge is ` +
      `withheld from rendering (generator/build.py SKIP_COURSES) and cannot be baked`,
    );
  }
  const svg = await fs.readFile(svgPath, "utf8");
  const baked = bakeSignedVc(svg, vc);

  const tmp = `${svgPath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, baked);
  await fs.rename(tmp, svgPath);

  // Re-read from disk: bakeSignedVc self-checks its own return value, but what
  // ships is the file, and that is what this verifies.
  const onDisk = await fs.readFile(svgPath, "utf8");
  if (extractVc(onDisk) !== vc) {
    throw new Error(`${id}: round-trip FAILED after write — the badge on disk does not extract to its artifact`);
  }

  return { badgeId: id, bytes: Buffer.byteLength(baked) };
}

async function main() {
  const argv = process.argv;
  const badge = argv[argv.indexOf("--badge") + 1];
  const all = argv.includes("--all");

  if (!all && (argv.indexOf("--badge") === -1 || !badge)) {
    console.error("usage: bake-class.ts (--badge <cid>.<slt> | --all)");
    process.exit(2);
  }
  if (all && argv.indexOf("--badge") !== -1) {
    console.error("--badge and --all are mutually exclusive");
    process.exit(2);
  }

  // Same scoping as signing: `--all` is every badge that has art. A registry
  // entry withheld from rendering has nothing to bake into.
  const withheld = registry().filter(
    (r) => !existsSync(path.join(BADGES_DIR, `${badgeId(r)}.svg`)),
  );
  const targets = all
    ? registry().filter((r) => !withheld.includes(r))
    : registry().filter((r) => badgeId(r) === badge);

  if (all && withheld.length) {
    console.log(`skipping ${withheld.length} registered badge(s) with no committed art`);
  }
  if (targets.length === 0) {
    console.error(`badge not in registry: ${badge}`);
    process.exit(1);
  }

  console.log(`baking ${targets.length} class artifact(s)`);
  const done: string[] = [];
  for (const rec of targets) {
    const r = await bakeOne(rec);
    done.push(r.badgeId);
    console.log(`  ✓ ${r.badgeId}  (${r.bytes} bytes)`);
  }

  console.log(`\nBAKE OK — ${done.length} badge(s) now carry a signed class artifact`);
  console.log("next: review the diff, then run the badge suites before committing");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\nREFUSED: ${e.message}`);
    process.exit(1);
  });
}
