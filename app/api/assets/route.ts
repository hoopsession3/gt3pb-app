/* eslint-disable @typescript-eslint/no-explicit-any */
// Live assets bridge → reads the GT3 Assets Notion database (name, make/model, brand,
// GT3 use case, manual link, KB status) so Crew Mode can surface gear + its knowledge
// inline and link back to the Notion record. Token-gated: set NOTION_TOKEN (a Notion
// internal-integration secret) server-side and share the Assets DB with that integration.
// Until then this returns { enabled: false } and the Gear panel shows a setup hint.

const DB = process.env.NOTION_ASSETS_DB || "1837a183-b1d9-81a3-a222-f7d7f4683609";

export async function GET() {
  const token = process.env.NOTION_TOKEN;
  if (!token) return Response.json({ enabled: false, items: [] });

  try {
    const items: any[] = [];
    let cursor: string | undefined;
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
        const txt = (k: string) => (pr[k]?.rich_text ?? []).map((t: any) => t.plain_text).join("").trim();
        const sel = (k: string) => pr[k]?.select?.name ?? null;
        const ms = (k: string) => (pr[k]?.multi_select ?? []).map((o: any) => o.name);
        const title = (pr["Name"]?.title ?? []).map((t: any) => t.plain_text).join("").trim();
        items.push({
          name: title || "—",
          makeModel: txt("Asset Make and Model"),
          brand: sel("Brand"),
          category: ms("Asset Category"),
          useCase: txt("GT3 Use Case"),
          manual: pr["Manual / Source"]?.url ?? null,
          kbStatus: sel("KB Status"),
          qty: typeof pr["QTY"]?.number === "number" ? pr["QTY"].number : null,
          notionUrl: p.url ?? null,
        });
      }
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }
    // stable order: Performance Bar, Brew, Shared, then by name
    const rank: Record<string, number> = { "GT3 Performance Bar": 0, "GT3 Brew": 1, "Shared": 2 };
    items.sort((a, b) => (rank[a.brand] ?? 3) - (rank[b.brand] ?? 3) || a.name.localeCompare(b.name));
    return Response.json({ enabled: true, items });
  } catch (e: any) {
    return Response.json({ enabled: true, error: String(e?.message ?? e), items: [] });
  }
}
