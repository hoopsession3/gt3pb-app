"use client";

import { useEffect, useState } from "react";
import { fetchAssets, type AssetItem, type AssetsResp } from "@/lib/assets";

// Gear & manuals — reads the GT3 Assets DB from Notion (the bridge) and surfaces each
// asset's GT3 use case + manufacturer manual, with a link back to the Notion record.
// Lives in Crew Mode → Prep. Until NOTION_TOKEN is set it shows a one-line setup hint.

const BRAND_ORDER = ["GT3 Performance Bar", "GT3 Brew", "Shared"];

export default function GearLibrary() {
  const [resp, setResp] = useState<AssetsResp | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => { fetchAssets().then(setResp); }, []);
  if (!resp) return null;

  if (!resp.enabled) {
    return (
      <div className="adm-sec gl">
        <div className="sec">Gear &amp; manuals</div>
        <div className="gl-hint">Connect Notion to pull your equipment + manuals here — set <b>NOTION_TOKEN</b> in Vercel and share the Assets DB with the integration.</div>
      </div>
    );
  }

  const items = resp.items;
  return (
    <div className="adm-sec gl">
      <button className="gl-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sec">Gear &amp; manuals · {items.length}</span>
        <span className="gl-chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (resp.error ? (
        <div className="gl-hint">Couldn&apos;t reach Notion: {resp.error}</div>
      ) : (
        <div className="gl-body">
          {BRAND_ORDER.map((b) => {
            const list = items.filter((i) => (i.brand ?? "Shared") === b);
            if (!list.length) return null;
            return (
              <div key={b} className="gl-brand">
                <div className="gl-brand-h">{b}</div>
                {list.map((it: AssetItem) => (
                  <div key={it.name} className="gl-item">
                    <div className="gl-item-main">
                      <b>{it.name}{it.qty && it.qty > 1 ? ` ×${it.qty}` : ""}</b>
                      {it.useCase && <span className="gl-uc">{it.useCase}</span>}
                    </div>
                    <div className="gl-links">
                      {it.manual && <a href={it.manual} target="_blank" rel="noopener noreferrer">Manual ↗</a>}
                      {it.notionUrl && <a href={it.notionUrl} target="_blank" rel="noopener noreferrer">Record ↗</a>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
