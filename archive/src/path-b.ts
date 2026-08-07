/**
 * Programmatic Path B credential builder.
 *
 * Given an alias, a primary policy ID, and per-policy metadata, fetch everything
 * else from chain (the gjames UTXO, the credential map, asset fingerprints,
 * creation timestamps) and assemble the Open Badges 3.0 / W3C VC 2.0 JSON-LD
 * document in the Path B real-recipient shape used by the hand-written samples.
 *
 * Companion to `mapper.ts` — which handles the original Phase-1 (non-Path-B)
 * mapping. This module is the on-chain-driven alternative.
 */
import {
  Blockfrost,
  asciiToHex,
  decodePlutusData,
  interpretGlobalStateDatum,
} from "./plutus.js";

// Andamio v2 Scaffolding Era Access Token mint policy on Cardano mainnet.
export const DEFAULT_AT_POLICY = "ff5d0640b5a2717646d3f3151d100d57d194fdfa88cacf03f9edc568";
export const ANDAMIO_ACCESS_TOKEN_NAME = "Andamio Access Token V2";
export const ANDAMIO_ACCESS_TOKEN_IMAGE = "ipfs://bafybeiepxsxabwy723nr4uzokblmhzumwxstn7y7of4axdzj";
export const ANDAMIO_ACCESS_TOKEN_ERA = "Scaffolding Era";
export const ANDAMIO_APP_URL = "https://api.andamio.io";
export const LOCAL_STATE_NFT_NAME_HEX = "4c6f63616c53746174654e4654"; // "LocalStateNFT"

export interface PolicyMetadata {
  type: "course" | "project";
  title: string;
  description: string;
  issuerName: string;
}

export type PolicyMetadataMap = Record<string, PolicyMetadata>;

export interface BuildOptions {
  network: "mainnet" | "preprod";
  alias: string;
  primaryPolicyId: string;
  prereqPolicyIds?: string[];
  metadata: PolicyMetadataMap;
  accessTokenPolicy?: string;
  issuerDid?: string;
  issuerProfileUrl?: string;
}

export interface BuildResult {
  credential: any;
  diagnostics: {
    aliasOnChain: string;
    mapEntryCount: number;
    primaryFoundOnChain: boolean;
    prereqsFoundOnChain: boolean[];
    globalStateUtxo: string;
  };
}

function explorerBase(network: string): string {
  return network === "mainnet" ? "https://cexplorer.io" : "https://preprod.cexplorer.io";
}

