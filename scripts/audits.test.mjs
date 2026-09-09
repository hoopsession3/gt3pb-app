// THE TWO AUDIT CLASSIFIERS, tested away from the filesystem.
//
// Both of these produce a number that gets quoted in a commit message and then believed. Three
// times in this audit a regex produced a confident number that was wrong in the alarming direction
// — "50 unguarded routes" was 0, "126 unnamed buttons" was 11, "5 audited tables" was 42. And the
// first version of render.audit.mjs reported 2 sync-to-prop where there are 5, because its rule
// only matched a single setState. So the rules get fixtures, and the fixtures are real code copied
// out of this repo rather than something shaped to pass.
import { classifyEffect, effectAt } from "./render.audit.mjs";
import { isFalseEmpty } from "./falseempty.audit.mjs";

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

console.log(`AUDIT CLASSIFIERS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
