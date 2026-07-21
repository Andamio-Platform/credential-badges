// Rung 8.6 · Key-compromise kill-switch — the flip tool (deployment plan
// Decision 3: "flip-status-bit.ts is trivial: one bit per key compromise").
//
// PREPARES the flipped key-epoch status list; it NEVER signs. Separation of
// duties, deliberately: this tool derives the updated UNSIGNED payload
// deterministically from the COMMITTED signed list (one bit flipped,
// everything else byte-stable) and prints the exact hardened re-sign command
// the operator runs next. Signing stays exclusively on the existing hardened
// path (spike/signer-spike/sign-status-list.ts: context-cache clear -> live
// anchor gate -> live-DID key pin -> exactly ONE KMS call -> atomic write).
// No KMS, no gcloud, no network anywhere in this file.
//
//   Usage:
//     node --experimental-strip-types tools/flip-status-bit.ts \
//       <key-epoch> <bit-index> <purpose>
//
//     <key-epoch>  the committed list to flip, e.g. key-epoch-2026-07
//                  (reads status/<key-epoch>.json)
//     <bit-index>  the key version's registry position (0..63). Must be a
//                  position registered in KEY_VERSION_POSITIONS — flipping an
//                  unregistered or reserved-zero (64+) position is refused.
//     <purpose>    compromised-key  set the bit 0 -> 1: suspend EVERY
//                                   credential signed under that key version
//                  restore          clear the bit 1 -> 0: stand-down after a
//                                   false alarm (statusPurpose "suspension"
//                                   is the W3C reversible purpose)
//
//   Output: the unsigned flipped payload on STDOUT (the review artifact — the
//   exact document the hardened re-sign will produce and sign); the flip
//   report + next steps on STDERR.
//
// Operational context: docs/runbooks/key-compromise.md is the runbook this
// tool serves. Bit semantics are Decision 3's: one bit per signing key
// version, bit 0 = key-2026-07; flipping bit 0 suspends every credential
// signed under key-2026-07 — including the flagship badge — at once.
//
// Dependency-free (node builtins via status-list.ts) and CODEOWNERS-gated;
// tools/flip-status-bit.test.ts covers it hermetically in the no-install CI
// job (no KMS — ephemeral material only ever appears in tests).

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  KEY_VERSION_POSITIONS,
  SUSPENDED_KEY_VERSION_POSITIONS,
  STATUS_LIST_BIT_LENGTH,
  decodeStatusList,
  encodeStatusList,
  statusBitAt,
} from "../spike/signer-spike/status-list.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

export const STATUS_HOST = "https://credentials.andamio.io";

/** Positions 0..63 are the key-version region (Decision 3); 64+ is reserved
 *  zero forever. The kill-switch only ever operates inside the region. */
export const KEY_VERSION_REGION_END = 64;

export const FLIP_PURPOSES = ["compromised-key", "restore"] as const;
export type FlipPurpose = (typeof FLIP_PURPOSES)[number];

export interface FlipResult {
  /** The unsigned payload the hardened re-sign will reproduce and sign. */
  unsigned: Record<string, unknown>;
  keyEpoch: string;
  bitIndex: number;
  keyVersion: string;
  purpose: FlipPurpose;
  before: 0 | 1;
  after: 0 | 1;
  /** sha256 of the committed input bytes — provenance for the flip PR. */
  committedSha256: string;
}

/** XOR one bit (MSB-first per W3C) in a copy of the bitstring. Refuses
 *  non-integer (NaN sails through range comparisons) and out-of-range. */
export function flipBitInBitstring(bits: Uint8Array, index: number): Uint8Array {
  if (!Number.isInteger(index)) {
    throw new Error(`bit index is not an integer: ${index}`);
  }
  if (index < 0 || index >= bits.length * 8) {
    throw new Error(
      `bit index out of range: ${index} (list has ${bits.length * 8} bits)`,
    );
  }
  const out = Uint8Array.from(bits);
  out[index >>> 3] ^= 0b1000_0000 >>> (index & 0b111);
  return out;
}

/** Registry lookup: which key version owns this bit position? Refuses
 *  positions outside the key-version region or absent from the registry —
 *  the kill-switch flips key versions, never arbitrary bits. */
