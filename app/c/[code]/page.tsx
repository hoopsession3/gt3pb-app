import CouponLanding from "@/components/CouponLanding";
import { PRIVATE_META } from "@/lib/seo";

// /c/CODE — the printable QR target (0268). Stable, tiny, and data-driven: the page renders
// whatever the code IS in the engine today, so printed cards never point at a dead end.
export const metadata = { ...PRIVATE_META };   // noindex, and no canonical inherited from the home page (R42, lib/seo)

export default async function CouponPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <CouponLanding code={code} />;
}
