// Rung 8.3 follow-up (ADV-2) · Signed-artifact expansion pin — the PERMANENT
// gate that no future context PR can change how the committed SIGNED artifacts
// expand.
//
// eddsa-rdfc-2022 signs the SHA-256 of the RDFC-1.0 (URDNA2015) canonical RDF
// dataset. If a context edit changes the canonical dataset a signed artifact
// expands to, the committed proof is cryptographically dead even though the
// JSON bytes are untouched. `isAdditiveSuperset` narrows what the transitional
// signing gate accepts, but the durable guarantee is this test: expand each
// committed signed artifact under the COMMITTED context/v0.jsonld and pin the
// sha256 of the canonical N-Quads. A context PR that alters signed-artifact
// expansion fails here, loudly, before merge.
//
// These pins change ONLY on a legitimate re-sign of the artifact they cover
// (a re-sign changes the signed document, hence its dataset) — update them in
// the same commit as the re-signed artifact, never for a context-only PR.
//
// NOT in the hermetic `*.test.ts` glob: this test needs the spike's jsonld
// dependency (npm ci) and fetches the version-pinned, immutable W3C/OB3
// contexts over the network (disk-cached under out/ctx-cache). The Andamio
// context is served from the COMMITTED file via a loader override — the live
// host is never consulted, so the gate is deploy-state-independent. CI runs it
// in the dedicated `expansion-pin` job.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-ignore — no bundled types
import jsonld from "jsonld";

import { makeDocumentLoader, ANDAMIO_CONTEXT_URL } from "./document-loader.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const REPO_CONTEXT_FILE = path.join(REPO, "context", "v0.jsonld");

const SIGNED_ARTIFACTS: Record<string, { file: string; canonicalSha256: string }> = {
  "signed-credential.json": {
    file: path.join(HERE, "signed-credential.json"),
    canonicalSha256: "181d2f4e0b93675fa173e551c2f6d9ac6f680674d86e209f26df5bbcfe67535a",
  },
  "status/key-epoch-2026-07.json": {
    file: path.join(REPO, "status", "key-epoch-2026-07.json"),
    canonicalSha256: "e6d38e020632a178cfa43039cee46f0bac1117d70255d028d4249f1d8b7a40bb",
  },
};

async function canonicalDatasetSha256(file: string): Promise<string> {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  // The COMMITTED context stands in for its production URL; everything else
  // resolves through the closed, allowlisted loader.
  const committedContext = JSON.parse(readFileSync(REPO_CONTEXT_FILE, "utf8"));
  const documentLoader = makeDocumentLoader({
    [ANDAMIO_CONTEXT_URL]: committedContext,
  });
  const nquads: string = await jsonld.canonize(doc, {
    algorithm: "URDNA2015",
    format: "application/n-quads",
    documentLoader,
    // Safe mode: a term that fails to expand is a loud error, never a silently
    // dropped triple — same posture as the signing pipeline.
    safe: true,
  });
  return createHash("sha256").update(nquads, "utf8").digest("hex");
}

for (const [name, { file, canonicalSha256 }] of Object.entries(SIGNED_ARTIFACTS)) {
  test(`${name}: canonical RDF dataset under the COMMITTED context matches the pin`, async () => {
    assert.equal(
      await canonicalDatasetSha256(file),
      canonicalSha256,
      `${name} no longer expands to the dataset its proof was computed over — ` +
        "either a context change altered signed-artifact expansion (revert it) " +
        "or the artifact was legitimately re-signed (update the pin in the same commit)",
    );
  });
}
