// Server-only Webflow Data API (v2) client. Publishes a Studio piece to the GT3 site as a CMS
// item, then publishes the site. Host secrets: WEBFLOW_API_TOKEN (site API token), WEBFLOW_SITE_ID,
// WEBFLOW_COLLECTION_ID (the blog/updates collection). WEBFLOW_BODY_FIELD is the rich-text slug for
// the body (defaults to "post-body") — set it to match the collection's field. Never import client-side.
/* eslint-disable @typescript-eslint/no-explicit-any */

const BASE = "https://api.webflow.com/v2";

export function webflowEnabled() {
  return !!process.env.WEBFLOW_API_TOKEN && !!process.env.WEBFLOW_SITE_ID && !!process.env.WEBFLOW_COLLECTION_ID;
}

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post";

async function wf(path: string, init?: RequestInit): Promise<any> {
  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) throw new Error("WEBFLOW_API_TOKEN not set");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "accept-version": "2.0.0", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`Webflow ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const txt = await res.text(); // DELETE /live returns 204 with no body
  return txt ? JSON.parse(txt) : null;
}

// Create a published CMS item, then publish the site. Returns { itemId, slug }.
export async function webflowPublish(title: string, body: string): Promise<{ itemId: string; slug: string }> {
  const collectionId = process.env.WEBFLOW_COLLECTION_ID!;
  const siteId = process.env.WEBFLOW_SITE_ID!;
  const bodyField = process.env.WEBFLOW_BODY_FIELD || "post-body";
  const slug = `${slugify(title)}-${Math.abs(hash(title + body)).toString(36).slice(0, 5)}`;
  const fieldData: Record<string, any> = { name: title.slice(0, 256), slug, [bodyField]: body };
  const item = await wf(`/collections/${collectionId}/items/live`, {
    method: "POST",
    body: JSON.stringify({ isArchived: false, isDraft: false, fieldData }),
  });
  await wf(`/sites/${siteId}/publish`, { method: "POST", body: JSON.stringify({ publishToWebflowSubdomain: true }) });
  return { itemId: item.id ?? item._id ?? "", slug };
}

// Take a piece OFF the live site: unpublish the live CMS item (it stays in Webflow as a draft,
// so republishing later is one click), then republish the site — Webflow serves the last publish,
// not the CMS state, so without this step the page would stay up.
export async function webflowUnpublish(itemId: string): Promise<void> {
  const collectionId = process.env.WEBFLOW_COLLECTION_ID!;
  const siteId = process.env.WEBFLOW_SITE_ID!;
  await wf(`/collections/${collectionId}/items/${itemId}/live`, { method: "DELETE" });
  await wf(`/sites/${siteId}/publish`, { method: "POST", body: JSON.stringify({ publishToWebflowSubdomain: true }) });
}

// tiny deterministic hash for slug uniqueness (no Date/random in this codebase's edge paths)
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
