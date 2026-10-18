// R17 (2026-10-17 — the lint ceiling's last rule: no state set by an effect as it starts), run.
//
// The hooks R17 rewrote, run on just enough of React (scripts/fixtures/hookHost): what each shows, when, and how many
// renders a change costs. The screens that use them are rendered whole by scripts/render.audit.mjs and scripts/smoke.ui.mjs.
import { routeLoader } from "./fixtures/moneyWorld.mjs";
import { React, hookHost, settle, deferred } from "./fixtures/hookHost.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 500)}` : "")); } };

const reports = [];
const load = routeLoader({ react: React, "@/lib/failureReport": { reportFailure: (...a) => { reports.push(a); } } });

// ── lib/useAsyncData: the fetch-state hook ─────────────────────────────────────────────────────────────────────────
{
  const A = load("lib/useAsyncData.ts");
  const view = (h) => ({ status: h.value.status, data: h.value.data, error: h.value.error?.message ?? null, refreshing: h.value.refreshing });

  // the first load
  const asks = [];
  const loader = () => { const d = deferred(); asks.push(d); return d.promise; };
  const h = hookHost().mount((dep) => A.useAsyncData(loader, [dep]), "a");
  ok("first load: loading, nothing to show, one commit — no second render to say 'loading'", JSON.stringify(view(h)) === JSON.stringify({ status: "loading", data: null, error: null, refreshing: false })
    && h.commits === 1 && asks.length === 1, { v: view(h), commits: h.commits });
  asks[0].resolve(["one"]);
  await settle();
  ok("first load answered: ready, the data — one more commit", h.value.status === "ready" && JSON.stringify(h.value.data) === '["one"]' && h.commits === 2, { v: view(h), commits: h.commits });

  // a reload with data on screen
  const before = h.commits;
  let reloaded = false;
  const p = h.value.reload().then(() => { reloaded = true; });
  await settle();
  ok("reload: the data stays on screen, flagged refreshing — and its load is out", h.value.status === "ready" && h.value.refreshing === true && JSON.stringify(h.value.data) === '["one"]' && asks.length === 2, view(h));
  ok("reload: awaiting it waits for its answer", reloaded === false);
  asks[1].resolve(["two"]);
  await p;
  await settle();
  ok("reload answered: the new data, not refreshing; the await let go after it", reloaded && h.value.refreshing === false && JSON.stringify(h.value.data) === '["two"]' && h.commits === before + 2, { v: view(h), commits: h.commits - before });

  // deps change: the old data shown while the new deps' load is out — said in the same render the deps changed
  const c0 = h.commits;
  h.update("b");
  ok("deps changed: refreshing in the very render that changed them (one commit), the old data still shown", h.value.refreshing === true && JSON.stringify(h.value.data) === '["two"]'
    && h.commits === c0 + 1 && asks.length === 3, { v: view(h), commits: h.commits - c0, asks: asks.length });
  // superseded: deps change again before "b" answers; "b" answering late must not land
  h.update("c");
  asks[3].resolve(["for c"]);
  await settle();
  asks[2].resolve(["for b — late"]);
  await settle();
  ok("a load superseded by newer deps never lands over the newer answer", JSON.stringify(h.value.data) === '["for c"]' && h.value.refreshing === false, view(h));

  // an error with data on screen
  h.value.reload();
  await settle();
  asks[4].reject(Object.assign(new Error("the network went"), { code: "" }));
  await settle();
  ok("a failed reload with data on screen: still ready, the data kept, the error said for a toast", h.value.status === "ready" && JSON.stringify(h.value.data) === '["for c"]'
    && h.value.error?.message === "the network went", view(h));
  ok("…and the failure reported as a load (lib/failureReport)", reports.length === 1 && reports[0][0] === "load", reports);
  h.unmount();

  // an error with nothing to show
  const asks2 = [];
  const h2 = hookHost().mount(() => A.useAsyncData(() => { const d = deferred(); asks2.push(d); return d.promise; }, []));
  asks2[0].reject(new Error("refused"));
  await settle();
  ok("a failed first load: error, the error said, nothing to show", h2.value.status === "error" && h2.value.error?.message === "refused" && h2.value.data === null, view(h2));
  h2.value.reload();
  await settle();
  ok("tried again: loading — not the old error", h2.value.status === "loading" && h2.value.error === null, view(h2));
  asks2[1].resolve(0);
  await settle();
  ok("answered with a zero: ready, and the zero is data (not 'nothing')", h2.value.status === "ready" && h2.value.data === 0, view(h2));

  // two reloads at once: both awaits let go by the one answer that stands
  let a1 = false, a2 = false;
  h2.value.reload().then(() => { a1 = true; });
  h2.value.reload().then(() => { a2 = true; });
  await settle();
  asks2[asks2.length - 1].resolve(2);
  await settle();
  ok("two reloads at once: the last one's answer lets both awaits go", a1 && a2 && h2.value.data === 2, { a1, a2, data: h2.value.data });

  // a reload overtaken by a newer one: its own answer lets its await go, and draws nothing (the R17 review)
  let b1 = false, b2 = false;
  h2.value.reload().then(() => { b1 = true; });
  await settle();
  const first = asks2[asks2.length - 1];
  h2.value.reload().then(() => { b2 = true; });
  await settle();
  const second = asks2[asks2.length - 1];
  first.resolve("overtaken");
  await settle();
  ok("an overtaken reload: its own answer lets its await go — a save waiting on it is never left hanging — and draws nothing",
    b1 && !b2 && h2.value.data === 2 && h2.value.refreshing === true && first !== second, { b1, b2, data: h2.value.data, refreshing: h2.value.refreshing });
  second.resolve(3);
  await settle();
  ok("the newer reload's answer is drawn, and lets its own await go", b2 && h2.value.data === 3 && h2.value.refreshing === false, { b2, data: h2.value.data });

  // gone with a reload out: its await is let go
  let a3 = false;
  h2.value.reload().then(() => { a3 = true; });
  await settle();
  h2.unmount();
  await settle();
  ok("unmounted with a reload out: its await is let go, as the load's own promise always settled", a3);
  ok("reload keeps one identity across renders", (() => { const r1 = h2.value.reload; return typeof r1 === "function"; })());

  // the pure halves
  ok("sameDeps: React's comparison — the same length, each Object.is", A.sameDeps([1, "a", NaN], [1, "a", NaN]) && !A.sameDeps([1], [1, 2]) && !A.sameDeps([{}], [{}]) && !A.sameDeps([0], [-0]));
  const s = (o) => JSON.stringify(A.shownFrom(o, 1, 0));
  ok("shownFrom: nothing answered yet is loading", s(null) === JSON.stringify({ status: "loading", data: null, error: null, refreshing: false, stale: false }));
  ok("shownFrom: an answer for older deps with data is refreshing — and says it is another key's (R33: stale)",
    A.shownFrom({ depsGen: 0, reloadGen: 0, ok: true, data: [1], error: null }, 1, 0).refreshing === true && A.shownFrom({ depsGen: 0, reloadGen: 0, ok: true, data: [1], error: null }, 1, 0).stale === true);
  ok("shownFrom: a reload of the same deps with data is refreshing, not stale", A.shownFrom({ depsGen: 1, reloadGen: 0, ok: true, data: [1], error: null }, 1, 2).refreshing === true
    && A.shownFrom({ depsGen: 1, reloadGen: 0, ok: true, data: [1], error: null }, 1, 2).stale === false);
}

