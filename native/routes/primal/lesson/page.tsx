"use client";

// THE APP'S LESSON PAGE (2026-10-06, the iPhone round). The web's lesson lives at /primal/l/<slug>, a
// page per lesson made on request; a static export cannot make those ahead of time (lib/native
// lessonHref). This page is copied into the app build only (scripts/build.app.mjs) and shows the
// same lesson, the same component, from ?slug= — the web never has this route.
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import PrimalLesson from "@/components/PrimalLesson";

function Lesson() {
  const slug = useSearchParams().get("slug") ?? "";
  return slug ? <PrimalLesson key={slug} slug={slug} /> : null;
}

export default function PrimalLessonInApp() {
  return (
    <Suspense fallback={null}>
      <Lesson />
    </Suspense>
  );
}
