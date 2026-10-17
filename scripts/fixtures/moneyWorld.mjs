// A DATABASE AND A ROUTE LOADER FOR RUNNING THE APP'S OWN ROUTES (R16, 2026-10-17 — the 10/10 audit, operations F13).
//
// The money routes were held to their order by reading their text (scripts/chargeonce.test.mjs's stand-in for
// /api/checkout, regexes in scripts/smoke.cjs): a route could keep the shape the tests read and still charge the wrong
// amount, or charge where it should have refused. scripts/routes.money.test.mjs runs the route file itself, compiled
// from its TypeScript, the way Next calls it — with this in place of Supabase:
//
//   · tables as arrays of rows, read and written through supabase-js's builder (select, insert, update, upsert, delete;
//     eq/neq/in/is/like/ilike/not/gt/gte/lt/lte/or; order, limit, single, maybeSingle; count, head), with Postgres's rules for
//     a null in a comparison;
//   · unique keys per table — an insert that repeats one answers 23505, as Postgres does;
//   · `rpc` answered by functions the test gives (rate_limit_hit, resolve_customer, stop_menu, …);
//   · `auth.getUser(token)` answered from the sessions the test gives — or failing as the auth service fails;
//   · `fail[table][op]`: the next call of that kind answers the error given instead (a missing table, a refusal);
//   · `embed[table]`: a read that names another table (`products!inner(slug)`) is answered by the test's function.
//
// Every call is kept in `calls`. Nothing here talks to Supabase.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nodeRequire = createRequire(import.meta.url);

