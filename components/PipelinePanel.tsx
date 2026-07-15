"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { SectionHeader } from "@/components/kit";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { resolveVendor, type ResolveDecision, type VendorMatch } from "@/lib/vendorLink";
import VendorResolve from "./VendorResolve";
import { StrategyThread } from "./StrategyCollab";
import ProposalDesk from "./ProposalDesk";
import CountUp from "./CountUp";

// PIPELINE — the sales funnel (0165). Vendor (the account) × deal (from the owner's catalog,
// gated per vendor type) × rep × stage. The owner articulates what's on the table in the Deal
// catalog; reps can only attach an ACTIVE deal that matches the account's type. Collaboration
// rides the existing engines: per-opportunity threads, rep-assignment pings via the alerts spine.

export const VENDOR_TYPES = ["gym", "corporate", "cafe", "venue", "school", "market", "other"] as const;
const STAGES = [
  { key: "prospect", label: "Prospects" },
  { key: "first_attempt", label: "First attempt" },
  { key: "talking", label: "In conversation" },
  { key: "proposal", label: "Proposal sent" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
] as const;
type Stage = (typeof STAGES)[number]["key"];

type Deal = { id: string; title: string; blurb: string | null; vendor_type: string; price_label: string | null; active: boolean; sort: number; model: string; rate_pct: number | null; monthly_cents: number | null; line: string };

// LINES OF BUSINESS — every deal declares what kind of engagement it is (0168). The board
// filters by line, and a won deal's line is the handoff signal (event → book it, truck_stop →
// add the stop, wholesale → recurring delivery).
export const DEAL_LINES = [
  { key: "truck_stop", label: "Truck stop" },
  { key: "private_event", label: "Private event" },
  { key: "wholesale", label: "Wholesale" },
  { key: "retail", label: "Retail placement" },
  { key: "standing", label: "Standing service" },
  { key: "other", label: "Other" },
] as const;
const lineLabel = (key: string | null | undefined) => DEAL_LINES.find((l) => l.key === key)?.label ?? null;

// The owner's margin rules. When product economics (Money › Product economics, admin-only RLS)
// are readable, the floor computes against REAL unit margins: what does this deal leave per
// dollar after COGS. When they aren't (rep session, or no costed products), the flat give rule
// stands in: never hand more than 20% of revenue to the account.
const MARGIN_FLOOR_GIVE = 20;         // fallback: give ≤ 20% of revenue
const RESIDUAL_MARGIN_FLOOR = 50;     // with COGS: the deal must leave ≥ 50% gross margin
type Econ = { marginPct: number; costed: number } | null;
// Residual gross margin (as % of realized revenue) after the deal's give.
// rev_share r%: we keep (1 - r) of revenue, full cost stays ours → m' = (m - r) / 1
// discount r%: price drops to P(1-r), cost unchanged → m' = 1 - (1 - m)/(1 - r/100)
const residualMargin = (d: Deal, econ: Econ): number | null => {
  if (!econ || d.rate_pct == null) return null;
  const m = econ.marginPct, r = d.rate_pct;
  if (d.model === "rev_share") return Math.round(m - r);
  if (d.model === "discount") return r >= 100 ? -100 : Math.round(100 * (1 - (1 - m / 100) / (1 - r / 100)));
  return null;
};
const DEAL_MODELS = [
  { key: "rev_share", label: "Revenue share", hint: "they take a % of sales" },
  { key: "discount", label: "Discount", hint: "% off list for the account" },
  { key: "monthly", label: "Monthly", hint: "they pay a flat monthly" },
  { key: "flat", label: "Flat", hint: "one-time amount" },
  { key: "custom", label: "Custom", hint: "free-text terms" },
] as const;
const dealTerms = (d: Deal): string => {
  if (d.model === "rev_share" && d.rate_pct != null) return `${d.rate_pct}% to them · we keep ${100 - d.rate_pct}%`;
  if (d.model === "discount" && d.rate_pct != null) return `${d.rate_pct}% off list`;
  if ((d.model === "monthly" || d.model === "flat") && d.monthly_cents != null) return `$${(d.monthly_cents / 100).toLocaleString()}${d.model === "monthly" ? "/mo" : " flat"}`;
  return d.price_label ?? "";
};
const dealGive = (d: Deal): number | null => (d.model === "rev_share" || d.model === "discount") ? d.rate_pct : null;
const belowFloor = (d: Deal, econ: Econ): boolean => {
  const res = residualMargin(d, econ);
  if (res != null) return res < RESIDUAL_MARGIN_FLOOR;           // real-COGS rule
  const g = dealGive(d); return g != null && g > MARGIN_FLOOR_GIVE; // fallback flat rule
};
type Vendor = { id: string; name: string; vendor_type: string | null; archived_at?: string | null };
type Opp = {
  id: string; vendor_id: string; deal_id: string | null; rep_id: string | null; stage: Stage;
  value_cents: number | null; next_step: string | null; next_step_at: string | null;
  lost_reason: string | null; created_at: string;
  vendors: { name: string; vendor_type: string | null } | null;
  deals: { title: string; line?: string | null } | null;
};
type Staff = { id: string; display_name: string | null };

const money = (c: number | null) => (c == null ? "" : `$${(c / 100).toLocaleString()}`);

// Live ROI what-if — sits inside the New Deal form so you can feel a % before you commit it. Drag the
// cut and an editable monthly volume and it shows the real dollar split + what it leaves you in margin
// against the floor. Pure/derived — reads the same residualMargin + belowFloor rules the saved deal
// will be judged by, so "what 10% looks like" here is exactly what it'll be once it's on the table.
function DealRoi({ model, rate, econ, vol, setVol }: { model: string; rate: number; econ: Econ; vol: number; setVol: (s: string) => void }) {
  const share = model === "rev_share";
  const theirs = Math.round(vol * rate / 100);
  const ours = Math.max(0, vol - theirs);
  const keepPct = Math.max(0, Math.min(100, 100 - rate));
  const residual = residualMargin({ model, rate_pct: rate } as Deal, econ);
  const below = rate > 0 && belowFloor({ model, rate_pct: rate } as Deal, econ);
  return (
    <div className={`roi${below ? " below" : ""}`}>
      <div className="roi-h">
        <span>What {rate || 0}% looks like</span>
        <label className="roi-vol">on&nbsp;$<input inputMode="decimal" value={String(vol)} onChange={(e) => setVol(e.target.value)} aria-label="Estimated monthly volume" />/mo</label>
      </div>
      <div className="roi-bar" role="img" aria-label={`You keep ${keepPct}%, ${share ? "they take" : "they save"} ${rate}%`}>
        <span className="roi-you" style={{ width: `${keepPct}%` }} />
        <span className="roi-them" style={{ width: `${Math.max(0, Math.min(100, rate))}%` }} />
      </div>
      <div className="roi-split">
        <span><b>${ours.toLocaleString()}</b> you keep</span>
        <span><b>${theirs.toLocaleString()}</b> {share ? "to them" : "they save"}</span>
      </div>
      <div className={`roi-margin ${below ? "bad" : "ok"}`}>
        {residual != null
          ? `Leaves ${residual}% gross margin — ${below ? `under the ${RESIDUAL_MARGIN_FLOOR}% floor` : "clears the floor"}`
          : below ? `Give is ${rate}% — over the ${MARGIN_FLOOR_GIVE}% cap` : `Give is ${rate}% of revenue — within the ${MARGIN_FLOOR_GIVE}% cap`}
      </div>
    </div>
  );
}

export default function PipelinePanel({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const [opps, setOpps] = useState<Opp[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);   // expanded opportunity
  const [oppNotes, setOppNotes] = useState<{ id: string; title: string; met_on: string; visibility?: string }[]>([]);
  useEffect(() => {
    if (!openId || !supabase) { setOppNotes([]); return; }
    supabase.from("meeting_notes").select("id, title, met_on, visibility").eq("opportunity_id", openId)
      .order("met_on", { ascending: false }).limit(8)
      .then(({ data }) => setOppNotes((data as typeof oppNotes) ?? []));
  }, [openId]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resolve, setResolve] = useState<{ name: string; candidates: VendorMatch[] } | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [econ, setEcon] = useState<Econ>(null);
  const [lineFilter, setLineFilter] = useState<string>("all");
  // Reps open on THEIR accounts (managers see the whole board) — "work your accounts" needs a view,
  // not a scan of everyone's cards.
  const [mineOnly, setMineOnly] = useState(!isAdmin);
  const [no, setNo] = useState({ vendorId: "", newVendor: "", newType: "gym", dealId: "", repId: "", value: "", nextStep: "" });
  const [nd, setNd] = useState({ title: "", vendor_type: "gym", price_label: "", blurb: "", model: "rev_share", rate: "", amount: "", line: "wholesale" });
  const [roiVol, setRoiVol] = useState("1000");   // the "play with it" monthly-volume assumption for the live ROI card
  const [editId, setEditId] = useState<string | null>(null);    // deal being edited in the catalog
  const [ed, setEd] = useState({ title: "", vendor_type: "gym", price_label: "", blurb: "", model: "rev_share", rate: "", amount: "", line: "wholesale" });

  const load = useCallback(async () => {
    if (!supabase) return;
    const [o, d, v, st] = await Promise.all([
      supabase.from("opportunities").select("id, vendor_id, deal_id, rep_id, stage, value_cents, next_step, next_step_at, lost_reason, created_at, vendors(name, vendor_type), deals(title, line)").order("created_at", { ascending: false }),
      supabase.from("deals").select("id, title, blurb, vendor_type, price_label, active, sort, model, rate_pct, monthly_cents, line").order("sort").order("created_at"),
      supabase.from("vendors").select("id, name, vendor_type, archived_at").is("archived_at", null).order("name"),
      supabase.from("profiles").select("id, display_name").neq("role", "member").order("display_name"),
    ]);
    if (o.data) setOpps(o.data as unknown as Opp[]);
    if (d.data) setDeals(d.data as Deal[]);
    if (v.data) setVendors(v.data as Vendor[]);
    if (st.data) setStaff(st.data as Staff[]);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("product_economics").select("price_cents, unit_cost_cents, active").then(({ data }) => {
      const rows = ((data ?? []) as { price_cents: number; unit_cost_cents: number | null; active: boolean }[])
        .filter((r) => r.active && r.price_cents > 0 && r.unit_cost_cents != null);
      if (!rows.length) return; // admin-only table or nothing costed → the flat give rule stands in
      const marginPct = Math.round(100 * rows.reduce((s, r) => s + (r.price_cents - (r.unit_cost_cents as number)) / r.price_cents, 0) / rows.length);
      setEcon({ marginPct, costed: rows.length });
    });
  }, []);
  useRealtimeTable(["opportunities", "deals", "vendors"], load);

  const firstName = (uid: string | null) => (staff.find((s) => s.id === uid)?.display_name || "").trim().split(/\s+/)[0] || null;
  // Milestones write into the opportunity's thread (comments + strategy_key — dated, attributed),
  // so a rep's notes and the stage history read as ONE chronological pursuit record.
  const logActivity = (oppId: string, body: string) => {
    if (!supabase || !user) return;
    supabase.from("comments").insert({ strategy_key: `opp:${oppId}`, body, author_id: user.id }).then(() => loadActivity());
  };
  const [activity, setActivity] = useState<Record<string, { n: number; lastAt: string; lastBy: string | null }>>({});
  const loadActivity = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("comments").select("strategy_key, created_at, author_id")
      .like("strategy_key", "opp:%").order("created_at", { ascending: false }).limit(400);
    const m: Record<string, { n: number; lastAt: string; lastBy: string | null }> = {};
    for (const r of ((data ?? []) as { strategy_key: string; created_at: string; author_id: string | null }[])) {
      const k = r.strategy_key.slice(4);
      if (!m[k]) m[k] = { n: 0, lastAt: r.created_at, lastBy: r.author_id };
      m[k].n++;
    }
    setActivity(m);
  }, []);
  useEffect(() => { loadActivity(); }, [loadActivity]);
  const patch = async (id: string, p: Record<string, unknown>) => {
    if (!supabase) return;
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } as Opp : o)));
    const { error } = await supabase.from("opportunities").update({ ...p, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); }
  };

  const setStage = async (o: Opp, stage: Stage) => {
    const p: Record<string, unknown> = { stage };
    if (stage === "won") p.won_at = new Date().toISOString();
    if (stage === "lost") { p.lost_at = new Date().toISOString(); const r = typeof window !== "undefined" ? window.prompt("What lost it? (one line, for the record)") : null; if (r?.trim()) p.lost_reason = r.trim(); }
    await patch(o.id, p);
    const label = STAGES.find((s) => s.key === stage)?.label ?? stage;
    logActivity(o.id, `→ ${label}${stage === "lost" && p.lost_reason ? ` — ${p.lost_reason}` : ""}`);
    if (stage === "won") {
      const line = o.deals?.line;
      toast(line === "wholesale" || line === "standing" ? "Won — nice. Set up the recurring delivery in Live Ops › Delivery."
        : line === "truck_stop" ? "Won — nice. Add the location in Route when dates land."
        : "Won — nice. Book it in Plan › Events when dates land.");
    }
  };

  const assignRep = async (o: Opp, uid: string) => {
    await patch(o.id, { rep_id: uid || null });
    logActivity(o.id, uid ? `→ assigned to ${firstName(uid) ?? "a rep"}` : "→ unassigned");
    if (uid && uid !== user?.id) {
      raiseAlertClient({ severity: "important", category: "booking", title: `Pipeline: ${o.vendors?.name ?? "an account"} is yours`.slice(0, 140), body: o.deals?.title ? `Deal: ${o.deals.title}` : "Pick the deal and make first contact.", link: "/crew?s=pipeline", targetUserId: uid });
    }
  };

  // Reps can only attach an ACTIVE deal that matches the account's vendor type — the owner's gate.
  const dealsFor = (vendorType: string | null | undefined) => deals.filter((d) => d.active && (!vendorType || d.vendor_type === vendorType));

  const addOpp = async (decision?: ResolveDecision) => {
    if (!supabase || !user) return;
    let vendorId = no.vendorId;
    if (!vendorId && no.newVendor.trim()) {
      // ONE resolver (0226): a look-alike account name pauses and asks instead of minting a copy.
      const r = await resolveVendor(no.newVendor.trim(), { status: "approved", vendorType: no.newType, source: "the pipeline", decision });
      if (r.kind === "similar") { setResolve({ name: no.newVendor.trim(), candidates: r.candidates }); return; }
      if (r.kind === "error") { toast(`Couldn't add the account — ${r.message}`, "error"); return; }
      vendorId = r.id;
    }
    if (!vendorId) { toast("Pick an account or add a new one", "error"); return; }
    const { error } = await supabase.from("opportunities").insert({
      vendor_id: vendorId, deal_id: no.dealId || null, rep_id: no.repId || null,
      value_cents: no.value ? Math.round(Number(no.value) * 100) : null,
      next_step: no.nextStep.trim() || null, created_by: user.id,
    });
    if (error) { toast(`Couldn't add — ${error.message}`, "error"); return; }
    if (no.repId && no.repId !== user.id) {
      const vn = vendors.find((v) => v.id === vendorId)?.name ?? no.newVendor;
      raiseAlertClient({ severity: "important", category: "booking", title: `Pipeline: ${vn} is yours`.slice(0, 140), body: "New opportunity — make first contact.", link: "/crew?s=pipeline", targetUserId: no.repId });
    }
    setAdding(false); setNo({ vendorId: "", newVendor: "", newType: "gym", dealId: "", repId: "", value: "", nextStep: "" });
    toast("On the board"); load();
  };

  const addDeal = async () => {
    if (!supabase || !nd.title.trim()) return;
    const rate = nd.rate ? Number(nd.rate) : null;
    const amount = nd.amount ? Math.round(Number(nd.amount) * 100) : null;
    const { error } = await supabase.from("deals").insert({
      title: nd.title.trim(), vendor_type: nd.vendor_type, model: nd.model, line: nd.line,
      rate_pct: (nd.model === "rev_share" || nd.model === "discount") ? rate : null,
      monthly_cents: (nd.model === "monthly" || nd.model === "flat") ? amount : null,
      price_label: nd.price_label.trim() || null, blurb: nd.blurb.trim() || null, sort: deals.length,
    });
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    if (rate != null) {
      const res = econ ? residualMargin({ model: nd.model, rate_pct: rate } as Deal, econ) : null;
      if (res != null && res < RESIDUAL_MARGIN_FLOOR) toast(`Heads up — that leaves ≈${res}% gross margin, below the ${RESIDUAL_MARGIN_FLOOR}% floor`, "error");
      else if (res == null && rate > MARGIN_FLOOR_GIVE) toast(`Heads up — that gives away ${rate}%, past the 80% margin floor`, "error");
    }
    setNd({ title: "", vendor_type: "gym", price_label: "", blurb: "", model: "rev_share", rate: "", amount: "", line: "wholesale" });
    toast("Deal's on the table"); load();
  };
  const toggleDeal = async (d: Deal) => {
    if (!supabase) return;
    setDeals((prev) => prev.map((x) => (x.id === d.id ? { ...x, active: !d.active } : x)));
    const { error } = await supabase.from("deals").update({ active: !d.active, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (error) toast(`Couldn't save — ${error.message}`, "error");
    load();
  };

  const openEditDeal = (d: Deal) => {
    if (editId === d.id) { setEditId(null); return; }
    setEditId(d.id);
    setEd({
      title: d.title, vendor_type: d.vendor_type, price_label: d.price_label ?? "", blurb: d.blurb ?? "",
      model: d.model, rate: d.rate_pct != null ? String(d.rate_pct) : "", amount: d.monthly_cents != null ? String(d.monthly_cents / 100) : "",
      line: d.line || "other",
    });
  };

  const saveDeal = async () => {
    if (!supabase || !editId || !ed.title.trim()) return;
    const rate = ed.rate ? Number(ed.rate) : null;
    const amount = ed.amount ? Math.round(Number(ed.amount) * 100) : null;
    const fields = {
      title: ed.title.trim(), vendor_type: ed.vendor_type, model: ed.model, line: ed.line,
      rate_pct: (ed.model === "rev_share" || ed.model === "discount") ? rate : null,
      monthly_cents: (ed.model === "monthly" || ed.model === "flat") ? amount : null,
      price_label: ed.price_label.trim() || null, blurb: ed.blurb.trim() || null,
    };
    setDeals((prev) => prev.map((x) => (x.id === editId ? { ...x, ...fields } : x)));
    const { error } = await supabase.from("deals").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", editId);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); load(); return; }
    if (fields.rate_pct != null) {
      const res = econ ? residualMargin({ model: fields.model, rate_pct: fields.rate_pct } as Deal, econ) : null;
      if (res != null && res < RESIDUAL_MARGIN_FLOOR) toast(`Heads up — that leaves ≈${res}% gross margin, below the ${RESIDUAL_MARGIN_FLOOR}% floor`, "error");
      else if (res == null && fields.rate_pct > MARGIN_FLOOR_GIVE) toast(`Heads up — that gives away ${fields.rate_pct}%, past the 80% margin floor`, "error");
    }
    setEditId(null);
    toast("Deal updated"); load();
  };

  const deleteDeal = async (d: Deal) => {
    if (!supabase) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this deal from the table? Opportunities that used it keep their record.")) return;
    if (editId === d.id) setEditId(null);
    setDeals((prev) => prev.filter((x) => x.id !== d.id));
    const { error } = await supabase.from("deals").delete().eq("id", d.id);
    if (error) toast(`Couldn't remove — ${error.message}`, "error");
    else toast("Off the table");
    load();
  };

  // Swap sort with the neighbor inside the same vendor-type group. If the two sorts happen to
  // match (legacy rows), fall back to the list positions so the swap actually holds.
  const moveDeal = async (d: Deal, dir: -1 | 1) => {
    if (!supabase) return;
    const group = deals.filter((x) => x.vendor_type === d.vendor_type);
    const i = group.findIndex((x) => x.id === d.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const other = group[j];
    const mySort = d.sort === other.sort ? j : other.sort;
    const theirSort = d.sort === other.sort ? i : d.sort;
    setDeals((prev) => {
      const next = [...prev];
      const pi = next.findIndex((x) => x.id === d.id);
      const pj = next.findIndex((x) => x.id === other.id);
      if (pi < 0 || pj < 0) return prev;
      next[pi] = { ...other, sort: theirSort };
      next[pj] = { ...d, sort: mySort };
      return next;
    });
    const stamp = new Date().toISOString();
    const [a, b] = await Promise.all([
      supabase.from("deals").update({ sort: mySort, updated_at: stamp }).eq("id", d.id),
      supabase.from("deals").update({ sort: theirSort, updated_at: stamp }).eq("id", other.id),
    ]);
    if (a.error || b.error) toast(`Couldn't reorder — ${(a.error ?? b.error)!.message}`, "error");
    load();
  };

  const newVendorType = no.vendorId ? (vendors.find((v) => v.id === no.vendorId)?.vendor_type ?? null) : no.newType;
  const openOpps = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const mineCount = openOpps.filter((o) => o.rep_id === user?.id).length;
  const wonValue = opps.filter((o) => o.stage === "won").reduce((s, o) => s + (o.value_cents ?? 0), 0);
  const overdue = (o: Opp) => o.next_step_at && o.next_step_at < new Date().toISOString().slice(0, 10) && o.stage !== "won" && o.stage !== "lost";

  const card = (o: Opp) => (
    <div key={o.id} className={`pipe-card${overdue(o) ? " late" : ""}`}>
      <button type="button" className="pipe-head" onClick={() => setOpenId(openId === o.id ? null : o.id)} aria-expanded={openId === o.id}>
        <span className="pipe-name"><b>{o.vendors?.name ?? "Account"}</b>{o.vendors?.vendor_type && <i className="pipe-type">{o.vendors.vendor_type}</i>}</span>
        <span className="pipe-meta">
          {o.deals?.title ? <span className="pipe-deal">{o.deals.title}{lineLabel(o.deals.line) ? ` · ${lineLabel(o.deals.line)}` : ""}</span> : <span className="pipe-deal none">no deal attached</span>}
          {o.value_cents != null && <span className="pipe-val">{money(o.value_cents)}</span>}
          {o.rep_id && <span className="pipe-rep">{firstName(o.rep_id)}</span>}
        </span>
        <span className={`ev-chev${openId === o.id ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {activity[o.id] && openId !== o.id && (
        <div className="pipe-trail">💬 {activity[o.id].n} · last {new Date(activity[o.id].lastAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{firstName(activity[o.id].lastBy) ? ` · ${firstName(activity[o.id].lastBy)}` : ""}</div>
      )}
      {(o.next_step || overdue(o)) && openId !== o.id && (
        <div className="pipe-next">{overdue(o) ? "⚠ " : "→ "}{o.next_step ?? "next step overdue"}{o.next_step_at ? ` · ${new Date(`${o.next_step_at}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</div>
      )}
      {openId === o.id && (
        <div className="pipe-body">
          <div className="pipe-grid">
            <label>Stage
              <select value={o.stage} onChange={(e) => setStage(o, e.target.value as Stage)}>
                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label>Rep
              <select value={o.rep_id ?? ""} onChange={(e) => assignRep(o, e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
              </select>
            </label>
            <label>Deal <i>(for {o.vendors?.vendor_type ?? "this type"})</i>
              <select value={o.deal_id ?? ""} onChange={(e) => patch(o.id, { deal_id: e.target.value || null })}>
                <option value="">None yet</option>
                {dealsFor(o.vendors?.vendor_type).map((d) => <option key={d.id} value={d.id}>{d.title}{dealTerms(d) ? ` · ${dealTerms(d)}` : ""}</option>)}
              </select>
            </label>
            <label>Value $
              <input inputMode="decimal" defaultValue={o.value_cents != null ? String(o.value_cents / 100) : ""} onBlur={(e) => patch(o.id, { value_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} placeholder="500" />
            </label>
            <label>Next step
              <input defaultValue={o.next_step ?? ""} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== o.next_step) { patch(o.id, { next_step: v }); if (v) logActivity(o.id, `→ next: ${v}`); } }} placeholder="Call back Tuesday, send the one-pager…" />
            </label>
            <label>By
              <input type="date" value={o.next_step_at ?? ""} onChange={(e) => patch(o.id, { next_step_at: e.target.value || null })} />
            </label>
          </div>
          {o.stage === "lost" && o.lost_reason && <div className="pipe-lost">Lost: {o.lost_reason}</div>}
          {oppNotes.length > 0 && (
            <div className="pipe-notes">
              <b>Notes</b>
              {oppNotes.map((n) => (
                <span key={n.id} className="pipe-note">📝 {n.title} · {new Date(n.met_on + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}{n.visibility === "private" ? " · 🔒" : n.visibility === "team" ? " · 👥" : ""}</span>
              ))}
            </div>
          )}
          <ProposalDesk oppId={o.id} vendorName={o.vendors?.name ?? null} isAdmin={isAdmin} />
          <button type="button" className="st-discuss" onClick={() => setThreadId(threadId === o.id ? null : o.id)} aria-expanded={threadId === o.id}>💬 {threadId === o.id ? "Close" : "Discuss"}</button>
          {threadId === o.id && <StrategyThread k={`opp:${o.id}`} label={`Pipeline: ${o.vendors?.name ?? "opportunity"}`} link="/crew?s=pipeline" />}
        </div>
      )}
    </div>
  );

  return (
    <div className="adm-sec">
      <SectionHeader label="Pipeline" annotation={openOpps.length > 0 ? `${openOpps.length} open` : "the leads"} />
      <p className="h-sub" style={{ marginBottom: 12 }}>Every account, its deal, its rep, its next step. Won so far: <b><CountUp cents={wonValue} /></b>.</p>

      {/* The owner's table — what reps are allowed to offer, per account type. */}
      {isAdmin && (
        <>
          <button type="button" className="prep-collapse" onClick={() => setCatalogOpen((v) => !v)} aria-expanded={catalogOpen}>
            <span className="prep-collapse-l"><b>🗂 Deal catalog · {deals.filter((d) => d.active).length} live · {deals.filter((d) => !d.active).length} off</b><span>what reps can offer — per account type; inactive deals disappear from their pickers</span></span>
            <span className={`ev-chev${catalogOpen ? " open" : ""}`}>›</span>
          </button>
          {catalogOpen && (
            <div className="pipe-catalog">
              {VENDOR_TYPES.filter((t) => deals.some((d) => d.vendor_type === t)).map((t) => (
                <div key={t}>
                  <div className="dv-sub" style={{ margin: "8px 0 4px", textTransform: "capitalize" }}>{t}</div>
                  {deals.filter((d) => d.vendor_type === t).map((d, i, group) => (
                    <Fragment key={d.id}>
                      <div className={`pipe-dealrow${d.active ? "" : " off"}`}>
                        <button type="button" className="pipe-dealrow-t" onClick={() => openEditDeal(d)} aria-expanded={editId === d.id}><b>{d.title}</b>{lineLabel(d.line) && <em className="pipe-line">{lineLabel(d.line)}</em>}{dealTerms(d) && ` · ${dealTerms(d)}`}{(() => { const res = residualMargin(d, econ); return res != null ? ` · leaves ≈${res}% margin` : ""; })()}{belowFloor(d, econ) && <span className="pipe-floor">below the margin floor</span>}{d.blurb && <i> — {d.blurb}</i>}</button>
                        <span className="pipe-ordwrap">
                          <button type="button" className="pipe-ord" onClick={() => moveDeal(d, -1)} disabled={i === 0} aria-label={`Move ${d.title} up`}>↑</button>
                          <button type="button" className="pipe-ord" onClick={() => moveDeal(d, 1)} disabled={i === group.length - 1} aria-label={`Move ${d.title} down`}>↓</button>
                        </span>
                        <button type="button" className="lane-pin" onClick={() => toggleDeal(d)}>{d.active ? "Live" : "Off"}</button>
                        <button type="button" className="pipe-del" onClick={() => deleteDeal(d)} aria-label={`Remove ${d.title}`}>✕</button>
                      </div>
                      {editId === d.id && (
                        <div className="pipe-dealedit">
                          <div className="pipe-grid">
                            <label>Title<input value={ed.title} onChange={(e) => setEd({ ...ed, title: e.target.value })} maxLength={80} /></label>
                            <label>For
                              <select value={ed.vendor_type} onChange={(e) => setEd({ ...ed, vendor_type: e.target.value })}>
                                {VENDOR_TYPES.map((vt) => <option key={vt} value={vt}>{vt}</option>)}
                              </select>
                            </label>
                            <label>Model
                              <select value={ed.model} onChange={(e) => setEd({ ...ed, model: e.target.value })}>
                                {DEAL_MODELS.map((m) => <option key={m.key} value={m.key}>{m.label} — {m.hint}</option>)}
                              </select>
                            </label>
                            <label>Line of business
                              <select value={ed.line} onChange={(e) => setEd({ ...ed, line: e.target.value })}>
                                {DEAL_LINES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                              </select>
                            </label>
                            {(ed.model === "rev_share" || ed.model === "discount") && (
                              <label>{ed.model === "rev_share" ? "Their cut %" : "Discount %"} <i>{ed.rate && Number(ed.rate) > MARGIN_FLOOR_GIVE ? "— below the 80% floor" : ed.model === "rev_share" && ed.rate ? `— we keep ${100 - Number(ed.rate)}%` : ""}</i>
                                <input inputMode="decimal" value={ed.rate} onChange={(e) => setEd({ ...ed, rate: e.target.value })} placeholder="10" />
                              </label>
                            )}
                            {(ed.model === "monthly" || ed.model === "flat") && (
                              <label>{ed.model === "monthly" ? "$ / month" : "Flat $"}<input inputMode="decimal" value={ed.amount} onChange={(e) => setEd({ ...ed, amount: e.target.value })} placeholder="500" /></label>
                            )}
                            {ed.model === "custom" && (
                              <label>Terms<input value={ed.price_label} onChange={(e) => setEd({ ...ed, price_label: e.target.value })} placeholder="Describe the structure" maxLength={40} /></label>
                            )}
                            <label>One-liner<input value={ed.blurb} onChange={(e) => setEd({ ...ed, blurb: e.target.value })} placeholder="What the account gets" maxLength={120} /></label>
                          </div>
                          <div className="st-log-btns">
                            <button type="button" className="dops-mini" onClick={saveDeal} disabled={!ed.title.trim()}>Save changes</button>
                            <button type="button" className="st-discuss" onClick={() => setEditId(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </Fragment>
                  ))}
                </div>
              ))}
              <div className="pipe-grid" style={{ marginTop: 10 }}>
                <label>New deal<input value={nd.title} onChange={(e) => setNd({ ...nd, title: e.target.value })} placeholder="Gym fridge partnership" maxLength={80} /></label>
                <label>For
                  <select value={nd.vendor_type} onChange={(e) => setNd({ ...nd, vendor_type: e.target.value })}>
                    {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <label>Model
                  <select value={nd.model} onChange={(e) => setNd({ ...nd, model: e.target.value })}>
                    {DEAL_MODELS.map((m) => <option key={m.key} value={m.key}>{m.label} — {m.hint}</option>)}
                  </select>
                </label>
                <label>Line of business
                  <select value={nd.line} onChange={(e) => setNd({ ...nd, line: e.target.value })}>
                    {DEAL_LINES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                  </select>
                </label>
                {(nd.model === "rev_share" || nd.model === "discount") && (
                  <label>{nd.model === "rev_share" ? "Their cut %" : "Discount %"} <i>{nd.rate && Number(nd.rate) > MARGIN_FLOOR_GIVE ? "— below the 80% floor" : nd.model === "rev_share" && nd.rate ? `— we keep ${100 - Number(nd.rate)}%` : ""}</i>
                    <input inputMode="decimal" value={nd.rate} onChange={(e) => setNd({ ...nd, rate: e.target.value })} placeholder="10" />
                  </label>
                )}
                {(nd.model === "monthly" || nd.model === "flat") && (
                  <label>{nd.model === "monthly" ? "$ / month" : "Flat $"}<input inputMode="decimal" value={nd.amount} onChange={(e) => setNd({ ...nd, amount: e.target.value })} placeholder="500" /></label>
                )}
                {nd.model === "custom" && (
                  <label>Terms<input value={nd.price_label} onChange={(e) => setNd({ ...nd, price_label: e.target.value })} placeholder="Describe the structure" maxLength={40} /></label>
                )}
                {(nd.model === "rev_share" || nd.model === "discount") && (
                  <DealRoi model={nd.model} rate={Number(nd.rate) || 0} econ={econ} vol={Math.max(0, Number(roiVol) || 0)} setVol={setRoiVol} />
                )}
                <label>One-liner<input value={nd.blurb} onChange={(e) => setNd({ ...nd, blurb: e.target.value })} placeholder="What the account gets" maxLength={120} /></label>
              </div>
              <button type="button" className="dops-mini" style={{ marginTop: 8 }} onClick={addDeal} disabled={!nd.title.trim()}>Put it on the table</button>
            </div>
          )}
        </>
      )}

      {(() => {
        const present = [...new Set(opps.map((o) => o.deals?.line).filter(Boolean))] as string[];
        if (present.length < 2) return null;
        return (
          <div className="pipe-lines">
            <button type="button" className={`ts-chip${mineOnly ? " on" : ""}`} onClick={() => setMineOnly(true)}>My accounts{mineCount ? ` · ${mineCount}` : ""}</button>
            <button type="button" className={`ts-chip${!mineOnly ? " on" : ""}`} onClick={() => setMineOnly(false)}>Everyone</button>
            <span className="pipe-lines-div" aria-hidden />
            <button type="button" className={`ts-chip${lineFilter === "all" ? " on" : ""}`} onClick={() => setLineFilter("all")}>All lines</button>
            {present.map((l) => (
              <button key={l} type="button" className={`ts-chip${lineFilter === l ? " on" : ""}`} onClick={() => setLineFilter(l)}>{lineLabel(l) ?? l}</button>
            ))}
          </div>
        );
      })()}

      {!loaded && <div className="dops-empty">Loading the board…</div>}
      {loaded && opps.length === 0 && <div className="h-sub">Nothing in the pipeline yet — add the first account below.</div>}

      {STAGES.map((s) => {
        const rows = opps
          .filter((o) => o.stage === s.key && (lineFilter === "all" || o.deals?.line === lineFilter) && (!mineOnly || o.rep_id === user?.id))
          .sort((a, b) => (a.next_step_at ?? "9999").localeCompare(b.next_step_at ?? "9999"));
        if (rows.length === 0) return null;
        return (
          <div key={s.key} className="pipe-stage">
            <div className="dops-up-h">{s.label} · {rows.length}</div>
            {rows.map(card)}
          </div>
        );
      })}

      {adding ? (
        <div className="goal-new">
          <div className="pipe-grid">
            <label>Account
              <select value={no.vendorId} onChange={(e) => setNo({ ...no, vendorId: e.target.value })}>
                <option value="">＋ New account…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.vendor_type ? ` (${v.vendor_type})` : ""}</option>)}
              </select>
            </label>
            {!no.vendorId && (
              <>
                <label>Name<input value={no.newVendor} onChange={(e) => setNo({ ...no, newVendor: e.target.value })} placeholder="Iron Works Gym" maxLength={80} /></label>
                <label>Type
                  <select value={no.newType} onChange={(e) => setNo({ ...no, newType: e.target.value })}>
                    {VENDOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
              </>
            )}
            <label>Deal <i>({newVendorType ?? "pick a type"})</i>
              <select value={no.dealId} onChange={(e) => setNo({ ...no, dealId: e.target.value })}>
                <option value="">Pick later</option>
                {dealsFor(newVendorType).map((d) => <option key={d.id} value={d.id}>{d.title}{dealTerms(d) ? ` · ${dealTerms(d)}` : ""}</option>)}
              </select>
            </label>
            <label>Rep
              <select value={no.repId} onChange={(e) => setNo({ ...no, repId: e.target.value })}>
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name || "Unnamed"}</option>)}
              </select>
            </label>
            <label>Value $<input inputMode="decimal" value={no.value} onChange={(e) => setNo({ ...no, value: e.target.value })} placeholder="500" /></label>
            <label>First step<input value={no.nextStep} onChange={(e) => setNo({ ...no, nextStep: e.target.value })} placeholder="Walk in, ask for the manager" maxLength={120} /></label>
          </div>
          <div className="st-log-btns">
            <button type="button" className="dops-mini" onClick={() => addOpp()}>Add to the pipeline</button>
            <button type="button" className="st-discuss" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dl-card st-build" onClick={() => setAdding(true)}>
          <b>＋ New opportunity</b>
          <span>An account, a deal from the table, a rep, a first step.</span>
        </button>
      )}
      {resolve && (
        <VendorResolve name={resolve.name} candidates={resolve.candidates}
          onUse={(c) => { setResolve(null); addOpp({ linkTo: c.id }); }}
          onCreateDistinct={() => { setResolve(null); addOpp({ createDistinct: true }); }}
          onClose={() => setResolve(null)}
        />
      )}
    </div>
  );
}