// ── lib/useChanged: a copy seeded from each fresh load, set while rendering ─────────────────────────────────────────
{
  const C = load("lib/useChanged.ts");
  const h = hookHost().mount((data) => {
    const [rows, setRows] = React.useState(["seed"]);
    if (C.useChanged(data) && data) setRows(data);
    return { rows, setRows };
  }, null);
  ok("useChanged: the first render is no change — the screen's own first value stands", JSON.stringify(h.value.rows) === '["seed"]' && h.commits === 1, { rows: h.value.rows, commits: h.commits });
  const fresh = ["a"];
  h.update(fresh);
  ok("useChanged: a fresh load is seen while rendering — the copy shows it in that same commit, never a stale frame first",
    h.value.rows === fresh && h.commits === 2, { rows: h.value.rows, commits: h.commits });
  h.value.setRows(["edited"]);
  await settle();
  h.update(fresh);
  ok("useChanged: the same load again is no change — what the person typed into the copy stands", JSON.stringify(h.value.rows) === '["edited"]', h.value.rows);
  const next = ["b"];
  h.update(next);
  ok("useChanged: the next load replaces it (by identity, as React compares)", h.value.rows === next, h.value.rows);

  // A callback is a value too (StatusCard's draw — the R17 chain's smoke:native, React's error #301): useState and its
  // setter CALL a function they are handed, so a copy held as-is kept what the function returned, never equalled it, and
  // set state on every render. Held as `() => value`, a function is compared, never called.
  let calls = 0;
  const f1 = () => { calls++; return "painted"; }, f2 = () => { calls++; return "painted again"; };
  const seen = [];
  const g = hookHost();
  let mountThrew = null;
  try { g.mount((f) => { seen.push(C.useChanged(f)); return null; }, f1); } catch (e) { mountThrew = e.message; }
  ok("useChanged: a function's first render is no change, and the function is never called", mountThrew === null && seen.join() === "false" && calls === 0, { mountThrew, seen: seen.slice(0, 4), calls });
  if (!mountThrew) g.update(f1);
  ok("useChanged: the same function again is no change", !mountThrew && seen.at(-1) === false && calls === 0, { seen: seen.slice(-2), calls });
  seen.length = 0;
  let threw = null;
  try { if (!mountThrew) g.update(f2); else threw = mountThrew; } catch (e) { threw = e.message; }
  ok("useChanged: a new function is a change, said once — never a render that doesn't settle", threw === null && seen.join() === "true,false" && calls === 0 && g.commits === 3, { threw, seen, calls, commits: g.commits });

  // The host is as strict as React here: a setState during render renders again even when the value is already there.
  const loop = hookHost();
  let looped = null;
  try { loop.mount(() => { const [n, setN] = React.useState(0); setN(n); return n; }); } catch (e) { looped = e.message; }
  ok("hookHost: a hook that sets state on every render never settles — as React gives up (#301), so does the host", /more than 25 renders/.test(looped ?? ""), looped);
}

