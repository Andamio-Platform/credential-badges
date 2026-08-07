import pako from "pako";

import { DocumentLoader } from "./document-loader.js";

// Minimal BitstringStatusListEntry checker — sufficient for the self-loopback
// sanity check. Independent verifiers (spruce, walt-id, 1EdTech) bring their own.
//
// Does NOT verify the status list credential's own proof. That's a separate
// signature-chain concern, out of scope for the spike (the same key signed it).
export async function makeCheckStatus(documentLoader: DocumentLoader) {
  return async function checkStatus({ credential }: { credential: any }) {
    const status = credential.credentialStatus;
    if (!status) {
      return { verified: true };
    }
    if (status.type !== "BitstringStatusListEntry") {
      return {
        verified: false,
        error: new Error(`unsupported credentialStatus type: ${status.type}`),
      };
    }

    const { document: listCred } = await documentLoader(status.statusListCredential);
    const encoded = listCred.credentialSubject?.encodedList;
    if (!encoded) {
      return {
        verified: false,
        error: new Error("status list missing credentialSubject.encodedList"),
      };
    }

    const compressed = Buffer.from(encoded, "base64url");
    const bits = pako.ungzip(compressed);

    const index = parseInt(status.statusListIndex, 10);
    const byteIndex = index >>> 3;
    const bitIndex = index & 0b111;
    const bit = (bits[byteIndex] >>> (7 - bitIndex)) & 1;

    if (bit === 1) {
      return {
        verified: false,
        error: new Error(
          `credential suspended at statusListIndex ${index} (statusPurpose=${listCred.credentialSubject?.statusPurpose})`,
        ),
      };
    }
    return { verified: true };
  };
}
