// Spike-augmented v0.jsonld. Adds the 4 attestation-framing terms that P1bis-04 +
// P1bis-06 register in the production v0 context — AttestationHost,
// OnChainCredentialAnchor, courseOwner, assessor — to a copy of the existing
// Andamio context. We host this at the scratch URL so the credential's @context
// resolves without needing to mutate the production credentials.andamio.io context yet.
import { BASE_URL } from "./did-web.js";

export const SPIKE_CONTEXT_URL = `${BASE_URL}/context/v0.jsonld`;

export function buildSpikeContext() {
  return {
    "@context": {
      "@version": 1.1,
      "@protected": true,

      andamio: "https://credentials.andamio.io/ns/v0#",
      xsd: "http://www.w3.org/2001/XMLSchema#",

      AttestationHost: "andamio:AttestationHost",
      OnChainCredentialAnchor: "andamio:OnChainCredentialAnchor",

      courseOwner: {
        "@id": "andamio:courseOwner",
        "@type": "@id",
      },
      assessor: {
        "@id": "andamio:assessor",
        "@type": "@id",
      },

      network: "andamio:network",
      policyId: "andamio:policyId",
      asset: "andamio:asset",
      claimTxHash: "andamio:claimTxHash",
    },
  };
}