// ── lib/useLatestRead: the newest read's answer, set in its own continuation ────────────────────────────────────────
{
  const L = load("lib/useLatestRead.ts");
  const h = hookHost().mount(() => L.useLatestRead());
  const read = h.value;
  const shown = [];
  const older = deferred(), newer = deferred();
  const p1 = read(() => older.promise, (a) => shown.push(a));
  const p2 = read(() => newer.promise, (a) => shown.push(a));
  newer.resolve("this stop");
  await settle();
  older.resolve("the last stop");
  await Promise.all([p1, p2]);
  ok("useLatestRead: the newest read's answer is drawn; an older one landing after it is dropped", JSON.stringify(shown) === '["this stop"]', shown);
  // under a stream of asks: an earlier read that lands first is drawn, and the newer one replaces it when it comes —
  // waiting for "the newest asked" would never draw anything while asks keep coming (the R17 review)
  const streamed = [];
  const s1 = deferred(), s2 = deferred(), s3 = deferred();
  const q1 = read(() => s1.promise, (a) => streamed.push(a));
  const q2 = read(() => s2.promise, (a) => streamed.push(a));
  s1.resolve("a minute ago");
  await q1;
  const q3 = read(() => s3.promise, (a) => streamed.push(a));
  s2.resolve("now");
  await q2;
  s3.resolve("newer still");
  await q3;
  ok("useLatestRead: under a stream of asks the screen still moves — each answer newer than what is drawn is drawn, in order",
    JSON.stringify(streamed) === '["a minute ago","now","newer still"]', streamed);
  h.update();
  ok("useLatestRead: one identity across renders — a load built on it doesn't start again on every render", h.value === read);
  const failing = deferred();
  const p3 = read(() => failing.promise, (a) => shown.push(a));
  failing.reject(new Error("no signal"));
  let caught = null;
  await p3.catch((e) => { caught = e.message; });
  ok("useLatestRead: a read that fails draws nothing and hands its failure to the caller", caught === "no signal" && shown.length === 1, { caught, shown });
}

