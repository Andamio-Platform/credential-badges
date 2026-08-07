/**
 * Inspect a recipient's gjames global state by alias.
 *
 * Locates the recipient's `g<alias>` Access Token NFT on Cardano, fetches its
 * current UTXO, decodes the inline datum, and prints the full credential map.
 * Use it to discover what's on-chain for a wallet before drafting a Path B
 * credential.
 *
 * Usage:
 *   node dist/inspect.js <alias> [--network=mainnet|preprod] [--at-policy=<hex>]
 *
 * Defaults: network=mainnet, at-policy=the v2 Scaffolding Era AT policy
 * (ff5d0640b5a2717646d3f3151d100d57d194fdfa88cacf03f9edc568).
 */
import path from "node:path";
import dotenv from "dotenv";
import {
  Blockfrost,
  asciiToHex,
  decodePlutusData,
  interpretGlobalStateDatum,
} from "./plutus.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Andamio v2 Scaffolding Era Access Token mint policy on Cardano mainnet.
const DEFAULT_AT_POLICY = "ff5d0640b5a2717646d3f3151d100d57d194fdfa88cacf03f9edc568";

function parseArgs(argv: string[]): { alias: string; network: string; atPolicy: string } {
  let alias: string | undefined;
  let network = "mainnet";
  let atPolicy = DEFAULT_AT_POLICY;
  for (const a of argv) {
    if (a.startsWith("--network=")) network = a.slice("--network=".length);
    else if (a.startsWith("--at-policy=")) atPolicy = a.slice("--at-policy=".length);
    else if (!a.startsWith("--")) alias = a;
  }
  if (!alias) {
    console.error("usage: inspect <alias> [--network=mainnet|preprod] [--at-policy=<hex>]");
    process.exit(1);
  }
  return { alias, network, atPolicy };
}

async function main() {
  const { alias, network, atPolicy } = parseArgs(process.argv.slice(2));
  const gAssetName = asciiToHex(`g${alias}`);
  const uAssetName = asciiToHex(`u${alias}`);
  const gUnit = `${atPolicy}${gAssetName}`;

  console.log(`Inspecting alias '${alias}' on ${network}`);
  console.log(`  AT policy:       ${atPolicy}`);
  console.log(`  User token:      u${alias} (${uAssetName})`);
  console.log(`  Global state:    g${alias} (${gAssetName})`);
  console.log(`  Asset unit:      ${gUnit}\n`);

  const bf = Blockfrost.fromEnv(network);

  // 1. Find the current UTXO holding the gjames token
  const { txHash, outputIndex, address } = await bf.findAssetUtxo(gUnit);
  console.log(`Found g${alias} at:`);
  console.log(`  Address:         ${address}`);
  console.log(`  UTXO:            ${txHash}#${outputIndex}\n`);

  // 2. Fetch the output, find the inline datum
  const output = await bf.getTxOutput(txHash, outputIndex);
  let datumCbor: string;
  if (output.inline_datum) {
    datumCbor = output.inline_datum;
    console.log(`Datum source:      inline_datum (${datumCbor.length / 2} bytes CBOR)`);
  } else if (output.data_hash) {
    datumCbor = await bf.getDatumCbor(output.data_hash);
    console.log(`Datum source:      fetched by hash ${output.data_hash}`);
  } else {
    console.error("no inline_datum and no data_hash on output");
    process.exit(1);
  }

  // 3. Decode + interpret as a gjames Constr 0 [bytes, map] datum
  const pd = decodePlutusData(datumCbor);
  const datum = interpretGlobalStateDatum(pd);
  console.log(`Datum:             Constr 0 [alias=${datum.aliasAscii}, map of ${datum.credentialMap.size} entries]\n`);

  // 4. Find the user token holder address (the recipient's wallet) for credential metadata
  let userTokenHolder = "(not found)";
  try {
    const u = await bf.findAssetUtxo(`${atPolicy}${uAssetName}`);
    userTokenHolder = u.address;
  } catch { /* ignore — may have moved */ }

  // 5. Also fetch asset fingerprints (CIP-14) for the JSON-LD credential
  const gAssetInfo = await bf.get(`/assets/${gUnit}`);
  const uAssetInfo = await bf.get(`/assets/${atPolicy}${uAssetName}`).catch(() => null);

  console.log("=== Credential map (policyId → completionHash) ===\n");
  for (const [policyId, hash] of datum.credentialMap) {
    console.log(`  ${policyId}`);
    console.log(`      → ${hash}\n`);
  }

  console.log("=== Suggested credential frontmatter ===\n");
  console.log(JSON.stringify({
    alias,
    network,
    accessTokenPolicy: atPolicy,
    userTokenAssetName: uAssetName,
    globalStateAssetName: gAssetName,
    userTokenHolder,
    globalStateScriptAddress: address,
    globalStateUtxo: `${txHash}#${outputIndex}`,
    globalStateDatumHash: output.data_hash,
    globalStateAssetFingerprint: gAssetInfo?.fingerprint ?? null,
    userTokenAssetFingerprint: uAssetInfo?.fingerprint ?? null,
    credentialMap: Object.fromEntries(datum.credentialMap),
  }, null, 2));
}

main().catch(err => {
  console.error("inspect failed:", err.message ?? err);
  process.exit(1);
});
