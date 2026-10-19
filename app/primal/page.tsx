import PrimalAcademy from "@/components/PrimalAcademy";
import { pageMeta } from "@/lib/seo";

// Its name, and what search and a share card say about it (R42, lib/seo): its own description, canonical address and card.
export const metadata = { title: "Return to Primal", ...pageMeta("/primal") };

export default function PrimalPage() {
  return <PrimalAcademy />;
}