export function keyVersionAtPosition(bitIndex: number): string {
  if (!Number.isInteger(bitIndex)) {
    throw new Error(`bit index is not an integer: ${bitIndex}`);
  }
  if (bitIndex < 0 || bitIndex >= STATUS_LIST_BIT_LENGTH) {
    throw new Error(
      `bit index out of range: ${bitIndex} (0..${STATUS_LIST_BIT_LENGTH - 1})`,
    );
  }
  if (bitIndex >= KEY_VERSION_REGION_END) {
    throw new Error(
      `bit index ${bitIndex} is in the reserved-zero region (${KEY_VERSION_REGION_END}..${STATUS_LIST_BIT_LENGTH - 1} are reserved zero forever; key versions live at 0..${KEY_VERSION_REGION_END - 1})`,
    );
  }
  const entry = Object.entries(KEY_VERSION_POSITIONS).find(
    ([, pos]) => pos === bitIndex,
  );
  if (!entry) {
    throw new Error(
      `bit index ${bitIndex} is not a registered key-version position (registry: ${JSON.stringify(KEY_VERSION_POSITIONS)})`,
    );
  }
  return entry[0];
}

/** Derive the flipped UNSIGNED payload from the committed signed list.
 *  Pure: committed bytes in, unsigned payload out. Everything except
 *  `credentialSubject.encodedList` (and the stripped `proof`) is byte-stable. */
export function prepareFlip(
  committedBytes: Buffer | Uint8Array,
  keyEpoch: string,
  bitIndex: number,
  purpose: string,
): FlipResult {
  if (!(FLIP_PURPOSES as readonly string[]).includes(purpose)) {
    throw new Error(
      `unknown purpose "${purpose}" — expected one of: ${FLIP_PURPOSES.join(", ")} (Decision 3 limits the flip purpose to compromised-key events; restore is the false-alarm stand-down)`,
    );
  }
  if (!/^key-epoch-\d{4}-\d{2}$/.test(keyEpoch)) {
    throw new Error(
      `key epoch "${keyEpoch}" does not look like key-epoch-YYYY-MM`,
    );
  }
  const keyVersion = keyVersionAtPosition(bitIndex);

  const committed = JSON.parse(Buffer.from(committedBytes).toString("utf8"));
  const expectedId = `${STATUS_HOST}/status/${keyEpoch}.json`;
  if (committed.id !== expectedId) {
    throw new Error(
      `committed list id mismatch: ${committed.id} (expected ${expectedId})`,
    );
  }
  if (committed.credentialSubject?.statusPurpose !== "suspension") {
    throw new Error(
      `committed list statusPurpose is ${JSON.stringify(committed.credentialSubject?.statusPurpose)}, expected "suspension"`,
    );
  }
  if (!Array.isArray(committed.proof) || committed.proof.length === 0) {
    throw new Error(
      "committed list carries no proof — refuse to flip an unsigned base (the committed, served, SIGNED artifact is the only valid starting point)",
    );
  }

  const bits = decodeStatusList(committed.credentialSubject.encodedList);
  const before = statusBitAt(bits, bitIndex);
  if (purpose === "compromised-key" && before === 1) {
    throw new Error(
      `bit ${bitIndex} (${keyVersion}) is already 1 (suspended) — nothing to flip`,
    );
  }
  if (purpose === "restore" && before === 0) {
    throw new Error(
      `bit ${bitIndex} (${keyVersion}) is already 0 (fresh) — nothing to restore`,
    );
  }

  const flipped = flipBitInBitstring(bits, bitIndex);
  const after = statusBitAt(flipped, bitIndex);

  // Byte-stability: clone the committed document, strip the (now-dead) proof,
  // replace ONLY the encodedList. Key order and every other value pass
  // through the parse/serialize round-trip untouched.
  const { proof: _proof, ...unsigned } = committed;
  unsigned.credentialSubject = {
    ...unsigned.credentialSubject,
    encodedList: encodeStatusList(flipped),
  };

  return {
    unsigned,
    keyEpoch,
    bitIndex,
    keyVersion,
    purpose: purpose as FlipPurpose,
    before,
    after,
    committedSha256: createHash("sha256")
      .update(Buffer.from(committedBytes))
      .digest("hex"),
  };
}

/** Serialize exactly as the committed file: 2-space indent + trailing newline
 *  (the sign-status-list.ts write convention). */
export function serializePayload(unsigned: unknown): string {
  return JSON.stringify(unsigned, null, 2) + "\n";
}

