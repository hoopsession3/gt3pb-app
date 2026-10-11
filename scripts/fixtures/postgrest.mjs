// A STAND-IN FOR THE DATABASE'S READS (2026-10-11, the KDS program, wave 2 — scripts/pass.test.mjs).
//
// What a lib/ read hands supabase-js, applied to rows in memory with Postgres's own rules: a null compares as nothing
// (so `ready_from > now` is false for a null, and `status <> 'done'` is false for a null), timestamps compare as instants,
// `or` is PostgREST's comma list, `count: "exact"` counts every row the filters keep before the limit, and `head: true`
// sends the count alone. It applies the filters a query sends, so a wrong filter shows up as a wrong answer — not as a
// query that merely looks right. Every query is recorded (`calls`), for the tests that hold a read to its exact shape.
// `fail` makes the next read of a table answer an error instead.

const ISO = /^\d{4}-\d{2}-\d{2}T/;
const cmp = (a, b) => (typeof a === "string" && typeof b === "string" && ISO.test(a) && ISO.test(b) ? Date.parse(a) - Date.parse(b) : a < b ? -1 : a > b ? 1 : 0);

function test(row, col, op, v) {
  const x = row[col];
  if (op === "is") return v === null || v === "null" ? x == null : x === v;
  if (x == null) return false;
  switch (op) {
    case "eq": return String(x) === String(v);
    case "neq": return String(x) !== String(v);
    case "gt": return cmp(x, v) > 0;
    case "gte": return cmp(x, v) >= 0;
    case "lt": return cmp(x, v) < 0;
    case "lte": return cmp(x, v) <= 0;
    case "in": return v.map(String).includes(String(x));
    default: throw new Error(`stand-in: no operator ${op}`);
  }
}

/** PostgREST's or=(a.op.v,b.op.v): any one of them. */
function orOf(list) {
  const parts = list.split(",").map((p) => {
    const i = p.indexOf("."), j = p.indexOf(".", i + 1);
    if (i < 0 || j < 0) throw new Error(`stand-in: cannot read or-part ${p}`);
    return { col: p.slice(0, i), op: p.slice(i + 1, j), v: p.slice(j + 1) };
  });
  return (row) => parts.some((c) => test(row, c.col, c.op, c.v === "null" && c.op === "is" ? null : c.v));
}

export function fakeDb(tables = {}) {
  const db = {
    tables, calls: [], fail: {},
    from(table) {
      const call = { table, ops: [] };
      db.calls.push(call);
      const keep = [];
      let ord = [], lim = Infinity, count = false, head = false, single = false;
      const q = {
        select(cols = "*", opts = {}) { call.ops.push(["select", cols, opts]); count = opts.count === "exact"; head = !!opts.head; return q; },
        eq(c, v) { call.ops.push(["eq", c, v]); keep.push((r) => test(r, c, "eq", v)); return q; },
        neq(c, v) { call.ops.push(["neq", c, v]); keep.push((r) => test(r, c, "neq", v)); return q; },
        gt(c, v) { call.ops.push(["gt", c, v]); keep.push((r) => test(r, c, "gt", v)); return q; },
        gte(c, v) { call.ops.push(["gte", c, v]); keep.push((r) => test(r, c, "gte", v)); return q; },
        lt(c, v) { call.ops.push(["lt", c, v]); keep.push((r) => test(r, c, "lt", v)); return q; },
        lte(c, v) { call.ops.push(["lte", c, v]); keep.push((r) => test(r, c, "lte", v)); return q; },
        in(c, v) { call.ops.push(["in", c, v]); keep.push((r) => test(r, c, "in", v)); return q; },
        is(c, v) { call.ops.push(["is", c, v]); keep.push((r) => test(r, c, "is", v)); return q; },
        or(list) { call.ops.push(["or", list]); keep.push(orOf(list)); return q; },
        order(c, o = {}) { call.ops.push(["order", c, o]); ord.push({ c, asc: o.ascending !== false }); return q; },
        limit(n) { call.ops.push(["limit", n]); lim = n; return q; },
        maybeSingle() { call.ops.push(["maybeSingle"]); single = true; return q; },
        then(res, rej) {
          return Promise.resolve().then(() => {
            if (db.fail[table]) { const message = db.fail[table]; delete db.fail[table]; return { data: null, error: { message }, count: null }; }
            let rows = (tables[table] ?? []).filter((r) => keep.every((k) => k(r)));
            const n = rows.length;
            for (const o of [...ord].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.c], b[o.c]));
            rows = rows.slice(0, lim).map((r) => ({ ...r }));
            if (head) return { data: null, error: null, count: count ? n : null };
            if (single) return { data: rows[0] ?? null, error: null, count: count ? n : null };
            return { data: rows, error: null, count: count ? n : null };
          }).then(res, rej);
        },
      };
      return q;
    },
  };
  return db;
}
