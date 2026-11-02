// IMS8 P13 — NOT KNOWN IS NOT SIGNED OUT. Found chasing an intermittent console-walk failure: a signed-in crew member's
// /vision showed "Sign in with your crew account" — pixel for pixel what the server renders before the app has read the
// session, because the page drew the sign-in form whenever `user` was null, including while the session was still unread.
// The console has waited for the session since R34; the vision and the driver's run now do too. And the console walk,
// when a screen isn't drawn, now says why (what the screen said, whether the app had started, the session on the phone,
// the document's and slow files' timing, the sign-in calls) instead of a screenshot alone.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got).slice(0, 300)}` : "")); } };

for (const [f, label] of [["app/vision/page.tsx", "Opening the vision…"], ["app/driver/page.tsx", "Opening your run…"]]) {
  const s = read(f);
  const iReady = s.indexOf("{!ready ? ("), iSignIn = s.indexOf("<SignIn");
  ok(`${f}: reads whether the session is known`, /const \{ ready, user, profile, enabled, profileStatus \} = useAuth\(\);/.test(s));
  ok(`${f}: until it is, says it's opening (a status, PourFill) — before any sign-in form`, iReady > 0 && iSignIn > iReady && s.includes(`<PourFill label="${label}" />`));
  ok(`${f}: the sign-in form only once the session is known and there's none`, /\) : !user \? \(\s*\n\s*<div className="driver-empty"><SignIn/.test(s));
}
const crew = read("app/crew/page.tsx");
ok("the console already waited (R34) — the three crew doors now agree", crew.indexOf("if (!ready) return") > 0 && crew.indexOf("if (!ready) return") < crew.indexOf("if (!user) return <SignIn"));
const h = read("scripts/smoke.console.mjs");
ok("the console walk diagnoses a screen that isn't drawn: what it said, whether the app started, the session (never a token), timings, sign-in calls", /NOT DRAWN, DIAGNOSED/.test(h) && /-diagnosis\.json/.test(h) && /says: \/Sign in with your crew account\//.test(h) && /started: /.test(h) && /signInCalls: fb\.calls/.test(h) && !/access_token\s*[:,]/.test(h.slice(h.indexOf("NOT DRAWN, DIAGNOSED"), h.indexOf("NOT DRAWN, DIAGNOSED") + 3000)));
ok("…read after the fact: the run itself is unchanged (no waits or retries added; the assertion is the same)", /ok\(`\$\{tag\} · drawn`, drawn, /.test(h) && (h.match(/waitForSelector\(v\.ready, \{ timeout: 15000 \}\)/g) || []).length === 1);

console.log(`IMS8 P13 — NOT KNOWN IS NOT SIGNED OUT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