export async function buildPathBCredential(opts: BuildOptions): Promise<BuildResult> {
  const network = opts.network;
  const alias = opts.alias;
  const atPolicy = opts.accessTokenPolicy ?? DEFAULT_AT_POLICY;
  const explorer = explorerBase(network);
  const md = opts.metadata;

  // Required metadata lookup
  const primaryMeta = md[opts.primaryPolicyId];
  if (!primaryMeta) {
    throw new Error(`no metadata for primary policy ${opts.primaryPolicyId} — add an entry to policy-metadata.json`);
  }
  const prereqIds = opts.prereqPolicyIds ?? [];
  for (const p of prereqIds) {
    if (!md[p]) throw new Error(`no metadata for prereq policy ${p} — add an entry to policy-metadata.json`);
  }

  const uHex = asciiToHex(`u${alias}`);
  const gHex = asciiToHex(`g${alias}`);
  const gUnit = `${atPolicy}${gHex}`;
  const uUnit = `${atPolicy}${uHex}`;

  const bf = Blockfrost.fromEnv(network);

  // 1. Find the gjames UTXO + decode the datum
  const gLoc = await bf.findAssetUtxo(gUnit);
  const gOutput = await bf.getTxOutput(gLoc.txHash, gLoc.outputIndex);
  const datumCbor = gOutput.inline_datum
    ?? (gOutput.data_hash ? await bf.getDatumCbor(gOutput.data_hash) : null);
  if (!datumCbor) throw new Error(`gjames UTXO ${gLoc.txHash}#${gLoc.outputIndex} has no datum`);
  const datum = interpretGlobalStateDatum(decodePlutusData(datumCbor));

  // 2. Read the on-chain claims for primary + prereqs
  const primaryHash = datum.credentialMap.get(opts.primaryPolicyId);
  if (!primaryHash) {
    throw new Error(`primary policy ${opts.primaryPolicyId} not present in ${alias}'s on-chain credential map`);
  }
  const prereqsOnChain: boolean[] = [];
  const prereqs: Array<{ policyId: string; completionHash: string; meta: PolicyMetadata }> = [];
  for (const p of prereqIds) {
    const h = datum.credentialMap.get(p);
    prereqsOnChain.push(!!h);
    if (h) prereqs.push({ policyId: p, completionHash: h, meta: md[p] });
  }

  // 3. Fetch asset info (fingerprints, creation tx, creation time)
  const [gAssetInfo, uAssetInfo, primaryAssetInfo] = await Promise.all([
    bf.get(`/assets/${gUnit}`).catch(() => null),
    bf.get(`/assets/${uUnit}`).catch(() => null),
    bf.get(`/assets/${opts.primaryPolicyId}${LOCAL_STATE_NFT_NAME_HEX}`).catch(() => null),
  ]);

  // Creation time (block_time) for the primary policy anchor
  let creationTime: string | undefined;
  if (primaryAssetInfo?.initial_mint_tx_hash) {
    const tx = await bf.get(`/txs/${primaryAssetInfo.initial_mint_tx_hash}`).catch(() => null);
    if (tx?.block_time) creationTime = new Date(tx.block_time * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  // Recipient's wallet address — current u<alias> holder
  let userTokenHolder = "";
  try {
    const u = await bf.findAssetUtxo(uUnit);
    userTokenHolder = u.address;
  } catch { /* fall through with empty */ }

  const issuerDid = opts.issuerDid ?? "did:key:z6MkpBE45BjpE8KiWo6nfn8HELrQ73yLCNmKRkMh2DL9WAqM";
  const issuerProfileUrl = opts.issuerProfileUrl ?? "https://credentials.andamio.io/issuer";

  const primaryUrn = `urn:andamio:${primaryMeta.type}:${opts.primaryPolicyId}:${primaryHash}`;

  const credential: any = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
      "https://credentials.andamio.io/context/v0.jsonld",
    ],
    id: `urn:andamio:credential:${opts.primaryPolicyId}:${alias}`,
    type: ["VerifiableCredential", "OpenBadgeCredential"],
    issuer: {
      id: issuerDid,
      type: ["Profile"],
      name: `${primaryMeta.issuerName} (on Cardano ${network})`,
      url: issuerProfileUrl,
      description: "Andamio is an on-chain credential protocol on Cardano. The issuer DID in this sample is a throwaway did:key from the OB 3.0 spike — production credentials will use did:web:credentials.andamio.io or a per-org issuer DID.",
    },
    validFrom: creationTime ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    name: primaryMeta.type === "project" ? `Joined: ${primaryMeta.title}` : `Completed: ${primaryMeta.title}`,
    description: `Real-recipient cross-issuer prerequisite chain on Andamio ${network}. Recipient is ${alias} (alias '${alias}'), identified by their Andamio Access Token V2 (${ANDAMIO_ACCESS_TOKEN_ERA}). Their on-chain global state UTXO (held at the Andamio g${alias} script address) records the ${primaryMeta.title} ${primaryMeta.type === "project" ? "project participation" : "course completion"}${prereqs.length > 0 ? ` AND the prerequisite credential${prereqs.length > 1 ? "s" : ""}` : ""} — confirming the chain. ${primaryMeta.type === "project" ? "The project's Plutus mint policy enforced the prerequisite at participation-token mint time." : ""}`.trim(),
    credentialSubject: {
      id: `urn:andamio:recipient:${alias}`,
      type: ["AchievementSubject"],
      "accessToken": {
        policyId: atPolicy,
        userTokenAssetName: uHex,
        userTokenAssetNameAscii: `u${alias}`,
        globalStateAssetName: gHex,
        globalStateAssetNameAscii: `g${alias}`,
        alias,
        era: ANDAMIO_ACCESS_TOKEN_ERA,
        name: ANDAMIO_ACCESS_TOKEN_NAME,
        image: ANDAMIO_ACCESS_TOKEN_IMAGE,
        appUrl: ANDAMIO_APP_URL,
        userTokenHolder,
        globalStateScriptAddress: gLoc.address,
        globalStateUtxo: `${gLoc.txHash}#${gLoc.outputIndex}`,
      },
      achievement: {
        id: primaryUrn,
        type: ["Achievement"],
        name: primaryMeta.title,
        description: primaryMeta.description,
        criteria: {
          narrative: buildCriteriaNarrative({ alias, primaryMeta, primaryPolicyId: opts.primaryPolicyId, primaryHash, prereqs }),
        },
        "onChainAnchor": {
          network,
          type: `${primaryMeta.type}-state`,
          policyId: opts.primaryPolicyId,
          assetName: LOCAL_STATE_NFT_NAME_HEX,
          assetNameAscii: "LocalStateNFT",
          assetFingerprint: primaryAssetInfo?.fingerprint ?? null,
          creationTxHash: primaryAssetInfo?.initial_mint_tx_hash ?? null,
          creationTime: creationTime ?? null,
          explorerUrl: `${explorer}/policy/${opts.primaryPolicyId}`,
        },
        "onChainAttestation": {
          type: "global-state-entry",
          policyId: opts.primaryPolicyId,
          [primaryMeta.type === "course" ? "sltHash" : "stateHash"]: primaryHash,
          globalStateUtxo: `${gLoc.txHash}#${gLoc.outputIndex}`,
          globalStateDatumHash: gOutput.data_hash,
          verification: `Read the g${alias} UTXO datum at ${gLoc.address}; the Constr datum's map field will contain the entry { ${primaryMeta.type}_id: ${primaryMeta.type === "course" ? "slt_hash" : "state_hash"} } shown above.`,
        },
        ...(prereqs.length > 0 ? {
          "requires": prereqs.map(pr => ({
            achievementId: `urn:andamio:${pr.meta.type}:${pr.policyId}:${pr.completionHash}`,
            enforcement: "mint-policy",
            policyReference: `${explorer}/policy/${opts.primaryPolicyId}`,
            rationale: `The ${primaryMeta.title} ${primaryMeta.type} mint policy refuses to issue a ${primaryMeta.type === "project" ? "participation" : "completion"} token unless the recipient's Access Token global state map contains an attestation for ${pr.meta.title}. Enforcement happens at TX validation time, on-chain — a third party with chain access can independently verify the prerequisite was honored without trusting either issuer's database. The proof for this recipient: g${alias} UTXO ${gLoc.txHash.slice(0, 8)}...#${gLoc.outputIndex} datum's map contains { ${pr.policyId} → ${pr.completionHash} }.`,
            "prereqAttestation": {
              policyId: pr.policyId,
              [pr.meta.type === "course" ? "sltHash" : "stateHash"]: pr.completionHash,
            },
          })),
        } : {}),
      },
    },
    evidence: [
      {
        id: `${explorer}/policy/${opts.primaryPolicyId}`,
        type: ["Evidence"],
        name: `${primaryMeta.title} ${primaryMeta.type} policy on Cardano ${network}`,
        description: `Public block explorer record of the ${primaryMeta.type} state policy.${primaryMeta.type === "project" ? " The Plutus minting policy referenced by this policy ID enforces prerequisites at participation-token mint time." : ""}`,
      },
      ...prereqs.map(pr => ({
        id: `${explorer}/policy/${pr.policyId}`,
        type: ["Evidence"],
        name: `${pr.meta.title} ${pr.meta.type} policy on Cardano ${network}`,
        description: `Public block explorer record of the prerequisite ${pr.meta.type} state policy.`,
      })),
      ...(gAssetInfo?.fingerprint ? [{
        id: `${explorer}/asset/${gAssetInfo.fingerprint}`,
        type: ["Evidence"],
        name: `g${alias} global state token`,
        description: `Recipient's Access Token global state reference NFT. Held at the Andamio Access Token script address; its UTXO datum carries the credential map listing both the prerequisite and primary attestations for this recipient.`,
      }] : []),
      ...(uAssetInfo?.fingerprint ? [{
        id: `${explorer}/asset/${uAssetInfo.fingerprint}`,
        type: ["Evidence"],
        name: `u${alias} user token`,
        description: `Recipient's Access Token user-held NFT. Identifies the recipient by alias '${alias}' and pairs with g${alias} as the global state reference.`,
      }] : []),
    ],
  };

  return {
    credential,
    diagnostics: {
      aliasOnChain: datum.aliasAscii,
      mapEntryCount: datum.credentialMap.size,
      primaryFoundOnChain: true,
      prereqsFoundOnChain: prereqsOnChain,
      globalStateUtxo: `${gLoc.txHash}#${gLoc.outputIndex}`,
    },
  };
}

