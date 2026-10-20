// SEARCH AND SHARING, READ FROM OUTSIDE (R42 — the standards' "Search and sharing", lib/seo).
//
// What a search engine and a share card read of the site, judged the way they read it: the page as the server sends it,
// before any script runs. One judge for two places:
//   · scripts/smoke.ui.mjs runs it against the build it has just started — no database, so the menu is the code list's
//     stand-in and no lesson is listed, and a lesson's page can't ask whether it is public (it must not say noindex then);
//   · scripts/verify.prod.mjs runs it against production after a push — the Catalog's menu, the lessons anyone may read.
// scripts/r42.test.mjs runs it against a stand-in site, right and then wrong in each way it checks: a judge that can't
// fail is a failing test.
//
// It asks as a share card does (SHARE_UA, a crawler that reads no script): Next sends such a reader every tag in the
// page's head, where a browser may get a slow page's tags later, in its body.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url);

// ── the real TypeScript, compiled (lib/seo, lib/drinks) ───────────────────────────────────────────────────────────────
let ts = null;
const loaded = new Map();
export function loadTs(rel) {
  if (loaded.has(rel)) return loaded.get(rel).exports;
  ts ??= require("typescript");
  const mod = { exports: {} };
  loaded.set(rel, mod);
  const out = ts.transpileModule(readFileSync(new URL(rel, ROOT), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const dir = rel.slice(0, rel.lastIndexOf("/") + 1);
  new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
    if (spec.startsWith("./")) return loadTs(`${dir}${spec.slice(2)}.ts`);
    throw new Error(`search.read: ${rel} imports ${spec}, which this loader doesn't follow`);
  });
  return mod.exports;
}

// ── a page's head, as a reader that runs no script sees it ────────────────────────────────────────────────────────────
const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export const unescapeHtml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITY[e.toLowerCase()] ?? m);
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), unescapeHtml(m[2])]));
const words = (s) => unescapeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function readHead(html) {
  // Every script but structured data goes first: the page's data repeats each tag inside them, as text.
  const doc = String(html).replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "");
  const end = doc.search(/<\/head>/i);
  const head = end > 0 ? doc.slice(0, end) : doc;
  const metas = [...doc.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const links = [...doc.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const jsonld = [...doc.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return { "@invalid": m[1].slice(0, 80) }; } });
  const rows = doc.split(/data-drink-row="/).slice(1).map((chunk) => ({
    name: words((chunk.match(/class="entry-name">([\s\S]*?)<\/span>/) || [])[1] || ""),
    price: ((chunk.match(/\$(\d+(?:\.\d{2})?)/) || [])[1]) ?? null,
  }));
  return {
    titles: [...head.matchAll(/<title>([\s\S]*?)<\/title>/gi)].map((m) => unescapeHtml(m[1]).trim()),
    meta: (key) => metas.filter((a) => a.name === key || a.property === key).map((a) => a.content ?? ""),
    canonical: links.filter((l) => (l.rel || "").toLowerCase() === "canonical").map((l) => l.href || ""),
    jsonld,
    h1: [...doc.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => words(m[1])),
    rows,
  };
}

