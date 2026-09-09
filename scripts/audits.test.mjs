// THE AUDIT CLASSIFIERS, tested away from the filesystem.
//
// Both of these produce a number that gets quoted in a commit message and then believed. Three
// times in this audit a regex produced a confident number that was wrong in the alarming direction
// — "50 unguarded routes" was 0, "126 unnamed buttons" was 11, "5 audited tables" was 42. And the
// first version of render.audit.mjs reported 2 sync-to-prop where there are 5, because its rule
// only matched a single setState. So the rules get fixtures, and the fixtures are real code copied
// out of this repo rather than something shaped to pass.
import { classifyEffect, effectAt } from "./render.audit.mjs";
import { isFalseEmpty, catchesButHides } from "./falseempty.audit.mjs";
import { refusalHeadings, refusesWithoutPolicy, collapsesVerdicts } from "./gate.audit.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };

// ── classifyEffect ─────────────────────────────────────────────────────────────────────────────
// Real bodies, lifted from the files named beside them.
ok("client-read: localStorage (components/Kds muted flag)",
  classifyEffect(`(() => { try { setMuted(localStorage.getItem("kds_muted") === "1"); } catch {} }, [])`) === "client-read");
ok("client-read: a clock", classifyEffect(`(() => { setNow(new Date()); }, [])`) === "client-read");

ok("data-load: the plain load() effect",
  classifyEffect(`(() => { load(); }, [load])`) === "data-load");
ok("data-load: an inline supabase read (app/3mpire/page.tsx:43)",
  classifyEffect(`(() => { supabase.from("orders").select("*").then(({ data }) => setOrders(data)); }, [user])`) === "data-load");
ok("data-load beats client-read when the effect does both — a loader that also reads localStorage is still a loader",
  classifyEffect(`(() => { const k = localStorage.getItem("k"); load(k); }, [load])`) === "data-load");

ok("sync-to-prop: one setter (components/MenuManager.tsx:81)",
  classifyEffect(`(() => { setD(p); }, [p])`) === "sync-to-prop");
ok("sync-to-prop: THREE setters from the same prop (components/MerchManager.tsx:154) — the case the first rule missed",
  classifyEffect(`(() => { setD(p); setPriceStr((p.price_cents / 100).toFixed(2)); setMedia(readMedia(p)); }, [p])`) === "sync-to-prop");
ok("sync-to-prop: two deps is not the shape",
  classifyEffect(`(() => { setD(p); }, [p, q])`) === "needs-a-person");
ok("sync-to-prop: a setter that does not read the dep is not the shape",
  classifyEffect(`(() => { setOpen(false); }, [p])`) === "needs-a-person");
ok("a body doing real work is left for a person",
  classifyEffect(`(() => { if (!ref.current) return; observer.observe(ref.current); setSeen(true); }, [])`) === "needs-a-person");
ok("no body at all is left for a person", classifyEffect(null) === "needs-a-person");

// effectAt has to survive braces inside strings, which is what broke the first splitter in 0284.
{
  const src = [
    `function C() {`,
    `  useEffect(() => {`,
    `    setLabel("a } brace in a string");`,
    `  }, []);`,
    `}`,
  ].join("\n");
  const e = effectAt(src, 3);
  ok("effectAt: a brace inside a string literal does not end the effect",
    !!e && /a \} brace in a string/.test(e.body) && e.body.trim().endsWith("[])"), e?.body);
}

// ── isFalseEmpty ───────────────────────────────────────────────────────────────────────────────
const n3 = (...l) => [l[0] ?? "", l[1] ?? "", l[2] ?? ""];

ok("false-empty: the real shape (app/crew/page.tsx:1243)",
  isFalseEmpty(`    const { data } = await supabase.from("incident_log").select("id, problem");`,
    n3(`    setRows((data as Inc[]) ?? []);`)) === true);
ok("false-empty: the .then form (app/crew/page.tsx:3545)",
  isFalseEmpty(`  supabase.from("profiles").select("id").then(({ data }) => setStaff((data as P[]) ?? []));`, n3()) === true);
ok("false-empty: a renamed binding still hides the error",
  isFalseEmpty(`    const { data: p } = await supabase.from("profiles").select("id, display_name");`,
    n3(`    setStaff((p as P[]) ?? []);`)) === true);

// The negatives are the whole point: this must not flag code that already handles failure.
ok("NOT flagged: error is captured (components/Reserves.tsx:31)",
  isFalseEmpty(`    const { data, error } = await supabase.from("reserves").select("*");`,
    n3(`    if (error) { setLoadFailed(true); return; }`, `    setReserves((data as Reserve[]) ?? []);`)) === false);
ok("NOT flagged: the fixed loadOnHand (app/crew/page.tsx)",
  isFalseEmpty(`    const { data, error } = await supabase.from("inventory_ledger").select("item, qty");`,
    n3(`    if (error) { setOnHandFailed(true); return; }`)) === false);
ok("NOT flagged: an unchecked read that is NOT coalesced into state",
  isFalseEmpty(`    const { data } = await supabase.from("x").select("*");`,
    n3(`    if (!data) throw new Error("missing");`, `    return data;`)) === false);
ok("NOT flagged: a coalesce with no read on the line",
  isFalseEmpty(`    setRows(rows ?? []);`, n3()) === false);
ok("NOT flagged: a line that never touches supabase",
  isFalseEmpty(`    const { data } = await fetch("/api/x").then((r) => r.json());`,
    n3(`    setRows(data ?? []);`)) === false);
