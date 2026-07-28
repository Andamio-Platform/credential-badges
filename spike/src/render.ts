/**
 * Render each `samples/*.jsonld` as a standalone HTML viewer next to it.
 *
 * The output `.html` is self-contained — no external CSS, no external JS, the
 * credential JSON embedded inline. Drag-and-drop into a browser, email as an
 * attachment, host anywhere. Designed for non-technical audiences:
 *   - leads with the human story (badge title, recipient, description)
 *   - surfaces the on-chain anchor with clickable cexplorer links
 *   - highlights chain-enforced prerequisites
 *   - tucks the raw JSON-LD into a collapsible footer
 *
 * Run: `npm run render`
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const SAMPLES_DIR = path.resolve(process.cwd(), "samples");

function explorerBase(network: string): string {
  return network === "mainnet"
    ? "https://cexplorer.io"
    : "https://preprod.cexplorer.io";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return iso;
  }
}

function short(hex: string, head = 8, tail = 6): string {
  if (!hex || hex.length <= head + tail + 1) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface RenderInputs {
  doc: any;
  isReal: boolean;
  verifyResults?: string;
}

// Canonical shape uses bare terms (resolved via the published andamio
// context); accept the legacy `andamio:`-prefixed CURIE form as a fallback.
const term = (o: any, name: string) => o?.[name] ?? o?.[`andamio:${name}`];

function renderCredential({ doc, isReal, verifyResults }: RenderInputs): string {
  const ach = doc?.credentialSubject?.achievement ?? {};
  const anchor = term(ach, "onChainAnchor") ?? {};
  const network = anchor?.network ?? "mainnet";
  const explorer = explorerBase(network);
  const att = term(ach, "onChainAttestation");
  const requires = term(ach, "requires") ?? [];
  const at = term(doc?.credentialSubject, "accessToken");
  const issuer = doc?.issuer ?? {};
  const recipientName = at?.alias ?? doc?.credentialSubject?.id ?? "recipient";

  const policyLink = (policyId: string) =>
    `<a href="${explorer}/policy/${escapeHtml(policyId)}" target="_blank" rel="noopener">${short(policyId)} ↗</a>`;

  const txLink = (txHash: string) =>
    `<a href="${explorer}/tx/${escapeHtml(txHash.split("#")[0])}" target="_blank" rel="noopener">${short(txHash, 10, 8)} ↗</a>`;

  const assetLink = (fingerprint: string) =>
    `<a href="${explorer}/asset/${escapeHtml(fingerprint)}" target="_blank" rel="noopener">${escapeHtml(fingerprint)} ↗</a>`;

  const realityBadge = isReal
    ? `<span class="badge real">Real recipient · on-chain verified</span>`
    : `<span class="badge demo">Schema demo · placeholder recipient</span>`;

  const pickHash = (o: any) => o?.sltHash ?? o?.stateHash ?? o?.completionHash;
  const hashLabel = (type: string) =>
    type === "course" ? "Slt hash" : type === "project" ? "State hash" : "Completion hash";

  // Badge artwork — CSS-rendered medallion by default. Swap to a generated
  // image by setting `credentialSubject.achievement.image` (OB 3.0 standard
  // field) — the renderer prefers it when present, falling back to CSS.
  const achievementImage = ach?.image;
  const imageSrc = typeof achievementImage === "string"
    ? achievementImage
    : achievementImage?.id;
  const credentialType = (anchor?.type ?? "").replace(/-state$/, "") || "credential";
  const issuerShortName = (issuer?.name ?? "").replace(/\s*\(on Cardano.*\)$/i, "").trim();
  const titleLen = (ach?.name ?? "").length;
  const titleSizeClass = titleLen > 24 ? "title-sm" : titleLen > 14 ? "title-md" : "title-lg";

  const badgeArt = imageSrc
    ? `<img class="badge-image" src="${escapeHtml(imageSrc)}" alt="${escapeHtml(ach?.name ?? "credential")}" />`
    : `
      <div class="badge-medallion">
        <span class="medallion-title ${titleSizeClass}">${escapeHtml(ach?.name ?? "")}</span>
      </div>`;

  const prereqHtml = requires
    .map((r: any, i: number) => {
      const pa = term(r, "prereqAttestation");
      const requiredAchId = r?.achievementId ?? "";
      // achievementId shape: urn:andamio[:preprod]:{type}:{policyId}:{typed_hash}
      const parts = requiredAchId.split(":");
      const requiredType = parts[parts.length - 3] ?? "credential";
      const paHash = pickHash(pa);
      return `
        <div class="prereq">
          <div class="prereq-title">Requires: <code>${escapeHtml(requiredType)}</code> credential</div>
          <div class="kv"><span class="k">Policy</span><span class="v">${pa?.policyId ? policyLink(pa.policyId) : escapeHtml(requiredAchId)}</span></div>
          ${paHash ? `<div class="kv"><span class="k">${escapeHtml(hashLabel(requiredType))}</span><span class="v"><code>${escapeHtml(short(paHash, 12, 10))}</code></span></div>` : ""}
          <div class="kv"><span class="k">Enforcement</span><span class="v"><code>${escapeHtml(r?.enforcement ?? "—")}</code></span></div>
          ${r?.rationale ? `<details class="rationale"><summary>Why this matters</summary><p>${escapeHtml(r.rationale)}</p></details>` : ""}
        </div>`;
    })
    .join("");

  const verifyPanel = verifyResults
    ? `<section class="card verify-panel">
        <h2>Independent verification — last run</h2>
        <p class="muted">Output from a standalone TypeScript verifier that fetched the recipient's on-chain global state UTXO and confirmed the claimed entries are present. No Andamio infrastructure is in the loop.</p>
        <pre class="verify-output">${escapeHtml(verifyResults)}</pre>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc?.name ?? "Andamio Credential")}</title>
<style>
  :root {
    --ink: #0e1a1f;
    --ink-soft: #4a5a62;
    --ink-muted: #7c8a91;
    --bg: #f7f8f7;
    --card: #ffffff;
    --line: #e4e7e6;
    --accent: #156b5a;
    --accent-soft: #e6f1ee;
    --warn: #b85a00;
    --warn-soft: #fbeedb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1rem 4rem;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--ink);
    background: var(--bg);
  }
  .page { max-width: 760px; margin: 0 auto; }
  header.top {
    display: flex; justify-content: space-between; align-items: center;
    padding-bottom: 1rem; border-bottom: 1px solid var(--line); margin-bottom: 1.5rem;
  }
  .top .brand { font-weight: 600; letter-spacing: .02em; color: var(--ink); }
  .top .brand .dot { color: var(--accent); }
  .network { font-size: .8rem; color: var(--ink-muted); text-transform: uppercase; letter-spacing: .12em; }

  h1.cred-name { font-size: 1.85rem; line-height: 1.2; margin: 0 0 .25rem; letter-spacing: -.01em; }
  h2.ach-name { font-size: 1rem; font-weight: 500; color: var(--ink-soft); margin: 0 0 1rem; }

  /* Hero badge — CSS medallion by default, replaced by <img> when achievement.image is set */
  .hero-badge {
    display: flex; flex-direction: column; align-items: center; gap: .5rem;
    margin: .25rem 0 2rem;
  }
  .badge-issuer, .badge-network {
    font-size: .7rem; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: var(--ink-muted);
  }
  .badge-medallion {
    width: 240px; height: 240px; border-radius: 50%;
    background:
      radial-gradient(circle at 30% 25%, rgba(255,255,255,.18), transparent 55%),
      linear-gradient(135deg, var(--accent) 0%, #0d4d40 100%);
    display: flex; align-items: center; justify-content: center;
    color: #fff; position: relative;
    box-shadow:
      0 6px 28px rgba(21,107,90,.28),
      inset 0 -2px 10px rgba(0,0,0,.18),
      inset 0 2px 4px rgba(255,255,255,.12);
  }
  .badge-medallion::before {
    content: ""; position: absolute; inset: 10px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,.22);
    pointer-events: none;
  }
  .badge-medallion::after {
    content: ""; position: absolute; inset: 18px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,.08);
    pointer-events: none;
  }
  .medallion-title {
    text-align: center; font-weight: 600; line-height: 1.18;
    padding: 0 1.6rem; letter-spacing: -.005em; max-width: 100%;
  }
  .medallion-title.title-lg { font-size: 1.25rem; }
  .medallion-title.title-md { font-size: 1.05rem; }
  .medallion-title.title-sm { font-size: .9rem; padding: 0 1.2rem; }
  .badge-image { width: 240px; height: 240px; object-fit: contain; }
  .badge-type-chip {
    display: inline-block; padding: .15rem .55rem; border-radius: 999px;
    background: var(--accent-soft); color: var(--accent);
    font-size: .68rem; font-weight: 600; letter-spacing: .12em;
    text-transform: uppercase; margin-top: .25rem;
  }

  .badges { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 1.5rem; }
  .badge {
    display: inline-block; padding: .2rem .6rem; border-radius: 999px;
    font-size: .78rem; font-weight: 500; letter-spacing: .02em;
  }
  .badge.real { background: var(--accent-soft); color: var(--accent); }
  .badge.demo { background: var(--warn-soft); color: var(--warn); }

  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 1.25rem 1.5rem; margin-bottom: 1rem;
  }
  .card h2 { margin: 0 0 .75rem; font-size: 1rem; font-weight: 600; color: var(--ink); letter-spacing: .01em; }
  .muted { color: var(--ink-muted); font-size: .9rem; }
  p { margin: .25rem 0 .75rem; }

  .kv { display: grid; grid-template-columns: 9rem 1fr; gap: .5rem 1rem; padding: .25rem 0; font-size: .9rem; }
  .kv .k { color: var(--ink-muted); }
  .kv .v { font-variant-numeric: tabular-nums; word-break: break-all; }
  code, .v code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .prereq {
    border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 6px; padding: .85rem 1rem; margin: .5rem 0;
    background: #fafcfb;
  }
  .prereq-title { font-weight: 600; margin-bottom: .35rem; font-size: .92rem; }
  details.rationale { margin-top: .5rem; }
  details.rationale summary { cursor: pointer; color: var(--ink-soft); font-size: .85rem; }
  details.rationale p { font-size: .85rem; color: var(--ink-soft); margin: .35rem 0 0; }

  .verify-output {
    background: #0e1a1f; color: #cfd9dc; padding: 1rem; border-radius: 6px;
    font-size: .8rem; overflow-x: auto; line-height: 1.5;
  }

  details.raw {
    border-top: 1px solid var(--line); margin-top: 2rem; padding-top: 1rem;
  }
  details.raw summary { cursor: pointer; color: var(--ink-muted); font-size: .85rem; }
  details.raw pre {
    background: #fafcfb; border: 1px solid var(--line); border-radius: 6px;
    padding: 1rem; font-size: .75rem; overflow-x: auto; max-height: 28rem;
  }

  footer.bot { color: var(--ink-muted); font-size: .8rem; margin-top: 2rem; text-align: center; }
