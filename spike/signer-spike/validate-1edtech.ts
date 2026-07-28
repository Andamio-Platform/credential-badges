// validate-1edtech.ts — runs the 1EdTech OB 3.0 validator against a hosted
// credential and records the verdict.
//
// This is the gate the class-artifact release turns on. The identityless shape
// (plan KTD-1) is schema-conformant on paper — AchievementSubject requires only
// `type` and `achievement` — but "conformant on paper" and "the reference
// validator says VALID" are different claims, and only the second one is worth
// signing 57 more artifacts on.
//
// Endpoint and invocation are inherited from the Phase 0 verifier spike, which
// reached VALID 13/13 on the holder credential:
//   spike/verifier-spike/results/onedtech.md
//
// The validator takes a URI and fetches it, so the credential must be publicly
// reachable. Everything else it dereferences already resolves live:
// did:web:credentials.andamio.io, the issuer Profile, the signing context, and
// the key-epoch status list. So only the credential JSON itself needs hosting —
// a raw gist or GitHub Pages is enough, exactly as the verifier spike did it.
// A production deploy is NOT required to run this check.
//
// Usage:
//   npm run validate:1edtech -- <credential-url> [--label <name>]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const RESULTS_DIR = path.join(HERE, "out", "validation");

const ENDPOINT = "https://verifybadge.org/api/validateuri";
const VALIDATOR_ID = "OB30Inspector";

interface Verdict {
  outcome: string;
  errors: number;
  warnings: number;
  fatals: number;
  exceptions: number;
  totalRun: number;
}

/** The response nests its counts; find them wherever they live rather than
 *  assuming a shape that may have moved since the Phase 0 spike. */
function extractVerdict(body: any): Verdict {
  const found: Record<string, any> = {};
  (function walk(n: any, depth = 0) {
    if (depth > 6 || !n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === "string" || typeof v === "number") {
        if (found[k] === undefined) found[k] = v;
      }
      walk(v, depth + 1);
    }
  })(body);

  const num = (k: string) => (typeof found[k] === "number" ? found[k] : Number(found[k] ?? 0));
  return {
    outcome: String(found.outcome ?? found.result ?? "UNKNOWN"),
    errors: num("errors"),
    warnings: num("warnings"),
    fatals: num("fatals"),
    exceptions: num("exceptions"),
    totalRun: num("totalRun"),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => a.startsWith("http"));
  const labelIdx = argv.indexOf("--label");
  const label = labelIdx === -1 ? "class-artifact" : argv[labelIdx + 1];

  if (!url) {
    console.error("usage: validate-1edtech.ts <credential-url> [--label <name>]");
    console.error("the URL must be publicly fetchable — the validator dereferences it");
    process.exit(2);
  }

  const target = `${ENDPOINT}?uri=${encodeURIComponent(url)}&validatorId=${VALIDATOR_ID}&other=`;
  console.log(`validating: ${url}`);
  console.log(`via:        ${ENDPOINT} (${VALIDATOR_ID})`);

  const res = await fetch(target, {
    method: "POST",
    // Mandatory even though the body is unused for the URI form — without it
    // the server returns 500 "Content type '' not supported" (verifier spike).
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`\nvalidator HTTP ${res.status}: ${text.slice(0, 400)}`);
    process.exit(1);
  }

  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`\nvalidator returned non-JSON: ${text.slice(0, 400)}`);
    process.exit(1);
  }

  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const full = path.join(RESULTS_DIR, `1edtech-${label}-${stamp}.json`);
  await fs.writeFile(full, JSON.stringify(body, null, 2) + "\n");

  const v = extractVerdict(body);
  console.log("\n| metric     | value |");
  console.log("|------------|-------|");
  for (const [k, val] of Object.entries(v)) {
    console.log(`| ${k.padEnd(10)} | ${String(val).padEnd(5)} |`);
  }
  console.log(`\nfull response: ${path.relative(REPO, full)}`);

  const pass = v.outcome.toUpperCase() === "VALID" && v.errors === 0 && v.warnings === 0;
  if (pass) {
    console.log("\n✅ VALID, 0 errors, 0 warnings — the identityless class shape is accepted.");
    console.log("   Safe to sign the remaining artifacts: npm run sign:class -- --signer kms --all");
  } else {
    console.log("\n❌ NOT a clean pass. Do NOT batch-sign.");
    console.log("   Read the full response above; the Phase 0 pass criterion is 0 errors AND 0 warnings");
    console.log("   (spike/verifier-spike/results/onedtech.md).");
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
  });
}
