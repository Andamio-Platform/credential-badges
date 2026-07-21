// BAKED-BADGE INVARIANT — the self-verifying badge guard (Rung 7).
//
// The committed badge SVG for the signed subject credential
// (badges/<courseId>.<sltHash>.svg) carries the Rung-6 KMS-signed OB3 VC in
// its <openbadges:credential> CDATA body. If anything re-renders that badge
// from the generator (which emits the unsigned hook), reformats the embedded
// bytes, or drifts the proof/anchor, this test goes RED — a loud CI failure
// instead of a silently un-verifiable badge.
//
// Hermetic: no network, no KMS — reads only committed repo files. Also unit-
// tests the bake/extract round trip on synthetic inputs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { bakeSignedVc, extractVc } from "./bake-signed-vc.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// The signed subject (Rung 6) — full identifiers, never truncated.
const COURSE_ID = "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df";
const SLT_HASH = "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db";
const CLAIM_TX = "7cb75099e81644b8ce2442e2cacf4e6dafdba54991a8599e0f88f5432dd2cb03";
const VERIFICATION_METHOD = "did:web:credentials.andamio.io#key-2026-07";

const BADGE_PATH = join(REPO, "badges", `${COURSE_ID}.${SLT_HASH}.svg`);
const SIGNED_VC_PATH = join(REPO, "spike", "signer-spike", "signed-credential.json");

const badgeSvg = readFileSync(BADGE_PATH, "utf8");
const signedVc = readFileSync(SIGNED_VC_PATH, "utf8");

// A minimal gen.py-shaped SVG (unsigned hook, verify="") for synthetic tests.
const SYNTH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="https://purl.imsglobal.org/ob/v3p0" viewBox="0 0 1024 1024" width="1024" height="1024">' +
  "<metadata><![CDATA[\n{\"note\": \"presentation\"}\n]]></metadata>" +
  '<openbadges:credential verify=""><![CDATA[\n{"unsigned": true}\n]]></openbadges:credential>' +
  '<defs></defs><circle cx="512" cy="512" r="500"/></svg>';

test("round trip: extract(bake(svg, vc)) is byte-identical, trailing newline preserved", () => {
  for (const vc of ['{\n  "proof": []\n}\n', '{\n  "proof": []\n}']) {
    const baked = bakeSignedVc(SYNTH_SVG, vc);
    assert.equal(extractVc(baked), vc);
  }
});

test("bake preserves every byte outside the <openbadges:credential> element", () => {
  const baked = bakeSignedVc(SYNTH_SVG, '{"proof": []}');
  const [preU, postU] = splitAroundElement(SYNTH_SVG);
  const [preB, postB] = splitAroundElement(baked);
  assert.equal(preB, preU);
  assert.equal(postB, postU);
});

test("baked element is the OB3 embedded-proof form: no verify attribute, single CDATA", () => {
  const baked = bakeSignedVc(SYNTH_SVG, '{"proof": []}');
  assert.ok(baked.includes("<openbadges:credential><![CDATA["));
  assert.ok(!baked.includes("<openbadges:credential verify="));
});

test("bake refuses: ]]> payloads, unsigned credentials, non-JSON, missing/duplicate element", () => {
  assert.throws(() => bakeSignedVc(SYNTH_SVG, '{"proof": [], "x": "a]]>b"}'), /refusing/);
  assert.throws(() => bakeSignedVc(SYNTH_SVG, '{"unsigned": true}'), /no proof block/);
  assert.throws(() => bakeSignedVc(SYNTH_SVG, "not json"), /not valid JSON/);
  assert.throws(() => bakeSignedVc("<svg></svg>", '{"proof": []}'), /no <openbadges:credential>/);
  const twoElements = SYNTH_SVG + '<openbadges:credential><![CDATA[\n{}\n]]></openbadges:credential>';
  assert.throws(() => bakeSignedVc(twoElements, '{"proof": []}'), /more than one/);
});

// ---- The committed-artifact invariants ----

test("committed badge embeds the signed credential BYTE-FOR-BYTE", () => {
  assert.equal(extractVc(badgeSvg), signedVc);
});

