// THE CREW'S FIRST DAY — one home (2026-10-08).
//
// Ryan, with a screenshot of what he had to text Niño the day Niño was brought on: "Sign out and
// sign out of the app, then click — Profile drop down — Crew mode — click the star on bottom right
// corner — click ask gt3 in top menu". Then: "Welcome letter plus onboarding doc that helps with
// stuff like this."
//
// The letter (lib/crewWelcome) told a new teammate to sign in, open Today and start the Academy, and
// nothing else. The Guide (the ⓘ on the crew side) explained what each section is for, and nothing
// about the four things above. So the first day lived in Ryan's texts. It lives here now, once, and
// three places read it:
//
//   the Guide's "Start here"  — components/CrewStart: each step, how, and one tap that does it
//   the welcome letter        — lib/crewWelcome: the same steps in the email, and the link to the guide
//   Ask GT3                   — app/api/agents/operator: "how do I get to crew mode?" is answered from
//                               the same words, with the same links
//
// What made two of Ryan's four steps necessary is fixed where it happened, not explained here: the
// app re-reads who you are when it comes back to the screen (components/AuthProvider), so nobody
// signs out to become crew; and /crew?ask=1 opens Ask GT3 straight away (components/QuickDock).
//
// Pure: no React, no database. Every name in a step comes from the caller — a part with nothing to
// say is left out, never guessed (the letter's rule).

/** The guide's own address. The letter links it; the Guide opens on Start here when it is used. */
export const START_PATH = "/crew?guide=start";

export type StartKey = "crew" | "ask" | "training" | "alerts" | "home" | "who";

/** What a step's one tap does — the screen maps each kind to its own move. */
export type StartGo =
  | { kind: "section"; section: "day" | "settings"; anchor?: string; label: string }
  | { kind: "ask"; label: string }
  | { kind: "href"; href: string; label: string };

export type StartStep = {
  key: StartKey;
  title: string;
  /** One or two plain sentences: what to tap, in the app's own words. */
  how: string;
  /** Already true for this person — they are on the crew side, the app is on their Home Screen. */
  done?: boolean;
  go?: StartGo;
};

export type StartFacts = {
  /** The city's NAME ("Atlanta"), never its slug. */
  city?: string | null;
  /** They lead that city. */
  leadsCity?: boolean;
  /** Who leads it, when it is someone else. */
  cityLead?: string | null;
  /** The owners' names — who to ask when the city has no one else to ask. */
  owners?: string[] | null;
  /** Their Academy path's label ("Operator"). */
  track?: string | null;
  /** Reading this inside the crew side right now. */
  onCrewSide?: boolean;
  /** GT3 is running from the Home Screen or as the iPhone app. */
  installed?: boolean;
};

const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "";

/** "Ryan", "Ryan or Kayla", "Ryan, Kayla or Sam" — first names, as the letter calls people. */
function anyOf(names: string[]): string {
  const f = names.map(first).filter(Boolean);
  if (f.length <= 1) return f[0] ?? "";
  return `${f.slice(0, -1).join(", ")} or ${f[f.length - 1]}`;
}

/** Who a new teammate asks first — their city's lead, else the owners. Null when nobody is known. */
export function whoToAsk(f: StartFacts): string | null {
  const owners = (f.owners ?? []).filter(Boolean);
  if (f.city && f.leadsCity) return owners.length ? `You lead ${f.city}. ${anyOf(owners)} ${owners.length > 1 ? "own" : "owns"} GT3 — ask them anything.` : `You lead ${f.city}.`;
  if (f.city && f.cityLead) return `${first(f.cityLead) || f.cityLead} leads ${f.city} — your first call for anything.`;
  if (owners.length) return `Ask ${anyOf(owners)} — anything at all.`;
  return null;
}