/** A file of the app, compiled. `@/x` and `./x` resolve inside the repo; anything named in `shims` is stood in for. */
export function routeLoader(shims = {}) {
  const cache = new Map();
  const load = (rel) => {
    if (cache.has(rel)) return cache.get(rel).exports;
    const mod = { exports: {} };
    cache.set(rel, mod);
    const out = ts.transpileModule(readFileSync(join(ROOT, rel), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function("module", "exports", "require", out)(mod, mod.exports, (spec) => {
      if (Object.prototype.hasOwnProperty.call(shims, spec)) return shims[spec];
      if (spec.startsWith("node:") || spec === "crypto") return nodeRequire(spec.startsWith("node:") ? spec : `node:${spec}`);
      if (spec.startsWith("@/")) return load(`${spec.slice(2)}.ts`);
      if (spec.startsWith("./")) {
        const base = join(dirname(rel), spec.slice(2));
        if (Object.prototype.hasOwnProperty.call(shims, `@/${base}`)) return shims[`@/${base}`];
        return load(`${base}.ts`);
      }
      if (spec.endsWith(".json")) return JSON.parse(readFileSync(join(ROOT, spec.replace(/^@\//, "")), "utf8"));
      throw new Error(`unexpected import ${spec} in ${rel}`);
    });
    return mod.exports;
  };
  return load;
}

/** next/server as a route uses it: a Response that can answer JSON. */
export class NextResponseShim extends Response {
  static json(body, init) { return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }); }
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;
// SQL's LIKE as PostgREST's like/ilike send it: % any run, _ any one character, a backslash makes the next one plain.
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function likeRe(pattern, flags) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) re += esc(pattern[++i]);
    else re += ch === "%" ? "[\\s\\S]*" : ch === "_" ? "[\\s\\S]" : esc(ch);
  }
  return new RegExp(`^${re}$`, flags);
}
const cmp = (a, b) => (typeof a === "string" && typeof b === "string" && ISO.test(a) && ISO.test(b) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);
function test(row, col, op, v) {
  const x = col.includes(".") ? undefined : row[col];
  if (op === "is") return v === null || v === "null" ? x == null : x === (v === "true" ? true : v === "false" ? false : v);
  if (x == null) return false;
  switch (op) {
    case "eq": return String(x) === String(v);
    case "neq": return String(x) !== String(v);
    case "gt": return cmp(x, v) > 0;
    case "gte": return cmp(x, v) >= 0;
    case "lt": return cmp(x, v) < 0;
    case "lte": return cmp(x, v) <= 0;
    case "in": return v.map(String).includes(String(x));
    case "like": return likeRe(String(v), "").test(String(x));
    case "ilike": return likeRe(String(v), "i").test(String(x));
    default: throw new Error(`money world: no operator ${op}`);
  }
}
function orOf(list) {
  const parts = list.split(",").map((p) => {
    const i = p.indexOf("."), j = p.indexOf(".", i + 1);
    return { col: p.slice(0, i), op: p.slice(i + 1, j), v: p.slice(j + 1) };
  });
  return (row) => parts.some((c) => test(row, c.col, c.op, c.op === "is" && c.v === "null" ? null : c.v));
}
const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function project(row, cols) {
  if (!cols || cols.trim() === "*") return copy(row);
  const out = {};
  for (const raw of cols.split(",").map((c) => c.trim()).filter(Boolean)) {
    if (raw.includes("(")) continue;   // an embedded table: answered by `embed`
    out[raw] = row[raw] === undefined ? null : copy(row[raw]);
  }
  return out;
}

/**
 * The world. `tables`: { name: rows[] }. `unique`: { name: [column | [columns]] }. `rpc`: { name: (args, world) => data |
 * { error } }. `sessions`: { token: user } (a user, or "down" to fail like the auth service, or an Error to throw).
 * `defaults`: { name: () => row } — a table's column defaults, filled in where an insert leaves them out.
 */
export function moneyWorld({ tables = {}, unique = {}, rpc = {}, sessions = {}, embed = {}, defaults = {} } = {}) {
  const w = { tables, unique, rpcs: rpc, sessions, embed, defaults, calls: [], fail: {} };
  const rowsOf = (t) => (w.tables[t] ??= []);
  const failed = (table, op) => {
    const f = w.fail[table]?.[op];
    if (!f) return null;
    if (!f.sticky) delete w.fail[table][op];
    return { data: null, error: f.error ?? f, count: null };
  };
  const dupe = (table, row, except = null) => {
    for (const k of w.unique[table] ?? []) {
      const cols = Array.isArray(k) ? k : [k];
      if (cols.some((c) => row[c] == null)) continue;
      if (rowsOf(table).some((r) => r !== except && cols.every((c) => String(r[c]) === String(row[c])))) {
        return { code: "23505", message: `duplicate key value violates unique constraint "${table}_${cols.join("_")}_key"` };
      }
    }
    return null;
  };

  w.from = (table) => {
    const call = { table, op: "select", ops: [] };
    w.calls.push(call);
    const keep = [];
    let ord = [], lim = Infinity, count = false, head = false, single = null, cols = "*", wantRows = false;
    let write = null;   // { kind: insert|update|upsert|delete, values, opts }
    const filterRows = () => rowsOf(table).filter((r) => keep.every((f) => f(r)));
    const run = () => {
      const f = failed(table, write?.kind ?? "select");
      if (f) return f;
      if (write?.kind === "insert" || write?.kind === "upsert") {
        const list = Array.isArray(write.values) ? write.values : [write.values];
        const made = [];
        for (const v of list) {
          // A column's default, as the table's own (an id, a created_at): only where the row leaves it out.
          const row = { ...(w.defaults[table] ? w.defaults[table]() : {}), ...copy(v) };
          if (write.kind === "upsert") {
            const on = (write.opts?.onConflict ?? "id").split(",").map((s) => s.trim());
            const hit = rowsOf(table).find((r) => on.every((c) => String(r[c]) === String(row[c])));
            if (hit) { if (!write.opts?.ignoreDuplicates) Object.assign(hit, row); made.push(hit); continue; }
          }
          const clash = dupe(table, row);
          if (clash) return { data: null, error: clash, count: null };
          rowsOf(table).push(row);
          made.push(row);
        }
        const data = made.map((r) => project(r, cols));
        if (single) return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
        return { data: wantRows ? data : null, error: null, count: null };
      }
      if (write?.kind === "update") {
        const hit = filterRows();
        for (const r of hit) {
          const next = { ...r, ...copy(write.values) };
          const clash = dupe(table, next, r);
          if (clash) return { data: null, error: clash, count: null };
        }
        for (const r of hit) Object.assign(r, copy(write.values));
        const data = hit.map((r) => project(r, cols));
        if (single) return single === "maybe" ? { data: data[0] ?? null, error: null } : data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: wantRows ? data : null, error: null, count: null };
      }
      if (write?.kind === "delete") {
        const hit = filterRows();
        w.tables[table] = rowsOf(table).filter((r) => !hit.includes(r));
        return { data: wantRows ? hit.map((r) => project(r, cols)) : null, error: null, count: null };
      }
      // select
      let out = w.embed[table] ? w.embed[table]({ ops: call.ops, rows: rowsOf(table) }) : filterRows();
      for (const o of [...ord].reverse()) out = [...out].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.c], b[o.c]));
      const n = out.length;
      if (lim !== Infinity) out = out.slice(0, lim);
      const data = w.embed[table] ? out : out.map((r) => project(r, cols));
      if (single === "maybe") return data.length > 1 ? { data: null, error: { code: "PGRST116", message: "multiple rows" } } : { data: data[0] ?? null, error: null };
      if (single === "one") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { data: head ? null : data, error: null, count: count ? n : null };
    };
    const q = {
      select(c = "*", opts = {}) { call.ops.push(["select", c, opts]); cols = c; wantRows = true; count = opts.count === "exact"; head = !!opts.head; return q; },
      insert(values, opts) { call.op = "insert"; call.ops.push(["insert", values]); write = { kind: "insert", values, opts }; return q; },
      upsert(values, opts) { call.op = "upsert"; call.ops.push(["upsert", values, opts]); write = { kind: "upsert", values, opts }; return q; },
      update(values) { call.op = "update"; call.ops.push(["update", values]); write = { kind: "update", values }; return q; },
      delete() { call.op = "delete"; call.ops.push(["delete"]); write = { kind: "delete" }; return q; },
      eq(c, v) { call.ops.push(["eq", c, v]); keep.push((r) => test(r, c, "eq", v)); return q; },
      neq(c, v) { call.ops.push(["neq", c, v]); keep.push((r) => test(r, c, "neq", v)); return q; },
      gt(c, v) { call.ops.push(["gt", c, v]); keep.push((r) => test(r, c, "gt", v)); return q; },
      gte(c, v) { call.ops.push(["gte", c, v]); keep.push((r) => test(r, c, "gte", v)); return q; },
      lt(c, v) { call.ops.push(["lt", c, v]); keep.push((r) => test(r, c, "lt", v)); return q; },
      lte(c, v) { call.ops.push(["lte", c, v]); keep.push((r) => test(r, c, "lte", v)); return q; },
      in(c, v) { call.ops.push(["in", c, v]); if (!c.includes(".")) keep.push((r) => test(r, c, "in", v)); return q; },
      is(c, v) { call.ops.push(["is", c, v]); keep.push((r) => test(r, c, "is", v)); return q; },
      like(c, v) { call.ops.push(["like", c, v]); keep.push((r) => test(r, c, "like", v)); return q; },
      ilike(c, v) { call.ops.push(["ilike", c, v]); keep.push((r) => test(r, c, "ilike", v)); return q; },
      not(c, op, v) { call.ops.push(["not", c, op, v]); keep.push((r) => !test(r, c, op, v === "null" ? null : v)); return q; },
      or(list) { call.ops.push(["or", list]); keep.push(orOf(list)); return q; },
      order(c, o = {}) { call.ops.push(["order", c, o]); ord.push({ c, asc: o.ascending !== false }); return q; },
      limit(n) { call.ops.push(["limit", n]); lim = n; return q; },
      maybeSingle() { call.ops.push(["maybeSingle"]); single = "maybe"; return q; },
      single() { call.ops.push(["single"]); single = "one"; return q; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
    };
    return q;
  };

  w.rpc = async (name, args) => {
    w.calls.push({ rpc: name, args });
    const f = failed(`rpc:${name}`, "call");
    if (f) return f;
    const fn = w.rpcs[name];
    if (!fn) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } };
    const out = await fn(args, w);
    return out && typeof out === "object" && "error" in out ? { data: null, ...out } : { data: out ?? null, error: null };
  };

  w.auth = {
    async getUser(token) {
      const s = w.sessions[token];
      if (s instanceof Error) throw s;
      if (s === "down") return { data: { user: null }, error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }) };
      if (!s) return { data: { user: null }, error: Object.assign(new Error("invalid JWT"), { name: "AuthApiError", status: 401 }) };
      return { data: { user: s }, error: null };
    },
  };
  return w;
}
