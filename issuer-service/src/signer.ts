// The signing seam: one constructor-injected interface, two implementations.
// Origin: spike/signer-spike/sign.ts (Rung 8 hardened) — the seam contract is
// the spike's `{ id, algorithm: "Ed25519", async sign({data}) }`, raw bytes
// in, raw 64-byte Ed25519 signature out, asserted before it ever reaches
// @digitalbazaar/data-integrity.
//
//   - KmsSigner — production. The spike proved the KMS SEMANTICS with
//     `gcloud kms asymmetric-sign`: Cloud KMS Ed25519 is PureEdDSA over the
//     raw `data` field (never a digest), returning a raw 64-byte signature.
//     The service calls the SAME AsymmetricSign API over REST
//     (cloudkms.googleapis.com) with an access token from the Cloud Run
//     metadata server, because the runtime image carries no gcloud CLI.
//     IDENTITY ASSUMPTION (deployment plan Decision 5): the service RUNS AS
//     the sign SA — the ops gate attaches the sign-only service account to
//     the Cloud Run service, so the metadata server's default token IS the
//     sign identity. No impersonation anywhere.
//   - EphemeralSigner — tests / CI / local runs. An in-process node:crypto
//     Ed25519 key through the exact same seam (the spike's loopback pattern).
//     Never deployable as production: main.ts logs loudly in ephemeral mode.

import { generateKeyPairSync, sign as edSign } from "node:crypto";

import {
  rawPublicKeyToMultibase,
  spkiPemToRawPublicKey,
} from "../../tools/gen-did-json.ts";

export interface RawSigner {
  id: string;
  algorithm: "Ed25519";
  sign(input: { data: Uint8Array }): Promise<Uint8Array>;
}

export class SigningError extends Error {}

// ---------------------------------------------------------------------------
// Production: Cloud KMS AsymmetricSign over REST, metadata-server identity
// ---------------------------------------------------------------------------

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const KMS_API = "https://cloudkms.googleapis.com/v1";

interface KmsSignerOpts {
  /** Full CryptoKeyVersion resource name (config.kmsKeyVersionName). */
  keyVersionName: string;
  /** The verificationMethod id this key signs as (fixed server-side). */
  verificationMethodId: string;
  fetchImpl?: typeof fetch;
}

export class KmsSigner implements RawSigner {
  readonly id: string;
  readonly algorithm = "Ed25519" as const;
  private readonly keyVersionName: string;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(opts: KmsSignerOpts) {
    this.id = opts.verificationMethodId;
    this.keyVersionName = opts.keyVersionName;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    let res: Response;
    try {
      res = await this.fetchImpl(METADATA_TOKEN_URL, {
        headers: { "Metadata-Flavor": "Google" },
      });
    } catch (e) {
      throw new SigningError(`metadata token fetch failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new SigningError(`metadata token fetch -> HTTP ${res.status}`);
    const body: any = await res.json();
    this.token = {
      value: body.access_token,
      expiresAt: now + (body.expires_in ?? 0) * 1000,
    };
    return this.token.value;
  }

  /** SPKI PEM of the key version's public key — feeds the startup drift check. */
  async getPublicKeyPem(): Promise<string> {
    const token = await this.accessToken();
    let res: Response;
    try {
      res = await this.fetchImpl(`${KMS_API}/${this.keyVersionName}/publicKey`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (e) {
      throw new SigningError(`KMS getPublicKey failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new SigningError(`KMS getPublicKey -> HTTP ${res.status}`);
    const body: any = await res.json();
    if (typeof body.pem !== "string") throw new SigningError("KMS getPublicKey returned no pem");
    return body.pem;
  }

  async getPublicKeyMultibase(): Promise<string> {
    return rawPublicKeyToMultibase(spkiPemToRawPublicKey(await this.getPublicKeyPem()));
  }

  async sign({ data }: { data: Uint8Array }): Promise<Uint8Array> {
    const token = await this.accessToken();
    let res: Response;
    try {
      // PureEdDSA over the raw message bytes: the `data` field, NEVER `digest`
      // (the cryptosuite canonicalizes + hashes before calling this seam).
      res = await this.fetchImpl(`${KMS_API}/${this.keyVersionName}:asymmetricSign`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: Buffer.from(data).toString("base64") }),
      });
    } catch (e) {
      throw new SigningError(`KMS asymmetricSign failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new SigningError(`KMS asymmetricSign -> HTTP ${res.status}`);
    const body: any = await res.json();
    const sig = new Uint8Array(Buffer.from(body.signature ?? "", "base64"));
    if (sig.length !== 64) {
      throw new SigningError(
        `KMS returned ${sig.length} signature bytes, expected raw 64-byte Ed25519`,
      );
    }
    return sig;
  }
}

// ---------------------------------------------------------------------------
// Tests / CI / local: ephemeral Ed25519 through the SAME seam
// ---------------------------------------------------------------------------

export interface EphemeralSigner {
  signer: RawSigner;
  controller: string;
  publicKeyMultibase: string;
  /** DID doc + verificationMethod overrides for the closed document loader. */
  overrides: Record<string, any>;
  didDocument: any;
}

export function makeEphemeralSigner(
  controller = "did:example:credential-badges-issuer-ephemeral",
): EphemeralSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spkiPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeyMultibase = rawPublicKeyToMultibase(spkiPemToRawPublicKey(spkiPem));
  const id = `${controller}#key-1`;
  const vm = {
    "@context": "https://w3id.org/security/multikey/v1",
    id,
    type: "Multikey",
    controller,
    publicKeyMultibase,
  };
  const didDocument = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
    id: controller,
    verificationMethod: [vm],
    assertionMethod: [id],
  };
  return {
    signer: {
      id,
      algorithm: "Ed25519",
      async sign({ data }: { data: Uint8Array }): Promise<Uint8Array> {
        // node:crypto ed25519 sign over raw bytes = PureEdDSA, the exact
        // semantics Cloud KMS applies to the `data` field.
        return new Uint8Array(edSign(null, Buffer.from(data), privateKey));
      },
    },
    controller,
    publicKeyMultibase,
    overrides: { [controller]: didDocument, [id]: vm },
    didDocument,
  };
}
