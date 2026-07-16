"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth, roleOf, LEADERSHIP_ROLES } from "./AuthProvider";
import { useMyAlerts } from "@/lib/useMyAlerts";
import { useWorkStreams, streamOfCategory, type WorkStream } from "@/lib/streams";
import { normalizeCategory } from "@/lib/alertKinds";
import Sheet from "./Sheet";
import BottomNav from "./BottomNav";
import { supabase } from "@/lib/supabase";
import Icon from "@/components/Icon";

// Employee Mode — a dedicated operator console nav that replaces the customer
// 5-tab nav while you're in /crew. Sections are role-scoped and the choice is
// shared (context) so the nav (rendered in the shell) and the page content stay
// in sync; persisted so you return to the same section.

export type OpSection = "day" | "now" | "ask" | "command" | "prep" | "plan" | "pipeline" | "studio" | "brew" | "garage" | "goals" | "driver" | "stops" | "notes" | "money" | "customers" | "team" | "settings";

const Ctx = createContext<{ section: OpSection; setSection: (s: OpSection) => void; back: () => boolean; canGoBack: boolean; groupId: string | null; setGroupId: (g: string | null) => void }>({ section: "day", setSection: () => {}, back: () => false, canGoBack: false, groupId: null, setGroupId: () => {} });
export const useOperatorSection = () => useContext(Ctx);

const VALID = new Set<OpSection>(["day", "now", "command", "prep", "plan", "pipeline", "studio", "brew", "garage", "goals", "driver", "stops", "notes", "money", "customers", "team", "settings"]);

