/**
 * Reference Andamio credential data — drawn from a real preprod course.
 *
 * Course: "Give Feedback on This App" (Cardano XP feedback course)
 *   - course_id (== Cardano native asset policy_id): 76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742
 *   - student_state policy: 4a3cefbfe4c56c6725289a6080d8a62942db58cfe205d166650cfec2
 *   - SLT hash (single module, on-chain): 77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b
 *
 * The "completion credential" in Andamio's protocol is a Cardano native token minted under the
 * course_id policy when a student calls /v2/tx/course/student/credential/claim. The asset_name is
 * derived from the student's wallet (in practice the alias hex). We construct a synthetic completion
 * credential for the recipient `lynx`, who has a confirmed enrollment state token on-chain (asset
 * 4a3cefbf...6c796e78). Until a student actually claims, no completion-credential UTXO exists; the
 * mapping below faithfully follows the protocol's documented credential_claim shape so that swapping
 * in a real claimed asset later is a one-field change.
 *
 * Note: We chose this preprod course because the requested Midnight PBL course is currently only
 * minted on mainnet. See open-questions.md.
 */
export interface AndamioCredential {
  network: "preprod" | "mainnet";
  policyId: string;        // 28-byte hex; equal to course_id
  assetName: string;       // hex-encoded recipient alias (in v2 protocol, claim mints alias-named NFT)
  assetFingerprint?: string;
  course: {
    id: string;            // == policyId
    title: string;
    description: string;
    teacherAlias: string;
  };
  module: {
    sltHash: string;       // blake2b-256 hex of CBOR-encoded SLT array
    slts: string[];
  };
  recipient: {
    alias: string;
    walletAddress: string; // bech32 testnet address
    studentStatePolicy: string;
    studentStateAsset: string;
  };
  // On-chain anchor — for evidence/verification round-trip
  anchor: {
    network: "preprod";
    explorer: string;      // pre-formed cexplorer.io URL
    blockfrostAsset: string;
    claimTxHash?: string;  // optional — the credential_claim tx hash, if available
    issuedAt: string;      // ISO 8601
  };
}

export const referenceCredential: AndamioCredential = {
  network: "preprod",
  policyId: "76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742",
  // hex("lynx") = 6c796e78
  assetName: "6c796e78",
  course: {
    id: "76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742",
    title: "Give Feedback on This App",
    description:
      "Cardano XP feedback course — students complete a single module covering bug reports, feature requests, and ideas for the Cardano XP application.",
    teacherAlias: "cardano_xp",
  },
  module: {
    sltHash: "77547ab066d5fe38038879b785551f6efae17ba38a0d6dc8475cb015e848b42b",
    slts: [
      "I can find a bug in the Cardano XP app.",
      "I can request a feature for Cardano XP.",
      "I can share an idea for how to use Cardano XP.",
    ],
  },
  recipient: {
    alias: "lynx",
    walletAddress:
      "addr_test1qqkpwl5qx9plnrt36uqcuk0n4tly2j87n3qftjcz3lxvw5la0xtgq6e3qyc6e09scq2l3rpd7sdqj4r2j7m38ye78xqsuk7t6q",
    studentStatePolicy: "4a3cefbfe4c56c6725289a6080d8a62942db58cfe205d166650cfec2",
    // hex("lynx") = 6c796e78 — confirmed live UTXO on preprod (quantity 1)
    studentStateAsset:
      "4a3cefbfe4c56c6725289a6080d8a62942db58cfe205d166650cfec26c796e78",
  },
  anchor: {
    network: "preprod",
    explorer:
      "https://preprod.cexplorer.io/policy/76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e8157742",
    blockfrostAsset:
      "https://cardano-preprod.blockfrost.io/api/v0/assets/76bab08586cbd53003bfec0e63bc3165fd73afb99cbfa9f4e81577424c6f63616c53746174654e4654",
    // Set at generate-time to ensure JWT nbf is always satisfied. We deliberately don't pin a fixed
    // timestamp because preprod isn't a sealed historical chain — issuance time is the time of the
    // claim_credential transaction, which for this synthetic example is the moment we generate.
    issuedAt: new Date().toISOString(),
  },
};
