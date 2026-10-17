// R14 (2026-10-17 — the 10/10 audit's operations pass), run.
//
// The rules R14 added that are pure, driven: every setting the app reads and which ones a server start names as not set
// (lib/envSchema), whether the signed-in smoke may run and what it says when it cannot (scripts/smokeGate), and the lint
// gate's two ceilings and its rules held at zero (scripts/lint.ratchet). The money paths R14 closed are run by their own
// suites (scripts/chargeonce.test.mjs, scripts/reservepay.test.mjs, scripts/webhooks.test.mjs); scripts/smoke.cjs holds
// the wiring (who calls what, and what the workflows give each step).
import { libLoader } from "./fixtures/chargeonce.mjs";
import { smokeGate, ACCOUNT, DATABASE } from "./smokeGate.mjs";
import { countFrom, verdict, CEILING, ZERO } from "./lint.ratchet.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)}` : "")); } };
const load = libLoader();
const E = load("lib/envSchema.ts");

// ── lib/envSchema: the list ─────────────────────────────────────────────────────────────────────────────────────────
{
  const names = E.ENV.map((e) => e.name);
  ok("env: no name is listed twice", new Set(names).size === names.length, names.filter((n, i) => names.indexOf(n) !== i));
  ok("env: a name is public exactly when Next.js writes it into the page (NEXT_PUBLIC_)",
    E.ENV.every((e) => (e.side === "public") === e.name.startsWith("NEXT_PUBLIC_")), E.ENV.filter((e) => (e.side === "public") !== e.name.startsWith("NEXT_PUBLIC_")).map((e) => e.name));
  ok("env: every entry says what it is for, and is one of the four needs",
    E.ENV.every((e) => e.what.trim().length > 10 && ["core", "feature", "display", "platform"].includes(e.need)));
  ok("env: no secret is public — a key, token, secret or private key never has the NEXT_PUBLIC_ prefix",
    !E.ENV.some((e) => e.side === "public" && /(SECRET|TOKEN|PRIVATE|SERVICE_ROLE|_KEY$)/.test(e.name) && !/ANON_KEY$|VAPID_PUBLIC_KEY$/.test(e.name)),
    E.ENV.filter((e) => e.side === "public" && /(SECRET|TOKEN|PRIVATE|SERVICE_ROLE|_KEY$)/.test(e.name)).map((e) => e.name));
  ok("env: the three the app cannot run without are core — the database's two and the service role",
    ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].every((n) => E.ENV.find((e) => e.name === n)?.need === "core"));
  ok("env: the retired Square switch is gone from the list (the app ID's prefix picks sandbox or production)",
    !names.includes("NEXT_PUBLIC_SQUARE_ENV"));
}

// ── lib/envSchema: what a server start says ─────────────────────────────────────────────────────────────────────────
{
  const list = [
    { name: "A_CORE", side: "server", need: "core", what: "x" },
    { name: "B_FEATURE", side: "server", need: "feature", what: "x" },
    { name: "C_DISPLAY", side: "server", need: "display", what: "x" },
    { name: "D_PLATFORM", side: "server", need: "platform", what: "x" },
  ];
  const names = (env) => E.notSet(env, list).map((e) => e.name);
  ok("notSet: with nothing set, the core and the feature names — never the display or platform ones", JSON.stringify(names({})) === JSON.stringify(["A_CORE", "B_FEATURE"]), names({}));
  ok("notSet: a name set is not named", JSON.stringify(names({ A_CORE: "v", B_FEATURE: "v" })) === "[]", names({ A_CORE: "v", B_FEATURE: "v" }));
  ok("notSet: blank or spaces is not set (a value pasted empty is the same as none)", JSON.stringify(names({ A_CORE: "   ", B_FEATURE: "" })) === JSON.stringify(["A_CORE", "B_FEATURE"]), names({ A_CORE: "   ", B_FEATURE: "" }));
  ok("notSet: it returns entries, never a value (names only, as the start-up log prints them)",
    E.notSet({ A_CORE: "a-secret-value" }, list).every((e) => !JSON.stringify(e).includes("a-secret-value")));
  ok("notSet: by default it reads the real list", E.notSet({}).length === E.ENV.filter((e) => e.need === "core" || e.need === "feature").length);
}