ok("NOT flagged: the read is coalesced but nothing is set within reach",
  isFalseEmpty(`    const { data } = await supabase.from("x").select("*");`,
    n3(`    const list = data ?? [];`, `    // ... 20 lines later`, `    return list;`)) === false);

// ── catchesButHides ────────────────────────────────────────────────────────────────────────────
// This rule exists because I walked into the hole it guards: three components were converted to
// useAsyncData, the first count dropped, and every render still did `state.data ?? []` — the read
// was honest and the screen still lied. Catching an error is not showing it.
ok("hides: useAsyncData with data ?? [] and nothing else",
  catchesButHides(`const s = useAsyncData(loader, []); const rows = s.data ?? []; return <ul>{rows.map(r => <li/>)}</ul>;`) === true);
ok("shows: AsyncSection renders the failure",
  catchesButHides(`const s = useAsyncData(loader, []); return <AsyncSection state={s} emptyTitle="None">{(d) => null}</AsyncSection>;`) === false);
ok("shows: an explicit status === \"error\" branch",
  catchesButHides(`const s = useAsyncData(loader, []); if (s.status === "error") return <Err/>; return null;`) === false);
ok("shows: reading .error directly",
  catchesButHides(`const s = useAsyncData(loader, []); return s.error ? <Err/> : null;`) === false);
ok("handling only 'loading' is NOT handling failure (components/PrimalLesson.tsx)",
  catchesButHides(`const b = useAsyncData(loader, []); if (b.status === "loading") return <Spin/>; return <X d={b.data}/>;`) === true);
ok("a file that never loads anything is not in scope",
  catchesButHides(`export function Static() { return <p>hi</p>; }`) === false);

// ── the gate audit ─────────────────────────────────────────────────────────────────────────────
// This rule caught a real bug on its first run: app/architecture said "Owners only" on
// roleOf(profile) === "owner", so the owner was refused the owner-only page while his profile
// loaded. The sweep that fixed crew, scan, academy and driver had missed it, because a sweep finds
// what you thought to look for. That is the whole argument for the rule.
ok("refusal heading is recognised (app/scan/page.tsx:68)",
  refusalHeadings(`<div className="h-title">Staff only</div>`).length === 1);
ok("refusal heading with a trailing period (app/crew/page.tsx:5375)",
  refusalHeadings(`<div className="h-title">Staff only.</div>`).length === 1);
ok("the exact heading that was live in app/architecture",
  refusalHeadings(`<div className="h-title">Owners only</div>`).length === 1);
ok("an ordinary page heading is not a refusal (app/academy/page.tsx:158)",
  refusalHeadings(`<h1 className="h-title">GT3 Academy</h1>`).length === 0);
ok("a styled heading with an interpolated title is not a refusal",
  refusalHeadings(`<h1 className="h-title" style={{ fontSize: 28 }}>{m.title}</h1>`).length === 0);

ok("caught: refusing with no policy import",
  refusesWithoutPolicy(`<div className="h-title">Staff only</div>`) === true);
ok("passes: the same refusal routed through lib/access",
  refusesWithoutPolicy(`import { staffAccess } from "@/lib/access";\n<div className="h-title">Staff only</div>`) === false);
ok("passes: a relative import of the same module",
  refusesWithoutPolicy(`import { staffAccess } from "../lib/access";\n<div className="h-title">Staff only</div>`) === false);
// The three strings that made "ban every occurrence of 'Staff only'" the wrong rule. None of them
// is aimed at the reader, and a rule that failed on all three would have been suppressed by now.
ok("not a refusal: an audience <option> (components/AssignTaskSheet.tsx:84)",
  refusesWithoutPolicy(`<option value="leadership">Leadership only</option>`) === false);
ok("not a refusal: a broadcast audience label (components/BroadcastEditor.tsx:21)",
  refusesWithoutPolicy(`const AUDIENCES = [["all","Everyone"],["staff","Staff only"]] as const;`) === false);
ok("not a refusal: a toast quoting the server's own refusal (components/crew/LiveControl.tsx:73)",
  refusesWithoutPolicy(`toast(error.message.includes("not authorized") ? "Go live failed — your account isn't an owner/admin." : "x");`) === false);

// The second measure — importing the fix is not the same as respecting it.
ok("caught: isAllowed() as the only check collapses wait and failed back into deny",
  collapsesVerdicts(`import { staffAccess, isAllowed } from "@/lib/access";\nconst a = staffAccess(u, s, p); if (!isAllowed(a)) return <StaffOnly/>;`) === true);
ok("caught: handling 'wait' but not 'failed' — a failed read still reads as a refusal",
  collapsesVerdicts(`import { staffAccess } from "@/lib/access";\nconst a = staffAccess(u, s, p); if (a === "wait") return null;`) === true);
ok("passes: both non-denial verdicts named (app/driver/page.tsx:23)",
  collapsesVerdicts(`import { staffAccess } from "@/lib/access";\nconst a = staffAccess(u, s, p);\nreturn a === "wait" || a === "failed" ? <Checking/> : null;`) === false);
ok("out of scope: importing only the type, never computing a verdict",
  collapsesVerdicts(`import type { Access } from "@/lib/access";\nexport function f(a: Access) { return a; }`) === false);
ok("out of scope: a file that never touches lib/access",
  collapsesVerdicts(`export function Static() { return <p>hi</p>; }`) === false);

console.log(`AUDIT CLASSIFIERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
