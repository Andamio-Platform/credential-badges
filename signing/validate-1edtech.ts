// validate-1edtech.ts — runs the 1EdTech OB 3.0 validator against a hosted
// credential and records the verdict.
//
// This is the gate the class-artifact release turns on, and it has already
// earned its place: the first shape (identityless, with no credentialSubject.id)
// was schema-conformant AND recommended by the OB 3.0 implementation guide, and
// the reference validator rejected it anyway. "Conformant on paper" and "the
// validator says VALID" are different claims, and only the second is worth
// signing 57 more artifacts on.
//
// Endpoint and invocation are inherited from the Phase 0 verifier spike, which
// reached VALID 13/13 on the holder credential:
//   spike/verifier-spike/results/onedtech.md
//
// Takes a LOCAL FILE and uploads it — no hosting required. The Phase 0 spike
// used the URI form (`/api/validateuri`), which meant publishing the credential
// somewhere fetchable before it could be checked. The multipart form takes the
// bytes directly, so a shape can be validated BEFORE anything is published,
// which is what makes the sign-one-then-batch gate cheap.
//
// Everything the validator dereferences from inside the credential already
// resolves live: did:web:credentials.andamio.io, the issuer Profile, the
// signing context, and the key-epoch status list.
//
// Usage:
//   npm run validate:1edtech -- <path-to-artifact.json> [--label <name>]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const RESULTS_DIR = path.join(HERE, "out", "validation");

const ENDPOINT = "https://verifybadge.org/api/validate";
const VALIDATOR_ID = "OB30Inspector";

interface Verdict {
  outcome: string;
  errors: number;
  warnings: number;
  fatals: number;
  exceptions: number;
  totalRun: number;
}

/** The response carries a top-level `summary` block. */
function extractVerdict(body: any): Verdict {
  const s = body?.summary ?? {};
  const num = (k: string) => Number(s[k] ?? 0);
  return {
    outcome: String(s.outcome ?? "UNKNOWN"),
    errors: num("errors"),
    warnings: num("warnings"),
    fatals: num("fatals"),
    exceptions: num("exceptions"),
    totalRun: num("totalRun"),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const file = argv.find((a) => a.endsWith(".json"));
  const labelIdx = argv.indexOf("--label");
  const label = labelIdx === -1 ? "class-artifact" : argv[labelIdx + 1];

  if (!file) {
    console.error("usage: validate-1edtech.ts <path-to-artifact.json> [--label <name>]");
    process.exit(2);
  }

  const bytes = await fs.readFile(file);
  console.log(`validating: ${path.relative(REPO, path.resolve(file))}`);
  console.log(`via:        ${ENDPOINT} (${VALIDATOR_ID})`);

  // Multipart. Do NOT set Content-Type explicitly — this endpoint rejects
  // application/json and text/plain outright, and FormData needs to set its
  // own boundary.
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/json" }), path.basename(file));

  const res = await fetch(`${ENDPOINT}?validatorId=${VALIDATOR_ID}`, {
    method: "POST",
    body: form,
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
  for (const e of body?.errors ?? []) console.log(`\nERROR: ${e.message}  <- ${e.generator}`);
  for (const w of body?.warnings ?? []) console.log(`WARN : ${w.message}  <- ${w.generator}`);
  console.log("\n| metric     | value |");
  console.log("|------------|-------|");
  for (const [k, val] of Object.entries(v)) {
    console.log(`| ${k.padEnd(10)} | ${String(val).padEnd(5)} |`);
  }
  console.log(`\nfull response: ${path.relative(REPO, full)}`);

  const pass = v.outcome.toUpperCase() === "VALID" && v.errors === 0 && v.warnings === 0;
  if (pass) {
    console.log("\n✅ VALID, 0 errors, 0 warnings — the class-artifact shape is accepted.");
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