/** The updated SUSPENDED_KEY_VERSION_POSITIONS the flip PR must commit —
 *  the builder + CI read suspension state from that constant, so the flip
 *  lands in code, not just in the regenerated artifact. */
export function nextSuspendedPositions(result: FlipResult): number[] {
  const current = new Set(SUSPENDED_KEY_VERSION_POSITIONS);
  if (result.purpose === "compromised-key") current.add(result.bitIndex);
  else current.delete(result.bitIndex);
  return [...current].sort((a, b) => a - b);
}

/** The operator's next steps. This tool prepares; the OPERATOR signs — via
 *  the hardened sign-status-list.ts path, never any other way. */
export function renderNextSteps(result: FlipResult): string {
  const positions = JSON.stringify(nextSuspendedPositions(result));
  const state = result.after === 1 ? "1 (SUSPENDED)" : "0 (fresh)";
  return `\
FLIP PREPARED — NOTHING IS SIGNED AND NOTHING IS LIVE YET.

  key epoch      ${result.keyEpoch}
  bit            ${result.bitIndex} (${result.keyVersion}): ${result.before} -> ${state}
  purpose        ${result.purpose}
  derived from   status/${result.keyEpoch}.json (sha256 ${result.committedSha256})

The payload on stdout is the review artifact: the exact unsigned document the
hardened re-sign will rebuild and sign. Next steps (docs/runbooks/key-compromise.md
is the full runbook — cache windows, cross-verifier reads, DID-doc response):

  1. Record the flip in code — the builder and CI read suspension state from
     the committed constant, so the flip is a reviewed code change:
       spike/signer-spike/status-list.ts:
         export const SUSPENDED_KEY_VERSION_POSITIONS: readonly number[] = ${positions};

  2. Re-sign through the hardened path (context-cache clear -> live anchor
     gate -> live-DID key pin -> exactly ONE KMS call -> atomic write). This
     tool did NOT sign; only this path may:
       cd spike/signer-spike && npm run sign:status

  3. Update the committed-file sha pin (the stale-proof guard in
     spike/signer-spike/status-list.test.ts — its comment documents this exact
     procedure: "UPDATE THIS PIN ON EVERY LEGITIMATE RE-SIGN"):
       shasum -a 256 status/${result.keyEpoch}.json
       -> paste into COMMITTED_STATUS_FILE_SHA256

  4. Prove coherence locally, then ship via reviewed PR + tag deploy
     (CODEOWNERS gates /status/** and this tool; only a v* tag deploys):
       node --experimental-strip-types --test spike/signer-spike/*.test.ts tools/*.test.ts
       git checkout -b <flip-branch> && git commit && git push -u origin HEAD
       # after merge:  git tag vX.Y.Z && git push origin vX.Y.Z

  5. AFTER deploy: the served list has Cache-Control max-age=3600 — warm
     verifier caches can lag up to an hour. Run the runbook's REQUIRED
     cross-verifier read of the LIVE flipped list before relying on
     propagation (the bitstring bit-order has never been exercised by a
     production flip until this moment).
`;
}

function main(): void {
  const [keyEpoch, bitIndexRaw, purpose] = process.argv.slice(2);
  if (!keyEpoch || bitIndexRaw === undefined || !purpose) {
    process.stderr.write(
      "usage: node --experimental-strip-types tools/flip-status-bit.ts <key-epoch> <bit-index> <purpose>\n" +
        `  e.g.: node --experimental-strip-types tools/flip-status-bit.ts key-epoch-2026-07 0 compromised-key\n` +
        `  purposes: ${FLIP_PURPOSES.join(" | ")}\n`,
    );
    process.exit(2);
  }
  // Strict integer parse: parseInt("0x10")/parseInt("1.9") style surprises and
  // NaN are all refused before any bit math sees the value.
  if (!/^\d+$/.test(bitIndexRaw)) {
    throw new Error(`bit index is not a non-negative integer: ${JSON.stringify(bitIndexRaw)}`);
  }
  const bitIndex = Number(bitIndexRaw);

  const committedFile = join(REPO, "status", `${keyEpoch}.json`);
  const committedBytes = readFileSync(committedFile);
  const result = prepareFlip(committedBytes, keyEpoch, bitIndex, purpose);

  process.stdout.write(serializePayload(result.unsigned));
  process.stderr.write(renderNextSteps(result));
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
