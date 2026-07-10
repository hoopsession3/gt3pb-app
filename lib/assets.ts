// Live assets (from /api/assets → the GT3 Assets DB in Notion). Surfaces each asset's
// GT3 use case + manufacturer manual in Crew Mode, linking back to the Notion record.

export interface AssetItem {
  id: string;
  name: string;
  makeModel: string;
  brand: string | null;
  category: string[];
  useCase: string;
  manual: string | null;
  kbStatus: string | null;
  qty: number | null;
  notes: string | null;
  notionUrl: string | null;
  lenIn: number | null; widthIn: number | null; heightIn: number | null; weightLb: number | null;
}
export interface AssetsResp { enabled: boolean; items: AssetItem[]; error?: string }

import { authedFetch } from "./authedFetch";

export async function fetchAssets(): Promise<AssetsResp> {
  try {
    const r = await authedFetch("/api/assets", { cache: "no-store" });
    return (await r.json()) as AssetsResp;
  } catch {
    return { enabled: false, items: [] };
  }
}
