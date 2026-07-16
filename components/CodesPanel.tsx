"use client";

import { useCallback, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";

// DISCOUNT CODES — the owner mints redeemable codes as data (member_benefits, scope='code'). A code
// is a rule: kind (percent_off | price_override | free_refill) × target (whole order, the straight-
// brew family, or one product slug) × value. Customers redeem at the storefront (the code box in the
// order funnel); the server reprices authoritatively via lib/benefits, so a minted code needs no
// deploy. Staff-gated by RLS ("benefits staff write"). Pairs with the tier perks on the customer card.

type Kind = "percent_off" | "price_override" | "free_refill";
type CodeRow = {
  id: string;
  code: string | null;
  kind: Kind;
  target: string | null;
  value_cents: number | null;
  percent: number | null;
  label: string;
  active: boolean;
  created_at: string;
};

// The order-ahead flavors + the "$8 latte" family, offered as quick targets. null = whole order.
const TARGETS: { v: string; label: string }[] = [
  { v: "", label: "Whole order" },
  { v: "straight_brew", label: "Straight brew (Rise/Flow/Dusk)" },
  { v: "maple", label: "Salted Maple Latte" },
  { v: "salted-latte", label: "Latte (bulk)" },
];

const KIND_LABEL: Record<Kind, string> = { percent_off: "% off", price_override: "Set price", free_refill: "Free" };

export default function CodesPanel() {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);

  // mint form
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Kind>("percent_off");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("15");
  const [price, setPrice] = useState("8");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const loader = useCallback(async (): Promise<CodeRow[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("member_benefits")
      .select("id, code, kind, target, value_cents, percent, label, active, created_at")
      .eq("scope", "code").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data as CodeRow[]) ?? [];
  }, []);
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("member_benefits", reload);
  const rows = board.data ?? [];

  const codeClean = code.trim().toUpperCase().replace(/\s+/g, "");
  const dupe = useMemo(() => rows.some((r) => (r.code ?? "").toUpperCase() === codeClean), [rows, codeClean]);

  const autoLabel = () => {
    const tgt = TARGETS.find((t) => t.v === target)?.label ?? "Whole order";
    if (kind === "percent_off") return `${percent}% off · ${tgt}`;
    if (kind === "price_override") return `$${price} · ${tgt}`;
    return `Free · ${tgt}`;
  };

  const mint = async () => {
    if (!supabase) return;
    if (!codeClean) { toast("Give the code a name (e.g. WELCOME15)", "error"); return; }
    if (dupe) { toast("That code already exists", "error"); return; }
    if (kind === "percent_off" && (!Number(percent) || Number(percent) < 1 || Number(percent) > 100)) { toast("Percent must be 1–100", "error"); return; }
    if (kind === "price_override" && !(Number(price) >= 0)) { toast("Enter a valid price", "error"); return; }
    if (kind === "price_override" && !target) { toast("Set-price codes need a product target", "error"); return; }
    setSaving(true);
    const row = {
      scope: "code" as const, code: codeClean, tier: null,
      kind, target: target || null,
      value_cents: kind === "price_override" ? Math.round(Number(price) * 100) : null,
      percent: kind === "percent_off" ? Math.round(Number(percent)) : null,
      label: (label.trim() || autoLabel()), active: true,
    };
    const { error } = await supabase.from("member_benefits").insert(row);
    setSaving(false);
    if (error) { toast(`Couldn't mint — ${error.message}`, "error"); return; }
    toast(`Minted ${codeClean}`);
    setCode(""); setLabel(""); setOpen(false);
    reload();
  };

  const toggle = async (r: CodeRow) => {
    if (!supabase) return;
    const { error } = await supabase.from("member_benefits").update({ active: !r.active }).eq("id", r.id);
    if (error) { toast(`Couldn't update — ${error.message}`, "error"); return; }
    reload();
  };

  const valueText = (r: CodeRow) =>
    r.kind === "percent_off" ? `${r.percent}% off`
    : r.kind === "price_override" ? `$${((r.value_cents ?? 0) / 100).toFixed(2)}`
    : "Free";
  const targetText = (r: CodeRow) => TARGETS.find((t) => t.v === (r.target ?? ""))?.label ?? r.target ?? "Whole order";

  return (
    <div className="codes">
      {/* The <Panel> owns the title now — this is just the lead line + the mint action (cohesion pass). */}
      <div className="codes-head">
        <div className="codes-sub">Mint a redeemable code — customers enter it at checkout, priced live. No deploy.</div>
        <button type="button" className="codes-new" onClick={() => setOpen((v) => !v)}>{open ? "Close" : "+ New code"}</button>
      </div>

      {open && (
        <div className="codes-form">
          <div className="codes-row">
            <label className="codes-f">
              <span>Code</span>
              <input className="auth-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WELCOME15" aria-label="Code" autoCapitalize="characters" />
            </label>
            <label className="codes-f">
              <span>Kind</span>
              <select className="auth-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Discount kind">
                <option value="percent_off">Percent off</option>
                <option value="price_override">Set a price</option>
                <option value="free_refill">Free</option>
              </select>
            </label>
          </div>
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
          {dupe && codeClean && <p className="codes-warn">{codeClean} already exists.</p>}
          {/* The one .btn-pri on this screen (Customers → Loyalty & codes): minting is the only
              action here that writes a new, real, redeemable code — CrmPanel and VipQueue (this
              panel's siblings under sec==="customers") carry none, so this stays the single one. */}
          <button type="button" className="btn-pri" onClick={mint} disabled={saving || !codeClean || dupe}>
            {saving ? "Minting…" : `Mint ${codeClean || "code"}`}
          </button>
        </div>
      )}

      {/* Kit InfoRow replaces the ad-hoc .codes-item/.codes-item-main row (code → name, value badge →
          nameExtra, target → sub). .codes-toggle stays its own bespoke switch, not a .btn-pri/-sec/-ter:
          it's role="switch"/aria-checked, a binary active/paused STATE control, not a commit action —
          same treatment PaymentSettings' .pay-toggle and EventCopilot's .oa-toggle already get. Because
          the toggle is itself an interactive control, the row uses neither onClick nor bodyClick (avoids
          nesting a button in a button) and just renders as plain, non-interactive InfoRow markup, same as
          DropOps' pack rows. The per-row dim-when-paused look (was .codes-item.off{opacity:.55}) is kept
          via inline style on the wrapping div since InfoRow has no className passthrough. No data
          fetching, state, or toggle/mint logic below changed — presentation only. */}
      <AsyncSection state={board} isEmpty={(data) => data.length === 0} emptyTitle="No codes yet" emptySub="Mint one above." errorTitle="Couldn't load codes">
        {(codeRows) => (
          <div className="k-rows">
            {codeRows.map((r) => (
              <div key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                <InfoRow
                  name={<span className="codes-code">{r.code}</span>}
                  nameExtra={<span className="codes-badge">{valueText(r)}</span>}
                  sub={targetText(r)}
                  trailing={
                    <button type="button" className={`codes-toggle${r.active ? " on" : ""}`} onClick={() => toggle(r)} role="switch" aria-checked={r.active} aria-label={`${r.code} ${r.active ? "active" : "paused"}`}>
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