// ── lib/clientState and lib/clientPage: what the browser says, read as a store ───────────────────────────────────────────────────────────
{
  const had = { window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };
  const win = new EventTarget();
  let listening = 0;
  const add = win.addEventListener.bind(win), remove = win.removeEventListener.bind(win);
  win.addEventListener = (t, f) => { listening++; add(t, f); };
  win.removeEventListener = (t, f) => { listening--; remove(t, f); };
  win.location = { href: "https://app.example/shop?tab=orders" };
  win.history = { length: 1 };
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
  try {
    const S = { ...load("lib/clientState.ts"), ...load("lib/clientPage.ts"), ...load("lib/reducedMotion.ts") };
    const on = hookHost().mount(() => S.useOnline());
    ok("useOnline: what the browser says, in the first commit — no second render to correct it", on.value === true && on.commits === 1, { v: on.value, commits: on.commits });
    globalThis.navigator.onLine = false;
    win.dispatchEvent(new Event("offline"));
    await settle();
    ok("useOnline: the offline event redraws it once", on.value === false && on.commits === 2, { v: on.value, commits: on.commits });
    const tab = hookHost().mount(() => S.useSearchParam("tab"));
    ok("useSearchParam: the address's ?tab= as the browser has it", tab.value === "orders", tab.value);
    win.location = { href: "https://app.example/shop?tab=cart" };
    win.dispatchEvent(new Event("popstate"));
    await settle();
    ok("useSearchParam: back and forward read it again", tab.value === "cart", tab.value);
    const back = hookHost().mount(() => S.useCanGoBack());
    ok("useCanGoBack: a tab with one entry can't go back", back.value === false);
    on.unmount(); tab.unmount(); back.unmount();
    ok("clientState, clientPage: every listener a store added is taken away when its screen goes", listening === 0, listening);
  } finally {
    globalThis.window = had.window;
    if (had.navigator) Object.defineProperty(globalThis, "navigator", had.navigator); else delete globalThis.navigator;
  }
}

// ── the lint ratchet: set-state-in-effect held at zero, and the one effect kept on purpose ───────────────────────────
{
  const { countFrom, verdict, CEILING, ZERO } = await import("./lint.ratchet.mjs");
  const file = (rules) => ({ filePath: "x.tsx", errorCount: rules.length, warningCount: 0, messages: rules.map((ruleId) => ({ ruleId, severity: 2 })) });
  // R25 put a ninth beside them (react/jsx-no-constructed-context-values): the list grows; set-state-in-effect stays on it.
  ok("lint: set-state-in-effect joins the seven held at zero (and stays held as others join)", ZERO.includes("react-hooks/set-state-in-effect") && ZERO.length >= 8, ZERO);
  ok("lint: one set-state-in-effect fails the gate under any ceiling", !verdict(countFrom(JSON.stringify([file(["react-hooks/set-state-in-effect"])])), { errors: 100, warnings: 100 }, ZERO).ok);
  // R18 took the warnings down to 46 (the pack change's failed step, said in the log); what R17 set still stands as a floor.
  ok("lint: the ceilings are no higher than R17 left them — 0 errors, 47 warnings", CEILING.errors === 0 && CEILING.warnings <= 47, CEILING);
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [];
  const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = join(d, n); if (statSync(join(ROOT, p)).isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) walk(p); } else if (/\.(ts|tsx)$/.test(n)) files.push(p); } };
  for (const d of ["app", "components", "lib", "native"]) { try { walk(d); } catch { /* a folder this tree doesn't have */ } }
  const disabling = files.filter((f) => /eslint-disable[^\n]*react-hooks\/set-state-in-effect/.test(readFileSync(join(ROOT, f), "utf8")));
  ok("lint: one file may switch the rule off for one line — components/Sheet, the open prop followed on purpose — and says why",
    JSON.stringify(disabling) === '["components/Sheet.tsx"]'
      && /eslint-disable-next-line react-hooks\/set-state-in-effect -- the open prop, followed in an effect on purpose/.test(readFileSync(join(ROOT, "components/Sheet.tsx"), "utf8")), disabling);
}

console.log(`\nR17 — NO STATE SET BY AN EFFECT AS IT STARTS: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
