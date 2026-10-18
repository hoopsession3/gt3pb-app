// R33 — WHAT THE SCREEN SAYS IS WHAT IS TRUE (2026-10-18 — the fresh 10/10 audit at R31: front end FE11-01, -02, -04, -05,
// -06, -07, -08; accessibility UX11-01).
//
// Run where a file runs alone, and read from the files where it doesn't:
//   1 · another key's answer is never shown as this one's: a month, a day or an order read before stays on screen only
//       while the new one comes — dimmed and said — and a read for the new one that fails is an error, not the old answer;
//   2 · a console link the router opens is the section it names, and its ?a= is read then — not at the next tap;
//   3 · money taken at the window offline is never dropped for its age, nor by the queue's cap;
//   4 · an editor reads and writes a stop's time on the business's clock, whatever the phone's zone;
//   5 · a sheet or a console section that throws steps aside and says so; with no signal, a sheet says it needs one;
//   6 · "On" for an iPhone's order alerts means the database kept the phone;
//   7 · what is said while a dialog is open is said inside it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { routeLoader } from "./fixtures/moneyWorld.mjs";
import { React, hookHost, settle, deferred } from "./fixtures/hookHost.mjs";
import { libLoader } from "./fixtures/chargeonce.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };

// ── 1 · another key's answer is never this one's ─────────────────────────────────────────────────────────────────────
{
  const load = routeLoader({ react: React, "@/lib/failureReport": { reportFailure: () => {} } });
  const A = load("lib/useAsyncData.ts");
  const asks = [];
  const loader = () => { const d = deferred(); asks.push(d); return d.promise; };
  const h = hookHost().mount((month) => A.useAsyncData(loader, [month]), "october");
  asks[0].resolve(["october's"]);
  await settle();
  ok("October answered: ready, not stale", h.value.status === "ready" && h.value.stale === false && JSON.stringify(h.value.data) === `["october's"]`);
  h.update("november");
  await settle();
  ok("› to November: October's rows stay while November's read is out — said to be another month's (stale) and refreshing",
    h.value.status === "ready" && h.value.stale === true && h.value.refreshing === true && JSON.stringify(h.value.data) === `["october's"]`, h.value);
  asks[1].reject(new Error("the read took too long"));
  await settle();
  ok("…and when November's read fails: an error, with nothing — never October's rows as November's answer (FE11-04)",
    h.value.status === "error" && h.value.data === null && h.value.error?.message === "the read took too long" && h.value.stale === false, { status: h.value.status, data: h.value.data });
  void h.value.reload();
  await settle();
  asks[2].resolve(["november's"]);
  await settle();
  ok("Try again: November's own rows, ready", h.value.status === "ready" && JSON.stringify(h.value.data) === `["november's"]` && h.value.stale === false);
  void h.value.reload();
  await settle();
  asks[3].reject(new Error("signal lost"));
  await settle();
  ok("a reload of the same month that fails keeps that month's rows, with its error (said: 'Couldn't refresh — showing what we had')",
    h.value.status === "ready" && JSON.stringify(h.value.data) === `["november's"]` && h.value.error?.message === "signal lost");
  const as = code(read("components/AsyncSection.tsx"));
  ok("AsyncSection: another key's answer is dimmed and busy with 'Loading…' said; a failed refresh says so with a Try again",
    /const note = state\.stale/.test(as) && /className=\{state\.stale \? "opacity-50 transition-opacity motion-reduce:transition-none" : undefined\} aria-busy=\{state\.stale \|\| undefined\}/.test(as)
    && /<Said as="span" assertive>Couldn&apos;t refresh — showing what we had\.<\/Said> <button type="button" className="btn-ter" onClick=\{state\.reload\}>Try again<\/button>/.test(as)
    && /<Said as="span">\{loadingLabel \?\? "Loading…"\}<\/Said>/.test(as));
  ok("the guest's order bar is a new bar for a new ticket — never the first order's number on the second", /<TicketBar key=\{lead\.t\} t=\{lead\.t\}/.test(read("components/GuestOrderBar.tsx")));
  ok("Prep: a new event or stop is a new PrepDetail — the first one's slow read lands on nothing (FE11-05)",
    /<PrepDetail key=\{`\$\{selected\.kind\}:\$\{selected\.id\}`\} target=\{selected\}/.test(read("app/crew/page.tsx")));
}

