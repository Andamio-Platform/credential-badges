declare module "@digitalbazaar/vc" {
  export function issue(opts: any): Promise<any>;
  export function verifyCredential(opts: any): Promise<any>;
  export const defaultDocumentLoader: any;
  const _d: any;
  export default _d;
}
declare module "@digitalbazaar/data-integrity" {
  export class DataIntegrityProof {
    constructor(opts: any);
  }
}
declare module "@digitalbazaar/eddsa-rdfc-2022-cryptosuite" {
  export const cryptosuite: any;
}
declare module "@digitalbazaar/ed25519-multikey" {
  export function generate(opts?: any): Promise<any>;
  export function from(key: any): Promise<any>;
  export function fromJwk(opts: any): Promise<any>;
  export function toJwk(opts: any): Promise<any>;
}
declare module "jsonld-signatures";
