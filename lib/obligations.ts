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
// Kept apart from the component so the smoke can hold every source to its destination.

export type ObligationRow = { source: string; subject_id: string; route: string | null; owner_user_id?: string | null };

export type ObligationGo =
  | { kind: "task"; id: string; source: "todo" | "event" }
  | { kind: "person"; id: string }
  | { kind: "section"; section: string; anchor?: string };

export function obligationGo(r: ObligationRow): ObligationGo {
  switch (r.source) {
    case "todos":
      return { kind: "task", id: r.subject_id, source: "todo" };
    case "academy_certifications":
    case "academy_assignments":
      if (r.owner_user_id && isUuid(r.owner_user_id)) return { kind: "person", id: r.owner_user_id };
      break;
    case "offer_letters":
      return { kind: "section", section: "money", anchor: "offers" };
    case "operator_agreements":
      return { kind: "section", section: "money", anchor: "operators" };
    case "goals":
      return { kind: "section", section: "command", anchor: "goals" };
    case "initiatives":
    case "os_workstreams":
      return { kind: "section", section: "command", anchor: "os-registry" };
    case "square_disputes":
      return { kind: "section", section: "money", anchor: "shoporders" };
  }
  const s = /[?&]s=([a-z-]+)/.exec(r.route || "")?.[1];
  const a = /[?&]a=([a-z0-9-]+)/.exec(r.route || "")?.[1];
  return { kind: "section", section: s || "day", ...(a ? { anchor: a } : {}) };
}