// ── 2 · a console link the router opens is that section, and its ?a= is read then ───────────────────────────────────
{
  const os = code(read("components/OperatorSection.tsx"));
  ok("the section provider follows the router's address (useSearchParams) in a Suspense of its own — no page drawn ahead of time waits on it",
    /function AddressWatch\(\{ onAddress \}/.test(os) && /const search = useSearchParams\(\)\?\.toString\(\) \?\? "";/.test(os)
    && /useEffect\(\(\) => \{ onAddress\(path, search\); \}, \[path, search, onAddress\]\);/.test(os)
    && /<Suspense fallback=\{null\}><AddressWatch onAddress=\{followAddress\} \/><\/Suspense>/.test(os));
  ok("…/crew?s=… opened from an alert or a link is that section; the query's move is counted (addressGen)",
    /if \(!path\.startsWith\("\/crew"\)\) return;/.test(os) && /if \(q && VALID\.has\(q as OpSection\) && q !== sectionRef\.current\) apply\(q as OpSection\);/.test(os)
    && /if \(lastSearch\.current !== null && lastSearch\.current !== search\) setAddressGen\(\(g\) => g \+ 1\);/.test(os)
    && /groupId, setGroupId: setGroup, addressGen \}\), \[section, setSection, back, canGoBack, groupId, setGroup, addressGen\]\)/.test(os));
  const page = code(read("app/crew/page.tsx"));
  ok("the console reads ?a= at every arrival (addressGen), and takes it out as it uses it — no once-per-load ref",
    !/consumedAnchorRef/.test(page) && /jumpTo\(home\.anchor \?\? a\);\s*\}, \[sec, setSection, addressGen\]\);/.test(page)
    && /const \{ section, setSection, groupId: navGroupId, setGroupId, addressGen \} = useOperatorSection\(\);/.test(page));
  ok("the iPhone's tapped alert and a universal link still go through the router (now heard)", /if \(to\) router\.push\(to\);/.test(read("components/NativeBridge.tsx")));
}

// ── 3 · money taken offline is never dropped for its age ─────────────────────────────────────────────────────────────
{
  const L = libLoader();
  const O = L("lib/offline.ts");
  const H = 3_600_000, t0 = 1_000_000_000;
  const q = [O.collectCupOp("cup-1", "cash", t0, "u"), O.orderStatusOp("cup-2", "void", t0, "new", "u"), O.orderStatusOp("cup-3", "done", t0, "making", "u")];
  const next = O.pruneStale(q, t0 + 15 * H);
  ok("fifteen hours later (the phone opened the next morning): the cash collection and the void are still to send; the status move isn't",
    JSON.stringify(next.map((x) => x.id)) === JSON.stringify(["cup-1", "cup-2"]), next);
  ok("…and a fresh status move still waits its six hours", O.pruneStale([O.orderStatusOp("cup-4", "done", t0, "making")], t0 + 5 * H).length === 1);
  let big = [O.collectCupOp("cash-first", "cash", t0)];
  for (let i = 0; i < 205; i++) big = O.enqueueOp(big, O.orderStatusOp(`o-${i}`, "done", t0 + i, "making"), 200);
  ok("past the queue's cap of two hundred, the oldest status moves go — money taken never does",
    big.length === 200 && big[0].id === "cash-first" && big.filter((x) => x.kind === "collect_cup").length === 1, { n: big.length, first: big[0].id });
  ok("isMoneyOp: a collection and a void are money; a status move isn't", O.isMoneyOp(q[0]) && O.isMoneyOp(q[1]) && !O.isMoneyOp(q[2]));
}

