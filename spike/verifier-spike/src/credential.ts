import { DID, STATUS_LIST_URL } from "./did-web.js";
import { SPIKE_CONTEXT_URL } from "./context.js";

// Realistic-looking on-chain values pulled from
// spike/samples/sustain-and-maintain-gimbalabs-james-real.jsonld so verifiers
// see plausible Cardano shapes. The spike does not exercise the anchor gate —
// these values are static fixtures, not re-derived from chain.
const NETWORK = "mainnet";
const POLICY_ID = "674da142911c910d0f79e1c92cc6089e797b344fd9ded22ccb0a222e";
const ASSET = "asset1pjdc2zkj4da0gr2zgnpn4elv5e88253rss3fxk";
const CLAIM_TX_HASH = "70945cb0a68c5445b8bb33280271f4e1e362e6c4fe639cd23dbc4890648786a4";
const RECIPIENT_STATE_ASSET = "gjames";
const ACCESS_TOKEN_ASSET = "ff5d0640b5a2717646d3f3151d100d57d194fdfa88cacf03f9edc568";
const ASSESSOR_TOKEN_ASSET = "uassessor-fixture";

// Pinned to the real claim-tx block_time of the gimbalabs sample (deterministic per plan).
const BLOCK_TIME = "2026-02-12T08:11:34Z";

export function buildTargetCredential() {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
      SPIKE_CONTEXT_URL,
    ],
    id: `urn:andamio:credential:${POLICY_ID}:${RECIPIENT_STATE_ASSET}`,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: DID,
      type: ["Profile", "AttestationHost"],
      name: "Andamio",
      url: `${trimDid(DID)}/issuer`,
      description:
        "Andamio is the protocol-layer attestation host for a multi-party credential process. " +
        "The substantive authority for any credential issued through Andamio is split across the " +
        "course owner (the Access Token holder who created the course), the assessor (the teacher " +
        "who evaluated the work), and the Cardano chain (the immutable record). Andamio's " +
        "cryptographic signature attests that this multi-party process completed correctly " +
        "on-chain — it does not claim authority over what the credential means.",
    },
    validFrom: BLOCK_TIME,
    name: "Sustain and Maintain Gimbalabs",
    description:
      "Real-recipient sample, repurposed as a Phase 0 verifier-spike fixture. " +
      "Substantive content reproduces spike/samples/sustain-and-maintain-gimbalabs-james-real.jsonld; " +
      "the issuer DID, evidence type, courseOwner/assessor fields, and credentialStatus are the " +
      "production-shape attestation-framing additions.",
    credentialSubject: {
      id: `urn:andamio:${NETWORK}:recipient:${RECIPIENT_STATE_ASSET}`,
      type: ["AchievementSubject"],
      achievement: {
        id: `urn:andamio:project:${POLICY_ID}:${ASSET}`,
        type: ["Achievement"],
        name: "Sustain and Maintain Gimbalabs",
        description:
          "An ongoing Andamio project where contributors sustain Gimbalabs infrastructure, " +
          "content, and community programs.",
        criteria: {
          narrative:
            "Recipient is recorded as a participant in the Sustain and Maintain Gimbalabs " +
            "project on Cardano. The project's Plutus validator enforced course-completion " +
            "prerequisites at participation-token mint time.",
        },
      },
    },
    courseOwner: `urn:andamio:${NETWORK}:course-owner:${ACCESS_TOKEN_ASSET}`,
    assessor: `urn:andamio:${NETWORK}:assessor:${ASSESSOR_TOKEN_ASSET}`,
    evidence: [
      {
        // OB 3.0 requires "Evidence" as a base type on every evidence entry;
        // custom subtypes extend it. 1EdTech EvidenceProbe rejected a bare
        // "OnChainCredentialAnchor" in our first-pass result.
        type: ["OnChainCredentialAnchor", "Evidence"],
        network: NETWORK,
        policyId: POLICY_ID,
        asset: ASSET,
        claimTxHash: CLAIM_TX_HASH,
      },
    ],
    credentialStatus: {
      id: `${STATUS_LIST_URL}#0`,
      type: "BitstringStatusListEntry",
      statusPurpose: "suspension",
      statusListIndex: "0",
      statusListCredential: STATUS_LIST_URL,
    },
  };
}

function trimDid(did: string): string {
  // did:web:host:path... → https://host/path/...
  const rest = did.slice("did:web:".length).split(":");
  const host = rest[0];
  const segs = rest.slice(1);
  return `https://${host}${segs.length ? "/" + segs.join("/") : ""}`;
}
