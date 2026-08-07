/**
 * Validation harness. Runs three layers:
 *   1. Structural JSON checks    — required fields per OB 3.0 / W3C VC 2.0
 *   2. JSON-LD expansion         — verifies @context resolves and the document is parseable RDF
 *   3. JWT signature verification — verifies the proof.jwt against the issuer's did:key
 *
 * Output is written to ../validation-results.md.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { jwtVerify, importJWK } from "jose";
import jsonld from "jsonld";
import type { OpenBadgeCredential } from "./mapper.js";
import { OB3_CONTEXT, VC_V2_CONTEXT } from "./mapper.js";

interface CheckResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

async function loadSigned(): Promise<{
  signed: OpenBadgeCredential & { proof: any };
  unsigned: OpenBadgeCredential;
  key: any;
}> {
  const out = path.resolve(process.cwd(), "out");
  const signed = JSON.parse(
    await fs.readFile(path.join(out, "credential.signed.json"), "utf8")
  );
  const unsigned = JSON.parse(
    await fs.readFile(path.join(out, "credential.unsigned.json"), "utf8")
  );
  const key = JSON.parse(await fs.readFile(path.join(out, "issuer-key.json"), "utf8"));
  return { signed, unsigned, key };
}

function structuralChecks(doc: OpenBadgeCredential): CheckResult[] {
  const results: CheckResult[] = [];

  // OB 3.0 cheatsheet — Appendix A of the plan
  const requireField = (path: string, value: unknown, condition?: (v: any) => boolean) => {
    const ok =
      value !== undefined &&
      value !== null &&
      (condition ? condition(value) : true);
    results.push({
      name: `field: ${path}`,
      status: ok ? "PASS" : "FAIL",
      detail: ok ? "present" : `missing or invalid: ${JSON.stringify(value)}`,
    });
  };

  requireField("@context", doc["@context"], (v: string[]) =>
    Array.isArray(v) && v.includes(VC_V2_CONTEXT) && v.includes(OB3_CONTEXT)
  );
  requireField("id", doc.id, (v: string) => typeof v === "string" && v.length > 0);
  requireField("type", doc.type, (v: string[]) =>
    Array.isArray(v) &&
    v.includes("VerifiableCredential") &&
    v.includes("OpenBadgeCredential")
  );
  requireField("issuer.id", doc.issuer?.id);
  requireField("issuer.type", doc.issuer?.type, (v: string[]) =>
    Array.isArray(v) && v.includes("Profile")
  );
  requireField("validFrom", doc.validFrom, (v: string) => !Number.isNaN(Date.parse(v)));
  requireField("name", doc.name);
  requireField("credentialSubject.id", doc.credentialSubject?.id);
  requireField("credentialSubject.type", doc.credentialSubject?.type, (v: string[]) =>
    Array.isArray(v) && v.includes("AchievementSubject")
  );
  requireField(
    "credentialSubject.achievement.id",
    doc.credentialSubject?.achievement?.id
  );
  requireField(
    "credentialSubject.achievement.type",
    doc.credentialSubject?.achievement?.type,
    (v: string[]) => Array.isArray(v) && v.includes("Achievement")
  );
  requireField(
    "credentialSubject.achievement.name",
    doc.credentialSubject?.achievement?.name
  );
  requireField(
    "credentialSubject.achievement.description",
    doc.credentialSubject?.achievement?.description
  );
  requireField(
    "credentialSubject.achievement.criteria",
    doc.credentialSubject?.achievement?.criteria
  );

  return results;
}

async function jsonldExpansionCheck(
  doc: OpenBadgeCredential
): Promise<CheckResult[]> {
  try {
    const expanded = await jsonld.expand(doc as any);
    const triples = JSON.stringify(expanded);
    return [
      {
        name: "json-ld expansion",
        status: "PASS",
        detail: `expanded to ${expanded.length} top-level node(s); ${triples.length} chars`,
      },
      {
        name: "json-ld: contexts resolvable",
        status: "PASS",
        detail: `loaded ${VC_V2_CONTEXT} and ${OB3_CONTEXT}`,
      },
    ];
  } catch (err: any) {
    return [
      {
        name: "json-ld expansion",
        status: "FAIL",
        detail: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}`,
      },
    ];
  }
}

async function jwtVerificationCheck(
  signed: OpenBadgeCredential & { proof: { jwt: string } },
  key: any
): Promise<CheckResult[]> {
  try {
    const publicKey = await importJWK(key.publicJwk, "EdDSA");
    const { payload, protectedHeader } = await jwtVerify(signed.proof.jwt, publicKey, {
      issuer: signed.issuer.id,
      subject: signed.credentialSubject.id,
    });
    return [
      {
        name: "jwt signature",
        status: "PASS",
        detail: `alg=${protectedHeader.alg} kid=${protectedHeader.kid}`,
      },
      {
        name: "jwt payload.vc matches document",
        status: JSON.stringify((payload as any).vc.id) === JSON.stringify(signed.id)
          ? "PASS"
          : "FAIL",
        detail: `payload.vc.id=${(payload as any).vc.id}`,
      },
    ];
  } catch (err: any) {
    return [
      {
        name: "jwt signature",
        status: "FAIL",
        detail: `${err?.name ?? "Error"}: ${err?.message ?? String(err)}`,
      },
    ];
  }
}

function fmtTable(rows: CheckResult[]): string {
  const header = "| Check | Status | Detail |\n|---|---|---|\n";
  return (
    header +
    rows
      .map(
        (r) =>
          `| ${r.name} | ${r.status} | ${r.detail.replace(/\|/g, "\\|").slice(0, 200)} |`
      )
      .join("\n")
  );
}

async function main() {
  const { signed, unsigned, key } = await loadSigned();

  console.log("Structural checks...");
  const structural = structuralChecks(unsigned);

  console.log("JSON-LD expansion...");
  const ldChecks = await jsonldExpansionCheck(unsigned);

  console.log("JWT signature verification...");
  const jwtChecks = await jwtVerificationCheck(signed, key);

  const all = [...structural, ...ldChecks, ...jwtChecks];
  for (const r of all) {
    console.log(`  [${r.status}] ${r.name}: ${r.detail}`);
  }

  const passed = all.filter((r) => r.status === "PASS").length;
  const failed = all.filter((r) => r.status === "FAIL").length;
  console.log(`\n${passed} passed, ${failed} failed (${all.length} total)`);

  // Append automated results to validation-results.md (the doc has narrative around it)
  const md = `## Automated check results — last run ${new Date().toISOString()}\n\n${fmtTable(all)}\n\n**Summary**: ${passed} passed, ${failed} failed, ${all.length} total.\n`;
  await fs.writeFile(
    path.resolve(process.cwd(), "out", "automated-results.md"),
    md,
    "utf8"
  );
  console.log("\nWrote out/automated-results.md");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("validate failed:", err);
  process.exit(1);
});
