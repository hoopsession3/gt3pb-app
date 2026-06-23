// Server-only Canva Connect API client. The app (Vercel) can't use the editor's MCP connection —
// it calls Canva's REST API with a host-side token. CANVA_ACCESS_TOKEN is an OAuth access token
// for an account with the design:content + asset scopes; CANVA_BRAND_TEMPLATE_ID is the GT3
// template to autofill. Both are host secrets — never import this client-side.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BASE = "https://api.canva.com/rest/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function canvaEnabled() {
  return !!process.env.CANVA_ACCESS_TOKEN && !!process.env.CANVA_BRAND_TEMPLATE_ID;
}

async function cv(path: string, init?: RequestInit): Promise<any> {
  const token = process.env.CANVA_ACCESS_TOKEN;
  if (!token) throw new Error("CANVA_ACCESS_TOKEN not set");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Canva ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Autofill a brand template with text → returns the new design { id, urls:{edit_url, view_url} }.
// `data` keys must match the template's field names (configure the template once in Canva).
export async function canvaAutofill(fields: Record<string, string>): Promise<{ id: string; editUrl: string }> {
  const brand_template_id = process.env.CANVA_BRAND_TEMPLATE_ID!;
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields)) if (v) data[k] = { type: "text", text: v };
  const start = await cv("/autofills", { method: "POST", body: JSON.stringify({ brand_template_id, data }) });
  let job = start.job;
  for (let i = 0; i < 15 && job?.status !== "success" && job?.status !== "failed"; i++) {
    await sleep(2000);
    job = (await cv(`/autofills/${start.job.id}`)).job;
  }
  if (job?.status !== "success") throw new Error(`Canva autofill ${job?.status ?? "timed out"}`);
  const design = job.result?.design ?? job.result;
  return { id: design.id, editUrl: design.urls?.edit_url ?? design.url ?? "" };
}

// Export a design to a shareable file URL (png/pdf).
export async function canvaExport(designId: string, format: "png" | "pdf" = "png"): Promise<string> {
  const start = await cv("/exports", { method: "POST", body: JSON.stringify({ design_id: designId, format: { type: format } }) });
  let job = start.job;
  for (let i = 0; i < 15 && job?.status !== "success" && job?.status !== "failed"; i++) {
    await sleep(2000);
    job = (await cv(`/exports/${start.job.id}`)).job;
  }
  if (job?.status !== "success") throw new Error(`Canva export ${job?.status ?? "timed out"}`);
  return job.urls?.[0] ?? "";
}
