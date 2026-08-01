"use client";

import { useCallback } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SQUARE_APP_ID, SQUARE_ENV, squareClientReady } from "@/lib/square";

// INTEGRATIONS & SECURITY — one card per connected service with an honest status (2026-08-01
// enterprise round P4). Everything here was already real but scattered across env vars, the
// calendar's Outlook bar, and the health endpoint — this is the single pane. Statuses come from
// what the CLIENT can truthfully know (public config + live probes); server-only secrets
// (Resend, Teams) are described, not guessed at.
type Probe = { health: boolean | null; outlook: { configured: boolean; connected: boolean } | null };

const PUSH_READY = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

export default function IntegrationsPanel() {
  const loader = useCallback(async (): Promise<Probe> => {
    const out: Probe = { health: null, outlook: null };
    try { const r = await fetch("/api/health", { cache: "no-store" }); out.health = r.ok; } catch { out.health = false; }
    try { const r = await authedFetch("/api/outlook/status"); const j = await r.json(); if (j.ok) out.outlook = { configured: !!j.configured, connected: !!j.connected }; } catch { /* leave null */ }
    return out;
  }, []);
  const board = useAsyncData(loader, []);

  const Row = ({ name, ok, sub, note }: { name: string; ok: boolean | null; sub: string; note?: string }) => (
    <div className="intg-row">
      <span className={`intg-dot ${ok === true ? "ok" : ok === false ? "bad" : "unk"}`} aria-hidden />
      <span className="intg-x"><b>{name}</b><span>{sub}</span></span>
      {note && <span className="intg-note">{note}</span>}
    </div>
  );

  return (
    <AsyncSection state={board} isEmpty={() => false} emptyTitle="Nothing to check" errorTitle="Couldn't check integrations">
      {(p) => (
        <div className="intg">
          <Row name="Square payments" ok={squareClientReady} sub={squareClientReady ? `${SQUARE_ENV} · app ${SQUARE_APP_ID.slice(0, 10)}…` : "app ID / location not set"} note="one environment, app + token from the same Square application" />
          <Row name="App & database" ok={p.health} sub={p.health === false ? "health check failing — see alerts" : "health check live · outage watchdog on"} />
          <Row name="Web push" ok={PUSH_READY} sub={PUSH_READY ? "keys set — go-live pings & alerts deliver" : "VAPID keys not set"} />
          <Row name="Outlook calendar" ok={p.outlook ? (p.outlook.connected ? true : p.outlook.configured ? null : false) : null} sub={p.outlook?.connected ? "connected — two-way sync" : p.outlook?.configured ? "configured — connect from Plan › Calendar" : "needs the one-time Microsoft app setup (developer)"} />
          <Row name="Email (Resend)" ok={null} sub="server-side — critical alerts & customer notes send when the key is set in Vercel" />
          <Row name="Teams alerts" ok={null} sub="server-side — critical fan-out posts when the webhook is set in Vercel" />
          <div className="intg-sec">
            <b>Security</b>
            <span>Sign-in links &amp; sessions run on Supabase Auth. Two-factor for staff accounts is enabled per-account in Supabase (a developer task today — ask for it when the team grows). Payment card data never touches this app — Square hosts the fields end to end.</span>
          </div>
        </div>
      )}
    </AsyncSection>
  );
}
