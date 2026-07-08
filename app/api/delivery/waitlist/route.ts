import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// OUT-OF-ZONE WAITLIST — capture only, fail-silent-ish, tightly bounded. No client table access
// (service role writes); a tiny in-memory window keeps a bot from filling the table in one burst.
let windowStart = 0, windowCount = 0;
const WINDOW_MS = 60_000, WINDOW_MAX = 30;

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: true }); // capture is best-effort by design
  const nowMs = Date.now();
  if (nowMs - windowStart > WINDOW_MS) { windowStart = nowMs; windowCount = 0; }
  if (++windowCount > WINDOW_MAX) return NextResponse.json({ ok: true });

  let b: { zip?: string; email?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const zip = typeof b.zip === "string" ? b.zip.trim().slice(0, 10) : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 120) : "";
  if (!/^\d{5}/.test(zip) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a ZIP and a real email." }, { status: 400 });
  }
  await supabaseAdmin.from("delivery_waitlist").upsert({ zip: zip.slice(0, 5), email }, { onConflict: "zip,email", ignoreDuplicates: true });
  return NextResponse.json({ ok: true });
}
