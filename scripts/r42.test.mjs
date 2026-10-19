// R42 — SEARCH AND SHARING (2026-10-19 — the standards' "Search and sharing"; Ryan: "What's not in our standards").
//
//   1 · lib/seo, compiled: every public page's own words (50–160 characters), its canonical address and share card; the
//       pages kept out; the front door; the business and the menu as structured data.
//   2 · every route is one or the other: each page's nearest metadata is pageMeta(its own address) or PRIVATE_META, and
//       the public ones are exactly lib/seo's list. "/" alone keeps the house's (app/layout HOUSE_META).
//   3 · robots.txt, the sitemap, the API's noindex, and the app build leaving the two files out.
//   4 · lib/guestRead, compiled, against a stand-in fetch: the three answers (rows, nothing public, couldn't read).
//   5 · the menu's first paint is the server's read, at AppProvider's prices; the headings that named nothing.
//   6 · the share card is the size it says.
//   7 · the judge (scripts/search.read.mjs) passes a right site and fails each wrong one — a gate that can fail.
//   8 · where it runs: smoke:ui against the build, verify:prod against production; this file with every test.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs, judgeSite, pngSize, readHead } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const throws = (f) => { try { f(); return false; } catch { return true; } };

const seo = loadTs("lib/seo.ts");
const { SITE, SITE_NAME, PUBLIC_PAGES, CANONICAL_OF, SITEMAP_PATHS, SHARE_IMAGE, HOME_DESCRIPTION, FRONT_DOOR, HOUSE_META, PRIVATE_META } = seo;

