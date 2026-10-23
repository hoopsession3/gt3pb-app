// A STAND-IN SUPABASE, OVER HTTP (R49, 2026-10-23 — Ryan: "were you able to audit a smokescreen test on the backend
// pages for all devices?"; the answer was no: the console needs a signed-in account and a database, and the checks had
// neither, so its screens had only ever been looked at by a person).
//
//   import { startFakebase } from "./fixtures/fakebase.mjs";
//   const fb = await startFakebase({ port: 54329, seed });   // fb.url, fb.db (PGlite), fb.failures, fb.close()
//
// The whole schema (scripts/fixtures/schema.full.mjs — every migration, in order) in PGlite, behind the four doors a
// page knocks on: PostgREST (/rest/v1 — tables and views, rpc), GoTrue (/auth/v1 — the one fixture account), Storage
// and Functions (answered empty). Every read and write runs as `authenticated` with the account's id in the claims, so
// RLS, grants and the security-definer functions answer as they answer production: a column that isn't there, a
// grant that's missing or a policy that refuses is the same 4xx here, and is recorded in `failures` for the harness
// (scripts/smoke.console.mjs) to fail on.
//
// PostgREST's grammar, the part this app sends (supabase-js): select lists with aliases, casts and embeds (many-to-one,
// one-to-many, `!inner`, `!hint`, `(count)`), the filters eq neq gt gte lt lte like ilike is in cs cd ov not.* or= and=,
// order (nullsfirst/last), limit/offset and Range, Prefer count=exact / return=representation / resolution=*-duplicates,
// the single-object Accept header; and rpc by named arguments, a set or a scalar. Nothing here is a credential: the
// session is a made-up token for a made-up account in a database that lives in this process.
import { createServer } from "node:http";
import { fullSchema } from "./schema.full.mjs";

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (s) => { if (!ID.test(s)) throw bad(`not a name: ${s}`); return `"${s}"`; };
const bad = (message, code = "PGRST100") => Object.assign(new Error(message), { pgrst: { code, message, status: 400 } });

// ── the select list ──────────────────────────────────────────────────────────────────────────────────────────────────
function splitTop(s, sep = ",") {
  const out = []; let depth = 0, cur = "", quote = false;
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function parseSelect(s) {
  return splitTop(s || "*").map((item) => {
    const paren = item.indexOf("(");
    if (paren > 0 && item.endsWith(")")) {
      let head = item.slice(0, paren), inner = item.slice(paren + 1, -1);
      let alias = null;
      const colon = head.indexOf(":");
      if (colon > 0 && head[colon + 1] !== ":") { alias = head.slice(0, colon); head = head.slice(colon + 1); }
      const [target, ...mods] = head.split("!");
      const inner_ = mods.includes("inner");
      const hint = mods.find((m) => m !== "inner" && m !== "left") ?? null;
      if (target === "count" && !inner) return { kind: "agg", fn: "count", alias: alias ?? "count" };
      return { kind: "embed", target, alias: alias ?? target, hint, inner: inner_, select: parseSelect(inner) };
    }
    if (item === "*") return { kind: "star" };
    if (/^count\(\)$/.test(item) || item === "count") return { kind: "agg", fn: "count", alias: "count" };
    let alias = null, expr = item;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):(?!:)(.+)$/.exec(item);
    if (m) { alias = m[1]; expr = m[2]; }
    let cast = null;
    const c = /^(.+?)::([a-z_ ]+)$/.exec(expr);
    if (c) { expr = c[1]; cast = c[2]; }
    return { kind: "col", expr, alias, cast };
  });
}

// col, col->a->>b
function colExpr(expr, rel) {
  const parts = expr.split(/(->>?)/);
  let out = `${rel}.${q(parts[0])}`;
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i + 1];
    out += `${parts[i]}${/^\d+$/.test(key) ? key : `'${key.replace(/'/g, "''")}'`}`;
  }
  return out;
}
const lastKey = (expr) => expr.split(/->>?/).pop();

