"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";
import { useRecord } from "./RecordSheet";
import { useWorkStreams } from "@/lib/streams";
import { SectionHeader } from "@/components/kit";
import { useAuth, roleOf } from "./AuthProvider";
import { useApp } from "./AppProvider";
import { ALL_ROLES, roleLabel, type Role } from "@/lib/roles";
import { crewLabel } from "./useCrew";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import EmptyState from "./EmptyState";

// Dynamic org chart — reads every crew profile and lays them out by role tier (owner → admin →
// event manager → operators → contractors). Updates live as people set their photo/title/role.
// Fetch state via useAsyncData — a failed load is a real error now, not a silent "No crew yet".
type P = { id: string; display_name: string | null; title: string | null; avatar_url: string | null; role: string | null };

const TIERS: { roles: string[]; label: string }[] = [
  { roles: ["owner"], label: "Ownership" },
  { roles: ["admin"], label: "Administration" },
  { roles: ["event_manager"], label: "Event Management" },
  { roles: ["operator", "server"], label: "Operators" },
  { roles: ["contractor"], label: "Contractors" },
];
// TIERS above is this chart's OWN grouping — reporting structure, which is a different question
// from the lead/crew/member permission tier in lib/roles, so it is deliberately not derived from it.
// The role NAME is not this chart's to decide, though: it was a fourth hand-written copy of the same
// seven strings. roleLabel() names them now. The "Crew" fallback stays local and deliberate —
// roleLabel() answers "Member" for anything it does not recognise, which is the right default
// everywhere except here, where the query has already excluded members.
const orgTitle = (p: P) => p.title || (ALL_ROLES.includes(p.role as Role) ? roleLabel(p.role) : "Crew");

// TWO PARTS, TWO HOMES (2026-10-06, the settings round). This drew two things on Team: the org chart
// (who reports where — a picture of the people) and the lane owners (who owns each work stream, and
// so whose pings, whose calendar rail, whose call). Choosing a lane's owner changes how the app routes
// work, so it is a setting: Settings › Business › Team & permissions draws part="lanes", and Team keeps the picture.
// A pick the database refuses is said, as an error; the pick goes back to the owner it still has.
export default function OrgChart({ part = "people", bare = false }: { part?: "people" | "lanes"; bare?: boolean } = {}) {
  const streams = useWorkStreams();
  const { profile } = useAuth();
  const { toast } = useApp();
  const canAssign = ["admin", "owner"].includes(roleOf(profile)); // mirrors the table's write policy
  const assign = async (id: string | undefined, uid: string) => {
    if (!supabase || !id) return;
    const { data, error } = await supabase.from("work_streams").update({ owner_user_id: uid || null }).eq("id", id).select("id");
    if (error || !data?.length) toast(error ? `Couldn't change the lane's owner — ${error.message}` : "Couldn't change the lane's owner — the database refused it.", "error");
  };
  const loader = useCallback(async (): Promise<P[]> => {
    if (!supabase) return [];
    const { data, error } = await supabase.from("profiles").select("id, display_name, title, avatar_url, role").neq("role", "member").order("display_name");
    if (error) throw new Error(error.message);
    return (data as P[]) ?? [];
  }, []);
  const { openRecord } = useRecord();
  const board = useAsyncData(loader, []);
  const { reload } = board;
  useRealtimeTable("profiles", reload);
  const people = board.data ?? [];

  // The org chart is the most literal "picture of the people" screen in the app and not one card
  // was tappable — while the person view sat further down the same screen, reachable only from a
  // different list. Now the picture IS the door.
  const card = (p: P) => (
    <button key={p.id} type="button" className="org-card" onClick={() => openRecord("person", p.id)}
            aria-label={`Open ${p.display_name || "this person"}`}>
      <div className="org-av" style={p.avatar_url ? { backgroundImage: `url(${p.avatar_url})` } : undefined} aria-hidden>{!p.avatar_url && (p.display_name || "?").trim().charAt(0).toUpperCase()}</div>
      <div className="org-name">{p.display_name || "Unnamed"}</div>
      <div className="org-title">{orgTitle(p)}</div>
    </button>
  );

  return (
    <AsyncSection state={board} isEmpty={() => false} errorTitle="Couldn't load the team" emptyTitle="Nothing here yet">
      {() => part === "people" ? (
        <div className="adm-sec">
          {/* The tiered reporting view — what Team's "Team structure" divider describes. Work-stream
              ownership (part="lanes") is ownership assignment, not headcount or reporting, and is
              drawn in Settings › Business › Team & permissions. */}
          {/* Inside a folded panel (Team, 2026-10-10) the panel's own row names it: no second header. */}
          {!bare && <SectionHeader label="Org chart" annotation="who reports where" />}
          <div className="org">
            {TIERS.map((t) => {
              const tier = people.filter((p) => t.roles.includes(p.role ?? ""));
              if (tier.length === 0) return null;
              return (
                <div key={t.label} className="org-tier">
                  <div className="org-tier-h">{t.label}</div>
                  <div className="org-row">{tier.map(card)}</div>
                </div>
              );
            })}
            {people.length === 0 && <EmptyState title="No crew yet" sub="Team members appear here once they have a role and a profile." />}
          </div>
        </div>
      ) : (
        <div className="adm-sec">
          <SectionHeader label="Work streams" annotation="one owner per lane" />
          {/* A LANE IS A ROW (2026-10-06, the settings round). The lanes were cards two to a row, and at
              390px each card's owner pick was 133px wide — "Unassigned" read "Unassignec", and a name
              read less. One lane per row: its colour, its name, what it covers, and the pick the
              width of the right-hand column. */}
          <div className="ws-list">
            {streams.map((s) => {
              const owner = people.find((p) => p.id === s.owner_user_id) ?? null;
              return (
                <div key={s.key} className="ws-row">
                  <div className="ws-l">
                    <div className="ws-name"><span className="ws-dot" style={{ background: s.color }} aria-hidden="true" />{s.label}</div>
                    {s.categories.length > 0 && <div className="ws-cats">Covers {s.categories.join(" · ")}</div>}
                  </div>
                  {canAssign ? (
                    <select className="ws-owner" value={s.owner_user_id ?? ""} onChange={(e) => assign(s.id, e.target.value)} aria-label={`Owner of ${s.label}`}>
                      <option value="">Unassigned</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{crewLabel(p)}</option>)}
                    </select>
                  ) : (
                    <div className="ws-ownerro">{owner?.display_name ?? "Unassigned"}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ws-note">One accountable owner per lane — their pings, their calendar rail, their call. One person can own several lanes.</div>
        </div>
      )}
    </AsyncSection>
  );
}
