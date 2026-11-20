// PAGE FETCH — the bounded research path reads a product page itself (no provider web tool), so the text it sends is
// cut to a known size (lib/researchBudget PAGE_TEXT_BYTES). A server fetching an address a person typed must not reach
// the platform's own network. 2026-11-11 (Ryan: "Ensure the connection uses the same public IP that passed validation,
// and repeat that check on every redirect"): each connection resolves its host ONCE, inside the socket's own lookup —
// every address in that answer must be public, and the socket connects to the first of them. There is no second
// resolution between the check and the connection, so a host that changes its answer (DNS rebinding) can't slip an
// internal address in. TLS still verifies the certificate against the host's name (SNI and Host stay the name). Each
// redirect is a new connection with the same check. A host written as an IP address gets no lookup from Node, so it is
// checked before connecting (and has nothing to re-resolve). https only, port 443, 3 redirects, 1.5 MB, 8 s.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

export const MAX_BODY_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;

/** True for an address a server must not fetch: loopback, private, link-local (cloud metadata), CGNAT, multicast,
 *  reserved, unspecified, IPv6 local/unique-local/documentation/NAT64 and IPv4-mapped forms of any of them. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return s === "::" || s === "::1" || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")
      || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("ff") || s.startsWith("64:ff9b") || s.startsWith("2001:db8") || s.startsWith("::ffff:");
  }
  return true;
}

export type Resolve = (host: string) => Promise<string[]>;
const systemResolve: Resolve = async (h) => (await dnsLookup(h, { all: true, verbatim: true })).map((a) => a.address);

/** The socket's lookup: one resolution, every address public, the first one connected to. `seen` records what was
 *  connected (for the caller's record and the tests). */
export function pinnedLookup(resolve: Resolve, isBlocked: (ip: string) => boolean, seen: string[]): LookupFunction {
  return ((host: string, opts: unknown, cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void) => {
    const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all === true;
    (isIP(host) ? Promise.resolve([host]) : resolve(host)).then((addrs) => {
      if (!addrs.length || addrs.some(isBlocked)) { const e = new Error("That address isn't on the public web.") as NodeJS.ErrnoException; e.code = "EBLOCKED"; return cb(e, ""); }
      const ip = addrs[0];
      seen.push(ip);
      return all ? cb(null, [{ address: ip, family: isIP(ip) }]) : cb(null, ip, isIP(ip));
    }, (err) => cb(err as NodeJS.ErrnoException, ""));
  }) as unknown as LookupFunction;
}

function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That isn't a web address."); }
  if (u.protocol !== "https:") throw new Error("Only https pages are read.");
  if (u.port && u.port !== "443") throw new Error("Only the standard https port is read.");
  if (u.username || u.password) throw new Error("An address with a login in it isn't read.");
  return u;
}

/** The page's readable text: tags, scripts and styles out, whitespace collapsed, cut to `maxBytes` UTF-8 bytes. */
export function pageText(html: string, maxBytes: number): string {
  const t = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  const buf = Buffer.from(t, "utf8");
  if (buf.length <= maxBytes) return t;
  return buf.subarray(0, maxBytes).toString("utf8").replace(/�+$/, "");
}

type Answer = { status: number; location: string | null; type: string; body: Buffer };
/** One GET over a socket pinned to the address its own lookup validated. */
function getOnce(url: URL, lookup: LookupFunction, extra: Partial<RequestOptions>): Promise<Answer> {
  return new Promise((resolveP, reject) => {
    const req = httpsRequest({
      host: url.hostname, servername: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: "GET",
      headers: { host: url.host, accept: "text/html,text/plain;q=0.9", "user-agent": "GT3-Library-Research/1.0" },
      lookup, agent: false, timeout: TIMEOUT_MS, ...extra,
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.resume(); return resolveP({ status, location: (res.headers.location as string | undefined) ?? null, type: "", body: Buffer.alloc(0) }); }
      const chunks: Buffer[] = []; let got = 0;
      res.on("data", (c: Buffer) => { chunks.push(c); got += c.length; if (got >= MAX_BODY_BYTES) { res.destroy(); resolveP({ status, location: null, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES) }); } });
      res.on("end", () => resolveP({ status, location: null, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("The page took too long to answer.")));
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "EBLOCKED" ? new Error("That address isn't on the public web.") : e));
    req.end();
  });
}

export type PageFetchDeps = { resolve?: Resolve; isBlocked?: (ip: string) => boolean; tls?: Partial<RequestOptions> };
/** The page's text, read over connections pinned to validated public addresses. `connected` lists the address each
 *  hop actually connected to. */
export async function fetchPageText(raw: string, maxBytes: number, deps: PageFetchDeps = {}): Promise<{ url: string; text: string; connected: string[] }> {
  const resolve = deps.resolve ?? systemResolve, isBlocked = deps.isBlocked ?? isBlockedAddress;
  const connected: string[] = [];
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    // An address written as an IP is connected to directly — Node calls no lookup for it — so it is checked here, and
    // there is nothing to resolve twice (found by the real-connection test: a redirect to the metadata IP).
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal)) { if (isBlocked(literal)) throw new Error("That address isn't on the public web."); connected.push(literal); }
    const a = await getOnce(url, pinnedLookup(resolve, isBlocked, connected), deps.tls ?? {});
    if (a.status >= 300 && a.status < 400) {
      if (!a.location || hop === 3) throw new Error("The page redirected too many times.");
      url = checkUrl(new URL(a.location, url).toString());
      continue;
    }
    if (a.status < 200 || a.status >= 300) throw new Error(`The page answered ${a.status}.`);
    if (!/text\/html|text\/plain|application\/xhtml/i.test(a.type)) throw new Error("That address isn't a web page (a PDF or file — upload a photo of its specification page instead).");
    return { url: url.toString(), text: pageText(a.body.toString("utf8"), maxBytes), connected };
  }
  throw new Error("The page redirected too many times.");
}
