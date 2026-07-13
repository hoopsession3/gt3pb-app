"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { uploadToBucket } from "@/lib/uploads";

// VIP VERIFY — the customer side. A signed-in bottle owner uploads a proof photo; it lands in the staff
// queue (pending). On verify they become a Founding VIP with a reward. Shows the live status. Reuses the
// avatars-style own-folder upload into the 'vip' bucket (0203). Renders nothing for signed-out users.
export default function VipVerify() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"loading" | "none" | "pending" | "verified" | "rejected">("loading");
  const [reward, setReward] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) { setStatus("none"); return; }
    const { data } = await supabase.from("vip_verifications").select("status, reward, note").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
    const row = (data as { status: "pending" | "verified" | "rejected"; reward: string | null; note: string | null }[] | null)?.[0];
    setStatus(row?.status ?? "none"); setReward(row?.reward ?? null); setNote(row?.note ?? null);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const submit = async (file: File) => {
    if (!supabase || !user || busy) return;
    setBusy(true); setErr("");
    const up = await uploadToBucket({ bucket: "vip", file, prefix: user.id });   // own-folder path satisfies the bucket RLS
    if ("error" in up) { setErr(up.error); setBusy(false); return; }
    const customerId = (await supabase.rpc("resolve_customer", { p_user_id: user.id, p_phone: null, p_email: null, p_name: null }).then((r) => r.data, () => null)) as string | null;
    const { error } = await supabase.from("vip_verifications").insert({ user_id: user.id, customer_id: customerId, photo_url: up.url });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    load();
  };

  if (status === "loading" || status === "none" && !user) return null;
  if (status === "verified") return <div className="vipv done">★ You&rsquo;re a verified Founding VIP{reward ? ` — ${reward}` : ""}. Your perks are live.</div>;
  if (status === "pending") return <div className="vipv wait">⏳ Your VIP proof is in review — we&rsquo;ll confirm you soon.</div>;

  return (
    <div className="vipv">
      <div className="vipv-h">★ Own a GT3 bottle? Verify for VIP</div>
      <p className="vipv-sub">Snap a photo with your bottle and we&rsquo;ll make you a <b>Founding VIP</b> — free straight-brew refills, member pricing, and a reward.{status === "rejected" && note ? ` (Last time: ${note})` : ""}</p>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) submit(f); e.currentTarget.value = ""; }} />
      <button type="button" className="vipv-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Uploading…" : status === "rejected" ? "📸 Try again" : "📸 Upload bottle photo"}</button>
      {err && <div className="vipv-err">{err}</div>}
    </div>
  );
}
