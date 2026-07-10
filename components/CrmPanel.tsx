"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";

// The customer book — first reader of the identity spine. Rows are `customers` (canonical,
// resolve_customer-backed): every human who's ever ordered, cup, pickup or delivery, whether or
// not they made an account. Expanding a row reads all_orders (cross-channel by construction) and,
// when the customer holds an account, their loyalty — edited through the same admin_set_member
// RPC the Team roster used when customers were wrongly filed under "Team".
type Customer = {
  id: string;
  user_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
};
type CrmOrder = {
  id: string;
  channel: "cup" | "pickup" | "delivery";
  total_cents: number | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  created_at: string;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const CH_LABEL: Record<CrmOrder["channel"], string> = { cup: "Cup", pickup: "Pickup", delivery: "Delivery" };

function CrmDetail({ c }: { c: Customer }) {
  const { toast } = useApp();
  const [orders, setOrders] = useState<CrmOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pts, setPts] = useState("");
  const [credit, setCredit] = useState("");
  const [founding, setFounding] = useState(false);
  const [hasLoyalty, setHasLoyalty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const [{ data: ords }, prof] = await Promise.all([
        supabase.from("all_orders")
          .select("id, channel, total_cents, payment_status, fulfillment_status, created_at")
          .eq("customer_id", c.id).order("created_at", { ascending: false }).limit(200),
        c.user_id
          ? supabase.from("profiles").select("points, credit_cents, is_founding").eq("id", c.user_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setOrders((ords as CrmOrder[]) ?? []);
      const p = prof.data as { points: number | null; credit_cents: number | null; is_founding: boolean | null } | null;
      if (p) {
        setPts(String(p.points ?? 0));
        setCredit(((p.credit_cents ?? 0) / 100).toFixed(2));
        setFounding(Boolean(p.is_founding));
        setHasLoyalty(true);
      }
      setLoaded(true);
    })();
  }, [c.id, c.user_id]);

  const saveLoyalty = async () => {
    if (!supabase || !c.user_id) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_member", {
      member: c.user_id,
      new_points: Math.max(0, Math.round(Number(pts) || 0)),
      new_credit_cents: Math.max(0, Math.round((Number(credit) || 0) * 100)),
      new_founding: founding,
    });
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast("Loyalty updated");
  };

  const lifetime = orders.filter((o) => o.payment_status === "paid").reduce((s, o) => s + (o.total_cents ?? 0), 0);
  const open = orders.filter((o) => o.payment_status !== "paid" && o.fulfillment_status !== "canceled").reduce((s, o) => s + (o.total_cents ?? 0), 0);

  return (
    <div className="crm-body">
      {!loaded ? (
        <div className="crm-note">Loading history…</div>
      ) : orders.length === 0 ? (
        <div className="crm-note">No orders on record yet.</div>
      ) : (
        <>
          <div className="crm-note" style={{ marginTop: 10 }}>
            {orders.length} order{orders.length === 1 ? "" : "s"} · {money(lifetime)} paid{open > 0 ? ` · ${money(open)} open` : ""}
          </div>
          {orders.slice(0, 12).map((o) => (
            <div className="crm-ord" key={`${o.channel}-${o.id}`}>
              <span className="ch">{CH_LABEL[o.channel]}</span>
              <b>{new Date(o.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</b>
              <span>{o.fulfillment_status ?? "—"}</span>
              <span className="px">{o.total_cents != null ? money(o.total_cents) : "—"}</span>
            </div>
          ))}
        </>
      )}
      {hasLoyalty && (
        <div className="crm-loy">
          <label>Points<input inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value)} /></label>
          <label>Credit $<input inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
          <button type="button" className="note-save" style={{ marginLeft: "auto" }} onClick={saveLoyalty} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      )}
      {loaded && !hasLoyalty && <div className="crm-note">Guest — no account yet, so no loyalty to manage.</div>}
    </div>
  );
}

export default function CrmPanel() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) { setLoaded(true); return; }
    const { data } = await supabase.from("customers")
      .select("id, user_id, name, phone, email, created_at")
      .order("created_at", { ascending: false }).limit(500);
    setRows((data as Customer[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("customers", load);

  const ql = q.trim().toLowerCase();
  const shown = rows.filter((c) =>
    !ql || (c.name ?? "").toLowerCase().includes(ql) || (c.phone ?? "").includes(ql) || (c.email ?? "").toLowerCase().includes(ql)
  );

  return (
    <div className="adm-sec">
      <div className="sec">Customers · {rows.length}</div>
      {rows.length > 5 && (
        <input className="crm-search" placeholder="Search name, phone, or email" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {shown.map((c) => (
        <div className="crm-row" key={c.id}>
          <button type="button" className="crm-head" onClick={() => setOpenId(openId === c.id ? null : c.id)} aria-expanded={openId === c.id}>
            <span className="crm-name">
              <b>{c.name?.trim() || "No name yet"}</b>
              <span>{[c.phone, c.email].filter(Boolean).join(" · ") || "no contact info"}</span>
            </span>
            <span className={`crm-badge${c.user_id ? " member" : ""}`}>{c.user_id ? "Member" : "Guest"}</span>
            <span className={`ev-chev${openId === c.id ? " open" : ""}`} aria-hidden="true">›</span>
          </button>
          {openId === c.id && <CrmDetail c={c} />}
        </div>
      ))}
      {loaded && rows.length === 0 && <div className="h-sub">No customers yet — they appear with their first order.</div>}
      {loaded && rows.length > 0 && shown.length === 0 && <div className="h-sub">No match for &ldquo;{q}&rdquo;.</div>}
    </div>
  );
}
