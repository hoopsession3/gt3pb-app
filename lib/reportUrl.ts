// THE ADDRESS A REPORT MAY CARRY (R10b, 2026-10-16 — the 10/10 audit).
//
// components/ErrorReporter sent window.location.href with every crash, and the crew read every report (Settings › Errors):
// an /order?t=… ticket in it can cancel that order, a code or key can sign someone in. A report carries the path, and a
// query value only when it is a short plain word (a section, a tab); everything else goes as "…", and the fragment never
// goes. Pure.
export function shareableUrl(loc: { origin: string; pathname: string; search: string }): string {
  const q = new URLSearchParams(loc.search);
  const kept: string[] = [];
  q.forEach((v, k) => {
    const secret = /^(t|ticket|token|code|key|k|share|sig|signature|otp|access_token|refresh_token|email|phone)$/i.test(k);
    kept.push(`${encodeURIComponent(k)}=${!secret && /^[A-Za-z0-9_-]{1,24}$/.test(v) && !/^[0-9a-f-]{20,}$/i.test(v) ? v : "…"}`);
  });
  return `${loc.origin}${loc.pathname}${kept.length ? `?${kept.join("&")}` : ""}`;
}
