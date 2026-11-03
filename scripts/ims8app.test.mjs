// IMS8 · THE APP SIDE OF 0473/0474 (the review branch). The link's read takes both answers a dead link can give (0473's
// PT404 raise, 0474's { live: false }) and 0474's PT429, run on the real lib/visionRead with a stand-in client; the
// order sheet links the customer's record for owners/admins only; Goals counts through customers_total.
import { readFileSync } from "node:fs";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)}` : "")); } };
const { readShared } = loadTs("lib/visionRead.ts");
const sb = (answer) => ({ rpc: async () => answer });
const said = async (answer) => { try { await readShared(sb(answer), "t".repeat(64)); return "drawn"; } catch (e) { return e.message; } };
ok("a dead link before 0474 (the raise): \"isn't live\"", /isn't live/.test(await said({ data: null, error: { message: "This link isn't live.", code: "PT404" } })));
ok("a dead link from 0474 ({ live: false }): \"isn't live\", not an empty vision", /isn't live/.test(await said({ data: { live: false }, error: null })));
ok("too many tries (PT429): says to wait, not that the link is dead", /wait a few minutes/.test(await said({ data: null, error: { message: "Too many tries from this network — try again in a few minutes.", code: "PT429" } })));
ok("a live link: drawn", (await said({ data: { label: "x", plans: [], programs: [], asks: [], layouts: [] }, error: null })) === "drawn");
const rec = readFileSync("components/ShopOrderRecord.tsx", "utf8");
ok("the order sheet: the customer's name is a link to their record for owners/admins only (crew see the name)", /canOpenCustomer = !!profile\?\.is_admin/.test(rec) && /canOpenCustomer \? <RecordLink kind="customer"[^>]*>\{o\.who\}<\/RecordLink> : o\.who/.test(rec) && !/^\s*<RecordLink kind="customer"/m.test(rec));
const goals = readFileSync("lib/goalMetrics.ts", "utf8");
ok("Goals' customer count: customers_total, not the table", /rpc\("customers_total"\)/.test(goals) && !/from\("customers"\)/.test(goals));
const route = readFileSync("app/api/library/intake/route.ts", "utf8");
ok("the research route settles with the server's key (std_research_settle_server), never the caller's session", /supabaseAdmin as any\)\.rpc\("std_research_settle_server"/.test(route) && !/rpc\("std_research_settle"/.test(route));
console.log(`IMS8 THE APP SIDE OF 0473/0474: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
