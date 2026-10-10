import { NextResponse } from "next/server";
import { route } from "@/lib/apiRoute";
import CONFIG from "@/lib/publicConfig.json";

// public: the web's NEXT_PUBLIC_* settings, which Next.js already writes into every page's script — by name from lib/publicConfig.json, nothing else
// THE WEB'S PUBLIC SETTINGS, FOR THE IPHONE BUILD (2026-10-10). The iPhone app is a static build made in GitHub
// Actions (.github/workflows/ios.yml), and it carried the web's NEXT_PUBLIC_* settings only where someone had copied
// each into the repository's variables by hand. Build 72 shipped with Supabase's two and none of the rest, so its
// checkout had no Square card form and took no cards. Copying by hand needs a machine with the Vercel and GitHub
// command lines, which no session working on this app has. So the build asks the web it mirrors
// (scripts/build.app.mjs --web-config), and this answers.
//
// What it answers is already public: a NEXT_PUBLIC_ value is written into the script every visitor downloads.
// It answers only the names on lib/publicConfig.json's list, never a name off it or a name without the prefix, so
// a secret added to the project later is never one of them. A value is a short line of text or it is left out.
const SAFE = /^[\x20-\x7e]{1,300}$/;

async function get() {
  const values: Record<string, string> = {};
  for (const name of CONFIG.names) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    const v = process.env[name];
    if (typeof v === "string" && SAFE.test(v)) values[name] = v;
  }
  return NextResponse.json({ values }, { headers: { "cache-control": "no-store" } });
}

export const GET = route("public-config", get);
