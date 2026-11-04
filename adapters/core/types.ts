// The evidence-adapter contract: the only source-specific piece of the
// issuance path. Everything after an adapter (credential assembly, signing,
// status, presentation, verification) is shared.
//
// The prose contract lives in docs/architecture/evidence-adapter.md (proposed
// alongside this package). This file is its executable form.
//
// Dependency-free by design: types plus one error class, so the hermetic CI
// job can run the whole package with no npm install.

/** One adapter per trust source (a ledger and protocol, a workflow engine, an enterprise system). */
export interface EvidenceAdapter<Request> {
  /** Stable, unique identifier, e.g. "cardano-andamio-course-v2". Never reused. */
  readonly id: string;
  /** Coarse class of trust source: "ledger" | "workflow" | "enterprise" | "attestation" | … */
  readonly sourceKind: string;
  /**
   * Verify the request against the trust source and return a normalized
   * assertion. MUST fail closed: throw AdapterRefusal when the source does not
   * support the claim, and any other error when the source could not be asked.
   * MUST NOT return a partial assertion.
   */
  resolve(request: Request): Promise<TrustAssertion>;
}

/** What the source verifiably says, normalized for the credential core. */
export interface TrustAssertion {
  /** Stable credential identifier (URI). Deterministic for the same (claim, subject). */
  credentialId: string;
  /** ISO 8601 UTC, derived from the source, never from the wall clock. */
  validFrom: string;
  name: string;
  description: string;
  /** Pseudonymous. MUST NOT be a human name or e-mail address. */
  subject: { id: string };
  achievement: {
    id: string;
    name: string;
    description: string;
    criteria: { narrative: string };
  };
  /** At least one item pointing back to the authoritative claim. */
  evidence: EvidenceItem[];
  /** JSON-LD contexts defining the adapter's evidence and extension terms (may be empty). */
  contexts: string[];
  /** Top-level credential properties defined in the adapter's context. */
  extensions?: Record<string, unknown>;
  /** NOT signed: how and when the claim was checked, for logs and transcripts. */
  provenance: {
    adapter: string;
    checkedAt: string;
    source: string;
    endpoints?: string[];
  };
}

export interface EvidenceItem {
  /** Dereferenceable URL or URI for the authoritative claim. */
  id: string;
  /** MUST include "Evidence". */
  type: string[];
  name: string;
  [term: string]: unknown;
}

/** A deployment's issuer: who signs, under which base contexts, with which status entry. */
export interface IssuerProfile {
  id: string;
  type: string[];
  name: string;
  url: string;
  description: string;
  /** Contexts every credential from this issuer carries, in order, before the adapter's. */
  baseContexts: readonly string[];
  /** Factory for the credentialStatus entry, or omitted for no status. */
  statusEntry?: () => Record<string, unknown>;
}

/** The source does not support the claim. Never retried as if it were an outage. */
export class AdapterRefusal extends Error {
  readonly adapter: string;
  readonly reason: string;
  constructor(adapter: string, reason: string, options?: { cause?: unknown }) {
    super(`${adapter} REFUSED: ${reason}`, options);
    this.adapter = adapter;
    this.reason = reason;
  }
}
