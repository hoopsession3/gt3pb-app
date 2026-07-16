"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useApp } from "./AppProvider";
import { useAuth } from "./AuthProvider";
import type { Broadcast } from "@/lib/broadcasts";
import Icon from "@/components/Icon";
import { InfoRow } from "@/components/kit";

// BROADCAST EDITOR (Settings) — compose an announcement/ad and put it live across the app to everyone.
// The composer exposes every option: what it says, who sees it, how it looks, an optional call-to-
// action, and a schedule. A live preview shows exactly what users will see. Toggling Live publishes
// it in real time (the banner is realtime-subscribed).
type Draft = Pick<Broadcast, "title" | "body" | "kind" | "style" | "audience" | "cta_label" | "cta_href" | "active" | "starts_at" | "ends_at"> & { id?: string };
const BLANK: Draft = { title: "", body: "", kind: "announcement", style: "info", audience: "all", cta_label: "", cta_href: "", active: false, starts_at: null, ends_at: null };

const STYLES = [["info", "Info"], ["success", "Good news"], ["warning", "Heads-up"], ["brand", "Brand"]] as const;
const KINDS = [["announcement", "Announcement"], ["promo", "Promo / ad"], ["maintenance", "Maintenance"]] as const;
const AUDIENCES = [["all", "Everyone"], ["members", "Signed-in members"], ["staff", "Staff only"]] as const;

