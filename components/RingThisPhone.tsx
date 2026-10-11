"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { ringWords, RING_IDLE, type RingWords } from "@/lib/ringPhone";
import { haptic } from "@/lib/haptics";
import { APP_BUILD } from "@/lib/native";
import { NATIVE_PUSH_ON } from "@/lib/nativePush";

// RING THIS PHONE (2026-10-11, wave 2 · alerts). "Order alerts: On" was the browser's permission and nothing more —
// it could not say whether this phone is still kept for you (0366) or whether a push reaches it. This sends a real
// alert to your own devices and nobody else's (0374 ring_my_devices), and the row says what happened. It lives in
// Settings › You › Notifications and in the inbox's notification sheet (components/NotifPrefs), the two doors to the
// same settings.

/** One press: a test alert to my own devices; the line under the title says what happened. */
export function RingThisPhone() {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<RingWords | null>(null);
  // In the iPhone app before its own alerts are live there is nothing on this phone to ring — DeviceAlerts' rule, and
  // App Review's: a button that rings nothing here is a placeholder (2.1).
  if (APP_BUILD && !NATIVE_PUSH_ON) return null;
  const ring = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = supabase ? await supabase.rpc("ring_my_devices") : { data: null, error: { code: "", message: "" } };
      const words = ringWords(answer);
      setSaid(words);
      if (words.sent) haptic("success"); else haptic("warning");
    } catch {
      setSaid(ringWords({ error: { code: "", message: "" } }));
      haptic("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pay-row">
      <div className="pay-row-l">
        <div className="pay-row-t">Ring this phone</div>
        <div className="pay-row-s" role="status" aria-live="polite">{said ? said.say : RING_IDLE}</div>
      </div>
      <button type="button" className="btn-sec btn-sm" onClick={ring} disabled={busy} aria-busy={busy}>
        {busy ? "Ringing…" : said ? "Ring again" : "Ring"}
      </button>
    </div>
  );
}
