// R35 — EVERY FIELD SAYS WHAT IT IS (2026-10-19 — the fresh 10/10 audit at R31: accessibility UX11-07, -08, -09, -10 and
// -14; front end FE11-10, -11, -12 and -13).
//
//   1 · every field a screen draws has a name, and every sheet; a refusal is its field's, read with it; a gate holds both;
//   2 · the Studio feed's order moves without a drag — a tile's long press and the piece itself — and where it landed is said;
//   3 · two-step sign-in: a way to add it with no camera, the key copied, a pasted code with a space kept whole, the code
//       given where it's asked for, a turn-off that asks first and names what it costs, the copy that said two-step wasn't
//       in the app;
//   4 · the text size reaches the dialogs and banners drawn outside the page;
//   5 · Hide My Email on the web: the relay's risk said, with the way that doesn't need it;
//   6 · a channel's name is never a leaving channel's; Studio's history says when it couldn't be read; a renewed push
//       subscription is kept again; a navigation waits on the network for a deadline (public/sw.js — sw.test drives it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { libLoader } from "./fixtures/chargeonce.mjs";
import { routeLoader } from "./fixtures/moneyWorld.mjs";
import { unnamedFields, unnamedIn, UNNAMED_CEILING } from "./fields.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

// ── 1 · every field and every sheet has a name; a refusal is its field's ───────────────────────────────────────────
{
  const all = unnamedFields();
  ok("fields.audit: no field and no sheet on the screens has nothing naming it (101 fields and 2 sheets named) — held at zero", all.length === 0 && UNNAMED_CEILING === 0, all.slice(0, 8));
  const n = (src) => unnamedIn(src).length;
  ok("…the rule catches what it is for: a placeholder alone, a select with nothing, a sheet with no label — not a named one, a labelled one, a picker that isn't drawn",
    n('export const A = () => <input placeholder="Phone" />;') === 1 && n("export const A = () => <select value={x}><option /></select>;") === 1
    && n("export const A = () => <Sheet open onClose={c} header={<b>Hi</b>}>x</Sheet>;") === 1
    && n('export const A = () => <input aria-label="Phone" placeholder="Phone" />;') === 0 && n('export const A = () => <label>Phone <input /></label>;') === 0
    && n('export const A = () => <><label htmlFor="p">Phone</label><input id="p" /></>;') === 0 && n('export const A = () => <input type="file" hidden />;') === 0
    && n('export const A = () => <input type="file" style={{ display: "none" }} />;') === 0 && n('export const A = () => <Sheet open label="Drop" onClose={c}>x</Sheet>;') === 0
    && n("export const A = (p) => <input {...p} />;") === 0);
  const loc = read("components/crew/LocationEditor.tsx");
  ok("a vendor's point of contact says which field is the name, the phone and the email — filled, as it opens",
    /aria-label="Point of contact's name"/.test(loc) && /aria-label="Point of contact's phone"/.test(loc) && /aria-label="Point of contact's email"/.test(loc));
  const si = read("components/SignIn.tsx");
  ok("sign-in: a refusal is its fields' — invalid, and read with the code, the email, the password when the person goes back to them",
    /aria-describedby=\{err \? "auth-code-for auth-code-err" : "auth-code-for"\}\s+aria-invalid=\{err \? true : undefined\}/.test(si) && /id="auth-code-err"/.test(si)
    && /aria-invalid=\{err \? true : undefined\} aria-describedby=\{err \? "auth-email-err" : undefined\}/.test(si) && /id="auth-email-err"/.test(si)
    && (si.match(/aria-describedby=\{err \? "pw-err" : undefined\}/g) || []).length === 2 && /id="pw-err"/.test(si));
  const ts = read("components/TwoStepSetup.tsx"), tp = read("components/TwoStepPrompt.tsx"), del = read("components/DeleteAccount.tsx"), st = read("components/Studio.tsx");
  ok("…and two-step's code, the delete code and Studio's title the same",
    /aria-describedby=\{err \? "ts-code-for ts-err" : "ts-code-for"\} aria-invalid=\{err \? true : undefined\}/.test(ts) && (ts.match(/id="ts-err"/g) || []).length === 3
    && /aria-describedby=\{err \? "ts-code-for ts-err" : "ts-code-for"\} aria-invalid=\{err \? true : undefined\}/.test(tp) && /id="ts-err"/.test(tp)
    && /aria-describedby=\{codeErr \? "del-code-for del-code-err" : "del-code-for"\} aria-invalid=\{codeErr \? true : undefined\}/.test(del) && /id="del-code-err"/.test(del)
    && /aria-invalid=\{titleErr \? true : undefined\} aria-describedby=\{titleErr \? "studio-title-err" : undefined\}/.test(st) && /id="studio-title-err"/.test(st));
  ok("the street-address sheet and This week's drop say what they are (they were \"Dialog\"); a prompt's hint is read with its field",
    /<Sheet open onClose=\{onClose\} label=\{title\} header=\{/.test(read("components/InputSheet.tsx")) && /<Sheet open onClose=\{onClose\} label="This week’s drop"/.test(read("app/crew/page.tsx"))
    && (read("components/PromptSheet.tsx").match(/aria-describedby=\{hint \? hintId : undefined\}/g) || []).length === 2);
  ok("a Studio link that didn't take says so (an already-linked event, a refusal — it went in silence)",
    /if \(error\) \{ toast\(failureWords\(error, "Couldn't link it"\), "error"\); return; \}/.test(st) && !/if \(error\) return; \/\/ duplicate link or RLS/.test(st));
}

// ── 2 · the feed's order without a drag ─────────────────────────────────────────────────────────────────────────────
{
  const F = libLoader()("lib/feedOrder.ts");
  const ids = ["a", "b", "c", "d"];
  ok("a piece moves to the first place, one earlier, one later — and can't move past an end",
    F.movedFeed(ids, "c", "first").join() === "c,a,b,d" && F.movedFeed(ids, "c", "earlier").join() === "a,c,b,d" && F.movedFeed(ids, "c", "later").join() === "a,b,d,c"
    && F.movedFeed(ids, "a", "earlier") === null && F.movedFeed(ids, "a", "first") === null && F.movedFeed(ids, "d", "later") === null && F.movedFeed(ids, "z", "first") === null);
  ok("…its menu offers only the moves it can make, and where it is is said in words",
    F.feedMoves(ids, "a").map((m) => m.key).join() === "later" && F.feedMoves(ids, "b").map((m) => m.key).join() === "earlier,later"
    && F.feedMoves(ids, "d").map((m) => m.key).join() === "first,earlier" && F.feedMoves(["a"], "a").length === 0 && F.placeWords(ids, "c") === "3 of 4");
  const st = read("components/Studio.tsx");
  ok("Studio: each tile's long press offers Open and the moves; a move is said where it landed — only once the feed kept it",
    /<LongPress key=\{it\.id\} title=\{it\.title \|\| "Untitled"\} items=\{\[\{ key: "open", label: "Open", run: \(\) => setOpenId\(it\.id\) \}, \.\.\.moveIn\(it\.id\)\]\}>/.test(st)
    && /\{\.\.\.press\.bind\} className="ig-cell pressable"/.test(st) && /if \(next && \(await reorderFeed\(next\)\)\) announce\(`Moved to \$\{placeWords\(next, idv\)\}`\);/.test(st)
    && /return !refused;/.test(st) && /aria-label=\{`\$\{it\.title \|\| "Untitled"\}, \$\{placeWords\(feedIds, it\.id\)\} in the feed`\}/.test(st));
  ok("…and the piece itself shows its place and the same moves", /<div className="studio-sched" role="group" aria-label="Place in the feed">/.test(st)
    && /const place = feedIds\.includes\(openId\) \? \{ words: placeWords\(feedIds, openId\), moves: moveIn\(openId\) \} : null;/.test(st)
    && /drag a tile, or press and hold one, to plan the feed/.test(st));
}

// ── 3 · two-step sign-in, without a camera and without an accident ─────────────────────────────────────────────────
{
  const ts = read("components/TwoStepSetup.tsx"), tp = read("components/TwoStepPrompt.tsx");
  ok("the add-without-scanning link is on the web too, the key has a Copy button, and the QR fits a sheet at 200%",
    /<p className="mt-2"><a className="auth-link min-h-11 inline-flex items-center" href=\{enrol\.uri\}>Add it to an authenticator on this \{isNativeApp\(\) \? "iPhone" : "device"\}<\/a><\/p>/.test(ts)
    && !/\{isNativeApp\(\) && \(\s*<p className="mt-2"><a/.test(ts) && /navigator\.clipboard\.writeText\(enrol\.secret\)\.then\(\(\) => setCopied\(true\), pick\);/.test(ts)
    && /\{copied \? "Copied" : "Copy the key"\}/.test(ts) && /className="mt-3 rounded-xl bg-white p-3 max-w-full h-auto"/.test(ts));
  ok("a pasted \"123 456\" is kept whole — the field has room, its digits are taken (both code fields)",
    /maxLength=\{TOTP_LEN \+ 4\} aria-label=\{label\}/.test(ts) && /maxLength=\{TOTP_LEN \+ 4\} aria-label="The code from your authenticator"/.test(tp) && !/maxLength=\{TOTP_LEN\}/.test(ts + tp));
  const D = routeLoader({ react: { useEffect() {}, useState: (v) => [v, () => {}] }, "@/lib/supabase": { supabase: null } })("lib/twoStep.ts");
  ok("…digitsOf keeps six digits of whatever was pasted", D.digitsOf("123 456") === "123456" && D.digitsOf("12-34-56-78") === "123456");
  ok("who it's asked of: this sign-in's code given right there (it pointed at the console), the switch never dead",
    /if \(!state\.given && code\.length < TOTP_LEN\) \{ setErr\("Enter the code from your authenticator first — then the switch changes\."\);/.test(ts)
    && /const given = await giveCode\(supabase, code\);[\s\S]{0,200}const r = await setRequired\(supabase, on\);/.test(ts) && /disabled=\{busy\}\n/.test(ts) && !/in the crew console\) to change who/.test(ts));
  ok("turning it off asks first, and where the business asks it of every owner and admin, says the money and the books go with it",
    /const ok = await confirm\(\{\s+title: "Turn off two-step sign-in\?",/.test(ts) && /until you set one up again you have the crew's tools only — not the money, the books, customers or the crew's roles\./.test(ts)
    && /A password, or a code sent to your email, signs you in on its own again\./.test(ts) && /if \(!ok\) return;/.test(ts));
  ok("Integrations no longer says two-step is a developer's job in Supabase", !/a developer task today/.test(read("components/IntegrationsPanel.tsx"))
    && /Two-step sign-in is in the app: an owner or admin turns it on in Settings/.test(read("components/IntegrationsPanel.tsx")));
}

// ── 4 · the text size reaches what's drawn outside the page ────────────────────────────────────────────────────────
{
  const tw = read("app/tailwind.css"), sh = read("components/AppShell.tsx");
  ok("the discard card and ⌘K take the page's step, the offline and broadcast banners the bars', the password dialogs the root's",
    tw.includes(".app:is(.rd-t1,.rd-t2,.rd-t3,.rd-t4,.rd-t5,.rd-t6) :is(.sheet2-ask-card,.cmdk)>*{zoom:var(--rd-z)}")
    && tw.includes(".app:is(.rd-t1,.rd-t2,.rd-t3,.rd-t4,.rd-t5,.rd-t6) :is(.offline-bar,.bcast>*){zoom:var(--rd-bar-z)}") && tw.includes(".qd-body>*{zoom:var(--rd-root-z,1)}")
    && /document\.documentElement\.style\.setProperty\("--rd-root-z", String\(ZOOMS\[display\.scale\] \?\? 1\)\);/.test(sh));
}

// ── 5 · Hide My Email on the web ────────────────────────────────────────────────────────────────────────────────────
ok("a relay address on the web is told the code goes through Apple's relay, and the iPhone app's way",
  /\{relay && !appleHere && \(\s+<p className="dp-hint">\s+You joined with Apple&rsquo;s Hide My Email/.test(read("components/DeleteAccount.tsx")));

// ── 6 · channels, history, push, the worker ─────────────────────────────────────────────────────────────────────────
{
  const fu = read("components/FindUs.tsx"), tsb = read("components/TaskSheetBody.tsx"), st = read("components/Studio.tsx");
  ok("Find Us and the task sheet name their channels afresh (lib/realtime) — never a leaving channel's",
    /useRealtimeTable\(\["field_ops", "live_status"\], refreshQuietly\);/.test(fu) && !/\.channel\("find-us"\)/.test(fu)
    && /useRealtimeTable\(\{ table: source === "event" \? "event_tasks" : "todos", filter: `id=eq\.\$\{id\}` \}, reload\);/.test(tsb) && !/channel\(`task-/.test(tsb));
  ok("Studio's private room keeps its name (0428's rule) and lets a leaving room of that name go before it joins",
    /for \(const prior of sb\.getChannels\(\)\.filter\(\(c\) => c\.topic === topic\)\) await sb\.removeChannel\(prior\)\.catch\(\(\) => \{\}\);/.test(st)
    && /if \(!live\) return;\s+joined = join\(\);/.test(st) && /const ch = sb\.channel\(`studio-\$\{id\}`, \{ config: \{ private: true/.test(st));
  ok("Studio's history says it couldn't be read — not \"No versions yet\"",
    /\{versFailed && versions\.length === 0 \? \(\s+<EmptyState role="alert" title="Couldn't load the history"/.test(st));
  const push = read("lib/push.ts"), swr = read("components/ServiceWorkerRegister.tsx"), sw = read("public/sw.js");
  ok("a subscription that changed is kept again — on load when it isn't the one last kept, and when the worker says it was renewed",
    /export async function rekeepPush\(renewed = false\): Promise<boolean>/.test(push) && /if \(!renewed && last === sub\.endpoint\) return false;/.test(push)
    && /return await subscribePush\(false\);/.test(push) && /localStorage\.setItem\(KEPT, j\.endpoint\)/.test(push)
    && /void import\("@\/lib\/push"\)\.then\(\(m\) => m\.rekeepPush\(\)\)/.test(swr) && /if \(d\?\.type === "gt3-push-renewed"\) \{ void import\("@\/lib\/push"\)\.then\(\(m\) => m\.rekeepPush\(true\)\)/.test(swr)
    && /self\.addEventListener\("pushsubscriptionchange"/.test(sw));
  ok("a navigation waits on the network 3.5 seconds, then the cached page answers (sw.test drives it)", /const NAV_DEADLINE_MS = 3500;/.test(sw) && Number((sw.match(/const CACHE = "gt3pb-v(\d+)";/) || [])[1]) >= 30);   // R38: v31 (a later bump keeps it)
}

const pkg = JSON.parse(read("package.json"));
ok("npm test runs this file, and npm run audit runs fields.audit", /node scripts\/r35\.test\.mjs/.test(pkg.scripts.test) && /node scripts\/words\.audit\.mjs && node scripts\/fields\.audit\.mjs/.test(pkg.scripts.audit));

console.log(`\nR35 — EVERY FIELD SAYS WHAT IT IS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
