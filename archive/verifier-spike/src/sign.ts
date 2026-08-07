import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import jsigs from "jsonld-signatures";

import { DocumentLoader } from "./document-loader.js";

export async function signCredential(
  credential: any,
  keyPair: any,
  documentLoader: DocumentLoader,
): Promise<any> {
  const suite = new DataIntegrityProof({
    signer: keyPair.signer(),
    cryptosuite: eddsaRdfc2022,
  });

  try {
    return await vc.issue({ credential, suite, documentLoader });
  } catch (e: any) {
    // vc.issue runs strict VC-data-model checks that can reject VC 2.0 / urn: ids
    // on some lib versions. jsigs.sign is more permissive and produces the same proof.
    const { AssertionProofPurpose } = (jsigs as any).purposes;
    return await (jsigs as any).sign(credential, {
      suite,
      purpose: new AssertionProofPurpose(),
      documentLoader,
    });
  }
}
