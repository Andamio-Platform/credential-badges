const PALETTES = [
  {slug:"01-andamio-navy",   name:"Andamio Navy",   deep:"#0C1325", ink:"#121A2D", raised:"#1B2540", prim:"#EE6C3A", prim_lt:"#F6A07A", sec:"#5BB8D4", sec_lt:"#9ED8E8", bone:"#EAE6DD", slate:"#6E7A98", hair:"#2C3858"},
  {slug:"02-cardano-blue",   name:"Cardano Blue",   deep:"#091022", ink:"#0F1A33", raised:"#172742", prim:"#3B82F0", prim_lt:"#86B4F7", sec:"#33D6C4", sec_lt:"#8FE9DF", bone:"#E9EDF5", slate:"#6E7E9C", hair:"#26324E"},
  {slug:"03-indigo-violet",  name:"Indigo Violet",  deep:"#0E0A1F", ink:"#15112B", raised:"#201A3C", prim:"#8B6CF0", prim_lt:"#B9A6F7", sec:"#E86CA8", sec_lt:"#F2A6CC", bone:"#ECE7F2", slate:"#7A7196", hair:"#2E2A4A"},
  {slug:"04-pine-gold",      name:"Pine Gold",      deep:"#08140F", ink:"#0E1E18", raised:"#163026", prim:"#E9B23C", prim_lt:"#F3CE80", sec:"#46D6A0", sec_lt:"#92E8C6", bone:"#E7EDE6", slate:"#6E8478", hair:"#244236"},
  {slug:"05-wine-crimson",   name:"Wine Crimson",   deep:"#170A12", ink:"#22101B", raised:"#341A29", prim:"#F0524D", prim_lt:"#F59390", sec:"#F2A0B5", sec_lt:"#F7C4D2", bone:"#F2E7EA", slate:"#9A7E86", hair:"#3A2230"},
  {slug:"06-mono-ember",     name:"Mono Ember",     deep:"#0C1020", ink:"#121826", raised:"#1B2334", prim:"#EE6C3A", prim_lt:"#F6A07A", sec:"#F0A24A", sec_lt:"#F7C98A", bone:"#EAE6DD", slate:"#7A8092", hair:"#2C3344"},
  {slug:"07-teal-ice",       name:"Teal Ice",       deep:"#08151C", ink:"#0E2029", raised:"#163039", prim:"#5FD0E8", prim_lt:"#A6E6F2", sec:"#7FA8C8", sec_lt:"#B4CBE0", bone:"#E6EEF0", slate:"#6E8490", hair:"#23404A"},
  {slug:"08-plum-sunset",    name:"Plum Sunset",    deep:"#14091C", ink:"#1E1029", raised:"#2E1A3C", prim:"#F58A3C", prim_lt:"#F8B580", sec:"#C56CE0", sec_lt:"#DEA6EE", bone:"#F0E8F2", slate:"#86749A", hair:"#3A2A4A"},
  {slug:"09-onyx-emerald",   name:"Onyx Emerald",   deep:"#0A0D0B", ink:"#101310", raised:"#1A201A", prim:"#E7C24A", prim_lt:"#F1D98A", sec:"#3FB985", sec_lt:"#86D6B4", bone:"#ECEAE0", slate:"#7E8478", hair:"#2A332A"},
  {slug:"10-graphite-electric", name:"Graphite Electric", deep:"#0C0E12", ink:"#14171C", raised:"#1E232A", prim:"#FF6B4A", prim_lt:"#FF9E86", sec:"#34E0D0", sec_lt:"#86EFE4", bone:"#ECEEF0", slate:"#7A828E", hair:"#2A2F38"}
];

const BASE = ["deep","ink","raised","prim","prim_lt","sec","sec_lt","bone","slate","hair"];
const INT = ["core1","core2","itext","imuted","iline","extlabel","slt_label","ev_label","ctitle","mtitle"];
const ALLTOKENS = [...BASE, ...INT];

const CX = 512;
const CY = 512;

function fillDefaults(pal) {
  const P = { ...pal };
  P.core1 = P.core1 || P.raised;
  P.core2 = P.core2 || P.ink;
  P.itext = P.itext || P.bone;
  P.imuted = P.imuted || P.slate;
  P.iline = P.iline || P.hair;
  P.extlabel = P.extlabel || P.slate;
  P.slt_label = P.slt_label || P.prim_lt;
  P.ev_label = P.ev_label || P.sec_lt;
  P.ctitle = P.ctitle || P.itext;
  P.mtitle = P.mtitle || P.itext;
  return P;
}

