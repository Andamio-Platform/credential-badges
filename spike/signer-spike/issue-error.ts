// Rung 8 · The ONE vc.issue error the jsigs fallback may absorb.
//
// Context (issue #54, finding 1): sign.ts used to wrap vc.issue in a blind
// `catch` and fall back to jsigs.sign on ANY error. That meant a
// data-model-invalid credential could still get production-signed, and a
// post-signer throw inside vc.issue could double-invoke the signer.
//
// The fallback exists for exactly one known incompatibility: some versions of
// @digitalbazaar/vc validate id-bearing properties with a URL parse that
// rejects `urn:` URIs. When that check fires, `_validateUriId` throws
//
//   TypeError: "<propertyName>" must be a URI: "urn:...".
//
// (see node_modules/@digitalbazaar/vc/lib/index.js, _validateUriId — the
// TypeError carries the property name and the offending id in its message).
// Our credential ids are deliberately `urn:andamio:...`, so that error — and
// ONLY that error — may route to the jsigs fallback, which produces the
// identical proof without the data-model re-check (rung-1 pattern).
//
// On the pinned dependency set (@digitalbazaar/vc 7.x) `_checkCredential`
// PASSES for the mapped credential (verified empirically at Rung 8), so this
// fallback is compat-only dead code today. Every other error — data-model
// violations, loader refusals, signer failures — must propagate and abort the
// run before any artifact is written.

export function isKnownUrnIdDataModelError(e: unknown): boolean {
  return (
    e instanceof TypeError &&
    typeof e.message === "string" &&
    /" must be a URI: "urn:/.test(e.message)
  );
}
