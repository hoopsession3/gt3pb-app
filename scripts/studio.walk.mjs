// THE STUDIO, WALKED (IMS5a — Ryan, 2026-10-30: "Close IMS4d engineering verification… capture functional evidence, not
// just screenshots"). A CONSOLE_AFTER walk-through for smoke:console: on the full-screen studio (vision-store-full) it
// does what a designer does — pick, look at it in 3D, move it by hand and by key, turn, resize, copy, remove, undo and
// redo, open and fold and close the details, turn the 3D and switch views — and measures each result on the screen.
//
//   npm run studio:walk          # the six screen sizes of the brief, with the build reused when it's there
//
// Each step is Pass or Fail (through ok(), so the run fails on a Fail), or Not verified with the reason — a step this
// screen can't take (no keyboard on a phone, no 3D on screen) is said, never counted as passed. The matrix is written to
// <out>/walk.json beside the pictures. It changes nothing it doesn't put back: every edit is undone, and the room ends
// as it opened (Saved).
import { writeFileSync } from "node:fs";

export default async function walk({ page, device: d, visit: v, ok, out }) {
  if (v.key !== "vision-store-full") return;
  const rows = [];
  const say = (step, state, evidence) => rows.push({ step, state, evidence });
  const check = (step, cond, evidence) => { ok(`${d.key} · walk · ${step}`, cond, evidence); say(step, cond ? "pass" : "fail", evidence); };
  const notYet = (step, why) => say(step, "not verified", why);
  const desk = d.kind === "desktop", phone = !d.kind;
  const S = ".vz-studio.full";
  const boxOf = (q) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width && b.height ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; }, q);
  const tapAt = async (x, y) => { if (desk) await page.mouse.click(x, y); else await page.touchscreen.tap(x, y); await page.waitForTimeout(500); };
  const button = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
  const press = async (name) => { await button(name).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(450); };
  // A button of the details themselves (the canvas has its own Rotate / Duplicate / Remove, behind a sheet on a phone).
  const pressIn = async (name) => { const q = await inspOf(); await (q ? page.locator(q).getByRole("button", { name, exact: true }).first() : button(name)).click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(450); };
  const count = () => page.evaluate((s) => document.querySelectorAll(`${s} .vz-plan .it`).length, S);
  // The findings' count where this screen says it: the lens ("Evaluate · n") beside the bar, or the one mark on an upright
  // phone ("n — Review n findings (Evaluate)", "✓ — nothing to review").
  const findings0 = () => page.evaluate((s) => {
    const lens = [...document.querySelectorAll(`${s} [role=radio]`)].find((e) => /^Evaluate/.test(e.textContent?.trim() ?? ""));
    if (lens) { const m = lens.textContent.match(/(\d+)/); return m ? Number(m[1]) : 0; }
    const l = document.querySelector(`${s} [aria-label$='(Evaluate)']`)?.getAttribute("aria-label");
    return l == null ? null : /^(\d+)/.test(l) ? Number(l.match(/^(\d+)/)[1]) : 0;
  }, S);
  // An upright phone shows the count only with nothing picked (the dock holds the thing): let go, read, pick again.
  const findings = async () => { const n = await findings0(); if (n !== null || !(await page.$(`${S} .vz-plan .it.sel`))) return n; await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(400); const m = await findings0(); await repick(); return m; };
  const saidSave = () => page.evaluate((s) => document.querySelector(`${s} .vz-tbar-r button[aria-label='Save'], ${s} .vz-tbar-r button[aria-label='Saved'], ${s} .vz-tbar-r button[aria-label='Saving'], ${s} .vz-tbar-r button[aria-label="Couldn't save · Retry"]`)?.getAttribute("aria-label") ?? "none", S);
  const mid = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const near = (a, b, px = 3) => !!a && !!b && Math.abs(mid(a)[0] - mid(b)[0]) < px && Math.abs(mid(a)[1] - mid(b)[1]) < px;
  const id = await page.evaluate((s) => { const t = [...document.querySelectorAll(`${s} .vz-plan .it`)].find((g) => /Community table/.test(g.textContent ?? "")); return t?.getAttribute("data-id") ?? null; }, S);
  const sel = `${S} .vz-plan .it[data-id="${id}"]`;
  const picked = async () => !!(await page.$(`${sel}.sel`));
  const repick = async () => { if (!(await picked())) { const b = await boxOf(sel); if (b) await tapAt(...mid(b)); } };
  // The details on a phone are a sheet opened by Edit; elsewhere they come in with the pick.
  const IN = ".vz-insp:has(input[aria-label='Width, in feet and inches'])";
  const inspOf = async () => ((await page.$(`[role=dialog] ${IN}`)) ? `[role=dialog] ${IN}` : (await page.$(`${S} ${IN}`)) ? `${S} ${IN}` : null);
  const editTries = [];
  const openDetails = async () => {
    await repick();
    let k = 0;
    // A phone's dock says Edit; where the dock is folded away (a phone on its side, details closed), the thing's ⓘ.
    const way = async () => ((await button("Edit").count()) ? "Edit" : (await button("Open details — size, purpose and pillars").count()) ? "Open details — size, purpose and pillars" : null);
    while (!(await inspOf()) && (await way()) && k < 3) { k++; await press(await way()); await page.waitForSelector(`[role=dialog] ${IN}`, { timeout: 2000 }).catch(() => {}); await page.waitForTimeout(300); }
    if (k) editTries.push(k);
  };
  const closeSheet = async () => { if (await page.$(`[role=dialog] ${IN}`)) await press("Close details"); };
  const start = { n: await count(), f: await findings(), save: await saidSave() };
  if (!id) { check("a thing to work on (the community table)", false, "none on the plan"); writeFileSync(`${out}/walk.json`, JSON.stringify(rows, null, 1)); return; }

  // 1 · Pick, and the 3D knows it. Split first where the plan is alone (an upright phone offers the view only with
  // nothing picked: its dock holds the thing once one is), so the plan and the 3D are both on screen.
  const threeOn = async () => !!(await boxOf(`${S} canvas.vz-3d`));
  const viewAtStart = await page.evaluate(() => document.querySelector("[role=radiogroup][aria-label='View'] [aria-checked='true']")?.textContent?.trim() ?? null);
  if (!(await threeOn())) { await page.getByRole("radio", { name: "Split", exact: true }).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(800); }
  const b0 = await boxOf(sel);
  await tapAt(...mid(b0));
  check("a tap or click picks the thing", await picked(), id);
  if (await threeOn()) {
    check("plan → 3D: the 3D has the pick (its Focus tool appears)", !!(await page.$(`${S} [aria-label='Focus the picked thing in 3D']`)), "");
    // 3D → plan: unpick, then touch the 3D on a grid until something is picked there; the plan must show the same pick.
    await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300);
    if (await picked()) { await page.evaluate((s) => document.querySelector(`${s} canvas.vz-3d`)?.scrollIntoView({ block: "nearest" }), S); }
    const c = await boxOf(`${S} canvas.vz-3d`);
    let hit = null;
    for (let gy = 0.35; gy <= 0.8 && !hit; gy += 0.075) for (let gx = 0.2; gx <= 0.8 && !hit; gx += 0.075) {
      await tapAt(c.x + c.w * gx, c.y + c.h * gy);
      hit = await page.evaluate((s) => document.querySelector(`${s} .vz-plan .it.sel`)?.getAttribute("data-id") ?? null, S);
      if (hit === null && !(await threeOn())) break;
    }
    check("3D → plan: a thing touched in 3D is the one picked on the plan", !!hit, hit ?? "nothing picked after a grid of touches");
    await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300);
    // The camera: turn it by hand, switch to Plan and back — the same view (the drawing compared pixel for pixel).
    const shot = () => page.evaluate((s) => { const cv = document.querySelector(`${s} canvas.vz-3d`); if (!cv) return null; const u = cv.toDataURL(); let h = 0; for (let i = 0; i < u.length; i += 7) h = (h * 31 + u.charCodeAt(i)) | 0; return { h, fill: Number(cv.dataset.fill ?? -1) }; }, S);
    const c1 = await boxOf(`${S} canvas.vz-3d`);
    const home = await shot();
    await page.mouse.move(c1.x + c1.w * 0.85, c1.y + c1.h * 0.2); await page.mouse.down(); await page.mouse.move(c1.x + c1.w * 0.7, c1.y + c1.h * 0.25, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
    const turned = await shot();
    check("the 3D turns by hand", !!turned && !!home && turned.h !== home.h, { home: home?.fill, turned: turned?.fill });
    const viewNow = await page.evaluate(() => document.querySelector("[role=radiogroup][aria-label='View'] [aria-checked='true']")?.textContent?.trim() ?? null);
    await page.getByRole("radio", { name: "Plan", exact: true }).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500);
    if (viewNow) await page.getByRole("radio", { name: viewNow, exact: true }).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    const back = await shot();
    check("a hand-set 3D view is kept across Plan and back", !!back && !!turned && back.h === turned.h, { turned: turned?.fill, back: back?.fill });
    await press("Fit the whole room in 3D"); await page.waitForTimeout(400);
    const fit = await shot();
    check("Fit room frames the whole room from the angle it's at (never smaller)", !!fit && !!back && fit.fill >= back.fill - 3, { turned: back?.fill, fit: fit?.fill, corner: home?.fill });
    await press("Reset the 3D view to the corner"); await page.waitForTimeout(400);
    const reset = await shot();
    check("Reset view returns to the corner view it opened on", !!reset && !!home && reset.h === home.h, { home: home?.fill, reset: reset?.fill });
  } else { for (const s of ["plan → 3D", "3D → plan", "the 3D turns by hand", "a hand-set 3D view is kept", "Fit room", "Reset view"]) notYet(s, "no 3D on screen in any view here"); }

  // 2 · Move, Undo, Redo — by hand.
  await repick();
  const a = await boxOf(sel);
  await page.mouse.move(...mid(a)); await page.mouse.down(); await page.mouse.move(mid(a)[0] + 25, mid(a)[1], { steps: 6 }); await page.mouse.move(mid(a)[0] + 50, mid(a)[1], { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(450);
  const a1 = await boxOf(sel);
  check("a drag moves it", !!a1 && mid(a1)[0] - mid(a)[0] > 15, a1 && Math.round(mid(a1)[0] - mid(a)[0]));
  check("an edit marks the room unsaved (Save)", (await saidSave()) === "Save", await saidSave());
  await press("Undo");
  check("Undo puts it back", near(await boxOf(sel), a), "");
  await press("Redo");
  check("Redo moves it again", near(await boxOf(sel), a1), "");
  await press("Undo");

  // 3 · Keys (a keyboard: desktop, or an iPad with one).
  if (!phone) {
    await repick();
    const k0 = await boxOf(sel);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
    const k1 = await boxOf(sel);
    check("→ nudges it right (6 in)", !!k1 && mid(k1)[0] > mid(k0)[0] + 0.5, k1 && +(mid(k1)[0] - mid(k0)[0]).toFixed(1));
    await page.keyboard.press("Shift+ArrowDown"); await page.waitForTimeout(300);
    const k2 = await boxOf(sel);
    check("⇧↓ nudges it down a foot (twice the step)", !!k2 && mid(k2)[1] - mid(k1)[1] > 1.5 * Math.max(0.5, mid(k1)[0] - mid(k0)[0]), k2 && +(mid(k2)[1] - mid(k1)[1]).toFixed(1));
    await page.keyboard.press("ControlOrMeta+z"); await page.keyboard.press("ControlOrMeta+z"); await page.waitForTimeout(400);
    check("⌘Z twice undoes both nudges", near(await boxOf(sel), k0), "");
    await page.keyboard.press("ControlOrMeta+Shift+z"); await page.waitForTimeout(300);
    check("⇧⌘Z redoes", near(await boxOf(sel), k1), "");
    await page.keyboard.press("ControlOrMeta+z"); await page.waitForTimeout(300);
    const r0 = await boxOf(sel);
    await page.keyboard.press("r"); await page.waitForTimeout(400);
    const r1 = await boxOf(sel);
    check("R turns it a quarter (its width and depth trade on the plan)", !!r1 && Math.abs(r1.w - r0.h) < 4 && Math.abs(r1.h - r0.w) < 4, r1 && [Math.round(r0.w), Math.round(r0.h), "→", Math.round(r1.w), Math.round(r1.h)]);
    await page.keyboard.press("ControlOrMeta+z"); await page.waitForTimeout(300);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    check("Escape lets go of the pick", !(await picked()), "");
  } else { notYet("keyboard: nudge, ⌘Z/⇧⌘Z, R, Escape", "a phone has no keyboard in this check"); }

  // 4 · The details: Rotate, size, Duplicate, Remove — and the findings follow the room.
  await openDetails();
  const insp = await inspOf();
  if (insp) {
    const words = await page.evaluate((q) => document.querySelector(q)?.textContent ?? "", insp);
    check("distances are said as to the walls, not as verified clearances", /to walls?/i.test(words) && !/\bclearance(s)? (is|are) (met|ok|verified)/i.test(words), words.match(/[^.]*to walls?[^.]*/i)?.[0]?.slice(0, 100) ?? "no 'to wall' line");
    const t0 = await boxOf(sel);
    await pressIn("↻ Rotate"); await closeSheet();
    const t1 = await boxOf(sel);
    check("Rotate in the details turns it", !!t1 && Math.abs(t1.w - t0.h) < 4 && Math.abs(t1.h - t0.w) < 4, t1 && [Math.round(t0.w), Math.round(t0.h), "→", Math.round(t1.w), Math.round(t1.h)]);
    await closeSheet(); await press("Undo");
    const f0 = await findings(); await openDetails();
    const w0 = await boxOf(sel);
    const width = page.locator(`${(await inspOf()) ?? insp} input[aria-label='Width, in feet and inches']`).first();
    await width.fill("20'").catch(() => {}); await width.press("Tab").catch(() => {}); await page.waitForTimeout(900);
    await closeSheet(); await page.waitForTimeout(400);
    const w1 = await boxOf(sel), f1 = await findings();
    check("a new width in the details resizes it on the plan", !!w1 && Math.max(w1.w, w1.h) > Math.max(w0.w, w0.h) * 1.5, w1 && [Math.round(w0.w), Math.round(w1.w)]);
    check("the findings follow the geometry (a 20 ft table is found at once)", f1 !== null && f0 !== null && f1 !== f0, [f0, f1]);
    await press("Undo"); await page.waitForTimeout(900);
    check("…and return when it's undone (never stale)", (await findings()) === f0 && near(await boxOf(sel), w0), [f0, await findings()]);
    await openDetails();
    const n0 = await count();
    await pressIn("Duplicate"); await closeSheet();
    check("Duplicate adds one", (await count()) === n0 + 1, [n0, await count()]);
    await closeSheet(); await press("Undo");
    check("…Undo takes the copy away", (await count()) === n0, [n0, await count()]);
    await openDetails();
    await pressIn("Remove from room");
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove from room", exact: true }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500); await closeSheet();
    check("Remove from room asks, then takes it out", (await count()) === n0 - 1 && !(await page.$(sel)), [n0, await count()]);
    await closeSheet(); await press("Undo");
    check("…Undo brings it back where it was", (await count()) === n0 && near(await boxOf(sel), t0, 4), [n0, await count()]);
  } else { check("the details open for a picked thing", false, "no inspector"); }

  // 5 · Less, More, Close details — the pick stays.
  await openDetails();
  if (!(await page.$(`[role=dialog] ${IN}`))) {
    const h0 = (await boxOf(`${S} .vz-dock`))?.h ?? 0;
    await press("Less");
    const h1 = (await boxOf(`${S} .vz-dock`))?.h ?? 0;
    check("Less folds the details to a line", h1 > 0 && h1 < h0 * 0.6, [Math.round(h0), Math.round(h1)]);
    await press("More");
    const h2 = (await boxOf(`${S} .vz-dock`))?.h ?? 0;
    check("More opens them again", Math.abs(h2 - h0) < 4, [Math.round(h0), Math.round(h2)]);
  } else notYet("Less / More", "here the details are a sheet: Edit opens it, Close details shuts it (checked next)");
  await press("Close details");
  check("Close details shuts them and keeps the pick", (await picked()) && !(await inspOf()), "");

  // 6 · Accessible by name, reachable by keys.
  const unnamed = await page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} [role=radio], ${s} input, ${s} select`)].filter((e) => e.getBoundingClientRect().width > 0 && !(e.getAttribute("aria-label") || e.textContent?.trim() || e.closest("label")?.textContent?.trim() || e.getAttribute("title"))).map((e) => e.outerHTML.slice(0, 80)), S);
  check("every control in the studio has a name a screen reader says", unnamed.length === 0, unnamed.slice(0, 4));
  if (await picked()) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300); }
  const stops = [];
  // Past the last control focus leaves the page for the browser's own bar (document.body here): not a stop in the app.
  for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); const st = await page.evaluate((s) => { const e = document.activeElement; if (!e || e === document.body) return null; return { inside: !!e.closest(s), name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40) }; }, S); if (st) stops.push(st); }
  check("Tab stays inside the full-screen studio (the app behind is inert)", stops.every((x) => x.inside), stops.filter((x) => !x.inside).slice(0, 3));
  const unpick = async () => { if (await page.$(`${S} .vz-plan .it.sel`)) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300); } };
  if (phone) notYet("a thing picked by keys alone", "a phone has no keyboard in this check");
  else {
    // The plan's things are buttons in the tab order (role=button, Enter or Space picks): reached by Tab, Enter picks.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) { await page.keyboard.press("Tab"); reached = await page.evaluate((s) => !!document.activeElement?.matches(`${s} .vz-plan .it`), S); }
    if (reached) { await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
    check("a thing can be picked by keys alone (Tab to it on the plan, Enter)", reached && !!(await page.$(`${S} .vz-plan .it.sel`)), reached ? "reached" : "no plan item in the tab order");
    await unpick();
  }

  // 7 · Ends as it opened (the view it opened on, too).
  if (viewAtStart) { if (await picked()) { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(300); } await page.getByRole("radio", { name: viewAtStart, exact: true }).click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); }
  await page.waitForTimeout(600);
  check("the room ends as it opened: same things, same findings, Saved", (await count()) === start.n && (await findings()) === start.f && (await saidSave()) === start.save, { start, end: { n: await count(), f: await findings(), save: await saidSave() } });
  notYet("save success, failure, Retry and an edit made while saving", "walked by vision-store-save (iphone-se, desktop), not here");
  writeFileSync(`${out}/walk.json`, JSON.stringify(rows, null, 1));
  await page.screenshot({ path: `${out}/walk-end.png` }).catch(() => {});
}