// ── scripts/smokeGate: whether the signed-in smoke may run ──────────────────────────────────────────────────────────
{
  const full = { GT3_SMOKE_EMAIL: "a@b.test", GT3_SMOKE_PASSWORD: "p", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
  ok("smoke gate: no account at all → not checked (it says so and passes)", smokeGate({}).verdict === "not-checked");
  ok("smoke gate: an account GitHub hands as empty strings (a secret nobody set) → not checked",
    smokeGate({ GT3_SMOKE_EMAIL: "", GT3_SMOKE_PASSWORD: "", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }).verdict === "not-checked");
  const noDb = smokeGate({ GT3_SMOKE_EMAIL: "a@b.test", GT3_SMOKE_PASSWORD: "p" });
  ok("smoke gate: the account set and no database to sign in to → broken (it fails), naming the two missing",
    noDb.verdict === "broken" && JSON.stringify(noDb.missing) === JSON.stringify(DATABASE), noDb);
  const half = smokeGate({ ...full, GT3_SMOKE_PASSWORD: " " });
  ok("smoke gate: half an account → broken, naming the half that is missing", half.verdict === "broken" && JSON.stringify(half.missing) === JSON.stringify(["GT3_SMOKE_PASSWORD"]), half);
  ok("smoke gate: everything set → run", smokeGate(full).verdict === "run" && smokeGate(full).missing.length === 0);
  ok("smoke gate: it names what is missing, never a value", !JSON.stringify(smokeGate({ GT3_SMOKE_EMAIL: "someone@x.test" })).includes("someone@x.test"));
  ok("smoke gate: the account's two names are the ones the workflows set", JSON.stringify(ACCOUNT) === JSON.stringify(["GT3_SMOKE_EMAIL", "GT3_SMOKE_PASSWORD"]));
}

// ── scripts/lint.ratchet: two ceilings and the rules held at zero ───────────────────────────────────────────────────
{
  const file = (errors, warnings, rules = []) => ({ filePath: "/x.ts", errorCount: errors, warningCount: warnings, messages: rules.map((ruleId) => ({ ruleId, severity: 2 })) });
  ok("lint: an output that is not eslint's is 'could not tell' (null), never zero", countFrom("not json") === null && countFrom("{}") === null && countFrom('[{"errorCount":1}]') === null);
  const c = countFrom(JSON.stringify([file(2, 1, ["a/rule", "a/rule"]), file(0, 3)]));
  ok("lint: errors and warnings are summed apart, and by rule", c.errors === 2 && c.warnings === 4 && c.total === 6 && c.byRule["a/rule"] === 2, c && { errors: c.errors, warnings: c.warnings, byRule: c.byRule });
  const at = { errors: 2, warnings: 4 };
  ok("lint: exactly at both ceilings passes", verdict(c, at, []).ok);
  const traded = countFrom(JSON.stringify([file(3, 3)]));
  ok("lint: a fixed warning does not buy a new error — one error over FAILS though the total is the same", traded.total === 6 && !verdict(traded, at, []).ok, verdict(traded, at, []).lines);
  ok("lint: below a ceiling fails too, and says to lower it", (() => { const v = verdict(countFrom(JSON.stringify([file(1, 4)])), at, []); return !v.ok && v.lines.some((l) => /LOWER CEILING\.errors to 1/.test(l)); })());
  const hooks = countFrom(JSON.stringify([file(2, 4, ["react-hooks/rules-of-hooks"])]));
  ok("lint: a rule held at zero fails on its first hit, under every ceiling", !verdict(hooks, { errors: 10, warnings: 10 }, ["react-hooks/rules-of-hooks"]).ok);
  ok("lint: the real ceilings are numbers, and rules-of-hooks is held at zero",
    Number.isInteger(CEILING.errors) && Number.isInteger(CEILING.warnings) && ZERO.includes("react-hooks/rules-of-hooks"));
}

console.log(`\nR14 — THE SETTINGS, THE SIGNED-IN SMOKE'S GATE, THE LINT CEILINGS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
