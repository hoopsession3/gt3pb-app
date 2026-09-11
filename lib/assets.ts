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
  // Lifecycle (0276). Defaulted in the API mapper, so these are safe to read even before the
  // migration is applied: an un-migrated row reads as an active Greenville asset, which is exactly
  // what every row meant before equipment had a lifecycle.
  market: string;
  status: string;
  criticality: string;
  disposition: string | null;
  retiredOn: string | null;
}
export interface AssetsResp { enabled: boolean; items: AssetItem[]; error?: string }

import { authedFetch } from "./authedFetch";

export async function fetchAssets(): Promise<AssetsResp> {
  try {
    const r = await authedFetch("/api/assets", { cache: "no-store" });
    return (await r.json()) as AssetsResp;
  } catch (e) {
    // enabled:TRUE is the honest answer here, and this catch used to return false.
    //
    // The three fields mean three different things. `enabled` is whether the register is reachable
    // AS THIS VIEWER; `error` is "we could not ask"; `items` is the answer. /api/assets already
    // keeps them apart — a failed query comes back { enabled: true, error, items: [] } and the
    // panel prints "Couldn't reach the asset register: …". This catch was the one path that
    // collapsed all three, and GearLibrary renders !enabled as
    //     "Sign in as crew to see the gear library."
    // So a signed-in owner whose request dropped was told he was not signed in — a claim about who
    // somebody IS, made on the evidence of a network blip.
    return { enabled: true, items: [], error: e instanceof Error ? e.message : "couldn't reach the asset register" };
  }
}
