import { createPrivateKey, sign } from "node:crypto";

// AN APPLE .p8, AS THE SERVER USES IT (2026-10-11). Two Apple keys sign things here: the Maps key (lib/appleMaps: the
// Maps Server API's token, the snapshot's signature) and the Sign in with Apple key (lib/appleSignIn: the client
// secret Apple's token and revoke endpoints ask for). Each is a .p8 pasted into Vercel by Ryan; neither is ever read
// anywhere but here, on the server.

export const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** The .p8's text, however it was pasted into Vercel: literal \n, lost line breaks, a dropped BEGIN or END line — the
 *  key is rebuilt from its own base64, the way the TestFlight job rebuilds the App Store Connect key. */
export function pem(text: string): string {
  const body = text.replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[A-Z ]*-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  return `-----BEGIN PRIVATE KEY-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** An ES256 JWT, signed in the JWS form (r‖s) — what Apple's endpoints read. */
export function es256Jwt(header: Record<string, unknown>, claims: Record<string, unknown>, keyText: string): string {
  const head = b64url(JSON.stringify({ alg: "ES256", ...header }));
  const body = b64url(JSON.stringify(claims));
  const key = createPrivateKey(pem(keyText));
  return `${head}.${body}.${b64url(sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }))}`;
}
