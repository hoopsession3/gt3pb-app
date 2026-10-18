// R28 — TWO-STEP FOR THE OWNERS AND ADMINS, THE APP'S HALF (2026-10-18 — the 10/10 audit, security F6; Ryan: "Yes,
// owner/admin"). The database holds every owner's and admin's power to the second step (0433, run in db.r28.test.mjs);
// this is lib/twoStep — compiled from its TypeScript, over a stand-in Supabase whose MFA answers as told — and the wiring
// only a source read can hold: the console asks before it reads anything, the row is an owner's or admin's, the setup
// lets an unfinished start go first, the code it checks is the authenticator's, and the secret is drawn and nowhere else.
import { readFileSync } from "node:fs";
import { routeLoader } from "./fixtures/moneyWorld.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 700)}` : "")); } };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n");

const TS = routeLoader({ react: { useEffect: () => {}, useState: (v) => [v, () => {}] }, "@/lib/supabase": { supabase: null } })("lib/twoStep.ts");
ok("compiled: lib/twoStep", typeof TS.needFrom === "function" && typeof TS.giveCode === "function" && TS.TOTP_LEN === 6);

// ── the pure parts ─────────────────────────────────────────────────────────────────────────────────────────────────
ok("a code, typed or pasted with spaces: its six digits", TS.digitsOf("123 456") === "123456" && TS.digitsOf("12-34-5678") === "123456" && TS.digitsOf("abc") === "");
ok("the key in groups of four, as an authenticator asks for it typed", TS.keyGroups("JBSWY3DPEHPK3PXP") === "JBSW Y3DP EHPK 3PXP" && TS.keyGroups("ab cd ef") === "abcd ef");
{
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z" fill="#000"/></svg>`;
  const asUrl = TS.qrSrc(`data:image/svg+xml;utf-8,${svg}`), bare = TS.qrSrc(svg);
  ok("the QR code is drawn from its own encoded copy — given as a data URL or bare, a '#' in it can't end the URL early",
    asUrl === bare && asUrl.startsWith("data:image/svg+xml;charset=utf-8,") && !asUrl.slice(30).includes("#") && decodeURIComponent(asUrl.split(",")[1]) === svg, asUrl.slice(0, 80));
  ok("…one that came encoded is read once, and a stray '%' in one that didn't is drawn as it came (never a thrown error)",
    TS.qrSrc(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`) === asUrl && TS.qrSrc("data:image/svg+xml;utf-8,<svg>100%</svg>") === `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>100%</svg>")}`);
}
ok("Supabase's refusals in the app's words — a wrong code, a sign-in without its code, no signal, too many tries",
  /didn't work — enter the one showing/.test(TS.twoStepWords("Invalid TOTP code entered")) && /Give your current code first/.test(TS.twoStepWords("AAL2 required to unenroll verified factor"))
  && /offline/.test(TS.twoStepWords("Failed to fetch")) && /Too many tries/.test(TS.twoStepWords("Too many requests")) && /Try again in a minute/.test(TS.twoStepWords("something else")));
const S = (o = {}) => ({ leader: true, owner: false, enrolled: false, given: false, required: false, ok: true, ...o });
ok("what is owed: an authenticator set up and not given on this sign-in — the code; given — nothing",
  TS.needFrom({ currentLevel: "aal1", nextLevel: "aal2" }, null) === "code" && TS.needFrom({ currentLevel: "aal2", nextLevel: "aal2" }, null) === "none");
ok("…none set up: nothing — unless their business requires it of a leader (the database's word), then the setup",
  TS.needFrom({ currentLevel: "aal1", nextLevel: "aal1" }, null) === "none" && TS.needFrom({ currentLevel: "aal1", nextLevel: "aal1" }, S({ required: true })) === "setup"
  && TS.needFrom({ currentLevel: "aal1", nextLevel: "aal1" }, S({ required: true, leader: false })) === "none" && TS.needFrom(null, S()) === "none");
ok("…one set up on another device, before this session has heard of it: the database's word asks for the code",
  TS.needFrom({ currentLevel: "aal1", nextLevel: "aal1" }, S({ enrolled: true })) === "code" && TS.needFrom({ currentLevel: "aal1", nextLevel: "aal1" }, S({ enrolled: true, given: true })) === "none");

// ── "Not now": drawn as the database answers (lib/codeWait) ───────────────────────────────────────────────────────
{
  const RO = routeLoader({})("lib/roles.ts"), CW = routeLoader({})("lib/codeWait.ts");
  const owner = { id: "u1", role: "owner", is_admin: true, display_name: "Ryan" }, admin = { id: "u2", role: "admin", is_admin: false };
  const o = CW.drawnWhileCodeWaits(owner, true), a = CW.drawnWhileCodeWaits(admin, true);
  const every = [...RO.ALL_ROLES, null, undefined].flatMap((role) => [true, false].map((is_admin) => ({ role, is_admin })));
  const differs = every.filter((p) => CW.leaderAsStored(p) !== ["owner", "admin"].includes(RO.roleOf(p)));
  ok("the provider's owner-or-admin is lib/roles roleOf's, for every role with and without the legacy flag (it rides in every route without lib/roles)",
    differs.length === 0 && every.length === 18 && CW.leaderAsStored(null) === false, differs);
  ok("while the code waits, an owner and an admin are drawn as event managers — the most a crew member's sections hold — and nothing else about them changes",
    o.role === "event_manager" && o.is_admin === false && o.display_name === "Ryan" && o.id === "u1" && a.role === "event_manager" && RO.canOf(o).admin === false && RO.canOf(o).manage === true
    && owner.role === "owner" && owner.is_admin === true, { o, a });
  ok("…an older profile that says owner only by is_admin, too; anyone not an owner or admin, or no profile, as they are",
    CW.drawnWhileCodeWaits({ id: "u3", role: null, is_admin: true }, true).role === "event_manager"
    && CW.drawnWhileCodeWaits({ id: "u4", role: "operator", is_admin: false }, true).role === "operator" && CW.drawnWhileCodeWaits(null, true) === null);
  ok("…and with no wait, the very same profile (nothing redrawn)", CW.drawnWhileCodeWaits(owner, false) === owner);
}

// ── over a stand-in Supabase ───────────────────────────────────────────────────────────────────────────────────────
function fakeSb(over = {}) {
  const calls = [];
  const st = { factors: [{ id: "f-old", factor_type: "totp", status: "unverified" }, { id: "f-ok", factor_type: "totp", status: "verified" }], verify: null, enroll: null, rpc: null, ...over };
  const mfa = {
    listFactors: async () => { calls.push(["list"]); return st.listError ? { data: null, error: { message: st.listError } } : { data: { all: st.factors, totp: st.factors.filter((f) => f.status === "verified"), phone: [] }, error: null }; },
    unenroll: async ({ factorId }) => { calls.push(["unenroll", factorId]); return st.unenrollError ? { data: null, error: { message: st.unenrollError } } : { data: { id: factorId }, error: null }; },
    enroll: async (p) => { calls.push(["enroll", p]); return st.enroll ?? { data: { id: "f-new", type: "totp", totp: { qr_code: "<svg/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/GT3:x?secret=JBSWY3DPEHPK3PXP" } }, error: null }; },
    challengeAndVerify: async (p) => { calls.push(["verify", p]); return st.verify ?? { data: { access_token: `aal2-for-${p.factorId}` }, error: null }; },
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null }),
  };
  return { calls, st, sb: { auth: { mfa, refreshSession: async () => { calls.push(["refresh"]); return { error: null }; } },
    realtime: { setAuth: async (t) => { calls.push(["realtime", t]); } },
    rpc: async (fn, args) => { calls.push(["rpc", fn, args]); return st.rpc ?? { data: null, error: null }; } } };
}
{
  const f = fakeSb();
  const r = await TS.giveCode(f.sb, "123 456");
  ok("give the code: the account's verified authenticator is challenged with the six digits — never an unfinished one",
    !r.error && JSON.stringify(f.calls.find((c) => c[0] === "verify")?.[1]) === JSON.stringify({ factorId: "f-ok", code: "123456" }), f.calls);
  ok("…and Realtime is handed the session that gave it — the database asks its aal of every change a live list hears",
    JSON.stringify(f.calls.at(-1)) === JSON.stringify(["realtime", "aal2-for-f-ok"]), f.calls);
  const wrong = fakeSb({ verify: { data: null, error: { message: "Invalid TOTP code entered" } } });
  ok("…a wrong code is said in the app's words, and Realtime keeps the token it has",
    /didn't work/.test((await TS.giveCode(wrong.sb, "000000")).error ?? "") && !wrong.calls.some((c) => c[0] === "realtime"));
  const deaf = fakeSb();
  deaf.sb.realtime = { setAuth: () => { throw new Error("socket gone"); } };
  ok("…a Realtime that can't take it doesn't make a good code a failure (the lists catch up at the renewal)", !(await TS.giveCode(deaf.sb, "123456")).error);
  const none = fakeSb({ factors: [] });
  ok("…an account with no authenticator is told where to set one up, and nothing is challenged",
    /Set one up in Settings & privacy/.test((await TS.giveCode(none.sb, "123456")).error ?? "") && !none.calls.some((c) => c[0] === "verify"));
}
{
  const f = fakeSb();
  const got = await TS.startSetup(f.sb);
  const order = f.calls.map((c) => c[0]).join(",");
  ok("setting one up lets an unfinished start go first (it would be in the way), then enrolls an authenticator app's, named for GT3",
    got.factorId === "f-new" && got.secret === "JBSWY3DPEHPK3PXP" && order === "list,unenroll,enroll" && f.calls[1][1] === "f-old"
    && f.calls[2][1].factorType === "totp" && f.calls[2][1].issuer === "GT3 Performance Bar", { order, calls: f.calls });
  const fin = await TS.finishSetup(f.sb, "f-new", "654321");
  ok("…and its first code turns it on (that factor, those digits), and Realtime hears the session it gave",
    !fin.error && JSON.stringify(f.calls.filter((c) => c[0] === "verify").at(-1)[1]) === JSON.stringify({ factorId: "f-new", code: "654321" })
    && JSON.stringify(f.calls.at(-1)) === JSON.stringify(["realtime", "aal2-for-f-new"]), f.calls);
  const refused = fakeSb({ enroll: { data: null, error: { message: "MFA enroll is disabled for TOTP" } } });
  ok("…a refused enroll says so — nothing half-made is shown", "error" in (await TS.startSetup(refused.sb)));
}
{
  const f = fakeSb({ factors: [{ id: "f-ok", factor_type: "totp", status: "verified" }, { id: "f-2", factor_type: "totp", status: "unverified" }, { id: "p-1", factor_type: "phone", status: "verified" }] });
  const off = await TS.turnOff(f.sb);
  ok("turning it off lets every authenticator app's go — not another kind — and reads the session again",
    !off.error && f.calls.filter((c) => c[0] === "unenroll").map((c) => c[1]).join() === "f-ok,f-2" && f.calls.at(-1)[0] === "refresh", f.calls);
  const needs = fakeSb({ factors: [{ id: "f-ok", factor_type: "totp", status: "verified" }], unenrollError: "AAL2 required to unenroll verified factor" });
  ok("…without this sign-in's code, Supabase refuses — said as: give your code first", /Give your current code first/.test((await TS.turnOff(needs.sb)).error ?? ""));
}
{
  const f = fakeSb({ rpc: { data: { ok: true, required: true }, error: null } });
  const on = await TS.setRequired(f.sb, true);
  ok("requiring it is the database's door (require_two_step) — on or off as asked", !on.error && JSON.stringify(f.calls[0]) === JSON.stringify(["rpc", "require_two_step", { p_on: true }]), f.calls);
  const not = fakeSb({ rpc: { data: null, error: { message: "Only an owner, signed in with their authenticator's code, sets this." } } });
  ok("…and its refusal is said whole", /Only an owner, signed in with their authenticator's code/.test((await TS.setRequired(not.sb, true)).error ?? ""));
  const st = fakeSb({ rpc: { data: { leader: true, owner: true, enrolled: true, given: false, required: false, ok: false }, error: null } });
  const state = await TS.twoStepState(st.sb);
  ok("the state is read from two_step_state, and an answer it can't read is none (before 0433, offline)",
    state?.owner === true && state.enrolled === true && state.ok === false && (await TS.twoStepState(fakeSb({ rpc: { data: null, error: { message: "PGRST202" } } }).sb)) === null);
}

// ── the wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const crew = code(read("app/crew/page.tsx"));
  const at = (s) => crew.indexOf(s);
  ok("the console asks an owner or admin who owes the code before it reads anything — after who they are is known, before the console draws",
    /const twoStep = useTwoStep\(leader && profileStatus === "ready", user\?\.id \?\? null, \{ waiting: waitingForCode, wait: waitForCode \}\);/.test(crew)
    && at('if (role === "member") {') < at('if (twoStep.need === "checking") return <section className="screen"><PourFill label="Opening the console…" /></section>;')
    && at('if (twoStep.need === "code" || twoStep.need === "setup") return <TwoStepPrompt need={twoStep.need} onDone={twoStep.done} onLater={twoStep.later} />;') < at("<CrumbProvider>")
    && /const TwoStepPrompt = dynamic\(\(\) => import\("@\/components\/TwoStepPrompt"\)/.test(crew) && !/^import TwoStepPrompt/m.test(crew));
  ok("…and \"Not now\" leaves a line that asks again", /\{twoStep\.deferred && \(/.test(crew) && /onClick=\{twoStep\.ask\}>Enter it<\/button>/.test(crew));
  // "Not now" is the provider's (R28): every screen draws the crew's tools while the code waits — the bar and ⌘K are drawn
  // outside the console (components/AppShell), and a panel the database answers empty is never drawn as an all-clear.
  const ap = code(read("components/AuthProvider.tsx")), tsx = code(read("lib/twoStep.ts"));
  ok("\"Not now\" is held by the provider, for every screen: the profile is drawn as an event manager's while it holds, the role as stored kept apart",
    /const waitingForCode = leader && !!user && codeWait === user\.id;/.test(ap) && /const drawn = useMemo\(\(\) => drawnWhileCodeWaits\(profile, waitingForCode\), \[profile, waitingForCode\]\);/.test(ap)
    && /profile: drawn, profileStatus,/.test(ap) && /refreshProfile, leader, waitingForCode, waitForCode \}\)/.test(ap)
    && /later: \(\) => hold\.wait\(true\),/.test(tsx) && /ask: \(\) => hold\.wait\(false\),/.test(tsx) && !/deferredFor/.test(tsx));
  ok("…and it ends when a code is given anywhere (Settings & privacy too) or someone signs in anew — never held over a new sign-in",
    /if \(!same \|\| event === "MFA_CHALLENGE_VERIFIED"\) setCodeWait\(null\);/.test(ap)
    && ap.indexOf("const same = !!u && lastUid.current === u.id;") < ap.indexOf('if (!same || event === "MFA_CHALLENGE_VERIFIED") setCodeWait(null);'));
  const acs = code(read("components/AccountSheet.tsx"));
  ok("Settings & privacy has Two-step sign-in for an owner or admin alone, in the sheet's own chunk (loaded when the sheet opens, never with a page), with its way back",
    /\{staff && leader && <Row title="Two-step sign-in" sub="An authenticator's code for owner and admin tools" row="two-step" onClick=\{\(\) => setTwoStep\(true\)\} \/>\}/.test(acs)
    && /^import TwoStepSetup from "\.\/TwoStepSetup";$/m.test(acs) && !/dynamic\(\(\) => import\("@\/components\/TwoStepSetup"\)/.test(acs)
    && /const AccountSheet = dynamic\(\(\) => import\("\.\/AccountSheet"\), \{ ssr: false \}\);/.test(code(read("components/AccountPill.tsx")))
    && acs.indexOf("if (!user) {") < acs.indexOf("if (twoStep) {\n    return (") && acs.indexOf("if (twoStep) {\n    return (") < acs.indexOf('if (view !== "menu") {')
    && /aria-label="Back to Settings & privacy" onClick=\{\(\) => setTwoStep\(false\)\}/.test(acs));
  const setup = code(read("components/TwoStepSetup.tsx")), prompt = code(read("components/TwoStepPrompt.tsx")), lib = code(read("lib/twoStep.ts"));
  ok("the setup: the QR code and the key drawn for the person, the otpauth link only in the iPhone app — and neither logged",
    /<img src=\{qrSrc\(enrol\.qr\)\}/.test(setup) && /\{keyGroups\(enrol\.secret\)\}/.test(setup) && /\{isNativeApp\(\) && \(\s*<p className="mt-2"><a className="auth-link[^"]*" href=\{enrol\.uri\}>/.test(setup)
    && !/console\.(log|info|warn|error)\([^)]*(secret|qr|uri)/i.test(setup + lib));
  ok("the setup, on the web: an iPhone app from before two-step can't ask for the code — said before it is turned on, and not in the app itself",
    /\{!isNativeApp\(\) && \(\s*<p className="dp-hint">\s*Use the GT3 iPhone app as well\? Update it first/.test(setup)
    && setup.indexOf("Use the GT3 iPhone app as well?") < setup.indexOf('{busy ? "Starting…" : "Set up two-step sign-in"}'));
  ok("the owner's switch asks the database (require_two_step) and only on a sign-in that gave its code; turning it off asks for the code when this sign-in hasn't",
    /disabled=\{busy \|\| !state\.given\}/.test(setup) && /const r = await setRequired\(supabase, on\);/.test(setup)
    && /if \(!state\?\.given\) \{[\s\S]*?const given = await giveCode\(supabase, code\);[\s\S]*?\}\s*const r = await turnOff\(supabase\);/.test(setup));
  ok("the prompt: a one-time code field, six digits, said with what it is for; a way out (Not now, Sign out); and what to do if the authenticator is lost",
    /autoComplete="one-time-code"/.test(prompt) && /maxLength=\{TOTP_LEN\}/.test(prompt) && /aria-describedby="ts-code-for"/.test(prompt)
    && /Not now — the crew&rsquo;s tools only/.test(prompt) && /onClick=\{\(\) => void signOut\(\)\}/.test(prompt) && /Lost your authenticator\?/.test(prompt));
}

console.log(`\nR28 — TWO-STEP FOR THE OWNERS AND ADMINS (the app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
