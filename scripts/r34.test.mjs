// R34 — HEARD, SEEN AND SAID PLAINLY (2026-10-18 — the fresh 10/10 audit at R31: accessibility UX11-02, -04, -05, -06,
// -11, -13 and -15).
//
//   1 · the crew's Day look draws its status words in its own ink — every one at 4.5:1 or more on the paper and the card;
//   2 · keyboard focus lands clear of the checkout's Pay footer, the calendar's month band and the Pass's bar;
//   3 · two-step's views take focus when the person's own tap brought them, and the console says it is opening;
//   4 · a failure or a warning line that appears is heard (spoken.audit's second count, held at zero), the display
//       sheet's toggles are 44pt;
//   5 · a failure is said in plain words — the database's and the network's machinery never reaches a person, and a
//       sign-in's refusal is a sentence with what to do next; every error toast passes a door that holds it to that, and
//       words.audit holds the screens at zero; the card pause points at paying at the truck; three writes that failed
//       in silence and said "done" say so;
//   6 · the shell carries each copy string's words, and the editor alone the names it gives them.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader } from "./fixtures/chargeonce.mjs";
import { silentIn, unheardIn, collect } from "./spoken.audit.mjs";
import { rawWords, rawWordsIn, RAW_BASELINE } from "./words.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const css = read("app/globals.css");

