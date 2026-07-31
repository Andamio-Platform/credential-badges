#!/usr/bin/env node
// verify-live — end-to-end verification of a DEPLOYED badge.
//
// Everything else in this repo verifies locally: `tools/*.test.ts` pin build
// artifacts against constants, and the spikes verify credentials through a
// local document loader. None of that proves the *served* stack is coherent.
// This does: it fetches the badge from production, extracts the embedded OB3
// credential, and verifies its Data Integrity proof while resolving the live
// context, the live did:web document, and the live status list over the
// network. A drifted deploy — a context served from the wrong tag, a did.json
// that no longer matches the signing key, a status bit flipped by mistake —
// fails here and nowhere else.
//
// It is deliberately NOT in tools/, which is dependency-free by design (a
// CODEOWNERS-gated, security-sensitive path that runs with no install). RDF
// canonicalization cannot be hand-rolled, so this carries the digitalbazaar
// stack and lives outside that boundary.
//
// Provenance: written 2026-07-22 as a ground-truth stand-in for the 13th
// verifybadge.org probe while that validator held a stale copy of the mutated
// v0 context (see docs/solutions/conventions/never-mutate-published-jsonld-
// context.md). That incident closed; the live check outlived it.
//
// Usage:
//   node verify-live.mjs                          # the default badge
//   node verify-live.mjs <badge-id> [<badge-id>…] # <course_id>.<slt_hash>
//   node verify-live.mjs <url> [<url>…]           # any absolute badge URL
//   node verify-live.mjs --host https://staging.example.com <badge-id>
//   node verify-live.mjs --allow-suspended <badge-id>
//
// Exit codes: 0 all verified · 1 a proof failed to verify · 2 could not get
// far enough to check (fetch/extract/key error) · 3 verified but suspended.
import * as vc from '@digitalbazaar/vc';
import { cryptosuite as eddsa2022 } from '@digitalbazaar/eddsa-rdfc-2022-cryptosuite';
import { DataIntegrityProof } from '@digitalbazaar/data-integrity';
import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import pako from 'pako';

const DEFAULT_HOST = 'https://credentials.andamio.io';
// The flagship signed badge — the one artifact every re-sign and context bump
// has been validated against, so it is the meaningful default target.
const DEFAULT_BADGE_ID =
  'ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df' +
  '.e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db';

function parseArgs(argv) {
  let host = DEFAULT_HOST;
  let allowSuspended = false;
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') host = argv[++i]?.replace(/\/$/, '');
    else if (a === '--allow-suspended') allowSuspended = true;
    else if (a === '-h' || a === '--help') return { help: true };
    else if (a.startsWith('-')) throw new Error(`unknown flag ${a}`);
    else targets.push(a);
  }
  if (!host) throw new Error('--host needs a value');
  if (!targets.length) targets.push(DEFAULT_BADGE_ID);
  // A bare badge_id resolves against the host; anything absolute is used as-is,
  // so a one-off artifact (a re-baked SVG on a preview URL) can be checked too.
  const urls = targets.map((t) =>
    /^https?:\/\//.test(t) ? t : `${host}/badges/${t}${t.endsWith('.svg') ? '' : '.svg'}`
  );
  return { urls, allowSuspended };
}