// ── the schema's relationships (read once) ───────────────────────────────────────────────────────────────────────────
async function relations(db) {
  const fks = (await db.query(`
    select c.conname, src.relname src, tgt.relname tgt,
      (select array_agg(a.attname order by k.ord) from unnest(c.conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) src_cols,
      (select array_agg(a.attname order by k.ord) from unnest(c.confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n) tgt_cols
    from pg_constraint c join pg_class src on src.oid = c.conrelid join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace join pg_namespace tn on tn.oid = tgt.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and tn.nspname = 'public'`)).rows;
  // Views: PostgREST infers their relationships through the base table's keys. Map a view to its single base table.
  const views = (await db.query(`
    select v.relname view, (array_agg(distinct t.relname))[1] base, count(distinct t.relname)::int n
    from pg_class v join pg_namespace ns on ns.oid = v.relnamespace and ns.nspname = 'public'
    join pg_depend d on d.refobjid <> v.oid join pg_rewrite r on r.oid = d.objid and r.ev_class = v.oid
    join pg_class t on t.oid = d.refobjid and t.relkind in ('r', 'p')
    where v.relkind = 'v' group by v.relname`)).rows;
  const baseOf = new Map(views.filter((v) => v.n === 1).map((v) => [v.view, v.base]));
  return { fks, baseOf };
}

function findRel(R, from, to, hint) {
  const b = (t) => R.baseOf.get(t) ?? t;
  const F = b(from), T = b(to);
  let cands = [
    ...R.fks.filter((k) => k.src === F && k.tgt === T).map((k) => ({ k, dir: "one" })),   // from.fk → to.pk: one
    ...R.fks.filter((k) => k.src === T && k.tgt === F).map((k) => ({ k, dir: "many" })),  // to.fk → from.pk: many
  ];
  if (hint) {
    const h = cands.filter(({ k }) => k.conname === hint || k.src_cols.includes(hint) || k.tgt_cols.includes(hint));
    if (h.length) cands = h;
  }
  if (F === T && cands.length > 1) cands = cands.filter((c) => c.dir === "one");
  if (!cands.length) throw Object.assign(new Error(`Could not find a relationship between '${from}' and '${to}' in the schema cache`), { pgrst: { code: "PGRST200", status: 400, message: `Could not find a relationship between '${from}' and '${to}' in the schema cache` } });
  if (cands.length > 1) throw Object.assign(new Error(`more than one relationship between '${from}' and '${to}'`), { pgrst: { code: "PGRST201", status: 300, message: `Could not embed because more than one relationship was found for '${from}' and '${to}'` } });
  return cands[0];
}

// SELECT list → SQL json object pieces
let aliasN = 0, castN = 0;
function selectSql(items, rel, table, R, filtersByPath, path) {
  const cols = [];
  const innerConds = [];
  for (const it of items) {
    if (it.kind === "star") cols.push(`${rel}.*`);
    else if (it.kind === "col") cols.push(`${it.cast ? `(${colExpr(it.expr, rel)})::${it.cast}` : colExpr(it.expr, rel)} as ${q(it.alias ?? lastKey(it.expr))}`);
    else if (it.kind === "agg") cols.push(`count(*) as ${q(it.alias)}`);
    else if (it.kind === "embed") {
      const { k, dir } = findRel(R, table, it.target, it.hint);
      const sub = `e${++aliasN}`;
      const join = dir === "one"
        ? k.src_cols.map((c, i) => `${sub}.${q(k.tgt_cols[i])} = ${rel}.${q(c)}`).join(" and ")
        : k.src_cols.map((c, i) => `${sub}.${q(c)} = ${rel}.${q(k.tgt_cols[i])}`).join(" and ");
      const subPath = [...path, it.alias];
      const subFilters = filtersByPath.get(subPath.join(".")) ?? [];
      const where = [join, ...subFilters.map((f) => f(sub))].join(" and ");
      const isCount = it.select.length === 1 && it.select[0].kind === "agg";
      const inner = isCount ? null : selectSql(it.select, sub, it.target, R, filtersByPath, subPath);
      const body = isCount
        ? `(select json_build_array(json_build_object('count', count(*))) from public.${q(it.target)} ${sub} where ${where})`
        : dir === "one"
          ? `(select row_to_json(x) from (select ${inner.cols} from public.${q(it.target)} ${sub} where ${where} limit 1) x)`
          : `(select coalesce(json_agg(x), '[]'::json) from (select ${inner.cols} from public.${q(it.target)} ${sub} where ${where}) x)`;
      cols.push(`${body} as ${q(it.alias)}`);
      if (it.inner) innerConds.push(dir === "one" ? `${body} is not null` : `json_array_length(${body}) > 0`);
    }
  }
  return { cols: cols.join(", ") || `${rel}.*`, innerConds };
}

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function unquote(v) { return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v; }
function listOf(v) { const m = /^\((.*)\)$/s.exec(v); if (!m) throw bad(`not a list: ${v}`); return splitTop(m[1]).map(unquote); }

