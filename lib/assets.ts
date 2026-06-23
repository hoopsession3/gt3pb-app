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

import { supabase } from "./supabase";

export async function fetchAssets(): Promise<AssetsResp> {
  try {
    const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
    const r = await fetch("/api/assets", { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return (await r.json()) as AssetsResp;
  } catch {
    return { enabled: false, items: [] };
  }
}
