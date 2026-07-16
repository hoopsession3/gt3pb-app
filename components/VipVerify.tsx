"use client";

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";
import { uploadToBucket } from "@/lib/uploads";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";

// VIP VERIFY — the customer side. A signed-in bottle owner uploads a proof photo; it lands in the staff
// queue (pending). On verify they become a Founding VIP with a reward. Shows the live status. Reuses the
// avatars-style own-folder upload into the 'vip' bucket (0203). Renders nothing for signed-out users.
// Fetch state via useAsyncData — a failed status check used to fall back to "none" (never verified),
// which rendered the full "upload your bottle photo" prompt even for someone who'd already verified or
// had a submission pending — actively misleading, and a route to duplicate uploads. Now a real fetch
// error is a real error state instead of masquerading as "you haven't verified yet."
type VipStatus = "none" | "pending" | "verified" | "rejected";
type Board = { status: VipStatus; reward: string | null; note: string | null };

export default function VipVerify() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loader = useCallback(async (): Promise<Board> => {
    if (!supabase || !user) return { status: "none", reward: null, note: null };
    const { data, error } = await supabase.from("vip_verifications").select("status, reward, note").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const row = (data as { status: VipStatus; reward: string | null; note: string | null }[] | null)?.[0];
    return { status: row?.status ?? "none", reward: row?.reward ?? null, note: row?.note ?? null };
  }, [user]);
  const board = useAsyncData(loader, [user]);
  const { reload } = board;

  const submit = async (file: File) => {
    if (!supabase || !user || busy) return;
    setBusy(true); setErr("");
    const up = await uploadToBucket({ bucket: "vip", file, prefix: user.id });   // own-folder path satisfies the bucket RLS
    if ("error" in up) { setErr(up.error); setBusy(false); return; }
    // customer_id is filled server-side by the link_vip_customer trigger (0204) — resolve_customer is
    // service-role only, so the client can't call it; the trigger folds this proof onto the canonical customer.
    const { error } = await supabase.from("vip_verifications").insert({ user_id: user.id, photo_url: up.url });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    reload();
  };

  if (!user) return null; // signed out — nothing to show
  if (board.status === "loading") return null; // quiet during initial load, same as before

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't check your VIP status" emptyTitle="Nothing here yet">
      {(data) => {
        if (data.status === "verified") {
          return <div className="vipv done"><Icon name="star" /> You&rsquo;re a verified Founding VIP{data.reward ? ` — ${data.reward}` : ""}. Your perks are live.</div>;
        }
        if (data.status === "pending") {
          return <div className="vipv wait">Your VIP proof is in review — we&rsquo;ll confirm you soon.</div>;
        }
        return (
          <div className="vipv">
            <div className="vipv-h"><Icon name="star" /> Own a GT3 bottle? Verify for VIP</div>
            <p className="vipv-sub">Snap a photo with your bottle and we&rsquo;ll make you a <b>Founding VIP</b> — free straight-brew refills, member pricing, and a reward.{data.status === "rejected" && data.note ? ` (Last time: ${data.note})` : ""}</p>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) submit(f); e.currentTarget.value = ""; }} />
            <button type="button" className="vipv-btn" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Uploading…" : data.status === "rejected" ? "Try again" : "Upload bottle photo"}</button>
            {err && <div className="vipv-err">{err}</div>}
          </div>
        );
      }}
    </AsyncSection>
  );
}
