/**
 * Build a Path B credential programmatically from on-chain inputs.
 *
 * Reads per-policy metadata from `samples/policy-metadata.json`, fetches the
 * recipient's on-chain state via Blockfrost, and writes a complete OB 3.0
 * credential JSON-LD.
 *
 * Usage:
 *   node dist/build.js <alias> <primaryPolicy> [prereqPolicy ...] \
 *     [--network=mainnet|preprod] \
 *     [--out=path/to/output.jsonld]
 *
 * Example (reproduce the njuguna sample):
 *   node dist/build.js njuguna \
 *     b3e1a8e2d8f6cd07580875b6beee0241d693387e75a63cceaf70faf7 \
 *     203e63f457e0b8088073ec20959c4e0cc188cf90425d4f29ff3f817f \
 *     --out=samples/cardano-xp-project-njuguna-generated.jsonld
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { buildPathBCredential, PolicyMetadataMap } from "./path-b.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const METADATA_PATH = path.resolve(process.cwd(), "samples", "policy-metadata.json");

interface ParsedArgs {
  alias: string;
  primaryPolicy: string;
  prereqs: string[];
  network: "mainnet" | "preprod";
  outPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  let network: "mainnet" | "preprod" = "mainnet";
  let outPath: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--network=")) {
      const n = a.slice("--network=".length);
      if (n !== "mainnet" && n !== "preprod") throw new Error(`unknown network: ${n}`);
      network = n;
    } else if (a.startsWith("--out=")) {
      outPath = a.slice("--out=".length);
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }
  if (positional.length < 2) {
    console.error("usage: build <alias> <primaryPolicy> [prereqPolicy...] [--network=...] [--out=...]");
    process.exit(1);
  }
  const [alias, primaryPolicy, ...prereqs] = positional;
  if (!outPath) {
    outPath = path.join("samples", `${primaryPolicy.slice(0, 8)}-${alias}-generated.jsonld`);
  }
  return { alias, primaryPolicy, prereqs, network, outPath };
}

async function loadMetadata(): Promise<PolicyMetadataMap> {
  const raw = JSON.parse(await fs.readFile(METADATA_PATH, "utf8"));
  // Strip leading-underscore comment fields
  const cleaned: PolicyMetadataMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith("_")) cleaned[k] = v as any;
  }
  return cleaned;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Building Path B credential`);
  console.log(`  alias:         ${args.alias}`);
  console.log(`  primary:       ${args.primaryPolicy}`);
  console.log(`  prereqs:       ${args.prereqs.length ? args.prereqs.join(", ") : "(none)"}`);
  console.log(`  network:       ${args.network}`);
  console.log(`  output:        ${args.outPath}\n`);

  const metadata = await loadMetadata();

  const { credential, diagnostics } = await buildPathBCredential({
    network: args.network,
    alias: args.alias,
    primaryPolicyId: args.primaryPolicy,
    prereqPolicyIds: args.prereqs,
    metadata,
  });

  console.log(`On-chain check:`);
  console.log(`  datum alias:   ${diagnostics.aliasOnChain}`);
  console.log(`  map entries:   ${diagnostics.mapEntryCount}`);
  console.log(`  primary found: ${diagnostics.primaryFoundOnChain}`);
  for (let i = 0; i < args.prereqs.length; i++) {
    console.log(`  prereq[${i}] found: ${diagnostics.prereqsFoundOnChain[i]}`);
  }
  console.log(`  gjames UTXO:   ${diagnostics.globalStateUtxo}\n`);

  const outFull = path.resolve(process.cwd(), args.outPath);
  await fs.mkdir(path.dirname(outFull), { recursive: true });
  await fs.writeFile(outFull, JSON.stringify(credential, null, 2) + "\n", "utf8");
  console.log(`Wrote ${args.outPath}`);
}

main().catch(err => {
  console.error("build failed:", err.message ?? err);
  process.exit(1);
});
