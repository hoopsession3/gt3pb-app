import { isUuid } from "./uuid";

// WHERE A "NEEDS YOU" ROW GOES — one rule, for the twelve kinds of deadline v_obligations carries.
//
// Every row on My Day's Needs-you panel was an <a href={route}>: a full page reload of the console,
// to whatever v_obligations' route column said (0330). Ryan, 2026-10-04: "strategically look for
// where something … should have operational functionality." Measured against the code that day:
//   · a to-do ("To-do due · … 3 days late ›") reloaded the screen it was already on — the to-do
//     never opened;
//   · "Offer expires" went to ?s=team&a=offers, but the offers panel lives in Money, so the jump gave
//     up at the top of Team;
//   · "Certification expires" and "Training due" landed on the top of Team, which has no screen for
//     either — the person they are about is the place to go;
//   · goals and workstreams landed on the top of Command, four blocks above the panel that holds them.
// So a row now goes to the thing it names when the app has a home for it (a task, a person), to the
// panel that holds it otherwise, and only for a source this file does not know does it fall back to
// the view's own route — parsed, so even that is an in-app jump and not a reload.
//
// ── AN INITIATIVE OPENS ITSELF (later that night) ──────────────────────────────────────────────
// "Aug 1 Launch — Initiative target · 64 days late" went to os-registry: the workstreams panel, which
// does not hold initiatives (CommandBoard, below it, does). And nowhere in the app could its date be
// moved — only "Finish", which completes every open task under it. It opens its own sheet now
// (components/InitiativeSheet): the date, the status, the name.
//
// ── "NEEDS YOU" MEANS YOU (same night) ─────────────────────────────────────────────────────────
// v_obligations is security_invoker, so a row reaches whoever may READ its source — and initiatives,
// goals and workstreams are readable by all staff. A server's My Day listed "Aug 1 Launch" and a tap
// on it landed on Command, which a server cannot open: a promise to someone who cannot keep it.
// obligationFor() keeps a row only for a viewer who can act on it — its one tap (equipment upkeep is
// anybody's to log), its being theirs (their to-do, their certificate), or a door they can open.
//
// ── A PERMIT RULE OPENS ITSELF (2026-10-04, 0342) ──────────────────────────────────────────────
// "Needs re-checking" went to the top of Prep and could be answered nowhere. It opens the rule now
// (components/ComplianceRuleRecord), where the re-check is recorded with where it was checked.
//
// ── AN INVOICE IS ITS OWN ANSWER (2026-10-04, 0341) ────────────────────────────────────────────
// Invoices never reached this list — the app wrote them without a due date and the view keeps only
// dated ones. Now they do, and the one thing to do about an invoice that is due is say it was paid,
// once the money is in: "Paid" on the row (mark_invoice_paid, an owner's or admin's). There is no
// panel that lists invoices, so the row goes nowhere else — `none` — rather than to the top of Money,
// a jump that would land on nothing about it.
//
// Kept apart from the component so the smoke can hold every source to its destination.

export type ObligationRow = { source: string; subject_id: string; route: string | null; owner_user_id?: string | null };

export type ObligationGo =
  | { kind: "task"; id: string; source: "todo" | "event" }
  | { kind: "person"; id: string }
  | { kind: "initiative"; id: string }
  | { kind: "page"; href: string }
  | { kind: "section"; section: string; anchor?: string }
  | { kind: "rule"; id: string }
  | { kind: "none" };

/** Who is looking: their id, the sections their role opens (sectionsForRole), and whether they manage. */
export type Viewer = { id: string | null; sections: readonly string[]; manage: boolean };

export function obligationGo(r: ObligationRow, viewer?: Viewer): ObligationGo {
  switch (r.source) {
    case "todos":
      return { kind: "task", id: r.subject_id, source: "todo" };
    case "academy_certifications":
    case "academy_assignments":
      // Your own certificate is renewed, and your own training done, in the Academy; the person
      // record is the team admin's view of somebody else.
      if (viewer && r.owner_user_id && r.owner_user_id === viewer.id && !viewer.sections.includes("team")) return { kind: "page", href: "/academy" };
      if (r.owner_user_id && isUuid(r.owner_user_id)) return { kind: "person", id: r.owner_user_id };
      break;
    case "initiatives":
      if (isUuid(r.subject_id)) return { kind: "initiative", id: r.subject_id };
      break;
    case "offer_letters":
      return { kind: "section", section: "money", anchor: "offers" };
    case "operator_agreements":
      return { kind: "section", section: "money", anchor: "operators" };
    case "goals":
      return { kind: "section", section: "command", anchor: "goals" };
    case "os_workstreams":
      return { kind: "section", section: "command", anchor: "os-registry" };
    case "square_disputes":
      return { kind: "section", section: "money", anchor: "shoporders" };
    case "invoices":
      return { kind: "none" };
    case "compliance_rules":
      // The rule itself (0342): what it says, where to check it, and the answer. Its route said Prep,
      // which holds nothing about any one rule.
      if (isUuid(r.subject_id)) return { kind: "rule", id: r.subject_id };
      break;
  }
  const s = /[?&]s=([a-z-]+)/.exec(r.route || "")?.[1];
  const a = /[?&]a=([a-z0-9-]+)/.exec(r.route || "")?.[1];
  return { kind: "section", section: s || "day", ...(a ? { anchor: a } : {}) };
}

/** Sources with a one-tap answer on the row itself, and who may give it (the database's own rule). */
export const OBLIGATION_WAYS: Record<string, "staff" | "admin"> = {
  asset_maintenance: "staff",   // "Done today" — asset_maintenance insert is is_staff() (0083)
  todos: "staff",               // "Mark done" — the same write My Tasks' checkbox makes
  invoices: "admin",            // "Paid" — mark_invoice_paid is is_admin() (0341)
};

/** Is this row the viewer's to act on? See the header: "Needs you" is not "needs somebody". */
export function obligationFor(r: ObligationRow, v: Viewer): boolean {
  const mine = !!v.id && r.owner_user_id === v.id;
  switch (r.source) {
    case "asset_maintenance":
      return true;                                   // its one tap is anybody's on staff
    case "todos":
      // Yours is on your plate — My tasks is the one home for a task assigned to you (2026-10-04, "one
      // task, one place"). A manager triages the company's others here.
      return !mine && v.manage;
    case "academy_certifications":
    case "academy_assignments":
      return mine || v.sections.includes("team");    // yours, or the admin who runs the team
    case "invoices":
      return v.sections.includes("money");           // the people who handle money — owners and admins
    case "compliance_rules":
      return v.sections.includes("prep");            // whoever preps events — they are the ones who call the county
  }
  const to = obligationGo(r, v);
  if (to.kind === "initiative") return v.sections.includes("command");
  if (to.kind === "section") return v.sections.includes(to.section);
  return true;
}
