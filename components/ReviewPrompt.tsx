"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";

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
  if (done) return <div className="rvp rvp-done">Thanks — that means a lot. 🙏</div>;

  const close = () => { try { localStorage.setItem(`gt3-reviewed-${orderId}`, "1"); } catch { /* ignore */ } };
  const submit = async () => {
    if (!supabase || rating < 1 || busy) return;
    setBusy(true);
    const { error } = await supabase.from("reviews").insert({
      user_id: user.id, name: profile?.display_name ?? null, rating, body: body.trim() || null, source: "app",
    });
    setBusy(false);
    if (!error) { close(); setDone(true); }
  };

  return (
    <section className="rvp" aria-label="Leave feedback">
      <div className="rvp-top">
        <span className="rvp-k">How was your last order?</span>
        <button type="button" className="rvp-x" aria-label="Dismiss" onClick={() => { close(); setOrderId(null); }}>✕</button>
      </div>
      <div className="rvp-stars" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === rating} aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={`rvp-star${n <= rating ? " on" : ""}`} onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <textarea className="rvp-in" rows={2} maxLength={280} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={rating >= 4 ? "What made it good? (optional)" : "What could be better? (optional)"} />
          <button type="button" className="rvp-send" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send it"}</button>
        </>
      )}
    </section>
  );
}
