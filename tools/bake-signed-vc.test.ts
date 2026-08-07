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
const VERIFICATION_METHOD = "did:web:credentials.andamio.io#key-2026-07";

const BADGE_PATH = join(REPO, "badges", `${COURSE_ID}.${SLT_HASH}.svg`);

// What a committed badge carries is the CLASS artifact — the definition of the
// badge, holder-free. `signed-credential.json` is still the committed
// HOLDER-credential fixture (it is what the PNG bake path and the expansion pin
// cover), it is simply no longer what lives inside a shared badge: a shared
// badge cannot name a holder without misreporting for every other holder of the
// same coordinate.
const CLASS_VC_PATH = join(
  REPO, "signing", "class-artifacts", `${COURSE_ID}.${SLT_HASH}.json`,
);
const HOLDER_VC_PATH = join(REPO, "signing", "signed-credential.json");

const badgeSvg = readFileSync(BADGE_PATH, "utf8");
const classVc = readFileSync(CLASS_VC_PATH, "utf8");
const holderVc = readFileSync(HOLDER_VC_PATH, "utf8");

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

test("committed badge embeds its CLASS artifact BYTE-FOR-BYTE", () => {
  assert.equal(extractVc(badgeSvg), classVc);
});

test("committed badge names NO holder — a shared badge is holder-free", () => {
  const embedded = extractVc(badgeSvg);
  assert.ok(!embedded.includes(":recipient:"), "a shared badge must not carry a recipient URN");
  assert.ok(!embedded.includes("gjames"), "a shared badge must not name a holder");
  // The holder credential still exists as its own committed fixture.
  assert.ok(holderVc.includes(":recipient:"), "the holder fixture should still be holder-bearing");
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

test("embedded VC: proof block matches the class artifact exactly", () => {
  const embedded = JSON.parse(extractVc(badgeSvg));
  const signed = JSON.parse(classVc);
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

test("embedded VC: anchor identifiers are the CLASS coordinate, not a claim", () => {
  const embedded = JSON.parse(extractVc(badgeSvg));
  assert.equal(embedded.id, `urn:andamio:badge:mainnet:${COURSE_ID}:${SLT_HASH}`);
  assert.equal(
    embedded.credentialSubject.achievement.id,
    `urn:andamio:course:${COURSE_ID}:${SLT_HASH}`,
  );
  // Decision-2 FLAT evidence dialect — network/policyId/asset/claimTxHash at
  // the entry top level; the Rung-6 nested onChainAnchor/onChainAttestation
  // blocks are superseded and must be gone.
  // The class artifact anchors to the COURSE, not to a claim transaction:
  // asset and claimTxHash both name a specific earning event and must be absent.
  const evidence = embedded.evidence[0];
  assert.deepEqual(evidence.type, ["OnChainCredentialAnchor", "Evidence"]);
  assert.equal(evidence.network, "mainnet");
  assert.equal(evidence.policyId, COURSE_ID);
  assert.ok(!("asset" in evidence), "asset names a holder's Access Token");
  assert.ok(!("claimTxHash" in evidence), "claimTxHash names a specific earning event");
  assert.ok(!("onChainAnchor" in evidence), "nested onChainAnchor superseded by flat dialect");
  assert.ok(!("onChainAttestation" in evidence), "nested onChainAttestation superseded by flat dialect");
  assert.equal(embedded.issuer.id, "did:web:credentials.andamio.io");
  // Neither party is named on a class artifact. `assessor` is omitted for the
  // same reason it is on holder credentials — the chain names none, and the
  // omit-never-blank-fill rule holds. `courseOwner` is omitted because it is
  // only available from a live chain read, and the class builder is offline and
  // deterministic by design (R3); the holder credential still carries it.
  assert.ok(!("courseOwner" in embedded), "class artifacts are built offline — no chain read");
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
