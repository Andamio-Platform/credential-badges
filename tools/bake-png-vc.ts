// bake-png-vc.ts — bake a signed OB3 VC into a badge PNG / extract it back.
//
// The PNG analog of tools/bake-signed-vc.ts (which bakes into the SVG). Per the
// OB 3.0 baking spec (section 5.3.1), a credential is embedded in a PNG as an
// iTXt chunk with keyword "openbadgecredential", UNCOMPRESSED. For Andamio's
// embedded eddsa-rdfc-2022 Data Integrity proof the text field is the signed VC
// JSON — the same bytes tools/bake-signed-vc.ts puts in the SVG's
// <openbadges:credential> CDATA.
//
// Byte-transparency contract (mirrors bake-signed-vc.ts):
//   - The signed VC is IMMUTABLE input, inserted byte-for-byte into the iTXt
//     text field — never parsed-and-reserialized, never reformatted. Any
//     mutation would break the signature.
//   - The image pixels (IHDR/IDAT/…/IEND) are preserved byte-identically; only
//     an iTXt metadata chunk is added, immediately before IEND.
//   - extract(bake(png, vc)) === vc for any signed vc.
//   - Refuses to bake an unsigned credential (no `proof` block).
//   - Exactly one "openbadgecredential" chunk: baking strips any pre-existing
//     one first, so a re-bake never accumulates duplicates (OB3: one credential).
//
// resvg does not write this chunk, so baking is a post-render step: rasterize
// the (baked) SVG to PNG, THEN bake the VC into the PNG. Regenerating the PNG
// (`make pngs`) un-bakes it, exactly as regenerating the SVG does — a PNG bake
// must follow any regeneration of a signed badge.
//
// Dependency-free by design (see tools/README.md): node: builtins only
// (node:zlib crc32 is available on Node >= 21; the repo runs Node 24).
//
// Usage:
//   node --experimental-strip-types tools/bake-png-vc.ts bake <badge.png> <signed-vc.json> <out.png>
//   node --experimental-strip-types tools/bake-png-vc.ts extract <badge.png> [out.json]

import { readFileSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEYWORD = "openbadgecredential";
const ITXT = "iTXt";
const IEND = "IEND";

interface Chunk {
  type: string;
  /** offset of the chunk's 4-byte length field */
  start: number;
  /** offset just past the chunk's CRC (i.e. start of the next chunk) */
  end: number;
  /** the chunk's data bytes (between type and CRC) */
  data: Buffer;
  /** the chunk's stored CRC-32 (over type + data) */
  crc: number;
}

/** Walk the PNG chunk stream. Throws if the signature or framing is malformed. */
function parseChunks(png: Buffer): Chunk[] {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("not a PNG (bad signature)");
  }
  const chunks: Chunk[] = [];
  let off = 8;
  while (off + 8 <= png.length) {
    const length = png.readUInt32BE(off);
    const type = png.toString("latin1", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4; // + CRC
    if (end > png.length) throw new Error(`truncated chunk ${type}`);
    chunks.push({
      type, start: off, end,
      data: png.subarray(dataStart, dataEnd),
      crc: png.readUInt32BE(dataEnd),
    });
    off = end;
    if (type === IEND) break;
  }
  if (!chunks.some((c) => c.type === IEND)) throw new Error("no IEND chunk");
  return chunks;
}

/** Serialize a PNG chunk: length(4 BE) + type(4) + data + crc32(type+data)(4 BE). */
function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

/** Build the uncompressed iTXt chunk data for our keyword carrying `vc`. */
function itxtData(vc: string): Buffer {
  return Buffer.concat([
    Buffer.from(KEYWORD, "latin1"),
    Buffer.from([0x00]), // null after keyword
    Buffer.from([0x00]), // compression flag: 0 = uncompressed
    Buffer.from([0x00]), // compression method: 0
    Buffer.from([0x00]), // empty language tag, null-terminated
    Buffer.from([0x00]), // empty translated keyword, null-terminated
    Buffer.from(vc, "utf8"),
  ]);
}

/** Extract the embedded credential bytes from an "openbadgecredential" iTXt
 *  chunk, exactly as they were baked. Throws if absent or compressed. */
export function extractVc(png: Buffer): string {
  for (const c of parseChunks(png)) {
    if (c.type !== ITXT) continue;
    const nul = c.data.indexOf(0x00);
    if (nul === -1) continue;
    if (c.data.toString("latin1", 0, nul) !== KEYWORD) continue;
    // Verify the chunk's CRC before trusting its bytes as the signed VC: a
    // bit-flipped credential chunk must fail loud here, not silently return a
    // corrupt "signed VC" that only breaks at downstream verification.
    const wantCrc = crc32(Buffer.concat([Buffer.from(ITXT, "latin1"), c.data])) >>> 0;
    if (c.crc !== wantCrc) {
      throw new Error("openbadgecredential iTXt chunk failed CRC check — credential is corrupt");
    }
    const compFlag = c.data[nul + 1];
    if (compFlag !== 0) {
      throw new Error("openbadgecredential iTXt is compressed — unsupported (spec: uncompressed)");
    }
    // skip: keyword\0 (nul+1) compFlag (nul+1) compMethod (nul+2) then two
    // null-terminated fields (language tag, translated keyword).
    const langStart = nul + 3;
    const langEnd = png_indexOf(c.data, 0x00, langStart);
    const transEnd = png_indexOf(c.data, 0x00, langEnd + 1);
    return c.data.toString("utf8", transEnd + 1);
  }
  throw new Error(`no "${KEYWORD}" iTXt chunk found in PNG`);
}

function png_indexOf(buf: Buffer, byte: number, from: number): number {
  const i = buf.indexOf(byte, from);
  if (i === -1) throw new Error("malformed iTXt chunk (missing null separator)");
  return i;
}

/** Bake `vc` (signed, byte-for-byte) into `png` as an uncompressed
 *  "openbadgecredential" iTXt chunk before IEND. Any pre-existing credential
 *  chunk is stripped first. Returns the baked PNG. */
export function bakePngVc(png: Buffer, vc: string): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(vc);
  } catch {
    throw new Error("credential is not valid JSON");
  }
  const cred = parsed as Record<string, unknown>;
  if (!cred || typeof cred !== "object" || !("proof" in cred)) {
    throw new Error("credential has no proof block — refusing to bake an unsigned credential");
  }

  const chunks = parseChunks(png);
  const iend = chunks.find((c) => c.type === IEND)!;
  const credential = makeChunk(ITXT, itxtData(vc));

  // Rebuild the PNG, dropping any existing openbadgecredential iTXt chunk and
  // inserting the fresh one immediately before IEND.
  const parts: Buffer[] = [PNG_SIG];
  for (const c of chunks) {
    if (isCredentialChunk(c)) continue; // strip stale credential chunk(s)
    if (c.type === IEND) parts.push(credential);
    parts.push(png.subarray(c.start, c.end));
  }
  const baked = Buffer.concat(parts);

  if (extractVc(baked) !== vc) {
    throw new Error("internal error: extract(bake(png, vc)) !== vc");
  }
  void iend;
  return baked;
}

function isCredentialChunk(c: Chunk): boolean {
  if (c.type !== ITXT) return false;
  const nul = c.data.indexOf(0x00);
  return nul !== -1 && c.data.toString("latin1", 0, nul) === KEYWORD;
}

function main(argv: string[]): void {
  const [mode, ...args] = argv;
  if (mode === "bake") {
    const [pngPath, vcPath, outPath] = args;
    if (!pngPath || !vcPath || !outPath) {
      throw new Error("usage: bake <badge.png> <signed-vc.json> <out.png>");
    }
    const baked = bakePngVc(readFileSync(pngPath), readFileSync(vcPath, "utf8"));
    writeFileSync(outPath, baked);
    console.error(`baked ${vcPath} into ${outPath} (${baked.length} bytes)`);
  } else if (mode === "extract") {
    const [pngPath, outPath] = args;
    if (!pngPath) throw new Error("usage: extract <badge.png> [out.json]");
    const vc = extractVc(readFileSync(pngPath));
    if (outPath) {
      writeFileSync(outPath, vc);
      console.error(`extracted ${Buffer.byteLength(vc)} bytes -> ${outPath}`);
    } else {
      process.stdout.write(vc);
    }
  } else {
    throw new Error("usage: bake-png-vc.ts <bake|extract> ...");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
