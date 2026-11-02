// IMS8 P10 — A CONFIRMATION IS FOR THESE WORDS; A LINK SAYS WHICH REVISION IT IS (0472, in Postgres, through the real
// doors). Ryan, 2026-11-02: "Tie the confirmation to that exact content; editing it invalidates the prior confirmation…
// Clearly display publication date/revision… Scope expansion, financial-pin changes, and republication must pass the same
// authorization, fingerprint, and confirmation checks… atomic against concurrent edits. Preserve immediate revocation and
// expiry enforcement, including when serving a stored snapshot." Logs here never print a token.
import { createHash } from "node:crypto";
import { fullSchema } from "./fixtures/schema.full.mjs";
import { loadTs } from "./search.read.mjs";

const R = loadTs("lib/publishReadiness.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.replace(/[0-9a-f]{40,}/g, "<token>").slice(0, 600)}` : "")); } };
const T1 = "00000000-0000-0000-0000-000000000001";
const OWNER = "0c46f100-0000-4000-8000-0000000000a1", ADMIN = "0c46f100-0000-4000-8000-0000000000a2";
const md12 = (parts) => createHash("md5").update([...parts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join("\n")).digest("hex").slice(0, 12);

const db = await fullSchema({});
const q = async (s, p) => (await db.query(s, p)).rows, q1 = async (s, p) => (await q(s, p))[0];
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);
await db.exec(`create or replace function public.two_step_ok() returns boolean language sql stable as $$ select true $$;`);
for (const [id, role] of [[OWNER, "owner"], [ADMIN, "admin"]]) {
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, `${role}@example.test`]);
  await q(`update public.profiles set role = $2, tenant_id = $3 where id = $1`, [id, role, T1]);
}
const as = async (uid, sql, p) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(sql, p)).rows; } catch (e) { return { error: e.message, code: e.code }; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
};
const door = async (t) => { await db.exec(`set role anon;`); try { return (await db.query(`select public.vision_shared($1) v`, [t])).rows[0].v; } catch (e) { return { code: e.code }; } finally { await db.exec(`reset role;`); } };
const review = async (uid, share, draft) => { const r = await as(uid, `select public.vision_share_review($1, $2::jsonb) v`, [share, JSON.stringify(draft ?? {})]); return r.error ? r : r[0].v; };
const publish = async (uid, share, draft, fp, confirm) => { const r = await as(uid, `select public.vision_share_publish($1, $2::jsonb, $3, $4::text[]) v`, [share, JSON.stringify(draft ?? {}), fp, confirm]); return r.error ? r : r[0].v; };

const plan = await q1(`select id, program_id from public.vision_plans where tenant_id = $1 order by phase limit 1`, [T1]);
const plan2 = await q1(`select id from public.vision_plans where tenant_id = $1 and id <> $2 and program_id = $3 order by phase limit 1`, [T1, plan.id, plan.program_id]);
await q(`update public.vision_plans set shareable = true where program_id = $1`, [plan.program_id]);
const room = (await q1(`select id from public.store_layouts where tenant_id = $1 order by created_at limit 1`, [T1])).id;
const PASSAGE = "Internal only: margins are thin — call Dana at 518-555-0134.";
await q(`update public.vision_plans set why = $2 where id = $1`, [plan.id, PASSAGE]);
const draft = { label: "Revisions", program_ids: [plan.program_id], plan_ids: [plan.id], layout_ids: [], show_asks: false };

// ── A confirmation is for these exact words ──
const r1 = await review(OWNER, null, draft);
const iw1 = r1.material.find((x) => x.startsWith(`internal_words:plan:${plan.id}:`));
ok("the flagged passage's confirmation id carries the md5 of the exact words (12)", iw1 === `internal_words:plan:${plan.id}:${md12([PASSAGE])}`, r1.material);
const f1 = R.readinessOf(R.payloadChecks(r1.payload, { latestApproved: r1.latest, privateNames: r1.private_names })).all.find((f) => R.isFor(iw1, f.confirm));
ok("…and the studio shows that passage in full, where it is, and that it goes into the link as written", f1?.evidence.some((e) => e.says === PASSAGE && /^Plan · .+ · why — says "internal"$/.test(e.source)) && /will be in the link exactly as written/.test(f1.words), f1?.evidence);
const made = await publish(OWNER, null, draft, r1.fingerprint, r1.material);
ok("published with that confirmation: revision 1", !made.error && made.revision === 1, made);
const EDITED = "Internal only: margins are thinner than planned.";
await q(`update public.vision_plans set why = $2 where id = $1`, [plan.id, EDITED]);
const r2 = await review(OWNER, made.id, {});
const iw2 = r2.material.find((x) => x.startsWith(`internal_words:plan:${plan.id}:`));
ok("edit the words: a new id (the old confirmation doesn't carry), for the new words", iw2 && iw2 !== iw1 && iw2 === `internal_words:plan:${plan.id}:${md12([EDITED])}`, { iw1, iw2 });
ok("…republishing with the old confirmation is refused (PT422), even with the new review's fingerprint", (await publish(OWNER, made.id, {}, r2.fingerprint, r1.material)).code === "PT422");