// One cache per badge, never across badges: two badges must not silently share
// a context or did.json copy, since divergence between them is exactly the
// class of drift this check exists to catch.
function makeLoader() {
  const cache = new Map();
  const fetchDoc = async (url) => {
    if (cache.has(url)) return cache.get(url);
    // no-store throughout: a cached context is how the 2026-07-22 incident
    // stayed invisible for ~38h. This check is worthless if it reads a cache.
    const r = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/ld+json, application/json, */*' },
    });
    if (!r.ok) throw new Error(`load ${url} -> ${r.status}`);
    const d = await r.json();
    cache.set(url, d);
    return d;
  };
  return async function documentLoader(url) {
    if (url.startsWith('did:web:')) {
      const base = url.split('#')[0];
      const parts = base.slice('did:web:'.length).split(':').map(decodeURIComponent);
      const host = parts.shift();
      const path = parts.length ? `/${parts.join('/')}/did.json` : '/.well-known/did.json';
      const didDoc = await fetchDoc(`https://${host}${path}`);
      if (url.includes('#')) {
        // Dereference the fragment to the specific verificationMethod node.
        const node = (didDoc.verificationMethod || []).find((v) => v.id === url);
        if (node) {
          const document = { '@context': 'https://w3id.org/security/multikey/v1', ...node };
          return { contextUrl: null, documentUrl: url, document };
        }
      }
      return { contextUrl: null, documentUrl: url, document: didDoc };
    }
    return { contextUrl: null, documentUrl: url, document: await fetchDoc(url) };
  };
}

async function verifyBadge(badgeUrl) {
  const documentLoader = makeLoader();

  const res = await fetch(badgeUrl, { cache: 'no-store' });
  if (!res.ok) return { badge: badgeUrl, ok: false, stage: 'fetch', error: `HTTP ${res.status}` };
  const svg = await res.text();

  // OB 3.0 §5.3.2.1: an embedded Data Integrity proof rides in the CDATA body
  // of <openbadges:credential> (no verify= attribute — that is VC-JWT only).
  const cdatas = [...svg.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map((m) => m[1].trim());
  let credential = null;
  for (const c of cdatas) {
    try {
      const o = JSON.parse(c);
      if (o.proof) { credential = o; break; }
    } catch {}
  }
  if (!credential) {
    return { badge: badgeUrl, ok: false, stage: 'extract', error: 'no signed credential in badge' };
  }

  // Real status check: fetch the live BitstringStatusList credential, gunzip
  // the multibase-encoded bitstring, read this credential's bit. A stubbed
  // "status ok" would defeat the point — the kill-switch must be observable.
  let statusInfo = {};
  async function checkStatus({ credential }) {
    const entry = Array.isArray(credential.credentialStatus)
      ? credential.credentialStatus[0]
      : credential.credentialStatus;
    const slc = (await documentLoader(entry.statusListCredential)).document;
    const encoded = slc.credentialSubject.encodedList;
    const b64 = encoded.startsWith('u') ? encoded.slice(1) : encoded; // multibase base64url-no-pad
    const bytes = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const bits = pako.ungzip(bytes);
    const idx = parseInt(entry.statusListIndex, 10);
    const bit = (bits[Math.floor(idx / 8)] >> (7 - (idx % 8))) & 1;
    statusInfo = { statusPurpose: entry.statusPurpose, statusListIndex: idx, bitSet: !!bit };
    // The bit is a suspension signal, not a proof failure — reported separately.
    return { verified: true, results: [{ verified: true, status: !!bit }] };
  }

  const proof = Array.isArray(credential.proof) ? credential.proof[0] : credential.proof;
  const vm = proof.verificationMethod;
  const didDoc = (await documentLoader(vm.split('#')[0])).document;
  const vmEntry =
    (didDoc.verificationMethod || []).find((v) => v.id === vm) ||
    (didDoc.assertionMethod || []).find((v) => v?.id === vm);
  if (!vmEntry) {
    return { badge: badgeUrl, ok: false, stage: 'key', error: `vm ${vm} not in did.json` };
  }

  const key = await Ed25519Multikey.from(vmEntry);
  const suite = new DataIntegrityProof({ cryptosuite: eddsa2022, verificationMethod: vm });
  suite.verificationMethod = vm;
  suite.key = key;
  suite.verifier = () => key.verifier();

  const result = await vc.verifyCredential({ credential, suite, documentLoader, checkStatus });

  return {
    badge: badgeUrl,
    ok: result.verified === true,
    verified: result.verified,
    proof_cryptosuite: proof.cryptosuite,
    verificationMethod: vm,
    context: credential['@context'],
    status: statusInfo,
    suspended: statusInfo.bitSet === true,
    error: result.verified
      ? null
      : String(result.error?.errors?.[0]?.message || result.error?.message || result.error),
  };
}

const HELP = `verify-live — verify a DEPLOYED badge end-to-end against live endpoints.

  node verify-live.mjs [--host <origin>] [--allow-suspended] [<badge-id|url>…]

Defaults to the flagship badge on ${DEFAULT_HOST}.
Exit: 0 verified · 1 proof failed · 2 could not check · 3 suspended.`;

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(2);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const results = [];
for (const url of opts.urls) {
  try {
    results.push(await verifyBadge(url));
  } catch (e) {
    results.push({ badge: url, ok: false, stage: 'error', error: String(e?.message || e) });
  }
}

console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));

// Fail loud and specifically: an un-checkable badge is not a pass, and a
// suspended one is a distinct outcome from a broken proof.
if (results.some((r) => r.stage)) process.exit(2);
if (results.some((r) => !r.ok)) process.exit(1);
if (!opts.allowSuspended && results.some((r) => r.suspended)) process.exit(3);
process.exit(0);
