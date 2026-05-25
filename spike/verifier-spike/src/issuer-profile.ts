import { DID, BASE_URL } from "./did-web.js";

// Stub Profile served at <BASE_URL>/issuer. Production version is Unit 2's
// issuer/profile.jsonld; this is a spike-shaped equivalent so the 1EdTech
// IssuerProbe accessibility check resolves successfully.
export const ISSUER_URL = `${BASE_URL}/issuer`;

export function buildIssuerProfile() {
  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    ],
    id: DID,
    type: ["Profile", "AttestationHost"],
    name: "Andamio",
    url: ISSUER_URL,
    description:
      "Andamio is the protocol-layer attestation host for a multi-party credential " +
      "process. The substantive authority for any credential issued through Andamio " +
      "is split across the course owner, the assessor, and the Cardano chain. Andamio's " +
      "cryptographic signature attests that this multi-party process completed correctly " +
      "on-chain — it does not claim authority over what the credential means.",
  };
}
