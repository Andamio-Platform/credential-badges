/**
 * Minimal Plutus Data CBOR decoder + Andamio gjames-datum interpreter.
 *
 * Shared between `verify.ts` (datum-membership check against a credential's
 * claims) and `inspect.ts` (dump a gjames datum by alias).
 *
 * Plutus Data encoding:
 *   Constr 0..6           = CBOR tag 121..127 + array of args
 *   Constr 7..127         = CBOR tag 1280..1400 + array of args
 *   Constr N>=128         = CBOR tag 102 + array [N, args]
 *   Map                   = CBOR map (major type 5)
 *   List                  = CBOR array (major type 4)
 *   I (integer)           = CBOR uint (major type 0) or negint (major type 1)
 *   B (bytestring)        = CBOR byte string (major type 2), possibly chunked indef
 *
 * Indefinite-length arrays (0x9f..0xff), maps (0xbf..0xff), and byte strings
 * (0x5f..0xff) are all valid Plutus encodings.
 */

export type PlutusData =
  | { kind: "constr"; tag: number; args: PlutusData[] }
  | { kind: "map"; entries: [PlutusData, PlutusData][] }
  | { kind: "list"; items: PlutusData[] }
  | { kind: "bytes"; value: Uint8Array }
  | { kind: "int"; value: bigint };

export class CborReader {
  private offset = 0;
  constructor(private buf: Uint8Array) {}

  done(): boolean { return this.offset >= this.buf.length; }

  private byte(): number {
    if (this.offset >= this.buf.length) throw new Error("CBOR: unexpected EOF");
    return this.buf[this.offset++];
  }

  private readUint(info: number): bigint {
    if (info < 24) return BigInt(info);
    if (info === 24) return BigInt(this.byte());
    if (info === 25) return (BigInt(this.byte()) << 8n) | BigInt(this.byte());
    if (info === 26) {
      let v = 0n;
      for (let i = 0; i < 4; i++) v = (v << 8n) | BigInt(this.byte());
      return v;
    }
    if (info === 27) {
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.byte());
      return v;
    }
    throw new Error(`CBOR: invalid additional info ${info} for uint`);
  }

  private readBytes(len: number): Uint8Array {
    if (this.offset + len > this.buf.length) throw new Error("CBOR: byte string EOF");
    const slice = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }

  read(): PlutusData {
    const ib = this.byte();
    const major = ib >> 5;
    const info = ib & 0x1f;

    switch (major) {
      case 0: return { kind: "int", value: this.readUint(info) };
      case 1: return { kind: "int", value: -1n - this.readUint(info) };
      case 2: {
        if (info === 31) {
          const chunks: Uint8Array[] = [];
          while (true) {
            const next = this.byte();
            if (next === 0xff) break;
            if (next >> 5 !== 2) throw new Error("CBOR: indef bytes contains non-bytes chunk");
            const len = Number(this.readUint(next & 0x1f));
            chunks.push(this.readBytes(len));
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.length; }
          return { kind: "bytes", value: out };
        }
        const len = Number(this.readUint(info));
        return { kind: "bytes", value: this.readBytes(len) };
      }
      case 4: {
        const items: PlutusData[] = [];
        if (info === 31) {
          while (this.buf[this.offset] !== 0xff) items.push(this.read());
          this.offset++;
        } else {
          const n = Number(this.readUint(info));
          for (let i = 0; i < n; i++) items.push(this.read());
        }
        return { kind: "list", items };
      }
      case 5: {
        const entries: [PlutusData, PlutusData][] = [];
        if (info === 31) {
          while (this.buf[this.offset] !== 0xff) {
            const k = this.read();
            const v = this.read();
            entries.push([k, v]);
          }
          this.offset++;
        } else {
          const n = Number(this.readUint(info));
          for (let i = 0; i < n; i++) {
            const k = this.read();
            const v = this.read();
            entries.push([k, v]);
          }
        }
        return { kind: "map", entries };
      }
      case 6: {
        const tag = Number(this.readUint(info));
        if (tag >= 121 && tag <= 127) {
          const arr = this.read();
          if (arr.kind !== "list") throw new Error(`CBOR: tag ${tag} expected list, got ${arr.kind}`);
          return { kind: "constr", tag: tag - 121, args: arr.items };
        }
        if (tag >= 1280 && tag <= 1400) {
          const arr = this.read();
          if (arr.kind !== "list") throw new Error(`CBOR: tag ${tag} expected list, got ${arr.kind}`);
          return { kind: "constr", tag: tag - 1280 + 7, args: arr.items };
        }
        if (tag === 102) {
          const arr = this.read();
          if (arr.kind !== "list" || arr.items.length !== 2) {
            throw new Error("CBOR: tag 102 expected 2-item list");
          }
          const [n, args] = arr.items;
          if (n.kind !== "int" || args.kind !== "list") {
            throw new Error("CBOR: tag 102 malformed");
          }
          return { kind: "constr", tag: Number(n.value), args: args.items };
        }
        throw new Error(`CBOR: unsupported tag ${tag}`);
      }
      default:
        throw new Error(`CBOR: unsupported major type ${major} (initial byte 0x${ib.toString(16)})`);
    }
  }
}

