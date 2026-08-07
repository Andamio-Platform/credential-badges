/**
 * Map an Andamio on-chain credential into an OpenBadgeCredential JSON-LD document.
 * See ../mapping.md for the full field-by-field rationale.
 */
import type { AndamioCredential } from "./credential.js";

export const OB3_CONTEXT = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";
export const ANDAMIO_CONTEXT = "https://credentials.andamio.io/context/v0.jsonld";

export interface OpenBadgeCredential {
  "@context": string[];
  id: string;
  type: string[];
  issuer: {
    id: string;
    type: string[];
    name: string;
    url: string;
    description?: string;
  };
  validFrom: string;
  name: string;
  description: string;
  credentialSubject: {
    id: string;
    type: string[];
    achievement: {
      id: string;
      type: string[];
      name: string;
      description: string;
      criteria: { narrative: string };
      alignment?: Array<{
        type: string[];
        targetName: string;
        targetUrl: string;
        targetDescription?: string;
      }>;
    };
  };
  evidence?: Array<{
    id: string;
    type: string[];
    name: string;
    description?: string;
  }>;
  // Custom Andamio extension — resolved via the published andamio context
  // (credentials.andamio.io/context/v0.jsonld), so it expands as proper RDF.
  onChainAnchor?: {
    network: string;
    policyId: string;
    assetName: string;
    assetFingerprint?: string;
    sltHash: string;
    blockfrostAsset: string;
    explorerUrl: string;
    claimTxHash?: string;
  };
}

export interface BuildOptions {
  issuerDid: string;          // did:key issuer for the prototype
  issuerProfileUrl: string;   // canonical hosted profile URL (for production)
  credentialBaseUrl: string;  // base URL where this credential will be served
}

export function mapToOB3(
  cred: AndamioCredential,
  opts: BuildOptions
): OpenBadgeCredential {
  // Stable identifier for this credential — preprod URN form so the document is dereferenceable
  // even before the credential service is built.
  const credentialId = `urn:andamio:preprod:credential:${cred.policyId}:${cred.assetName}`;

  // Achievement id namespaced by course
  const achievementId = `urn:andamio:preprod:achievement:${cred.course.id}:${cred.module.sltHash}`;

  // Recipient id — using student state asset fingerprint as a pseudonymous, stable handle.
  // Production should let the recipient choose: email-hash, did:web, or wallet-bound DID.
  const subjectId = `urn:andamio:preprod:recipient:${cred.recipient.studentStateAsset}`;

  return {
    "@context": [VC_V2_CONTEXT, OB3_CONTEXT, ANDAMIO_CONTEXT],
    id: credentialId,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: opts.issuerDid,
      type: ["Profile"],
      name: `Andamio (${cred.course.teacherAlias} on Cardano preprod)`,
      url: opts.issuerProfileUrl,
      description:
        "Andamio is an on-chain credential protocol on Cardano. The issuer DID for this prototype is a did:key generated only for the OB 3.0 spike.",
    },
    validFrom: cred.anchor.issuedAt,
    name: `Completion: ${cred.course.title}`,
    description: cred.course.description,
    credentialSubject: {
      id: subjectId,
      type: ["AchievementSubject"],
      achievement: {
        id: achievementId,
        type: ["Achievement"],
        name: cred.course.title,
        description: cred.course.description,
        criteria: {
          narrative: [
            "Completion of all Student Learning Targets (SLTs) for this course module:",
            ...cred.module.slts.map((slt, i) => `  ${i + 1}. ${slt}`),
            "",
            `On-chain anchor: Cardano native token under policy ${cred.policyId} (preprod). The credential NFT is minted to the recipient's wallet by the Andamio v2 protocol's credential_claim transaction.`,
          ].join("\n"),
        },
        alignment: cred.module.slts.map((slt, i) => ({
          type: ["Alignment"],
          targetName: `SLT ${i + 1}`,
          targetUrl: `${opts.credentialBaseUrl}/achievement/${cred.course.id}/${cred.module.sltHash}#slt-${i + 1}`,
          targetDescription: slt,
        })),
      },
    },
    evidence: [
      {
        id: cred.anchor.explorer,
        type: ["Evidence"],
        name: "Cardano preprod policy explorer",
        description:
          "On-chain record of the Andamio course policy under which the credential NFT is minted.",
      },
      {
        id: cred.anchor.blockfrostAsset,
        type: ["Evidence"],
        name: "Blockfrost asset record",
        description:
          "Programmatic on-chain anchor: the Andamio LocalStateNFT for this course on Cardano preprod.",
      },
    ],
    onChainAnchor: {
      network: cred.network,
      policyId: cred.policyId,
      assetName: cred.assetName,
      assetFingerprint: cred.assetFingerprint,
      sltHash: cred.module.sltHash,
      blockfrostAsset: cred.anchor.blockfrostAsset,
      explorerUrl: cred.anchor.explorer,
      claimTxHash: cred.anchor.claimTxHash,
    },
  };
}
