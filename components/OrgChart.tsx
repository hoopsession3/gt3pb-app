"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRealtimeTable } from "@/lib/realtime";

// Dynamic org chart — reads every crew profile and lays them out by role tier (owner → admin →
// event manager → operators → contractors). Updates live as people set their photo/title/role.
type P = { id: string; display_name: string | null; title: string | null; avatar_url: string | null; role: string | null };

const TIERS: { roles: string[]; label: string }[] = [
  { roles: ["owner"], label: "Ownership" },
  { roles: ["admin"], label: "Administration" },
  { roles: ["event_manager"], label: "Event Management" },
  { roles: ["operator", "server"], label: "Operators" },
  { roles: ["contractor"], label: "Contractors" },
];
const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", event_manager: "Event Manager", operator: "Operator", server: "Server", contractor: "Contractor", member: "Member" };

export default function OrgChart() {
  const [people, setPeople] = useState<P[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("id, display_name, title, avatar_url, role").neq("role", "member").order("display_name");
    setPeople((data as P[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable("profiles", load);

  const card = (p: P) => (
    <div key={p.id} className="org-card">
      <div className="org-av" style={p.avatar_url ? { backgroundImage: `url(${p.avatar_url})` } : undefined} aria-hidden>{!p.avatar_url && (p.display_name || "?").trim().charAt(0).toUpperCase()}</div>
      <div className="org-name">{p.display_name || "Unnamed"}</div>
      <div className="org-title">{p.title || ROLE_LABEL[p.role ?? ""] || "Crew"}</div>
    </div>
  );

  return (
    <div className="adm-sec">
      <div className="sec">Org chart</div>
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
        {people.length === 0 && <div className="h-sub">No crew yet — team members appear here once they have a role and a profile.</div>}
      </div>
    </div>
  );
}
