// Andamio's deployment issuer profile, expressed as a core IssuerProfile.
//
// Deployment configuration, not project code: another adopter supplies its
// own. The values match issuer-service/src/map-credential.ts and the hosted
// /issuer profile. adapters/test/cardano-andamio.test.ts fails if they drift
// from the production mapper.

import { ISSUER_DID, STATIC_HOST } from "../../issuer-service/src/config.ts";
import { PRODUCTION_CONTEXTS } from "../../issuer-service/src/map-credential.ts";
import { statusListEntry } from "../../issuer-service/src/status-list.ts";
import type { IssuerProfile } from "../core/types.ts";

const W3C_AND_OB3 = PRODUCTION_CONTEXTS.slice(0, 2);

export const ANDAMIO_ISSUER: IssuerProfile = {
  id: ISSUER_DID,
  type: ["Profile", "AttestationHost"],
  name: "Andamio",
  url: STATIC_HOST,
  description:
    "Andamio is the protocol-layer attestation host for a multi-party credential process. The substantive authority for any credential issued through Andamio is split across the course owner (the Access Token holder who created the course), the assessor (the teacher who evaluated the work), and the Cardano chain (the immutable record). Andamio's cryptographic signature attests that this multi-party process completed correctly on-chain. It does not claim authority over what the credential means.",
  baseContexts: W3C_AND_OB3,
  statusEntry: statusListEntry,
};
