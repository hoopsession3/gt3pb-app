"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import BottomNav from "./BottomNav";
import { supabase } from "@/lib/supabase";

// Employee Mode — a dedicated operator console nav that replaces the customer
// 5-tab nav while you're in /admin. Sections are role-scoped and the choice is
// shared (context) so the nav (rendered in the shell) and the page content stay
// in sync; persisted so you return to the same section.

export type OpSection = "day" | "now" | "ask" | "prep" | "plan" | "studio" | "money" | "team";

const Ctx = createContext<{ section: OpSection; setSection: (s: OpSection) => void }>({ section: "day", setSection: () => {} });
export const useOperatorSection = () => useContext(Ctx);

export function OperatorSectionProvider({ children }: { children: React.ReactNode }) {
  const [section, setSectionState] = useState<OpSection>("day");
  useEffect(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("gt3-op-section") : null;
    // "ask" is no longer a tab (it floats via QuickDock) — fall through to the default.
    if (s === "day" || s === "now" || s === "prep" || s === "plan" || s === "studio" || s === "money" || s === "team") setSectionState(s);
  }, []);
  const setSection = useCallback((s: OpSection) => {
    setSectionState(s);
    if (typeof window !== "undefined") localStorage.setItem("gt3-op-section", s);
  }, []);
  return <Ctx.Provider value={{ section, setSection }}>{children}</Ctx.Provider>;
}

// raw role read so the expanded roles (operator/event_manager/contractor) resolve
const rawRole = (p: { role?: string | null; is_admin?: boolean } | null): string =>
  p?.role ?? (p?.is_admin ? "owner" : "member");

// which sections each role gets — and in what order (Ask floats via QuickDock, so it's not here)
const ROLE_SECTIONS: Record<string, OpSection[]> = {
  server: ["day", "now"],
  contractor: ["day", "now", "prep"],
  operator: ["day", "now", "prep"],
  event_manager: ["day", "now", "prep", "plan", "studio"],
  admin: ["day", "now", "prep", "plan", "studio", "money", "team"],
  owner: ["day", "now", "prep", "plan", "studio", "money", "team"],
};
export const sectionsForRole = (role: string): OpSection[] => ROLE_SECTIONS[role] ?? ["now"];

// Best-in-class bottom nav: 4 destinations grouped by JOB, not by feature. Each group opens to its
// first visible member; a secondary toggle (in the page) switches between members of a group.
export type NavGroup = { id: string; label: string; icon: OpSection; members: OpSection[] };
export const NAV_GROUPS: NavGroup[] = [
  { id: "today", label: "Today", icon: "day", members: ["day", "now"] },
  { id: "plan", label: "Plan", icon: "plan", members: ["plan", "prep"] },
  { id: "studio", label: "Studio", icon: "studio", members: ["studio"] },
  { id: "money", label: "Money", icon: "money", members: ["money", "team"] },
];
export const groupOfSection = (s: OpSection): NavGroup | undefined => NAV_GROUPS.find((g) => g.members.includes(s));

const ICONS: Record<OpSection, React.ReactNode> = {
  day: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></>,
  now: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  ask: <><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9A8.5 8.5 0 1 1 21 11.5z" /><path d="M12 7v.5M12 11v3" /></>,
  studio: <><path d="M12 3l2.1 4.9 5.3.4-4 3.5 1.2 5.2L12 14.7 7.4 17.4l1.2-5.2-4-3.5 5.3-.4z" /></>,
  prep: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><path d="M9 12l2 2 4-4" /></>,
  plan: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.5-2.5.5-2.5 1.5 1 1.6 2.5 1.6 2.5-.6 2.5-1.6" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20c0-2.4-1.8-4-4-4.6" /></>,
};
const LABELS: Record<OpSection, string> = { day: "My Day", now: "Now", ask: "Ask", prep: "Prep", plan: "Plan", studio: "Studio", money: "Money", team: "Team" };
export const SECTION_LABEL = LABELS;

// The role-visible groups, with each group's visible members and a smart label (use the single
// member's name when a role only sees one of the group's areas).
export function visibleGroups(role: string): { group: NavGroup; members: OpSection[]; label: string }[] {
  const allowed = sectionsForRole(role);
  return NAV_GROUPS
    .map((group) => { const members = group.members.filter((m) => allowed.includes(m)); return { group, members, label: members.length === 1 ? LABELS[members[0]] : group.label }; })
    .filter((x) => x.members.length > 0);
}

export default function OperatorNav() {
  const { profile } = useAuth();
  const { section, setSection } = useOperatorSection();
  const role = rawRole(profile);
  // unacked-critical badge so you can SEE (and reach) alerts from any screen — not just the Now inbox.
  const [critCount, setCritCount] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    const load = async () => {
      const { count } = await supabase!.from("alerts").select("id", { count: "exact", head: true }).is("ack_at", null).eq("severity", "critical");
      setCritCount(count ?? 0);
    };
    load();
    const ch = supabase.channel("nav-alert-badge").on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, load).subscribe();
    return () => { supabase?.removeChannel(ch); };
  }, []);
  // members / signed-out: no operator console — fall back to the customer nav so
  // they can still navigate away from /admin.
  if (role === "member") return <BottomNav />;
  const groups = visibleGroups(role);
  return (
    <div className="nav opnav" role="tablist" aria-label="Crew console">
      {groups.map(({ group, members, label }) => {
        const on = members.includes(section);
        return (
          <button key={group.id} role="tab" aria-selected={on} className={`tab${on ? " on" : ""}`} onClick={() => { if (!on) setSection(members[0]); }}>
            <span className="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS[group.icon]}</svg>{group.id === "today" && critCount > 0 && <span className="nav-badge" aria-label={`${critCount} critical alert${critCount === 1 ? "" : "s"}`}>{critCount}</span>}</span>
            <span className="tl">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
