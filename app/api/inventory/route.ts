/* eslint-disable @typescript-eslint/no-explicit-any */
// Live inventory bridge → reads the GT3 — Inventory Notion database (on-hand
// Quantity, Reorder Point, Event Use Case, Event-Critical) so event prep can show
// have-vs-need and low-stock flags. Token-gated: set NOTION_TOKEN (a Notion internal
// integration secret) server-side and share the inventory DB with that integration.
// Until then this returns { enabled: false } and the app falls back to estimates.

import { staffFromRequest } from "@/lib/apiAuth";

const DB = process.env.NOTION_INVENTORY_DB || "40652255-7cb0-48f8-a9a0-0d4e3812b024";

export async function GET(req: Request) {
  // staff-only: inventory is internal operations data
  if (!(await staffFromRequest(req))) return Response.json({ enabled: false, items: [], error: "unauthorized" }, { status: 401 });
  const token = process.env.NOTION_TOKEN;
  if (!token) return Response.json({ enabled: false, items: [] });

  try {
    const items: any[] = [];
    let cursor: string | undefined;
    // paginate (inventories can exceed one page)
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
        cache: "no-store",
      });
      if (!res.ok) return Response.json({ enabled: true, error: `Notion ${res.status}`, items: [] });
      const data = await res.json();
      for (const p of data.results ?? []) {
        const pr = p.properties ?? {};
        const num = (k: string) => (typeof pr[k]?.number === "number" ? pr[k].number : null);
        const sel = (k: string) => pr[k]?.select?.name ?? null;
        const ms = (k: string) => (pr[k]?.multi_select ?? []).map((o: any) => o.name);
        const name = (pr["Item"]?.title ?? []).map((t: any) => t.plain_text).join("").trim();
        items.push({
          name: name || "—",
          qty: num("Quantity"),
          eventReady: num("Qty Event-Ready"),
          reorderPoint: num("Reorder Point"),
          status: sel("Status"),
          unit: sel("Unit"),
          category: sel("Category"),
          useCases: ms("Event Use Case"),
          requiredFor: ms("Required For Event Type"),
          critical: pr["Event-Critical"]?.checkbox ?? false,
          reorderLink: pr["Reorder Link"]?.url ?? null,
        });
      }
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }
    return Response.json({ enabled: true, items });
  } catch (e: any) {
    return Response.json({ enabled: true, error: String(e?.message ?? e), items: [] });
  }
}
