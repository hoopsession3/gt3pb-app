// IMS8 P5 — THE BRIDGE: every way the Links tab makes or changes a link goes through review and publish (0472). The
// screen writes nothing to vision_shares but turning a link off; making it, what it shows, its money and moving it to the
// latest approval each review first, confirm the material findings word for word, then publish with that review's
// fingerprint. lib/sharePublish, with a stand-in client: the calls, the confirm words, and a stale refusal said as one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTs } from "./search.read.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const P = loadTs("lib/sharePublish.ts");
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}` + (got !== undefined ? ` → ${JSON.stringify(got)?.slice(0, 400)}` : "")); } };

const sh = read("components/vision/Shares.tsx");
ok("the Links tab writes vision_shares only to turn a link off", (sh.match(/from\("vision_shares"\)\.(insert|update|upsert|delete)/g) ?? []).join() === `from("vision_shares").update` && /from\("vision_shares"\)\.update\(\{ revoked_at: new Date\(\)\.toISOString\(\) \}\)/.test(sh), sh.match(/from\("vision_shares"\)\.\w+/g));
const studio = read("components/vision/LinkStudio.tsx");
ok("…making a link (the studio, P7), what it shows, its money and moving it on each go through publish", /reviewLink\(supabase, null, pub\)/.test(studio) && /publishLink\(supabase, null, pub, review, review\.material\)/.test(studio)
  && ['publish(share.id, { money_plans: money, research_plans: research }', 'publish(share.id, { program_ids: pickPrograms, layout_ids: pickRooms', 'publish(share.id, { repin: true }'].every((x) => sh.includes(x)));
ok("…review first, the material findings confirmed in a sheet that lists them, then publish with exactly those ids", /r = await reviewLink\(supabase, share, draft\)/.test(sh) && /ask\.ids\.length && !\(await confirm\(/.test(sh) && /ask\.words\.map/.test(sh) && /publishLink\(supabase, share, draft, r, ask\.ids\)/.test(sh));
ok("…a refusal shares nothing and keeps the draft (A1); a stale one says it changed, and is reviewed again", /isStale\(e\) \? "It changed since it was reviewed — nothing was shared/.test(sh) && /if \(isStale\(e\)\) \{ toast\("It changed since you reviewed it — nothing was shared\. Here it is again, to confirm\.", "error"\); setReview\(null\); void runReview\("share"\); \}/.test(studio));

// lib/sharePublish with a stand-in client.
const calls = [];
const sb = (answers) => ({ rpc: async (name, args) => { calls.push([name, args]); return answers[name]; } });
const payload = { label: "L", show_asks: true, programs: [{ id: "0c46e000-0000-4000-8000-0000000000aa", title: "P", target_on: "2027-01-01" }], asks: [{ program_id: "0c46e000-0000-4000-8000-0000000000aa", plan_id: null, label: "Build-out", amount_cents: null, state: "open", note: null, sort: 1 }], plans: [], layouts: [] };
const rev = { payload, fingerprint: "f".repeat(32), material: ["asks_unset:link:link:0123456789ab", "zz_new_rule:link:link:0123456789ab"], latest: {}, private_names: [] };
const r = await P.reviewLink(sb({ vision_share_review: { data: rev, error: null } }), null, { label: "L" });
ok("review calls vision_share_review with the link and the draft", calls[0][0] === "vision_share_review" && calls[0][1].p_share === null && calls[0][1].p_draft.label === "L" && r.fingerprint === rev.fingerprint);
const c = P.toConfirm(r);
ok("what to confirm is the server's list; each said in lib/publishReadiness's words, and one it doesn't know said plainly", JSON.stringify(c.ids) === JSON.stringify(rev.material) && /will read "Being priced"/.test(c.words[0]) && c.words[1] === "Something to confirm (zz new rule).", c.words);
const out = await P.publishLink(sb({ vision_share_publish: { data: { id: "x", token: "t".repeat(40) }, error: null } }), null, { label: "L" }, r, c.ids);
ok("publish sends the review's fingerprint and the confirmed ids", calls[1][0] === "vision_share_publish" && calls[1][1].p_fingerprint === rev.fingerprint && JSON.stringify(calls[1][1].p_confirm) === JSON.stringify(rev.material) && out.id === "x");
let stale = null;
try { await P.publishLink(sb({ vision_share_publish: { data: null, error: { code: "PT409", message: "It changed since you reviewed it. Review it again." } } }), null, {}, r, []); } catch (e) { stale = e; }
ok("a PT409 or PT422 refusal is stale (review again); anything else isn't", stale && P.isStale(stale) && P.isStale({ code: "PT422" }) && !P.isStale({ code: "PT403" }) && !P.isStale(new Error("x")));
console.log(`IMS8 P5 — THE BRIDGE: EVERY LINK THROUGH REVIEW AND PUBLISH: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
