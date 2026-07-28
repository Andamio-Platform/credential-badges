// _holder.js — client module for the standalone holder credential viewer (#73),
// extended with the Phase 3 verification states (plan
// docs/plans/2026-07-28-003-feat-phase3-verification-states-plan.md).
//
// Served static at /badges/_holder.js, loaded by the _holder.html shell. It
// reads {stem}+{alias} from the URL, resolves the holder's LIVE state, and
// renders (a) an explicit VERDICT for the badge named in the URL and (b) every
// badge the holder holds, each in a named state:
//
//   * on-chain anchor  <- /holder-api/users/{alias}/state             (same-origin proxy
//                         to andamioscan, which sends no CORS headers of its own)
//   * course owner     <- /holder-api/users/{alias}/courses/completed (SOFT — one
//                         request carries `owner` for every completed course)
//   * suspension       <- /status/key-epoch-2026-07.json              (same-origin, no-store)
//   * titles + signed  <- /badges/_registry.json                      (generated)
//
// WHY THE VERDICT EXISTS. /badges/{stem}/{alias} is the LinkedIn certUrl target
// (see certUrlFor) — an employer opens it to ask exactly one question: does this
// holder hold THIS credential? Before Phase 3 the page never answered it; a
// not-held badge was simply absent from the list, and an absence in an unordered
// list reads as confirmation. The verdict answers the URL's own question first.
//
// STATE VOCABULARY — deliberately narrower than it looks (deployment plan Unit 5):
//
//   anchored              the holder's on-chain state records this credential and
//                         the badge artifact carries no signature at all.
//   signature-unavailable the holder's on-chain state records it AND the artifact
//                         carries a Data Integrity proof — which THIS PAGE DOES
//                         NOT CHECK. Never "valid".
//   suspended             signature present + the key-epoch bit is set. A
//                         KEY-VERSION signal, not "didn't earn it" (P1bis-02).
//   indeterminate         the answer is not known: a read failed, or the status
//                         list could not be read for a signed badge.
//   not-found             (verdict only) the holder's live on-chain state does
//                         not record this credential.
//
// TWO STATES ARE DELIBERATELY ABSENT, and adding either would be a regression:
//
//   anchored+signature-valid — verifying eddsa-rdfc-2022 needs JSON-LD expansion
//     + RDFC (URDNA2015) canonicalization, which is not implementable here
//     without vendoring a large JSON-LD/RDF stack into the SERVED allowlist.
//     Inferring it from `signed: true` (a proof is PRESENT) would be exactly the
//     overclaim this viewer's own copy disclaims. The correct home is a
//     server-side verify endpoint on credential-badges-issuer, which already
//     loopback-verifies with a closed document loader — blocked on the Phase 2
//     ops gate. Until then the honest answer is "signature not checked here".
//
//   revoked-signal — the deployment plan defines it as "claim tx exists but the
//     pair is now absent from the recipient's current global state", and REQUIRES
//     it be distinguishable from indexer lag before it may be shown. Client-side
//     it never is: Andamioscan exposes no freshness/confirmation-depth signal,
//     and there is no by-holder claim-event index to establish a claim ever
//     happened (probed 2026-07-28: /events/credential-claims/alias/{alias} and
//     the collection root both 404). The plan's own rule — indeterminate, never
//     revoked, when freshness is inconclusive — makes `not-found` the correct
//     output for absence. DO NOT add revoked-signal from absence alone; a
//     negative test in tools/holder-viewer.test.ts guards this.
//
// Fail-loud (R6): if live holder state can't load, the page says so and shows
// NOTHING as verified. Soft dependencies (status list, course owners) may only
// ever DOWNGRADE a state or omit a field — never upgrade one, never blank-fill
// (the same omit-never-blank rule map-credential.ts applies to `assessor`).
//
// Pure functions are exported and dependency-free (web-standard APIs only:
// fetch, atob, DecompressionStream, DOM), so they run under `node --test` with an
// injected fetch. The DOM bootstrap is guarded by `typeof document`.