export function decodePlutusData(hex: string): PlutusData {
  const buf = new Uint8Array(hex.length / 2);
  for (let i = 0; i < buf.length; i++) buf[i] = parseInt(hex.substr(i * 2, 2), 16);
  const r = new CborReader(buf);
  return r.read();
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

export function bytesToAscii(b: Uint8Array): string {
  return Array.from(b).map(x => (x >= 32 && x < 127) ? String.fromCharCode(x) : "?").join("");
}

export function asciiToHex(s: string): string {
  return Array.from(s).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// gjames datum: Constr 0 [bytes(alias), Map [(bytes_policy, bytes_hash)]]
// =============================================================================

export interface GlobalStateDatum {
  aliasHex: string;
  aliasAscii: string;
  credentialMap: Map<string, string>; // policyIdHex -> completionHashHex
}

export function interpretGlobalStateDatum(d: PlutusData): GlobalStateDatum {
  if (d.kind !== "constr" || d.tag !== 0) {
    throw new Error(`gjames datum: expected Constr 0, got ${d.kind === "constr" ? `Constr ${d.tag}` : d.kind}`);
  }
  if (d.args.length < 2) {
    throw new Error(`gjames datum: Constr 0 expected >=2 args, got ${d.args.length}`);
  }
  const [aliasArg, mapArg] = d.args;
  if (aliasArg.kind !== "bytes") {
    throw new Error(`gjames datum: arg[0] expected bytes (alias), got ${aliasArg.kind}`);
  }
  if (mapArg.kind !== "map") {
    throw new Error(`gjames datum: arg[1] expected map, got ${mapArg.kind}`);
  }
  const credentialMap = new Map<string, string>();
  for (const [k, v] of mapArg.entries) {
    if (k.kind !== "bytes" || v.kind !== "bytes") {
      throw new Error(`gjames datum: map entry has non-bytes key/value (${k.kind}/${v.kind})`);
    }
    credentialMap.set(bytesToHex(k.value), bytesToHex(v.value));
  }
  return {
    aliasHex: bytesToHex(aliasArg.value),
    aliasAscii: bytesToAscii(aliasArg.value),
    credentialMap,
  };
}

// =============================================================================
// Blockfrost — shared client
// =============================================================================

export const BLOCKFROST_BASE: Record<string, string> = {
  mainnet: "https://cardano-mainnet.blockfrost.io/api/v0",
  preprod: "https://cardano-preprod.blockfrost.io/api/v0",
};

export interface BlockfrostOutput {
  address: string;
  amount: Array<{ unit: string; quantity: string }>;
  output_index: number;
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
}

export class Blockfrost {
  constructor(private base: string, private projectId: string) {}

  static fromEnv(network: string): Blockfrost {
    const base = BLOCKFROST_BASE[network];
    if (!base) throw new Error(`unsupported network: ${network}`);
    const envKey = network === "mainnet"
      ? "BLOCKFROST_MAINNET_PROJECT_ID"
      : "BLOCKFROST_PREPROD_PROJECT_ID";
    const projectId = process.env[envKey];
    if (!projectId) {
      throw new Error(`missing env ${envKey} — set it in .env.local`);
    }
    return new Blockfrost(base, projectId);
  }

  async get(p: string): Promise<any> {
    const r = await fetch(`${this.base}${p}`, { headers: { project_id: this.projectId } });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`blockfrost GET ${p} -> ${r.status} ${r.statusText}: ${body.slice(0, 200)}`);
    }
    return r.json();
  }

  async getTxOutput(txHash: string, outputIndex: number): Promise<BlockfrostOutput> {
    const utxos = await this.get(`/txs/${txHash}/utxos`);
    const out = utxos.outputs?.find((o: any) => o.output_index === outputIndex);
    if (!out) {
      throw new Error(`output ${outputIndex} not found in tx ${txHash} — the UTXO may have been spent`);
    }
    return out;
  }

  async getDatumCbor(datumHash: string): Promise<string> {
    const r = await this.get(`/scripts/datum/${datumHash}/cbor`);
    return r.cbor;
  }

  // Find the current UTXO holding a specific asset (CIP-14 asset = policyId + assetName).
  async findAssetUtxo(unit: string): Promise<{ txHash: string; outputIndex: number; address: string }> {
    const addresses = await this.get(`/assets/${unit}/addresses`);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new Error(`asset ${unit} has no holders on-chain`);
    }
    const address = addresses[0].address;
    const utxos = await this.get(`/addresses/${address}/utxos/${unit}`);
    if (!Array.isArray(utxos) || utxos.length === 0) {
      throw new Error(`address ${address} has no UTXOs containing ${unit}`);
    }
    return { txHash: utxos[0].tx_hash, outputIndex: utxos[0].output_index, address };
  }
}
