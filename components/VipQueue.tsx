"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStable } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { canOf } from "@/lib/roles";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";
import Icon from "@/components/Icon";
import { RecordLink } from "./RecordSheet";
import PromptSheet from "./PromptSheet";
import { SectionHeader } from "@/components/kit";
import { wrote } from "@/lib/wrote";
import { failureWords, plainFailure } from "@/lib/failureWords";
import { downloadCsv } from "@/lib/csv";

// VIP QUEUE — the staff moderation side of VIP verification. A bottle owner's proof photo lands here;
// staff either Reject with a reason, or Verify and choose which grant it earns — plain Founding, or
// Founding VIP (0251: the two are staff's call per-proof, not an automatic package deal) — with a
// reward note either way. Mirrors the reviews-moderation pattern. Reads vip_verifications (0203).
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "no proofs waiting 🟢".
type Vip = {
  id: string; user_id: string; customer_id: string | null; photo_url: string;
  status: string; reward: string | null; note: string | null; created_at: string;
  granted_tier: "founding" | "founding_vip" | null;
  customers: { name: string | null; tier: string } | null;
};
type VipBoard = { rows: Vip[]; signed: Record<string, string> };

export default function VipQueue() {
  const { toast } = useAppStable();
  const { user, profile } = useAuth();
  // Verifying a proof grants Founding (or Founding VIP), and a tier is an admin's or the owner's (0392, A1 of the
  // account audit). The rest of the crew still sees the queue and turns a proof down; the database holds the line.
  const canVerify = canOf(profile).admin;
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const loader = useCallback(async (): Promise<VipBoard> => {
    if (!supabase) return { rows: [], signed: {} };
    const { data, error } = await supabase.from("vip_verifications")
      .select("id, user_id, customer_id, photo_url, status, reward, note, created_at, granted_tier, customers(name, tier)")
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

  // Verify/reject each take a short note — a reward to log, or a reason the member sees. Was
  // window.prompt(): unstyled, blocks the page, no cancel-on-tap-outside on mobile. Now a PromptSheet;
  // `asking` holds which flow + which row (+ which grant, for verify) while it's open, the actual
  // write happens in doVerify/doReject once the sheet's onSubmit fires.
  // Two verify outcomes, not one (0251): Ryan — "I should be ask to select founding member or VIP
  // member" / "verification overlaps" — the old flow granted vip_verified on every verify, with no
  // way to accept the proof as plain Founding only. Staff now pick which before the reward note.
  const [asking, setAsking] = useState<{ kind: "verify"; v: Vip; grant: "founding" | "founding_vip" } | { kind: "reject"; v: Vip } | null>(null);

  const doVerify = async (v: Vip, reward: string, grant: "founding" | "founding_vip") => {
    if (!supabase || busy) return;
    setBusy(v.id);
    const { error } = await supabase.from("vip_verifications").update({ status: "verified", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), reward: reward.trim() || null, granted_tier: grant }).eq("id", v.id);
    if (error) { toast(failureWords(error, "Couldn't verify"), "error"); setBusy(null); return; }
    // Promote to Founding either way — VIP is a layer on top of Founding, not a separate tier (0249/
    // 0250), so both outcomes need the tier grant; granted_tier alone decides whether the 0251 trigger
    // also flips vip_verified. Surface a failure — never claim the grant landed when it didn't, or
    // staff + the member both believe perks are live when they aren't.
    const { error: promoErr } = await supabase.rpc("admin_set_customer_tier", { p_user: v.user_id, p_tier: "founding" });
    const label = grant === "founding_vip" ? "Founding VIP" : "Founding";
    toast(promoErr ? `Verified — but promotion to Founding failed: ${plainFailure(promoErr)}. Set their tier by hand.` : `Verified — ${label}`, promoErr ? "error" : undefined);
    setBusy(null); reload();
  };
  const doReject = async (v: Vip, note: string) => {
    if (!supabase || busy) return;
    setBusy(v.id);
    const ok = wrote(await supabase.from("vip_verifications").update({ status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(), note: note.trim() || null }).eq("id", v.id), toast, "Couldn't reject it");
    setBusy(null); if (ok) toast("Rejected"); reload();
  };

  return (
    <>
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the VIP queue" emptyTitle="Nothing here yet">
      {(data) => {
        // R50: search by name or status; the export is the rows shown — never the photo or its storage path.
        const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
        const hit = (v: Vip) => { const hay = `${v.customers?.name ?? ""} ${v.status} ${v.customers?.tier ?? ""}`.toLowerCase(); return terms.every((t) => hay.includes(t)); };
        const allPending = data.rows.filter((r) => r.status === "pending");
        const allRecent = data.rows.filter((r) => r.status !== "pending").slice(0, 8);
        const pending = allPending.filter(hit);
        const recent = allRecent.filter(hit);
        const shown = [...pending, ...recent];
        return (
          <div className="vipq">
            {/* R50: search the proofs, and the rows shown as a file (the console audit's points 2 and 10). */}
            <div className="flex flex-wrap gap-2 items-center mb-2">
              <div className="flex-1 min-w-0">
                <input type="search" className="w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search proofs" aria-label="Search the bottle-owner proofs" enterKeyHint="search" autoComplete="off" />
              </div>
              <button type="button" className="btn-sec btn-sm shrink-0" disabled={!shown.length} onClick={() => void downloadCsv("gt3-vip-proofs.csv", shown.map((v) => ({
                Name: v.customers?.name?.trim() || "A member", Status: v.status, Submitted: v.created_at, "Tier now": v.customers?.tier ?? "guest",
                Granted: v.status === "verified" ? (v.granted_tier === "founding_vip" ? "Founding VIP" : "Founding") : "", Reward: v.reward ?? "",
              })))}>Export CSV</button>
            </div>
            {terms.length > 0 && allPending.length + allRecent.length > 0 && shown.length === 0 ? (
              <p className="vipq-sub">No matches.</p>
            ) : pending.length === 0 ? (
              <EmptyState title="No VIP proofs waiting" />
            ) : pending.map((v) => (
              <div key={v.id} className="vipq-row">
                <a href={photoUrl(v)} target="_blank" rel="noreferrer" className="vipq-photo" style={{ backgroundImage: `url(${photoUrl(v)})` }} aria-label="Open the proof photo full-size" />
                <div className="vipq-main">
                  <b><RecordLink kind="customer" id={v.customer_id}>{v.customers?.name?.trim() || "A member"}</RecordLink></b>
                  <span className="vipq-sub">Submitted {new Date(v.created_at).toLocaleDateString()} · now {v.customers?.tier ?? "guest"}</span>
                  <div className="vipq-acts">
                    {canVerify && <button type="button" className="btn-pri btn-sm" onClick={() => setAsking({ kind: "verify", v, grant: "founding" })} disabled={busy === v.id}><Icon name="check" /> Verify <Icon name="arrowRight" /> Founding</button>}
                    {canVerify && <button type="button" className="btn-sec btn-sm" onClick={() => setAsking({ kind: "verify", v, grant: "founding_vip" })} disabled={busy === v.id}><Icon name="star" /> Verify <Icon name="arrowRight" /> Founding VIP</button>}
                    <button type="button" className="btn-del" onClick={() => setAsking({ kind: "reject", v })} disabled={busy === v.id}>Reject</button>
                    {!canVerify && <span className="vipq-sub">An admin or the owner verifies it.</span>}
                  </div>
                </div>
              </div>
            ))}
            {recent.length > 0 && (
              <>
                <SectionHeader label="Recently handled" />
                {recent.map((v) => (
                  <div key={v.id} className="vipq-done">
                    <span className="vipq-done-t"><RecordLink kind="customer" id={v.customer_id}>{v.customers?.name?.trim() || "A member"}</RecordLink></span>
                    <span className={`k-tag${v.status === "verified" ? " ok" : v.status === "rejected" ? " crit" : ""}`}>{v.status === "verified" ? <><Icon name={v.granted_tier === "founding_vip" ? "star" : "check"} /> {v.granted_tier === "founding_vip" ? "Founding VIP" : "Founding"}{v.reward ? ` · ${v.reward}` : ""}</> : "Rejected"}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      }}
    </AsyncSection>
    {asking && (
      <PromptSheet
        open
        title={asking.kind === "verify" ? `Verify — ${asking.grant === "founding_vip" ? "Founding VIP" : "Founding"} (reward note)` : "Reject — reason for the member"}
        hint={asking.kind === "verify" ? "Optional — shown to the team, not the member." : "The member sees this."}
        placeholder={asking.kind === "verify" ? "free bottle" : "Why?"}
        defaultValue={asking.kind === "verify" ? "free bottle" : ""}
        confirmLabel={asking.kind === "verify" ? "Verify" : "Reject"}
        onCancel={() => setAsking(null)}
        onSubmit={async (val) => {
          const a = asking;
          setAsking(null);
          if (!a) return;
          if (a.kind === "verify") await doVerify(a.v, val, a.grant); else await doReject(a.v, val);
        }}
      />
    )}
    </>
  );
}
