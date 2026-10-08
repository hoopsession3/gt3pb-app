// THE GT3 WELCOME LETTER (2026-10-07, Ryan: "When brought on, a GT3 welcome letter should come").
//
// Bringing someone onto the crew set their role and nothing reached them: they found out from
// whoever told them, or the next time they happened to open the app. An invite was the same — it
// waited, silently, for the person to sign up with that exact email, and nothing told them to. Two
// letters, one voice, written here once so the words are the same wherever they are sent from:
//
//   welcome  — someone with an account was brought on: their role, their city, who leads it, what
//              to do first, and the training path their role starts on.
//   invite   — someone without one was invited: who invited them, the role waiting for them, and
//              the one thing to do (sign up at the app with this email).
//
// Plain text, short, every line a fact — the house voice for anything sent (lib/notify). Nothing
// here is invented about the person: every name and place comes from the caller, and a part with
// nothing to say is left out rather than filled with a guess.

import { roleLabel } from "./roles";
import { CONNECT_APP } from "./connect";

/** The Academy path a role starts on — its label and one line about it (lib/academy's ROLES). */
export type Track = { label: string; blurb: string };

export type WelcomeFacts = {
  /** Their name as the roster has it; the first word is what the letter calls them. */
  name: string | null;
  role: string;
  /** The city's NAME ("Atlanta"), never its slug. */
  city: string | null;
  /** They were made the lead of that city. */
  leadsCity?: boolean;
  /** Who leads the city, when it is someone else. */
  cityLead?: string | null;
  track?: Track | null;
  /** The person who brought them on (the owner pressing the button). */
  from?: string | null;
};

const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "";

export function crewWelcome(f: WelcomeFacts): { subject: string; message: string } {
  const role = roleLabel(f.role);
  const hi = first(f.name);
  const where = f.city ? ` in ${f.city}` : "";
  const lines: string[] = [
    hi ? `${hi},` : "Hello,",
    "",
    `Welcome to GT3 Performance Bar. You're on the crew as ${role}${where}.${f.leadsCity && f.city ? ` You lead ${f.city}.` : ""}`,
  ];
  if (f.track?.blurb) lines.push("", f.track.blurb);
  lines.push(
    "",
    "Your first three steps:",
    `1. Sign in at ${CONNECT_APP} with this email address. Your crew tools are already switched on.`,
    "2. Open Today — your day, your tasks and the run are all there.",
    `3. Start your training in the Academy${f.track?.label ? ` — the ${f.track.label} path` : ""}.`,
  );
  if (f.cityLead && !f.leadsCity && f.city) lines.push("", `${f.cityLead} leads ${f.city} — they're your first call.`);
  else if (f.from) lines.push("", `Questions? Ask ${first(f.from) || f.from}.`);
  lines.push("", "Glad you're here.", f.from ? `${f.from}, GT3 Performance Bar` : "GT3 Performance Bar");
  return { subject: hi ? `Welcome to the GT3 crew, ${hi}` : "Welcome to the GT3 crew", message: lines.join("\n") };
}

export function crewInvite(f: { email: string; role: string; from?: string | null }): { subject: string; message: string } {
  const role = roleLabel(f.role);
  const who = f.from?.trim() || "GT3 Performance Bar";
  return {
    subject: `${who === "GT3 Performance Bar" ? "You're invited" : `${first(who)} invited you`} to the GT3 crew`,
    message: [
      "Hello,",
      "",
      `${who} added you to the GT3 Performance Bar crew as ${role}.`,
      "",
      "To join:",
      `1. Go to ${CONNECT_APP} and sign up with this email address (${f.email}) — any sign-in method works.`,
      "2. You'll land in your role straight away: Today, your tasks and your training path will be waiting.",
      "",
      "See you on the crew.",
      "GT3 Performance Bar",
    ].join("\n"),
  };
}
