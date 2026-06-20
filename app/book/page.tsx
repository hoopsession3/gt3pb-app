"use client";

import Link from "next/link";
import { useApp } from "@/components/AppProvider";

// Booking Tool v5 is the rate source of truth — the app NEVER quotes (runbook §8).
// Set NEXT_PUBLIC_BOOKING_URL to the hosted tool (or a /book subpath once we host the
// local HTML tool on Vercel). Until then this hands off cleanly with an honest state.
const BOOKING_URL = process.env.NEXT_PUBLIC_BOOKING_URL || "";

export default function BookScreen() {
  const { toast } = useApp();
  const wired = BOOKING_URL.length > 0;

  return (
    <section className="screen bookwrap" id="s-book">
      <div className="toprow">
        <div className="eyb">B2B · Book the bar</div>
        <Link className="pf" href="/3mpire">R</Link>
      </div>

      <div className="bookcard">
        <div className="eyb">Bring GT3PB to your event</div>
        <h2>Book the bar.</h2>
        <p>
          Corporate offsites, run clubs, launch days, weddings. We bring the full NET+ bar —
          activate, hydrate, rebuild — and pour on site. Tell us the date and headcount and
          Kayla takes it from there.
        </p>
        {wired ? (
          <a className="handle" href={BOOKING_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
            <span>Start your booking</span>
          </a>
        ) : (
          <button className="handle" onClick={() => toast("Booking hand-off pending — point the app at Booking Tool v5")}>
            <span>Start your booking</span>
          </button>
        )}
      </div>

      <div className="signoff">Pricing &amp; prep handled by Booking Tool v5. The app never quotes.</div>
    </section>
  );
}
