// Rung 8 · SLT-hash derivation — the on-chain commitment, recomputed locally.
//
// An Andamio module's `slt_hash` is NOT an opaque identifier: it commits to the
// module's SLT texts. The on-chain Plutus validator (and @andamio/core's
// computeSltHash, mirrored by the andamio CLI's
// `course credential verify-hash` — internal/cardano/slt_hash.go) derives it as:
//
//   blake2b_256( serialiseData( toBuiltinData( map stringToBuiltinByteString slts ) ) )
//
// which concretely is Blake2b-256 over an indefinite-length CBOR array (0x9f …
// 0xff) of the SLT strings' UTF-8 bytes, where each string is a definite-length
// CBOR byte string when <= 64 bytes and a Plutus chunked indefinite-length byte
// string (0x5f + 64-byte chunks + 0xff) when longer.
//
// This lets the anchor gate verify that the SLT texts fetched from Andamioscan
// are exactly the texts the on-chain `slt_hash` commits to — so the signed
// `criteria.narrative` can never carry tampered or drifted SLT text
// (issue #54, finding 3).
//
// Both the CBOR encoder and the Blake2b-256 implementation below are
// dependency-free on purpose: this sits on the trust-critical signing path
// (same policy as tools/gen-did-json.ts). Blake2b follows RFC 7693; the test
// file pins RFC-derived vectors plus the real mainnet subject module.

// ---------------------------------------------------------------------------
// Plutus Data CBOR encoding (mirrors andamio-cli internal/cardano/slt_hash.go)
// ---------------------------------------------------------------------------

// Byte boundary at which Plutus's stringToBuiltinByteString switches from a
// definite-length CBOR byte string to an indefinite-length chunked one.
const PLUTUS_CHUNK_SIZE = 64;

function encodeCborBytes(data: Uint8Array): Uint8Array {
  const n = data.length;
  let header: number[];
  if (n < 24) header = [0x40 + n];
  else if (n < 256) header = [0x58, n];
  else header = [0x59, n >> 8, n & 0xff];
  const out = new Uint8Array(header.length + n);
  out.set(header, 0);
  out.set(data, header.length);
  return out;
}

function encodePlutusBuiltinByteString(data: Uint8Array): Uint8Array {
  if (data.length <= PLUTUS_CHUNK_SIZE) return encodeCborBytes(data);
  const parts: Uint8Array[] = [new Uint8Array([0x5f])]; // indefinite byte string
  for (let i = 0; i < data.length; i += PLUTUS_CHUNK_SIZE) {
    parts.push(encodeCborBytes(data.subarray(i, i + PLUTUS_CHUNK_SIZE)));
  }
  parts.push(new Uint8Array([0xff])); // break
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Exposed for tests: the exact pre-image bytes that get hashed.
export function encodeSltList(slts: readonly string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [new Uint8Array([0x9f])]; // indefinite array
  for (const slt of slts) {
    parts.push(encodePlutusBuiltinByteString(enc.encode(slt)));
  }
  parts.push(new Uint8Array([0xff])); // break
  return concat(parts);
}

// ---------------------------------------------------------------------------
// Blake2b-256 (RFC 7693), unkeyed — BigInt 64-bit words
// ---------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

const IV: readonly bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

const SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function readLE64(block: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(block[off + i]);
  return v;
}

function compress(
  h: bigint[],
  block: Uint8Array,
  t: bigint,
  last: boolean,
): void {
  const m: bigint[] = new Array(16);
  for (let i = 0; i < 16; i++) m[i] = readLE64(block, i * 8);

  const v: bigint[] = [...h, ...IV];
  v[12] ^= t & MASK64;
  v[13] ^= (t >> 64n) & MASK64;
  if (last) v[14] ^= MASK64;

  const G = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
    v[a] = (v[a] + v[b] + x) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 32n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 24n);
    v[a] = (v[a] + v[b] + y) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 16n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 63n);
  };

  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r];
    G(0, 4, 8, 12, m[s[0]], m[s[1]]);
    G(1, 5, 9, 13, m[s[2]], m[s[3]]);
    G(2, 6, 10, 14, m[s[4]], m[s[5]]);
    G(3, 7, 11, 15, m[s[6]], m[s[7]]);
    G(0, 5, 10, 15, m[s[8]], m[s[9]]);
    G(1, 6, 11, 12, m[s[10]], m[s[11]]);
    G(2, 7, 8, 13, m[s[12]], m[s[13]]);
    G(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) h[i] = h[i] ^ v[i] ^ v[i + 8];
}

export function blake2b256(data: Uint8Array): Uint8Array {
  const outlen = 32;
  const h = [...IV];
  // Parameter block word 0: digest length, key length 0, fanout 1, depth 1.
  h[0] ^= BigInt(outlen) | (1n << 16n) | (1n << 24n);

  let t = 0n;
  // All full 128-byte blocks except the final (possibly partial, possibly
  // empty) one, which is padded and compressed with the finalization flag.
  const n = data.length;
  let off = 0;
  while (n - off > 128) {
    t += 128n;
    compress(h, data.subarray(off, off + 128), t, false);
    off += 128;
  }
  const lastLen = n - off;
  const last = new Uint8Array(128);
  last.set(data.subarray(off));
  t += BigInt(lastLen);
  compress(h, last, t, true);

  const out = new Uint8Array(outlen);
  for (let i = 0; i < outlen; i++) {
    out[i] = Number((h[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The derivation the anchor gate verifies
// ---------------------------------------------------------------------------

export function computeSltHash(slts: readonly string[]): string {
  return Buffer.from(blake2b256(encodeSltList(slts))).toString("hex");
}