export function OperatorSectionProvider({ children }: { children: React.ReactNode }) {
  const [section, setSectionState] = useState<OpSection>("day");
  // The active nav GROUP (lane). Sections can belong to two lanes; the tapped tab wins the
  // ambiguity. Null = resolve from the section (first lane that contains it).
  const [groupId, setGroupId] = useState<string | null>(() => { try { return localStorage.getItem("gt3-op-group"); } catch { return null; } });
  const setGroup = useCallback((g: string | null) => { setGroupId(g); try { if (g) localStorage.setItem("gt3-op-group", g); } catch { /* ignore */ } }, []);
  // URL-backed sections: a section change is a real browser-history entry (/crew?s=prep), so the
  // native Back button, the phone's swipe-back, and deep-links all work. `depth` tracks how many
  // section entries WE pushed this visit — the console back button uses it to know when to exit crew.
  const sectionRef = useRef<OpSection>("day");
  const depthRef = useRef(0);
  const [depth, setDepth] = useState(0);
  const apply = (s: OpSection) => { sectionRef.current = s; setSectionState(s); try { localStorage.setItem("gt3-op-section", s); } catch { /* ignore */ } };

  useEffect(() => {
    // Hydrate: a ?s= deep-link wins, else the last section you were on.
    try {
      let resolved: OpSection | null = null;
      const q = new URL(window.location.href).searchParams.get("s");
      if (q && VALID.has(q as OpSection)) { apply(q as OpSection); resolved = q as OpSection; }
      else { const ls = localStorage.getItem("gt3-op-section"); if (ls && VALID.has(ls as OpSection)) { apply(ls as OpSection); resolved = ls as OpSection; } }
      // Stamp the resolved section into the URL so the base history entry is addressable — native
      // back returns HERE (not blank), the section is deep-linkable, and swipe-back has an anchor.
      // replaceState (not push): we're labelling the entry we're already on, not adding one.
      if (window.location.pathname.startsWith("/crew")) {
        const cur = resolved ?? sectionRef.current;
        if (new URL(window.location.href).searchParams.get("s") !== cur) window.history.replaceState({ gt3s: cur }, "", `/crew?s=${cur}`);
      }
    } catch { /* ignore */ }
    // Back/forward (button or swipe): read the section out of the URL and apply it.
    const onPop = () => {
      try {
        const q = new URL(window.location.href).searchParams.get("s");
        if (q && VALID.has(q as OpSection) && q !== sectionRef.current) apply(q as OpSection);
      } catch { /* ignore */ }
      depthRef.current = Math.max(0, depthRef.current - 1);
      setDepth(depthRef.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setSection = useCallback((s: OpSection) => {
    if (s === sectionRef.current) return;
    apply(s);
    try {
      if (window.location.pathname.startsWith("/crew")) {
        window.history.pushState({ gt3s: s }, "", `/crew?s=${s}`);
        depthRef.current += 1; setDepth(depthRef.current);
      }
    } catch { /* ignore */ }
  }, []);

  // Console back button: if we pushed section history, let the browser walk it back; otherwise the
  // caller leaves crew mode (‹ → /3mpire). popstate applies the resulting section.
  const back = useCallback((): boolean => {
    if (depthRef.current > 0) { try { window.history.back(); } catch { /* ignore */ } return true; }
    return false;
  }, []);
  return <Ctx.Provider value={{ section, setSection, back, canGoBack: depth > 0, groupId, setGroupId: setGroup }}>{children}</Ctx.Provider>;
}

// roleOf (AuthProvider) knows all 7 roles now — the local fork this file kept "so the expanded
// roles resolve" predates that widening.

// which sections each role gets — and in what order (Ask floats via QuickDock, so it's not here)
const ROLE_SECTIONS: Record<string, OpSection[]> = {
  server: ["day", "now", "notes", "driver"],
  contractor: ["day", "now", "prep", "garage", "notes", "driver"],
  operator: ["day", "now", "prep", "brew", "garage", "pipeline", "notes", "driver"],
  event_manager: ["day", "now", "command", "prep", "plan", "pipeline", "studio", "goals", "notes", "stops", "driver"],
  admin: ["day", "now", "command", "prep", "plan", "pipeline", "studio", "brew", "garage", "goals", "notes", "stops", "driver", "money", "customers", "team", "settings"],
  owner: ["day", "now", "command", "prep", "plan", "pipeline", "studio", "brew", "garage", "goals", "notes", "stops", "driver", "money", "customers", "team", "settings"],
};
export const sectionsForRole = (role: string): OpSection[] => ROLE_SECTIONS[role] ?? ["now"];

// The bar is a PROJECTION of work_streams (0159): Today (the cross-stream command center — time
// axis, always first) + the user's pinned lanes (domain axis). One config drives the calendar's
// lane filter, alert routing, the org chart, and this bar — no hand-rolled grouping to drift.
export type NavGroup = { id: string; label: string; icon: string; members: OpSection[]; color?: string };
// The Today lane is defined ONCE here and reused by both the bottom bar AND the secondary section
// toggle (crew page), so a section added to it can never again go missing from one of them.
export const TODAY_GROUP: NavGroup = { id: "today", label: "Today", icon: "day", members: ["day", "now", "command"] };
const MAX_PINS = 4; // total tabs on the bar (Today counts — it's pinnable like any lane)
const isSection = (x: string): x is OpSection => (VALID as Set<string>).has(x) || x === "ask";
export function streamGroups(streams: WorkStream[], role: string): NavGroup[] {
  const allowed = sectionsForRole(role);
  return streams
    .map((s) => ({ id: s.key, label: s.label, icon: s.icon || s.key, color: s.color, members: s.sections.filter((x): x is OpSection => isSection(x) && allowed.includes(x as OpSection)) }))
    .filter((g) => g.members.length > 0);
}
// Role defaults until the user pins their own bar. Explicit pins are respected exactly —
// an unpinned lane was unpinned on purpose, so nothing auto-fills behind the user's back.
const DEFAULT_PINS: Record<string, string[]> = {
  owner: ["today", "service", "brand", "business"],
  admin: ["today", "service", "brand", "business"],
  event_manager: ["today", "events", "service", "brand"],
  operator: ["today", "service", "production", "events"],
  contractor: ["today", "service", "production"],
  server: ["today", "service"],
};
export function orderByPins(groups: NavGroup[], pins: string[] | null | undefined, role: string): { pinned: NavGroup[]; overflow: NavGroup[] } {
  const def = (DEFAULT_PINS[role] ?? ["today"]).filter((k) => groups.some((g) => g.id === k));
  let want = (pins?.length ? pins : def).filter((k) => groups.some((g) => g.id === k));
  if (!want.length) want = def.length ? def : [groups[0]?.id].filter(Boolean) as string[]; // floor: never an empty bar
  const pinned = want.slice(0, MAX_PINS).map((k) => groups.find((g) => g.id === k)!) as NavGroup[];
  const overflow = groups.filter((g) => !pinned.includes(g));
  return { pinned, overflow };
}

// Lane icons — keyed by work_streams.icon so tenant lanes pick from this set.
export const STREAM_ICONS: Record<string, React.ReactNode> = {
  service: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M12 13.2l1.2 2.4 2.6.3-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.3z" /></>,
  production: <><path d="M12 3c3 3.8 5.5 6.7 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.7 9 6.8 12 3z" /><path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" /></>,
  brand: <path d="M12 3l2.1 4.9 5.3.4-4 3.5 1.2 5.2L12 14.7 7.4 17.4l1.2-5.2-4-3.5 5.3-.4z" />,
  business: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.5-2.5.5-2.5 1.5 1 1.6 2.5 1.6 2.5-.6 2.5-1.6" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
};
const streamIcon = (key: string) => STREAM_ICONS[key] ?? <circle cx="12" cy="12" r="4" />;

const ICONS: Record<OpSection, React.ReactNode> = {
  day: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" /></>,
  now: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  command: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  ask: <><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9A8.5 8.5 0 1 1 21 11.5z" /><path d="M12 7v.5M12 11v3" /></>,
  studio: <><path d="M12 3l2.1 4.9 5.3.4-4 3.5 1.2 5.2L12 14.7 7.4 17.4l1.2-5.2-4-3.5 5.3-.4z" /></>,
  prep: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><path d="M9 12l2 2 4-4" /></>,
  plan: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  brew: <><path d="M12 3c3 3.8 5.5 6.7 5.5 10a5.5 5.5 0 0 1-11 0C6.5 9.7 9 6.8 12 3z" /><path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" /></>,
  garage: <><path d="M3 10l9-6 9 6" /><path d="M5 9.5V20h14V9.5" /><rect x="8.5" y="13" width="7" height="7" /></>,
  goals: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></>,
  driver: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.4" /><path d="M12 3v6.6M4.2 16.5l6-3M19.8 16.5l-6-3" /></>,
  pipeline: <><path d="M4 5h16l-5.5 7v6l-5 2v-8z" /></>,
  stops: <><path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10z" /><circle cx="12" cy="10.6" r="2.3" /></>,
  notes: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.5-2.5.5-2.5 1.5 1 1.6 2.5 1.6 2.5-.6 2.5-1.6" /></>,
  customers: <><rect x="3" y="5" width="18" height="15" rx="2" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 17c.5-1.7 1.7-2.6 3.2-2.6s2.7.9 3.2 2.6M15 9.5h4M15 13h4" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20c0-2.4-1.8-4-4-4.6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
};
const LABELS: Record<OpSection, string> = { day: "My Day", now: "Live Ops", ask: "Ask", command: "Command", prep: "Readiness", plan: "Plan", pipeline: "Pipeline", studio: "Studio", brew: "Brew", garage: "Assets", goals: "Goals", driver: "Delivery", stops: "Route", notes: "Notes", money: "Money", customers: "Customers", team: "Team", settings: "Settings" };
export const SECTION_LABEL = LABELS;



export default function OperatorNav() {
  const { profile } = useAuth();
  const { section, setSection } = useOperatorSection();
  const role = roleOf(profile);
  // Unacked-critical badge — same counting rule as My Day's flags and the Now strip (one shared
  // hook), so the numbers agree. The old query here counted EVERYONE's criticals, including alerts
  // targeted at someone else.
  const { user } = useAuth();
  const { critCount, flags } = useMyAlerts(user?.id ?? null, role !== "member");
  const streams = useWorkStreams();
  const { groupId, setGroupId } = useOperatorSection();
  const [moreOpen, setMoreOpen] = useState(false);
  // members / signed-out: no operator console — fall back to the customer nav so
  // they can still navigate away from /crew.
  if (role === "member") return <BottomNav />;
  const allowed = sectionsForRole(role);
  const todayGroup: NavGroup = { ...TODAY_GROUP, members: TODAY_GROUP.members.filter((m) => allowed.includes(m)) };
  const allGroups = [todayGroup, ...streamGroups(streams, role)].filter((g) => g.members.length > 0);
  const { pinned: groups, overflow } = orderByPins(allGroups, profile?.nav_pins, role);
  const activeGroup = (groupId && allGroups.find((g) => g.id === groupId && g.members.includes(section)))
    || allGroups.find((g) => g.members.includes(section))
    || allGroups[0];
  const openGroup = (g: NavGroup) => {
    setGroupId(g.id);
    setSection(g.members[0]);
    setMoreOpen(false);
  };
  // Lane badges — the same unacked flags My Day shows, rolled up category → lane.
  const laneCounts: Record<string, number> = {};
  for (const f of flags) { const lane = streamOfCategory(normalizeCategory(f.category), streams); if (lane) laneCounts[lane.key] = (laneCounts[lane.key] || 0) + 1; }
  // Roving arrow-key nav for the tablist (WAI-ARIA): ←/→ move + activate, Home/End jump to ends.
  const onNavKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (!tabs.length) return;
    const cur = tabs.findIndex((t) => t === document.activeElement);
    let next = cur;
    if (e.key === "ArrowRight") next = cur < 0 ? 0 : (cur + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = cur < 0 ? tabs.length - 1 : (cur - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <>
    <div className="nav opnav" role="tablist" aria-label="Crew console" onKeyDown={onNavKey}>
      {groups.map((g) => {
        const on = activeGroup.id === g.id;
        return (
          <button key={g.id} role="tab" aria-selected={on} className={`tab${on ? " on" : ""}`} onClick={() => { if (!on) openGroup(g); }}>
            <span className="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{g.id === "today" ? ICONS.day : streamIcon(g.icon)}</svg>{g.id === "today" && critCount > 0 && <span className="nav-badge" title={`${critCount} critical alert${critCount === 1 ? "" : "s"} — needs you now`} aria-label={`${critCount} critical alert${critCount === 1 ? "" : "s"} — needs you now`}>{critCount}</span>}{g.id !== "today" && (laneCounts[g.id] ?? 0) > 0 && <span className="nav-badge lane" title={`${laneCounts[g.id]} open item${laneCounts[g.id] === 1 ? "" : "s"} in ${g.label}`} aria-label={`${laneCounts[g.id]} open item${laneCounts[g.id] === 1 ? "" : "s"} in ${g.label}`}>{laneCounts[g.id]}</span>}</span>
            <span className="tl">{g.label}</span>
          </button>
        );
      })}
      <button role="tab" aria-selected={overflow.some((g) => g.id === activeGroup.id)} className={`tab${overflow.some((g) => g.id === activeGroup.id) ? " on" : ""}`} onClick={() => setMoreOpen(true)}>
        <span className="ti"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{STREAM_ICONS.more}</svg></span>
        <span className="tl">More</span>
      </button>
    </div>
    {moreOpen && <MoreSheet lanes={allGroups} pins={groups.map((g) => g.id)} activeId={activeGroup.id} onOpen={openGroup} onClose={() => setMoreOpen(false)} canPin={Boolean(user)} />}
    </>
  );
}

// The rest of the lanes + "your bar" customization. Pins are per-user over tenant-defined lanes:
// tap a lane to open it; tap the pin to put it on (or take it off) your bar. Today is always first.
function MoreSheet({ lanes, pins, activeId, onOpen, onClose, canPin }: { lanes: NavGroup[]; pins: string[]; activeId: string; onOpen: (g: NavGroup) => void; onClose: () => void; canPin: boolean }) {
  const { user, refreshProfile } = useAuth();
  const [local, setLocal] = useState<string[]>(pins);
  const [full, setFull] = useState(false);
  const toggle = async (key: string) => {
    if (!supabase || !user) return;
    // Never silently evict a pin (the old slice(-MAX) quietly dropped Today) — say the bar is full.
    if (!local.includes(key) && local.length >= MAX_PINS) { setFull(true); setTimeout(() => setFull(false), 2500); return; }
    const next = local.includes(key) ? local.filter((k) => k !== key) : [...local, key];
    setLocal(next);
    await supabase.from("profiles").update({ nav_pins: next }).eq("id", user.id);
    refreshProfile();
  };
  return (
    <Sheet open onClose={onClose} label="Your lanes" header={<div style={{ display: "flex", alignItems: "center" }}><span className="isheet-title">Your lanes</span><button type="button" className="isheet-x" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>}>
      <div className="lane-legend"><span className="lane-key"><span className="cc-dot" style={{ background: "var(--red-h)" }} />needs you now</span><span className="lane-key"><span className="cc-dot" style={{ background: "var(--gold2)" }} />open items in a lane</span></div>
      <div className="lane-hint">{full ? "Your bar is full (4) — unpin one first." : local.length === 0 ? "Nothing pinned — your bar shows the standard set for your role. Pin lanes to make it yours." : "Tap a lane to open it. Pin up to 4 to your bar — unpin anything, it stays here."}</div>
      {lanes.map((g) => (
        <div key={g.id} className={`lane-row${activeId === g.id ? " on" : ""}`}>
          <button type="button" className="lane-open" onClick={() => onOpen(g)}>
            <span className="cc-dot" style={{ background: g.color ?? "var(--gold2)" }} />
            <b>{g.label}</b>
            <span className="lane-secs">{g.members.map((m) => SECTION_LABEL[m]).join(" · ")}</span>
          </button>
          {canPin && (
            <button type="button" className={`lane-pin${local.includes(g.id) ? " on" : ""}`} onClick={() => toggle(g.id)} aria-pressed={local.includes(g.id)} aria-label={`${local.includes(g.id) ? "Unpin" : "Pin"} ${g.label}`}>
              {local.includes(g.id) ? "Pinned" : "Pin"}
            </button>
          )}
        </div>
      ))}
    </Sheet>
  );
}
