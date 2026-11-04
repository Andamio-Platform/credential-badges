// Source-neutral credential assembly: TrustAssertion + IssuerProfile ->
// unsigned Open Badges 3.0 OpenBadgeCredential.
//
// This is the generic half of issuer-service/src/map-credential.ts, with the
// source-specific values supplied by an adapter instead of hard-coded. It
// produces the unsigned document only; signing and post-sign loopback
// verification stay where they are (issuer-service/src/issue.ts) and need no
// change to accept this output.
//
// Equivalence with the production mapper is enforced by
// adapters/test/cardano-andamio.test.ts: for the recorded reference subject,
// assemble(cardanoAndamio.resolve(...)) deep-equals both mapCredential() and
// the committed, signed signing/signed-credential.json (minus its proof).

import type { IssuerProfile, TrustAssertion } from "./types.ts";

/** Top-level properties an adapter extension may never set: the core owns them. */
const RESERVED = new Set([
  "@context",
  "id",
  "type",
  "issuer",
  "validFrom",
  "validUntil",
  "name",
  "description",
  "credentialSubject",
  "evidence",
  "credentialStatus",
  "proof",
]);

export function validateAssertion(a: TrustAssertion): void {
  const fail = (why: string): never => {
    throw new Error(`invalid TrustAssertion from ${a?.provenance?.adapter ?? "?"}: ${why}`);
  };
  for (const k of ["credentialId", "validFrom", "name", "description"] as const) {
    if (typeof a[k] !== "string" || a[k].length === 0) fail(`${k} must be a non-empty string`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(a.validFrom)) {
    fail(`validFrom must be ISO 8601 UTC, got ${JSON.stringify(a.validFrom)}`);
  }
  if (!a.subject?.id) fail("subject.id is required");
  if (/@/.test(a.subject.id) && !a.subject.id.startsWith("did:")) {
    fail("subject.id looks like an e-mail address; subjects must be pseudonymous");
  }
  const ach = a.achievement;
  if (!ach?.id || !ach.name || !ach.description || !ach.criteria?.narrative) {
    fail("achievement needs id, name, description, and criteria.narrative");
  }
  if (!Array.isArray(a.evidence) || a.evidence.length === 0) {
    fail("at least one evidence item is required");
  }
  for (const e of a.evidence) {
    if (!e.id || !e.name || !Array.isArray(e.type) || !e.type.includes("Evidence")) {
      fail(`evidence item needs id, name, and a type including "Evidence": ${JSON.stringify(e)}`);
    }
  }
  if (!Array.isArray(a.contexts)) fail("contexts must be an array (may be empty)");
  for (const k of Object.keys(a.extensions ?? {})) {
    if (RESERVED.has(k)) fail(`extension ${JSON.stringify(k)} would overwrite a core property`);
  }
}

/** Assemble the unsigned credential. Throws on an invalid assertion; never repairs one. */
export function assembleCredential(a: TrustAssertion, issuer: IssuerProfile): Record<string, unknown> {
  validateAssertion(a);

  const contexts = [...issuer.baseContexts];
  for (const c of a.contexts) if (!contexts.includes(c)) contexts.push(c);

  const credential: Record<string, unknown> = {
    "@context": contexts,
    id: a.credentialId,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: issuer.id,
      type: [...issuer.type],
      name: issuer.name,
      url: issuer.url,
      description: issuer.description,
    },
    validFrom: a.validFrom,
    name: a.name,
    description: a.description,
    credentialSubject: {
      id: a.subject.id,
      type: ["AchievementSubject"],
      achievement: {
        id: a.achievement.id,
        type: ["Achievement"],
        name: a.achievement.name,
        description: a.achievement.description,
        criteria: { narrative: a.achievement.criteria.narrative },
      },
    },
    ...structuredClone(a.extensions ?? {}),
    evidence: structuredClone(a.evidence),
  };
  if (issuer.statusEntry) credential.credentialStatus = issuer.statusEntry();
  return credential;
}
