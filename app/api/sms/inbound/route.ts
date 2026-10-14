import { NextResponse } from "next/server";
import { twilioSignatureOk } from "@/lib/webhookSignature";
import { sayTextConsent } from "@/lib/notify";
import { raiseAlert } from "@/lib/serverAlerts";
import { textKeyword, e164, phoneShown } from "@/lib/texts";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs"; // node crypto for the signature

// A TEXT SENT TO US (2026-10-14, R5 of the customer audit — decided 2026-10-13: texts with a recorded yes, STOP honoured).
// Twilio posts every text sent to the GT3 number here. It proves it is Twilio (x-twilio-signature over the URL set on the
// number and the form it sent — lib/webhookSignature), or it is refused, 401, and nothing is written.
//
//   · STOP (and the words carriers treat as it) — the number's yes is withdrawn (0398 say_text_consent): nothing more
//     is texted to it until it says START.
//   · START / YES / UNSTOP — its yes stands again.
//   · HELP — nothing to record.
//   · anything else is a person writing to us: the crew hear it, with the number, in their inbox — a text nobody reads
//     is a customer ignored.
//
// Twilio's own keyword handling answers STOP, START and HELP on the phone (its standard replies, on every US number),
// so this answers with an empty reply and never a second message. TWILIO_AUTH_TOKEN and the number's webhook URL are
// set by Ryan when the number is registered; until then this answers 503 and records nothing.
const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new NextResponse(EMPTY, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });

// The URL Twilio signs is the one set on the number, exactly — not req.url, which behind Vercel's proxy may differ.
const inboundUrl = () => process.env.TWILIO_WEBHOOK_URL
  || (process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/sms/inbound` : "");

async function post(req: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const url = inboundUrl();
  if (!token || !url) return NextResponse.json({ ok: false, error: "Texts aren't switched on yet." }, { status: 503 });

  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  if (!twilioSignatureOk(params, req.headers.get("x-twilio-signature"), token, url)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const from = e164(params.From);
  if (!from) return twiml();
  const said = textKeyword(params.Body);
  if (said === "stop") {
    const r = await sayTextConsent(from, false, "stop_text", null);
    // A STOP that could not be kept is the one thing here that must not be lost: the crew record it by hand.
    if (!r.ok) {
      await raiseAlert({ severity: "critical", category: "order", kind: "text_stop_unrecorded", title: "A STOP text wasn't recorded — stop texting this number",
        body: `${phoneShown(from)} replied STOP and it could not be kept (${r.detail ?? "no reason given"}). Twilio has stopped texts to it on its side; record it before texts go out again.`, link: "/crew" });
    }
    return twiml();
  }
  if (said === "start") {
    await sayTextConsent(from, true, "start_text", null);
    return twiml();
  }
  if (said === "help") return twiml();

  const words = String(params.Body ?? "").trim().slice(0, 600);
  if (words) {
    await raiseAlert({ severity: "important", category: "order", kind: "customer_text", title: `Text from ${phoneShown(from)}`,
      body: `${words}\n\n(This inbox can't text back.)`, link: "/crew" });
  }
  return twiml();
}

export const POST = route("sms/inbound", post);
