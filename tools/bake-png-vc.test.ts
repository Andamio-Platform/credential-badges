// bake-png-vc.test.ts — U4 tests for PNG iTXt credential baking (#69, OB3 5.3.1).
//
// Mirrors tools/bake-signed-vc.test.ts: round-trip byte-identity, refuse-
// unsigned, single-chunk, and image-pixel preservation. Uses the real signed VC
// fixture and the flagship's committed PNG so the round trip is exercised on
// production-shaped inputs. Hermetic: reads only committed repo files, no
// network. Run: node --experimental-strip-types --test tools/bake-png-vc.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { bakePngVc, extractVc } from "./bake-png-vc.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// The flagship signed subject — its committed PNG is the realistic bake target.
const COURSE_ID = "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df";
const SLT_HASH = "e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db";
const FLAGSHIP_PNG = join(REPO, "badges", `${COURSE_ID}.${SLT_HASH}.png`);
const SIGNED_VC = join(REPO, "signing", "signed-credential.json");

const flagshipPng = readFileSync(FLAGSHIP_PNG);
const signedVc = readFileSync(SIGNED_VC, "utf8");

function nonItxtChunks(png: Buffer): Buffer[] {
  // Chunk stream after the 8-byte signature, excluding iTXt chunks.
  const out: Buffer[] = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    const end = off + 12 + len;
    if (type !== "iTXt") out.push(png.subarray(off, end));
    off = end;
    if (type === "IEND") break;
  }
  return out;
}

test("round trip on the real flagship PNG + signed VC is byte-identical", () => {
  const baked = bakePngVc(flagshipPng, signedVc);
  assert.equal(extractVc(baked), signedVc);
});

test("round trip on synthetic VC bytes, including a trailing newline", () => {
  for (const vc of ['{"proof":[]}', '{\n  "proof": []\n}\n']) {
    assert.equal(extractVc(bakePngVc(flagshipPng, vc)), vc);
  }
});

test("refuses to bake an unsigned credential (no proof)", () => {
  assert.throws(() => bakePngVc(flagshipPng, '{"name":"x"}'), /unsigned/);
});

test("refuses non-JSON and non-PNG input", () => {
  assert.throws(() => bakePngVc(flagshipPng, "not json"), /valid JSON/);
  assert.throws(() => bakePngVc(Buffer.from("nope"), '{"proof":[]}'), /not a PNG/);
});

test("exactly one credential chunk after a re-bake (no duplicates)", () => {
  const once = bakePngVc(flagshipPng, '{"proof":["a"]}');
  const twice = bakePngVc(once, '{"proof":["b"]}');
  // The second bake replaces the first; extract returns the latest.
  assert.equal(extractVc(twice), '{"proof":["b"]}');
  // Count openbadgecredential iTXt chunks — must be exactly one.
  let count = 0;
  let off = 8;
  while (off + 8 <= twice.length) {
    const len = twice.readUInt32BE(off);
    const type = twice.toString("latin1", off + 4, off + 8);
    if (type === "iTXt") {
      const data = twice.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0x00);
      if (data.toString("latin1", 0, nul) === "openbadgecredential") count++;
    }
    off = off + 12 + len;
    if (type === "IEND") break;
  }
  assert.equal(count, 1, "expected exactly one openbadgecredential chunk");
});

test("bake preserves the image pixels (IHDR/IDAT/IEND) byte-for-byte", () => {
  const baked = bakePngVc(flagshipPng, signedVc);
  assert.deepEqual(nonItxtChunks(baked), nonItxtChunks(flagshipPng));
});

test("extract throws on a PNG with no credential chunk", () => {
  assert.throws(() => extractVc(flagshipPng), /no "openbadgecredential" iTXt/);
});

// Locate the openbadgecredential iTXt chunk's byte range in a baked PNG.
function findCredChunk(png: Buffer): { start: number; dataStart: number; len: number } {
  let off = 8;
  while (off + 8 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    if (type === "iTXt") {
      const data = png.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0x00);
      if (data.toString("latin1", 0, nul) === "openbadgecredential") {
        return { start: off, dataStart: off + 8, len };
      }
    }
    off = off + 12 + len;
    if (type === "IEND") break;
  }
  throw new Error("no cred chunk");
}

test("the baked iTXt chunk carries a valid CRC-32 over type+data", () => {
  const baked = bakePngVc(flagshipPng, signedVc);
  const { start, dataStart, len } = findCredChunk(baked);
  const data = baked.subarray(dataStart, dataStart + len);
  const storedCrc = baked.readUInt32BE(dataStart + len);
  const want = crc32(Buffer.concat([Buffer.from("iTXt", "latin1"), data])) >>> 0;
  assert.equal(storedCrc, want, "written CRC must match recomputed crc32(type+data)");
  void start;
});

test("extract fails loud on a bit-flipped credential chunk (CRC mismatch)", () => {
  const baked = Buffer.from(bakePngVc(flagshipPng, signedVc));
  const { dataStart, len } = findCredChunk(baked);
  // Flip a byte inside the text field (well past the header) — CRC no longer matches.
  baked[dataStart + len - 3] ^= 0xff;
  assert.throws(() => extractVc(baked), /failed CRC check/);
});

test("extract rejects a compressed openbadgecredential iTXt chunk", () => {
  const baked = Buffer.from(bakePngVc(flagshipPng, signedVc));
  const { dataStart } = findCredChunk(baked);
  // The compression flag sits just after "openbadgecredential\0" (19 + 1 bytes).
  const compFlagOff = dataStart + "openbadgecredential".length + 1;
  baked[compFlagOff] = 0x01; // mark compressed
  // Fix the CRC so we exercise the compression check, not the CRC check.
  const { len } = findCredChunk(baked);
  const data = baked.subarray(dataStart, dataStart + len);
  baked.writeUInt32BE(crc32(Buffer.concat([Buffer.from("iTXt", "latin1"), data])) >>> 0, dataStart + len);
  assert.throws(() => extractVc(baked), /compressed/);
});