// ── 1 · lib/seo ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pages = Object.entries(PUBLIC_PAGES);
  const bad = pages.filter(([, d]) => d.length < 50 || d.length > 160 || !/[.!]$/.test(d) || /simmer|lorem|TODO/i.test(d));
  ok("every public page says what it is in 50 to 160 characters — what a search result shows before it cuts the line", pages.length === 13 && bad.length === 0, bad.map(([p, d]) => `${p} ${d.length}`));
  const byWords = new Map();
  for (const [p, d] of pages) { const c = CANONICAL_OF[p] ?? p; if (!byWords.has(d)) byWords.set(d, new Set()); byWords.get(d).add(c); }
  ok("…its own words: no two addresses share a description unless one is the other's canonical (/events is Find Us)", [...byWords.values()].every((s) => s.size === 1));
  ok("…and every one is a page the app has", pages.every(([p]) => existsSync(join(ROOT, "app", p.slice(1), "page.tsx"))), pages.map(([p]) => p).filter((p) => !existsSync(join(ROOT, "app", p.slice(1), "page.tsx"))));
  ok("the front door is \"/\", and no public page of its own: a guest is sent on to Find Us", FRONT_DOOR === "/" && !("/" in PUBLIC_PAGES) && "/truck" in PUBLIC_PAGES);
  ok("a page reachable two ways names one address: /events is /truck's, which is public and names itself",
    JSON.stringify(CANONICAL_OF) === JSON.stringify({ "/events": "/truck" }) && Object.values(CANONICAL_OF).every((c) => c in PUBLIC_PAGES && !(c in CANONICAL_OF)));
  ok("the sitemap's pages: every public page at its canonical address, once — not /events, not \"/\"",
    JSON.stringify(SITEMAP_PATHS) === JSON.stringify(Object.keys(PUBLIC_PAGES).filter((p) => p !== "/events")) && new Set(SITEMAP_PATHS).size === SITEMAP_PATHS.length, SITEMAP_PATHS);

  const m = seo.pageMeta("/menu"), e = seo.pageMeta("/events");
  const card = (og) => og && og.type === "website" && og.siteName === SITE_NAME && og.locale === "en_US" && Array.isArray(og.images) && og.images.length === 1
    && og.images[0].url === "/og/gt3pb.png" && og.images[0].width === 1200 && og.images[0].height === 630 && !!og.images[0].alt;
  ok("pageMeta: the page's own description, canonical address, and the share card at that address — the large card for X",
    m.description === PUBLIC_PAGES["/menu"] && m.alternates.canonical === "/menu" && card(m.openGraph) && m.openGraph.url === "/menu" && m.twitter.card === "summary_large_image", m);
  ok("…its title is the page's own: the card names none, so Next fills og:title and twitter:title from the page's",
    !("title" in m.openGraph) && !("title" in m.twitter) && !("description" in m.openGraph) && !("description" in m.twitter));
  ok("…/events names /truck, in its canonical and its card", e.alternates.canonical === "/truck" && e.openGraph.url === "/truck");
  ok("…and a page not on the list is refused, not given a canonical by mistake", throws(() => seo.pageMeta("/crew")) && throws(() => seo.pageMeta("/")));
  ok("PRIVATE_META: noindex, no canonical address, a card with no address — so a page under a public one inherits neither",
    PRIVATE_META.robots.index === false && PRIVATE_META.robots.follow === false && JSON.stringify(PRIVATE_META.alternates) === "{}"
      && card(PRIVATE_META.openGraph) && !("url" in PRIVATE_META.openGraph) && PRIVATE_META.twitter.card === "summary_large_image", PRIVATE_META);
  ok("HOUSE_META: the house description and card, and no address — a page names its own",
    HOUSE_META.description === HOME_DESCRIPTION && card(HOUSE_META.openGraph) && !("url" in HOUSE_META.openGraph) && !("alternates" in HOUSE_META) && !("robots" in HOUSE_META));
  ok("indexable: the front door, the public pages and lessons; nothing else",
    seo.indexable("/") && seo.indexable("/menu") && seo.indexable("/menu?x=1") && seo.indexable("/primal/l/fuel-first")
      && !seo.indexable("/crew") && !seo.indexable("/order") && !seo.indexable("/primal/l/a/b") && !seo.indexable("/c/CODE"));
  const long = "Why a real breakfast — protein, salt and water — beats a bar, and what to order when you can't cook, on a morning with no time at all, before a long run in the heat.";
  const cut = seo.clip(long);
  ok("clip: a short line stands; a long one is cut at a word, under 160, with an ellipsis", seo.clip("  A short  line. ") === "A short line." && cut.length <= 160 && cut.endsWith("…") && long.startsWith(cut.slice(0, -1)) && !/\s…$/.test(cut), cut);
  ok("a lesson's description: its summary, else its subtitle, else Primal's own",
    seo.lessonDescription({ summary: "One line.", subtitle: "Sub" }) === "One line." && seo.lessonDescription({ summary: "  ", subtitle: "Before the work" }) === "Before the work"
      && seo.lessonDescription({}) === PUBLIC_PAGES["/primal"]);
  const lm = seo.publicMeta("/primal/l/fuel-first", "One line.", "article");
  ok("publicMeta: a lesson is an article, at its own address", lm.openGraph.type === "article" && lm.openGraph.url === "/primal/l/fuel-first" && lm.alternates.canonical === "/primal/l/fuel-first");

  const b = seo.businessJsonLd();
  ok("the business as structured data: what the app already says — its name, address, mark, menu, cities, email and profiles",
    b["@type"] === "FoodEstablishment" && b.url === SITE && b.name === SITE_NAME && b.description === HOME_DESCRIPTION && b.email === "hello@gt3pb.com"
      && b.hasMenu === `${SITE}/menu` && b.logo === `${SITE}/icon-512.png` && b.image === `${SITE}/og/gt3pb.png`
      && JSON.stringify(b.areaServed) === JSON.stringify([{ "@type": "City", name: "Greenville, SC" }, { "@type": "City", name: "Atlanta, GA" }])
      && JSON.stringify(b.sameAs) === JSON.stringify(["https://gt3pb.com", "https://instagram.com/gt3pb", "https://tiktok.com/@gt3pb"]), b);
  ok("…its mark and its card are files the site serves", existsSync(join(ROOT, "public/icon-512.png")) && existsSync(join(ROOT, "public/og/gt3pb.png")));
  const mj = seo.menuJsonLd([{ line: "Activation", drinks: [{ name: "RISE", line: "Activation", why: "A clean lift.", priceCents: 1000 }, { name: "FREE", line: "Activation", why: "", priceCents: 0 }] },
    { line: "Fuel", drinks: [{ name: "EMBER", line: "Fuel", why: "Warm.", priceCents: 1250 }, { name: "UNPRICED", line: "Fuel", why: "", priceCents: null }] }]);
  const items = mj.hasMenuSection.flatMap((s) => s.hasMenuItem);
  ok("the menu as structured data: its sections and drinks in order, each at its price in dollars — and none is \"free\" for want of one",
    mj["@type"] === "Menu" && mj["@id"] === `${SITE}/menu#menu` && mj.url === `${SITE}/menu` && mj.hasMenuSection.map((s) => s.name).join() === "Activation,Fuel"
      && items.map((i) => i.name).join() === "RISE,FREE,EMBER,UNPRICED" && items[0].offers.price === "10.00" && items[0].offers.priceCurrency === "USD"
      && items[2].offers.price === "12.50" && !("offers" in items[1]) && !("offers" in items[3]) && items[0].description === "A clean lift." && !("description" in items[1]), mj);
  const evil = seo.jsonLdText({ name: "</script><script>alert(1)</script>" });
  ok("structured data can't close the tag it sits in", !evil.includes("<") && JSON.parse(evil).name === "</script><script>alert(1)</script>");
}

