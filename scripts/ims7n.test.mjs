// IMS7 — GT3 HQ OFF THE CUSTOMER BAR. The vision carries the HQ bar for the crew and the customer bar for anyone else;
// every other page keeps the bar it had; the bar is never the boundary (the page's staff check and the database are).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTs } from "./search.read.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const S = loadTs("lib/surfaces.ts");

const CUSTOMER = ["/", "/menu", "/truck", "/shop", "/events", "/reserve", "/primal/sleep", "/c/AB12", "/privacy", "/3mpire", "/visionx", "/visions", "/presentx"];
const WORK = ["/academy", "/architecture", "/driver", "/scan", "/playbook", "/agreement", "/offer", "/display"];
ok("the vision, and any deep link into it, carries the HQ bar", ["/vision", "/vision/", "/vision/store", "/vision?tab=library", "/vision/plan/p1"].every((p) => S.navOf(p.split("?")[0]) === "hq"));
ok("…and stays work for commerce: no cart, no concierge", S.surfaceOf("/vision") === "work" && !S.showsCommerce(S.surfaceOf("/vision")));
ok("a prefix is not a match — /visionx and /visions keep the customer bar", S.navOf("/visionx") === "customer" && S.navOf("/visions") === "customer");
ok("ordering pages keep the customer bar", CUSTOMER.every((p) => S.navOf(p) === "customer"), CUSTOMER.map((p) => [p, S.navOf(p)]));
ok("the crew's other tools keep the bar they had (customer) — only HQ moves", WORK.every((p) => S.navOf(p) === "customer"));
ok("the console keeps its own; a share link keeps none", S.navOf("/crew") === "operator" && S.navOf("/crew?s=money".split("?")[0]) === "operator" && S.navOf("/built/x") === "none" && S.navOf("/present") === "none");
ok("an empty path is the home page's bar", S.navOf(null) === "customer" && S.navOf("") === "customer");
ok("commerce chrome unchanged: every page's surface is what it was", S.surfaceOf("/menu") === "customer" && S.surfaceOf("/crew") === "console" && S.surfaceOf("/present") === "share" && WORK.every((p) => S.surfaceOf(p) === "work"));

const shell = read("components/AppShell.tsx"), hq = read("components/HqNav.tsx"), page = read("app/vision/page.tsx");
ok("the shell asks lib/surfaces which bar, in one place", /\{isShare \? null : inAdmin \|\| navOf\(pathname\) === "hq" \? <OperatorNav \/> : <BottomNav \/>\}/.test(shell));
const opnav = read("components/OperatorNav.tsx");
ok("…and the HQ bar rides the console nav's lazy chunk — no loader of its own in every page's bundle", /const OperatorNav = dynamic\(\(\) => import\("\.\/OperatorNav"\)\);/.test(shell) && !/import\("\.\/HqNav"\)/.test(shell)
  && /export default function OperatorNav\(\) \{\n  return useHqBar\(\) \? <HqNav \/> : <ConsoleNav \/>;/.test(opnav) && /import HqNav, \{ useHqBar \} from "\.\/HqNav";/.test(opnav)
  && /export const useHqBar = \(\) => navOf\(usePathname\(\)\) === "hq";/.test(hq) && !/next\/navigation/.test(opnav));
ok("the HQ bar is the crew's: anyone else — and anyone not yet known — keeps the customer bar", /const access = enabled \? staffAccess\(!!user, profileStatus, profile\) : "anon";/.test(hq) && /case "allow": break;\n\s*case "wait": case "failed": case "deny": case "anon": return <BottomNav \/>;/.test(hq));
ok("…every verdict named — 'wait' and 'failed' aren't collapsed into a denial (the gate audit's rule)", ["allow", "wait", "failed", "deny", "anon"].every((v) => hq.includes(`case "${v}"`)));
ok("…it offers the console and the vision, nothing a guest orders from", /href: "\/crew"/.test(hq) && /href: "\/vision"/.test(hq) && !/\/menu|\/shop|\/truck|CartBar/.test(hq));
ok("…the console's shape and chrome: a named landmark, the current page said, a sidebar on the desk", /<nav className="nav opnav desk-sidebar" aria-label="GT3 HQ">/.test(hq) && /aria-current=\{on \? "page" : undefined\}/.test(hq));
ok("…a tap on another place ticks; on the place you're in, it goes to the top", /haptic\("selection"\)/.test(hq) && /scrollToTop\(\)/.test(hq));
ok("the bar is not the boundary: the vision still refuses anyone outside the crew", /const access = staffAccess\(!!user, profileStatus, profile\);/.test(page) && /access !== "allow" \?/.test(page) && /This is the crew&apos;s plan/.test(page));
console.log(`IMS7 — GT3 HQ OFF THE CUSTOMER BAR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
