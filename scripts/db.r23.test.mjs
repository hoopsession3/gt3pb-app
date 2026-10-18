// R23 — THE PLATFORM'S OWN GATES AND THE DEFINERS' PATHS, MEASURED ON THE WHOLE SCHEMA (2026-10-18 — the 10/10 audit,
// database F15; Ryan: "Keep working to improve to a 10").
//
// Every migration is loaded, storage.objects is made as Supabase makes it (row-level security on, the API roles granted —
// the fixture's stand-in has neither, as db.r10b says), and scripts/security.snapshot.sql runs on it exactly as it runs in
// the Supabase editor. What the audit now judges is asked of what the migrations actually made: (1) every definer function
// pins its search_path; (2) every file rule (storage.objects) that writes is for the signed in, and none is `true`; (3) the
// private channels' rules (realtime.messages) are 0428's two, for the signed in, reading the room's name. Then one of each
// wrong shape is planted, measured by the same query and caught, and taken away again. Every row is made up.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { reassemble } from "./security.snapshot.mjs";
import { judge } from "./security.audit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → got ${JSON.stringify(got)?.slice(0, 900)}` : "")); } };

const t0 = Date.now();
const db = await fullSchema();
console.log(`the whole schema loaded (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
await db.exec(`grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  alter table storage.objects enable row level security;`);

const SQL = readFileSync(join(ROOT, "scripts/security.snapshot.sql"), "utf8");
const pull = async () => reassemble((await db.query(SQL)).rows);
const GATE = /^(definer-path|platform-rls-off|storage-|realtime-)/;
const STORE = "storage.objects", ROOM = "realtime.messages";

const r = await pull();
ok("the query runs on the whole schema and reassembles — the platform's gates and every definer's path with it",
  !r.error && !!r.json?.p && r.json.f.length > 0 && r.json.f.every((f) => typeof f[5] === "boolean"), r.error);
const snap = r.json ?? { t: {}, f: [], x: [], p: {} };
const v = judge(snap);
const x = (i) => (i === null || i === undefined ? null : snap.x[i]);

// (1) the definers
const unpinned = snap.f.filter((f) => f[5] !== true).map((f) => `${f[0]}(${f[1]})`);
ok(`every definer function the migrations make pins its search_path — the API's (${v.definerExec.length}) and the server's alike (${snap.f.length} in all)`,
  unpinned.length === 0 && snap.f.length > 100, unpinned);
ok("…so the audit has nothing to say of any of them", !v.hard.some((h) => h.startsWith("definer-path")), v.hard.filter((h) => h.startsWith("definer-path")));

// (2) the files' rules
const files = snap.p?.[STORE] ?? [false, false, "", "", "", []];
ok("storage.objects is measured as Supabase makes it: row-level security on, the API roles granted",
  files[0] === true && files[2] === "riud" && files[3] === "riud", files.slice(0, 5));
const writes = files[5].filter((p) => p[1] !== "r");
ok(`every file rule that writes (${writes.length}) is for the signed in — none for someone with no session`,
  writes.length >= 10 && writes.every((p) => p[3] === "authenticated"), writes.map((p) => [p[0], p[3]]));
ok("…and none of them is `true`: each names its bucket", writes.every((p) => [x(p[4]), x(p[5])].some((e) => /bucket_id/.test(e || ""))),
  writes.filter((p) => ![x(p[4]), x(p[5])].some((e) => /bucket_id/.test(e || ""))).map((p) => p[0]));
ok("the rules the house's buckets stand on are among them, by name",
  ["avatars own write", "content staff write", "shop media owner write", "receipts staff write", "note files follow note add"].every((n) => files[5].some((p) => p[0] === n)),
  files[5].map((p) => p[0]));

// (3) the private channels' rules
const rooms = snap.p?.[ROOM] ?? [false, false, "", "", "", []];
ok("realtime.messages is measured: row-level security on, and its rules are 0428's two — hear (select) and speak (insert), for the signed in",
  rooms[0] === true && JSON.stringify(rooms[5].map((p) => [p[0], p[1], p[2], p[3]])) === JSON.stringify([
    ["studio: the piece's editors hear its room", "r", true, "authenticated"], ["studio: the piece's editors speak in its room", "a", true, "authenticated"]]), rooms[5]);
ok("…each reading the room's name and the piece behind it — never `true`",
  rooms[5].every((p) => /realtime\.topic\(\)/.test(x(p[4]) || x(p[5]) || "") && /content_items/.test(x(p[4]) || x(p[5]) || "")), rooms[5].map((p) => [x(p[4]), x(p[5])]));
ok("the audit counts both platform tables and has nothing to say of either", v.info.platform === 2 && !v.hard.some((h) => GATE.test(h) && !h.startsWith("definer-path")), [v.info.platform, v.hard]);

// One of each wrong shape, planted in the database and measured by the same query.
await db.exec(`
  create policy "zz guests upload" on storage.objects for insert to anon with check (bucket_id = 'shop');
  create policy "zz any file" on storage.objects for update to authenticated using (true);
  create policy "zz guests hear" on realtime.messages for select to anon using (realtime.topic() like 'studio-%');
  create policy "zz every room" on realtime.messages for select to authenticated using (true);
  create function public.zz_no_path() returns boolean language sql stable security definer as $$ select true $$;
  revoke execute on function public.zz_no_path() from public; grant execute on function public.zz_no_path() to authenticated;
  create function public.zz_no_path_inside() returns boolean language sql stable security definer as $$ select true $$;
  revoke execute on function public.zz_no_path_inside() from public, anon, authenticated;`);
const planted = await pull();
const pv = planted.json ? judge(planted.json) : { hard: [] };
const found = pv.hard.filter((h) => GATE.test(h)).sort();
ok("planted: each wrong shape is the hard finding it should be — and nothing else changed",
  JSON.stringify(found) === JSON.stringify([
    "definer-path: zz_no_path() runs as its owner for the API roles with no search_path pinned",
    `realtime-open-room: ${ROOM} — policy "zz every room" (select) is \`true\`: every private room open to anyone signed in`,
    `realtime-room: ${ROOM} — policy "zz guests hear" (select) is for anon: a private room joined with no session`,
    `storage-open-write: ${STORE} — policy "zz any file" (update) is \`true\`: any signed-in person writes any file`,
    `storage-write: ${STORE} — policy "zz guests upload" (insert) is for anon: a file written by someone with no session`,
  ]) && JSON.stringify(pv.hard.filter((h) => !GATE.test(h))) === JSON.stringify(v.hard.filter((h) => !GATE.test(h))), { error: planted.error, found });
ok("planted: a definer with no path that only the server may call is measured (false), and not judged",
  planted.json?.f.some((f) => f[0] === "zz_no_path_inside" && f[5] === false && !f[2] && !f[3]) && !found.some((h) => h.includes("zz_no_path_inside")));
await db.exec(`drop policy "zz guests upload" on storage.objects; drop policy "zz any file" on storage.objects;
  drop policy "zz guests hear" on realtime.messages; drop policy "zz every room" on realtime.messages;
  drop function public.zz_no_path(); drop function public.zz_no_path_inside();`);
const after = await pull();
ok("taken away again, the snapshot is the first one's, but its time", !after.error && JSON.stringify({ ...after.json, pulled_at: 0 }) === JSON.stringify({ ...snap, pulled_at: 0 }), after.error);

await db.close();
console.log(`\nR23 — THE PLATFORM'S GATES AND THE DEFINERS' PATHS, ON THE WHOLE SCHEMA: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