export const STATUS_LIST_URL = "/status/key-epoch-2026-07.json";
export const REGISTRY_URL = "/badges/_registry.json";
/** Andamioscan's human course dashboard. Probed live 2026-07-28: a real course
 *  id returns 200 ("Course Dashboard - Andamioscan"), a bogus one returns 404 —
 *  so the link shape is verified, not assumed. No public-explorer deep link is
 *  emitted: cardanoscan 403s every non-browser client and cexplorer returns 200
 *  for bogus paths, so neither URL shape could be verified (plan KTD-4). The
 *  course id is rendered as a copyable value instead, and /badges/how-to-check
 *  walks the public-explorer route. */
export const SCAN_COURSE_URL = "https://andamioscan.io/courses";
// The credential's statusListIndex is the position of the signing-key version
// (status-list.ts KEY_VERSION_POSITIONS: key-2026-07 -> 0). One bit per key
// epoch: a set bit flags EVERY credential signed under that key at once.
export const KEY_EPOCH_INDEX = 0;

const STEM_RE = /^[0-9a-f]{56}\.[0-9a-f]{64}$/;
const ALIAS_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The states a BADGE IN THE LIST can be in. Frozen + exported so callers and
 *  tests reference the vocabulary rather than bare string literals. Note what is
 *  NOT here: no "valid" (nothing verifies a signature on this page) and no
 *  "revoked" (see the module header). */
export const BADGE_STATES = Object.freeze({
  ANCHORED: "anchored",
  SIGNATURE_UNAVAILABLE: "signature-unavailable",
  SUSPENDED: "suspended",
  INDETERMINATE: "indeterminate",
});

/** The states the ARRIVAL VERDICT can be in — every badge state, plus not-found
 *  (which only makes sense for a specific (badge, holder) pair). */
export const VERDICTS = Object.freeze({
  ...BADGE_STATES,
  NOT_FOUND: "not-found",
});

/** Parse /badges/{stem}/{alias} -> {stem, alias}, or null if malformed. */
export function parsePath(pathname) {
  const m = /^\/badges\/([^/]+)\/([^/]+)\/?$/.exec(pathname || "");
  if (!m) return null;
  const [, stem, alias] = m;
  if (!STEM_RE.test(stem) || !ALIAS_RE.test(alias)) return null;
  return { stem, alias };
}

/** base64url (no padding) -> Uint8Array. */
export function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(bytes).body.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inverse of the signing path's encodeStatusList (status-list.ts): multibase
 *  base64url ("u" prefix) of a gzipped bitstring. */
export async function decodeStatusList(encodedList) {
  if (typeof encodedList !== "string" || !encodedList.startsWith("u")) {
    throw new Error("encodedList is not multibase base64url (missing 'u' prefix)");
  }
  return gunzip(b64urlToBytes(encodedList.slice(1)));
}

/** Read one bit. W3C: bit position 0 is the MOST-significant bit of byte 0. */
export function statusBitAt(bits, index) {
  if (!Number.isInteger(index)) throw new Error(`status index not an integer: ${index}`);
  if (index < 0 || index >= bits.length * 8) throw new Error(`status index out of range: ${index}`);
  return (bits[index >>> 3] >>> (7 - (index & 0b111))) & 1;
}

/** Every {course_id}.{slt_hash} stem this holder's state claims. */
export function holderStems(holderState) {
  const stems = [];
  for (const c of holderState?.completed_courses || []) {
    for (const slt of c.claimed_credentials || []) {
      stems.push(`${c.course_id}.${slt}`);
    }
  }
  return stems;
}

/** `course_id -> owner` from the holder's completed-courses list. Probed live
 *  2026-07-28: /api/v2/users/{alias}/courses/completed returns, per completed
 *  course, {tx_hash, slot, course_id, owner, teachers, course_address,
 *  student_state_id} — so ONE request carries the course-owner pseudonym for
 *  every badge a holder holds. Only non-empty string owners are recorded; a
 *  missing or malformed owner is simply absent from the map, so the caller
 *  renders nothing rather than a blank attribution (map-credential.ts's
 *  omit-never-blank rule).
 *
 *  NB `tx_hash` here is the COURSE-CREATION transaction, not the credential
 *  claim (verified 2026-07-28: course ae1926… -> 42bfbfd…, whereas the flagship
 *  claim tx is 7cb75099…), so it is deliberately not surfaced as the
 *  credential's anchor. */