// ── 1 · the Day look's status words in its own ink ───────────────────────────────────────────────────────────────────
{
  const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const cr = (a, b) => { const la = L(a), lb = L(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  // The Day look's own values, read from the stylesheet (the .app.crew-day token block).
  const day = css.slice(css.indexOf("--gold:#86581f;"), css.indexOf("--gold:#86581f;") + 600);
  const tok = (name) => (new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`).exec(day) || [])[1];
  const red = tok("red-onLight"), warn = tok("warn"), okc = tok("ok");
  const paper = "#F4EEE2", card = "#FFFFFF";
  ok("the Day look's red, warning and ok inks are its own tokens", !!red && !!warn && !!okc, { red, warn, okc });
  const ratios = { red: [cr(hex(red), hex(paper)), cr(hex(red), hex(card))], warn: [cr(hex(warn), hex(paper)), cr(hex(warn), hex(card))], ok: [cr(hex(okc), hex(paper)), cr(hex(okc), hex(card))] };
  ok("…each reads 4.5:1 or more on the Day look's paper and its card (WCAG 1.4.3)", Object.values(ratios).flat().every((r) => r >= 4.5), ratios);
  ok("the twelve status words go to them in Day: go-live, workload, prep due and critical, funnel drop, brew delete, the planners' and the gear library's errors (red); DUE and the title hint (warning); prep approved and done (ok); the countdown (ink)",
    css.includes(".app.crew-day :is(.ev-golive.on .ev-golive-state,.wl-over,.pbd-due.over,.pbd-crit,.fn-drop,.brew-del,.dp-err,.gl-err){color:var(--red-onLight)}")
    && css.includes(".app.crew-day :is(.dops-owe,.studio-title-hint){color:var(--warn)}")
    && css.includes(".app.crew-day :is(.adm-approve.ok .adm-approve-h b,.cos-doneflag){color:var(--ok)}")
    && css.includes(".app.crew-day .brew-timer b{color:var(--cream)}"));
}

// ── 2 · focus clear of sticky chrome ─────────────────────────────────────────────────────────────────────────────────
ok("focus lands clear of the checkout's Pay footer, the calendar's month band and the Pass's bar (scroll-padding where each scrolls)",
  css.includes(".sheet2-body:has(.co-foot){scroll-padding-bottom:132px}") && css.includes(".body:has(.cal-sticky){scroll-padding-top:calc(env(safe-area-inset-top,0px) + 124px)}")
  && /\.svc-full\{position:fixed;inset:0;z-index:85;background:#0f0e0b;overflow-y:auto;scroll-padding-top:calc\(env\(safe-area-inset-top,0px\) \+ 64px\);/.test(css));

// ── 3 · two-step's views, and the console opening ────────────────────────────────────────────────────────────────────
{
  const ts = read("components/TwoStepSetup.tsx");
  ok("two-step: each view's first line takes focus — only a view the person's own tap brought (Settings opening takes nothing)",
    /useStepFocus\(step\.at, scope, \{ pick: \(\) => \(acted\.current \? scope\.current\?\.querySelector<HTMLElement>\("\.cfm-body"\) : null\) \}\);/.test(ts)
    // every view (R37 added the recovery codes'): one scope for each `if (step.at === …)` view, and the last, on
    && (ts.match(/acted\.current = true;/g) || []).length >= 5
    && (ts.match(/<div ref=\{scope\}>/g) || []).length === (ts.match(/^ {2}if \(step\.at === "/gm) || []).length + 1
    && (ts.match(/^ {2}if \(step\.at === "/gm) || []).length >= 4);
  const page = read("app/crew/page.tsx");
  ok("the console says it is opening while the session, the profile and two-step load — never a blank screen",
    (page.match(/<section className="screen"><PourFill label="Opening the console…" \/><\/section>/g) || []).length === 3 && !/return <section className="screen" \/>;/.test(page));
  ok("from the two-step prompt to the console, the console's section takes focus once (the code given, or Not now)",
    /const twoStepAskedRef = useRef\(false\);\s+useEffect\(\(\) => \{\s+if \(twoStep\.need === "code" \|\| twoStep\.need === "setup"\) \{ twoStepAskedRef\.current = true; return; \}\s+if \(twoStep\.need !== "none" \|\| !twoStepAskedRef\.current\) return;\s+twoStepAskedRef\.current = false;\s+opBodyRef\.current\?\.focus\(\{ preventScroll: true \}\);\s+\}, \[twoStep\.need\]\);/.test(page));
  const rv = read("components/ReviewPrompt.tsx"), vip = read("components/VipVerify.tsx");
  ok("a review sent: its thanks takes focus as it replaces the form; a VIP proof sent: its review line takes focus once",
    /useStepFocus\(done, scope, \{ pick: \(\) => \(done \? scope\.current : null\) \}\);/.test(rv) && /if \(done\) return <section ref=\{scope\} className="rvp rvp-done" aria-label="Feedback sent">/.test(rv)
    && /sentRef\.current = true;\s+reload\(\);/.test(vip) && /if \(!sentRef\.current \|\| shown !== "pending"\) return;\s+sentRef\.current = false;\s+waitRef\.current\?\.focus/.test(vip)
    && /<div ref=\{waitRef\} tabIndex=\{-1\} className="vipv wait">/.test(vip));
  ok("a sheet's Tab pulls focus that fell out of it back in, as the Pass's trap does",
    /if \(!scope\?\.contains\(at\)\) \{ e\.preventDefault\(\); \(e\.shiftKey \? last : first\)\.focus\(\); \}/.test(read("components/Sheet.tsx")));
}

// ── 4 · a failure line that appears is heard; the display sheet's toggles are 44pt ───────────────────────────────────
{
  const silent = collect(ROOT, silentIn), unheard = collect(ROOT, unheardIn);
  ok("spoken.audit: no failure line appears with no voice, and no live region arrives holding its words", silent.length === 0 && unheard.length === 0, { silent, unheard });
  ok("…the rule catches what it is for: a {err && <div className=\"dp-err\">{err}</div>} line, and not a Said or a line with a Said in it",
    silentIn('export const A = () => <div>{err && <div className="dp-err">{err}</div>}</div>;').length === 1
    && silentIn('export const A = () => <div>{err && <Said assertive className="dp-err">{err}</Said>}</div>;').length === 0
    && silentIn('export const A = () => <div>{bad && <div className="pr-note-err"><Said as="span">No.</Said> <button>Try again</button></div>}</div>;').length === 0
    && silentIn('export const A = () => <div>{x && <span className="mytask-pri warn">High</span>}</div>;').length === 0);
  ok("the display sheet's options and its reset are 44pt", /\.rdg-opt\{[^}]*min-height:44px/.test(css) && /\.rdg-reset\{min-height:44px;/.test(css));
}

// ── 5 · a failure in plain words ─────────────────────────────────────────────────────────────────────────────────────
{
  const F = libLoader()("lib/failureWords.ts");
  const cases = {
    rls: F.failureWords({ code: "42501", message: 'new row violates row-level security policy for table "events"' }, "Couldn't save"),
    jwt: F.failureWords({ message: "JWT expired" }, "Couldn't save"),
    net: F.failureWords({ message: "TypeError: Failed to fetch" }),
    dup: F.failureWords({ code: "23505", message: 'duplicate key value violates unique constraint "x_key"' }, "Couldn't add it"),
    ours: F.failureWords({ code: "22023", message: "The minimum is 3 gallons." }, "Couldn't change it"),
    route: F.failureWords("Only an owner or admin can add these to the calendar."),
    machine: F.failureWords({ message: 'column "totl_cents" does not exist' }, "Couldn't load"),
    none: F.failureWords(null),
  };
  ok("plain words: row security, an expired sign-in, no signal, a duplicate, the database's own sentence, a route's sentence, machinery, nothing",
    cases.rls === "Couldn't save — that isn't yours to change — an owner or admin can"
    && cases.jwt === "Couldn't save — your sign-in ran out — sign in again, then try once more"
    && cases.net === "No signal just now — try again in a moment." && cases.dup === "Couldn't add it — that's already there"
    && cases.ours === "Couldn't change it — The minimum is 3 gallons." && cases.route === "Only an owner or admin can add these to the calendar."
    && cases.machine === "Couldn't load — try again in a moment" && cases.none === "Try again in a moment.", cases);
  const auth = {
    rate: F.authWords({ message: "Email rate limit exceeded" }), wrong: F.authWords({ message: "Invalid login credentials" }),
    weak: F.authWords({ message: "Password should be at least 6 characters." }), expired: F.authWords({ message: "Token has expired or is invalid" }),
  };
  ok("a sign-in's refusal: too many tries, a wrong password, a weak one, a code run out — each a sentence with what to do next",
    auth.rate.startsWith("Too many tries just now") && auth.wrong === "Wrong email or password." && auth.weak.startsWith("Choose a stronger password")
    && auth.expired.startsWith("That code didn't work"), auth);
  const ap = read("components/AuthProvider.tsx");
  ok("every sign-in answer AuthProvider hands back is authWords', and the sign-in screen reads the wrong-password sentence by its words",
    !/error: error\.message/.test(ap) && (ap.match(/error: authWords\(error\)/g) || []).length === 8 && /error\.startsWith\("Wrong email or password"\)/.test(read("components/SignIn.tsx")));
  const raw = rawWords();
  ok("words.audit: no screen hands a person an error's raw text — a message, a route's or a helper's answer, an \"Error:\" — held at zero", raw.length === 0 && RAW_BASELINE === 0, raw.map(([f, n]) => `${f}:${n}`));
  const rule = (src) => rawWordsIn(src).length;
  ok("…the rule catches what it is for, and not a test of the words, a report or a plain-words call",
    rule("toast(error.message, \"error\");") === 1 && rule("setErr(`Couldn't save — ${error?.message ?? \"x\"}`);") === 1 && rule("setErr(j.error || \"Couldn't.\");") === 1
    && rule("toast(`Couldn't move it — ${r.error}`, \"error\");") === 1 && rule("toast(`Error: ${x}`, \"error\");") === 1
    && rule("toast(failureWords(error, \"Couldn't save\"), \"error\");") === 0 && rule("if (/limit/i.test(error.message)) return;") === 0
    && rule("console.warn(`x — ${error.message}`);") === 0 && rule("if (error.message.includes(\"x\")) return;") === 0 && rule("throw new Error(error.message);") === 0
    && rule("// raw words: our own sentence\n<p>{phase.message}</p>") === 0 && rule("toast(String(e.message).includes(\"x\") ? \"a\" : \"b\", \"error\");") === 0);
  ok("a write's failure (lib/wrote) is said in plain words too", /const words = plainFailure\(e\);/.test(read("lib/wrote.ts")));

  // The door: every error toast passes it.
  const door = {
    lead: F.sayable("Couldn't save — JWT expired"), alone: F.sayable("TypeError: Failed to fetch"), prefix: F.sayable("Error: new row violates row-level security policy for table \"events\""),
    ours: F.sayable("Square took too long to answer — nothing was charged. Try again."), plain: F.sayable("Couldn't add — that's already there"),
    chain: F.sayable("Didn't move Dana's porch — Load failed"), deep: F.sayable("Couldn't save — the road — column \"x\" does not exist"),
  };
  ok("the toast's door: our lead kept and the machine's words put plainly; a machine's toast alone said as a failure; our own sentences (\"took too long\") untouched",
    door.lead === "Couldn't save — your sign-in ran out — sign in again, then try once more" && door.alone === "No signal just now — try again in a moment."
    && door.prefix === "That isn't yours to change — an owner or admin can." && door.ours === "Square took too long to answer — nothing was charged. Try again."
    && door.plain === "Couldn't add — that's already there" && door.chain === "Didn't move Dana's porch — no signal just now — try again in a moment"
    && door.deep === "Couldn't save — the road — try again in a moment", door);
  const provider = read("components/AppProvider.tsx");
  ok("…and it is the toast itself: an error toast's words are sayable()'s before they are shown, timed or said",
    /const msg = variant === "error" \? sayable\(said\) : said;/.test(provider) && /import \{ sayable \} from "@\/lib\/failureWords";/.test(provider));
  ok("a section that failed to load says it plainly (AsyncSection), and a refused offline change too (lib/orderStatus)",
    /sub=\{errorSub \?\? failureWords\(state\.error\)\}/.test(read("components/AsyncSection.tsx")) && /r\.now === null \? plainFailure\(r\.reason\)/.test(read("lib/orderStatus.ts")));
  ok("failureOr: a route's sentence and the network's plain words, else the screen's own sentence",
    F.failureOr("The truck closed at 2:00 PM — it opens again at 11.", "x") === "The truck closed at 2:00 PM — it opens again at 11." && F.failureOr("Load failed", "x") === "No signal just now — try again in a moment."
    && F.failureOr('relation "orders" does not exist', "That didn't go through — give it another tap") === "That didn't go through — give it another tap" && F.failureOr("", "Fallback.") === "Fallback.");
  const R = libLoader()("lib/refusal.ts");
  ok("Postgres's own 42501 is said as what it means, ours as it is (lib/refusal)",
    R.refusalText({ code: "42501", message: 'new row violates row-level security policy for table "events"' }) === "That isn't yours to change — an owner or admin can."
    && R.refusalText({ code: "42501", message: "Only an owner or admin can add these." }) === "Only an owner or admin can add these.");
  ok("the machine's vocabulary is the machine's, and ours is ours",
    F.machineWords('function public.redeem(uuid) does not exist') && F.machineWords("Unexpected end of JSON input") && F.machineWords("Request failed with status code 502")
    && !F.machineWords("Your Daily Stack is saved") && !F.machineWords("Square took too long to answer") && !F.machineWords("A table for four is booked"));

  // The card pause points at the way still open.
  ok("a card pause names itself (paused) and the sheet says paying at the truck still works, when the truck takes it",
    /if \(paused\) return NextResponse\.json\(\{ error: paused, charged: false, paused: true \}, \{ status: 429 \}\);/.test(read("app/api/checkout/route.ts"))
    && /else if \(data\?\.paused && payLater\.on\) setErr\(`\$\{payErrorText\(data\.error\)\} Paying at the truck still works — tap “pay at the truck” below\.`\);/.test(read("components/Checkout.tsx")));

  // Three writes that failed and said "done".
  const crew = read("app/crew/page.tsx"), ops = read("components/OpsPlan.tsx");
  ok("a note's follow-ups that didn't save are said (not \"3 tasks → the note\"); a decision whose follow-through didn't save isn't logged without it",
    /const \{ rows: made, error: madeErr \} = await createEventTasks\(/.test(crew) && /tasksErr = madeErr;/.test(crew) && /didn't save \(\$\{plainFailure\(tasksErr\)\}\)/.test(crew)
    && /if \(fuErr \|\| !id\) \{ toast\(failureWords\(fuErr, "Nothing was logged — the follow-through couldn't be added"\), "error"\); return; \}/.test(crew));
  ok("a meeting note's op whose venue lookup failed creates nothing and says so (it ticked \"✓ Vendor created\")",
    /if \(r\.kind === "error"\) \{ toast\(failureWords\(r, `Nothing was created — couldn't look up \$\{name\} in the venue book`\), "error"\); return "failed"; \}/.test(ops)
    && (ops.match(/if \(vid === "asked" \|\| vid === "failed"\) return;/g) || []).length === 4 && !/if \(vid === "asked"\) return;/.test(ops));
}

// ── 6 · the shell carries the words, not the editor's names for them (PERF11-02's first item) ─────────────────────────
{
  const copy = read("lib/copy.ts"), fields = read("lib/copyFields.ts");
  const { routeLoader } = await import("./fixtures/moneyWorld.mjs");
  const L = routeLoader({ react: { useCallback: (f) => f, useEffect() {}, useState: (v) => [v, () => {}], useSyncExternalStore: () => null }, "@/lib/supabase": { supabase: null } });
  const C = L("lib/copy.ts"), F = L("lib/copyFields.ts");
  const keys = Object.keys(C.COPY_DEFAULTS);
  ok("every route's copy file holds each key and its default — no label, no group (39% of its download, read only by the editor)",
    !/\blabel: /.test(copy) && !/\bgroup: "/.test(copy) && /export const COPY_DEFAULTS: Record<string, string> = Object\.fromEntries\(COPY_DEFAULT_LIST\.map/.test(copy) && keys.length > 300);
  ok("…the editor's fields name those keys, each with its default, in the same order — the editor alone imports them",
    F.COPY_META.length === keys.length && F.COPY_META.every((m, i) => m.key === keys[i] && m.default === C.COPY_DEFAULTS[m.key] && m.label && m.group)
    && /import \{ COPY_META \} from "@\/lib\/copyFields";/.test(read("components/SiteCopyEditor.tsx")) && /export const COPY_META: CopyMeta\[\] = FIELDS\.map/.test(fields));
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (d) => readdirSync(join(ROOT, d)).flatMap((n) => { const p = join(d, n); return statSync(join(ROOT, p)).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : /\.(tsx?)$/.test(n) ? [p] : []; });
  const users = ["app", "components", "lib"].flatMap(walk).filter((f) => /from "(@\/lib\/|\.\/)copyFields"/.test(read(f)));
  ok("…and nothing else does", users.length === 1 && users[0] === "components/SiteCopyEditor.tsx", users);
}

const pkg = JSON.parse(read("package.json"));
ok("npm test runs this file, and npm run audit runs words.audit", /node scripts\/r34\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/spoken\.audit\.mjs && node scripts\/words\.audit\.mjs/.test(pkg.scripts.audit));

console.log(`\nR34 — HEARD, SEEN AND SAID PLAINLY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
