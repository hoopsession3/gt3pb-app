// THE DATABASE'S SHAPE, FOR THE COMPILER (R31, 2026-10-18 — the 10/10 audit, operations F22).
//
//   node scripts/db.types.mjs           # write lib/database.types.ts from supabase/migrations/
//   node scripts/db.types.mjs --check   # fail if lib/database.types.ts is not what the migrations make
//
// WHY. Every read and write the server makes went through an untyped client: `.from("orders").select("totl_cents")` or
// an insert without a column the table requires compiled, and the first anyone heard of it was production's answer.
// scripts/columns.audit.mjs reads the select strings against the column snapshot, but nothing checked a row's shape — a
// number read as text, a column that can be null treated as if it can't, an RPC called with an argument it doesn't take.
//
// WHAT. Every migration is read into Postgres (PGlite, scripts/fixtures/schema.full.mjs — the same database the db tests
// use) and its catalog written out in the shape supabase-js reads (`Database`, as `supabase gen types` writes it): each
// table's Row, Insert and Update, and the foreign keys that name its relationships; each view's Row; each function's
// arguments and what it returns; each enum's values. Written from the migrations, not from production, so it needs no
// key and no network, and it says what the migrations say: a column a pending migration adds is in it, and
// scripts/columns.audit.mjs still holds what production has. The release fails when the file and the migrations differ
// (--check, in `npm test`), so a migration and the types it changes arrive together.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "lib/database.types.ts");

/** The TypeScript a Postgres type reads as — supabase gen types' own mapping. */
export function tsType(t, enums, rows = new Map()) {
  if (t.endsWith("[]")) return `${wrap(tsType(t.slice(0, -2), enums, rows))}[]`;
  const base = t.replace(/\(.*\)$/, "").replace(/^"|"$/g, "");
  if (enums.has(base)) return `Database["public"]["Enums"]["${base}"]`;
  if (rows.has(base)) return `Database["public"]["${rows.get(base)}"]["${base}"]["Row"]`;
  switch (base) {
    case "boolean": return "boolean";
    case "smallint": case "integer": case "bigint": case "real": case "double precision": case "numeric": case "oid": return "number";
    case "json": case "jsonb": return "Json";
    case "text": case "character varying": case "character": case "uuid": case "date": case "time without time zone":
    case "time with time zone": case "timestamp without time zone": case "timestamp with time zone": case "interval":
    case "bytea": case "inet": case "cidr": case "macaddr": case "citext": case "name": case "tsvector": case "money":
      return "string";
    case "void": return "undefined";
    default: return "unknown";
  }
}
const wrap = (s) => (/[|&]/.test(s) ? `(${s})` : s);
const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