/** The width and height a PNG says it is (its IHDR), or null. */
export function pngSize(buf) {
  const b = Buffer.from(buf);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Dollars as the menu prints them ("$10", "$10.50") and as structured data says them ("10.00"), in cents. No price and
 *  a price of nothing are one: structured data names no offer for a drink at $0 (lib/seo menuJsonLd). */
const cents = (s) => (s === null || s === undefined || s === "" ? 0 : Math.round(parseFloat(String(s)) * 100) || 0);

export const SHARE_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

// ── THE JUDGE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// `ok(name, pass, detail)` is the caller's (each script prints its own way). `production`: the live site — a database
// behind it, lessons listed, the menu the Catalog's. `get` is fetch, or a stand-in's.
export async function judgeSite(base, { ok, production = false, get = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  const seo = loadTs("lib/seo.ts");
  const { SITE, SITE_NAME, PUBLIC_PAGES, CANONICAL_OF, SITEMAP_PATHS, SHARE_IMAGE, HOME_DESCRIPTION, FRONT_DOOR, absolute } = seo;
  const root = String(base).replace(/\/$/, "");
  const ask = async (path, ua = SHARE_UA) => {
    try {
      const r = await get(root + path, { headers: { "user-agent": ua, "cache-control": "no-cache" }, redirect: "manual", signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get("content-type") || "", robots: r.headers.get("x-robots-tag") || "", buf, text: buf.toString("utf8") };
    } catch (e) {
      return { status: 0, type: "", robots: "", buf: Buffer.alloc(0), text: "", error: String(e?.message || e).slice(0, 80) };
    }
  };
  const said = (r) => (r.status ? `HTTP ${r.status}` : r.error || "no answer");
  const image = absolute(SHARE_IMAGE.url);
  const business = (h) => h.jsonld.filter((d) => d && d["@type"] === "FoodEstablishment" && d.url === SITE);

  // 1 · robots.txt: everything may be read, and the sitemap is named.
  {
    const r = await ask("/robots.txt");
    const lines = r.text.split(/\r?\n/).map((l) => l.trim());
    const blocksAll = lines.some((l) => /^disallow:\s*\/\s*$/i.test(l));
    ok("found: /robots.txt lets every crawler read every page and names the sitemap",
      r.status === 200 && /text\/plain/.test(r.type) && lines.some((l) => /^user-agent:\s*\*$/i.test(l)) && lines.some((l) => /^allow:\s*\/$/i.test(l))
        && !blocksAll && lines.includes(`Sitemap: ${SITE}/sitemap.xml`),
      r.status !== 200 ? said(r) : blocksAll ? "a Disallow: / keeps every page out" : r.text.slice(0, 160).replace(/\n/g, " ⏎ "));
  }

  // 2 · sitemap.xml: every public page at its canonical address, once; nothing else but lessons.
  let lessons = [];
  {
    const r = await ask("/sitemap.xml");
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => unescapeHtml(m[1]).trim());
    const pages = SITEMAP_PATHS.map(absolute);
    const missing = pages.filter((u) => !locs.includes(u));
    const strays = locs.filter((u) => !pages.includes(u) && !new RegExp(`^${SITE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/primal/l/[^/]+$`).test(u));
    const twice = locs.filter((u, i) => locs.indexOf(u) !== i);
    lessons = locs.filter((u) => !pages.includes(u) && !strays.includes(u));
    ok(`found: /sitemap.xml lists the ${pages.length} public pages at their canonical addresses${production ? ` and ${lessons.length} lesson(s)` : ", and no lesson without a database"}`,
      r.status === 200 && /xml/.test(r.type) && !missing.length && !strays.length && !twice.length && (production || !lessons.length),
      r.status !== 200 ? said(r) : [missing.length && `missing ${missing.join(", ")}`, strays.length && `not a public page: ${strays.join(", ")}`,
        twice.length && `twice: ${twice.join(", ")}`, !production && lessons.length && `lessons with no database: ${lessons.join(", ")}`].filter(Boolean).join(" | "));
  }

  // 3 · every public page: its title, its own description, its canonical address, the share card, one heading, the business.
  for (const path of Object.keys(PUBLIC_PAGES)) {
    const r = await ask(path);
    if (r.status !== 200) { ok(`found: ${path} answers its page`, false, said(r)); continue; }
    const h = readHead(r.text);
    const want = { description: PUBLIC_PAGES[path], canonical: absolute(CANONICAL_OF[path] ?? path) };
    const title = h.titles[0] || "";
    const problems = [];
    if (h.titles.length !== 1 || !title.endsWith(` — ${SITE_NAME}`)) problems.push(`title ${JSON.stringify(h.titles)}`);
    if (h.meta("description").length !== 1 || h.meta("description")[0] !== want.description) problems.push(`description ${JSON.stringify(h.meta("description"))}`);
    if (h.canonical.length !== 1 || h.canonical[0] !== want.canonical) problems.push(`canonical ${JSON.stringify(h.canonical)} (want ${want.canonical})`);
    if (h.meta("robots").some((v) => /noindex/i.test(v)) || /noindex/i.test(r.robots)) problems.push(`robots ${h.meta("robots")} ${r.robots}`.trim());
    const og = (k) => h.meta(`og:${k}`)[0];
    if (og("title") !== title || og("description") !== want.description || og("url") !== want.canonical) problems.push(`og title/description/url ${JSON.stringify([og("title"), og("url")])}`);
    if (og("image") !== image || og("image:width") !== String(SHARE_IMAGE.width) || og("image:height") !== String(SHARE_IMAGE.height)) problems.push(`og:image ${og("image")} ${og("image:width")}×${og("image:height")}`);
    if (og("type") !== "website" || og("site_name") !== SITE_NAME) problems.push(`og:type ${og("type")}, og:site_name ${og("site_name")}`);
    if (h.meta("twitter:card")[0] !== "summary_large_image" || h.meta("twitter:title")[0] !== title || h.meta("twitter:image")[0] !== image) problems.push(`twitter ${JSON.stringify([h.meta("twitter:card")[0], h.meta("twitter:image")[0]])}`);
    if (h.h1.length !== 1 || !/[a-z0-9]/i.test(h.h1[0] || "")) problems.push(`h1 ${JSON.stringify(h.h1)}`);
    if (business(h).length !== 1) problems.push(`business structured data ×${business(h).length}`);
    ok(`found: ${path} — "${title}", its own description, canonical ${want.canonical.slice(SITE.length) || "/"}, the share card, one heading, the business`, problems.length === 0, problems.join(" | "));
  }

  // 4 · the front door: the house description and card, no address of its own, never noindex — a guest is sent on.
  {
    const r = await ask(FRONT_DOOR);
    const h = readHead(r.text);
    ok("found: / keeps the house description and share card, names no canonical address, and is never noindex",
      r.status === 200 && h.meta("description")[0] === HOME_DESCRIPTION && h.canonical.length === 0 && !h.meta("og:url").length
        && h.meta("og:image")[0] === image && !h.meta("robots").some((v) => /noindex/i.test(v)) && !/noindex/i.test(r.robots) && business(h).length === 1,
      r.status !== 200 ? said(r) : JSON.stringify({ description: h.meta("description")[0], canonical: h.canonical, ogUrl: h.meta("og:url"), robots: h.meta("robots") }));
  }

  // 5 · the pages that aren't public: noindex, no canonical address, no card address.
  for (const path of ["/crew", "/order", "/office", "/academy", "/c/R42-NOT-A-CODE"]) {
    const r = await ask(path);
    const h = readHead(r.text);
    ok(`found: ${path} is kept out of search — noindex, and no canonical address`,
      r.status === 200 && h.meta("robots").some((v) => /noindex/i.test(v)) && h.canonical.length === 0 && !h.meta("og:url").length,
      r.status !== 200 ? said(r) : JSON.stringify({ robots: h.meta("robots"), canonical: h.canonical, ogUrl: h.meta("og:url") }));
  }

  // 6 · a lesson: listed ones name themselves; one nobody may read says noindex — and with no database, neither.
  // Both are judged twice before they fail: a lesson's read has three seconds, and the sitemap is remade on a visit after
  // its hour (served the old one meanwhile), so a lesson unpublished since may still be listed — asked again, it isn't.
  if (production) {
    const named = async (url) => {
      const r = await ask(url.slice(SITE.length));
      const h = readHead(r.text);
      const pass = r.status === 200 && h.canonical[0] === url && !h.meta("robots").some((v) => /noindex/i.test(v)) && !/noindex/i.test(r.robots) && !!h.meta("description")[0]
        && h.meta("og:url")[0] === url && h.meta("og:type")[0] === "article" && !/^GT3 Nutrition — /.test(h.titles[0] || "");
      return { pass, detail: r.status !== 200 ? said(r) : JSON.stringify({ title: h.titles[0], canonical: h.canonical, robots: h.meta("robots") }) };
    };
    for (const url of lessons.slice(0, 3)) {
      let v = await named(url);
      if (!v.pass) {
        await wait(8_000);
        const again = await ask("/sitemap.xml");
        if (!again.text.includes(`<loc>${url}</loc>`)) { log(`  · found: ${url.slice(SITE.length)} is no longer listed (the sitemap was a stale copy) — not judged`); continue; }
        v = await named(url);
      }
      ok(`found: the listed lesson ${url.slice(SITE.length)} names itself, its one-liner and its address`, v.pass, v.detail);
    }
    const kept = async () => {
      const r = await ask("/primal/l/r42-no-such-lesson");
      const h = readHead(r.text);
      return { pass: r.status === 200 && h.meta("robots").some((v) => /noindex/i.test(v)) && h.canonical.length === 0, detail: r.status !== 200 ? said(r) : JSON.stringify({ robots: h.meta("robots"), canonical: h.canonical }) };
    };
    let k = await kept();
    if (!k.pass) { await wait(8_000); k = await kept(); }
    ok("found: a lesson nobody may read says noindex", k.pass, k.detail);
  } else {
    const r = await ask("/primal/l/r42-no-database");
    const h = readHead(r.text);
    ok("found: a lesson whose read can't be made is never noindex for it — the page as it was, with no address of its own",
      r.status === 200 && !h.meta("robots").some((v) => /noindex/i.test(v)) && h.canonical.length === 0 && h.titles[0] === `GT3 Nutrition — ${SITE_NAME}`,
      r.status !== 200 ? said(r) : JSON.stringify({ title: h.titles[0], robots: h.meta("robots"), canonical: h.canonical }));
  }

  // 7 · the API is read, never listed.
  {
    const r = await ask("/api/menu");
    ok("found: an API answer says noindex in its headers (X-Robots-Tag)", r.status === 200 && /noindex/i.test(r.robots), r.status !== 200 ? said(r) : `X-Robots-Tag "${r.robots}"`);
  }

  // 8 · the share card is the image it says it is.
  {
    const r = await ask(SHARE_IMAGE.url);
    const size = pngSize(r.buf);
    ok(`found: the share card ${SHARE_IMAGE.url} is a ${SHARE_IMAGE.width}×${SHARE_IMAGE.height} PNG`,
      r.status === 200 && /image\/png/.test(r.type) && size?.width === SHARE_IMAGE.width && size?.height === SHARE_IMAGE.height,
      r.status !== 200 ? said(r) : `${r.type} ${size ? `${size.width}×${size.height}` : "not a PNG"}`);
  }

  // 9 · the menu's structured data is the menu on the page: the same drinks, in order, at the prices it prints — and on
  //     production, the Catalog's drinks at the Catalog's prices (the server's read, not the code list's stand-in). The
  //     page is remade at most every minute, on a visit after it (the visit itself gets the old one): a change in the
  //     Catalog since may not be on it yet. So a mismatch waits a minute, visits once to have it remade, and asks again.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask("/menu");
    const h = readHead(r.text);
    const menu = h.jsonld.find((d) => d && d["@type"] === "Menu");
    const items = (menu?.hasMenuSection ?? []).flatMap((s) => (s.hasMenuItem ?? []).map((i) => ({ name: i.name, price: i.offers?.price ?? null })));
    const page = h.rows.map((x) => ({ name: x.name, price: x.price }));
    const samePage = items.length === page.length && items.every((it, i) => it.name === page[i].name && cents(it.price) === cents(page[i].price));
    let catalog = { same: true, detail: "" };
    if (production) {
      const api = await ask("/api/menu", "gt3-verify");
      let body = null; try { body = JSON.parse(api.text); } catch { /* said below */ }
      if (!Array.isArray(body?.items)) catalog = { same: false, detail: `/api/menu gave no items (${said(api)}) — the page's menu can't be checked against the Catalog` };
      else {
        const { menuOf, sectionsOf, shownCents } = loadTs("lib/drinks.ts");
        const bySlug = new Map(body.items.map((x) => [x.slug, x]));
        const want = sectionsOf(menuOf(body.items)).flatMap((s) => s.drinks.map((d) => ({ name: d.name, cents: shownCents(bySlug.get(d.slug), d.slug) })));
        catalog = { same: want.length === items.length && want.every((w, i) => w.name === items[i].name && w.cents === cents(items[i].price)),
          detail: `the Catalog's cup menu ${JSON.stringify(want)}` };
      }
    }
    const pass = r.status === 200 && !!menu && samePage && catalog.same;
    if (pass || attempt === 1 || !production) {
      ok(`found: /menu's structured data is the menu on its page — ${items.length} drinks, in order, at its prices${production ? ", the Catalog's" : ""}`, pass,
        r.status !== 200 ? said(r) : !menu ? "no Menu structured data" : !samePage ? `structured ${JSON.stringify(items)} | page ${JSON.stringify(page)}` : catalog.detail);
      break;
    }
    await wait(65_000);
    await ask("/menu");
    await wait(8_000);
  }
}
