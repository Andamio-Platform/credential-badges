import { promises as fs } from "node:fs";
import path from "node:path";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";

import { DID, VERIFICATION_METHOD_ID } from "./did-web.js";

const OUT_DIR = path.resolve(process.cwd(), "out");
const KEY_PATH = path.join(OUT_DIR, "issuer-key.json");

export async function getOrCreateKey(): Promise<any> {
  await fs.mkdir(OUT_DIR, { recursive: true });

  let kp: any;
  try {
    const raw = JSON.parse(await fs.readFile(KEY_PATH, "utf8"));
    kp = await Ed25519Multikey.from(raw);
  } catch {
    kp = await Ed25519Multikey.generate();
    const exported = await kp.export({ publicKey: true, secretKey: true });
    await fs.writeFile(KEY_PATH, JSON.stringify(exported, null, 2), "utf8");
  }

  // Override the default did:key identity — we want did:web with a stable fragment.
  kp.controller = DID;
  kp.id = VERIFICATION_METHOD_ID;

  return kp;
}
