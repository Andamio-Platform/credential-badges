// Key-version registry + BitstringStatusListEntry emission (deployment plan
// Decision 3, refined per P1-01 + P1-07). Ported from
// spike/signer-spike/status-list.ts (Rung 8.3); the service needs only the
// ENTRY side (emission + bit reading for the post-sign status check) — the
// list BUILDER stays in the spike/tools, since the served list is produced by
// the CODEOWNERS-gated signing path, never by this service at runtime.
//
// The registry is a BUILD-TIME CONSTANT ("config or enum, not a runtime
// computation"): the bit position of the key version that signs a credential
// is that credential's statusListIndex. No per-credential state exists.

import { gunzipSync } from "node:zlib";

export const STATUS_LIST_URL =
  "https://credentials.andamio.io/status/key-epoch-2026-07.json";

export const KEY_VERSION_POSITIONS: Readonly<Record<string, number>> = {
  "key-2026-07": 0,
};

export const ACTIVE_KEY_VERSION = "key-2026-07";
export const ACTIVE_KEY_STATUS_INDEX = KEY_VERSION_POSITIONS[ACTIVE_KEY_VERSION];

/** Inverse of the spike's encodeStatusList — used by the post-sign status check. */
export function decodeStatusList(encodedList: string): Uint8Array {
  if (!encodedList.startsWith("u")) {
    throw new Error(
      `encodedList is not multibase base64url-no-pad (missing "u" prefix): ${encodedList.slice(0, 8)}…`,
    );
  }
  return new Uint8Array(gunzipSync(Buffer.from(encodedList.slice(1), "base64url")));
}

/** Read one bit. W3C: bit position 0 is the MOST-significant bit of byte 0. */
export function statusBitAt(bits: Uint8Array, index: number): 0 | 1 {
  if (!Number.isInteger(index)) {
    throw new Error(`status-list index is not an integer: ${index}`);
  }
  if (index < 0 || index >= bits.length * 8) {
    throw new Error(`status-list index out of range: ${index}`);
  }
  return ((bits[index >>> 3] >>> (7 - (index & 0b111))) & 1) as 0 | 1;
}

/** The credentialStatus entry a subject credential carries (Decision 3):
 *  statusListIndex = the active signing key version's registry position. */
export function statusListEntry() {
  return {
    id: `${STATUS_LIST_URL}#${ACTIVE_KEY_STATUS_INDEX}`,
    type: "BitstringStatusListEntry",
    statusPurpose: "suspension",
    statusListIndex: String(ACTIVE_KEY_STATUS_INDEX),
    statusListCredential: STATUS_LIST_URL,
  };
}