test("committed badge element form: exactly one <openbadges:credential>, no verify attr, metadata intact", () => {
  assert.equal(badgeSvg.split("<openbadges:credential").length - 1, 1);
  assert.ok(badgeSvg.includes("<openbadges:credential><![CDATA["));
  assert.ok(!badgeSvg.includes("<openbadges:credential verify="));
  // the presentation <metadata> block (theme tokens) must survive the bake
  assert.ok(badgeSvg.includes("<metadata><![CDATA["));
  assert.ok(badgeSvg.includes('"andamio:theme"'));
  // visual envelope intact
  assert.ok(badgeSvg.startsWith("<svg "));
  assert.ok(badgeSvg.trimEnd().endsWith("</svg>"));
  assert.ok(badgeSvg.includes('viewBox="0 0 1024 1024"'));
  assert.ok(badgeSvg.includes('width="1024" height="1024"'));
});

test("embedded VC: proof block matches the signed credential exactly", () => {
  const embedded = JSON.parse(extractVc(badgeSvg));
  const signed = JSON.parse(signedVc);
  assert.deepEqual(embedded.proof, signed.proof);
  // and the proof is the Rung-6 production proof, not a stand-in
  assert.equal(embedded.proof.length, 1);
  assert.equal(embedded.proof[0].type, "DataIntegrityProof");
  assert.equal(embedded.proof[0].cryptosuite, "eddsa-rdfc-2022");
  assert.equal(embedded.proof[0].proofPurpose, "assertionMethod");
  assert.equal(embedded.proof[0].verificationMethod, VERIFICATION_METHOD);
  assert.equal(typeof embedded.proof[0].proofValue, "string");
  assert.ok(embedded.proof[0].proofValue.startsWith("z"));
});

test("embedded VC: anchor identifiers match the signed subject exactly (Rung 8.3 flat dialect)", () => {
  const embedded = JSON.parse(extractVc(badgeSvg));
  assert.equal(
    embedded.id,
    `urn:andamio:credential:mainnet:${COURSE_ID}:${SLT_HASH}:gjames`,
  );
  assert.equal(
    embedded.credentialSubject.achievement.id,
    `urn:andamio:course:${COURSE_ID}:${SLT_HASH}`,
  );
  // Decision-2 FLAT evidence dialect — network/policyId/asset/claimTxHash at
  // the entry top level; the Rung-6 nested onChainAnchor/onChainAttestation
  // blocks are superseded and must be gone.
  const evidence = embedded.evidence[0];
  assert.deepEqual(evidence.type, ["OnChainCredentialAnchor", "Evidence"]);
  assert.equal(evidence.network, "mainnet");
  assert.equal(evidence.policyId, COURSE_ID);
  assert.equal(evidence.asset, "gjames");
  assert.equal(evidence.claimTxHash, CLAIM_TX);
  assert.ok(!("onChainAnchor" in evidence), "nested onChainAnchor superseded by flat dialect");
  assert.ok(!("onChainAttestation" in evidence), "nested onChainAttestation superseded by flat dialect");
  assert.equal(embedded.issuer.id, "did:web:credentials.andamio.io");
  // Multi-party attribution (P1bis-04): courseOwner present, assessor omitted
  // (the on-chain record names none — omitted, never blank-filled).
  assert.equal(embedded.courseOwner, "urn:andamio:mainnet:course-owner:gjames");
  assert.ok(!("assessor" in embedded));
});

test("embedded VC: credentialStatus is the key-epoch BitstringStatusListEntry (Decision 3)", () => {
  const embedded = JSON.parse(extractVc(badgeSvg));
  assert.deepEqual(embedded.credentialStatus, {
    id: "https://credentials.andamio.io/status/key-epoch-2026-07.json#0",
    type: "BitstringStatusListEntry",
    statusPurpose: "suspension",
    statusListIndex: "0",
    statusListCredential: "https://credentials.andamio.io/status/key-epoch-2026-07.json",
  });
});

/** Split an SVG into [before-element, after-element] around the single
 *  <openbadges:credential> element. */
function splitAroundElement(svg: string): [string, string] {
  const start = svg.indexOf("<openbadges:credential");
  const close = "</openbadges:credential>";
  const end = svg.indexOf(close, start) + close.length;
  assert.ok(start !== -1 && end > start);
  return [svg.slice(0, start), svg.slice(end)];
}
