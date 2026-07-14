"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSiteCopy } from "@/lib/copy";

// LAUNCH COUNTDOWN — the anticipation banner on the front door. Every word AND the date are
// owner-editable copy (Settings → Copy & wording → "Launch countdown"); blank the date to hide it.
// Deliberately framed as the FIRST DROP (the app is already live and selling) — the copy keys ship
// with that framing and the owner can retune it without a deploy. Hides itself after the date.
// Clock is read client-side only (the home page is prerendered; a render-time Date would bake build
// time into the HTML and mismatch on hydration).
export default function LaunchCountdown() {
  const t = useSiteCopy();
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dateKey = (t("launch.date") || "").trim();
  if (!now || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const target = new Date(`${dateKey}T08:00:00`);
  const ms = target.getTime() - now.getTime();
  if (Number.isNaN(target.getTime()) || ms <= 0) return null;   // day arrived → the banner retires itself

  const days = Math.floor(ms / 864e5);
  const hours = Math.floor((ms % 864e5) / 36e5);
  const mins = Math.floor((ms % 36e5) / 6e4);

  return (
    <section className="lcd" aria-label="Launch countdown">
      <div className="lcd-kicker">{t("launch.kicker")}</div>
      <h2 className="lcd-h">{t("launch.headline")}</h2>
      <div className="lcd-clock" role="timer">
        <span className="lcd-seg"><b>{days}</b><i>days</i></span>
        <span className="lcd-sep">·</span>
        <span className="lcd-seg"><b>{hours}</b><i>hrs</i></span>
        <span className="lcd-sep">·</span>
        <span className="lcd-seg"><b>{mins}</b><i>min</i></span>
      </div>
      <p className="lcd-sub">{t("launch.sub")}</p>
      <button type="button" className="lcd-cta" onClick={() => router.push("/reserve")}>{t("launch.cta")}</button>
    </section>
  );
}
