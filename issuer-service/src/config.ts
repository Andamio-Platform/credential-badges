// Issuer-service configuration. Origin: spike/signer-spike (Rung 6-8.3
// hardened reference implementation) — the constants below are the spike's
// pinned production surfaces, generalized from one pinned subject to any
// registered badge.
//
// Everything trust-affecting is a build-time constant or a fail-closed env
// read — never derived from request input (deployment plan: "The issuer DID
// is a fixed server-side constant; it is never derived from request input
// and has no fallback key/DID path").

export const ISSUER_DID = "did:web:credentials.andamio.io";
export const STATIC_HOST = "https://credentials.andamio.io";
export const DID_JSON_URL = `${STATIC_HOST}/.well-known/did.json`;
export const ANDAMIO_CONTEXT_URL = `${STATIC_HOST}/context/v0.jsonld`;
export const SCAN_URL = "https://andamioscan.io";

// The one network this deployment serves. The route's {network} segment is a
// closed trust-affecting enum (plan Unit 4); a request for the OTHER valid
// network returns 404 wrong-network, anything else is 400. Andamioscan (the
// gate's read path) indexes mainnet; a preprod deployment would point
// SCAN_URL at a preprod indexer AND need a preprod slot->time formula, so
// NETWORK stays pinned to mainnet until that exists.
export const NETWORK = "mainnet";
export const KNOWN_NETWORKS = ["mainnet", "preprod"] as const;

export type SignerMode = "kms" | "ephemeral";

export interface Config {
  port: number;
  signerMode: SignerMode;
  /**
   * Full KMS CryptoKeyVersion resource name, e.g.
   * projects/<p>/locations/<region>/keyRings/credential-badges-issuer/cryptoKeys/vc-sign-ed25519/cryptoKeyVersions/1
   *
   * REQUIRED in kms mode, deliberately with NO default: the region is an ops
   * decision (the pre-deploy ops gate; europe-west4 vs us-central1 is
   * undecided at build time). The spike's key lives at
   * us-central1/credential-badges-issuer/vc-sign-ed25519 version 1.
   */
  kmsKeyVersionName: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const signerMode = (env.SIGNER_MODE ?? "kms") as SignerMode;
  if (signerMode !== "kms" && signerMode !== "ephemeral") {
    throw new Error(`SIGNER_MODE must be "kms" or "ephemeral", got ${JSON.stringify(env.SIGNER_MODE)}`);
  }
  const kmsKeyVersionName = env.KMS_KEY_VERSION_NAME ?? null;
  if (signerMode === "kms" && !kmsKeyVersionName) {
    throw new Error(
      "KMS_KEY_VERSION_NAME is required in kms mode (full CryptoKeyVersion resource name; provided by the ops gate — no default is baked in because the region decision is pending)",
    );
  }
  return {
    port: Number(env.PORT ?? 8080),
    signerMode,
    kmsKeyVersionName,
  };
}
