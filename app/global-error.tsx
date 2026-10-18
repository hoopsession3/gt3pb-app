"use client";

import { useEffect } from "react";
import { recoverFromCrash } from "@/components/ErrorReporter";

// THE LAST SCREEN (R11, 2026-10-16 — the 10/10 audit). app/error.tsx catches a crash inside a page and nothing above it:
// the root layout — AuthProvider, AppProvider, the shell and everything it draws around the page — fell through to Next's
// built-in "This page couldn't load", unbranded, with no report (the reporter lived in the tree that had crashed) and no
// heal for a tab one build behind (only app/error.tsx had one). A customer opening the cart on a tab older than the last
// deploy lost the app instead of reloading into the new build.
//
// This screen replaces the whole document while it shows (Next: it brings its own <html> and <body>, and none of the
// app's stylesheet or metadata), so it carries its own few rules, in the house dark — charcoal, cream, the GT red — with
// the phone's own type, clear of the notch and the home indicator. components/Fence keeps most chrome crashes from
// reaching it at all; what still does is the layout itself.
const CSS = `
html,body{margin:0;background:#15120d;color-scheme:dark}
body{min-height:100dvh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;color:#F5F1E8;
  padding:calc(24px + env(safe-area-inset-top,0px)) 24px calc(24px + env(safe-area-inset-bottom,0px));
  font-family:-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",Roboto,sans-serif}
main{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:360px}
h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-.2px}
p{margin:0;font-size:16px;line-height:1.5;color:rgba(245,241,232,.8)}
[role=group]{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:6px}
button{min-height:44px;padding:0 18px;border-radius:12px;font:inherit;font-size:16px;font-weight:600;cursor:pointer;color:#F5F1E8}
button[data-kind=pri]{border:0;background:#B82420}
button[data-kind=sec]{border:1px solid rgba(245,241,232,.5);background:transparent}
code{margin-top:10px;font-size:13px;color:rgba(245,241,232,.7);letter-spacing:.4px}
`;

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
    recoverFromCrash(error, { where: "app" });
  }, [error]);
  const reload = () => window.location.reload();
  // A way off a screen that crashes every time it is drawn: in the iPhone app there is no browser around the page to go
  // back with. Where this screen was reached from, or the front door when it was the first.
  // A page load on purpose: the whole tree threw, and the router is part of what threw.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the app crashed; only a fresh load is sure to draw
  const back = () => { if (window.history.length > 1) window.history.back(); else window.location.assign("/"); };
  return (
    <html lang="en">
      <head>
        <title>GT3 Performance Bar</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#15140f" />
        <style>{CSS}</style>
      </head>
      <body>
        <main>
          <h1>Something went sideways</h1>
          <p>A hiccup on our end — not you. Try again, and if it keeps happening, {error.digest ? "send us the code below" : "let us know"}.</p>
          <div role="group" aria-label="What to do">
            <button type="button" data-kind="pri" onClick={() => unstable_retry()}>Try again</button>
            <button type="button" data-kind="sec" onClick={reload}>Reload</button>
            <button type="button" data-kind="sec" onClick={back}>Back</button>
          </div>
          {error.digest && <code>ref: {error.digest}</code>}
        </main>
      </body>
    </html>
  );
}
