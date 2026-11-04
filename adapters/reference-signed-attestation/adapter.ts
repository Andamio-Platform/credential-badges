// A deliberately simple second adapter: a signed attestation from a
// NON-LEDGER trust source (a training system, an HR or enterprise workflow,
// a community tool) whose Ed25519 public key the deployment has registered.
//
// It exists to show that the credential-facing surface does not change when
// the trust source does: the same core assembles, signs, and verifies an
// OB 3.0 credential from it. Its evidence uses only terms that Open Badges 3.0
// already defines (id, type, name, description, genre), so it needs no new
// JSON-LD context.
//
// It is a reference, not a product. Before an adopter uses it to sign a batch,
// one artifact must pass the external reference validator (Validation Gate,
// CONCEPTS.md).
//
// Dependency-free: node:crypto only.

import { createHash, createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { AdapterRefusal } from "../core/types.ts";
import type { EvidenceAdapter, TrustAssertion } from "../core/types.ts";

export const ADAPTER_ID = "reference-signed-attestation-v1";

/** What the source signs. */
export interface AttestationPayload {
  v: 1;
  /** Registered source identifier, e.g. "example-training-system". */
  sourceId: string;
  /** Unique within the source. */
  attestationId: string;
  /** Pseudonymous subject URI assigned by the source. */
  subject: string;
  achievement: {
    id: string;
    name: string;
    description: string;
    criteria: string;
  };
  /** When the source recorded the event, ISO 8601 UTC. Becomes validFrom. */
  occurredAt: string;
}

export interface SignedAttestation {
  payload: AttestationPayload;
  /** base64url Ed25519 signature over canonicalJson(payload). */
  signature: string;
}

export interface RegisteredSource {
  name: string;
  /** Ed25519 public key (PEM, or a KeyObject). */
  publicKey: string | KeyObject;
}

/** Deterministic JSON: object keys sorted at every depth, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ID_TOKEN = /^[A-Za-z0-9._-]{1,128}$/;

export function createSignedAttestationAdapter(
  sources: ReadonlyMap<string, RegisteredSource>,
): EvidenceAdapter<SignedAttestation> {
  const keys = new Map<string, { name: string; key: KeyObject }>();
  for (const [id, s] of sources) {
    const key = typeof s.publicKey === "string" ? createPublicKey(s.publicKey) : s.publicKey;
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(`registered source ${id} must use an Ed25519 key, got ${key.asymmetricKeyType}`);
    }
    keys.set(id, { name: s.name, key });
  }

  const refuse = (why: string): never => {
    throw new AdapterRefusal(ADAPTER_ID, why);
  };

  return {
    id: ADAPTER_ID,
    sourceKind: "attestation",
    async resolve(request: SignedAttestation): Promise<TrustAssertion> {
      const p = request?.payload;
      if (!p || typeof request.signature !== "string") refuse("request must carry a payload and a signature");

      // 1. Known source. The source id is a lookup key, never trusted for anything else.
      const source = keys.get(p.sourceId);
      if (!source) refuse(`source ${JSON.stringify(p.sourceId)} is not registered`);

      // 2. Signature over the exact canonical bytes. Any edit to the payload fails here.
      const bytes = Buffer.from(canonicalJson(p), "utf8");
      let ok = false;
      try {
        ok = verify(null, bytes, source!.key, Buffer.from(request.signature, "base64url"));
      } catch {
        ok = false;
      }
      if (!ok) refuse(`signature does not verify against the registered key for ${p.sourceId}`);

      // 3. Shape, checked only after authenticity, so the error never echoes unauthenticated content.
      if (p.v !== 1) refuse(`unsupported payload version ${JSON.stringify(p.v)}`);
      if (!ID_TOKEN.test(p.sourceId) || !ID_TOKEN.test(p.attestationId)) {
        refuse("sourceId and attestationId must be short [A-Za-z0-9._-] tokens");
      }
      if (!ISO_UTC.test(p.occurredAt) || Number.isNaN(Date.parse(p.occurredAt))) {
        refuse("occurredAt must be ISO 8601 UTC without fractional seconds");
      }
      if (typeof p.subject !== "string" || !/^[a-z][a-z0-9+.-]*:/i.test(p.subject) || p.subject.includes("@")) {
        refuse("subject must be a pseudonymous URI (no e-mail addresses)");
      }
      const a = p.achievement;
      if (!a?.id || !a.name || !a.description || !a.criteria) {
        refuse("achievement needs id, name, description, and criteria");
      }

      // The evidence id binds the credential to the exact signed bytes.
      const digest = createHash("sha256").update(bytes).digest("hex");

      return {
        credentialId: `urn:x-attestation:${p.sourceId}:${p.attestationId}`,
        validFrom: p.occurredAt,
        name: a.name,
        description: `${a.name}. Attested by ${source!.name}; the signed source attestation is referenced in the evidence.`,
        subject: { id: p.subject },
        achievement: {
          id: a.id,
          name: a.name,
          description: a.description,
          criteria: { narrative: a.criteria },
        },
        evidence: [
          {
            id: `urn:sha256:${digest}`,
            type: ["Evidence"],
            name: `Signed attestation from ${source!.name}`,
            description:
              `Attestation ${p.attestationId} from source ${p.sourceId}, signed with Ed25519 and verified against ` +
              `the source's registered key before issuance. The id is the SHA-256 of the canonical signed payload.`,
            genre: "Signed source attestation",
          },
        ],
        contexts: [],
        provenance: {
          adapter: ADAPTER_ID,
          checkedAt: new Date().toISOString(),
          source: p.sourceId,
        },
      };
    },
  };
}
