import { supabaseAdmin } from "@/lib/supabaseAdmin";

// AGENT GROUNDING — assembles the owner's corrections (0143) into an AUTHORITATIVE block that goes
// at the TOP of an agent's system prompt, so a correction wins over anything in the static
// knowledge below it. This is how a wrong answer gets fixed for good: the owner writes the truth
// once, and every agent reads it first. Best-effort — returns "" when nothing's configured.

// `includeShared` controls the "all" wildcard bucket. Internal (staff-gated) agents include it so
// one correction can apply everywhere. The PUBLIC concierge passes false: a guest-facing surface
// must only ever inject corrections EXPLICITLY tagged for it — otherwise an owner note written for
// the internal agents (tagged "all") would surface to guests. Explicit allow-list for the public.
export async function ownerCorrections(agent: string, includeShared = true): Promise<string> {
  if (!supabaseAdmin) return "";
  const base = supabaseAdmin
    .from("agent_knowledge")
    .select("title, body")
    .eq("active", true);
  const { data } = await (includeShared ? base.in("agent", ["all", agent]) : base.eq("agent", agent))
    .order("created_at", { ascending: false })
    .limit(60);
  if (!data || data.length === 0) return "";
  const lines = data.map((k: { title: string; body: string }) => `- ${k.title}: ${k.body}`).join("\n");
  return (
    "=== OWNER CORRECTIONS (AUTHORITATIVE — these are the truth; if anything below conflicts, THESE WIN. " +
    "Never contradict a correction. If a question is about something a correction covers, answer from it exactly.) ===\n" +
    lines
  );
}

// The brew recipes as exact, grounded facts — so recipe/quantity questions are answered from data,
// never invented. Quantities are stated per the recipe's base volume; the agent is told to scale
// linearly and to refuse rather than guess when a recipe isn't on file.
export async function brewRecipeFacts(): Promise<string> {
  if (!supabaseAdmin) return "";
  const { data } = await supabaseAdmin
    .from("brew_recipes")
    .select("name, style, ratio, base_water_gal, ingredients, extraction_hours, target_spec")
    .is("archived_at", null)
    .limit(50);
  if (!data || data.length === 0) return "";
  const fmt = data
    .map((r: any) => {
      const ing = Array.isArray(r.ingredients)
        ? r.ingredients.map((i: any) => `${i.name} ${i.qty}${i.unit || ""}${i.scales === false ? " (fixed)" : ""}`).join(", ")
        : "";
      return `- ${r.name}${r.style ? ` [${r.style}]` : ""}: per ${r.base_water_gal} gal water → ${ing || "(no ingredient list on file)"}${r.ratio ? ` · ratio ${r.ratio}` : ""}${r.extraction_hours ? ` · ${r.extraction_hours}h extraction` : ""}`;
    })
    .join("\n");
  return (
    "=== BREW RECIPES (EXACT — quantities are per the stated base gallons; scale LINEARLY with water volume). " +
    "If asked a recipe quantity, compute it from these numbers. If a recipe or ingredient is NOT listed here, say " +
    "\"that's not on file — check with Ryan\" and do NOT invent a number. ===\n" + fmt
  );
}

// Fire-and-forget log of an agent exchange (0143) — never blocks or throws.
export async function logConvo(agent: string, question: string, answer: string, userId: string | null, authorName: string | null): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from("agent_convos").insert({
      agent, question: question.slice(0, 2000), answer: answer.slice(0, 4000),
      user_id: userId, author_name: authorName,
    });
  } catch { /* logging is best-effort */ }
}
