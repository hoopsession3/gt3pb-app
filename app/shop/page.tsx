import Shop from "@/components/Shop";
import { pageMeta } from "@/lib/seo";

// Its name, and what search and a share card say about it (R42, lib/seo): its own description, canonical address and card.
export const metadata = { title: "Shop", ...pageMeta("/shop") };

export default function ShopPage() {
  return <Shop />;
}
