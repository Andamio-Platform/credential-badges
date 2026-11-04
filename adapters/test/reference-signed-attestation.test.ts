// The second adapter: a signed attestation from a non-ledger source, issued
// through the SAME core as the Cardano/Andamio adapter.
//
// Hermetic: node builtins only. The source key is derived from a fixed test
// seed, so signatures and digests are reproducible; it signs nothing real.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import { assembleCredential } from "../core/assemble.ts";
import { AdapterRefusal } from "../core/types.ts";
import type { IssuerProfile } from "../core/types.ts";
import {
  ADAPTER_ID,
  canonicalJson,
  createSignedAttestationAdapter,
} from "../reference-signed-attestation/adapter.ts";
import type { AttestationPayload, SignedAttestation } from "../reference-signed-attestation/adapter.ts";

// PKCS#8 DER prefix for a raw 32-byte Ed25519 seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function keyFromSeed(seedByte: number) {
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.alloc(32, seedByte)]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

const SOURCE = keyFromSeed(0x11);
const IMPOSTOR = keyFromSeed(0x22);

const PAYLOAD: AttestationPayload = {
  v: 1,
  sourceId: "example-training-system",
  attestationId: "att-2026-0001",
  subject: "urn:example:learner:7f3a9c",
  achievement: {
    id: "urn:example:achievement:incident-response-101",
    name: "Incident Response 101",
    description: "Completed the incident response fundamentals module.",
    criteria: "Passed the practical assessment with a score of at least 80%.",
  },
  occurredAt: "2026-10-01T15:30:00Z",
};

function signed(payload: AttestationPayload, key = SOURCE.privateKey): SignedAttestation {
  return {
    payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), key).toString("base64url"),
  };
}

const adapter = createSignedAttestationAdapter(
  new Map([["example-training-system", { name: "Example Training System", publicKey: SOURCE.publicKey }]]),
);

// A deployment that is not Andamio: its own DID, OB 3.0 contexts only, no status list.
const EXAMPLE_ISSUER: IssuerProfile = {
  id: "did:web:credentials.example.org",
  type: ["Profile"],
  name: "Example Org",
  url: "https://credentials.example.org",
  description: "Example deployment used in tests.",
  baseContexts: [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  ],
};

test("canonicalJson sorts keys at every depth and ignores insertion order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: "x" } }), '{"a":{"c":"x","d":[2,{"y":2,"z":1}]},"b":1}');
  assert.equal(canonicalJson({ ...PAYLOAD }), canonicalJson(JSON.parse(JSON.stringify(PAYLOAD))));
});

test("a valid attestation resolves and assembles into an OB 3.0 credential", async () => {
  const assertion = await adapter.resolve(signed(PAYLOAD));
  assert.equal(assertion.provenance.adapter, ADAPTER_ID);
  assert.equal(assertion.validFrom, PAYLOAD.occurredAt);
  assert.deepStrictEqual(assertion.contexts, [], "uses only OB 3.0 terms; no new vocabulary");

  const vc = assembleCredential(assertion, EXAMPLE_ISSUER) as any;
  assert.deepStrictEqual(vc.type, ["VerifiableCredential", "OpenBadgeCredential"]);
  assert.deepStrictEqual(vc["@context"], EXAMPLE_ISSUER.baseContexts);
  assert.equal(vc.issuer.id, "did:web:credentials.example.org");
  assert.equal(vc.credentialSubject.id, PAYLOAD.subject);
  assert.equal(vc.credentialSubject.achievement.criteria.narrative, PAYLOAD.achievement.criteria);
  assert.match(vc.evidence[0].id, /^urn:sha256:[0-9a-f]{64}$/);
  assert.equal(vc.credentialStatus, undefined, "no status entry when the issuer has none");
});

test("same attestation, same assertion (apart from provenance)", async () => {
  const { provenance: _a, ...a } = await adapter.resolve(signed(PAYLOAD));
  const { provenance: _b, ...b } = await adapter.resolve(signed(PAYLOAD));
  assert.deepStrictEqual(a, b);
});

test("the credential surface matches the Cardano/Andamio adapter's shape", async () => {
  const vc = assembleCredential(await adapter.resolve(signed(PAYLOAD)), EXAMPLE_ISSUER);
  assert.deepStrictEqual(
    Object.keys(vc).sort(),
    ["@context", "credentialSubject", "description", "evidence", "id", "issuer", "name", "type", "validFrom"],
  );
});

async function refuses(req: SignedAttestation, pattern: RegExp) {
  await assert.rejects(adapter.resolve(req), (e: unknown) => {
    assert.ok(e instanceof AdapterRefusal, `expected AdapterRefusal, got ${e}`);
    assert.match((e as Error).message, pattern);
    return true;
  });
}

test("refuses a payload edited after signing", async () => {
  const req = signed(PAYLOAD);
  req.payload = { ...req.payload, achievement: { ...req.payload.achievement, name: "Incident Response 401" } };
  await refuses(req, /signature does not verify/);
});

test("refuses a signature from an unregistered key", async () => {
  await refuses(signed(PAYLOAD, IMPOSTOR.privateKey), /signature does not verify/);
});

test("refuses an unregistered source", async () => {
  await refuses(signed({ ...PAYLOAD, sourceId: "someone-else" }), /not registered/);
});

test("refuses a garbage signature without throwing anything else", async () => {
  await refuses({ payload: PAYLOAD, signature: "!!!not-base64url" }, /signature does not verify/);
});

test("refuses an e-mail address as the subject, even when correctly signed", async () => {
  await refuses(signed({ ...PAYLOAD, subject: "mailto:alice@example.org" }), /pseudonymous/);
});

test("refuses a non-UTC or malformed occurredAt", async () => {
  await refuses(signed({ ...PAYLOAD, occurredAt: "2026-10-01T15:30:00+02:00" }), /occurredAt/);
});

test("refuses an unsupported payload version", async () => {
  await refuses(signed({ ...PAYLOAD, v: 2 as unknown as 1 }), /unsupported payload version/);
});

test("rejects a non-Ed25519 registered key at construction", () => {
  const { publicKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  assert.throws(() => createSignedAttestationAdapter(new Map([["x", { name: "x", publicKey: rsa }]])), /Ed25519/);
});