// ── 2 · every route is public or kept out ────────────────────────────────────────────────────────────────────────────
{
  const pages = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { if (!(dir === "app" && e.name === "api")) walk(`${dir}/${e.name}`); }
      else if (/^page\.tsx?$/.test(e.name)) pages.push(dir);
    }
  };
  walk("app");
  const routeOf = (dir) => "/" + dir.split("/").slice(1).filter((s) => !/^\(.*\)$/.test(s)).join("/");
  const kindOf = (file) => {
    if (!existsSync(join(ROOT, file))) return null;
    const src = read(file).replace(/^\s*\/\/.*$/gm, "");
    const pub = src.match(/pageMeta\("([^"]+)"\)/);
    if (/export async function generateMetadata/.test(src) && /publicMeta\(/.test(src) && /PRIVATE_META/.test(src)) return "lesson";
    if (pub) return `public:${pub[1]}`;
    if (/\.\.\.PRIVATE_META/.test(src)) return "private";
    if (/export (const metadata|async function generateMetadata|function generateMetadata)/.test(src)) return "unsaid";
    return null;
  };
  const verdict = {};
  for (const dir of pages) {
    const route = routeOf(dir);
    // The nearest says it: the page, then each layout above it — never the root's, which is the house's.
    const chain = [];
    const parts = dir.split("/");
    for (let i = parts.length; i > 1; i--) {
      const d = parts.slice(0, i).join("/");
      if (i === parts.length) chain.push(...["page.tsx", "page.ts"].map((f) => `${d}/${f}`));
      chain.push(`${d}/layout.tsx`);
    }
    verdict[route] = chain.map(kindOf).find(Boolean) ?? null;
  }
  const routes = Object.keys(verdict);
  const unsaid = routes.filter((r) => r !== "/" && (!verdict[r] || verdict[r] === "unsaid"));
  ok(`every route but the front door says public or kept out — ${routes.length} routes`, routes.length >= 28 && unsaid.length === 0, unsaid);
  const wrong = routes.filter((r) => verdict[r]?.startsWith("public:") && verdict[r] !== `public:${r}`);
  ok("…a public one names its own address, not another's", wrong.length === 0, wrong.map((r) => `${r} → ${verdict[r]}`));
  const pub = routes.filter((r) => verdict[r]?.startsWith("public:")).sort();
  ok("…and the public ones are exactly lib/seo's list", JSON.stringify(pub) === JSON.stringify(Object.keys(PUBLIC_PAGES).sort()), pub);
  ok("…the lesson decides by its own read; the partner share and a printed code are kept out",
    verdict["/primal/l/[slug]"] === "lesson" && verdict["/built/[key]"] === "private" && verdict["/c/[code]"] === "private" && verdict["/crew"] === "private" && verdict["/order"] === "private");
  const lay = read("app/layout.tsx");
  ok("the front door keeps the house's: app/layout spreads HOUSE_META, and \"/\" says nothing of its own",
    verdict["/"] === null && /^\s*\.\.\.HOUSE_META,$/m.test(lay) && !/^\s*description:/m.test(lay.slice(lay.indexOf("export const metadata"), lay.indexOf("export const viewport"))) && !/alternates|canonical/.test(lay.replace(/^\s*\/\/.*$/gm, "")));
  ok("the business is structured data on every web page, from the root — and not in the app's export",
    /\{APP_BUILD \? null : <script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: jsonLdText\(businessJsonLd\(\)\) \}\} \/>\}/.test(lay));
  const lesson = read("app/primal/l/[slug]/page.tsx");
  ok("a lesson: public → its title, one-liner and address; a member's → noindex; a read that failed → neither",
    /if \(lesson === undefined\) return \{ title: "Return to Primal" \};/.test(lesson) && /if \(lesson === null\) return \{ title: "Return to Primal", \.\.\.PRIVATE_META \};/.test(lesson)
      && /return \{ title: lesson\.title, \.\.\.publicMeta\(lessonPath\(slug\), lessonDescription\(lesson\), "article"\) \};/.test(lesson));
}

// ── 3 · robots.txt, the sitemap, the API, the app build ───────────────────────────────────────────────────────────────
{
  const robots = read("app/robots.ts").replace(/^\s*\/\/.*$/gm, "");
  ok("robots.txt: every crawler may read every page — the API too, so a page's words can be drawn — and the sitemap is named",
    /return \{ rules: \[\{ userAgent: "\*", allow: "\/" \}\], sitemap: `\$\{SITE\}\/sitemap\.xml` \};/.test(robots) && !/disallow/i.test(robots));
  const sm = read("app/sitemap.ts").replace(/^\s*\/\/.*$/gm, "");
  ok("the sitemap: the public pages and the lessons anyone may read, whole addresses, made again hourly, no dates",
    /^export const revalidate = 3600;$/m.test(sm) && /const lessons = await publicLessonSlugs\(\);/.test(sm)
      && /return \[\.\.\.SITEMAP_PATHS, \.\.\.lessons\.map\(lessonPath\)\]\.map\(\(p\) => \(\{ url: absolute\(p\) \}\)\);/.test(sm) && !/lastModified/.test(sm));
  ok("an API answer is read, never listed: X-Robots-Tag noindex on /api", /\{ source: "\/api\/:path\*", headers: \[\{ key: "X-Robots-Tag", value: "noindex" \}\] \}/.test(read("next.config.ts")));
  const app = read("scripts/build.app.mjs");
  ok("the app's export leaves robots.txt and the sitemap out — and they never become web-only links",
    /const LEAVE_OUT = \[[^\]]*"app\/robots\.ts", "app\/sitemap\.ts"/.test(app) && /\.filter\(\(p\) => p !== "\/api" && !\/\\\.\[a-z\]\+\$\/\.test\(p\)\)/.test(app));
}

