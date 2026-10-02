import { NextResponse } from "next/server";
import { route } from "@/lib/apiRoute";

// public: returns 503 until Apple pass certificates exist; a signed pass is the member's own and carries nothing secret
// Apple Wallet membership pass. A real .pkpass must be signed with the GT3 **Pass Type ID
// certificate + private key** and the **Apple WWDR** cert — provided via env (base64). Until those
// exist this returns 503, and the app hides the "Add to Apple Wallet" button (NEXT_PUBLIC_WALLET_READY).
// Set: APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT, APPLE_PASS_KEY, APPLE_WWDR.
async function get() {
  const haveCerts =
    process.env.APPLE_PASS_TYPE_ID && process.env.APPLE_TEAM_ID &&
    process.env.APPLE_PASS_CERT && process.env.APPLE_PASS_KEY && process.env.APPLE_WWDR;
  if (!haveCerts) {
    return NextResponse.json(
      { error: "Apple Wallet isn't switched on yet — add the GT3 Pass Type ID cert + key + WWDR (APPLE_PASS_* env) and NEXT_PUBLIC_WALLET_READY=1." },
      { status: 503 },
    );
  }
  // With certs present, assemble pass.json for the authenticated member (name, points, a QR barcode =
  // their card code) and sign it into a .pkpass, returned as application/vnd.apple.pkpass. Needs a
  // signing step (e.g. passkit-generator / node-forge) — wire it here once the certs are in place.
  return NextResponse.json({ error: "Pass signing not implemented in this build." }, { status: 501 });
}

export const GET = route("wallet/pass", get);
