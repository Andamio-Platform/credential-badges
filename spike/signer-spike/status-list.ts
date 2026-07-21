// Rung 8.3 · BitstringStatusList builder (deployment plan Decision 3, refined
// per P1-01 + P1-07 + the W3C minimum-size auto-fix).
//
// Builds the UNSIGNED key-epoch status list credential served at
// https://credentials.andamio.io/status/key-epoch-2026-07.json. Semantics:
//
//   - `statusPurpose: "suspension"` — the W3C-standard purpose for
//     reversible/temporary invalidity; the closest fit for what a flipped bit
//     means here ("Andamio's off-chain attestation is no longer fresh — check
//     the chain"). Flip purpose is limited to compromised-key events.
//   - ONE BIT PER SIGNING KEY VERSION, not per credential. Positions 0..63 are
//     reserved for key versions (bit 0 = key-2026-07); positions 64..131071
//     are reserved zero forever. Flipping a bit suspends every credential
//     signed under that key version at once — the right shape for a
//     key-compromise event. No per-credential state exists anywhere.
//   - 131,072 bits (16 KiB) — the W3C Bitstring Status List minimum length,
//     which exists for herd privacy; ~150 bytes gzipped.
//   - `encodedList` is MULTIBASE base64url-no-pad ("u" prefix) over the
//     GZIP-compressed bitstring, per the W3C spec ("The encodedList property
//     of the credential subject MUST be a Multibase-encoded base64url (with
//     no padding)"). The rung-1 throwaway fixture omitted the multibase
//     prefix; this module is spec-correct.
//   - The GZIP member is emitted with mtime=0 (node:zlib default), so the
//     encoding is deterministic PER PLATFORM (the gzip header's OS byte
//     varies across OSes — the committed artifact carries the macOS byte,
//     Linux CI produces another). The committed-artifact invariant therefore
//     compares the DECODED bitstring bit-for-bit, and re-sign byte-stability
//     is unaffected: resign runs re-sign the COMMITTED document, never a
//     rebuilt encoding.
//
// Dependency-free on purpose (node:zlib only): status-list.test.ts runs in the
// hermetic CI job with no npm install. Signing happens in sign-status-list.ts,
// which feeds this builder through the hardened signer seam.

import { gzipSync, gunzipSync } from "node:zlib";

export const STATUS_LIST_BIT_LENGTH = 131_072;

export const STATUS_LIST_URL =
  "https://credentials.andamio.io/status/key-epoch-2026-07.json";

// Key-version registry (deployment plan Decision 3: "a build-time constant
// (config or enum), not a runtime computation"). The bit position of the key
// version that signs a credential is that credential's statusListIndex.
export const KEY_VERSION_POSITIONS: Readonly<Record<string, number>> = {
  "key-2026-07": 0,
};

export const ACTIVE_KEY_VERSION = "key-2026-07";
export const ACTIVE_KEY_STATUS_INDEX = KEY_VERSION_POSITIONS[ACTIVE_KEY_VERSION];

// Rung 8.6 · The committed source of truth for which key-version bits are
// currently SET (suspended). Empty = every key version fresh. Changed ONLY
// through the key-compromise kill-switch (tools/flip-status-bit.ts +
// docs/runbooks/key-compromise.md): the flip PR moves this constant, the
// re-signed status/ artifact, and the sha pin in status-list.test.ts
// together, and CI enforces their coherence — the served list can never
// silently disagree with the declared suspension state.
export const SUSPENDED_KEY_VERSION_POSITIONS: readonly number[] = [];

// Deterministic dating convention for the status list credential: the first
// instant of the key epoch it covers (key-2026-07 -> July 2026). Like the
// subject credential's block_time pinning, this is a stated convention, not a
// wall-clock reading — it makes KMS re-signs of an unchanged list reproduce
// byte-identical artifacts.
export const STATUS_LIST_VALID_FROM = "2026-07-01T00:00:00Z";

/** Multibase base64url-no-pad ("u" prefix), per W3C Bitstring Status List. */
export function multibaseB64UrlNoPad(bytes: Uint8Array): string {
  return "u" + Buffer.from(bytes).toString("base64url");
}

/** GZIP + multibase-base64url the bitstring, per the spec's Bitstring
 *  Generation Algorithm. node:zlib writes mtime=0, so this is deterministic. */
export function encodeStatusList(bits: Uint8Array): string {
  return multibaseB64UrlNoPad(gzipSync(bits));
}

/** Inverse of encodeStatusList — used by the loopback status check. */
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
  // Number.isInteger refuses NaN and fractions — a NaN from a malformed
  // statusListIndex would sail through the range comparisons below (every
  // NaN comparison is false) and silently read bit 0.
  if (!Number.isInteger(index)) {
    throw new Error(`status-list index is not an integer: ${index}`);
  }
  if (index < 0 || index >= bits.length * 8) {
    throw new Error(`status-list index out of range: ${index}`);
  }
  return ((bits[index >>> 3] >>> (7 - (index & 0b111))) & 1) as 0 | 1;
}

export interface StatusListOpts {
  /** Key-version bit positions to flip to 1 (suspended). Defaults to the
   *  committed SUSPENDED_KEY_VERSION_POSITIONS, so the default build — and
   *  therefore sign-status-list.ts — always emits the declared state. */
  flippedKeyVersionPositions?: readonly number[];
}

/** The unsigned BitstringStatusListCredential. All Bitstring terms are
 *  defined by the W3C VC 2.0 base context, so no Andamio context is needed. */
export function buildStatusListCredential(issuerDid: string, opts: StatusListOpts = {}) {
  const bytes = new Uint8Array(STATUS_LIST_BIT_LENGTH / 8);
  for (const pos of opts.flippedKeyVersionPositions ?? SUSPENDED_KEY_VERSION_POSITIONS) {
    if (pos < 0 || pos >= STATUS_LIST_BIT_LENGTH) {
      throw new Error(`status-list position out of range: ${pos}`);
    }
    bytes[pos >>> 3] |= 0b1000_0000 >>> (pos & 0b111);
  }

  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: STATUS_LIST_URL,
    type: ["VerifiableCredential", "BitstringStatusListCredential"],
    issuer: issuerDid,
    validFrom: STATUS_LIST_VALID_FROM,
    credentialSubject: {
      id: `${STATUS_LIST_URL}#list`,
      type: "BitstringStatusList",
      statusPurpose: "suspension",
      encodedList: encodeStatusList(bytes),
    },
  };
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