// ── 4 · lib/guestRead ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const gr = loadTs("lib/guestRead.ts");
  const calls = [];
  const stub = (answer) => async (url, init) => { calls.push({ url, init }); if (answer instanceof Error) throw answer; return answer; };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  const setEnv = (u, k) => { if (u === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = u; if (k === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = k; };
  try {
    setEnv(undefined, undefined);
    ok("guestRead: with no database configured (a CI or app build) — nothing asked, null", (await gr.guestRead("x", { revalidate: 60 }, stub(json([])))) === null && calls.length === 0);
    setEnv("https://stand-in.supabase.co/", "stand-in-public-key");
    const rows = await gr.guestRead("products?select=slug", { revalidate: 60 }, stub(json([{ slug: "rise" }])));
    const c = calls.at(-1);
    ok("…asks as a guest: the database's REST address, the public key, kept for its seconds, with a deadline",
      JSON.stringify(rows) === JSON.stringify([{ slug: "rise" }]) && c.url === "https://stand-in.supabase.co/rest/v1/products?select=slug"
        && c.init.headers.apikey === "stand-in-public-key" && c.init.headers.authorization === "Bearer stand-in-public-key" && c.init.next.revalidate === 60 && c.init.signal instanceof AbortSignal, c);
    ok("…a refusal, an answer that isn't a list, or no answer at all is null — never a throw, never an empty menu",
      (await gr.guestRead("x", { revalidate: 1 }, stub(json({ message: "no" }, 401)))) === null && (await gr.guestRead("x", { revalidate: 1 }, stub(json([{ slug: "a proxy's page" }], 502)))) === null
        && (await gr.guestRead("x", { revalidate: 1 }, stub(json({ a: 1 })))) === null
        && (await gr.guestRead("x", { revalidate: 1 }, stub(new Error("timeout")))) === null);
    const cat = await gr.catalogForGuests(stub(json([{ slug: "rise", active: true }, { slug: "gone", active: false }, { slug: "tide", active: null }, { name: "no slug" }])));
    ok("catalogForGuests: the products on sale, as /api/menu reads them, read again at most every minute",
      JSON.stringify(cat.map((r) => r.slug)) === JSON.stringify(["rise", "tide"]) && calls.at(-1).url.endsWith(`/rest/v1/products?select=${gr.MENU_COLUMNS}`) && calls.at(-1).init.next.revalidate === 60
        && gr.MENU_COLUMNS === "slug,name,line,price_cents,sort,what,why,ingredients,excludes,timing,accent,sold_out,active,cup_orderable,caffeine,contains,tag,when_text", cat);
    ok("…and null when it can't be read (the code list stands in)", (await gr.catalogForGuests(stub(json([], 500)))) === null);
    const slugs = await gr.publicLessonSlugs(stub(json([{ slug: "a" }, { slug: "b" }, { slug: "a" }, { slug: "" }, { slug: 3 }, null])));
    ok("publicLessonSlugs: the lessons a guest may read, once each, in the course's order, hourly; none when unread",
      JSON.stringify(slugs) === '["a","b"]' && /primal_lessons\?select=slug&published_at=not\.is\.null&archived_at=is\.null&order=sort$/.test(calls.at(-1).url) && calls.at(-1).init.next.revalidate === 3600
        && JSON.stringify(await gr.publicLessonSlugs(stub(new Error("down")))) === "[]", slugs);
    const l = await gr.publicLesson("fuel first/2", stub(json([{ title: " Fuel first ", subtitle: null, summary: "One line." }])));
    ok("publicLesson: a lesson anyone may read — its title and one-liner, asked by its slug, every ten minutes, three seconds at most",
      l && l.title === "Fuel first" && l.summary === "One line." && /slug=eq\.fuel%20first%2F2&published_at=not\.is\.null&archived_at=is\.null&limit=1$/.test(calls.at(-1).url)
        && calls.at(-1).init.next.revalidate === 600, l);
    ok("…null when it isn't one (a member's, unpublished, gone, untitled); undefined when the database couldn't be asked",
      (await gr.publicLesson("x", stub(json([])))) === null && (await gr.publicLesson("x", stub(json([{ title: "  " }])))) === null
        && (await gr.publicLesson("x", stub(json([], 503)))) === undefined && (await gr.publicLesson("x", stub(new Error("timeout")))) === undefined);
  } finally { setEnv(env.url, env.key); }
}

// ── 5 · the menu's first paint; the headings ─────────────────────────────────────────────────────────────────────────
{
  const dr = loadTs("lib/drinks.ts");
  ok("shownCents: the row's price, else the code list's, else 0 — AppProvider's priceCents rule, for a menu read on its own",
    dr.shownCents({ price_cents: 1100 }, "rise") === 1100 && dr.shownCents(null, "rise") === 1000 && dr.shownCents({ price_cents: null }, "kingme") === 1400
      && dr.shownCents(undefined, "ember") === 0 && dr.shownCents({ price_cents: 0 }, "rise") === 0
      && /const priceCents = useCallback\(\(id: string\) => prices\[id\] \?\? bySlug\.get\(id\)\?\.price_cents \?\? fallbackCents\(id\) \?\? 0, \[prices, bySlug\]\);/.test(read("components/AppProvider.tsx")));
  const mp = read("app/menu/page.tsx");
  ok("the menu draws the server's read until the phone's own lands: its drinks, at its prices; none kept room for; its empty said",
    /const server = useServerMenu\(\);/.test(mp) && /const fromServer = !menuRead && server !== null;/.test(mp)
      && /const shown = useMemo\(\(\) => \(fromServer && server \? menuOf\(server\) : menu\), \[fromServer, server, menu\]\);/.test(mp) && /const sections = sectionsOf\(shown\);/.test(mp)
      && /const priceLabel = \(id: string\) => money\(fromServer \? shownCents\(serverBy\.get\(id\), id\) : priceCents\(id\)\);/.test(mp)
      && /const reserve = facts\.length === 0 && !menuRead && !fromServer && isSeedSlug\(id\);/.test(mp) && /\{\(menuRead \|\| fromServer\) && sections\.length === 0 && /.test(mp)
      && !/sectionsOf\(menu\)/.test(mp));
  const ml = read("app/menu/layout.tsx");
  ok("…the read is the layout's: a guest's, on the web only, handed down — and the structured data after the page, from the same drinks at the same prices",
    /const rows = APP_BUILD \? null : await catalogForGuests\(\);/.test(ml) && /<ServerMenu rows=\{rows\}>\{children\}<\/ServerMenu>\n\s*\{APP_BUILD \? null : <script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: jsonLdText\(menuJsonLd\(sections\)\) \}\} \/>\}/.test(ml)
      && /sectionsOf\(rows \? menuOf\(rows\) : seedMenu\(\)\)/.test(ml) && /priceCents: shownCents\(bySlug\.get\(d\.slug\), d\.slug\)/.test(ml) && !/export const revalidate/.test(ml));
  const ap = read("components/AppProvider.tsx");
  ok("…through AppProvider's own context (no chunk of its own), empty by default — and lent to the sheet, the cart's prices and an order line's name, never as the phone's read",
    /const ServerMenuCtx = createContext<readonly MenuRow\[\] \| null>\(null\);/.test(ap) && /export const useServerMenu = \(\): readonly MenuRow\[\] \| null => useContext\(ServerMenuCtx\);/.test(ap)
      && /useEffect\(\(\) => \{ if \(rows\) prime\(rows\); \}, \[rows, prime\]\);/.test(ap) && /const prime = useCallback\(\(r: readonly MenuRow\[\]\) => setPrimed\(\(was\) => was \?\? r\), \[\]\);/.test(ap)
      && /const bySlug = useMemo\(\(\) => new Map\(\(rows \?\? primed \?\? \[\]\)\.map\(\(r\) => \[r\.slug, r\]\)\), \[rows, primed\]\);/.test(ap)
      && /nameFrom\(rows \?\? primed, id, liveNames\)/.test(ap) && /menuRead: rows !== null/.test(ap) && /const menu = useMemo\(\(\) => \(rows \? menuOf\(rows\) : seedMenu\(\)\), \[rows\]\);/.test(ap)
      && /<PrimeCtx\.Provider value=\{prime\}>/.test(ap) && !existsSync(join(ROOT, "components/ServerMenu.tsx")));
  // A stand-in Catalog, as the layout would draw it: a price the code list doesn't have, a drink only the Catalog knows,
  // one not sold by the cup, one taken off — the first paint is the Catalog's, not the code list's.
  const rows = [
    { slug: "rise", name: "RISE", line: "Activation", price_cents: 1100, sort: 10, what: null, why: "Lift.", ingredients: [], excludes: [], timing: null, accent: null, sold_out: false, active: true, cup_orderable: true, caffeine: true, contains: null, tag: null, when_text: null },
    { slug: "ember", name: "EMBER", line: "Fuel", price_cents: 1250, sort: 30, what: null, why: "Warm.", ingredients: [], excludes: [], timing: null, accent: null, sold_out: false, active: true, cup_orderable: true, caffeine: false, contains: null, tag: null, when_text: null },
    { slug: "hunt", name: "HUNT", line: "Fuel", price_cents: 1200, sort: 31, what: null, why: "Broth.", ingredients: [], excludes: [], timing: null, accent: null, sold_out: false, active: true, cup_orderable: false, caffeine: false, contains: null, tag: null, when_text: null },
  ];
  const drawn = dr.sectionsOf(dr.menuOf(rows)).flatMap((s) => s.drinks.map((d) => `${d.name} ${dr.shownCents(rows.find((r) => r.slug === d.slug), d.slug)}`));
  ok("…a stand-in Catalog draws as the Catalog: its price, its own drink, not what isn't sold by the cup", JSON.stringify(drawn) === '["RISE 1100","EMBER 1250"]', drawn);
  const fu = read("components/FindUs.tsx"), shell = read("components/AppShell.tsx");
  ok("headings: Find Us names itself while its stop is read (the eye keeps the ellipsis), and the 3MPIRE is named for what it is",
    /<h1 className="k-title lg"><span aria-hidden="true">…<\/span><span className="sr-only">\{titleOf\("\/truck"\)\}<\/span><\/h1>/.test(fu) && /"3mpire": "The 3MPIRE",/.test(shell) && !/"3mpire": "Your member profile"/.test(shell));
}