export async function generate() {
  const db = await fullSchema();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const enumRows = await q(`select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by t.typname order by 1`);
  const enums = new Set(enumRows.map((r) => r.name));
  const rels = await q(`select c.oid, c.relname, c.relkind from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') order by c.relname`);
  const cols = await q(`select a.attrelid as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
      a.atthasdef as hasdef, a.attidentity as ident, a.attgenerated as gen, a.attnum
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped
    order by a.attrelid, a.attnum`);
  const fks = await q(`select c.conrelid as oid, c.conname as name, r.relname as ref,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cols,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as refcols,
      exists (select 1 from pg_index x where x.indrelid = c.conrelid and x.indisunique and x.indpred is null
                and (x.indkey::int2[])[0:x.indnatts - 1] @> c.conkey and (x.indkey::int2[])[0:x.indnatts - 1] <@ c.conkey) as one
    from pg_constraint c join pg_class r on r.oid = c.confrelid
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and r.relnamespace = 'public'::regnamespace
    order by c.conname`);
  const fns = await q(`select p.oid, p.proname as name, p.proretset as setof, format_type(p.prorettype, null) as ret, p.prorettype,
      p.pronargs as nargs, p.pronargdefaults as ndefaults, coalesce(p.proargnames, '{}') as argnames,
      coalesce(p.proargmodes::text[], '{}') as argmodes,
      array(select format_type(t, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) as t) as argtypes,
      rt.typrelid as retrel, rt.typtype as rettyptype
    from pg_proc p join pg_type rt on rt.oid = p.prorettype
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and format_type(p.prorettype, null) not in ('trigger', 'event_trigger')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    order by p.proname, p.oid`);
  const relByOid = new Map(rels.map((r) => [r.oid, r]));
  const rowTypes = new Map(rels.map((r) => [r.relname, r.relkind === "v" || r.relkind === "m" ? "Views" : "Tables"]));
  const colsBy = new Map();
  for (const c of cols) (colsBy.get(c.oid) ?? colsBy.set(c.oid, []).get(c.oid)).push(c);
  const fkBy = new Map();
  for (const f of fks) (fkBy.get(f.oid) ?? fkBy.set(f.oid, []).get(f.oid)).push(f);
  await db.close();

  const t = (c) => tsType(c.type, enums, rowTypes);
  const relationships = (oid) => {
    const list = fkBy.get(oid) ?? [];
    if (!list.length) return "[]";
    return "[\n" + list.map((f) => `          {\n            foreignKeyName: ${JSON.stringify(f.name)}\n            columns: ${JSON.stringify(f.cols)}\n` +
      `            isOneToOne: ${f.one}\n            referencedRelation: ${JSON.stringify(f.ref)}\n            referencedColumns: ${JSON.stringify(f.refcols)}\n          },\n`).join("") + "        ]";
  };
  const lines = [];
  const L = (s = "") => lines.push(s);
  L("// GENERATED by scripts/db.types.mjs from supabase/migrations/ — do not edit; run `node scripts/db.types.mjs`.");
  L("// The database's shape as the migrations make it (operations F22, R31): every table's Row, Insert and Update, its");
  L("// relationships, every view's Row, every function's arguments and return. `npm test` fails when this file and the");
  L("// migrations differ.");
  L("");
  L("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  L("");
  L("export type Database = {");
  L("  public: {");
  L("    Tables: {");
  for (const r of rels.filter((x) => x.relkind === "r" || x.relkind === "p")) {
    const cs = colsBy.get(r.oid) ?? [];
    L(`      ${key(r.relname)}: {`);
    L("        Row: {");
    for (const c of cs) L(`          ${key(c.name)}: ${t(c)}${c.notnull ? "" : " | null"}`);
    L("        }");
    L("        Insert: {");
    for (const c of cs) {
      if (c.gen === "s" || c.ident === "a") { L(`          ${key(c.name)}?: never`); continue; }
      const optional = !c.notnull || c.hasdef || c.ident === "d";
      L(`          ${key(c.name)}${optional ? "?" : ""}: ${t(c)}${c.notnull ? "" : " | null"}`);
    }
    L("        }");
    L("        Update: {");
    for (const c of cs) {
      if (c.gen === "s" || c.ident === "a") { L(`          ${key(c.name)}?: never`); continue; }
      L(`          ${key(c.name)}?: ${t(c)}${c.notnull ? "" : " | null"}`);
    }
    L("        }");
    L(`        Relationships: ${relationships(r.oid)}`);
    L("      }");
  }
  L("    }");
  L("    Views: {");
  for (const r of rels.filter((x) => x.relkind === "v" || x.relkind === "m")) {
    L(`      ${key(r.relname)}: {`);
    L("        Row: {");
    for (const c of colsBy.get(r.oid) ?? []) L(`          ${key(c.name)}: ${t(c)} | null`);
    L("        }");
    L("        Relationships: []");
    L("      }");
  }
  L("    }");
  L("    Functions: {");
  const byName = new Map();
  for (const f of fns) (byName.get(f.name) ?? byName.set(f.name, []).get(f.name)).push(f);
  for (const [name, all] of byName) {
    const callable = (f) => {
      const modes = f.argmodes.length ? f.argmodes : Array(f.argtypes.length).fill("i");
      const ins = f.argtypes.map((_, i) => ({ m: modes[i] ?? "i", n: f.argnames[i] ?? "" })).filter((a) => a.m === "i" || a.m === "b" || a.m === "v");
      return !ins.some((a) => !a.n) || ins.length === 1;
    };
    const overloads = all.filter(callable);
    if (!overloads.length) continue;
    const sigs = overloads.map((f) => {
      const modes = f.argmodes.length ? f.argmodes : Array(f.argtypes.length).fill("i");
      const ins = [], outs = [];
      f.argtypes.forEach((ty, i) => {
        const m = modes[i] ?? "i", n = f.argnames[i] ?? "";
        if (m === "i" || m === "b" || m === "v") ins.push({ n, ty });
        if (m === "o" || m === "b" || m === "t") outs.push({ n, ty });
      });
      // An argument may be null — Postgres hands a function null for any of them, and the function decides (a STRICT one
      // answers null). One with a default may be left out.
      const firstDefault = ins.length - Number(f.ndefaults);
      const args = ins.length
        ? "{ " + ins.map((a, i) => `${key(a.n || "")}${i >= firstDefault ? "?" : ""}: ${tsType(a.ty, enums, rowTypes)} | null`).join("; ") + " }"
        : "Record<PropertyKey, never>";
      let ret;
      if (outs.length && (f.ret === "record" || modes.includes("t"))) {
        ret = "{ " + outs.map((o) => `${key(o.n)}: ${tsType(o.ty, enums, rowTypes)}`).join("; ") + " }";
      } else if (f.retrel && f.retrel !== 0 && relByOid.has(f.retrel)) {
        const rr = relByOid.get(f.retrel);
        ret = `Database["public"]["${rr.relkind === "v" || rr.relkind === "m" ? "Views" : "Tables"}"]["${rr.relname}"]["Row"]`;
      } else if (f.ret === "record") {
        ret = "Json";
      } else {
        ret = tsType(f.ret, enums, rowTypes);
      }
      if (f.setof) ret = `${wrap(ret)}[]`;
      return `{ Args: ${args}; Returns: ${ret} }`;
    });
    L(`      ${key(name)}:`);
    sigs.forEach((s, i) => L(`        ${i ? "| " : ""}${s}`));
  }
  L("    }");
  L("    Enums: {");
  for (const e of enumRows) L(`      ${key(e.name)}: ${e.labels.map((x) => JSON.stringify(x)).join(" | ")}`);
  if (!enumRows.length) L("      [_ in never]: never");
  L("    }");
  L("    CompositeTypes: {");
  L("      [_ in never]: never");
  L("    }");
  L("  }");
  L("};");
  L("");
  L('/** A table\'s row, as the server reads it: `Tables<"orders">`. */');
  L('export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];');
  L('/** What a table takes on insert: `TablesInsert<"orders">`. */');
  L('export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];');
  L('/** What a table takes on update: `TablesUpdate<"orders">`. */');
  L('export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];');
  L("");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await generate();
  if (process.argv.includes("--check")) {
    let had = "";
    try { had = readFileSync(OUT, "utf8"); } catch { /* missing */ }
    if (had !== text) {
      console.error("DATABASE TYPES: lib/database.types.ts is not what supabase/migrations/ make — run `node scripts/db.types.mjs` and commit it with the migration.");
      process.exit(1);
    }
    console.log(`DATABASE TYPES: lib/database.types.ts is the migrations' own (${text.split("\n").length} lines).`);
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote lib/database.types.ts (${text.split("\n").length} lines)`);
  }
}
