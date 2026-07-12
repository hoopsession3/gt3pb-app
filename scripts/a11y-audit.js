// GT3 · accessibility audit (axe-core) — for screens that need a signed-in session.
//
// The customer surface is audited in CI-style from the dev server, but the CREW CONSOLE (/crew, /driver)
// only renders behind a staff sign-in, so it can't be reached without your session. To audit it:
//
//   1. Sign in as staff and open the screen you want (e.g. app.gt3pb.com/crew, then switch each section
//      — My Day, Live Ops, Prep, Plan, Pipeline, Studio, Brew, Assets, Money, Customers, Team, Settings).
//   2. Open DevTools → Console and paste this whole file.
//   3. Read the grouped report. Re-run after switching sections / opening a popout (Sheet), since the
//      console is a single-page app — each section + open dialog is its own "screen" to check.
//
// It loads axe-core from jsDelivr; if the site's CSP blocks that, copy node_modules/axe-core/axe.min.js
// into public/ and change the src below to '/axe.min.js' (same-origin).
(async () => {
  if (!window.axe) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/axe-core@4.12.1/axe.min.js";
      s.onload = res; s.onerror = () => rej(new Error("axe blocked by CSP — see the note at the top of this file"));
      document.head.appendChild(s);
    });
  }
  const r = await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
  });
  const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const v = r.violations.slice().sort((a, b) => (rank[a.impact] ?? 9) - (rank[b.impact] ?? 9));
  const bySev = v.reduce((m, x) => ((m[x.impact] = (m[x.impact] || 0) + 1), m), {});
  console.log(`%cA11y · ${location.pathname} · ${v.length} rule(s), ${v.reduce((n, x) => n + x.nodes.length, 0)} instance(s)`,
    "font-weight:bold;font-size:13px;color:#C8A661");
  console.table(bySev);
  for (const x of v) {
    console.groupCollapsed(`[${x.impact}] ${x.id} ×${x.nodes.length} — ${x.help}`);
    console.log("WCAG:", x.tags.filter((t) => /wcag\d/.test(t)).join(", ") || "best-practice");
    x.nodes.slice(0, 12).forEach((n) => console.log(n.target, "→", (n.failureSummary || "").replace(/\n/g, " ")));
    console.groupEnd();
  }
  // Return a compact array so you can copy it out of the console.
  return v.map((x) => ({ impact: x.impact, id: x.id, count: x.nodes.length, help: x.help }));
})();
