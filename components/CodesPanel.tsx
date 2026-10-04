"use client";

import { useCallback, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { benefitValueText, targetChoices, targetLabel, reachText, reachesNothing, menuPriceOf, KIND_REACH } from "@/lib/benefitText";
import { useBenefitProducts } from "./useBenefitProducts";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { InfoRow } from "@/components/kit";
import { money, moneyPlain } from "@/lib/money";

// DISCOUNT CODES — the owner mints redeemable codes as data (member_benefits, scope='code'). A code
// is a rule: kind (percent_off | price_override | free_refill) × target (whole order, the straight-
// brew family, or one product slug) × value. Customers redeem at the storefront (the code box in the
// order funnel); the server reprices authoritatively via lib/benefits, so a minted code needs no
// deploy. Staff-gated by RLS ("benefits staff write"). Pairs with the tier perks on the customer card.

type Kind = "percent_off" | "price_override" | "free_refill" | "amount_off";
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

// "Applies to" is the menu itself (components/useBenefitProducts), and only what the chosen kind can
// reach (lib/benefitText) — it was a four-item constant here and another in PerksPanel. null = whole order.

export default function CodesPanel() {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);

  // mint form
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<Kind>("percent_off");
  const [target, setTarget] = useState("");
  const [percent, setPercent] = useState("15");
  const [price, setPrice] = useState("8");
  const [amount, setAmount] = useState("5");   // amount_off (0268) — the '$5 off' QR-card kind
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
  const rows = useMemo(() => board.data ?? [], [board.data]);

  // The menu, for "Applies to" — and a target the chosen kind cannot reach is not kept: switching a
  // 15%-off-Tide code to "$ off" lands on the whole order, which is the only place $ off applies.
  const menu = useBenefitProducts();
  const products = menu.data ?? [];
  const choices = targetChoices(kind, products);
  const tgt = choices.some((c) => c.value === target) ? target : "";
  const needsDrink = !KIND_REACH[kind].whole;
  const menuPrice = kind === "price_override" ? menuPriceOf(tgt, products) : null;
  const priceCents = Math.round(Number(price) * 100);

  const codeClean = code.trim().toUpperCase().replace(/\s+/g, "");
  const dupe = useMemo(() => rows.some((r) => (r.code ?? "").toUpperCase() === codeClean), [rows, codeClean]);

  const dollarsToCents = (v: string | number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n * 100) : null;
  };
  const autoLabel = () => {
    // Both halves come from the one describer (lib/benefitText). Written out twice, this branch and
    // PerksPanel's drifted the same way valueText did.
    return `${benefitValueText({ kind, percent: Number(percent), value_cents: dollarsToCents(kind === "amount_off" ? amount : price) })} · ${targetLabel(tgt, products)}`;
  };

  const mint = async () => {
    if (!supabase) return;
    if (!codeClean) { toast("Give the code a name (e.g. WELCOME15)", "error"); return; }
    if (dupe) { toast("That code already exists", "error"); return; }
    if (kind === "percent_off" && (!Number(percent) || Number(percent) < 1 || Number(percent) > 100)) { toast("Percent must be 1–100", "error"); return; }
    if (kind === "price_override" && !(Number(price) >= 0)) { toast("Enter a valid price", "error"); return; }
    if (kind === "price_override" && !tgt) { toast("Set-price codes need a product target", "error"); return; }
    if (kind === "amount_off" && !(Number(amount) > 0)) { toast("Enter the $ off (e.g. 5)", "error"); return; }
    setSaving(true);
    const row = {
      scope: "code" as const, code: codeClean, tier: null,
      kind, target: tgt || null,
      value_cents: kind === "price_override" ? Math.round(Number(price) * 100) : kind === "amount_off" ? Math.round(Number(amount) * 100) : null,
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

  const valueText = (r: CodeRow) => benefitValueText(r);
  // Every code has a printable QR target (/c/CODE, 0268) — scans count themselves in the coupon
  // funnel, and the landing routes by what the code is TODAY, so printed cards never go stale.
  const copyQr = async (r: CodeRow) => {
    const url = `${typeof window !== "undefined" ? window.location.origin : "https://app.gt3pb.com"}/c/${encodeURIComponent(r.code ?? "")}`;
    try { await navigator.clipboard.writeText(url); toast("QR link copied — point the printed QR here"); }
    catch { toast(url); }
  };
  // Where it applies — and, for a code on file that applies nowhere, why (lib/benefitText.reachesNothing).
  const targetText = (r: CodeRow) => {
    const why = reachesNothing(r.kind, r.target, menu.data);
    return <>{targetLabel(r.target, products)}{why && <span className="codes-warn">{` · ${why}`}</span>}</>;
  };

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
                <option value="amount_off">$ off the order</option>
                <option value="price_override">Set a price</option>
                <option value="free_refill">Free</option>
              </select>
            </label>
          </div>
          <div className="codes-row">
            <label className="codes-f">
              <span>Applies to</span>
              <select className="auth-input" value={tgt} onChange={(e) => setTarget(e.target.value)} aria-label="Applies to">
                {needsDrink && <option value="" disabled>Choose the drink…</option>}
                {choices.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                <span>{menuPrice ? `Price ($) — menu ${menuPrice.low === menuPrice.high ? money(menuPrice.low) : `${money(menuPrice.low)}–${money(menuPrice.high)}`}` : "Price ($)"}</span>
                <input className="auth-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} placeholder={menuPrice ? moneyPlain(menuPrice.low) : "8"} aria-label="Set price in dollars" />
              </label>
            )}
            {kind === "amount_off" && (
              <label className="codes-f">
                <span>$ off</span>
                <input className="auth-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="5" aria-label="Dollars off the order" />
              </label>
            )}
          </div>
          <p className="codes-reach">{reachText(kind, tgt, products)}</p>
          {menu.status === "error" && <p className="codes-warn">{`Couldn't read the menu — ${menu.error?.message ?? "no answer"}. A single drink can be chosen once it loads.`}</p>}
          {menuPrice && Number.isFinite(priceCents) && price.trim() !== "" && priceCents >= menuPrice.high && (
            <p className="codes-warn">{`That isn't below the menu price (${money(menuPrice.high)}), so the code would change nothing.`}</p>
          )}
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
                    <span className="codes-trail">
                      <button type="button" className="codes-qr" onClick={() => copyQr(r)} aria-label={`Copy QR link for ${r.code}`}>QR ⧉</button>
                      <button type="button" className={`codes-toggle${r.active ? " on" : ""}`} onClick={() => toggle(r)} role="switch" aria-checked={r.active} aria-label={`${r.code} ${r.active ? "active" : "paused"}`}>
                        {r.active ? "Active" : "Paused"}
                      </button>
                    </span>
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
