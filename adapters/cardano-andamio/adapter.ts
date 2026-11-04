// The reference adapter: Cardano / Andamio Course V2.
//
// resolve() IS the existing anchor gate (issuer-service/src/anchor.ts
// checkAnchor), called unchanged. This module only normalizes the gate's
// verified Anchor into a source-neutral TrustAssertion, the field values
// copied from issuer-service/src/map-credential.ts so the signed output does
// not move. adapters/test/cardano-andamio.test.ts pins that equivalence.
//
// Nothing here is wired into the issuer service yet; switching the service to
// this path is a separate, reviewed step (docs/architecture extraction plan,
// step 4).

import { checkAnchor, GateRefusal } from "../../issuer-service/src/anchor.ts";
import type { Anchor, Subject } from "../../issuer-service/src/anchor.ts";
import { AdapterRefusal } from "../core/types.ts";
import type { EvidenceAdapter, TrustAssertion } from "../core/types.ts";

export const ADAPTER_ID = "cardano-andamio-course-v2";
export const ANDAMIO_CONTEXT = "https://credentials.andamio.io/context/v1.jsonld";

type GateDeps = Parameters<typeof checkAnchor>[1];

/** Pure normalization of a gate-verified Anchor. No I/O. */
export function assertionFromAnchor(anchor: Anchor): TrustAssertion {
  const {
    network,
    courseId,
    sltHash,
    claimTxHash,
    blockTime,
    studentStateAsset,
    courseOwner,
    courseTitle,
    moduleTitle,
    slts,
  } = anchor;

  return {
    credentialId: `urn:andamio:credential:${network}:${courseId}:${sltHash}:${studentStateAsset}`,
    validFrom: blockTime,
    name: moduleTitle,
    description: `${moduleTitle} — ${courseTitle}. Andamio credential on Cardano ${network}, anchored by the credential_claim transaction referenced in the evidence.`,
    subject: { id: `urn:andamio:${network}:recipient:${studentStateAsset}` },
    achievement: {
      id: `urn:andamio:course:${courseId}:${sltHash}`,
      name: moduleTitle,
      description: `${moduleTitle} — ${courseTitle}`,
      criteria: {
        narrative:
          `Recipient completed the "${moduleTitle}" module of the "${courseTitle}" course on Andamio (Cardano ${network}). ` +
          `The module's student learning targets: ${slts.map((s) => `"${s}"`).join(" ")} ` +
          `Completion was assessed by the course's on-chain assignment flow and recorded by the credential_claim transaction in the evidence.`,
      },
    },
    evidence: [
      {
        id: `https://andamioscan.io/api/v2/events/credential-claims/claim/${claimTxHash}`,
        type: ["OnChainCredentialAnchor", "Evidence"],
        name: "Cardano on-chain anchor",
        network,
        policyId: courseId,
        asset: studentStateAsset,
        claimTxHash,
      },
    ],
    contexts: [ANDAMIO_CONTEXT],
    // The assessor is absent from the on-chain claim event, so it is omitted,
    // never blank-filled. The course owner is a pseudonymous Access Token
    // global-state asset ("g" + alias).
    extensions: {
      courseOwner: `urn:andamio:${network}:course-owner:g${courseOwner}`,
    },
    provenance: {
      adapter: ADAPTER_ID,
      checkedAt: anchor.provenance.checkedAt,
      source: anchor.provenance.source,
      endpoints: [...anchor.provenance.endpoints],
    },
  };
}

export interface CardanoAndamioDeps {
  /** Per-request gate dependencies (fetch, registry titles, locator cache). */
  gateDeps: (request: Subject) => GateDeps;
  /** Test seam; production uses the real anchor gate. */
  check?: typeof checkAnchor;
}

export function createCardanoAndamioAdapter(deps: CardanoAndamioDeps): EvidenceAdapter<Subject> {
  const check = deps.check ?? checkAnchor;
  return {
    id: ADAPTER_ID,
    sourceKind: "ledger",
    async resolve(request: Subject): Promise<TrustAssertion> {
      let anchor: Anchor;
      try {
        anchor = await check(request, deps.gateDeps(request));
      } catch (e) {
        // A chain-side "no" becomes the contract's refusal. An unreachable
        // indexer (UpstreamError) and anything else propagate unchanged:
        // an outage is never reported as a refusal.
        if (e instanceof GateRefusal) throw new AdapterRefusal(ADAPTER_ID, e.message, { cause: e });
        throw e;
      }
      return assertionFromAnchor(anchor);
    },
  };
}