function cond(col, opv, P) {
  // col may be a json path
  let neg = false, rest = opv;
  if (rest.startsWith("not.")) { neg = true; rest = rest.slice(4); }
  const dot = rest.indexOf(".");
  const op = rest.slice(0, dot < 0 ? undefined : dot), raw = dot < 0 ? "" : rest.slice(dot + 1);
  const opMod = /^(\w+)\((any|all)\)$/.exec(op);
  const base = opMod ? opMod[1] : op;
  const sqlOp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike", cs: "@>", cd: "<@", ov: "&&", match: "~", imatch: "~*" }[base];
  let make;
  if (base === "is") {
    const v = raw.toLowerCase();
    const lit = { null: "null", true: "true", false: "false", unknown: "unknown" }[v];
    if (!lit) throw bad(`is.${raw}`);
    make = (r) => `${colExpr(col, r)} is ${lit}`;
  } else if (base === "in") {
    const vals = listOf(raw);
    const i = P.push(vals);
    make = (r) => `${colExpr(col, r)}::text = any($${i}::text[])`;
  } else if (opMod) {
    const vals = listOf(raw.startsWith("{") ? `(${raw.slice(1, -1)})` : raw).map((x) => (base === "like" || base === "ilike" ? x.replace(/\*/g, "%") : x));
    const i = P.push(vals);
    make = (r) => `${colExpr(col, r)}::text ${sqlOp} ${opMod[2]}($${i}::text[])`;
  } else if (base === "fts" || base === "plfts" || base === "wfts" || base === "phfts") {
    const i = P.push(raw.includes(".") && /^\w+\./.test(raw) ? raw.slice(raw.indexOf(".") + 1) : raw);
    make = (r) => `to_tsvector(${colExpr(col, r)}::text) @@ plainto_tsquery($${i})`;
  } else if (sqlOp) {
    let v = unquote(raw);
    if (base === "like" || base === "ilike") v = v.replace(/\*/g, "%");
    if (base === "cs" || base === "cd" || base === "ov") {
      const i = P.push(v);
      const n = ++castN;
      make = (r) => `${colExpr(col, r)} ${sqlOp} ($${i}::text)::__CAST${n}__`;
      make.needsType = true;
    } else {
      const i = P.push(v);
      // compare as the column's own type: text param cast by the column's type, read below
      const n = ++castN;
      make = (r) => `${colExpr(col, r)} ${sqlOp} ${col.includes("->>") ? `$${i}::text` : `$${i}::__CAST${n}__`}`;
      make.n = n;
      make.needsCast = true;
    }
  } else throw bad(`operator ${op} is not known here`);
  const f = (r) => (neg ? `not (${make(r)})` : make(r));
  f.col = col; f.n = make.n ?? (make.needsType ? castN : null);
  return f;
}

function logic(expr, P) {
  // or=(a.eq.1,and(b.gt.2,c.is.null))
  const m = /^(not\.)?(or|and)\((.*)\)$/s.exec(expr);
  if (!m) {
    const i = expr.indexOf(".");
    return cond(expr.slice(0, i), expr.slice(i + 1), P);
  }
  const parts = splitTop(m[3]).map((p) => logic(p, P));
  const f = (r) => `${m[1] ? "not " : ""}(${parts.map((p) => p(r)).join(m[2] === "or" ? " or " : " and ")})`;
  f.parts = parts;
  return f;
}