// ── 6 · the share card ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const png = readFileSync(join(ROOT, "public/og/gt3pb.png"));
  const size = pngSize(png);
  ok("the share card is a 1200×630 PNG, as lib/seo says, and light to fetch", size?.width === SHARE_IMAGE.width && size?.height === SHARE_IMAGE.height && SHARE_IMAGE.width === 1200 && SHARE_IMAGE.height === 630
    && statSync(join(ROOT, "public/og/gt3pb.png")).size < 200_000, size);
}

// ── 7 · the judge can fail ────────────────────────────────────────────────────────────────────────────────────────────
{
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");
  const tag = (name, attrs) => `<${name} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}/>`;
  const doc = ({ title, description, canonical, robots, og = {}, tw = {}, h1 = ["A heading"], jsonld = [seo.businessJsonLd()], rows = [] }) =>
    `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><title>${esc(title)}</title>`
    + (description ? tag("meta", { name: "description", content: description }) : "") + (robots ? tag("meta", { name: "robots", content: robots }) : "")
    + (canonical ? tag("link", { rel: "canonical", href: canonical }) : "")
    + Object.entries(og).map(([k, v]) => tag("meta", { property: `og:${k}`, content: v })).join("") + Object.entries(tw).map(([k, v]) => tag("meta", { name: `twitter:${k}`, content: v })).join("")
    + jsonld.map((d) => `<script type="application/ld+json">${seo.jsonLdText(d)}</script>`).join("")
    + `</head><body>${h1.map((t) => `<h1 class="x">${esc(t)}</h1>`).join("")}`
    + rows.map((r) => `<div class="entry" data-drink-row="${r.slug}"><button aria-label="${esc(r.name)}, $${r.label}, view details"></button><span class="entry-name">${esc(r.name)}</span><button class="entry-px">$${r.label}</button></div>`).join("")
    // The page's data repeats its tags as text inside scripts: a reader must not take them for the page's.
    + `<script>self.__next_f.push([1,"<meta name=\\"robots\\" content=\\"noindex\\"/><link rel=\\"canonical\\" href=\\"https://elsewhere.example\\"/>"])</script></body></html>`;
  const image = `${SITE}/og/gt3pb.png`;
  const card = (title, description, url) => ({
    og: { title, description, ...(url ? { url } : {}), site_name: SITE_NAME, locale: "en_US", image, "image:width": "1200", "image:height": "630", "image:alt": SHARE_IMAGE.alt, type: "website" },
    tw: { card: "summary_large_image", title, description, image },
  });
  const NAMES = { "/truck": "Find Us", "/events": "Find Us", "/menu": "Menu", "/shop": "Shop", "/reserve": "Reserve", "/delivery": "Delivery", "/3mpire": "3MPIRE", "/book": "Book the bar", "/craft": "Our craft", "/primal": "Return to Primal", "/privacy": "Privacy policy", "/terms": "Terms", "/texts": "Texts" };
  const MENU = [{ slug: "rise", name: "RISE", line: "Activation", cents: 1100, why: "Lift." }, { slug: "ember", name: "EMBER", line: "Fuel", cents: 1250, why: "Warm." }];
  const menuLd = (list) => seo.menuJsonLd([...new Set(list.map((d) => d.line))].map((line) => ({ line, drinks: list.filter((d) => d.line === line).map((d) => ({ name: d.name, line: d.line, why: d.why, priceCents: d.cents })) })));
  const label = (c) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
  const PNG = readFileSync(join(ROOT, "public/og/gt3pb.png"));
  const site = (wrong = {}) => {
    const pages = {};
    pages["/robots.txt"] = { type: "text/plain", body: wrong.robots ?? `User-Agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n` };
    const locs = (wrong.sitemap ?? [...SITEMAP_PATHS.map((p) => `${SITE}${p}`), ...(wrong.lessons ?? [])]);
    pages["/sitemap.xml"] = { type: "application/xml", body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map((u) => `<url>\n<loc>${u}</loc>\n</url>`).join("\n")}\n</urlset>\n` };
    for (const p of Object.keys(PUBLIC_PAGES)) {
      const title = `${NAMES[p]} — ${SITE_NAME}`, canonical = `${SITE}${CANONICAL_OF[p] ?? p}`, description = PUBLIC_PAGES[p];
      const c = card(title, description, canonical);
      const menuPage = p === "/menu" ? { rows: MENU.map((d) => ({ slug: d.slug, name: d.name, label: label(wrong.pagePrice?.[d.slug] ?? d.cents) })), jsonld: [seo.businessJsonLd(), menuLd(MENU)] } : {};
      pages[p] = { type: "text/html", body: doc({ title, description, canonical, og: c.og, tw: c.tw, ...menuPage, ...(wrong.page?.[p] ?? {}) }), robots: wrong.pageRobots?.[p] };
    }
    const house = card(`${SITE_NAME} — Only the best for you`, HOME_DESCRIPTION);
    pages["/"] = { type: "text/html", body: doc({ title: `${SITE_NAME} — Only the best for you`, description: HOME_DESCRIPTION, og: house.og, tw: house.tw, h1: [], ...(wrong.page?.["/"] ?? {}) }) };
    for (const p of ["/crew", "/order", "/office", "/academy", "/c/R42-NOT-A-CODE"]) {
      const c = card(`Kept — ${SITE_NAME}`, HOME_DESCRIPTION);
      pages[p] = { type: "text/html", body: doc({ title: `Kept — ${SITE_NAME}`, description: HOME_DESCRIPTION, robots: "noindex, nofollow", og: c.og, tw: c.tw, ...(wrong.page?.[p] ?? {}) }) };
    }
    const lc = card(`Return to Primal — ${SITE_NAME}`, HOME_DESCRIPTION);
    pages["/primal/l/r42-no-database"] = { type: "text/html", body: doc({ title: `Return to Primal — ${SITE_NAME}`, description: HOME_DESCRIPTION, og: lc.og, tw: lc.tw, ...(wrong.page?.["/primal/l/r42-no-database"] ?? {}) }) };
    pages["/primal/l/r42-no-such-lesson"] = { type: "text/html", body: doc({ title: `Return to Primal — ${SITE_NAME}`, description: HOME_DESCRIPTION, robots: "noindex, nofollow", og: lc.og, tw: lc.tw }) };
    for (const u of wrong.lessons ?? []) {
      const path = u.slice(SITE.length), c = card(`Fuel first — ${SITE_NAME}`, "One line.", u);
      c.og.type = "article";
      pages[path] = { type: "text/html", body: doc({ title: `Fuel first — ${SITE_NAME}`, description: "One line.", canonical: u, og: c.og, tw: c.tw, ...(wrong.page?.[path] ?? {}) }) };
    }
    const apiItems = (wrong.catalog ?? MENU).map((d, i) => ({ slug: d.slug, name: d.name, line: d.line, price_cents: d.cents, sort: (i + 1) * 10, what: null, why: d.why, ingredients: [], excludes: [], timing: null, accent: null, sold_out: false, active: true, cup_orderable: true, caffeine: null, contains: null, tag: null, when_text: null }));
    pages["/api/menu"] = { type: "application/json", body: JSON.stringify({ prices: {}, items: apiItems, source: "products" }), robots: wrong.apiRobots ?? "noindex" };
    pages[SHARE_IMAGE.url] = { type: "image/png", body: wrong.png ?? PNG };
    return async (url) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "") || "/";
      const p = pages[path];
      if (!p) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      return new Response(p.body, { status: 200, headers: { "content-type": p.type, ...(p.robots ? { "x-robots-tag": p.robots } : {}) } });
    };
  };
  const run = async (wrong, production = false) => {
    const results = [];
    await judgeSite("https://stand-in.example", { ok: (name, c, d) => results.push({ name, c, d }), production, get: site(wrong), wait: async () => {}, log: () => {} });
    return results;
  };
  const right = await run({});
  ok(`the judge passes a right site — ${right.length} checks`, right.length === 25 && right.every((r) => r.c), right.filter((r) => !r.c).map((r) => `${r.name} → ${r.d}`));
  const lessons = [`${SITE}/primal/l/fuel-first`];
  const rightProd = await run({ lessons }, true);
  ok(`…and a right production — the lesson it lists, and the Catalog's menu — ${rightProd.length} checks`, rightProd.length === 26 && rightProd.every((r) => r.c), rightProd.filter((r) => !r.c).map((r) => `${r.name} → ${r.d}`));
  const failsOn = async (what, wrong, re, production = false) => {
    const res = await run(wrong, production);
    const failed = res.filter((r) => !r.c);
    ok(`…and fails ${what}`, failed.length >= 1 && failed.every((r) => re.test(r.name)), failed.map((r) => r.name));
  };
  const shrunk = Buffer.from(PNG); shrunk.writeUInt32BE(600, 20);
  await failsOn("a robots.txt that keeps every page out", { robots: `User-Agent: *\nDisallow: /\n\nSitemap: ${SITE}/sitemap.xml\n` }, /robots\.txt/);
  await failsOn("a sitemap missing the menu, or listing /events", { sitemap: [...SITEMAP_PATHS.filter((p) => p !== "/menu"), "/events"].map((p) => `${SITE}${p}`) }, /sitemap\.xml/);
  await failsOn("a lesson listed by a build with no database", { lessons }, /sitemap\.xml/);
  await failsOn("a public page with no canonical address", { page: { "/craft": { canonical: undefined } } }, /^found: \/craft —/);
  await failsOn("a public page that says noindex", { page: { "/truck": { robots: "noindex" } } }, /^found: \/truck —/);
  await failsOn("a public page that takes another's description", { page: { "/book": { description: PUBLIC_PAGES["/craft"] } } }, /^found: \/book —/);
  await failsOn("a public page with two headings", { page: { "/shop": { h1: ["Shop", "Again"] } } }, /^found: \/shop —/);
  await failsOn("a public page with no heading", { page: { "/terms": { h1: [] } } }, /^found: \/terms —/);
  await failsOn("a public page without the business", { page: { "/privacy": { jsonld: [] } } }, /^found: \/privacy —/);
  await failsOn("a front door that names an address of its own", { page: { "/": { canonical: `${SITE}/` } } }, /^found: \/ keeps/);
  await failsOn("a page meant to be kept out that isn't", { page: { "/crew": { robots: undefined } } }, /^found: \/crew is kept out/);
  await failsOn("a lesson that says noindex because its read failed", { page: { "/primal/l/r42-no-database": { robots: "noindex" } } }, /a lesson whose read can't be made/);
  await failsOn("an API that doesn't say noindex", { apiRobots: "" }, /API answer says noindex/);
  await failsOn("a share card of the wrong size", { png: shrunk }, /share card/);
  await failsOn("a menu whose structured data and page disagree on a price", { pagePrice: { ember: 1300 } }, /\/menu's structured data/);
  await failsOn("on production, a menu that isn't the Catalog's", { lessons, catalog: [...MENU, { slug: "tide", name: "TIDE", line: "Hydration", cents: 900, why: "Coconut." }] }, /\/menu's structured data/, true);
  await failsOn("on production, a menu at the code list's prices while the Catalog's differ", { lessons, catalog: MENU.map((d) => (d.slug === "rise" ? { ...d, cents: 1200 } : d)) }, /\/menu's structured data/, true);
  await failsOn("on production, a public page whose headers say noindex", { lessons, pageRobots: { "/craft": "noindex" } }, /^found: \/craft —/, true);
  await failsOn("on production, a listed lesson that names no address", { lessons, page: { "/primal/l/fuel-first": { canonical: undefined } } }, /the listed lesson/, true);
  const h = readHead(`<html><head><title>A &amp; B</title><meta name="description" content="It&#x27;s &quot;here&quot;"/></head><body><svg><title>icon</title></svg><h1>One <span class="sr-only">two</span></h1></body></html>`);
  ok("readHead: the head's title only (not an icon's), entities read as text, a heading's words", JSON.stringify(h.titles) === '["A & B"]' && h.meta("description")[0] === `It's "here"` && h.h1[0] === "One two");
}

// ── 8 · where it runs ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const ui = read("scripts/smoke.ui.mjs"), prod = read("scripts/verify.prod.mjs"), pkg = JSON.parse(read("package.json"));
  ok("smoke:ui judges the build it starts, before the browser, with no database", /import \{ judgeSite \} from "\.\/search\.read\.mjs";/.test(ui) && /await judgeSite\(BASE, \{ ok, production: false \}\);/.test(ui)
    && ui.indexOf("await judgeSite(BASE") < ui.indexOf("const browser = await chromium.launch(launchOpts);"));
  ok("verify:prod judges production in its full run — after each push, and daily — and says the quick run skips it",
    /if \(!QUICK\) \{\n\s*const \{ judgeSite \} = await import\("\.\/search\.read\.mjs"\);\n\s*await judgeSite\(APP, \{ ok, production: true \}\);\n\s*\}/.test(prod) && /found: skipped \(--quick\)/.test(prod) && /3b\. FOUND/.test(prod));
  const rel = read("RELEASE.md"), sec = rel.slice(rel.indexOf("## Search"), rel.indexOf("## What a red Production run means"));
  ok("RELEASE.md: Search Console once — the domain, the sitemap, a live test of the menu — and what a red found: line means",
    rel.indexOf("## Search") > 0 && /\*\*Domain\*\* → `gt3pb\.com`/.test(sec) && /`https:\/\/app\.gt3pb\.com\/sitemap\.xml` → \*\*Submit\*\*/.test(sec) && /\*\*Test live URL\*\*/.test(sec)
      && /^\| `found:` \|/m.test(rel), sec.slice(0, 300));
  ok("this file runs with every test", /node scripts\/r41\.test\.mjs && node scripts\/r42\.test\.mjs/.test(pkg.scripts.test));
}

console.log(`\nR42 — SEARCH AND SHARING: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