// THE STEPS, IN THE ORDER A FIRST DAY NEEDS THEM. Six, not nine: Today is where the crew side opens
// (so it is part of the first step, not a second), and a note is the ✦'s second job (so it rides
// with Ask GT3). Home Screen is a step because the app is used one-handed on a phone all shift.
export function startSteps(f: StartFacts = {}): StartStep[] {
  const steps: StartStep[] = [
    {
      key: "crew", title: "The crew side",
      how: f.onCrewSide
        ? "You're on it. It opens on Today — your tasks, what's due and today's op. Customer, at the top, shows the app the way guests see it; GT3 remembers whichever side you were on last."
        : "Tap your picture at the top right, then Crew Mode. It opens on Today — your tasks, what's due and today's op — and GT3 remembers: from then on it opens there.",
      done: !!f.onCrewSide,
      go: { kind: "section", section: "day", label: "Open Today" },
    },
    {
      key: "ask", title: "Ask GT3 — the ✦ at the bottom right",
      how: "Tap the ✦, then Ask GT3. Ask what you'd ask a teammate — how to make a Rise, a ratio, our gear, an inspection. The ✦ also takes a quick note and logs a purchase.",
      go: { kind: "ask", label: "Ask GT3 now" },
    },
    {
      key: "training", title: "Start your training",
      how: `The Academy${f.track ? ` — the ${f.track} path` : ""}. Short lessons with a quick check at the end; your progress saves as you go.`,
      go: { kind: "href", href: "/academy", label: "Open the Academy" },
    },
    {
      key: "alerts", title: "Turn on alerts",
      how: "Settings › Notifications — so a task, a ping or a new order on the pass reaches this phone.",
      go: { kind: "section", section: "settings", anchor: "set-notify", label: "Open Notifications" },
    },
    {
      key: "home", title: "Put GT3 on your Home Screen",
      how: f.installed
        ? "It's there already — GT3 opens from your Home Screen."
        : "iPhone: open app.gt3pb.com in Safari, tap Share, then Add to Home Screen. Android: open it in Chrome, tap ⋮, then Install app.",
      done: !!f.installed,
    },
  ];
  const who = whoToAsk(f);
  steps.push({ key: "who", title: "Who to ask", how: who ?? "Ask the owner who brought you on — and the ✦ for anything about the craft." });
  return steps;
}

/**
 * The same first day, as the welcome letter's numbered lines (plain text — the letter is plain
 * text). `origin` is the app's public address (lib/connect CONNECT_APP), so every link is whole.
 */
export function startLetterLines(f: StartFacts, origin: string): string[] {
  const o = origin.replace(/\/+$/, "");
  return [
    "Your first day:",
    `1. Open GT3 at ${o}, signed in with this email address. If it was already open on your phone, it switches you over the next time you come back to it — no need to sign out.`,
    "2. Go to the crew side: tap your picture at the top right, then Crew Mode. It opens on Today — your tasks, what's due and today's op.",
    "3. Meet Ask GT3: tap the ✦ at the bottom right, then Ask GT3. Ask what you'd ask a teammate — how to make a Rise, a ratio, our gear.",
    `4. Start your training in the Academy${f.track ? ` — the ${f.track} path` : ""}.`,
    "",
    "Your first-day guide walks through all of it, one tap at a time — alerts and your Home Screen too:",
    `${o}${START_PATH}`,
  ];
}

/**
 * Ask GT3's knowledge of the app itself — the same steps, with the in-app links its answers may use
 * (the operator prompt allows in-app pointers like [the craft page](/craft)). Generic on purpose: no
 * one's name or city, so one prompt serves the whole crew.
 */
export function startKnowledge(): string {
  return [
    "HOW THE APP WORKS — for \"how do I…\" questions about the GT3 app itself. Answer from this, and link the place:",
    "- The crew side: tap your picture at the top right, then Crew Mode — it opens on Today (tasks, what's due, today's op), and GT3 remembers the side you were on. Customer, at the top of the crew side, shows the app the way guests see it. [Open Today](/crew?s=day)",
    "- A new role shows up the next time you come back to the app — nobody needs to sign out. If it hasn't after a minute, close the app and open it again.",
    "- Ask GT3: the ✦ at the bottom right, then Ask GT3. The ✦ also takes a quick note (just for you unless you share it) and logs a purchase. A link to app.gt3pb.com/crew?ask=1 opens Ask GT3 straight away.",
    "- Training: the Academy — each role has a path of short lessons with a quick check; progress saves. [The Academy](/academy)",
    "- Alerts: Settings › Notifications — what pings you, quiet hours, and the pass's sound on this phone. [Notifications](/crew?s=settings&a=set-notify)",
    "- Home Screen: iPhone — open app.gt3pb.com in Safari, Share, Add to Home Screen. Android — Chrome, ⋮, Install app.",
    "- Who to ask: your city's lead first, then an owner.",
    `- The first-day guide: [Start here](${START_PATH}). What every section is for: the ⓘ at the top of the crew side.`,
  ].join("\n");
}