// Types of columns, so a text parameter is compared as the column's own type (a uuid = uuid, a timestamptz as an instant).
async function columnTypes(db) {
  const rows = (await db.query(`
    select c.relname t, a.attname col, format_type(a.atttypid, a.atttypmod) typ
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v', 'm', 'p')`)).rows;
  const m = new Map();
  for (const r of rows) m.set(`${r.t}.${r.col}`, r.typ);
  return m;
}
function typeFix(sql, f, table, T) {
  if (f.n == null) return sql;
  const typ = table ? T.get(`${table}.${f.col.split(/->>?/)[0]}`) ?? "text" : "text";
  const castable = typ.replace(/\(.*\)/, "").replace(/^character varying$/, "text");
  return sql.split(`__CAST${f.n}__`).join(f.col.includes("->") ? "text" : castable);
}

// ── order ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function orderSql(s, rel) {
  return splitTop(s).map((term) => {
    const bits = term.split(".");
    const col = bits[0];
    if (col.includes("(")) return null;     // ordering by an embedded column: not here
    const dir = bits.includes("desc") ? "desc" : "asc";
    const nulls = bits.includes("nullsfirst") ? " nulls first" : bits.includes("nullslast") ? " nulls last" : "";
    return `${colExpr(col, rel)} ${dir}${nulls}`;
  }).filter(Boolean).join(", ");
}

