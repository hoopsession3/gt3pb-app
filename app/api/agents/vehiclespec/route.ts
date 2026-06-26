import { NextResponse } from "next/server";
import { staffFromRequest } from "@/lib/apiAuth";
import { callClaude, anthropicEnabled, MODELS, type ToolDef } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
// VEHICLE SPEC AGENT — type a year/make/model and how many people are riding; it returns an expert
// estimate of the cargo bay (cu ft + usable L×W×H), tow capacity, and — the useful part — the USABLE
// cargo once the seats those passengers need are up. Those usable dims feed straight into the load-out
// space math (veh_cargo_*). Estimate, not a spec sheet — labeled as such. Staff-gated.

const TOOL: ToolDef = {
  name: "vehicle_spec",
  description: "Expert estimate of a vehicle's cargo space + tow capacity, and the usable cargo for the given passenger count.",
  input_schema: {
    type: "object",
    properties: {
      resolved: { type: "string", description: "The vehicle you priced this for, e.g. '2026 Honda Pilot (3-row midsize SUV)'." },
      tow_capacity_lb: { type: "number", description: "Max tow rating in lb (properly equipped). Best expert estimate." },
      cargo_cuft_all_seats_up: { type: "number", description: "Cargo volume behind the last occupied-able row, all seats up (cu ft)." },
      cargo_cuft_all_seats_down: { type: "number", description: "Max cargo volume, all rear seats folded (cu ft)." },
      passengers: { type: "number", description: "Passenger count this plan assumes (including driver)." },
      seat_config: { type: "string", description: "Which rows must stay up for those passengers, e.g. '2 up front, 2nd row up, 3rd row down'." },
      usable_cuft: { type: "number", description: "Usable cargo cu ft with that seat config (the number that matters for load-out)." },
      bay_len_in: { type: "number", description: "Usable bay length (in) behind the last up row, for that config." },
      bay_width_in: { type: "number", description: "Usable bay width (in) between the wheel wells / walls." },
      bay_height_in: { type: "number", description: "Usable bay height (in) floor to ceiling/cargo-cover line." },
      note: { type: "string", description: "One line of expert guidance — what fits, what to fold, the trade-off vs passengers." },
    },
    required: ["resolved", "tow_capacity_lb", "cargo_cuft_all_seats_up", "cargo_cuft_all_seats_down", "passengers", "seat_config", "usable_cuft", "bay_len_in", "bay_width_in", "bay_height_in"],
  },
};

export async function POST(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!anthropicEnabled()) return NextResponse.json({ ok: false, error: "AI not configured (set ANTHROPIC_API_KEY)" }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const vehicle = String(body.vehicle ?? "").trim().slice(0, 120);
  if (!vehicle) return NextResponse.json({ ok: false, error: "vehicle (year make model) required" }, { status: 400 });
  const passengers = Math.max(1, Math.min(9, Number(body.passengers) || 1));

  try {
    const r = await callClaude({
      model: MODELS.sonnet, maxTokens: 700, temperature: 0.2,
      system:
        "You are a vehicle-packing expert for a mobile beverage truck deciding what fits in the tow/cart vehicle. Given a year/make/model and a passenger count, give your best EXPERT ESTIMATE of: tow capacity (properly equipped), cargo volume seats-up and seats-down, and — most important — the USABLE cargo once you raise the seats those passengers need (e.g. 4 people in a 3-row SUV means the 3rd row is up, cutting cargo to the smaller behind-2nd-row space). Estimate realistic usable interior L×W×H in inches for that seat config (length behind the last up row, width between the wheel wells, height to the cargo-cover line — not the showroom max). If the model is ambiguous, assume the common trim and say so in the note. These are planning estimates, not spec-sheet exact. Always answer with the vehicle_spec tool.",
      messages: [{ role: "user", content: `Vehicle: ${vehicle}. Passengers riding (incl. driver): ${passengers}.` }],
      tools: [TOOL],
      tool_choice: { type: "tool", name: "vehicle_spec" },
    });
    const out: any = r.toolUses.find((t) => t.name === "vehicle_spec")?.input ?? null;
    if (!out) return NextResponse.json({ ok: false, error: "no estimate returned — try a more specific year/make/model" }, { status: 502 });
    return NextResponse.json({ ok: true, estimate: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
