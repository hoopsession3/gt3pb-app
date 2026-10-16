import { NextResponse } from "next/server";
import crypto from "crypto";
import { userFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { route } from "@/lib/apiRoute";

// Google Wallet — a "Save to Google Wallet" link is a JWT (RS256) signed with the GT3 service-account
// key, carrying the member's loyalty object (stamps + a QR barcode of their card code). No pkpass
// bundle, no extra deps — just node crypto. Dormant until the Google Wallet creds are set:
// GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_SUFFIX, GOOGLE_WALLET_SA_EMAIL, GOOGLE_WALLET_SA_KEY.
const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
function signJwt(payload: object, key: string): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key.replace(/\\n/g, "\n")).toString("base64url");
  return `${header}.${body}.${sig}`;
}

async function get(req: Request) {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  const classSuffix = process.env.GOOGLE_WALLET_CLASS_SUFFIX;
  const saEmail = process.env.GOOGLE_WALLET_SA_EMAIL;
  const saKey = process.env.GOOGLE_WALLET_SA_KEY;
  if (!issuerId || !classSuffix || !saEmail || !saKey || !supabaseAdmin) {
    return NextResponse.json({ error: "Google Wallet isn't switched on yet — set GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_SUFFIX, GOOGLE_WALLET_SA_EMAIL, GOOGLE_WALLET_SA_KEY (and NEXT_PUBLIC_GOOGLE_WALLET=1)." }, { status: 503 });
  }
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

  const { data: p } = await supabaseAdmin.from("profiles").select("display_name, referral_code").eq("id", user.id).maybeSingle();
  const prof = p as { display_name: string | null; referral_code: string | null } | null;
  const code = prof?.referral_code || user.id;
  const classId = `${issuerId}.${classSuffix}`;
  const objectId = `${issuerId}.gt3-${user.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const origin = new URL(req.url).origin;

  // NO STAMP COUNT ON THE PASS (R8, 2026-10-16). A save link writes the object once; nothing here updates it after (that is
  // Google's REST API, from the server, on every stamp), so "Stamps: 3" stood on the card in Wallet for ever while the cup
  // count moved on. The pass is the card itself — the name and the code the window scans, which reads the account live —
  // and the stamps are where they are always current, in the app.
  const loyaltyObject = {
    id: objectId, classId, state: "ACTIVE",
    accountName: prof?.display_name || "GT3 Member",
    accountId: String(code),
    barcode: { type: "QR_CODE", value: `${origin}/scan?m=${encodeURIComponent(String(code))}`, alternateText: (prof?.referral_code || String(code).slice(0, 8)).toUpperCase() },
  };
  const jwt = signJwt({
    iss: saEmail, aud: "google", typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000), origins: [origin],
    payload: { loyaltyObjects: [loyaltyObject] },
  }, saKey);

  return NextResponse.json({ saveUrl: `https://pay.google.com/gp/v/save/${jwt}` });
}

export const GET = route("wallet/google", get);
