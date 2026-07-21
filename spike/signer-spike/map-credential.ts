// Rung 6 · Mapper: on-chain anchor -> unsigned OB3 AchievementCredential.
//
// Shape follows the deployment plan's Decision 2 (attestation-host framing) and
// the rung-1 verifier-spike sample that passed spruce + 1EdTech + loopback,
// adapted to the PRODUCTION context actually live at
// https://credentials.andamio.io/context/v0.jsonld. Every term in this document
// is defined by the three referenced contexts, so eddsa-rdfc-2022 (RDFC-1.0
// over expanded RDF) canonicalizes it with no dropped terms — a third-party
// verifier expanding against the live context reproduces the exact signed
// dataset.
//
// Documented deviations from the rung-1 spike sample (see README):
//  - No top-level `courseOwner` / `assessor`: the LIVE production context does
//    not register those terms yet (the plan's P1bis-04 context update has not
//    shipped to the static host). Emitting them would either abort safe-mode
//    canonicalization or leave them silently uncovered by the signature.
//    Rung 8 ships the context update, then the mapper adds the fields.
//  - The anchor rides inside `evidence` (typed ["OnChainCredentialAnchor",
//    "Evidence"] per the plan: array form including base Evidence) as the
//    nested `onChainAnchor` / `onChainAttestation` blocks — the two scoped
//    terms the live context defines. `policyId` IS the course id (Andamio V2:
//    a course's id is its mint policy); `sltHash` is carried by
//    `onChainAttestation`, whose scoped context defines it.
//  - No `credentialStatus`: the production status list is not served yet
//    (https://credentials.andamio.io/status/* is 404). Rung 8 hosts
//    /status/key-epoch-2026-07.json (bit 0 = key-2026-07) and adds the entry.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAnchor, type Anchor } from "./check-anchor.ts";

export const PRODUCTION_CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://credentials.andamio.io/context/v0.jsonld",
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
    courseTitle,
    moduleTitle,
    slts,
  } = anchor;

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
    evidence: [
      {
        id: `https://andamioscan.io/api/v2/events/credential-claims/claim/${claimTxHash}`,
        type: ["OnChainCredentialAnchor", "Evidence"],
        name: "Cardano on-chain anchor",
        onChainAnchor: {
          network,
          policyId: courseId,
          claimTxHash,
        },
        onChainAttestation: {
          policyId: courseId,
          sltHash,
        },
      },
    ],
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