export default function BroadcastEditor() {
  const { toast } = useApp();
  const { user } = useAuth();
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [d, setD] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("broadcasts").select("*").order("created_at", { ascending: false });
    setRows((data as Broadcast[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const edit = (b: Broadcast) => setD({ id: b.id, title: b.title, body: b.body ?? "", kind: b.kind, style: b.style, audience: b.audience, cta_label: b.cta_label ?? "", cta_href: b.cta_href ?? "", active: b.active, starts_at: b.starts_at, ends_at: b.ends_at });

  const save = async (publish?: boolean) => {
    if (!supabase || saving) return;
    if (!d.title.trim()) { toast("Give it a headline first", "error"); return; }
    setSaving(true);
    const payload = {
      title: d.title.trim().slice(0, 120), body: d.body?.trim().slice(0, 600) || null,
      kind: d.kind, style: d.style, audience: d.audience,
      cta_label: d.cta_label?.trim() || null, cta_href: d.cta_href?.trim() || null,
      active: publish ?? d.active, starts_at: d.starts_at || null, ends_at: d.ends_at || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = d.id
      ? await supabase.from("broadcasts").update(payload).eq("id", d.id)
      : await supabase.from("broadcasts").insert({ ...payload, created_by: user?.id ?? null });
    setSaving(false);
    if (error) { toast(`Couldn't save — ${error.message}`, "error"); return; }
    toast(payload.active ? "Live across the app now" : "Saved as a draft");
    setD(BLANK); load();
  };
  const toggle = async (b: Broadcast) => { if (!supabase) return; await supabase.from("broadcasts").update({ active: !b.active }).eq("id", b.id); toast(!b.active ? "Live now" : "Taken down"); load(); };
  const del = async (b: Broadcast) => { if (!supabase || (typeof window !== "undefined" && !window.confirm(`Delete "${b.title}"?`))) return; await supabase.from("broadcasts").delete().eq("id", b.id); if (d.id === b.id) setD(BLANK); load(); };

  return (
    <div className="bce">
      <p className="set-lead">Compose a message or ad and put it live across the whole app — everyone sees it in real time. Pick who it reaches, how it looks, an optional button, and a schedule.</p>

      {/* live preview */}
      <div className="bce-preview">
        <div className="bce-preview-l">Preview</div>
        <div className={`bcast bcast-${d.style}`} role="status">
          <div className="bcast-x"><b className="bcast-t">{d.title || "Your headline"}</b>{d.body && <span className="bcast-b">{d.body}</span>}</div>
          {d.cta_label && <span className="bcast-cta">{d.cta_label}</span>}
          <button type="button" className="bcast-close" aria-hidden><Icon name="close" /></button>
        </div>
      </div>

      <label className="prod-f"><span>Headline</span><input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="e.g. Saturday drop is live — order ahead" /></label>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Message (optional)</span><textarea className="ev-input ev-area" rows={2} maxLength={600} value={d.body ?? ""} onChange={(e) => set("body", e.target.value)} placeholder="One or two lines of detail." /></label>

      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Type</span><select value={d.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="prod-f"><span>Look</span><select value={d.style} onChange={(e) => set("style", e.target.value as Draft["style"])}>{STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <label className="prod-f" style={{ marginTop: 8 }}><span>Who sees it</span><select value={d.audience} onChange={(e) => set("audience", e.target.value as Draft["audience"])}>{AUDIENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>

      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Button label (optional)</span><input value={d.cta_label ?? ""} onChange={(e) => set("cta_label", e.target.value)} maxLength={40} placeholder="e.g. Order now" /></label>
        <label className="prod-f"><span>Button link</span><input value={d.cta_href ?? ""} onChange={(e) => set("cta_href", e.target.value)} placeholder="/reserve or https://…" /></label>
      </div>
      <div className="prod-grid" style={{ marginTop: 8 }}>
        <label className="prod-f"><span>Show from (optional)</span><input type="datetime-local" value={d.starts_at ? d.starts_at.slice(0, 16) : ""} onChange={(e) => set("starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)} /></label>
        <label className="prod-f"><span>Hide after (optional)</span><input type="datetime-local" value={d.ends_at ? d.ends_at.slice(0, 16) : ""} onChange={(e) => set("ends_at", e.target.value ? new Date(e.target.value).toISOString() : null)} /></label>
      </div>

      {/* The one true .btn-pri on the Settings screen (app/crew/page.tsx, sec==="settings"): going
          live ships the broadcast app-wide — the most externally-consequential write of any
          Panel on this screen, same "outward-facing commit" reasoning as Studio's Publish to
          site / CodesPanel's mint / InviteTeammate's invite. Checked every sibling Panel:
          SiteCopyEditor/PromoEditor/CopilotDirectory/AiSpend carry no note-save or btn-pri at
          all; Changelog still has an unmigrated legacy .note-save "Log it" button (out of scope
          here). OfficeSettings' and FounderDigest's save actions are each the only button on
          their own small form and would read "likely .btn-pri" in isolation, but Panels open
          independently (see Panel() below — more than one can be visible at once), so they're
          kept at .btn-sec to keep this the single one; see the note on each of those buttons.
          Go live leads the row (flex-wrap added inline) so its full-width block doesn't orphan
          Save draft/New on a sparse line — same fix Studio's .studio-pub-row applies. Save draft
          is a real, deliberate write (just not the one that ships it) → .btn-sec. New only
          resets local form state, no persistence → .btn-ter. */}
      <div className="prod-actions" style={{ marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn-pri" onClick={() => save(true)} disabled={saving || !d.title.trim()}>{saving ? "…" : d.id ? "Update & go live" : "Go live"}</button>
        <button type="button" className="btn-sec" onClick={() => save(false)} disabled={saving || !d.title.trim()}>Save draft</button>
        {d.id && <button type="button" className="btn-ter" onClick={() => setD(BLANK)} disabled={saving}>New</button>}
      </div>

      {rows.length > 0 && (
        <>
          {/* "All broadcasts" labels a sublist INSIDE this component, not a top-level page section —
              .crew-group (mono, uppercase, border-bottom hairline, space-between) is the page-level
              divider primitive (see this same page's "Owner control room"/"Shoots" dividers, and
              OrgChart's comment on the "Roster" crew-group in app/crew/page.tsx); reusing it here made
              this inner sublist read as a second section header competing with the Panel's own title.
              .insp-lbl is the app's existing internal-sub-header pattern for exactly this situation —
              a plain label, not another SectionHeader (Studio's "Caption engine"/"Design & publish",
              BrandKit's "Palette"/"Logos & assets", BrandCalendar's "Unscheduled" backlog label all
              use it the same way). Rows below are now kit InfoRows: the style-color dot moves into
              `name` (still its own .bce-dot swatch — no kit equivalent for a per-item color chip),
              live/draft status is carried by the `live` prop's Live tag (drop the redundant inline
              "Live" text; keep an explicit "Draft ·" prefix in `meta` when not live, since Draft has
              no tag counterpart and dropping it silently would lose information), audience/kind →
              meta, toggle+delete stay their own .bce-toggle/.bce-del buttons in `trailing` (bodyClick
              on the body zone, not onClick on the row, since trailing holds its own real buttons —
              same rule RsvpRow/OfficeOrders follow). No data fetching, state, or handlers changed. */}
          <div className="insp-lbl" style={{ marginTop: 16 }}>All broadcasts</div>
          <div className="k-rows">
            {rows.map((b) => (
              <InfoRow
                key={b.id}
                name={<><span className={`bce-dot bcast-${b.style}`} />{b.title}</>}
                meta={<>{!b.active && "Draft · "}{b.audience === "all" ? "Everyone" : b.audience === "members" ? "Members" : "Staff"}{b.kind === "promo" ? " · Ad" : ""}</>}
                live={b.active}
                bodyClick={() => edit(b)}
                ariaLabel={`${b.title || "Untitled"} — edit`}
                trailing={<>
                  <button type="button" className={`bce-toggle${b.active ? " on" : ""}`} onClick={() => toggle(b)}>{b.active ? "Take down" : "Go live"}</button>
                  <button type="button" className="bce-del" onClick={() => del(b)} aria-label="Delete"><Icon name="close" /></button>
                </>}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
