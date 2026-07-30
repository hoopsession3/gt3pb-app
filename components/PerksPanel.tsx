"use client";

import { useCallback, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Icon from "@/components/Icon";
import { InfoRow } from "@/components/kit";

// FOUNDING PERKS — the tier side of member_benefits (0176), CodesPanel's sibling for the other
// scope. A perk is the same kind of rule a code is (kind × target × value), just keyed to a tier
// instead of a redeemable string — Member or Founding, and within Founding, optionally VIP-only
// (0250: Ryan wants Founding member and Founding VIP to have their own perks, not one shared list).
// requires_vip only makes sense on a Founding-tier row (there's no "Member VIP" anywhere in the
// app — VIP is a proven layer on top of Founding, see 0249/0250), the DB enforces that with a
// CHECK so this UI just disables the option rather than needing to re-validate it. Reuses
// CodesPanel's .codes-* form/list styles on purpose — same "mint a rule as data, no deploy"
// pattern, just a different scope of the same table, so the same visual language applies.

type Kind = "percent_off" | "price_override" | "free_refill";
type Tier = "member" | "founding";
type PerkRow = {
  id: string;
  tier: Tier;
  requires_vip: boolean;
  kind: Kind;
  target: string | null;
  value_cents: number | null;
  percent: number | null;
  label: string;
  active: boolean;
  created_at: string;
};

// Same target vocabulary as CodesPanel — kept as its own small copy rather than a shared import;
// the two panels are independent enough (different scope, different form shape) that sharing four
// lines isn't worth coupling them.
const TARGETS: { v: string; label: string }[] = [
  { v: "", label: "Whole order" },
  { v: "straight_brew", label: "Straight brew (Rise/Flow/Dusk)" },
  { v: "maple", label: "Salted Maple Latte" },
  { v: "salted-latte", label: "Latte (bulk)" },
];

export default function PerksPanel() {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);

  // mint form
  const [tier, setTier] = useState<Tier>("founding");
  const [vip, setVip] = useState(false);
  const [kind, setKind] = useState<Kind>("free_refill");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("15");
  const [price, setPrice] = useState("8");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const loader = useCallback(async (): Promise<PerkRow[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("member_benefits")
      .select("id, tier, requires_vip, kind, target, value_cents, percent, label, active, created_at")
      .eq("scope", "tier").order("tier").order("requires_vip").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as PerkRow[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("member_benefits", reload);

  const autoLabel = () => {
    const tgt = TARGETS.find((t) => t.v === target)?.label ?? "Whole order";
    const who = tier === "founding" ? (vip ? "Founding VIP" : "Founding") : "Member";
    if (kind === "percent_off") return `${who} · ${percent}% off · ${tgt}`;
    if (kind === "price_override") return `${who} · $${price} · ${tgt}`;
    return `${who} · Free · ${tgt}`;
  };

  const mint = async () => {
    if (!supabase) return;
    if (kind === "percent_off" && (!Number(percent) || Number(percent) < 1 || Number(percent) > 100)) { toast("Percent must be 1–100", "error"); return; }
    if (kind === "price_override" && !(Number(price) >= 0)) { toast("Enter a valid price", "error"); return; }
    if (kind === "price_override" && !target) { toast("Set-price perks need a product target", "error"); return; }
    setSaving(true);
    const row = {
      scope: "tier" as const, tier, code: null, requires_vip: tier === "founding" && vip,
      kind, target: target || null,
      value_cents: kind === "price_override" ? Math.round(Number(price) * 100) : null,
      percent: kind === "percent_off" ? Math.round(Number(percent)) : null,
      label: (label.trim() || autoLabel()), active: true,
    };
    const { error } = await supabase.from("member_benefits").insert(row);
    setSaving(false);
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    toast(`Added — ${row.label}`);
    setLabel(""); setOpen(false);
    reload();
  };

  const toggle = async (r: PerkRow) => {
    if (!supabase) return;
    const { error } = await supabase.from("member_benefits").update({ active: !r.active }).eq("id", r.id);
    if (error) { toast(`Couldn't update — ${error.message}`, "error"); return; }
    reload();
  };

  const valueText = (r: PerkRow) =>
    r.kind === "percent_off" ? `${r.percent}% off`
    : r.kind === "price_override" ? `$${((r.value_cents ?? 0) / 100).toFixed(2)}`
    : "Free";
  const targetText = (r: PerkRow) => TARGETS.find((t) => t.v === (r.target ?? ""))?.label ?? r.target ?? "Whole order";
  const whoText = (r: PerkRow) => r.tier === "founding" ? (r.requires_vip ? "Founding VIP" : "Founding") : "Member";

  return (
    <div className="codes">
      <div className="codes-head">
        <div className="codes-sub">Set what each tier gets — Member, Founding, or Founding-VIP-only. Applied live at checkout, no deploy.</div>
        <button type="button" className="codes-new" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "+ New perk"}</button>
      </div>

      {open && (
        <div className="codes-form">
          <div className="codes-row">
            <label className="codes-f">
              <span>Tier</span>
              <select className="auth-input" value={tier} onChange={(e) => { const t = e.target.value as Tier; setTier(t); if (t !== "founding") setVip(false); }} aria-label="Tier">
                <option value="member">Member</option>
                <option value="founding">Founding</option>
              </select>
            </label>
            <label className="codes-f">
              <span>Kind</span>
              <select className="auth-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Perk kind">
                <option value="free_refill">Free</option>
                <option value="percent_off">Percent off</option>
                <option value="price_override">Set a price</option>
              </select>
            </label>
          </div>
          {tier === "founding" && (
            <label className="codes-f" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={vip} onChange={(e) => setVip(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ textTransform: "none", fontSize: 13, letterSpacing: 0, fontFamily: "'Inter'", color: "var(--cream)" }}>
                <Icon name="star" /> Founding VIP only — verified bottle owners, not every Founding member
              </span>
            </label>
          )}
          <div className="codes-row">
            <label className="codes-f">
              <span>Applies to</span>
              <select className="auth-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Applies to">
                {TARGETS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
            {kind === "percent_off" && (
              <label className="codes-f">
                <span>Percent</span>
                <input className="auth-input" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, ""))} placeholder="15" aria-label="Percent off" />
              </label>
            )}
            {kind === "price_override" && (
              <label className="codes-f">
                <span>Price ($)</span>
                <input className="auth-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder="8" aria-label="Set price in dollars" />
              </label>
            )}
          </div>
          <label className="codes-f">
            <span>Label (optional — for you)</span>
            <input className="auth-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={autoLabel()} aria-label="Label" />
          </label>
          <button type="button" className="btn-sec" onClick={mint} disabled={saving}>
            {saving ? "Adding…" : `Add ${tier === "founding" && vip ? "Founding VIP" : tier === "founding" ? "Founding" : "Member"} perk`}
          </button>
        </div>
      )}

      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No perks yet" emptySub="Add one above." errorTitle="Couldn't load perks">
        {(perkRows) => (
          <div className="k-rows">
            {perkRows.map((r) => (
              <div key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                <InfoRow
                  name={<span className="codes-code">{r.requires_vip ? <Icon name="star" /> : null} {whoText(r)}</span>}
                  nameExtra={<span className="codes-badge">{valueText(r)}</span>}
                  sub={`${r.label} · ${targetText(r)}`}
                  trailing={
                    <button type="button" className={`codes-toggle${r.active ? " on" : ""}`} onClick={() => toggle(r)} role="switch" aria-checked={r.active} aria-label={`${whoText(r)} perk ${r.active ? "active" : "paused"}`}>
                      {r.active ? "Active" : "Paused"}
                    </button>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </AsyncSection>
    </div>
  );
}
