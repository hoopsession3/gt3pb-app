import type { SupabaseClient } from "@supabase/supabase-js";

// ONE CALLER'S LIMIT BEFORE EVERYONE'S (R10, 2026-10-16 — the 10/10 audit of the back end).
//
// A door with a limit for each caller and a ceiling for everyone together asked both at once, and the store counted every
// try — the ones it refused too (rate_limit_hit, 0154). So one script from one address, long past its own limit, kept
// spending the count every customer shares: sixty-one tiny posts a minute closed card checkout for everybody. Now the
// limits are asked in order — the caller's own first, everyone's last — and the first one over stops the asking: a try
// refused by its own limit never reaches the shared one, and the store no longer counts a refused try at all (0419).
//
// Fails open when the store cannot be asked (an error or a throw, not a "no"): a store outage is not a reason to turn a
// customer away, and at the card doors Square's own fraud tools are the backstop, as before. A limit the store could not
// be asked about is passed over and the next one is still asked.
export type Limit = { bucket: string; windowMs: number; max: number };

/** Do these tries fit, asked in order (most particular first)? False at the first limit that is over. */
export async function limitsFit(db: Pick<SupabaseClient, "rpc">, limits: readonly Limit[]): Promise<boolean> {
  for (const l of limits) {
    let over = false;
    try {
      const { data, error } = await db.rpc("rate_limit_hit", { p_bucket: l.bucket, p_window_ms: l.windowMs, p_max: l.max });
      over = !error && data === false;
    } catch { over = false; }
    if (over) return false;
  }
  return true;
}

/** The address a request came from, as the platform says it (Vercel sets x-forwarded-for; its first entry is the caller),
 *  as a limit counts it (limitAddress). Every per-caller limit in the app asks with this. */
export function callerIp(req: Request): string {
  return limitAddress((req.headers.get("x-forwarded-for") || "").split(",")[0]) || "anon";
}

/** A caller as a limit counts them (R18 review): an IPv4 address as it is, an IPv6 one by its /64 — the block a home, a
 *  phone or a server is handed whole, so a script inside it could walk to a fresh address, and a fresh limit, at will.
 *  An IPv4 address written as IPv6 (::ffff:a.b.c.d, or in hex ::ffff:c000:201) is its IPv4; a port after one is dropped.
 *  Anything that isn't an address is kept as it came. Pure. */
export function limitAddress(ip: string): string {
  const a = ip.trim().replace(/^\[|\](?::\d+)?$/g, "").replace(/%.*$/, "").toLowerCase();
  const quad = (q: string) => q.split(".").every((n) => Number(n) <= 255);
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a) ?? /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(a);
  if (v4) return quad(v4[1]) ? v4[1] : a;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  if (!a.includes(":")) return a;
  const halves = a.split("::");
  if (halves.length > 2) return a;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // An IPv4 address may close an IPv6 one (its last 32 bits) — only there, and only a real one.
  const end = halves.length === 2 ? tail : head;   // the address's own last group — never one "::" follows
  const last = end.length ? end[end.length - 1] : "";
  if (last.includes(".")) {
    const q = last;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(q) || !quad(q)) return a;
    end.splice(-1, 1, "0", "0");
  }
  const gap = 8 - head.length - tail.length;
  if (gap < 0 || (halves.length === 1 && gap !== 0)) return a;
  const all = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return a;
  return `${all.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
