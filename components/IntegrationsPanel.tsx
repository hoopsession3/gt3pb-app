"use client";

import { useCallback, useState } from "react";
import { authedFetch } from "@/lib/authedFetch";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import { SQUARE_APP_ID, SQUARE_ENV, squareClientReady } from "@/lib/square";
import { errorMessage } from "@/lib/errorMessage";
import { apiUrl } from "@/lib/native";

// INTEGRATIONS & SECURITY — one card per connected service with an honest status (2026-08-01
// enterprise round P4). Everything here was already real but scattered across env vars, the
// calendar's Outlook bar, and the health endpoint — this is the single pane. Statuses come from
// what the CLIENT can truthfully know (public config + live probes); server-only secrets
// (Resend, Teams) are described, not guessed at.
type Probe = { health: boolean | null; outlook: { configured: boolean; connected: boolean } | null; notify: { email: boolean; sms: boolean } | null };

const PUSH_READY = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

export default function IntegrationsPanel() {
  const loader = useCallback(async (): Promise<Probe> => {
    const out: Probe = { health: null, outlook: null, notify: null };
    try { const r = await fetch(apiUrl("/api/health"), { cache: "no-store" }); out.health = r.ok; } catch { out.health = false; }
    try { const r = await authedFetch("/api/outlook/status"); const j = await r.json(); if (j.ok) out.outlook = { configured: !!j.configured, connected: !!j.connected }; } catch { /* leave null */ }
    try { const r = await authedFetch("/api/notify"); const j = await r.json(); if (j.ok && j.providers) out.notify = { email: !!j.providers.email, sms: !!j.providers.sms }; } catch { /* leave null */ }
    return out;
  }, []);
  const board = useAsyncData(loader, []);
  const [test, setTest] = useState<{ sent: boolean; detail: string | null; to: string } | null>(null);
  const [testing, setTesting] = useState(false);

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
          {/* Connecting is the Outlook panel's job, just below in Settings › Integrations (2026-10-06,
              the settings round) — it was a button under the calendar. */}
          <Row name="Outlook calendar" ok={p.outlook ? (p.outlook.connected ? true : p.outlook.configured ? null : false) : null} sub={p.outlook?.connected ? "connected — two-way sync" : p.outlook?.configured ? "configured — the owner connects it in the Outlook panel below" : "needs the one-time Microsoft app setup (developer)"} />
          {/* These two were a permanent grey dot and a sentence saying they work "when the key is
              set in Vercel". On 2026-09-29 the first cap order sent no receipt and no screen in the
              app could say whether email was off or broken — this panel included, which is the one
              place it should have been visible. Now it asks. */}
          <Row name="Email (Resend)" ok={p.notify ? (test?.sent === false ? false : p.notify.email) : null}
            sub={p.notify === null ? "couldn't check"
              : !p.notify.email ? "NO KEY — every customer receipt is silently skipped"
              : test?.sent === true ? `sent — check ${test.to}`
              : test?.sent === false ? `REFUSED — ${test.detail ?? "no reason given"}`
              : "key set — press Test to prove a real email actually leaves"}
            note={p.notify && !p.notify.email ? "set RESEND_API_KEY + NOTIFY_FROM_EMAIL in Vercel" : undefined} />
          {/* Keys being SET and email actually SENDING are two different facts, and on 2026-09-29
              they disagreed: both Resend vars were present and scoped to production, and the first
              cap order's receipt was still refused. Only a real send answers the second one. It
              mails the person pressing it and nobody else. */}
          <div className="intg-row">
            <span className="intg-dot unk" aria-hidden />
            <span className="intg-x"><b>Test a real email</b><span>sends one message to your own account address</span></span>
            <button type="button" className="btn-sec btn-sm" disabled={testing || !p.notify?.email} onClick={async () => {
              setTesting(true); setTest(null);
              try {
                const r = await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "test" }) });
                const j = await r.json();
                setTest(j.ok ? { sent: !!j.sent, detail: j.detail ?? null, to: j.to ?? "" } : { sent: false, detail: j.error ?? "request failed", to: "" });
              } catch (e) { setTest({ sent: false, detail: errorMessage(e), to: "" }); }
              setTesting(false);
            }}>{testing ? "Sending…" : "Test"}</button>
          </div>
          <Row name="SMS (Twilio)" ok={p.notify ? p.notify.sms : null}
            sub={p.notify === null ? "couldn't check" : p.notify.sms ? "keys set — order and delivery texts send" : "no keys — texts are skipped"} />
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