</style>
</head>
<body>
<div class="page">
  <header class="top">
    <div class="brand">Andamio <span class="dot">·</span> Open Badges 3.0</div>
    <div class="network">Cardano ${escapeHtml(network)}</div>
  </header>

  <div class="hero-badge">
    ${issuerShortName ? `<div class="badge-issuer">${escapeHtml(issuerShortName)}</div>` : ""}
    ${badgeArt}
    <div class="badge-network">Cardano ${escapeHtml(network)}</div>
    <div class="badge-type-chip">${escapeHtml(credentialType)}</div>
  </div>

  <h1 class="cred-name">${escapeHtml(doc?.name ?? "Andamio Credential")}</h1>
  <h2 class="ach-name">${escapeHtml(ach?.name ?? "")}</h2>

  <div class="badges">
    ${realityBadge}
  </div>

  <section class="card">
    <div class="kv"><span class="k">Recipient</span><span class="v"><strong>${escapeHtml(recipientName)}</strong>${at?.era ? ` <span class="muted">· ${escapeHtml(at.era)}</span>` : ""}</span></div>
    <div class="kv"><span class="k">Issued by</span><span class="v">${escapeHtml(issuer?.name ?? issuer?.id ?? "—")}</span></div>
    <div class="kv"><span class="k">Date</span><span class="v">${escapeHtml(fmtDate(doc?.validFrom ?? ""))}</span></div>
  </section>

  ${doc?.description ? `<section class="card"><h2>About this credential</h2><p>${escapeHtml(doc.description)}</p></section>` : ""}

  ${ach?.criteria?.narrative ? `<section class="card"><h2>What this credential certifies</h2><p>${escapeHtml(ach.criteria.narrative)}</p></section>` : ""}

  <section class="card">
    <h2>On-chain anchor</h2>
    <p class="muted">This credential is anchored to a Cardano native-asset minting policy. The policy ID is a permanent, public identifier — anyone can verify the credential exists on-chain without trusting Andamio.</p>
    <div class="kv"><span class="k">Network</span><span class="v"><code>${escapeHtml(anchor?.network ?? "—")}</code></span></div>
    ${anchor?.policyId ? `<div class="kv"><span class="k">Policy ID</span><span class="v">${policyLink(anchor.policyId)}</span></div>` : ""}
    ${pickHash(att) ? `<div class="kv"><span class="k">${escapeHtml(hashLabel((anchor?.type ?? "").replace(/-state$/, "")))}</span><span class="v"><code>${escapeHtml(short(pickHash(att), 12, 10))}</code></span></div>` : ""}
    ${anchor?.assetFingerprint ? `<div class="kv"><span class="k">Asset</span><span class="v">${assetLink(anchor.assetFingerprint)}</span></div>` : ""}
    ${anchor?.claimTxHash ? `<div class="kv"><span class="k">Claim tx</span><span class="v">${txLink(anchor.claimTxHash)}</span></div>` : ""}
    ${anchor?.creationTxHash ? `<div class="kv"><span class="k">Creation tx</span><span class="v">${txLink(anchor.creationTxHash)}</span></div>` : ""}
  </section>

  ${requires.length > 0 ? `
  <section class="card">
    <h2>Chain-enforced prerequisites</h2>
    <p class="muted">This credential could not be issued unless the recipient already held the credentials listed below. Enforcement happens at transaction-validation time, on-chain — not in an off-chain platform database.</p>
    ${prereqHtml}
  </section>` : ""}

  ${at ? `
  <section class="card">
    <h2>Recipient's on-chain identity</h2>
    <p class="muted">Andamio Access Token V2: a paired CIP-25 NFT pattern. The user token sits in the recipient's wallet; the global state reference token holds the recipient's full credential record as on-chain data.</p>
    <div class="kv"><span class="k">Alias</span><span class="v"><code>${escapeHtml(at.alias ?? "—")}</code></span></div>
    <div class="kv"><span class="k">User token</span><span class="v"><code>${escapeHtml(at.userTokenAssetNameAscii ?? at.userTokenAssetName ?? "—")}</code></span></div>
    <div class="kv"><span class="k">Global state ref</span><span class="v"><code>${escapeHtml(at.globalStateAssetNameAscii ?? at.globalStateAssetName ?? "—")}</code></span></div>
    ${at?.globalStateUtxo ? `<div class="kv"><span class="k">Global state UTXO</span><span class="v">${txLink(at.globalStateUtxo)}</span></div>` : ""}
  </section>` : ""}

  ${verifyPanel}

  <details class="raw">
    <summary>View raw JSON-LD (Open Badges 3.0 / W3C VC 2.0)</summary>
    <pre>${escapeHtml(JSON.stringify(doc, null, 2))}</pre>
  </details>

  <footer class="bot">
    Generated by the Andamio OB 3.0 spike · <code>the ob3-prototype spike</code>
  </footer>