export function courseOwners(completed) {
  const owners = {};
  if (!Array.isArray(completed)) return owners;
  for (const c of completed) {
    const id = c?.course_id, owner = c?.owner;
    if (typeof id === "string" && typeof owner === "string" && owner) owners[id] = owner;
  }
  return owners;
}

/** The state of ONE badge the holder demonstrably holds.
 *
 *  `signed` says the ARTIFACT CARRIES a Data Integrity proof — never that the
 *  proof checks out (nothing on this page checks one). `keyEpochSuspended` is
 *  true/false when the status list was read, or null when it could not be.
 *
 *  Explicit boolean checks throughout: only a confirmed `false` reads as
 *  not-suspended. null (status unavailable) or any non-boolean falls through to
 *  `indeterminate` — never assume a state we did not actually confirm (R6). */
export function badgeStateFor({ signed, keyEpochSuspended }) {
  if (!signed) return BADGE_STATES.ANCHORED;
  if (keyEpochSuspended === true) return BADGE_STATES.SUSPENDED;
  if (keyEpochSuspended === false) return BADGE_STATES.SIGNATURE_UNAVAILABLE;
  return BADGE_STATES.INDETERMINATE;
}

/** Intersect the holder's claimed stems with the known-badge registry and fold
 *  in per-badge state + course-owner attribution. Arrived-from badge sorts
 *  first. `owners` is optional: a failed (soft) completed-courses read leaves it
 *  empty and every card simply omits the attribution line. */
export function buildViewModel({ holderState, registry, keyEpochSuspended, arrivedStem, owners }) {
  const seen = new Set();
  const badges = [];
  for (const stem of holderStems(holderState)) {
    if (seen.has(stem)) continue;
    seen.add(stem);
    const meta = registry?.[stem];
    if (!meta) continue; // claimed credential we have no badge art/title for
    const signed = !!meta.signed;
    badges.push({
      stem,
      courseId: stem.split(".")[0],
      courseTitle: meta.course_title || "",
      moduleTitle: meta.module_title || stem,
      // The course owner is the party who vouches for what the credential MEANS
      // (docs/verifier-guidance.md). null when the soft read failed or the
      // upstream carried no owner — omitted downstream, never blank-filled.
      courseOwner: owners?.[stem.split(".")[0]] ?? null,
      signed,
      state: badgeStateFor({ signed, keyEpochSuspended }),
      arrived: stem === arrivedStem,
    });
  }
  badges.sort((a, b) =>
    (b.arrived - a.arrived) || a.moduleTitle.localeCompare(b.moduleTitle));
  return badges;
}

/** The explicit verdict for the (badge, holder) pair the URL names — the
 *  question an employer following the LinkedIn certUrl is actually asking.
 *
 *  Derived from `holderStems` (the raw on-chain claim set), NOT from the
 *  registry intersection (plan KTD-1): a stem missing from _registry.json means
 *  "we have no badge art for it", not "the holder does not hold it", and
 *  reporting not-found on that basis would be wrong about a real credential.
 *
 *  - not-found      well-formed stem, absent from the holder's live on-chain state
 *  - indeterminate  the read failed, or there is no well-formed stem to judge
 *  - otherwise      the badge's own state (see badgeStateFor)
 *
 *  NEVER returns revoked-signal. Absence and indexer lag are indistinguishable
 *  here; see the module header. */
export function arrivalVerdict({ ok, holderState, arrivedStem, registry, keyEpochSuspended }) {
  if (!STEM_RE.test(arrivedStem || "")) {
    return { state: VERDICTS.INDETERMINATE, stem: null };
  }
  if (!ok) return { state: VERDICTS.INDETERMINATE, stem: arrivedStem };
  let held;
  try {
    held = holderStems(holderState).includes(arrivedStem);
  } catch (_e) {
    return { state: VERDICTS.INDETERMINATE, stem: arrivedStem };
  }
  if (!held) return { state: VERDICTS.NOT_FOUND, stem: arrivedStem };
  return {
    state: badgeStateFor({
      signed: !!registry?.[arrivedStem]?.signed,
      keyEpochSuspended,
    }),
    stem: arrivedStem,
  };
}

/** LinkedIn add-to-profile deep link with the HOLDER page as certUrl — the real
 *  "this person holds this, verified" target (KTD-7). Only offered for a
 *  confirmed, non-suspended badge (see renderBadges). */
