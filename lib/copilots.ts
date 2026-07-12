import type { OpSection } from "@/components/OperatorNav";

// THE COPILOT REGISTRY — the single manifest of every AI operation in GT3. It drives the ✦ launcher,
// the onboarding index, and (later) usage/governance. Adding an agent = adding ONE line here, and it
// appears everywhere. `section` is where the agent's surface lives (the launcher routes there); the
// entry is shown only to roles that can reach that section, so access gating is inherited — no
// separate permission list to drift. Group by `cat` for a scannable menu.
export type Copilot = { id: string; label: string; desc: string; section: OpSection; cat: string };

export const COPILOT_CATS = ["Chief of staff", "Growth", "Events", "Production"] as const;

export const COPILOTS: Copilot[] = [
  // Chief of staff · notes → action
  { id: "opsplan",   label: "Turn a note into operations",           desc: "Note → events, vendors, pipeline & tasks + gaps", section: "notes",    cat: "Chief of staff" },
  { id: "transcribe",label: "Transcribe photos, PDFs & handwriting", desc: "Attachments → one clean transcript",             section: "notes",    cat: "Chief of staff" },
  { id: "recap",     label: "Pull follow-ups from a note",           desc: "Note → concrete action items",                   section: "notes",    cat: "Chief of staff" },
  { id: "summarize", label: "Summarize a transcript",                desc: "Transcript → title · recap · tasks",             section: "notes",    cat: "Chief of staff" },
  { id: "chief",     label: "Brief me on the whole business",        desc: "Executive read of the week / month",             section: "day",      cat: "Chief of staff" },
  // Growth · sales & marketing
  { id: "sales",     label: "Work the sales pipeline",               desc: "Chief-of-sales moves on every deal",             section: "pipeline", cat: "Growth" },
  { id: "intake",    label: "Turn a booking request into a lead",    desc: "Inbound → a structured opportunity",             section: "plan",     cat: "Growth" },
  { id: "campaign",  label: "Draft a campaign",                      desc: "A multi-channel content plan",                   section: "studio",   cat: "Growth" },
  { id: "caption",   label: "Write post captions",                   desc: "On-brand captions for a post",                   section: "studio",   cat: "Growth" },
  { id: "repurpose", label: "Repurpose one asset into many",         desc: "One post → every format",                        section: "studio",   cat: "Growth" },
  { id: "flyer",     label: "Generate a road flyer",                 desc: "An event flyer from the details",                section: "studio",   cat: "Growth" },
  // Events · service
  { id: "event-generate", label: "Draft a full event",              desc: "From an idea to a bookable event",               section: "plan",     cat: "Events" },
  { id: "eventprep", label: "Plan event prep",                       desc: "The prep plan for a stop or event",              section: "prep",     cat: "Events" },
  { id: "dayplan",   label: "Build a day-of run sheet",              desc: "The hour-by-hour service plan",                  section: "prep",     cat: "Events" },
  { id: "readiness", label: "Check readiness & the pack list",       desc: "Are we loaded for what's next?",                 section: "prep",     cat: "Events" },
  { id: "troubleshoot", label: "Log a fix → prevention tasks",       desc: "So the same thing doesn't bite twice",           section: "prep",     cat: "Events" },
  // Production · garage
  { id: "brew",      label: "Scale & schedule a brew",               desc: "Batch math + the brew schedule",                 section: "brew",     cat: "Production" },
  { id: "loadout",   label: "Plan the trailer load-out",             desc: "What to load and how",                           section: "brew",     cat: "Production" },
  { id: "inventory", label: "Read stock & flag pars",                desc: "What's low, what to reorder",                    section: "garage",   cat: "Production" },
  { id: "trailer",   label: "Plan trailer packing & tow specs",      desc: "Space plan + tow safety",                        section: "garage",   cat: "Production" },
  { id: "inspection",label: "Run an inspection",                     desc: "The safety / quality checklist",                 section: "prep",     cat: "Production" },
];
