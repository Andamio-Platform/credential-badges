// andamio-badge.js — the <andamio-badge> custom element (#74).
//
// A dependency-free web component a third-party site embeds via a <script> tag
// plus one element (the upgrade path from the #71 iframe embed). It renders the
// badge card — image + titles + an honest, baked-aware verified-state line — and
// links back to the credential's display page.
//
// It runs cross-origin on third-party sites, so it does NOT fetch anything from
// the badge host (that host sends no CORS headers). Cross-origin <img> and links
// are fine for display, so the element is ATTRIBUTE-DRIVEN: the page-generated
// snippet carries stem + titles + signed flag, and the element renders from those
// plus a cross-origin badge image. No fetch, no CORS, works on any site.
//
// Honesty (the load-bearing rule): the state label is derived from `signed` and
// mirrors the host's baked-aware wording gate — "Signed & verifiable" only for a
// signed/baked badge, "Anchored on-chain" otherwise. It never overclaims a
// signature; the "View credential" link to the host is the real trust anchor.
//
// Pure functions (badgeModel/renderMarkup/esc) carry all logic and are unit-tested
// with no DOM; the custom-element registration is thin and browser-guarded.

export const DEFAULT_HOST = "https://credentials.andamio.io";
const STEM_RE = /^[0-9a-f]{56}\.[0-9a-f]{64}$/;
// An https origin with no path/query/fragment — never `javascript:` or a URL that
// could smuggle markup into an href/src.
const HOST_RE = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i;

/** HTML-escape a value for safe interpolation into markup (text or attribute). */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Read the element's attributes into a plain object (also usable in tests). */
export function readAttrs(el) {
  const get = (n) => (el.getAttribute ? el.getAttribute(n) : el[n]) || "";
  return {
    stem: get("stem"),
    moduleTitle: get("module-title"),
    courseTitle: get("course-title"),
    // Boolean attribute: present (any value incl. "") => signed. Absent => not.
    signed: el.hasAttribute ? el.hasAttribute("signed") : !!el.signed,
    host: get("host"),
  };
}

/** Validate + compute the render model. `valid:false` for a malformed stem — the
 *  element then renders an inert placeholder, never a broken/injected card. */
export function badgeModel({ stem, moduleTitle, courseTitle, signed, host } = {}) {
  const h = HOST_RE.test(host || "") ? host : DEFAULT_HOST;
  if (!STEM_RE.test(stem || "")) {
    return { valid: false, host: h };
  }
  return {
    valid: true,
    stem,
    host: h,
    imgUrl: `${h}/badges/${stem}.svg`,
    pageUrl: `${h}/badges/${stem}`,
    moduleTitle: moduleTitle || "Credential",
    courseTitle: courseTitle || "Andamio",
    signed: !!signed,
    // Baked-aware, never overclaiming (KTD-4). Signed badges name the verifier
    // class the host page also names; presentation-only badges say only what's
    // true — the credential is anchored on-chain.
    stateLabel: signed ? "Signed & verifiable" : "Anchored on-chain",
    stateNote: signed
      ? "Verify with a DI-capable OB 3.0 / VC verifier."
      : "Anchored on the Cardano blockchain.",
  };
}

const STYLE = `
  :host{display:inline-block;--deep:#0C1325;--ink:#121A2D;--raised:#1B2540;--prim:#EE6C3A;--sec:#5BB8D4;--sec-lt:#9ED8E8;--bone:#EAE6DD;--slate:#6E7A98;--hair:#2C3858;}
  .card{box-sizing:border-box;width:300px;background:var(--ink);border:1px solid var(--hair);border-radius:14px;padding:16px;color:var(--bone);font-family:"Helvetica Neue",Arial,sans-serif;line-height:1.4;}
  .card img{display:block;width:100%;height:auto;border-radius:8px;background:var(--deep);}
  .mt{font-size:15px;font-weight:700;margin:12px 0 2px;}
  .ct{font-size:12px;color:var(--slate);margin:0 0 10px;}
  .state{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:rgba(91,184,212,.16);color:var(--sec-lt);}
  .state.unsigned{background:rgba(110,122,152,.16);color:var(--slate);}
  .note{font-size:11px;color:var(--slate);margin:8px 0 0;}
  a.view{display:inline-block;margin-top:12px;font-size:12px;color:var(--sec);text-decoration:none;font-weight:600;}
  .invalid{width:300px;box-sizing:border-box;padding:16px;border:1px dashed var(--hair);border-radius:14px;color:var(--slate);font:12px ui-monospace,monospace;}
`;

/** The shadow-root HTML for a model (all interpolations escaped). */
export function renderMarkup(model) {
  if (!model.valid) {
    return `<style>${STYLE}</style><div class="invalid">Invalid andamio-badge (bad or missing stem).</div>`;
  }
  const m = model;
  return `<style>${STYLE}</style>
<div class="card" part="card">
  <a href="${esc(m.pageUrl)}" target="_blank" rel="noopener">
    <img src="${esc(m.imgUrl)}" alt="${esc(m.moduleTitle)} — Andamio credential badge" loading="lazy">
  </a>
  <p class="mt">${esc(m.moduleTitle)}</p>
  <p class="ct">${esc(m.courseTitle)}</p>
  <span class="state ${m.signed ? "signed" : "unsigned"}">${esc(m.stateLabel)}</span>
  <p class="note">${esc(m.stateNote)}</p>
  <a class="view" href="${esc(m.pageUrl)}" target="_blank" rel="noopener">View credential &rarr;</a>
</div>`;
}

// ---- Custom element registration (browser only) --------------------------

if (typeof HTMLElement !== "undefined" && typeof customElements !== "undefined") {
  class AndamioBadge extends HTMLElement {
    static get observedAttributes() {
      return ["stem", "module-title", "course-title", "signed", "host"];
    }
    connectedCallback() { this._render(); }
    attributeChangedCallback() { if (this.isConnected) this._render(); }
    _render() {
      const root = this.shadowRoot || this.attachShadow({ mode: "open" });
      root.innerHTML = renderMarkup(badgeModel(readAttrs(this)));
    }
  }
  if (!customElements.get("andamio-badge")) {
    customElements.define("andamio-badge", AndamioBadge);
  }
}