function mixColor(hexc, toward, t) {
  const a = hexc.replace('#', '');
  const b = toward.replace('#', '');
  const r = [parseInt(a.substr(0, 2), 16), parseInt(a.substr(2, 2), 16), parseInt(a.substr(4, 2), 16)];
  const s = [parseInt(b.substr(0, 2), 16), parseInt(b.substr(2, 2), 16), parseInt(b.substr(4, 2), 16)];
  const m = r.map((c, i) => Math.round(c + (s[i] - c) * t));
  return `#${m.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function lightInterior(pal) {
  const p = { ...pal };
  p.core1 = "#FFFFFF";
  p.core2 = mixColor("#FFFFFF", pal.prim, 0.08);
  p.itext = "#15203A";
  p.imuted = "#5C6680";
  p.iline = "#E5E9F0";
  p.ctitle = mixColor(pal.prim, "#0C0F17", 0.64);
  p.mtitle = mixColor(pal.sec, "#0C0F17", 0.64);
  p.slt_label = pal.sec;
  p.ev_label = pal.sec;
  return p;
}

function ringTicks(R, hexstr, color, hair) {
  // Ensure hexstr is even length and has bytes
  if (!hexstr || hexstr.length % 2 !== 0) return { lit: [], dim: [] };
  
  const bytes = [];
  for (let i = 0; i < hexstr.length; i += 2) {
    bytes.push(parseInt(hexstr.substr(i, 2), 16));
  }
  
  if (bytes.length === 0) return { lit: [], dim: [] };

  const gs = 360.0 / bytes.length;
  const lead = (gs - 8.0) / 2.0;
  const lit = [];
  const dim = [];

  for (let bi = 0; bi < bytes.length; bi++) {
    const bv = bytes[bi];
    const g0 = -90.0 + bi * gs;
    for (let k = 0; k < 8; k++) {
      const bit = (bv >> (7 - k)) & 1;
      const msb = (k === 0);
      const a = (g0 + lead + (k + 0.5)) * (Math.PI / 180.0);
      const c = Math.cos(a);
      const s = Math.sin(a);

      if (bit) {
        const L = msb ? 18 : 13;
        const w = msb ? 3.4 : 2.6;
        const r0 = R - L / 2.0;
        const r1 = R + L / 2.0;
        lit.push(`<line x1="${(CX + r0 * c).toFixed(2)}" y1="${(CY + r0 * s).toFixed(2)}" x2="${(CX + r1 * c).toFixed(2)}" y2="${(CY + r1 * s).toFixed(2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`);
      } else {
        const L = msb ? 8 : 5;
        const r0 = R - L / 2.0;
        const r1 = R + L / 2.0;
        dim.push(`<line x1="${(CX + r0 * c).toFixed(2)}" y1="${(CY + r0 * s).toFixed(2)}" x2="${(CX + r1 * c).toFixed(2)}" y2="${(CY + r1 * s).toFixed(2)}" stroke="${hair}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`);
      }
    }
  }
  return { lit, dim };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrap2(text) {
  const mid = Math.floor(text.length / 2);
  let l = text.lastIndexOf(" ", mid - 1);
  let r = text.indexOf(" ", mid);
  if (l < 0 && r < 0) return [text];
  
  let cut;
  if (l < 0) cut = r;
  else if (r < 0) cut = l;
  else cut = (mid - l <= r - mid) ? l : r;
  
  return [text.substring(0, cut).trim(), text.substring(cut).trim()];
}

function layTitle(text, baseSize, maxw, factor, minOne, floor = 15) {
  const n = Math.max(text.length, 1);
  const one = Math.min(baseSize, Math.floor(maxw / (factor * n)));
  if (one >= minOne || !text.includes(" ")) {
    return { lines: [text], size: Math.max(one, floor) };
  }
  const lines = wrap2(text);
  if (lines.length === 1) {
    return { lines, size: Math.max(one, floor) };
  }
  const longest = Math.max(...lines.map(l => l.length));
  return { lines, size: Math.max(Math.min(baseSize, Math.floor(maxw / (factor * longest))), floor) };
}

