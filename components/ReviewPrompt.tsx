"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/lib/supabase";

// Post-pickup feedback for signed-in members. Goes in UNAPPROVED — a staffer approves before it can
// ever reach the truck display, and lib/reviews scrubs it there. One light account gate on spam.
export default function ReviewPrompt() {
  const { user, profile } = useAuth();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!user) return null;
  if (done) return <div className="rvp rvp-done">Thanks — that means a lot. 🙏</div>;

  const submit = async () => {
    if (!supabase || rating < 1 || busy) return;
    setBusy(true);
    const { error } = await supabase.from("reviews").insert({
      user_id: user.id, name: profile?.display_name ?? null, rating, body: body.trim() || null, source: "app",
    });
    setBusy(false);
    if (!error) setDone(true);
  };

  return (
    <section className="rvp" aria-label="Leave feedback">
      <div className="rvp-k">How was it?</div>
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
