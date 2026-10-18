// THE EDGE RUNTIME, AS supabase/functions/push USES IT (R21, 2026-10-18 — the 10/10 audit, operations F12). The function
// runs on Supabase's Deno, which no build here has: these are the few names it uses from there, written down so
// `tsc -p tsconfig.functions.json` (scripts/functions.check.mjs, in `npm test`) can check the function's own code.
// supabase-js is checked against the real package (the version the app installs — the tsconfig's paths); web-push's two
// calls are declared below as web-push 3.6.7 documents them. Not deployed: Supabase deploys a function's import graph,
// and nothing imports this file (a folder whose name starts with "_" is never a function of its own).

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

declare module "npm:web-push@3.6.7" {
  type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  type SendResult = { statusCode: number; body: string; headers: Record<string, string> };
  type RequestOptions = {
    TTL?: number; headers?: Record<string, string>; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string;
    /** Milliseconds before the request to the push service is given up (web-push's own option). */
    timeout?: number;
  };
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    /** Rejects with a WebPushError carrying the push service's statusCode when it refuses. */
    sendNotification(subscription: PushSubscription, payload?: string | null, options?: RequestOptions): Promise<SendResult>;
  };
  export default webpush;
}