function renderSvg({ courseTitle, moduleTitle, courseId, sltHash, network, palId, isLight }) {
  let pal = PALETTES.find(p => p.slug === palId) || PALETTES[0];
  if (isLight) pal = lightInterior(pal);
  
  const P = fillDefaults(pal);
  const c = (k) => `var(--${k}, ${P[k]})`;

  const R_OUT = 472;
  const R_IN = 440;

  // Clean hex strings
  const cleanCourseId = courseId.replace(/[^0-9a-fA-F]/g, '');
  const cleanSltHash = sltHash.replace(/[^0-9a-fA-F]/g, '');

  const { lit: lit_o, dim: dim_o } = ringTicks(R_OUT, cleanCourseId, c("prim"), c("hair"));
  const { lit: lit_i, dim: dim_i } = ringTicks(R_IN, cleanSltHash, c("sec"), c("hair"));

  const varStyle = ALLTOKENS.map(k => `--${k}:${P[k]};`).join('');

  const FONT_FACE = "@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Spline+Sans+Mono:wght@400;500;600&display=swap');";

  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" style="${varStyle}" aria-label="Andamio credential — ${escapeHtml(moduleTitle)} (${escapeHtml(courseTitle)})">`);
  
  p.push(`<defs>
    <style>${FONT_FACE} .sans{font-family:"Archivo",sans-serif;}.mono{font-family:"Spline Sans Mono",monospace;}</style>
    <radialGradient id="field" cx="50%" cy="44%" r="62%"><stop offset="0%" stop-color="${c("raised")}"/><stop offset="70%" stop-color="${c("ink")}"/><stop offset="100%" stop-color="${c("deep")}"/></radialGradient>
    <linearGradient id="core" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c("core1")}"/><stop offset="100%" stop-color="${c("core2")}"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`);

  p.push(`<circle cx="${CX}" cy="${CY}" r="500" fill="url(#field)" stroke="${c("hair")}" stroke-width="2"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="488" fill="none" stroke="${c("hair")}" stroke-width="1.25" opacity="0.7"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="${R_IN}" fill="none" stroke="${c("sec")}" stroke-width="1" opacity="0.16"/>`);
  p.push(`<g>${dim_o.join('')}${dim_i.join('')}</g>`);
  p.push(`<g filter="url(#glow)">${lit_i.join('')}${lit_o.join('')}</g>`);
  
  p.push(`<path d="M ${CX} ${CY - R_OUT - 19} l 6 -11 l -12 0 z" fill="${c("prim")}" opacity="0.85"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="424" fill="none" stroke="${c("hair")}" stroke-width="1.25" opacity="0.55"/>`);
  p.push(`<circle cx="${CX}" cy="${CY}" r="412" fill="url(#core)" stroke="${c("hair")}" stroke-width="1.5"/>`);

  const T = (y, s, size, fill, cls = "mono", w = null, ls = null) => {
    let a = `<text class="${cls}" x="${CX}" y="${y}" text-anchor="middle" font-size="${size}" fill="${fill}"`;
    if (w) a += ` font-weight="${w}"`;
    if (ls !== null) a += ` letter-spacing="${ls}"`;
    return a + `>${s}</text>`;
  };

  const items = [];
  let curRelY = 0.0;
  const emit = (fn, advance) => {
    items.push({ rel: curRelY, fn });
    curRelY += advance;
  };
  const textFn = (s, size, fill, cls, w = null, ls = null) => {
    return (y) => p.push(T(y, s, size, fill, cls, w, ls));
  };

  const cTitle = layTitle(courseTitle, 34, 500, 0.54, 24);
  const mTitle = layTitle(moduleTitle, 60, 520, 0.58, 40);
  const EG = 18;

  emit(textFn("COURSE", 11, c("imuted"), "mono", null, 4), Math.floor(EG + cTitle.size * 0.72));
  cTitle.lines.forEach(ln => emit(textFn(escapeHtml(ln), cTitle.size, c("ctitle"), "sans", 600, null), Math.floor(cTitle.size * 1.12)));
  curRelY += 22;
  emit(textFn("MODULE", 11, c("imuted"), "mono", null, 4), Math.floor(EG + mTitle.size * 0.72));
  mTitle.lines.forEach(ln => emit(textFn(escapeHtml(ln), mTitle.size, c("mtitle"), "sans", 800, null), Math.floor(mTitle.size * 1.06)));
  curRelY += 40;
  
  const divRel = curRelY;
  curRelY += 54;
  emit(textFn("COURSE_ID", 11, c("ctitle"), "mono", null, 3), 24);
  emit(textFn(cleanCourseId.padEnd(56, '0').slice(0, 56), 15, c("itext"), "mono", null, 0), 42);
  emit(textFn("SLT_HASH", 11, c("mtitle"), "mono", null, 3), 24);
  emit(textFn(cleanSltHash.padEnd(64, '0').slice(0, 64), 13, c("itext"), "mono", null, 0), 0);

  const start = 532 - curRelY / 2.0;
  items.forEach(item => item.fn(start + item.rel));

  const dy = start + divRel;
  p.push(`<line x1="${CX - 150}" y1="${dy.toFixed(1)}" x2="${CX + 150}" y2="${dy.toFixed(1)}" stroke="${c("iline")}" stroke-width="1.25"/>`);
  p.push(T(884, "ANDAMIO", 9, c("imuted"), "sans", 600, 6));

  p.push('</svg>');
  return p.join('');
}

window.renderSvg = renderSvg;
window.PALETTES = PALETTES;
