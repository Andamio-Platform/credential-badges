declare module "jsonld" {
  const jsonld: {
    expand(input: any, options?: any): Promise<any[]>;
    compact(input: any, ctx: any, options?: any): Promise<any>;
    flatten(input: any, ctx?: any, options?: any): Promise<any>;
    canonize(input: any, options?: any): Promise<string>;
    [k: string]: any;
  };
  export default jsonld;
}

// Demo-grade ambient shims — these @digitalbazaar packages ship no types.
// Corner cut tracked in CORNERS-CUT.md; production should pin typed wrappers.
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
