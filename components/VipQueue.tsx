"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";

// VIP QUEUE — the staff moderation side of VIP verification. A bottle owner's proof photo lands here;
// Verify promotes them to Founding (which auto-grants the founding perks from 0176) with a reward, or
// Reject sends a reason back. Mirrors the reviews-moderation pattern. Reads vip_verifications (0203).
type Vip = {
  id: string; user_id: string; customer_id: string | null; photo_url: string;
  status: string; reward: string | null; note: string | null; created_at: string;
  customers: { name: string | null; tier: string } | null;
};

export default function VipQueue() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [rows, setRows] = useState<Vip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [signed, setSigned] = useState<Record<string, string>>({});   // storage path → 1h signed URL (bucket is private, 0217)

  const load = useCallback(async () => {
    if (!supabase) { setRows([]); return; }
    const { data } = await supabase.from("vip_verifications")
      .select("id, user_id, customer_id, photo_url, status, reward, note, created_at, customers(name, tier)")
      .order("created_at", { ascending: false }).limit(60);
    const rows = (data as unknown as Vip[]) ?? [];
    setRows(rows);
    // The vip bucket is private — staff view proofs through short-lived signed URLs. The stored value
    // is the original URL string; the path after /vip/ is the storage key.
    const paths = [...new Set(rows.map((r) => decodeURIComponent((r.photo_url.split("/vip/")[1] ?? ""))).filter(Boolean))];
    if (paths.length) {
      const { data: s } = await supabase.storage.from("vip").createSignedUrls(paths, 28800);   // 8h — outlives a service shift; realtime re-signs on any queue activity
      const m: Record<string, string> = {};
      for (const it of s ?? []) if (it.signedUrl && it.path) m[it.path] = it.signedUrl;
      setSigned(m);
    }
  }, []);
  const photoUrl = (v: Vip) => signed[decodeURIComponent(v.photo_url.split("/vip/")[1] ?? "")] ?? v.photo_url;
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("vip_verifications", load);

  const verify = async (v: Vip) => {
    if (!supabase || busy) return;
    const reward = typeof window !== "undefined" ? (window.prompt("Reward to note (e.g. “free bottle”) — or leave blank:", "free bottle") ?? "") : "";
    setBusy(v.id);
    const { error } = await supabase.from("vip_verifications").update({ status: "verified", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), reward: reward.trim() || null }).eq("id", v.id);
    if (error) { toast(`Couldn't verify — ${error.message}`, "error"); setBusy(null); return; }
    // Promote to Founding (auto-grants founding perks). Surface a failure — never claim "Founding VIP"
    // when the promotion didn't land, or staff + the member both believe perks are live when they aren't.
    const { error: promoErr } = await supabase.rpc("admin_set_customer_tier", { p_user: v.user_id, p_tier: "founding" });
    toast(promoErr ? `Verified — but promotion to Founding failed: ${promoErr.message}. Set their tier by hand.` : "Verified — Founding VIP", promoErr ? "error" : undefined);
    setBusy(null); load();
  };
  const reject = async (v: Vip) => {
    if (!supabase || busy) return;
    const note = typeof window !== "undefined" ? window.prompt("Why? (the member sees this)", "") : "";
    if (note === null) return;
    setBusy(v.id);
    await supabase.from("vip_verifications").update({ status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), note: note.trim() || null }).eq("id", v.id);
    setBusy(null); load();
  };

  if (rows === null) return <div className="vipq-empty">Loading…</div>;
  const pending = rows.filter((r) => r.status === "pending");
  const recent = rows.filter((r) => r.status !== "pending").slice(0, 8);

  return (
    <div className="vipq">
      {pending.length === 0 ? (
        <div className="vipq-empty">No VIP proofs waiting. 🟢</div>
      ) : pending.map((v) => (
        <div key={v.id} className="vipq-row">
          <a href={photoUrl(v)} target="_blank" rel="noreferrer" className="vipq-photo" style={{ backgroundImage: `url(${photoUrl(v)})` }} aria-label="Open the proof photo full-size" />
          <div className="vipq-main">
            <b>{v.customers?.name?.trim() || "A member"}</b>
            <span className="vipq-sub">Submitted {new Date(v.created_at).toLocaleDateString()} · now {v.customers?.tier ?? "guest"}</span>
            <div className="vipq-acts">
              <button type="button" className="vipq-yes" onClick={() => verify(v)} disabled={busy === v.id}>✓ Verify → Founding</button>
              <button type="button" className="vipq-no" onClick={() => reject(v)} disabled={busy === v.id}>Reject</button>
            </div>
          </div>
        </div>
      ))}
      {recent.length > 0 && (
        <>
          <div className="crew-group" style={{ marginTop: 12 }}>Recently handled</div>
          {recent.map((v) => (
            <div key={v.id} className="vipq-done">
              <span className="vipq-done-t">{v.customers?.name?.trim() || "A member"}</span>
              <span className={`vipq-tag st-${v.status}`}>{v.status === "verified" ? `✓ Verified${v.reward ? ` · ${v.reward}` : ""}` : "Rejected"}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
