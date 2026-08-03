import CouponLanding from "@/components/CouponLanding";

// /c/CODE — the printable QR target (0268). Stable, tiny, and data-driven: the page renders
// whatever the code IS in the engine today, so printed cards never point at a dead end.
export const metadata = { robots: { index: false, follow: false } };

export default async function CouponPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <CouponLanding code={code} />;
}
