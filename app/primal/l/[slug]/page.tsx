import PrimalLesson from "@/components/PrimalLesson";

export default async function PrimalLessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PrimalLesson slug={slug} />;
}
