import pako from "pako";
import { DID, STATUS_LIST_ID, STATUS_LIST_URL } from "./did-web.js";

// W3C BitstringStatusList minimum size (16 KiB = 131,072 bits).
// Per plan Decision 3 + second-pass auto-fix: positions 0..63 reserved for
// signing key versions; positions 64..131071 reserved zero forever (or for
// a future per-credential purpose if attestation framing evolves).
const STATUS_LIST_BIT_LENGTH = 131_072;

// GZIP + base64url, per W3C BitstringStatusList spec section "Bitstring Generation Algorithm".
function encodeStatusList(bits: Uint8Array): string {
  const gz = pako.gzip(bits);
  return Buffer.from(gz).toString("base64url");
}

export interface StatusListOpts {
  flippedKeyVersionPositions?: number[];
}

export function buildStatusListCredential(opts: StatusListOpts = {}) {
  const bytes = new Uint8Array(STATUS_LIST_BIT_LENGTH / 8);
  for (const pos of opts.flippedKeyVersionPositions ?? []) {
    if (pos < 0 || pos >= STATUS_LIST_BIT_LENGTH) {
      throw new Error(`status-list position out of range: ${pos}`);
    }
    const byteIndex = pos >>> 3;
    const bitIndex = pos & 0b111;
    // W3C BitstringStatusList: bit position 0 is the most-significant bit of byte 0.
    bytes[byteIndex] |= 0b1000_0000 >>> bitIndex;
  }

  const encodedList = encodeStatusList(bytes);

  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
    ],
    id: STATUS_LIST_URL,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: DID,
    validFrom: "2026-05-25T00:00:00Z",
    credentialSubject: {
      id: `${STATUS_LIST_URL}#list`,
      type: "BitstringStatusList",
      statusPurpose: "suspension",
      encodedList,
    },
  };
}
