// IMS8 · THE $1 RESEARCH LIMIT, ENFORCED (lib/researchBudget, lib/pageFetch, lib/libraryResearch — 2026-11-11). Ryan: "an
// enforceable $1 total budget per run, covering model calls, tools, and retries … Before each billable step, reserve its
// maximum possible cost against the remaining budget. Stop when that bound cannot fit." On recorded answers: no network,
// no key, no spend. The bound itself rests on documented facts (a token is at least one byte; the forced tool's prompt
// is 589 tokens; an image is ≤ 3,278 tokens at the API's resize limit; max_tokens is enforced) — stated, not measured.
import { loadTs } from "./search.read.mjs";
const B = loadTs("lib/researchBudget.ts"), R = loadTs("lib/libraryResearch.ts"), P = loadTs("lib/pageFetch.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };
const T = "00000000-0000-0000-0000-000000000001";
const rate = B.rateOf("claude-sonnet-4-6");

// ── the bound ──────────────────────────────────────────────────────────────────────────────────────────────────────
const big = "é".repeat(B.PAGE_TEXT_BYTES / 2);   // 2-byte characters: the page at its byte limit
const req = R.boundedRequest({ kind: "url", input: "https://maker.test/x" }, { url: "https://maker.test/x", text: big }, null, "seating");
const inB = B.inputTokenBound(req);
const bytes = Buffer.byteLength(req.system) + Buffer.byteLength(JSON.stringify(req.tools)) + req.messages[0].content.reduce((a, b) => a + Buffer.byteLength(b.text ?? ""), 0);
ok("a request's input bound counts every byte sent as text, plus the framing margin (≥ 589 for the forced tool)", inB === bytes + B.FRAME_TOKENS && B.FRAME_TOKENS >= 589, { inB, bytes });
ok("…an image counts its bound (≥ 3,278, the vision docs' maximum at the resize limit), not its base64", B.inputTokenBound({ system: "", tools: [], messages: [{ role: "user", content: [{ type: "image", source: { data: "x".repeat(900000) } }] }] }) === B.FRAME_TOKENS + 2 + B.IMAGE_TOKENS && B.IMAGE_TOKENS >= 3278);   // 2 = the bytes of "[]" (no tools)
ok("…a PDF has no bound (Infinity): it can't be sent", B.inputTokenBound({ system: "", tools: [], messages: [{ role: "user", content: [{ type: "document" }] }] }) === Infinity);
const worstUrl = B.stepBoundCents(inB, B.OUTPUT_TOKENS, rate);
ok(`the dearest one try (a page at its limit): ${worstUrl.toFixed(2)}¢ — priced at the cache-write rate ($3.75/MTok) and $15/MTok out`, worstUrl > 0 && worstUrl < 30 && Math.abs(worstUrl - (inB * 3.75 + B.OUTPUT_TOKENS * 15) / 1e4) < 1e-9, worstUrl);
ok("…so a $1 run holds at most 3 tries of it, and 3 × the dearest try ≤ 100¢", B.MAX_ATTEMPTS === 3 && 3 * worstUrl <= 100);

// ── the ledger ─────────────────────────────────────────────────────────────────────────────────────────────────────
ok("a run's limit is its reservation, never more than $1 (a budget row of 1000¢ still gives 100¢)", new B.RunLedger(1000).limit === 100 && new B.RunLedger(25).limit === 25);
{ const l = new B.RunLedger(100); l.charge(40, null); l.charge(40, null);
  ok("a try that can't fit what's left isn't sent (40 + 40 spent; another 40 doesn't fit)", !l.fits(40) && l.fits(20) && l.unknown === 2); }

// ── the run, end to end, with stand-ins ────────────────────────────────────────────────────────────────────────────
const rec = { content: [{ type: "tool_use", name: "record_findings", input: { product: { name: "X" }, facts: [{ field: "maker", value: "M", method: "quoted", source_class: "manufacturer", source_ref: "https://maker.test/x" }] } }], stop_reason: "tool_use" };
function world({ perRun = 100, script = [], pageBytes = 200 }) {
  const calls = { model: 0, settled: [], reserved: 0 };
  let i = 0;
  const deps = {
    intakeByHash: async () => null, createIntake: async () => "in-1", updateIntake: async () => {}, known: async () => [], criteria: async () => [],
    budget: async () => ({ per_run_cents: perRun, per_run_searches: 5, per_run_fetches: 3, per_run_tokens: 60000 }),
    reserve: async () => { calls.reserved++; return { ok: true, run: "run-1" }; },
    settle: async (run, usage, cents, outcome, error) => { calls.settled.push({ usage, cents, outcome, error }); return cents; },
    createAsset: async () => "a-1", insertFacts: async (m, i2, f) => f.length, readFile: async () => null,
    fetchPage: async (url, max) => ({ url, text: "x".repeat(Math.min(pageBytes, max)) }),
    model: async () => { calls.model++; const s = script[i++] ?? "ok"; if (s === "ok") return { ...rec, usage: { input_tokens: 5000, output_tokens: 400, cache_write_tokens: 0, cache_read_tokens: 0 } };
      if (s === "nousage") return { ...rec, usage: null }; throw new Error(s); },
    now: () => Date.parse("2026-11-11T12:00:00Z"),
  };
  return { deps, calls };
}
const ask = { kind: "url", input: "https://maker.test/x", tenant: T };
{ const w = world({ script: ["Anthropic 529: overloaded", "Anthropic 529: overloaded", "Anthropic 529: overloaded", "ok"], pageBytes: B.PAGE_TEXT_BYTES });
  const o = await R.runIntake(ask, w.deps);
  ok("three overloaded tries of the dearest request: all three sent (each fits $1), the fourth never — charged ≤ 100¢, every try at its bound", w.calls.model === 3 && o.status === "failed" && o.charged_cents <= 100 && Math.abs(o.charged_cents - Math.round(3 * worstUrl * 100) / 100) < 0.02, { tries: w.calls.model, charged: o.charged_cents }); }
{ const w = world({ perRun: 25, script: ["Anthropic 529: overloaded", "ok"], pageBytes: B.PAGE_TEXT_BYTES });
  const o = await R.runIntake(ask, w.deps);
  ok("with today's 25¢ reservation: one try of the dearest request fits, a second doesn't — stopped, not sent", w.calls.model === 1 && o.status === "failed" && /couldn't fit/.test(w.calls.settled[0].error) && o.charged_cents <= 25, { tries: w.calls.model, s: w.calls.settled[0] }); }
{ const w = world({ perRun: 1, pageBytes: 200 });
  const o = await R.runIntake(ask, w.deps);
  ok("a limit too small for even one try: refused, nothing reserved or sent", o.status === "refused" && w.calls.reserved === 0 && w.calls.model === 0, o.reason); }
{ const w = world({ script: ["ok"] });
  const o = await R.runIntake(ask, w.deps);
  const want = (5000 * 3 + 400 * 15) / 1e4;
  ok("a try with usage is charged its actual cost (input at $3/MTok since no cache marker is sent, output $15/MTok), cost known", Math.abs(o.charged_cents - Math.round(want * 100) / 100) < 0.01 && o.cost_known === true && w.calls.settled[0].usage.input_tokens === 5000, o.charged_cents); }
{ const w = world({ script: ["Anthropic 400: bad request"] });
  const o = await R.runIntake(ask, w.deps);
  ok("an error not worth retrying: one try, charged at its bound (the provider publishes no rule that errors are free), not retried", w.calls.model === 1 && o.status === "failed" && o.cost_known === false); }
// Fuzz: any mix of failures, any page size, any budget row — the run never charges more than its limit, never more than $1.
let worst = 0, over = 0;
for (let k = 0; k < 400; k++) {
  const perRun = 1 + Math.floor(Math.random() * 1000);
  const script = Array.from({ length: 5 }, () => ["ok", "nousage", "Anthropic 529: overloaded", "fetch failed", "Anthropic 500: x"][Math.floor(Math.random() * 5)]);
  const w = world({ perRun, script, pageBytes: Math.floor(Math.random() * 120000) });
  const o = await R.runIntake(ask, w.deps);
  const c = o.charged_cents ?? 0;
  worst = Math.max(worst, c);
  if (c > Math.min(100, perRun) + 1e-6) over++;
}
ok(`400 random runs (failures, page sizes, budget rows 1–1000¢): none charged past its limit; the most was ${worst.toFixed(2)}¢`, over === 0 && worst <= 100, { over, worst });

// ── the page fetch guard: real TLS connections to a local server, the host resolved only by the pinned lookup ───────
for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::ffff:10.0.0.1", "::ffff:a00:1", "fd00::1", "fe80::1", "::"])
  ok(`the page fetch refuses ${ip}`, P.isBlockedAddress(ip) === true);
ok("…and allows a public address", P.isBlockedAddress("93.184.216.34") === false && P.isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946") === false);
{
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const https = await import("node:https");
  let tls = null;
  const dir = mkdtempSync(join(tmpdir(), "pinned-"));
  try {   // a throwaway identity for made-up hosts, made here and deleted after (nothing kept in the repo)
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k"), "-out", join(dir, "c"), "-days", "1", "-subj", "/CN=pinned.test",
      "-addext", "subjectAltName=DNS:pinned.test,DNS:rebind.test,DNS:hop.test"], { stdio: "ignore" });
    tls = { key: readFileSync(join(dir, "k")), cert: readFileSync(join(dir, "c")) };
  } catch { tls = null; } finally { rmSync(dir, { recursive: true, force: true }); }
  if (!tls) { console.log("  · fetch pinning on real connections: NOT RUN (no openssl here) — the address checks above still ran"); }
  else {
    const hits = [];
    const srv = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      hits.push(`${req.headers.host}${req.url}`);
      if (req.url === "/hop") { res.writeHead(302, { location: "https://hop.test/next" }); return res.end(); }
      if (req.url === "/meta") { res.writeHead(302, { location: "https://169.254.169.254/latest/meta-data" }); return res.end(); }
      res.writeHead(200, { "content-type": "text/html" }); res.end(`<html><script>evil()</script><p>${"é".repeat(500)} page ${req.url}</p></html>`);
    });
    await new Promise((r) => srv.listen(443, "127.0.0.1", r).on("error", () => srv.listen(0, "127.0.0.1", r)));
    const port = srv.address().port;
    // The local server stands for "a public address": the test treats 127.0.0.1 as public and 10.66.0.1 as internal.
    const isBlocked = (ip) => ip !== "127.0.0.1" && (ip === "10.66.0.1" || P.isBlockedAddress(ip));
    const opts = (resolve) => ({ resolve, isBlocked, tls: { ca: tls.cert, port } });
    const fetchIt = async (url, resolve) => { try { return await P.fetchPageText(url, 100, opts(resolve)); } catch (e) { return { error: e.message }; } };
    let calls = 0;
    const one = await fetchIt("https://pinned.test/a", async (h) => { calls++; return h === "pinned.test" ? ["127.0.0.1"] : []; });
    ok("a real TLS fetch connects to exactly the address its lookup validated (the host has no DNS of its own), resolved once, cert checked against the name",
      one.connected?.join() === "127.0.0.1" && calls === 1 && hits.includes("pinned.test/a") && /page \/a/.test(one.text) === false && Buffer.byteLength(one.text) <= 100 && !/evil/.test(one.text), { one, calls, hits });
    // Rebinding: public on the first answer, internal on every later one. A second resolution would be caught here.
    let n = 0;
    const rb = await fetchIt("https://rebind.test/a", async () => (n++ === 0 ? ["127.0.0.1"] : ["10.66.0.1"]));
    ok("a host that changes its answer after the check: the connection still uses the first (validated) answer — one resolution per connection", rb.connected?.join() === "127.0.0.1" && n === 1, { rb, n });
    const mixed = await fetchIt("https://pinned.test/a", async () => ["127.0.0.1", "10.66.0.1"]);
    ok("an answer with any internal address in it is refused, nothing sent", /public web/.test(mixed.error ?? ""), mixed);
    hits.length = 0;
    const hop = await fetchIt("https://pinned.test/hop", async (h) => (h === "pinned.test" || h === "hop.test" ? ["127.0.0.1"] : []));
    ok("a redirect is a new connection with its own pinned check (2 hops, 2 validated connections)", hop.connected?.length === 2 && hits.join() === "pinned.test/hop,hop.test/next", { hop, hits });
    hits.length = 0;
    const meta = await fetchIt("https://pinned.test/meta", async (h) => (h === "pinned.test" ? ["127.0.0.1"] : []));
    ok("a redirect to the metadata address is refused at its connection, never reached", /public web/.test(meta.error ?? "") && hits.length === 1, { meta, hits });
    const wrongCert = await fetchIt("https://other.test/a", async () => ["127.0.0.1"]);
    ok("a host whose certificate doesn't name it fails TLS (pinning the address doesn't bypass the name check)", !!wrongCert.error && !wrongCert.text, wrongCert);
    srv.close();
  }
}
ok("http is refused before any connection", /Only https/.test((await P.fetchPageText("http://maker.test/x", 100).catch((e) => ({ error: e.message }))).error));
ok("a non-standard port is refused", /standard https port/.test((await P.fetchPageText("https://maker.test:8443/x", 100).catch((e) => ({ error: e.message }))).error));

console.log(`IMS8 THE $1 RESEARCH LIMIT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
