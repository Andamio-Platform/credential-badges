// class-credential.ts — builds the CLASS artifact: what a badge *means*,
// with nobody claimed to have earned it.
//
// Why this shape (plan KTD-1, as revised by validation). OB 3.0 has no
// container for a signed Achievement definition, so the class artifact is an
// ordinary `OpenBadgeCredential` whose SUBJECT IS THE ACHIEVEMENT rather than a
// person.
//
// The first attempt omitted `credentialSubject.id` entirely — the "identityless"
// shape the OB 3.0 implementation guide explicitly recommends for badges
// delivered by URL sharing and download, and which the published JSON schema
// permits (AchievementSubject requires only `type` and `achievement`). The
// 1EdTech reference validator rejects it anyway:
//
//   ERROR  "no id in credentialSubject"  — CredentialSubjectProbe
//   (verifybadge.org / OB30Inspector, 2026-07-28, on a real KMS-signed artifact)
//
// The guide and the validator disagree, and the validator is what the ecosystem
// actually runs. So the subject carries an id — the achievement's own URN. That
// satisfies the probe while keeping the property that matters: the subject is a
// definition, not a person, and no holder identifier appears anywhere.
//
// The residual wrinkle, stated plainly rather than hidden: an AchievementSubject
// whose id is the achievement reads a little circularly. It is still the most
// honest option available — omitting the id means "an earner we cannot name",
// which is a claim about a person we are deliberately not making. The
// human-readable prose carries the rest of the meaning, and the test suite
// asserts no person-identifier reaches the signed bytes.
//
// Deliberately NOT carried here, and each omission is a decision:
//   * `asset` / `claimTxHash` — both name a specific earning event.
//   * `assessor`              — names a person, and the chain does not expose
//                               it anyway (holder dialect omits it too).
//   * `courseOwner`           — meaningful, but only available from a live
//                               chain read. This builder is offline and
//                               deterministic by design (R3), so adding it
//                               would mean either a per-badge network call at
//                               build time or carrying owner in the registry.
//
// `validFrom` IS required by the OB 3.0 AchievementCredential schema (checked
// against the published schema on 2026-07-28: required = @context, id, type,
// credentialSubject, issuer, validFrom). A definition has no issuance moment
// and a wall-clock value would break byte-stability (R3), so it is pinned to
// the signing-key epoch — deterministic, stable across re-signs under the same
// key, and honest: this is when Andamio published this definition under this
// key. The same constant dates the proof.
//
// The identityless shape is schema-valid, not a stretch: AchievementSubject
// requires only `type` and `achievement`, so omitting `id` conforms.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCTION_CONTEXTS, ISSUER_DID } from "./map-credential.ts";
import { statusListEntry } from "./status-list.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const REGISTRY_PATH = path.join(REPO, "generator", "credentials.json");

/** The signing-key epoch this definition is published under. Deterministic by
 *  design — see the `validFrom` note in the module header. */
export const KEY_EPOCH_PUBLISHED = "2026-07-01T00:00:00Z";

const COURSE_ID_RE = /^[0-9a-f]{56}$/;
const SLT_HASH_RE = /^[0-9a-f]{64}$/;

export interface BadgeRecord {
  course_id: string;
  slt_hash: string;
  course_title: string;
  module_title: string;
}

/** Raised when a coordinate is malformed or absent from the badge registry. */
export class UnknownBadge extends Error {
  constructor(courseId: string, sltHash: string) {
    super(`badge not in registry: ${courseId}.${sltHash}`);
    this.name = "UnknownBadge";
  }
}

let _registry: BadgeRecord[] | null = null;

/** The repo badge registry — the same source that gates the issuer service. */
export function registry(): BadgeRecord[] {
  if (_registry === null) {
    _registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as BadgeRecord[];
  }
  return _registry;
}

/** Class artifacts live in their own URN namespace so one can never be mistaken
 *  for a holder credential (`urn:andamio:credential:…`). */
export function classCredentialId(rec: BadgeRecord, network: string): string {
  return `urn:andamio:badge:${network}:${rec.course_id}:${rec.slt_hash}`;
}

function assertRegistered(rec: BadgeRecord): BadgeRecord {
  if (!COURSE_ID_RE.test(rec.course_id) || !SLT_HASH_RE.test(rec.slt_hash)) {
    throw new UnknownBadge(rec.course_id, rec.slt_hash);
  }
  const hit = registry().find(
    (r) => r.course_id === rec.course_id && r.slt_hash === rec.slt_hash,
  );
  if (!hit) throw new UnknownBadge(rec.course_id, rec.slt_hash);
  return hit;
}

/** Build the identityless class credential for one registered badge.
 *
 *  Pure and deterministic: same badge in, byte-identical object out. Titles
 *  come from the registry rather than the caller, so a caller cannot inject
 *  text into a signed artifact.
 */
export function buildClassCredential(rec: BadgeRecord, network: string): unknown {
  const badge = assertRegistered(rec);
  const { course_id: courseId, slt_hash: sltHash } = badge;
  const courseTitle = badge.course_title;
  const moduleTitle = badge.module_title;

  return {
    "@context": [...PRODUCTION_CONTEXTS],
    id: classCredentialId(badge, network),
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: ISSUER_DID,
      type: ["Profile", "AttestationHost"],
      name: "Andamio",
      url: "https://credentials.andamio.io",
      description:
        "Andamio is the protocol-layer attestation host for a multi-party credential process. The substantive authority for any credential issued through Andamio is split across the course owner (the Access Token holder who created the course), the assessor (the teacher who evaluated the work), and the Cardano chain (the immutable record). Andamio's cryptographic signature attests that this multi-party process completed correctly on-chain. It does not claim authority over what the credential means.",
    },
    // Required by the OB 3.0 schema. Pinned to the signing-key epoch rather
    // than wall-clock so re-signing is byte-stable (R3).
    validFrom: KEY_EPOCH_PUBLISHED,
    name: moduleTitle,
    // The prose is the mitigation the machine-readable shape cannot provide.
    description:
      `Defines the "${moduleTitle}" credential of the "${courseTitle}" course on Andamio (Cardano ${network}). ` +
      `This describes what the credential means and does not assert that any person holds it. ` +
      `A credential naming its holder is issued separately, per holder.`,
    credentialSubject: {
      // The subject is the ACHIEVEMENT, not a person. Required by the 1EdTech
      // CredentialSubjectProbe, which errors on a missing id regardless of what
      // the schema permits — see the module header.
      id: `urn:andamio:course:${courseId}:${sltHash}`,
      type: ["AchievementSubject"],
      achievement: {
        id: `urn:andamio:course:${courseId}:${sltHash}`,
        type: ["Achievement"],
        name: moduleTitle,
        description: `${moduleTitle} — ${courseTitle}`,
        criteria: {
          narrative:
            `This credential is defined by the "${courseTitle}" course on Andamio (Cardano ${network}). ` +
            `It is awarded for the "${moduleTitle}" module, assessed through the course's on-chain assignment flow ` +
            `and recorded by a credential_claim transaction. ` +
            `This artifact defines those terms and does not assert that any person has met them.`,
        },
      },
    },
    evidence: [
      {
        // Anchors to the badge coordinate — the course on chain — not to any
        // claim transaction, because no claim is being asserted.
        id: `https://andamioscan.io/courses/${courseId}`,
        type: ["OnChainCredentialAnchor", "Evidence"],
        name: "Cardano on-chain anchor",
        network,
        policyId: courseId,
      },
    ],
    // Key-epoch suspension signal — the kill-switch covers definitions as well
    // as assertions (KTD-6).
    credentialStatus: statusListEntry(),
  };
}
