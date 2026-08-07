// sign-class.ts — signs CLASS artifacts (what a badge means), one per badge.
//
// Separate from sign.ts by design (plan KTD-7). `checkAnchor` takes NO
// parameters — sealed by issue #54 finding 4 so the checked subject and the
// mapped subject cannot diverge — and a class credential has no subject and no
// on-chain claim, so that gate is *inapplicable*, not merely inconvenient.
// Unsealing it to accommodate class signing would regress the control that
// makes holder signing safe. So this script gets its own gate:
//
//   THE GATE HERE IS REGISTRY MEMBERSHIP. A badge absent from
//   generator/credentials.json cannot be signed, and the check runs before any
//   signer is constructed — mirroring the refuse-before-any-upstream-read
//   posture of issuer-service/src/badge-registry.ts.
//
// Everything else is inherited from sign.ts rather than reinvented: the narrow
// vc.issue fallback, post-sign loopback verification, the exactly-once signer
// assertion, and atomic artifact writes.
//
// TRANSCRIPTS ARE NOT OPTIONAL. docs/runbooks/key-compromise.md treats "a KMS
// asymmetric-sign entry not attributable to a known, transcribed run" as a
// compromise trigger. A batch of 58 signs that leaves no record would either
// trip that trigger or, worse, quietly erode it. Every kms run writes a
// transcript before it exits.
//
// Usage:
//   # dry run — ephemeral key, no KMS, no production artifact
//   npm run sign:class -- --signer local --badge <courseId>.<sltHash>
//
//   # one production artifact (the de-risking step: validate before batching)
//   npm run sign:class -- --signer kms --badge <courseId>.<sltHash>
//
//   # the batch, after a single artifact has been externally validated
//   npm run sign:class -- --signer kms --all

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  issueWith,
  verifyWith,
  makeKmsSigner,
  makeLocalSigner,
  assertKmsKeyPinnedToLiveDid,
  VERIFICATION_METHOD_ID,
} from "./sign.ts";
import { makeCheckStatus } from "./check-status.ts";
import { clearContextCache, makeDocumentLoader } from "./document-loader.ts";
import { buildClassCredential, registry, type BadgeRecord } from "./class-credential.ts";
import { existsSync } from "node:fs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Production artifacts are committed; dry-run artifacts carry a did:example
// issuer and must never be mistaken for them. Routing dry-run output into the
// already-gitignored out/ makes that a property of the filesystem rather than
// a rule someone has to remember.
const KMS_OUT_DIR = path.join(HERE, "class-artifacts");
const DRY_OUT_DIR = path.join(HERE, "out", "class-artifacts");
const KMS_TRANSCRIPT_DIR = path.join(HERE, "transcripts");
const DRY_TRANSCRIPT_DIR = path.join(HERE, "out", "transcripts");

const outDir = (mode: Mode) => (mode === "kms" ? KMS_OUT_DIR : DRY_OUT_DIR);
const transcriptDir = (mode: Mode) => (mode === "kms" ? KMS_TRANSCRIPT_DIR : DRY_TRANSCRIPT_DIR);

const NETWORK = "mainnet";

/** A class artifact has no claim-tx block_time to date the proof to, and a
 *  wall-clock value would break byte-stability (R3). The badge's own identity
 *  is content-derived and immutable, so the proof is dated to the signing-key
 *  epoch — stable across re-signs under the same key, and naturally distinct
 *  after a rotation. */
const PROOF_CREATED = "2026-07-01T00:00:00Z";

type Mode = "local" | "kms";

interface SignResult {
  badgeId: string;
  outFile: string;
  proofValue: string;
  verificationMethod: string;
  sha256: string;
}

function badgeId(rec: BadgeRecord): string {
  return `${rec.course_id}.${rec.slt_hash}`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Wraps a raw signer with a counter this script owns, so the exactly-once
 *  invariant is asserted PER ARTIFACT rather than once for a whole batch.
 *  sign.ts's own counters are module-level and cumulative; reusing them across
 *  58 artifacts would make the assertion meaningless after the first. */
function countingSigner(inner: any) {
  const state = { calls: 0 };
  return {
    state,
    signer: {
      id: inner.id,
      algorithm: inner.algorithm,
      async sign(opts: any) {
        state.calls += 1;
        return inner.sign(opts);
      },
    },
  };
}

async function writeAtomically(file: string, contents: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, contents);
  await fs.rename(tmp, file);
}

async function signOne(
  rec: BadgeRecord,
  mode: Mode,
  loader: any,
  rawSigner: any,
  overrides?: Record<string, any>,
): Promise<SignResult> {
  // THE GATE: buildClassCredential refuses anything not in the registry, and
  // it runs before the signer is touched.
  const credential: any = buildClassCredential(rec, NETWORK);

  if (mode === "local") {
    // Loopback only: the verifier requires issuer == verification-method
    // controller, so the ephemeral controller stands in. A dry-run artifact is
    // never a production artifact and never gets committed.
    credential.issuer = { ...credential.issuer, id: rawSigner.id.split("#")[0] };
  }

  const { state, signer } = countingSigner(rawSigner);
  const signed: any = await issueWith(credential, signer, loader, PROOF_CREATED);

  if (state.calls !== 1) {
    throw new Error(
      `signer seam invoked ${state.calls} times for ${badgeId(rec)}, expected exactly 1 — refusing to write an artifact`,
    );
  }

  // Post-sign loopback verify, including the status bit, before anything is
  // written. An artifact that does not verify never reaches disk.
  await verifyWith(signed, loader, makeCheckStatus(mode === "kms" ? "live" : "committed"));

  // 1EdTech OB3 Plain-JSON schema requires proof in array form.
  if (!Array.isArray(signed.proof)) signed.proof = [signed.proof];

  const body = JSON.stringify(signed, null, 2) + "\n";
  const outFile = path.join(outDir(mode), `${badgeId(rec)}.json`);
  await writeAtomically(outFile, body);

  return {
    badgeId: badgeId(rec),
    outFile,
    proofValue: signed.proof[0].proofValue,
    verificationMethod: signed.proof[0].verificationMethod,
    sha256: sha256(body),
  };
}