</div>
</body>
</html>
`;
}

async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

async function main() {
  const entries = await fs.readdir(SAMPLES_DIR);
  const jsonldFiles = entries.filter(f => f.endsWith(".jsonld"));
  if (jsonldFiles.length === 0) {
    console.error(`No .jsonld files in ${SAMPLES_DIR}`);
    process.exit(1);
  }

  // For each real-recipient sample, bake in its own verify-results-<name>.md so
  // the HTML carries the proof-of-verification alongside the credential.
  for (const file of jsonldFiles) {
    const fullPath = path.join(SAMPLES_DIR, file);
    const doc = JSON.parse(await fs.readFile(fullPath, "utf8"));
    const isReal = file.includes("real");
    const basename = file.replace(/\.jsonld$/, "");
    const perSampleResults = isReal
      ? await readIfExists(path.resolve(process.cwd(), "out", `verify-results-${basename}.md`))
      : undefined;
    const html = renderCredential({
      doc,
      isReal,
      verifyResults: perSampleResults,
    });
    const outPath = fullPath.replace(/\.jsonld$/, ".html");
    await fs.writeFile(outPath, html, "utf8");
    console.log(`  ${path.relative(process.cwd(), outPath)}`);
  }
}

main().catch(err => {
  console.error("render failed:", err);
  process.exit(1);
});
