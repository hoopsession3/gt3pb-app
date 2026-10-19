// WHAT A PERSON SEES AND DOES, NOT WHAT THE SOURCE SAYS (R36, 2026-10-19 — the fresh audit's FE11-09; Ryan: "Yes, add
// it").
//
// Each test here draws one of the app's own components into a page (scripts/fixtures/domHost: happy-dom, the real React,
// @testing-library/react), taps it as a person would and reads what they would: the words on the screen, the role and
// state a screen reader is told, where focus is, what was called. A test of the source's text passes as long as the text
// stays; these pass only while the screen does what it says. The two the audit named first: the crash screen's Try
// again (R30 shipped one that drew the same crash again, with every text pin green) and a crew member's view of
// what only an owner or admin may do (R36's Chief of Sales). R37 added two-step's way back: a recovery code used from
// the code screen, and the ten shown once as two-step turns on.
import { createElement as h } from "react";
import { componentLoader, domReady } from "./fixtures/domHost.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 600)}` : "")); } };
const { render, screen, fireEvent, act, cleanup, within } = domReady();
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** A few turns: a screen that answers through lib/twoStep reads a Response's body before it draws. */
const settled = async () => { for (let i = 0; i < 4; i++) await settle(); };

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

// ── 4 · two-step: a lost authenticator, and the way back (R37 — UX11-10; Ryan: "Recovery codes") ──────────────────────
// TwoStepPrompt and TwoStepSetup drawn with the real lib/twoStep, Said and useStepFocus: Supabase's MFA and the app's
// two doors (/api/two-step/codes, /recover) stood in for at the edge — the answers the routes give (scripts/r37.test).
const TEN = ["HKMNP-23456", "QRSTU-34567", "VWXYZ-45678", "ABCDE-56789", "FGHJK-67892", "MNPQR-78923", "STUVW-89234", "XYZAB-92345", "CDEFG-23457", "HJKMN-34568"];
const twoStepWorld = () => {
  const world = { factors: [{ id: "f-1", factor_type: "totp", status: "verified" }], aal: "aal1", owner: false, left: 10, fetched: [], make: [], recover: [] };
  const sb = {
    auth: {
      mfa: {
        listFactors: async () => ({ data: { totp: world.factors.filter((f) => f.factor_type === "totp" && f.status === "verified"), all: world.factors }, error: null }),
        challengeAndVerify: async ({ factorId, code }) => {
          if (code !== "123456") return { data: null, error: { message: "Invalid TOTP code entered" } };
          const f = world.factors.find((x) => x.id === factorId);
          if (f) f.status = "verified";
          world.aal = "aal2";
          return { data: { access_token: "made-up" }, error: null };
        },
        enroll: async () => {
          world.factors.push({ id: "f-new", factor_type: "totp", status: "unverified" });
          return { data: { id: "f-new", totp: { qr_code: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", secret: "MADEUPKEYFORTESTS", uri: "otpauth://totp/GT3:made-up?secret=MADEUPKEYFORTESTS" } }, error: null };
        },
        unenroll: async ({ factorId }) => { world.factors = world.factors.filter((f) => f.id !== factorId); return { error: null }; },
      },
      refreshSession: async () => ({}),
    },
    rpc: async (fn) => (fn === "two_step_state"
      ? { data: { leader: true, owner: world.owner, enrolled: world.factors.some((f) => f.status === "verified"), given: world.aal === "aal2", required: false, ok: true }, error: null }
      : { data: null, error: { message: `no ${fn}` } }),
    realtime: { setAuth: () => {} },
  };
  const authedFetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    world.fetched.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/two-step/codes" && method === "GET") return new Response(JSON.stringify({ ok: true, left: world.left }), { status: 200 });
    if (url === "/api/two-step/codes") { const a = world.make.shift() ?? { status: 200, body: { ok: true, codes: TEN } }; return new Response(JSON.stringify(a.body), { status: a.status }); }
    if (url === "/api/two-step/recover") {
      const a = world.recover.shift();
      if (a === "offline") throw new TypeError("Load failed");
      return new Response(JSON.stringify(a.body), { status: a.status });
    }
    throw new Error(`behaviour: unexpected fetch ${url}`);
  };
  const feels = [], signOuts = [], asked = [];
  let says = true;
  const load = componentLoader({
    "@/lib/supabase": { supabase: sb },
    "@/lib/authedFetch": { authedFetch },
    "@/lib/haptics": { haptic: (k) => feels.push(k) },
    "@/lib/native": { isNativeApp: () => false },
    "@/components/AuthProvider": { useAuth: () => ({ signOut: async () => { signOuts.push(1); } }) },
    "@/components/ConfirmSheet": { useConfirm: () => async (o) => { asked.push(o); return says; } },
  });
  return { world, feels, signOuts, asked, answer: (v) => { says = v; }, load };
};
{
  const t = twoStepWorld();
  const TwoStepPrompt = t.load("components/TwoStepPrompt.tsx").default;
  const done = [], later = [];
  const draw = () => render(h(TwoStepPrompt, { need: "code", onDone: () => done.push(1), onLater: () => later.push(1) }));
  draw();
  await settled();
  ok("the console asks for the authenticator's code, its field focused — and says what to do if it's lost",
    document.activeElement?.id === "ts-code" && !!screen.getByText(/Lost your authenticator\?/));
  // As a keyboard reaches it: the button focused, then pressed — its view goes, and focus must not go with it.
  const codeInput = screen.getByRole("textbox", { name: "The code from your authenticator" });
  const useOne = screen.getByRole("button", { name: "Use a recovery code" });
  useOne.focus();
  fireEvent.click(useOne);
  await settled();
  const field = screen.getByRole("textbox", { name: "Recovery code" });
  ok("Use a recovery code: its own view, said what it does, the field focused — a field of its own (a text keyboard, not the number pad)",
    !!screen.getByRole("heading", { name: "Use a recovery code." }) && document.activeElement === field && !!screen.getByText(/signs you out everywhere/)
    && field !== codeInput && !codeInput.isConnected && field.getAttribute("inputmode") === null && field.getAttribute("autocapitalize") === "characters");
  ok("…Use this code waits for something typed", screen.getByRole("button", { name: "Use this code" }).disabled === true);
  fireEvent.change(field, { target: { value: "abcde 23456" } });
  ok("…typed, it can be sent", screen.getByRole("button", { name: "Use this code" }).disabled === false);

  t.world.recover.push({ status: 422, body: { ok: false, error: "That recovery code didn't work. Check it, or try another of yours." } });
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await settled();
  const sent = t.world.fetched.filter((f) => f.url === "/api/two-step/recover");
  ok("…sent, as typed, to the recovery door — once", sent.length === 1 && sent[0].method === "POST" && sent[0].body.code === "abcde 23456", sent);
  ok("a code that didn't work: said as an alert, tied to the field (invalid, described by it), the field focused again",
    screen.getByRole("alert").textContent === "That recovery code didn't work. Check it, or try another of yours."
    && field.getAttribute("aria-invalid") === "true" && /\bts-err\b/.test(field.getAttribute("aria-describedby") ?? "") && document.activeElement === field
    && t.feels.at(-1) === "error" && !screen.queryByRole("button", { name: "Sign out, then sign in again" }));

  t.world.recover.push({ status: 403, body: { ok: false, error: "Sign in again first — a recovery code is taken only on a sign-in from the last few minutes.", prove: true } });
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await settled();
  ok("a sign-in older than a few minutes: said, with the way to a fresh one beside it",
    /^Sign in again first/.test(screen.getByRole("alert").textContent) && !!screen.getByRole("button", { name: "Sign out, then sign in again" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign out, then sign in again" }));
  await settled();
  ok("…which signs out", t.signOuts.length === 1);
  t.world.recover.push("offline");
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await settled();
  ok("offline: said in the app's words, and the fresh-sign-in button gone with the reason for it",
    screen.getByRole("alert").textContent === "You're offline. Connect, then try again." && !screen.queryByRole("button", { name: "Sign out, then sign in again" }));

  t.world.recover.push({ status: 200, body: { ok: true, removed: 1, left: 9 } });
  fireEvent.click(screen.getByRole("button", { name: "Use this code" }));
  await settled();
  const off = screen.getByRole("heading", { name: "Your authenticator is off your account." });
  ok("used: the authenticator is off — said, the line focused, felt as done", document.activeElement === off && t.feels.at(-1) === "success");
  ok("…and what comes next: signed out everywhere, sign in again, set up a new one — the owners told",
    !!screen.getByText(/signed out everywhere/) && !!screen.getByText(/set up a new authenticator/) && !!screen.getByText(/The owners and admins have been told/));
  ok("…never the console — the session it would open is ended (neither onDone nor Not now)", done.length === 0 && later.length === 0);
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  await settled();
  ok("…Sign in again signs out, to the sign-in screen", t.signOuts.length === 2);
  cleanup();

  draw();
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
  await settled();
  const back = screen.getByRole("button", { name: /Back to the authenticator/ });
  back.focus();
  fireEvent.click(back);
  await settled();
  ok("Back to the authenticator's code: that view again, its field focused — never the Not now button in Back's place",
    !!screen.getByRole("heading", { name: "Your two-step code." }) && document.activeElement?.id === "ts-code" && document.activeElement?.getAttribute("inputmode") === "numeric");
  cleanup();
}

// ── 5 · two-step setup: the ten codes, shown once, before the console opens ──────────────────────────────────────────
{
  const t = twoStepWorld();
  const TwoStepSetup = t.load("components/TwoStepSetup.tsx").default;
  const makes = () => t.world.fetched.filter((f) => f.url === "/api/two-step/codes" && f.method === "POST").length;
  const clip = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (s) => { clip.push(s); } }, configurable: true });
  const turnOn = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Set up two-step sign-in" }));
    await settled();
    fireEvent.change(screen.getByRole("textbox", { name: "The code from your authenticator" }), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn it on" }));
    await settled();
  };

  // As the console's setup step (onDone opens the console).
  t.world.factors = []; t.world.left = 0;
  const opened = [];
  render(h(TwoStepSetup, { onDone: () => opened.push(1) }));
  await settled();
  ok("setting up: off, said, and the way to turn it on", !!screen.getByText("Two-step sign-in is off."));
  await turnOn();
  const list = screen.getByRole("list", { name: "Your ten recovery codes" });
  ok("turned on: the ten recovery codes, a list with a name, in the order made — the words above them focused",
    within(list).getAllByRole("listitem").map((li) => li.textContent).join() === TEN.join() && document.activeElement?.textContent === "Your recovery codes.");
  ok("…made once, on the sign-in that just gave its code — and the console doesn't open over them", makes() === 1 && t.world.aal === "aal2" && opened.length === 0);
  ok("…with what they're for and how to keep them, said once", !!screen.getByText(/they won.t be shown again/) && !!screen.getByText(/Each works once/));
  fireEvent.click(screen.getByRole("button", { name: "Copy all ten" }));
  await settled();
  ok("Copy all ten: the ten, a line each — and the button says Copied", clip.length === 1 && clip[0] === TEN.join("\n") && !!screen.getByRole("button", { name: "Copied" }));
  fireEvent.click(screen.getByRole("button", { name: /saved them/ }));
  await settled();
  ok("I've saved them: the console opens, once — and it says ten of ten left", opened.length === 1 && !!screen.getByText("10 of 10 left — each works once"));
  cleanup();

  // The codes not made: said where it's read; the console waits behind a Continue.
  t.world.factors = []; t.world.aal = "aal1"; opened.length = 0;
  t.world.make.push({ status: 500, body: { ok: false, error: "We couldn't make recovery codes just now — nothing was changed. Try again." } });
  render(h(TwoStepSetup, { onDone: () => opened.push(1) }));
  await settled();
  await turnOn();
  ok("turned on, the codes not made: said, as an alert — and the console waits (no onDone) behind a Continue",
    /couldn.t make your recovery codes just now/.test(screen.getByRole("alert").textContent) && opened.length === 0 && !!screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("…Make new codes from there: asked first (any codes they have stop working), then made and shown",
    t.asked.length === 1 && t.asked[0].title === "Make new recovery codes?" && !!screen.getByRole("list", { name: "Your ten recovery codes" }) && opened.length === 0);
  fireEvent.click(screen.getByRole("button", { name: /saved them/ }));
  await settled();
  ok("…and I've saved them opens the console, once", opened.length === 1 && !screen.queryByRole("button", { name: "Continue" }));
  cleanup();

  // In Settings & privacy (no onDone): how many are left, and new ones made — asked first only when there are some to lose.
  t.world.factors = [{ id: "f-1", factor_type: "totp", status: "verified" }]; t.world.aal = "aal2"; t.world.left = 7; t.asked.length = 0; t.answer(false);
  render(h(TwoStepSetup, {}));
  await settled();
  ok("in Settings: on, and how many codes are left", !!screen.getByText("7 of 10 left — each works once") && !screen.queryByRole("button", { name: "Continue" }));
  let m0 = makes();
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("Make new codes with seven left: asked first — and No makes nothing", t.asked.length === 1 && /stop working/.test(t.asked[0].body) && makes() === m0 && !screen.queryByRole("list"));
  t.answer(true);
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("…Yes: ten new, shown", makes() === m0 + 1 && !!screen.getByRole("list", { name: "Your ten recovery codes" }));
  cleanup();

  t.world.left = 0; t.asked.length = 0;
  render(h(TwoStepSetup, {}));
  await settled();
  ok("none left: said so", !!screen.getByText("None left — make new ones"));
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("…and made without asking — nothing would stop working", t.asked.length === 0 && !!screen.getByRole("list", { name: "Your ten recovery codes" }));
  cleanup();

  t.world.aal = "aal1"; t.world.left = 4; t.asked.length = 0; m0 = makes();
  render(h(TwoStepSetup, {}));
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("a sign-in that hasn't given the code: asked for it first, the field focused — nothing asked, nothing made",
    /Enter the code from your authenticator first/.test(screen.getByRole("alert").textContent) && t.asked.length === 0 && makes() === m0 && document.activeElement?.id === "ts-code");
  fireEvent.change(screen.getByRole("textbox", { name: "The code from your authenticator" }), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Make new codes" }));
  await settled();
  ok("…given here, asked, then made: the code given (aal2) before the codes are", t.asked.length === 1 && t.world.aal === "aal2" && makes() === m0 + 1
    && !!screen.getByRole("list", { name: "Your ten recovery codes" }));
  cleanup();
}

console.log(`\nBEHAVIOUR — WHAT A PERSON SEES AND DOES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