async function writeTranscript(mode: Mode, results: SignResult[], startedAt: string): Promise<string> {
  const dir = transcriptDir(mode);
  await fs.mkdir(dir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const file = path.join(dir, `class-sign-${mode}-${stamp}.txt`);
  const lines = [
    `# class-artifact signing run`,
    `# mode:        ${mode}`,
    `# started:     ${startedAt}`,
    `# network:     ${NETWORK}`,
    `# artifacts:   ${results.length}`,
    `# signer calls: ${results.length} (exactly one per artifact, asserted)`,
    mode === "kms"
      ? `# verification method: ${VERIFICATION_METHOD_ID}`
      : `# DRY RUN — ephemeral key, no KMS call, artifacts are not production`,
    ``,
    ...results.map((r) => `${r.badgeId}  sha256=${r.sha256}  proofValue=${r.proofValue.slice(0, 24)}…`),
    ``,
  ];
  await writeAtomically(file, lines.join("\n"));
  return file;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    mode: get("--signer") as Mode | undefined,
    badge: get("--badge"),
    all: argv.includes("--all"),
  };
}

async function main() {
  const { mode, badge, all } = parseArgs(process.argv);
  if (mode !== "local" && mode !== "kms") {
    console.error("usage: sign-class.ts --signer local|kms (--badge <cid>.<slt> | --all)");
    process.exit(2);
  }
  if (!badge && !all) {
    console.error("refusing to run without --badge <cid>.<slt> or --all");
    process.exit(2);
  }
  if (badge && all) {
    console.error("--badge and --all are mutually exclusive");
    process.exit(2);
  }

  const all_ = registry();
  // `--all` means every badge that HAS art. Some registry entries are
  // deliberately withheld from rendering (generator/build.py SKIP_COURSES), and
  // signing one would spend a production signature on an artifact that can
  // never be baked. Keyed off the committed SVG rather than a duplicated skip
  // list, so this self-corrects if a withheld course is later rendered.
  const withheld = all_.filter(
    (r) => !existsSync(path.join(REPO, "badges", `${badgeId(r)}.svg`)),
  );
  const targets: BadgeRecord[] = all
    ? all_.filter((r) => !withheld.includes(r))
    : all_.filter((r) => badgeId(r) === badge);

  if (all && withheld.length) {
    console.log(
      `skipping ${withheld.length} registered badge(s) with no committed art: ` +
      `${withheld.map(badgeId).map((b) => b.slice(0, 12) + "…").join(", ")}`,
    );
  }
  if (targets.length === 0) {
    console.error(`badge not in registry: ${badge} — refusing (registry gate)`);
    process.exit(1);
  }

  console.log(`class signing: ${targets.length} artifact(s), mode=${mode}`);
  await fs.mkdir(outDir(mode), { recursive: true });

  let loader: any;
  let rawSigner: any;

  if (mode === "kms") {
    // Start from a provably empty context cache (issue #54 finding 2): every
    // document canonicalized or verified against comes fresh off the network.
    await clearContextCache();
    console.log("context cache cleared — all documents fetched fresh this run");
    await assertKmsKeyPinnedToLiveDid();
    console.log("live-DID key pin OK");
    loader = makeDocumentLoader();
    rawSigner = makeKmsSigner();
  } else {
    // Reuse sign.ts's proven loopback signer and its document-loader
    // overrides rather than hand-rolling a second ephemeral key path.
    const local = makeLocalSigner();
    rawSigner = local.signer;
    loader = makeDocumentLoader(local.overrides);
    console.log("DRY RUN — ephemeral key, zero KMS calls");
  }

  const startedAt = new Date().toISOString();
  const results: SignResult[] = [];
  for (const rec of targets) {
    const r = await signOne(rec, mode, loader, rawSigner);
    results.push(r);
    console.log(`  ✓ ${r.badgeId}  sha256=${r.sha256.slice(0, 16)}…`);
  }

  const transcript = await writeTranscript(mode, results, startedAt);
  console.log(`\n${mode === "kms" ? "KMS SIGN + VERIFY OK" : "DRY RUN SIGN + LOOPBACK VERIFY OK"}`);
  console.log(`artifacts: ${path.relative(REPO, outDir(mode))}`);
  console.log(`transcript: ${path.relative(REPO, transcript)}`);
  if (mode === "kms") {
    console.log(`verification method: ${results[0].verificationMethod}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\nREFUSED: ${e.message}`);
    process.exit(1);
  });
}
