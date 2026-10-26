import { kindOf, type Issue, type Layout } from "./vision";

// THE ROOM, BY PILLAR (S1.1b on an iPhone — Ryan: "integrate the Primal Standard's four pillars into Experience and
// Evaluate… clearly distinguish measured facts, user-provided specifications, modeled estimates and unknowns"). What the
// drawing can say about each pillar, each line tagged with where it comes from. Nothing here is a judgement under the
// Standard (that's an owner's, with evidence) and nothing is a health claim: the drawing knows counts and distances, not
// light levels, sound or what a finish is made of — those say "unknown" until evidence is accepted.

export type Source = "drawn" | "simulated" | "standard" | "unknown";
export const SOURCE_WORD: Record<Source, string> = { drawn: "From the drawing", simulated: "Simulated", standard: "Under the Standard", unknown: "Unknown" };
export type Fact = { pillar: "movement" | "stillness" | "light" | "fuel"; source: Source; text: string };

const count = (l: Pick<Layout, "items">, kinds: string[]) => l.items.filter((i) => kinds.includes(i.kind)).length;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function pillarFacts(l: Pick<Layout, "items" | "width_in" | "depth_in">, found: readonly Issue[]): Fact[] {
  const seats = l.items.reduce((s, i) => s + (kindOf(i.kind).seats ?? 0), 0);
  const aisle = found.filter((f) => f.level !== "error" && /aisle|36 in|walk|narrows/i.test(f.words)).length;
  const overlaps = found.filter((f) => /overlap|through a wall|outside/i.test(f.words)).length;
  const doors = count(l, ["door"]), windows = count(l, ["window_wall", "walk_up"]);
  const bar = count(l, ["tap_tower", "bottle_cooler", "broth_station", "order_counter"]), back = count(l, ["prep_counter", "brew_vessels", "reach_in", "ice_machine", "three_sink", "storage"]);
  const sinks = count(l, ["hand_sink", "three_sink"]);
  return [
    { pillar: "movement", source: "drawn", text: `${plural(doors, "door")}; ${aisle ? `${plural(aisle, "tight spot")} under 36 in` : "nothing closer than 36 in"}${overlaps ? `; ${plural(overlaps, "overlap")} or wall crossings` : ""}.` },
    { pillar: "movement", source: "simulated", text: "How guests and crew move through it: the Experience lens runs the flow on assumed timings — a model, not a count." },
    { pillar: "stillness", source: "drawn", text: `${plural(seats, "seat")}, ${plural(count(l, ["lounge", "community", "bench"]), "place", "places")} to stay a while.` },
    { pillar: "stillness", source: "unknown", text: "Sound and sensory load aren't in the drawing — unknown until measured." },
    { pillar: "light", source: "drawn", text: windows ? `${plural(windows, "daylight opening")} drawn.` : "No daylight opening drawn." },
    { pillar: "light", source: "unknown", text: "Light levels, colour temperature, flicker and glare — unknown until measured; lumens alone don't answer it." },
    { pillar: "fuel", source: "drawn", text: `${plural(bar, "bar fixture")}, ${plural(back, "back-of-house fixture")}, ${plural(sinks, "sink")}.` },
    { pillar: "fuel", source: "standard", text: "Food-contact materials and finishes are judged under the Standard with their evidence — not from the drawing." },
  ];
}