// ── Unpublished edits stay private; revision and date are said ──
const sent = await door(made.token);
ok("until it's shared again, the investor reads the reviewed words, not the edit", JSON.stringify(sent).includes(PASSAGE) && !JSON.stringify(sent).includes(EDITED));
ok("…the owner's preview of the link is the same (what's sent), and review says it changed — revision 1, and when", JSON.stringify((await as(OWNER, `select public.vision_share_preview($1, null) v`, [made.id]))[0].v) === JSON.stringify(sent)
  && r2.changed === true && r2.revision === 1 && !!r2.published_at);
const re = await publish(OWNER, made.id, {}, r2.fingerprint, r2.material);
ok("shared again with the new words confirmed: revision 2, and the investor reads them", !re.error && re.revision === 2 && JSON.stringify(await door(made.token)).includes(EDITED), re);

// ── Scope expansion passes the same checks ──
const rWide = await review(OWNER, made.id, { plan_ids: [plan.id, plan2.id], layout_ids: [room] });
const rNarrow = await review(OWNER, made.id, {});
ok("adding a plan and a room with a review of something else: refused (PT409), nothing changes", (await publish(OWNER, made.id, { plan_ids: [plan.id, plan2.id], layout_ids: [room] }, rNarrow.fingerprint, rNarrow.material)).code === "PT409"
  && (await door(made.token)).plans.length === 1 && (await q1(`select revision from public.vision_shares where id = $1`, [made.id])).revision === 2);
ok("…an admin adding money to it: refused (an owner's, 0451)", (await review(ADMIN, made.id, { money_plans: [plan.id] })).code === "PT403" && (await publish(ADMIN, made.id, { money_plans: [plan.id] }, rWide.fingerprint, rWide.material)).code === "PT403");
ok("…an admin moving its pin: refused (0458)", (await publish(ADMIN, made.id, { repin: true }, rNarrow.fingerprint, rNarrow.material)).code === "PT403");
ok("…with its own review and confirmations: allowed, revision 3, the plan and room on the link", !(await publish(OWNER, made.id, { plan_ids: [plan.id, plan2.id], layout_ids: [room] }, rWide.fingerprint, rWide.material)).error
  && (await door(made.token)).plans.length === 2 && (await door(made.token)).layouts.length === 1 && (await q1(`select revision from public.vision_shares where id = $1`, [made.id])).revision === 3);

// ── Republication is atomic: one reviewed before another landed is refused ──
const ra = await review(OWNER, made.id, { label: "Revisions — renamed" });
const rb = await review(OWNER, made.id, { layout_ids: [] });
ok("two reviews of the same link: the first publishes (revision 4)", (await publish(OWNER, made.id, { label: "Revisions — renamed" }, ra.fingerprint, ra.material)).revision === 4);
ok("…the second, reviewed before the first landed, is refused (PT409) — it would publish words it never saw", (await publish(OWNER, made.id, { layout_ids: [] }, rb.fingerprint, rb.material)).code === "PT409"
  && (await door(made.token)).layouts.length === 1);
await db.exec(`create or replace function public.zz_mid() returns trigger language plpgsql as $$ begin update public.vision_plans set gate = 'MID-REPUBLISH EDIT' where id = '${plan.id}'; return new; end $$;
               create trigger zz_mid_tg before update on public.vision_shares for each row when (new.published is distinct from old.published) execute function public.zz_mid();`);
const rc = await review(OWNER, made.id, { show_asks: true });
const mid = await publish(OWNER, made.id, { show_asks: true }, rc.fingerprint, rc.material);
await db.exec(`drop trigger zz_mid_tg on public.vision_shares; drop function public.zz_mid();`);
ok("an edit landing mid-republish is in the database, not on the link: what's sent is what was reviewed", !mid.error && (await q1(`select gate from public.vision_plans where id = $1`, [plan.id])).gate === "MID-REPUBLISH EDIT"
  && !JSON.stringify(await door(made.token)).includes("MID-REPUBLISH EDIT"), mid);

// ── A stored snapshot is still gated: expiry and revocation at once ──
const d2 = { label: "Ends", program_ids: [plan.program_id], plan_ids: [plan.id], layout_ids: [], show_asks: false, days: 7 };
const r7 = await review(OWNER, null, d2);
const ends = await publish(OWNER, null, d2, r7.fingerprint, r7.material);
ok("a link that ends in 7 days is sent until then", Array.isArray((await door(ends.token)).plans));
await q(`update public.vision_shares set expires_at = now() - interval '1 minute' where id = $1`, [ends.id]);
ok("…past its end it isn't, though its snapshot is stored (PT404)", (await door(ends.token)).code === "PT404" && !!(await q1(`select published from public.vision_shares where id = $1`, [ends.id])).published);
ok("turned off: the stored snapshot isn't sent, at once (PT404)", !(await as(OWNER, `update public.vision_shares set revoked_at = now() where id = $1`, [made.id])).error && (await door(made.token)).code === "PT404");
ok("…and it can't be republished", (await review(OWNER, made.id, {})).code === "PT403");

console.log(`IMS8 P10 — A CONFIRMATION IS FOR THESE WORDS; A LINK SAYS WHICH REVISION IT IS (0472, in Postgres): ${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
