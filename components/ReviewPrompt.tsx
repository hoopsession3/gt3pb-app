"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";
import Icon from "@/components/Icon";
import { useStepFocus } from "@/components/useStepFocus";

// Post-pickup feedback — only shows AFTER a recent pickup, tied to that order, and never again once
// answered (or dismissed). Not a permanent fixture on the account. Reviews go in UNAPPROVED; a staffer
// approves before anything reaches the truck display, and lib/reviews scrubs it there.
const WINDOW_MS = 72 * 60 * 60 * 1000; // a pickup is "recent" for 3 days

export default function ReviewPrompt() {
  const { user, profile } = useAuth();
  const [orderId, setOrderId] = useState<string | null>(null); // the order we're asking about
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const stars = useRef<(HTMLButtonElement | null)[]>([]);
  // Sent, said where focus goes (R34 — the audit's UX11-05): "Send it" went with the form, focus fell to the page and the
  // thanks was never heard. The thanks takes focus as it replaces the form.
  const scope = useRef<HTMLElement>(null);
  useStepFocus(done, scope, { pick: () => (done ? scope.current : null) });

  // Find the most recent picked-up order in the window that hasn't been reviewed/dismissed yet.
  useEffect(() => {
    if (!supabase || !user) return;
    let live = true;
    (async () => {
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { data } = await supabase!.from("orders")
        .select("id, status_changed_at").eq("user_id", user.id).eq("status", "done")
        .gte("status_changed_at", since).order("status_changed_at", { ascending: false }).limit(1);
      const ord = (data as { id: string }[] | null)?.[0];
      if (!live || !ord) return;
      try { if (localStorage.getItem(`gt3-reviewed-${ord.id}`)) return; } catch { /* ignore */ }
      setOrderId(ord.id);
    })();
    return () => { live = false; };
  }, [user]);

  if (!user || !orderId) return null; // nothing to ask about → not on screen
  if (done) return <section ref={scope} className="rvp rvp-done" aria-label="Feedback sent">Thanks — that means a lot.</section>;

  const close = () => { try { localStorage.setItem(`gt3-reviewed-${orderId}`, "1"); } catch { /* ignore */ } };
  // A SEND THAT FAILED SAYS SO (R8, 2026-10-16): "Sending…" went back to "Send it" and nothing else happened, so a member
  // who had written a few lines could not tell it had not gone. What they wrote stays where it is.
  const submit = async () => {
    if (!supabase || rating < 1 || busy) return;
    setBusy(true); setErr("");
    const { error } = await supabase.from("reviews").insert({
      user_id: user.id, name: profile?.display_name ?? null, rating, body: body.trim() || null, source: "app",
    });
    setBusy(false);
    if (!error) { close(); setDone(true); }
    else setErr("Couldn’t send that — check your connection and try again.");
  };
  // One choice among five, as a radio group is used (R8): Tab reaches the group once, the arrows move the rating.
  const pick = (n: number) => { setRating(n); setErr(""); };
  const onStarsKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = Math.min(5, Math.max(1, (rating || (step > 0 ? 0 : 6)) + step));
    pick(n);
    stars.current[n - 1]?.focus();
  };

  return (
    <section ref={scope} className="rvp" aria-label="Leave feedback">
      <div className="rvp-top">
        <span className="rvp-k">How was your last order?</span>
        <button type="button" className="rvp-x hit-44" aria-label="Dismiss" onClick={() => { close(); setOrderId(null); }}><Icon name="close" /></button>
      </div>
      <div className="rvp-stars" role="radiogroup" aria-label="Rating" onKeyDown={onStarsKey}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} ref={(el) => { stars.current[n - 1] = el; }} type="button" role="radio" aria-checked={n === rating}
            tabIndex={n === (rating || 1) ? 0 : -1} aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={`rvp-star inline-flex min-h-11 min-w-11 items-center justify-center${n <= rating ? " on" : ""}`} onClick={() => pick(n)}><Icon name="star" /></button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <textarea className="rvp-in" rows={2} maxLength={280} value={body} onChange={(e) => setBody(e.target.value)}
            aria-label={rating >= 4 ? "What made it good? (optional)" : "What could be better? (optional)"}
            placeholder={rating >= 4 ? "What made it good? (optional)" : "What could be better? (optional)"} />
          {err && <p className="mb-2 text-footnote text-red-hover" role="alert">{err}</p>}
          <button type="button" className="btn-pri" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send it"}</button>
        </>
      )}
    </section>
  );
}
