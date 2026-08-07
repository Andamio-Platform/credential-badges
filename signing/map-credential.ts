// Rung 6 · Mapper: on-chain anchor -> unsigned OB3 AchievementCredential.
//
// Shape follows the deployment plan's Decision 2 (attestation-host framing) and
// the rung-1 verifier-spike sample that passed spruce + 1EdTech + loopback,
// adapted to the PRODUCTION context actually live at
// https://credentials.andamio.io/context/v1.jsonld. Every term in this document
// is defined by the three referenced contexts, so eddsa-rdfc-2022 (RDFC-1.0
// over expanded RDF) canonicalizes it with no dropped terms — a third-party
// verifier expanding against the live context reproduces the exact signed
// dataset.
//
// Rung 8.3 — FINAL production shape. The Rung-6 deviations are resolved:
//  - `evidence` carries the plan's Decision-2 FLAT anchor dialect at the entry
//    top level: `network`, `policyId`, `asset`, `claimTxHash` ("no other field
//    name is correct"). The context/v0.jsonld update registers those terms
//    top-level; the Rung-6 nested `onChainAnchor` / `onChainAttestation`
//    blocks are superseded (their scoped terms stay in the context — it is
//    additive-only under @protected + the immutable cache header).
//    `policyId` IS the course id (Andamio V2: a course's id is its mint
//    policy). `asset` is the recipient's Access Token global-state asset
//    (`studentStateAsset`) — the on-chain object the claim tx writes the
//    credential into. Course V2 mints no per-credential native asset (the
//    claim burns the course-state token and updates the recipient's global
//    state), so the student-state asset is the honest fill for the plan's
//    anchor field set; it matches `credentialSubject.id`'s derivation.
//  - Top-level `courseOwner` (P1bis-04, Decision-2 implication 3): pseudonymous
//    URN over the course owner's Access Token global-state asset, same
//    ASCII-"g"+alias derivation as the recipient. `assessor` (implication 4)
//    is OMITTED — the on-chain record for this credential yields no assessor
//    (the claim event carries alias/course/credentials only), and the plan
//    says omit, never blank-fill.
//  - `credentialStatus` (Decision 3): BitstringStatusListEntry, statusPurpose
//    "suspension", statusListIndex = the signing key version's registry
//    position (bit 0 = key-2026-07), pointing at the served
//    /status/key-epoch-2026-07.json.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnchor, type Anchor } from "./check-anchor.ts";
import { statusListEntry } from "./status-list.ts";

export const PRODUCTION_CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://credentials.andamio.io/context/v1.jsonld",
] as const;

export const ISSUER_DID = "did:web:credentials.andamio.io";

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
  // the same on-chain derivation as the recipient's studentStateAsset
  // ("gjames" for alias "james"). Pseudonym, never a human name.
  const courseOwnerStateAsset = `g${courseOwner}`;

  return {
    "@context": [...PRODUCTION_CONTEXTS],
    id: `urn:andamio:credential:${network}:${courseId}:${sltHash}:${studentStateAsset}`,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: ISSUER_DID,
      type: ["Profile", "AttestationHost"],
      name: "Andamio",
      // Aligned with the hosted issuer profile (issue #54, finding 6): the
      // live https://credentials.andamio.io/issuer document states
      // url: "https://credentials.andamio.io".
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
    // implication 4 (`assessor`) is omitted: the on-chain record for this
    // credential names no assessor.
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

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  checkAnchor()
    .then(async (anchor) => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const outFile = path.join(here, "out", "credential-unsigned.json");
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await fs.writeFile(
        outFile,
        JSON.stringify(mapCredential(anchor), null, 2) + "\n",
      );
      console.log(`wrote ${outFile}`);
    })
    .catch((e) => {
      console.error(String(e?.message ?? e));
      process.exit(1);
    });
}