export function certUrlFor(origin, stem, alias, moduleTitle) {
  const holderUrl = `${origin}/badges/${stem}/${alias}`;
  const q = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: moduleTitle,
    organizationName: "Andamio Teams",
    certUrl: holderUrl,
    certId: stem,
  });
  return `https://www.linkedin.com/profile/add?${q.toString()}`;
}

/** Wrap a fetch with an abort-on-timeout so a hung upstream can't leave the view
 *  spinning forever — an explicit bound on top of nginx's own proxy timeouts. */
function timedFetch(fetchImpl, ms) {
  return (url, opts = {}) => {
    if (!ms || typeof AbortController === "undefined") return Promise.resolve(fetchImpl(url, opts));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return Promise.resolve(fetchImpl(url, { ...opts, signal: ctrl.signal })).finally(() => clearTimeout(t));
  };
}

/** Resolve the holder view. Returns {ok, alias, origin, verdict, badges?, error?}.
 *
 *  Holder-state failure is fatal (R6): never returns badges when the on-chain
 *  read failed, timed out, or returned a malformed body — and the failure return
 *  always carries `alias` (so the caller never renders "undefined") and a
 *  `verdict` (so the caller always has something explicit to render, rather than
 *  leaving the URL's question silently unanswered).
 *
 *  Two SOFT dependencies, both of which may only downgrade or omit:
 *    - the status list  -> a failure marks signed badges `indeterminate`
 *    - completed-courses -> a failure omits the course-owner attribution
 *  Neither can upgrade a state, and neither can turn a failed view into an ok one. */
export async function loadHolderView({ stem, alias, fetchImpl = fetch, origin = "", timeoutMs = 12000 }) {
  const doFetch = timedFetch(fetchImpl, timeoutMs);
  const fail = (error) => ({
    ok: false, alias, origin, error,
    // A failed read is exactly the `indeterminate` state — say so, don't just
    // show an error and leave the (badge, holder) question unanswered.
    verdict: arrivalVerdict({ ok: false, arrivedStem: stem }),
  });
  let holderState, registry, owners = {};
  try {
    const [sRes, rRes, cRes] = await Promise.all([
      doFetch(`/holder-api/users/${encodeURIComponent(alias)}/state`, { cache: "no-store" }),
      doFetch(REGISTRY_URL),
      // Soft: a failure here must never reject the Promise.all and take the two
      // HARD reads down with it. Wrapped in an async IIFE so even a synchronous
      // throw from fetchImpl becomes a null, not a fatal view failure.
      (async () => {
        try {
          return await doFetch(
            `/holder-api/users/${encodeURIComponent(alias)}/courses/completed`,
            { cache: "no-store" });
        } catch (_e) {
          return null;
        }
      })(),
    ]);
    if (!sRes.ok) return fail(`Couldn't load live state for "${alias}" (${sRes.status}).`);
    if (!rRes.ok) return fail("Couldn't load the badge registry.");
    holderState = await sRes.json();
    registry = await rRes.json();
    if (cRes?.ok) {
      try {
        owners = courseOwners(await cRes.json());
      } catch (_e) {
        owners = {};   // unparseable body -> no attribution, never a wrong one
      }
    }
  } catch (e) {
    return fail(`Couldn't reach live credential state for "${alias}".`);
  }

  // Suspension is a soft dependency: a failure marks signed badges
  // `indeterminate` — never a silent pass.
  let keyEpochSuspended = null;
  try {
    const stRes = await doFetch(STATUS_LIST_URL, { cache: "no-store" });
    if (stRes.ok) {
      const doc = await stRes.json();
      const bits = await decodeStatusList(doc?.credentialSubject?.encodedList);
      keyEpochSuspended = statusBitAt(bits, KEY_EPOCH_INDEX) === 1;
    }
  } catch (_e) {
    keyEpochSuspended = null;
  }

  // buildViewModel parses the externally-owned holder-state shape; a malformed
  // 200 body (e.g. a non-iterable completed_courses) throws here — catch it so
  // it fails loud too, never leaving the caller with an unhandled rejection (R6).
  try {
    const badges = buildViewModel({ holderState, registry, keyEpochSuspended, arrivedStem: stem, owners });
    const verdict = arrivalVerdict({
      ok: true, holderState, arrivedStem: stem, registry, keyEpochSuspended,
    });
    return { ok: true, alias, badges, verdict, origin };
  } catch (e) {
    return fail(`Live credential state for "${alias}" was malformed.`);
  }
}

