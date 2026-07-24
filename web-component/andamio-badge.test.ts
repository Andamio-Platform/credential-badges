// Tests for the andamio-badge web component (andamio-badge.js, #74).
//
// Exercises the pure render core with no DOM: attribute reading, model
// validation/URL computation, the baked-aware state gate (no overclaim), and
// escaping of hostile attribute values. The custom-element registration is thin
// and browser-guarded, so it isn't exercised here (mirrors the #73 split).
//
// Run: node --experimental-strip-types --test web-component/andamio-badge.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeModel, renderMarkup, readAttrs, esc, DEFAULT_HOST } from "./andamio-badge.js";

const STEM = "ae192632aabe00ed2042eaef596bc15f3887fa32e75e8f9b8fa516df"
  + ".e9b5343186f83ed804a9fd87293a7378e3b237743b76d56da73b111d855631db";

test("badgeModel computes URLs from stem + default host", () => {
  const m = badgeModel({ stem: STEM, moduleTitle: "Find a bug", courseTitle: "Cardano XP" });
  assert.equal(m.valid, true);
  assert.equal(m.host, DEFAULT_HOST);
  assert.equal(m.imgUrl, `${DEFAULT_HOST}/badges/${STEM}.svg`);
  assert.equal(m.pageUrl, `${DEFAULT_HOST}/badges/${STEM}`);
  assert.equal(m.moduleTitle, "Find a bug");
  assert.equal(m.courseTitle, "Cardano XP");
});

test("badgeModel honors a valid https host override", () => {
  const m = badgeModel({ stem: STEM, host: "https://staging.andamio.io" });
  assert.equal(m.host, "https://staging.andamio.io");
  assert.equal(m.pageUrl, `https://staging.andamio.io/badges/${STEM}`);
});

test("badgeModel rejects a non-https / injection host and falls back to default", () => {
  for (const bad of ["javascript:alert(1)", "http://evil.test", "https://x.io/path", "\" onmouseover=x"]) {
    const m = badgeModel({ stem: STEM, host: bad });
    assert.equal(m.host, DEFAULT_HOST, `host ${bad} should fall back to default`);
  }
});

test("badgeModel invalidates a malformed stem (inert, never a broken card)", () => {
  for (const bad of ["", "tooshort", STEM + "x", "../../etc", "ae19.zz"]) {
    assert.equal(badgeModel({ stem: bad }).valid, false, `stem ${bad} should be invalid`);
  }
});

test("state label is baked-aware and never overclaims (KTD-4)", () => {
  const signed = badgeModel({ stem: STEM, signed: true });
  assert.equal(signed.stateLabel, "Signed & verifiable");
  const unsigned = badgeModel({ stem: STEM, signed: false });
  assert.equal(unsigned.stateLabel, "Anchored on-chain");
  // The unsigned note must NOT assert a signature exists.
  assert.ok(!/sign/i.test(unsigned.stateNote), "unsigned note must not claim a signature");
});

test("renderMarkup renders the card: image, titles, link-back", () => {
  const html = renderMarkup(badgeModel({ stem: STEM, moduleTitle: "Find a bug", courseTitle: "Cardano XP" }));
  assert.ok(html.includes(`src="${DEFAULT_HOST}/badges/${STEM}.svg"`), "badge image");
  assert.ok(html.includes(`href="${DEFAULT_HOST}/badges/${STEM}"`), "link back to the display page");
  assert.ok(html.includes("Find a bug") && html.includes("Cardano XP"), "titles");
  assert.ok(html.includes("View credential"), "call to action");
});

test("renderMarkup uses the DI-capable phrasing for signed, never 'any OB3 verifier'", () => {
  const signed = renderMarkup(badgeModel({ stem: STEM, signed: true }));
  assert.ok(signed.includes("DI-capable OB 3.0 / VC verifier"), "names the verifier class");
  assert.ok(!signed.includes("any OB3 verifier"), "never the overclaiming phrase");
  const unsigned = renderMarkup(badgeModel({ stem: STEM, signed: false }));
  assert.ok(unsigned.includes("Anchored on-chain") && !/Signed &amp; verifiable/.test(unsigned),
    "unsigned card does not display a signed state");
});

test("renderMarkup escapes hostile title/attribute values (no shadow-tree breakout)", () => {
  const html = renderMarkup(badgeModel({
    stem: STEM,
    moduleTitle: `<img src=x onerror=alert(1)>`,
    courseTitle: `" onmouseover="alert(2)`,
  }));
  assert.ok(!html.includes("<img src=x onerror"), "raw injected img must not appear");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "title is escaped as text");
  assert.ok(!html.includes(`" onmouseover="alert(2)`), "attribute-breaking value neutralized");
});

test("renderMarkup on an invalid model is an inert placeholder (no img, no link)", () => {
  const html = renderMarkup(badgeModel({ stem: "bad" }));
  assert.ok(html.includes("Invalid andamio-badge"), "placeholder text");
  assert.ok(!html.includes("<img"), "no image");
  assert.ok(!html.includes("/badges/"), "no credential link");
});

test("esc neutralizes the five HTML-significant characters", () => {
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("readAttrs reads element attributes incl. the boolean `signed`", () => {
  const store: Record<string, string> = { stem: STEM, "module-title": "M", "course-title": "C" };
  const el = {
    getAttribute: (n: string) => store[n] ?? null,
    hasAttribute: (n: string) => n in store,
  };
  const a = readAttrs(el as any);
  assert.equal(a.stem, STEM);
  assert.equal(a.moduleTitle, "M");
  assert.equal(a.signed, false, "no signed attribute -> not signed");
  const el2 = { ...el, hasAttribute: (n: string) => n === "signed" || n in store };
  assert.equal(readAttrs(el2 as any).signed, true, "presence of signed -> signed");
});