function buildCriteriaNarrative(args: {
  alias: string;
  primaryMeta: PolicyMetadata;
  primaryPolicyId: string;
  primaryHash: string;
  prereqs: Array<{ policyId: string; completionHash: string; meta: PolicyMetadata }>;
}): string {
  const { alias, primaryMeta, primaryPolicyId, primaryHash, prereqs } = args;
  const parts: string[] = [];

  if (prereqs.length > 0) {
    const prereqParts = prereqs.map((pr, i) =>
      `(${String.fromCharCode(97 + i)}) holds an on-chain attestation for ${pr.meta.title === primaryMeta.title ? "the prerequisite" : pr.meta.title} (policy ${pr.policyId})${" — recorded in the g" + alias + " global state datum with completionHash " + pr.completionHash}`
    );
    const primaryLetter = String.fromCharCode(97 + prereqs.length);
    parts.push(
      `Recipient ${prereqParts.join(", ")}, and (${primaryLetter}) is recorded as ${primaryMeta.type === "project" ? "a participant in" : "having completed"} the ${primaryMeta.title} ${primaryMeta.type} (policy ${primaryPolicyId}) with completionHash ${primaryHash}.`,
      "Both attestations are entries in the recipient's Access Token global state map.",
      primaryMeta.type === "project"
        ? "The project's Plutus validator enforced the prerequisite course attestation at participation-token mint time."
        : "The course's completion is content-addressed by the recipient's module slt_hashes."
    );
  } else {
    parts.push(
      `Recipient ${primaryMeta.type === "project" ? "is recorded as a participant in" : "has completed"} the ${primaryMeta.title} ${primaryMeta.type} (policy ${primaryPolicyId}) with completionHash ${primaryHash}, recorded in the g${alias} global state datum.`
    );
  }
  return parts.join(" ");
}
