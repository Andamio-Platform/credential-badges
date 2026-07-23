// Mapper: on-chain anchor -> unsigned OB3 AchievementCredential.
// Ported from spike/signer-spike/map-credential.ts (Rung 8.3 — the FINAL
// production shape that passed spruce + 1EdTech + loopback): the deployment
// plan's Decision-2 flat evidence anchor dialect (network / policyId / asset /
// claimTxHash), top-level courseOwner attribution, and the Decision-3
// credentialStatus BitstringStatusListEntry pointing at the served key-epoch
// status list. Every term is defined by the three referenced contexts, so
// eddsa-rdfc-2022 canonicalizes with no dropped terms.
//
// `assessor` (Decision-2 implication 4) is OMITTED: the on-chain claim event
// carries alias/course/credentials only — the plan's omit-never-blank rule.

import type { Anchor } from "./anchor.ts";
import { statusListEntry } from "./status-list.ts";
import { ISSUER_DID } from "./config.ts";

export const PRODUCTION_CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://credentials.andamio.io/context/v1.jsonld",
] as const;

export function mapCredential(anchor: Anchor): any {
  const {
    network,
    courseId,
    sltHash,
    claimTxHash,
    blockTime,
    studentStateAsset,
    courseOwner,
    courseTitle,
    moduleTitle,
    slts,
  } = anchor;

  // Access Token global-state asset for the course owner: ASCII "g" + alias —
  // the same on-chain derivation as the recipient's studentStateAsset.
  // Pseudonym, never a human name.
  const courseOwnerStateAsset = `g${courseOwner}`;

  return {
    "@context": [...PRODUCTION_CONTEXTS],
    id: `urn:andamio:credential:${network}:${courseId}:${sltHash}:${studentStateAsset}`,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: ISSUER_DID,
      type: ["Profile", "AttestationHost"],
      name: "Andamio",
      // Aligned with the hosted issuer profile (issue #54, finding 6).
      url: "https://credentials.andamio.io",
      description:
        "Andamio is the protocol-layer attestation host for a multi-party credential process. The substantive authority for any credential issued through Andamio is split across the course owner (the Access Token holder who created the course), the assessor (the teacher who evaluated the work), and the Cardano chain (the immutable record). Andamio's cryptographic signature attests that this multi-party process completed correctly on-chain. It does not claim authority over what the credential means.",
    },
    // Deterministic: the claim-tx block_time, derived from the slot.
    validFrom: blockTime,
    name: moduleTitle,
    description: `${moduleTitle} — ${courseTitle}. Andamio credential on Cardano ${network}, anchored by the credential_claim transaction referenced in the evidence.`,
    credentialSubject: {
      // Pseudonymous URN over the recipient's Andamio Access Token
      // global-state asset — never the human alias.
      id: `urn:andamio:${network}:recipient:${studentStateAsset}`,
      type: ["AchievementSubject"],
      achievement: {
        id: `urn:andamio:course:${courseId}:${sltHash}`,
        type: ["Achievement"],
        name: moduleTitle,
        description: `${moduleTitle} — ${courseTitle}`,
        criteria: {
          narrative:
            `Recipient completed the "${moduleTitle}" module of the "${courseTitle}" course on Andamio (Cardano ${network}). ` +
            `The module's student learning targets: ${slts.map((s) => `"${s}"`).join(" ")} ` +
            `Completion was assessed by the course's on-chain assignment flow and recorded by the credential_claim transaction in the evidence.`,
        },
      },
    },
    // Decision-2 implication 3: the course-owner reference, sibling of
    // credentialSubject (attestation context is never jammed inside it).
    courseOwner: `urn:andamio:${network}:course-owner:${courseOwnerStateAsset}`,
    evidence: [
      {
        id: `https://andamioscan.io/api/v2/events/credential-claims/claim/${claimTxHash}`,
        type: ["OnChainCredentialAnchor", "Evidence"],
        name: "Cardano on-chain anchor",
        network,
        policyId: courseId,
        asset: studentStateAsset,
        claimTxHash,
      },
    ],
    // Decision 3: key-epoch suspension signal. The chain stays authoritative
    // for per-credential state; this bit says only "signing key version
    // fresh / not fresh".
    credentialStatus: statusListEntry(),
  };
}
