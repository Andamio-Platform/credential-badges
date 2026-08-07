/**
 * Sign an OpenBadgeCredential as a JWT proof. JWT proof was chosen for the spike because:
 *   1. It avoids needing an EdDSA Linked Data Proof cryptosuite that resolves the OB 3.0 context
 *      (digitalbazaar libs require remote contexts to dereference; the OB 3.0 v3.0.3 context loads,
 *      but the eddsa-rdfc-2022 cryptosuite stack is heavier than what a 2-hour spike needs).
 *   2. JWT VC (vc-jwt) is explicitly supported by OB 3.0.
 *   3. 1EdTech's reference validator accepts both JWT-signed and LDP-signed credentials.
 *
 * If time permits, sign.ts could be extended with eddsa-rdfc-2022 for a Linked Data Proof variant.
 */
import { SignJWT, importJWK } from "jose";
import type { OpenBadgeCredential } from "./mapper.js";
import type { PrototypeKey } from "./keys.js";

export interface SignedCredential {
  /** The original JSON-LD document */
  document: OpenBadgeCredential;
  /** Compact JWS string. Per W3C VC-JWT, this becomes the value of `proof.jwt` or stands alone. */
  jwt: string;
  /** OB 3.0 credential with the JWT proof attached as a `proof` block */
  signedDocument: OpenBadgeCredential & {
    proof: {
      type: string;
      created: string;
      verificationMethod: string;
      proofPurpose: string;
      jwt: string;
    };
  };
}

export async function signAsJwt(
  document: OpenBadgeCredential,
  key: PrototypeKey
): Promise<SignedCredential> {
  const privateKey = await importJWK(key.privateJwk, "EdDSA");

  // Per W3C VC-JWT (and OB 3.0): the VC payload sits under the `vc` claim, with conventional JWT
  // claims duplicating issuer/subject/id/issuance.
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({ vc: document })
    .setProtectedHeader({ alg: "EdDSA", typ: "vc+jwt", kid: key.kid })
    .setIssuer(document.issuer.id)
    .setSubject(document.credentialSubject.id)
    .setJti(document.id)
    .setIssuedAt(now)
    .setNotBefore(Math.floor(new Date(document.validFrom).getTime() / 1000))
    .sign(privateKey);

  const signedDocument = {
    ...document,
    proof: {
      type: "JsonWebSignature2020",
      created: new Date().toISOString(),
      verificationMethod: key.kid,
      proofPurpose: "assertionMethod",
      jwt,
    },
  };

  return { document, jwt, signedDocument };
}