// ── the server ───────────────────────────────────────────────────────────────────────────────────────────────────────
export async function startFakebase({ port = 54329, before, seed, user } = {}) {
  const db = await fullSchema(before ? { before } : {});
  if (seed) await seed(db);
  const R = await relations(db);
  let T = await columnTypes(db);
  const failures = [];
  const calls = [];
  const fnCache = new Map();

  const claims = () => JSON.stringify({ sub: user.id, role: "authenticated", email: user.email, aal: "aal2", amr: [{ method: "totp" }] });
  const asUser = (fn) => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claims', $2, true), set_config('request.jwt.claim.email', $3, true)`, [user.id, claims(), user.email]);
    await tx.exec(`set local role authenticated`);
    return fn(tx);
  });

  async function fnInfo(name) {
    if (fnCache.has(name)) return fnCache.get(name);
    const rows = (await db.query(`
      select p.proretset set, p.prorettype::regtype::text ret, coalesce(p.proargnames, '{}') names,
        coalesce(p.proargmodes::text[], '{}') modes, (select array_agg(format_type(t, null)) from unnest(p.proargtypes) t) types,
        t.typtype = 'c' or p.prorettype = 'record'::regtype composite
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1`, [name])).rows;
    fnCache.set(name, rows);
    return rows;
  }

  async function rpc(name, args) {
    const overloads = await fnInfo(name);
    if (!overloads.length) throw Object.assign(new Error(`Could not find the function public.${name}`), { pgrst: { code: "PGRST202", status: 404, message: `Could not find the function public.${name} without parameters in the schema cache` } });
    const keys = Object.keys(args);
    const pick = overloads.find((o) => {
      const ins = o.names.filter((_, i) => !o.modes.length || ["i", "b", "v"].includes(o.modes[i]));
      return keys.every((k) => ins.includes(k));
    }) ?? overloads[0];
    const ins = pick.names.map((n, i) => ({ n, mode: pick.modes[i] ?? "i" })).filter((a) => ["i", "b", "v"].includes(a.mode));
    const P = [];
    const named = keys.map((k) => {
      const at = ins.findIndex((a) => a.n === k);
      const typ = pick.types?.[at] ?? "text";
      const v = args[k];
      P.push(v === null || v === undefined ? null : typeof v === "object" && !/\[\]$/.test(typ) ? JSON.stringify(v) : Array.isArray(v) ? v : v);
      return `${q(k)} => $${P.length}::${typ}`;
    }).join(", ");
    const call = `public.${q(name)}(${named})`;
    const sql = pick.set || pick.composite
      ? (pick.set ? `select coalesce(json_agg(t), '[]'::json) j from ${call} t` : `select row_to_json(t) j from ${call} t`)
      : `select to_json(${call}) j`;
    const rows = await asUser((tx) => tx.query(sql, P));
    let j = rows.rows[0]?.j ?? null;
    if (!pick.set && pick.composite && j && Object.values(j).every((v) => v === null) && pick.ret === "record") j = null;
    return j;
  }

  async function table(method, name, params, headers, body) {
    if (!ID.test(name)) throw bad(`not a table: ${name}`);
    const exists = (await db.query(`select c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = $1`, [name])).rows[0];
    if (!exists) throw Object.assign(new Error(`relation public.${name} does not exist`), { pgrst: { code: "42P01", status: 404, message: `Could not find the table 'public.${name}' in the schema cache` } });
    const P = [];
    const sel = parseSelect(params.get("select") ?? "*");
    const top = [], byPath = new Map();
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
      if (k === "or" || k === "and" || k === "not.or" || k === "not.and") { top.push(logic(`${k}${v}`, P)); continue; }
      const segs = k.split(".");
      if (segs.length > 1 && !k.includes("->")) {   // a filter on an embed: alias.col
        const path = segs.slice(0, -1).join(".");
        const f = cond(segs.at(-1), v, P);
        const arr = byPath.get(path) ?? []; arr.push((r) => f(r).replace(/__CAST\d+__/g, "text").replace(/^(.*?) (=|<>|>|>=|<|<=) \$/, "$1::text $2 $$")); byPath.set(path, arr);
        continue;
      }
      top.push(cond(k, v, P));
    }
    const fix = (sql, f) => {
      const walk = (x) => (x.parts ? x.parts.forEach(walk) : (sql = typeFix(sql, x, name, T)));
      walk(f); return sql;
    };
    const where = (rel) => top.map((f) => fix(f(rel), f)).join(" and ") || "true";
    const prefer = headers["prefer"] ?? "";
    const wantCount = /count=(exact|planned|estimated)/.test(prefer);
    const single = (headers["accept"] ?? "").includes("vnd.pgrst.object");
    let limit = params.get("limit"), offset = params.get("offset");
    const range = /^(\d+)-(\d+)?$/.exec(headers["range"] ?? "");
    if (range) { offset = range[1]; if (range[2]) limit = String(Number(range[2]) - Number(range[1]) + 1); }

    if (method === "GET" || method === "HEAD") {
      const { cols, innerConds } = selectSql(sel, "t0", name, R, byPath, []);
      const conds = [where("t0"), ...innerConds].join(" and ");
      const ord = params.get("order") ? orderSql(params.get("order"), "t0") : "";
      const hasAgg = sel.some((s) => s.kind === "agg");
      const groupCols = hasAgg ? sel.filter((s) => s.kind === "col").map((s) => colExpr(s.expr, "t0")) : [];
      const inner = `select ${cols} from public.${q(name)} t0 where ${conds}${groupCols.length ? ` group by ${groupCols.join(", ")}` : ""}${ord ? ` order by ${ord}` : ""}${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
      const out = await asUser(async (tx) => {
        const rows = (await tx.query(`select coalesce(json_agg(x), '[]'::json) j from (${inner}) x`, P)).rows[0].j;
        const n = wantCount ? (await tx.query(`select count(*)::int n from public.${q(name)} t0 where ${conds}`, P)).rows[0].n : null;
        return { rows, n };
      });
      return { rows: out.rows, count: out.n, single, offset: Number(offset ?? 0) };
    }

    const ret = /return=representation/.test(prefer);
    const { cols } = selectSql(sel, "r", name, R, byPath, []);
    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length) return { rows: [], single };
      const keys = params.get("columns")?.split(",") ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const i = P.push(JSON.stringify(rows));
      const upsert = /resolution=(merge|ignore)-duplicates/.exec(prefer);
      const conflict = params.get("on_conflict");
      let tail = "";
      if (upsert) {
        const target = conflict ? `(${conflict.split(",").map(q).join(", ")})` : "";
        tail = upsert[1] === "ignore" ? ` on conflict ${target} do nothing` : ` on conflict ${target} do update set ${keys.filter((k) => !(conflict ?? "").split(",").includes(k)).map((k) => `${q(k)} = excluded.${q(k)}`).join(", ") || `${q(keys[0])} = excluded.${q(keys[0])}`}`;
      }
      const sql = `with r as (insert into public.${q(name)} (${keys.map(q).join(", ")}) select ${keys.map(q).join(", ")} from json_populate_recordset(null::public.${q(name)}, $${i}::json)${tail} returning *) select coalesce(json_agg(x), '[]'::json) j from (select ${cols} from r) x`;
      const j = (await asUser((tx) => tx.query(sql, P))).rows[0].j;
      return { rows: ret ? j : [], single, status: 201 };
    }
    if (method === "PATCH") {
      const keys = Object.keys(body ?? {});
      if (!keys.length) return { rows: [], single };
      const i = P.push(JSON.stringify(body));
      const sql = `with r as (update public.${q(name)} t0 set ${keys.map((k) => `${q(k)} = s.${q(k)}`).join(", ")} from json_populate_record(null::public.${q(name)}, $${i}::json) s where ${where("t0")} returning t0.*) select coalesce(json_agg(x), '[]'::json) j from (select ${cols} from r) x`;
      const j = (await asUser((tx) => tx.query(sql, P))).rows[0].j;
      return { rows: ret ? j : [], single };
    }
    if (method === "DELETE") {
      const sql = `with r as (delete from public.${q(name)} t0 where ${where("t0")} returning t0.*) select coalesce(json_agg(x), '[]'::json) j from (select ${cols} from r) x`;
      const j = (await asUser((tx) => tx.query(sql, P))).rows[0].j;
      return { rows: ret ? j : [], single };
    }
    throw bad(`method ${method}`);
  }

  const send = (res, status, obj, extra = {}) => {
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", ...extra });
    res.end(obj === undefined ? "" : JSON.stringify(obj));
  };
  const pgErr = (e) => {
    if (e.pgrst) return e.pgrst;
    const code = e.code ?? "XX000";
    const status = /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : code === "42501" ? 403 : code === "P0002" ? 404 : code === "23505" ? 409 : code.startsWith("23") ? 409 : code.startsWith("42") ? 400 : code === "P0001" ? 400 : 400;
    return { code, status, message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
  };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS", "access-control-expose-headers": "content-range" });
      return res.end();
    }
    let raw = "";
    for await (const ch of req) raw += ch;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const call = { method: req.method, path: u.pathname, query: u.search, at: Date.now() };
    calls.push(call);
    try {
      if (u.pathname.startsWith("/auth/v1/")) {
        const p = u.pathname.slice(9);
        if (p === "user") return send(res, 200, user.object);
        if (p === "token") return send(res, 200, user.session());
        if (p === "factors" || p.startsWith("factors")) return send(res, 200, []);
        if (p === "logout") return send(res, 204);
        return send(res, 200, {});
      }
      if (u.pathname.startsWith("/storage/v1/")) {
        if (u.pathname.includes("/object/list/")) return send(res, 200, []);
        if (u.pathname.includes("/object/sign/")) return send(res, 200, { signedURL: "/missing" });
        return send(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
      }
      if (u.pathname.startsWith("/functions/v1/")) return send(res, 200, {});
      if (u.pathname.startsWith("/realtime/")) return send(res, 404, {});
      const m = /^\/rest\/v1\/(rpc\/)?([^/]+)$/.exec(u.pathname);
      if (!m) return send(res, 404, { message: "no such door" });
      if (m[1]) {
        const args = req.method === "GET" ? Object.fromEntries(u.searchParams) : (body ?? {});
        const j = await rpc(m[2], args);
        call.status = 200;
        return send(res, 200, j);
      }
      const r = await table(req.method, m[2], u.searchParams, headers, body);
      call.status = r.status ?? 200;
      if (r.single) {
        if (r.rows.length !== 1) {
          call.status = 406;
          return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${r.rows.length} rows`, hint: null });
        }
        return send(res, call.status, r.rows[0]);
      }
      const total = r.count ?? "*";
      const from = r.offset ?? 0;
      const cr = `${r.rows.length ? `${from}-${from + r.rows.length - 1}` : "*"}/${total}`;
      if (req.method === "HEAD") { res.writeHead(200, { "content-range": cr, "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" }); return res.end(); }
      return send(res, call.status, r.rows, { "content-range": cr });
    } catch (e) {
      const err = pgErr(e);
      call.status = err.status;
      failures.push({ method: req.method, path: u.pathname, query: decodeURIComponent(u.search).slice(0, 300), status: err.status, code: err.code, message: String(err.message).slice(0, 300) });
      return send(res, err.status, { code: err.code, message: err.message, details: err.details ?? null, hint: err.hint ?? null });
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${port}`, db, failures, calls,
    refresh: async () => { T = await columnTypes(db); fnCache.clear(); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
