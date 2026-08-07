/**
 * Path B verifier harness — datum-membership check.
 *
 * Takes an Andamio OB 3.0 credential (Path B real-recipient shape), fetches the
 * recipient's gjames UTXO from chain via Blockfrost, decodes its Plutus Data
 * datum, and confirms each claimed (policyId, completionHash) pair is present
 * in the global-state map.
 *
 * This does NOT recompute completionHash from raw SLT lists — that round-trip
 * is a follow-up (see mapping.md). Datum-membership is sufficient to prove the
 * recipient's on-chain record bears the exact pairs the credential claims.
 *
 * Usage:
 *   node dist/verify.js [path/to/credential.jsonld]
 *
 * Defaults to the sustain-and-maintain James sample if no path is given.
 *
 * Env:
 *   BLOCKFROST_MAINNET_PROJECT_ID  required for mainnet credentials
 *   BLOCKFROST_PREPROD_PROJECT_ID  required for preprod credentials
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  Blockfrost,
  BlockfrostOutput,
  decodePlutusData,
  interpretGlobalStateDatum,
  GlobalStateDatum,
} from "./plutus.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const DEFAULT_SAMPLE = path.resolve(
  process.cwd(),
  "samples",
  "sustain-and-maintain-gimbalabs-james-real.jsonld"
);

interface ClaimedPair {
  source: "primary" | `prereq[${number}]`;
  policyId: string;
  completionHash: string;
  hashName: "slt_hash" | "state_hash" | "completionHash";
}

interface ExtractedClaims {
  network: string;
  alias: string;
  aliasHex: string;
  accessTokenPolicyId: string;
  globalStateAssetName: string;
  globalStateScriptAddress: string;
  globalStateUtxoRef: { txHash: string; outputIndex: number };
  pairs: ClaimedPair[];
}

// Canonical shape uses bare terms resolved via the published andamio context
// (credentials.andamio.io/context/v0.jsonld). Older artifacts used the
// `andamio:`-prefixed CURIE form; accept it as a fallback.
const term = (o: any, name: string) => o?.[name] ?? o?.[`andamio:${name}`];

function extractClaims(doc: any): ExtractedClaims {
  const at = term(doc?.credentialSubject, "accessToken");
  const ach = doc?.credentialSubject?.achievement;
  const anchor = term(ach, "onChainAnchor");
  const att = term(ach, "onChainAttestation");
  const requires = term(ach, "requires") ?? [];

  if (!at) throw new Error("missing credentialSubject.accessToken");
  if (!att) throw new Error("missing credentialSubject.achievement.onChainAttestation");
  if (!anchor?.network) throw new Error("missing credentialSubject.achievement.onChainAnchor.network");

  const [txHash, idxStr] = String(at.globalStateUtxo).split("#");
  if (!txHash || idxStr === undefined) {
    throw new Error(`malformed globalStateUtxo: ${at.globalStateUtxo}`);
  }

  // The third URN segment is named per credential type in Andamio's vocabulary:
  // - course credentials: `sltHash` (urn:andamio:course:<course_id>:<slt_hash>)
  // - project credentials: `stateHash` (urn:andamio:project:<project_id>:<state_hash>)
  // - `completionHash` is accepted as a legacy alias for either.
  const pickHashAndName = (o: any): { hash?: string; name: ClaimedPair["hashName"] } => {
    if (o?.sltHash) return { hash: o.sltHash, name: "slt_hash" };
    if (o?.stateHash) return { hash: o.stateHash, name: "state_hash" };
    if (o?.completionHash) return { hash: o.completionHash, name: "completionHash" };
    return { name: "completionHash" };
  };

  const primaryPicked = pickHashAndName(att);
  const pairs: ClaimedPair[] = [
    { source: "primary", policyId: att.policyId, completionHash: primaryPicked.hash ?? "", hashName: primaryPicked.name },
  ];
  requires.forEach((r: any, i: number) => {
    const pa = term(r, "prereqAttestation");
    const picked = pickHashAndName(pa);
    if (pa?.policyId && picked.hash) {
      pairs.push({
        source: `prereq[${i}]`,
        policyId: pa.policyId,
        completionHash: picked.hash,
        hashName: picked.name,
      });
    }
  });

  return {
    network: anchor.network,
    alias: at.alias,
    aliasHex: at.globalStateAssetName.startsWith("67")
      ? at.globalStateAssetName.slice(2)
      : at.globalStateAssetName,
    accessTokenPolicyId: at.policyId,
    globalStateAssetName: at.globalStateAssetName,
    globalStateScriptAddress: at.globalStateScriptAddress,
    globalStateUtxoRef: { txHash, outputIndex: Number(idxStr) },
    pairs,
  };
}

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "INFO";
  detail: string;
}

async function verify(credentialPath: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const doc = JSON.parse(await fs.readFile(credentialPath, "utf8"));
  const claims = extractClaims(doc);

  results.push({
    name: "credential parse",
    status: "PASS",
    detail: `network=${claims.network} alias=${claims.alias} claimed pairs: ${claims.pairs.length} (1 primary + ${claims.pairs.length - 1} prereq)`,
  });

  const bf = Blockfrost.fromEnv(claims.network);

  let output: BlockfrostOutput;
  try {
    output = await bf.getTxOutput(claims.globalStateUtxoRef.txHash, claims.globalStateUtxoRef.outputIndex);
    results.push({
      name: "gjames UTXO reachable",
      status: "PASS",
      detail: `tx ${claims.globalStateUtxoRef.txHash}#${claims.globalStateUtxoRef.outputIndex} at ${output.address.slice(0, 20)}…`,
    });
  } catch (e: any) {
    results.push({ name: "gjames UTXO reachable", status: "FAIL", detail: e.message });
    return results;
  }

  const expectedUnit = `${claims.accessTokenPolicyId}${claims.globalStateAssetName}`;
  const hasGjamesToken = output.amount.some(a => a.unit === expectedUnit && a.quantity === "1");
  results.push({
    name: "gjames token present in UTXO",
    status: hasGjamesToken ? "PASS" : "FAIL",
    detail: hasGjamesToken
      ? `unit=${claims.accessTokenPolicyId}.${claims.globalStateAssetName} qty=1`
      : `expected ${expectedUnit} qty=1; actual: ${output.amount.map(a => `${a.unit.slice(0, 20)}…=${a.quantity}`).join(", ").slice(0, 200)}`,
  });

  let datumCbor: string;
  if (output.inline_datum) {
    datumCbor = output.inline_datum;
    results.push({ name: "datum source", status: "INFO", detail: `inline_datum (${datumCbor.length / 2} bytes)` });
  } else if (output.data_hash) {
    try {
      datumCbor = await bf.getDatumCbor(output.data_hash);
      results.push({ name: "datum source", status: "INFO", detail: `fetched by hash ${output.data_hash}` });
    } catch (e: any) {
      results.push({ name: "datum source", status: "FAIL", detail: e.message });
      return results;
    }
  } else {
    results.push({ name: "datum source", status: "FAIL", detail: "no inline_datum and no data_hash on output" });
    return results;
  }

  let datum: GlobalStateDatum;
  try {
    const pd = decodePlutusData(datumCbor);
    datum = interpretGlobalStateDatum(pd);
    results.push({
      name: "datum decode + shape",
      status: "PASS",
      detail: `Constr 0 [alias=${datum.aliasAscii} (${datum.aliasHex}), map of ${datum.credentialMap.size} entries]`,
    });
  } catch (e: any) {
    results.push({ name: "datum decode + shape", status: "FAIL", detail: e.message });
    return results;
  }

  const aliasMatches = datum.aliasHex === claims.aliasHex;
  results.push({
    name: "alias bytes match credential",
    status: aliasMatches ? "PASS" : "FAIL",
    detail: aliasMatches
      ? `datum alias = ${datum.aliasAscii}`
      : `credential claims alias '${claims.alias}' (${claims.aliasHex}); datum has '${datum.aliasAscii}' (${datum.aliasHex})`,
  });

  for (const pair of claims.pairs) {
    const onChain = datum.credentialMap.get(pair.policyId);
    if (!onChain) {
      results.push({
        name: `claim ${pair.source}: policyId in map`,
        status: "FAIL",
        detail: `policy ${pair.policyId} not present in datum map`,
      });
      continue;
    }
    const matches = onChain === pair.completionHash;
    results.push({
      name: `claim ${pair.source}: ${pair.hashName} match`,
      status: matches ? "PASS" : "FAIL",
      detail: matches
        ? `${pair.policyId} → ${pair.completionHash}`
        : `policy ${pair.policyId}: credential claims ${pair.completionHash}, datum has ${onChain}`,
    });
  }

  const claimedPolicies = new Set(claims.pairs.map(p => p.policyId));
  const extras = [...datum.credentialMap.entries()].filter(([k]) => !claimedPolicies.has(k));
  if (extras.length > 0) {
    results.push({
      name: "additional on-chain entries (informational)",
      status: "INFO",
      detail: `${extras.length} other policy → hash entries in this recipient's gjames map: ${extras.map(([p, h]) => `${p.slice(0, 16)}…→${h.slice(0, 16)}…`).join(", ")}`,
    });
  }

  return results;
}

function fmtTable(rows: CheckResult[]): string {
  return "| Check | Status | Detail |\n|---|---|---|\n" +
    rows.map(r => `| ${r.name} | ${r.status} | ${r.detail.replace(/\|/g, "\\|").slice(0, 300)} |`).join("\n");
}

async function main() {
  const credentialPath = process.argv[2] ?? DEFAULT_SAMPLE;
  console.log(`Verifying: ${path.relative(process.cwd(), credentialPath)}\n`);

  const results = await verify(credentialPath);

  for (const r of results) {
    console.log(`  [${r.status}] ${r.name}: ${r.detail}`);
  }

  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const info = results.filter(r => r.status === "INFO").length;
  console.log(`\n${passed} passed, ${failed} failed, ${info} info (${results.length} total)`);

  const outDir = path.resolve(process.cwd(), "out");
  await fs.mkdir(outDir, { recursive: true });
  const md = `## Verify run — ${new Date().toISOString()}\n\nCredential: \`${path.relative(process.cwd(), credentialPath)}\`\n\n${fmtTable(results)}\n\n**Summary**: ${passed} passed, ${failed} failed, ${info} info.\n`;
  await fs.writeFile(path.join(outDir, "verify-results.md"), md, "utf8");
  const perSampleName = `verify-results-${path.basename(credentialPath).replace(/\.jsonld$/, "")}.md`;
  await fs.writeFile(path.join(outDir, perSampleName), md, "utf8");
  console.log(`\nWrote out/verify-results.md and out/${perSampleName}`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("verify failed:", err);
  process.exit(1);
});