// ── 4 · an editor's day and clock are the business's ─────────────────────────────────────────────────────────────────
{
  const was = process.env.TZ;
  const D = libLoader()("lib/dates.ts");
  const at = (tz, f) => { process.env.TZ = tz; try { return f(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; } };
  for (const tz of ["America/Denver", "UTC", "Asia/Tokyo", "America/New_York"]) {
    const summer = at(tz, () => D.etInstantIso("2026-10-24", "11:00")), winter = at(tz, () => D.etInstantIso("2026-01-10", "11:00"));
    const back = at(tz, () => D.etClockHm(new Date("2026-10-24T15:00:00.000Z"))), day = at(tz, () => D.etDayKey(new Date("2026-10-25T03:30:00.000Z")));
    ok(`a phone in ${tz}: 11:00 on a Saturday in October is 15:00Z (EDT), in January 16:00Z (EST); 15:00Z reads 11:00; 03:30Z on the 25th is the 24th`,
      summer === "2026-10-24T15:00:00.000Z" && winter === "2026-01-10T16:00:00.000Z" && back === "11:00" && day === "2026-10-24", { summer, winter, back, day });
  }
  const editors = ["components/FieldOpSheet.tsx", "components/crew/OwnerDetails.tsx", "components/CompanyCalendar.tsx", "components/BrandCalendar.tsx"];
  const local = editors.filter((f) => /\.getHours\(\)|\.getMinutes\(\)|toLocaleDateString\("en-CA"\)|new Date\(`\$\{[a-zA-Z]+\}T\$\{[a-zA-Z]+\}(:00)?`\)/.test(code(read(f))));
  ok("no stop, content or task editor reads or writes a time in the phone's own zone", local.length === 0, local);
  ok("…the calendars read their days on the business's clock (etDayBoundsISO) and place a dated instant on its Eastern day",
    /etDayBoundsISO\(range\.start, range\.end\)/.test(read("components/CompanyCalendar.tsx")) && /etDayBoundsISO\(days\[0\], days\[41\]\)/.test(read("components/BrandCalendar.tsx"))
    && (read("components/CompanyCalendar.tsx").match(/push\(etDayKey\(new Date\(/g) || []).length === 4);
  ok("…and a plan's new stop is 11am Eastern in winter too (it was -04:00 always)", /etInstantIso\(String\(e\.date\), "11:00"\)/.test(read("app/api/agents/event-generate/route.ts"))
    && !/T11:00:00-04:00/.test(code(read("app/api/agents/event-generate/route.ts"))));
}

// ── 5 · a sheet or a section that throws steps aside ─────────────────────────────────────────────────────────────────
{
  const ts = code(read("components/TaskSheet.tsx")), rs = code(read("components/RecordSheet.tsx")), page = code(read("app/crew/page.tsx"));
  const sh = code(read("components/AppShell.tsx")), er = code(read("components/ErrorReporter.tsx"));
  ok("the task sheet and every record sheet are fenced by the shell: one that throws closes and says it didn't open",
    /\{target && \(fence \?\? bare\)\(<TaskSheetBody id=\{target\.id\} source=\{target\.source\} onClose=\{closeTask\} \/>, \{ name: "task-sheet", again: target, close: closeTask, what: "That task" \}\)\}/.test(ts)
    && /\{ref && \(fence \?\? bare\)\(<>[\s\S]*?<\/>, \{ name: `record:\$\{ref\.kind\}`, again: ref, close: closeRecord, what: "That record" \}\)\}/.test(rs)
    && /<Fence name=\{o\.name\} again=\{o\.again\} fallback=\{\(\) => <NotOpened open close=\{o\.close\} what=\{o\.what\} toast=\{toast\} \/>\}>\{sheet\}<\/Fence>/.test(sh)
    && /<TaskSheetProvider fence=\{sheetFence\}>/.test(sh) && /<RecordProvider fence=\{sheetFence\}>/.test(sh));
  ok("…handed in, not imported: neither sheet's module imports the fence (an import regrouped every route's download into one chunk more)",
    !/from "\.\/Fence"/.test(ts) && !/from "\.\/Fence"/.test(rs) && !/NotOpened/.test(ts + rs));
  ok("…and with no signal, a piece whose code was never fetched says it needs one — nothing reloads the tab mid-service",
    /const offline = typeof navigator !== "undefined" && navigator\.onLine === false;\s+toast\(offline \? `\$\{what\} needs a signal to open the first time — tap it again when you have bars\.` : `\$\{what\} didn't open — tap it again\.`, "error"\);/.test(sh)
    && /if \(typeof navigator !== "undefined" && navigator\.onLine === false\) return \{ reloading: false \};\s+if \(!plan\.reload\) return \{ reloading: false \};/.test(er));
  ok("each console section is fenced, with a Try again; the live control under the Pass has its own fence",
    /<Fence name=\{`section:\$\{sec\}`\} fallback=\{\(retry\) => \(/.test(page) && /<Fence name="live-control"><LiveControl compact \/><\/Fence>/.test(page));
}

// ── 6 · "On" means the database kept the phone ───────────────────────────────────────────────────────────────────────
{
  const N = routeLoader({ "@/lib/supabase": { supabase: null } })("lib/nativePush.ts");
  let heard = 0;
  let asked = 0;
  const off = N.onPhoneKept(() => { heard++; });
  const offPlugin = N.onNativePush(() => { asked++; });
  N.setPhoneKept("failed"); N.setPhoneKept("failed"); N.setPhoneKept("kept");
  offPlugin();
  off();
  ok("the phone's kept state: told once per change, read back — and to its own listeners only (a screen reading iOS's answer isn't sent to ask iOS again)",
    heard === 2 && asked === 0 && N.phoneKept() === "kept", { heard, asked, now: N.phoneKept() });
  const nb = code(read("components/NativeBridge.tsx")), aa = code(read("components/AppAlerts.tsx"));
  ok("the bridge hears iOS refuse a registration, sets kept from the database's answer, and asks again on the signal's return and at the front",
    /addListener\("registrationError", \(\) => setPhoneKept\("failed"\)\)/.test(nb)
    && /keepAppDevice\(pushToken\)\.then\(\(ok\) => \{ if \(live\) setPhoneKept\(ok \? "kept" : "failed"\); \}\)/.test(nb)
    && /window\.addEventListener\("online", again\);/.test(nb) && /document\.addEventListener\("visibilitychange", again\);/.test(nb));
  ok("Settings says On only when iOS said yes AND the phone was kept; otherwise saving, or not yet — and why",
    /const kept = useSyncExternalStore\(onPhoneKept, phoneKept, \(\) => "unknown" as const\);/.test(aa)
    && /state === "granted" && kept !== "kept" \? <span className="k-tag">\{kept === "failed" \? "Not yet" : "Saving"\}<\/span>/.test(aa));
}

// ── 7 · said inside the dialog that is open ──────────────────────────────────────────────────────────────────────────
{
  const an = code(read("components/Announcer.tsx"));
  ok("announce() speaks into the top open dialog's own regions while one is open, else the app's",
    /const top = modalStack\[modalStack\.length - 1\];\s*if \(top\) \{ top\(words, politeness\); return; \}/.test(an) && /export function ModalAnnouncer\(\)/.test(an)
    && /modalStack\.push\(say\);/.test(an) && /const i = modalStack\.lastIndexOf\(say\); if \(i >= 0\) modalStack\.splice\(i, 1\);/.test(an));
  const dialogs = { "components/Sheet.tsx": "sheet2 sheet-detent", "components/pass/ThePass.tsx": "pass-frame", "components/CommandPalette.tsx": "className=\"cmdk\" role=\"dialog\"", "components/PasswordRecovery.tsx": "qd-scrim" };
  const missing = Object.entries(dialogs).filter(([f, cls]) => { const c = read(f); const at = c.indexOf(cls); return at < 0 || c.indexOf("<ModalAnnouncer />", at) < 0 || c.indexOf("<ModalAnnouncer />", at) - at > 900; });
  ok("every aria-modal dialog that stays open draws its own regions: a sheet, the Pass, the palette, the password dialog", missing.length === 0, missing);
}

const pkg = JSON.parse(read("package.json"));
ok("npm test runs this file", /node scripts\/r33\.test\.mjs/.test(pkg.scripts.test));

console.log(`\nR33 — WHAT THE SCREEN SAYS IS WHAT IS TRUE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
