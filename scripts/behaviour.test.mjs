// WHAT A PERSON SEES AND DOES, NOT WHAT THE SOURCE SAYS (R36, 2026-10-19 — the fresh audit's FE11-09; Ryan: "Yes, add
// it").
//
// Each test here draws one of the app's own components into a page (scripts/fixtures/domHost: happy-dom, the real React,
// @testing-library/react), taps it as a person would and reads what they would: the words on the screen, the role and
// state a screen reader is told, where focus is, what was called. A test of the source's text passes as long as the text
// stays; these pass only while the screen does what it says. The two the audit named first: the crash screen's Try
// again (R30 shipped one that drew the same crash again, with every text pin green) and a crew member's view of
// what only an owner or admin may do (R36's Chief of Sales).
import { createElement as h } from "react";
import { componentLoader, domReady } from "./fixtures/domHost.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const { render, screen, fireEvent, act, cleanup } = domReady();
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// ── 1 · the crash screen: Try again fetches the screen again ─────────────────────────────────────────────────────────
{
  const crashes = [];
  const load = componentLoader({ "@/components/ErrorReporter": { recoverFromCrash: (e) => { crashes.push(e); return { reloading: false }; } } });
  const CrashScreen = load("app/error.tsx").default;
  const calls = [];
  const quiet = console.error; console.error = () => {};   // the screen logs the crash it was handed — expected here
  try {
    render(h(CrashScreen, { error: Object.assign(new Error("boom"), { digest: "abc123" }), reset: () => calls.push("reset"), retry: () => calls.push("retry") }));
    await settle();
    ok("the crash screen says what happened, in words, with the code to send", !!screen.getByText("Something went sideways")
      && !!screen.getByText(/send us the code below/) && !!screen.getByText("ref: abc123"));
    ok("…and hands the crash to the reporter once", crashes.length === 1 && crashes[0].message === "boom", crashes.length);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    ok("Try again asks Next to fetch the screen again (retry) — never re-draws the same crash (reset)", calls.join() === "retry", calls);
    cleanup();
    calls.length = 0;
    render(h(CrashScreen, { error: new Error("boom"), reset: () => calls.push("reset") }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    ok("…and on a Next that gives only reset, Try again still does something", calls.join() === "reset", calls);
    ok("a crash in the browser (no digest) says \"let us know\" — never points at a code that isn't there",
      !!screen.getByText(/let us know/) && !screen.queryByText(/ref:/));
  } finally { console.error = quiet; cleanup(); }
}

// ── 2 · Chief of Sales: saving to Bookings is drawn only where the server will say yes ────────────────────────────────
{
  const posted = [];
  const scout = { ok: true, summary: "Two worth pitching", opportunities: [
    { name: "Swamp Rabbit 10K", date: "Nov 8", location: "Greenville, SC", fit: "Runners", pitch: "Vendor form", source: "https://example.com/a", score: "hot" },
    { name: "Fall Makers Market", date: "Nov 15", location: "Atlanta, GA", fit: "Foot traffic", pitch: "Email the organizer", source: "https://example.com/b", score: "warm" },
  ] };
  const authedFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    posted.push({ url, body });
    return new Response(JSON.stringify(body.commit ? { ok: true, added: body.commit.opportunities.length } : scout), { status: 200 });
  };
  const load = componentLoader({ "@/lib/supabase": { supabase: {} }, "@/lib/authedFetch": { authedFetch } });
  const ChiefOfSales = load("components/ChiefOfSales.tsx").default;

  const open = async (isAdmin) => {
    render(h(ChiefOfSales, { isAdmin }));
    fireEvent.click(screen.getByRole("button", { name: /Chief of Sales/ }));
    fireEvent.click(screen.getByRole("button", { name: /Scout opportunities/ }));
    await settle();
  };

  await open(false);
  ok("the crew's scout runs and lists what it found", !!screen.getByText("Swamp Rabbit 10K") && !!screen.getByText("Fall Makers Market"));
  ok("…with no Save to Bookings for the crew, and who saves them said instead",
    !screen.queryByRole("button", { name: /Save \d+ to Bookings/ }) && !!screen.getByText("An owner or admin saves these to Bookings."));
  ok("…and nothing to tick: a pick is for saving", screen.queryAllByRole("button", { pressed: true }).length === 0
    && !screen.queryByRole("button", { name: /Swamp Rabbit 10K/ }));
  cleanup();

  posted.length = 0;
  await open(true);
  const picks = screen.getAllByRole("button", { pressed: true });
  ok("an owner or admin sees each find as a pick, said picked (aria-pressed)", picks.length === 2, picks.length);
  fireEvent.click(screen.getByRole("button", { name: /Fall Makers Market/ }));
  ok("…a tap takes one out, and says so", screen.getAllByRole("button", { pressed: true }).length === 1
    && screen.getByRole("button", { name: /Fall Makers Market/ }).getAttribute("aria-pressed") === "false");
  fireEvent.click(screen.getByRole("button", { name: "Save 1 to Bookings" }));
  await settle();
  const commit = posted.find((p) => p.body.commit);
  ok("…and Save sends only the picked one to the sales door", commit?.url === "/api/agents/sales"
    && commit.body.commit.opportunities.length === 1 && commit.body.commit.opportunities[0].name === "Swamp Rabbit 10K", commit);
  ok("…then says what it did", !!screen.getByText(/Added 1 lead to Bookings/));
  cleanup();
}

// ── 3 · an alert tapped opens the screen it is about (the audit's FE11-01, fixed in R33) ──────────────────────────────
// The console read its section from ?s= once, as the page loaded. A tapped order alert on the iPhone opens /crew?s=…
// through the router — no page load — and the address changed while the screen stayed where it was. Drawn here with a
// router that moves the address the way Next's does (history, then the hooks that read it).
{
  const { useSyncExternalStore } = await import("react");
  const nav = { path: "/crew", search: "s=day", subs: new Set() };
  const useNav = () => useSyncExternalStore((f) => { nav.subs.add(f); return () => nav.subs.delete(f); }, () => `${nav.path}?${nav.search}`);
  const router = {
    push(href) {
      const u = new URL(href, window.location.origin);
      window.history.pushState({}, "", u.pathname + u.search);
      nav.path = u.pathname; nav.search = u.searchParams.toString();
      nav.subs.forEach((f) => f());
    },
  };
  const load = componentLoader({
    "next/navigation": { usePathname: () => { useNav(); return nav.path; }, useSearchParams: () => { useNav(); return new URLSearchParams(nav.search); }, useRouter: () => router },
  });
  const { OperatorSectionProvider, useOperatorSection } = load("components/OperatorSection.tsx");
  window.history.replaceState({}, "", "/crew?s=day");
  try { localStorage.clear(); } catch { /* none */ }
  render(h(OperatorSectionProvider, null, h(SectionShown)));
  await settle();
  ok("the console opens on the section its address names", !!screen.queryByText("day · 0"), document.body.textContent);
  await act(async () => { router.push("/crew?s=money&a=pay"); });
  await settle();
  ok("an alert's link opened through the router — no page load — opens the section it names",
    /^money · /.test(document.querySelector("p")?.textContent ?? ""), document.body.textContent);
  ok("…and the address's move is counted, so a screen's one-time ?a= is read again", !!screen.queryByText("money · 1"), document.body.textContent);
  cleanup();
  function SectionShown() { const { section, addressGen } = useOperatorSection(); return h("p", null, `${section} · ${addressGen}`); }
}

console.log(`\nBEHAVIOUR — WHAT A PERSON SEES AND DOES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
