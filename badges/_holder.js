// _holder.js — client module for the standalone holder credential viewer (#73).
//
// Served static at /badges/_holder.js, loaded by the _holder.html shell. It
// reads {stem}+{alias} from the URL, resolves the holder's LIVE state, and
// renders each badge with honest verified / suspended / couldn't-verify state:
//
//   * on-chain anchor  <- /holder-api/users/{alias}/state  (same-origin proxy to
//                         andamioscan, which sends no CORS headers of its own)
//   * suspension       <- /status/key-epoch-2026-07.json   (same-origin, no-store)
//   * titles + signed  <- /badges/_registry.json           (generated)
//
// Fail-loud (R6): if live holder state can't load, the page says so and shows
// NOTHING as verified. This viewer owns the human suspension UX (P1bis-02): a set
// status bit is a KEY-VERSION issue, not "didn't earn it"; the chain is
// authoritative.
//
// Pure functions are exported and dependency-free (web-standard APIs only:
// fetch, atob, DecompressionStream, DOM), so they run under `node --test` with an
// injected fetch. The DOM bootstrap is guarded by `typeof document`.

export const STATUS_LIST_URL = "/status/key-epoch-2026-07.json";
export const REGISTRY_URL = "/badges/_registry.json";
// The credential's statusListIndex is the position of the signing-key version
// (status-list.ts KEY_VERSION_POSITIONS: key-2026-07 -> 0). One bit per key
// epoch: a set bit flags EVERY credential signed under that key at once.
export const KEY_EPOCH_INDEX = 0;

const STEM_RE = /^[0-9a-f]{56}\.[0-9a-f]{64}$/;
const ALIAS_RE = /^[A-Za-z0-9_-]{1,64}$/;

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

/** Intersect the holder's claimed stems with the known-badge registry and fold
 *  in per-badge state. `keyEpochSuspended` is true/false when the status list
 *  was read, or null when it could not be (suspension then reads "unknown" for
 *  signed badges — never silently "ok"). Arrived-from badge sorts first. */
export function buildViewModel({ holderState, registry, keyEpochSuspended, arrivedStem }) {
  const seen = new Set();
  const badges = [];
  for (const stem of holderStems(holderState)) {
    if (seen.has(stem)) continue;
    seen.add(stem);
    const meta = registry?.[stem];
    if (!meta) continue; // claimed credential we have no badge art/title for
    const signed = !!meta.signed;
    let state;
    if (!signed) state = "anchored";
    else if (keyEpochSuspended === null) state = "unknown"; // couldn't check suspension
    else if (keyEpochSuspended) state = "suspended";
    else state = "signed";
    badges.push({
      stem,
      courseTitle: meta.course_title || "",
      moduleTitle: meta.module_title || stem,
      signed,
      state,
      arrived: stem === arrivedStem,
    });
  }
  badges.sort((a, b) =>
    (b.arrived - a.arrived) || a.moduleTitle.localeCompare(b.moduleTitle));
  return badges;
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

/** Resolve the holder view. Returns {ok:true, alias, badges} or {ok:false,
 *  error}. Holder-state failure is fatal (R6): never returns badges when the
 *  on-chain read failed. Suspension-list failure degrades to "unknown" per
 *  signed badge, not to a silent pass. */
export async function loadHolderView({ stem, alias, fetchImpl = fetch, origin = "" }) {
  let holderState, registry;
  try {
    const [sRes, rRes] = await Promise.all([
      fetchImpl(`/holder-api/users/${encodeURIComponent(alias)}/state`, { cache: "no-store" }),
      fetchImpl(REGISTRY_URL),
    ]);
    if (!sRes.ok) return { ok: false, error: `Couldn't load live state for "${alias}" (${sRes.status}).` };
    if (!rRes.ok) return { ok: false, error: "Couldn't load the badge registry." };
    holderState = await sRes.json();
    registry = await rRes.json();
  } catch (e) {
    return { ok: false, error: `Couldn't reach live credential state for "${alias}".` };
  }

  // Suspension is a soft dependency: a failure marks signed badges "unknown".
  let keyEpochSuspended = null;
  try {
    const stRes = await fetchImpl(STATUS_LIST_URL, { cache: "no-store" });
    if (stRes.ok) {
      const doc = await stRes.json();
      const bits = await decodeStatusList(doc?.credentialSubject?.encodedList);
      keyEpochSuspended = statusBitAt(bits, KEY_EPOCH_INDEX) === 1;
    }
  } catch (_e) {
    keyEpochSuspended = null;
  }

  const badges = buildViewModel({ holderState, registry, keyEpochSuspended, arrivedStem: stem });
  return { ok: true, alias, badges, origin };
}

// ---- DOM bootstrap (browser only) ----------------------------------------

const STATE_LABEL = {
  anchored: "Anchored on-chain",
  signed: "Signed & anchored",
  suspended: "Suspended · key-version",
  unknown: "Anchored · signature status unavailable",
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderBadges(root, view) {
  const alias = document.querySelector("[data-holder-alias]");
  if (alias) alias.textContent = view.alias;
  const status = document.querySelector("[data-holder-status]");
  const list = document.querySelector("[data-holder-list]");
  const origin = view.origin || location.origin;

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

    // Add-to-LinkedIn only for a confirmed, non-suspended badge (KTD-5) — never
    // offer to profile-add something in a suspended or couldn't-verify state.
    if (b.state === "anchored" || b.state === "signed") {
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
    status.textContent =
      "Open a holder view from a badge page, or look up a holder by alias above.";
    list.hidden = true;
    return;
  }

  const view = await loadHolderView({ stem: route.stem, alias: route.alias, origin: location.origin });
  renderBadges(list, view);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
