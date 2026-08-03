"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SectionHeader } from "@/components/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */
// UTILIZATION (0267 — Ryan: "so you don't have to ask me this no more") — the owners' answer to
// "is the team actually in the system," plus the anonymous visitor pulse. Per staff member over
// the last 30 days: active days, real sign-ins, action count, last-seen with the last action.
// Guests are a daily COUNT — no IDs, no PII, deliberately. Admin-only read (RLS-enforced).

type Act = { user_id: string; seen_on: string; logins: number; actions: number; last_action: string | null; last_seen_at: string };
type Person = { id: string; display_name: string | null; role: string | null };
type Data = { people: Person[]; acts: Act[]; guests: { day: string; hits: number }[] };

const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export default function UtilizationPanel() {
  const loader = useCallback(async (): Promise<Data> => {
    if (!supabase) return { people: [], acts: [], guests: [] };
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [p, a, g] = await Promise.all([
      supabase.from("profiles").select("id, display_name, role").neq("role", "member").order("display_name"),
      supabase.from("user_activity").select("*").gte("seen_on", from).order("seen_on", { ascending: false }),
      supabase.from("guest_daily").select("*").gte("day", new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)).order("day", { ascending: false }),
    ]);
    if (a.error) throw new Error(a.error.message);
    return { people: (p.data as Person[]) ?? [], acts: (a.data as Act[]) ?? [], guests: (g.data as { day: string; hits: number }[]) ?? [] };
  }, []);
  const state = useAsyncData(loader, []);

  return (
    <div className="adm-sec">
      <SectionHeader label="Utilization" annotation="last 30 days · who's in the system" />
      <AsyncSection state={state} isEmpty={({ acts, guests }) => acts.length === 0 && guests.length === 0}
        emptyTitle="No activity recorded yet" emptySub="Counting starts with this deploy — the first numbers land today."
        loadingLabel="Loading utilization…" errorTitle="Couldn't load utilization (admin-only data)">
        {({ people, acts, guests }) => {
          const byUser = new Map<string, Act[]>();
          for (const a of acts) (byUser.get(a.user_id) ?? byUser.set(a.user_id, []).get(a.user_id)!).push(a);
          const guestWeek = guests.slice(0, 7).reduce((s, g) => s + Number(g.hits), 0);
          const guestPrev = guests.slice(7, 14).reduce((s, g) => s + Number(g.hits), 0);
          return (
            <>
              <div className="util-rows">
                {people.map((p) => {
                  const mine = byUser.get(p.id) ?? [];
                  const latest = mine[0];
                  const logins = mine.reduce((s, a) => s + a.logins, 0);
                  const actions = mine.reduce((s, a) => s + a.actions, 0);
                  return (
                    <div key={p.id} className={`util-row${!latest ? " idle" : ""}`}>
                      <span className="util-name">{p.display_name?.trim() || "Unnamed"}<i>{p.role}</i></span>
                      <span className="util-stats">
                        <b>{mine.length}</b> active day{mine.length === 1 ? "" : "s"} · <b>{logins}</b> sign-in{logins === 1 ? "" : "s"} · <b>{actions}</b> actions
                      </span>
                      <span className="util-last">{latest ? <>{ago(latest.last_seen_at)}{latest.last_action ? ` · ${latest.last_action}` : ""}</> : "no activity yet"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="util-guests">
                <span className="util-guests-k">Guest visits</span>
                <b>{guestWeek.toLocaleString()}</b> this week{guestPrev > 0 && <i> · {guestWeek >= guestPrev ? "up" : "down"} vs {guestPrev.toLocaleString()} prior</i>}
                <span className="util-guests-note">daily counts only — no visitor IDs, no PII</span>
              </div>
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}
