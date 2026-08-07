// Throwaway scratch host for the Phase 0 verifier spike.
// Production DID will be did:web:credentials.andamio.io (Unit 1 emits it).
export const DID = "did:web:workshop-maybe.github.io:credential-badges-verifier-spike";
export const BASE_URL = "https://workshop-maybe.github.io/credential-badges-verifier-spike";
export const KEY_FRAGMENT = "key-2026-05";
export const VERIFICATION_METHOD_ID = `${DID}#${KEY_FRAGMENT}`;
export const STATUS_LIST_ID = "key-epoch-2026-05";
export const STATUS_LIST_URL = `${BASE_URL}/status/${STATUS_LIST_ID}.json`;

export function buildDidDocument(key: { publicKeyMultibase: string }) {
  // Single-key did.json — applies the walt-id issue #977 workaround per P1bis-10.
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1",
    ],
    id: DID,
    verificationMethod: [
      {
        id: VERIFICATION_METHOD_ID,
        type: "Multikey",
        controller: DID,
        publicKeyMultibase: key.publicKeyMultibase,
      },
    ],
    assertionMethod: [VERIFICATION_METHOD_ID],
  };
}
