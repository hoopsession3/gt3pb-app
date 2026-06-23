// Live assets (from /api/assets → the GT3 Assets DB in Notion). Surfaces each asset's
// GT3 use case + manufacturer manual in Crew Mode, linking back to the Notion record.

export interface AssetItem {
  name: string;
  makeModel: string;
  brand: string | null;
  category: string[];
  useCase: string;
  manual: string | null;
  kbStatus: string | null;
  qty: number | null;
  notionUrl: string | null;
}
export interface AssetsResp { enabled: boolean; items: AssetItem[]; error?: string }

export async function fetchAssets(): Promise<AssetsResp> {
  try {
    const r = await fetch("/api/assets", { cache: "no-store" });
    return (await r.json()) as AssetsResp;
  } catch {
    return { enabled: false, items: [] };
  }
}
