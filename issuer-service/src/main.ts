// Production entrypoint. Wires the real dependencies, runs the fail-closed
// startup drift check, and only then opens the listener.
//
// Modes:
//   SIGNER_MODE=kms (default)  — production. Requires KMS_KEY_VERSION_NAME
//     (full CryptoKeyVersion resource name; the ops gate provides it — no
//     default region is baked in). The service must run AS the sign SA
//     (metadata-server identity); the boot drift check proves the KMS key
//     matches the live did.json before any signing endpoint opens.
//   SIGNER_MODE=ephemeral — local runs / smoke tests. An in-process Ed25519
//     key through the same seam; the drift check against the live did.json is
//     SKIPPED (an ephemeral key can never be in the production DID document)
//     and the served credentials carry a did:example issuer. LOUDLY not
//     production.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, ISSUER_DID } from "./config.ts";
import { ACTIVE_KEY_VERSION } from "./status-list.ts";
import { KmsSigner, makeEphemeralSigner } from "./signer.ts";
import { runStartupDriftCheck } from "./drift-check.ts";
import { createServer, type AppDeps } from "./server.ts";
import { LayeredArtifactCache, MemoryArtifactStore } from "./cache.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The committed status list — the exact bytes the static host serves; used by
// the post-sign status check without a per-request network dependency.
const BUNDLED_STATUS_FILE = path.join(
  HERE, "..", "..", "status", "key-epoch-2026-07.json",
);

export const VERIFICATION_METHOD_ID = `${ISSUER_DID}#${ACTIVE_KEY_VERSION}`;

async function main(): Promise<void> {
  const config = loadConfig();
  const statusListCredential = JSON.parse(readFileSync(BUNDLED_STATUS_FILE, "utf8"));
  const cache = new LayeredArtifactCache(new MemoryArtifactStore(), null);

  let deps: AppDeps;
  if (config.signerMode === "kms") {
    const signer = new KmsSigner({
      keyVersionName: config.kmsKeyVersionName!,
      verificationMethodId: VERIFICATION_METHOD_ID,
    });
    // FAIL-CLOSED BOOT GATE: refuses to open the listener on any drift.
    const { didDocument, didSource } = await runStartupDriftCheck({
      verificationMethodId: VERIFICATION_METHOD_ID,
      getOwnPublicKeyMultibase: () => signer.getPublicKeyMultibase(),
    });
    console.error(
      `startup drift check PASSED (did.json source: ${didSource}; key ${VERIFICATION_METHOD_ID})`,
    );
    deps = {
      signer,
      didDocument,
      statusListCredential,
      fetchImpl: fetch,
      cache,
    };
  } else {
    console.error(
      "SIGNER_MODE=ephemeral — NOT PRODUCTION. Credentials are signed with an in-process throwaway key and a did:example issuer; the live-did drift check is skipped.",
    );
    const ephemeral = makeEphemeralSigner();
    deps = {
      signer: ephemeral.signer,
      signerOverrides: ephemeral.overrides,
      issuerIdOverride: ephemeral.controller,
      didDocument: ephemeral.didDocument,
      statusListCredential,
      fetchImpl: fetch,
      cache,
    };
  }

  const server = createServer(deps);
  server.listen(config.port, () => {
    console.error(
      `credential-badges-issuer listening on :${config.port} (mode: ${config.signerMode})`,
    );
  });
}

main().catch((e) => {
  console.error(String((e as Error).stack ?? e));
  process.exit(1);
});
