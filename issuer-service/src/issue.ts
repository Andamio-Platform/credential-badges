// Issue + post-sign verify. Origin: spike/signer-spike/sign.ts (Rung 8
// hardened): the narrow vc.issue fallback (issue #54 finding 1), and the
// never-serve-what-does-not-verify posture — every signed credential is
// loopback-verified (including its status bit) before it leaves the process.

import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import jsigs from "jsonld-signatures";

import { isKnownUrnIdDataModelError } from "./issue-error.ts";
import type { RawSigner } from "./signer.ts";
import type { DocumentLoader } from "./document-loader.ts";
import { decodeStatusList, statusBitAt, STATUS_LIST_URL } from "./status-list.ts";

export async function issueWith(
  credential: any,
  signer: RawSigner,
  documentLoader: DocumentLoader,
  created: string,
): Promise<any> {
  const suite = new DataIntegrityProof({
    signer,
    date: created,
    cryptosuite: eddsaRdfc2022,
  });
  try {
    return await vc.issue({ credential, suite, documentLoader });
  } catch (e) {
    // NARROW catch (finding 1): only the known urn-id data-model TypeError
    // from vc.issue's _checkCredential may fall back to jsigs.sign (which
    // produces the identical proof without the data-model re-check). Any
    // other error — a real data-model violation, a loader refusal, a signer
    // failure, a post-signer throw — aborts the request.
    if (!isKnownUrnIdDataModelError(e)) throw e;
    const { AssertionProofPurpose } = (jsigs as any).purposes;
    return await (jsigs as any).sign(structuredClone(credential), {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });
  }
}

/** checkStatus hook for the post-sign loopback verify. The status list
 *  credential is injected (the committed repo status/ file in production —
 *  the same bytes the static host serves; a fixture in tests). Ported from
 *  spike/signer-spike/check-status.ts. */
export function makeCheckStatus(statusListCredential: any) {
  return async function checkStatus({ credential }: { credential: any }) {
    const status = credential.credentialStatus;
    if (!status) return { verified: true };
    try {
      if (status.type !== "BitstringStatusListEntry") {
        throw new Error(`unsupported credentialStatus type: ${status.type}`);
      }
      if (status.statusListCredential !== STATUS_LIST_URL) {
        throw new Error(
          `credentialStatus points at ${status.statusListCredential}, expected ${STATUS_LIST_URL}`,
        );
      }
      const subject = statusListCredential.credentialSubject ?? {};
      if (subject.statusPurpose !== status.statusPurpose) {
        throw new Error(
          `statusPurpose mismatch: entry says ${status.statusPurpose}, list says ${subject.statusPurpose}`,
        );
      }
      const bits = decodeStatusList(subject.encodedList);
      const index = Number.parseInt(status.statusListIndex, 10);
      if (!Number.isInteger(index)) {
        throw new Error(
          `statusListIndex is not an integer: ${JSON.stringify(status.statusListIndex)}`,
        );
      }
      if (statusBitAt(bits, index) === 1) {
        throw new Error(
          `credential SUSPENDED at statusListIndex ${index} (signing key version not fresh — chain remains authoritative)`,
        );
      }
      return { verified: true };
    } catch (e) {
      return { verified: false, error: e as Error };
    }
  };
}

export async function verifyWith(
  signed: any,
  documentLoader: DocumentLoader,
  checkStatus: (opts: { credential: any }) => Promise<any>,
): Promise<void> {
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const r: any = await vc.verifyCredential({
    credential: signed,
    suite,
    documentLoader,
    checkStatus,
  });
  if (!r.verified) {
    const nested = r.error?.errors?.map((e: any) => e.message).join("; ");
    throw new Error(`post-sign verification FAILED: ${r.error?.message ?? "?"} ${nested ?? ""}`);
  }
}