// ---- DOM bootstrap (browser only) ----------------------------------------

// Designed copy per state (deployment plan Unit 5: "designed copy, not raw
// state-name labels"). The chip is the short form; VERDICT_COPY carries the
// sentence a human verifier actually reads.
//
// "signature-unavailable" used to read "Signed & anchored", which an employer
// scans as an endorsement. What is true is narrower: a signature is PRESENT and
// this page did not check it.
const STATE_LABEL = {
  "anchored": "Anchored on-chain",
  "signature-unavailable": "Anchored · signature not checked here",
  "suspended": "Suspended · key-version",
  "indeterminate": "Indeterminate · state unavailable",
  "not-found": "Not found for this holder",
};

/** {headline, detail} per verdict state. `detail` is written for the employer
 *  who followed a LinkedIn certUrl, not for a developer. */
export const VERDICT_COPY = {
  "anchored": {
    headline: "Anchored on-chain for this holder.",
    detail: "This holder's live on-chain state records this credential. That anchor "
      + "is the credential's identity and needs no trust in Andamio. This badge "
      + "carries no cryptographic signature yet — the chain is the proof.",
  },
  "signature-unavailable": {
    headline: "Anchored on-chain for this holder · signature not checked here.",
    detail: "This holder's live on-chain state records this credential, and the badge "
      + "additionally carries a Data Integrity proof. This page does not check "
      + "that proof — to check it, take the badge to a DI-capable OB 3.0 / VC "
      + "verifier.",
  },
  "suspended": {
    headline: "Anchored on-chain · signing key version suspended.",
    detail: "This holder's live on-chain state records this credential. The signing "
      + "key version that covers the badge's signature is currently flagged. "
      + "That is a key-version issue, not a statement that the holder did not "
      + "earn the credential — the chain remains authoritative.",
  },
  "indeterminate": {
    headline: "Indeterminate — this page could not answer.",
    detail: "Live state could not be read, so nothing here is shown as verified. "
      + "Retry in a moment, or read the chain directly.",
  },
  "not-found": {
    headline: "Not found — this holder's live on-chain state does not record this credential.",
    detail: "That is not proof it was never earned. A very recently claimed "
      + "credential can take time to appear in Andamio's indexer, and the chain "
      + "is authoritative over anything this page says. Read the chain directly "
      + "before drawing a conclusion.",
  },
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Render the arrival verdict — the explicit answer to the question the URL
 *  asks. Always rendered, including on the fail-loud path, so the page never
 *  leaves that question silently unanswered. */
function renderVerdict(view, alias) {
  const root = document.querySelector("[data-holder-verdict]");
  if (!root) return;
  const state = view.verdict?.state || VERDICTS.INDETERMINATE;
  const copy = VERDICT_COPY[state] || VERDICT_COPY[VERDICTS.INDETERMINATE];
  root.replaceChildren();
  root.className = `verdict ${state}`;
  root.append(el("p", "vlabel", STATE_LABEL[state] || state));
  root.append(el("p", "vhead", copy.headline));
  root.append(el("p", "vdetail", copy.detail));
  if (view.verdict?.stem) {
    const p = el("p", "vlink");
    const a = el("a", null, "About this credential");
    a.href = `/badges/${view.verdict.stem}`;
    p.append(a);
    root.append(p);
  }
  root.hidden = false;
  root.setAttribute("data-verdict-state", state);
  // The alias is interpolated into the heading, not the verdict copy, so the
  // verdict text stays constant per state (and testable as such).
  if (alias) root.setAttribute("data-verdict-alias", alias);
}

function renderBadges(root, view) {
  const alias = document.querySelector("[data-holder-alias]");
  if (alias) alias.textContent = view.alias;
  const status = document.querySelector("[data-holder-status]");
  const list = document.querySelector("[data-holder-list]");
  const origin = view.origin || location.origin;

  renderVerdict(view, view.alias);

  if (!view.ok) {
    status.textContent = `${view.error} Nothing here is shown as verified — try again in a moment.`;
    status.classList.add("error");
    list.hidden = true;
    return;
  }
  if (!view.badges.length) {
    status.textContent = `No known Andamio badges found for "${view.alias}".`;
    status.classList.remove("error");
    list.hidden = true;
    return;
  }

  status.hidden = true;
  list.hidden = false;
  list.replaceChildren();
  for (const b of view.badges) {
    const li = el("li", "badge");
    const img = el("img");
    img.src = `/badges/${b.stem}.svg`;
    img.alt = "";
    img.loading = "lazy";
    li.append(img);

    const meta = el("div", "meta");
    const mt = el("p", "mt");
    const link = el("a", null, b.moduleTitle);
    link.href = `/badges/${b.stem}`;
    mt.append(link);
    meta.append(mt, el("p", "ct", b.courseTitle));
    meta.append(el("span", `state ${b.state}`, STATE_LABEL[b.state] || b.state));

    // Multi-party attribution (deployment plan Unit 5): the course owner is the
    // party who vouches for what the credential MEANS — Andamio only attests the
    // anchor. Omitted entirely when the soft read gave us nothing, never
    // blank-filled. The ASSESSOR is deliberately absent here and named as absent
    // in the shell's standing copy: the on-chain claim event carries no assessor,
    // and the course `teachers` roster is not "who assessed this credential".
    if (b.courseOwner) {
      const owner = el("p", "owner");
      owner.append(document.createTextNode("Course owner: "));
      owner.append(el("span", "pseudonym", b.courseOwner));
      meta.append(owner);
    }

    // On-chain anchor: the course id IS the on-chain minting policy, and is the
    // half of the credential's identity a reader can chase without trusting
    // Andamio. The credential's CLAIM TX hash is not reachable from the browser
    // (no by-holder claim-event index upstream), so it is not offered. The link
    // target is verified (plan KTD-4); no unverified public-explorer deep link
    // is emitted.
    const anchor = el("p", "anchor");
    anchor.append(document.createTextNode("On-chain course id: "));
    const cid = el("code", "cid", b.courseId);
    anchor.append(cid, document.createTextNode(" "));
    const scan = el("a", null, "view on andamioscan");
    scan.href = `${SCAN_COURSE_URL}/${b.courseId}`;
    scan.target = "_blank";
    scan.rel = "noopener";
    anchor.append(scan);
    meta.append(anchor);

    // Add-to-LinkedIn only for a confirmed, non-suspended badge (KTD-5) — never
    // offer to profile-add something in a suspended or couldn't-verify state.
    if (b.state === BADGE_STATES.ANCHORED || b.state === BADGE_STATES.SIGNATURE_UNAVAILABLE) {
      const li2 = el("a", "li", "Add to LinkedIn profile");
      li2.href = certUrlFor(origin, b.stem, view.alias, b.moduleTitle);
      li2.target = "_blank";
      li2.rel = "noopener";
      meta.append(document.createElement("br"), li2);
    }
    li.append(meta);
    root.append(li);
  }
}

async function boot() {
  const status = document.querySelector("[data-holder-status]");
  const list = document.querySelector("[data-holder-list]");
  const form = document.querySelector("[data-holder-form]");
  const input = document.querySelector("[data-holder-input]");

  let route = parsePath(location.pathname);

  // Alias switcher: navigate to /badges/{stem}/{alias}. Keep the arrived-from
  // stem when present; fall back to the flagship-agnostic path shape.
  if (form && input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = input.value.trim();
      if (!ALIAS_RE.test(a)) return;
      const stem = route?.stem;
      if (stem) location.assign(`/badges/${stem}/${a}`);
    });
  }

  if (!route) {
    // The holder URL needs a badge-class stem, so the alias switcher can't
    // function here — disable it rather than silently no-op on submit.
    if (input) input.disabled = true;
    status.textContent =
      "Open a holder view from a badge page to see a holder's badges.";
    list.hidden = true;
    return;
  }

  // Any unexpected throw still resolves to a fail-loud UI, never a stuck spinner.
  try {
    const view = await loadHolderView({ stem: route.stem, alias: route.alias, origin: location.origin });
    renderBadges(list, view);
  } catch (e) {
    renderBadges(list, {
      ok: false, alias: route.alias, origin: location.origin,
      error: `Couldn't load ${route.alias}'s credentials.`,
      verdict: arrivalVerdict({ ok: false, arrivedStem: route.stem }),
    });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
