"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";

// VIP QUEUE — the staff moderation side of VIP verification. A bottle owner's proof photo lands here;
// Verify promotes them to Founding (which auto-grants the founding perks from 0176) with a reward, or
// Reject sends a reason back. Mirrors the reviews-moderation pattern. Reads vip_verifications (0203).
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "no proofs waiting 🟢".
type Vip = {
  id: string; user_id: string; customer_id: string | null; photo_url: string;
  status: string; reward: string | null; note: string | null; created_at: string;
  customers: { name: string | null; tier: string } | null;
};
type VipBoard = { rows: Vip[]; signed: Record<string, string> };

export default function VipQueue() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const loader = useCallback(async (): Promise<VipBoard> => {
    if (!supabase) return { rows: [], signed: {} };
    const { data, error } = await supabase.from("vip_verifications")
      .select("id, user_id, customer_id, photo_url, status, reward, note, created_at, customers(name, tier)")
      .order("created_at", { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    const rows = (data as unknown as Vip[]) ?? [];
    // The vip bucket is private — staff view proofs through short-lived signed URLs. The stored value
    // is the original URL string; the path after /vip/ is the storage key.
    const paths = [...new Set(rows.map((r) => decodeURIComponent((r.photo_url.split("/vip/")[1] ?? ""))).filter(Boolean))];
    const signed: Record<string, string> = {};
    if (paths.length) {
      const { data: s, error: sErr } = await supabase.storage.from("vip").createSignedUrls(paths, 28800);   // 8h — outlives a service shift; realtime re-signs on any queue activity
      if (sErr) throw new Error(sErr.message);
      for (const it of s ?? []) if (it.signedUrl && it.path) signed[it.path] = it.signedUrl;
    }
    return { rows, signed };
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("vip_verifications", reload);
  const photoUrl = (v: Vip) => (board.data?.signed ?? {})[decodeURIComponent(v.photo_url.split("/vip/")[1] ?? "")] ?? v.photo_url;

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
    setBusy(null); reload();
  };
  const reject = async (v: Vip) => {
    if (!supabase || busy) return;
    const note = typeof window !== "undefined" ? window.prompt("Why? (the member sees this)", "") : "";
    if (note === null) return;
    setBusy(v.id);
    await supabase.from("vip_verifications").update({ status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), note: note.trim() || null }).eq("id", v.id);
    setBusy(null); reload();
  };

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the VIP queue" emptyTitle="Nothing here yet">
      {(data) => {
        const pending = data.rows.filter((r) => r.status === "pending");
        const recent = data.rows.filter((r) => r.status !== "pending").slice(0, 8);
        return (
          <div className="vipq">
            {pending.length === 0 ? (
              <EmptyState title="No VIP proofs waiting" />
            ) : pending.map((v) => (
              <div key={v.id} className="vipq-row">
                <a href={photoUrl(v)} target="_blank" rel="noreferrer" className="vipq-photo" style={{ backgroundImage: `url(${photoUrl(v)})` }} aria-label="Open the proof photo full-size" />
                <div className="vipq-main">
                  <b>{v.customers?.name?.trim() || "A member"}</b>
                  <span className="vipq-sub">Submitted {new Date(v.created_at).toLocaleDateString()} · now {v.customers?.tier ?? "guest"}</span>
                  <div className="vipq-acts">
                    <button type="button" className="vipq-yes" onClick={() => verify(v)} disabled={busy === v.id}><Icon name="check" /> Verify <Icon name="arrowRight" /> Founding</button>
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
                    <span className={`vipq-tag st-${v.status}`}>{v.status === "verified" ? <><Icon name="check" /> Verified{v.reward ? ` · ${v.reward}` : ""}</> : "Rejected"}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}
