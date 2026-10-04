// THE SHOP'S CART, AS THE STOREFRONT HOLDS IT (2026-10-04).
//
// Lifted out of components/Shop.tsx, where it was private, so the merch checkout can be its own
// screen loaded when it is wanted (components/ShopCheckout): a visitor browsing the capsule
// downloads the grid, not the card form and its list of fifty states. Same types, same label.

export type Variant = { size?: string; color?: string; sku?: string; apliiq_variant_id?: string; [k: string]: unknown };
export type Product = { id: string; title: string; blurb: string | null; price_cents: number; image_url: string | null; images: string[]; variants: Variant[]; public_title: string | null; media?: unknown };
export type CartLine = { product: Product; variant: Variant | null; qty: number };

/** {size, color} → "M · Black": how a variant reads to the shopper, and how two cart lines are told apart. */
export const variantLabel = (v: Variant | null) => (v ? [v.size, v.color].filter(Boolean).join(" · ") : "");
