import { ORDER_STEPS } from "@/lib/orderWords";

// WHERE THE ORDER IS, IN FOUR STEPS (R3, Today's card; R3b, the ticket — board 09): in, being made, ready, picked up.
export default function OrderSteps({ at }: { at: number }) {
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={`Where it is: ${ORDER_STEPS[at]}`}>
      {ORDER_STEPS.map((w, i) => (
        <li key={w} className="flex flex-col gap-1.5" aria-current={i === at ? "step" : undefined}>
          <span className={`block h-1 rounded-pill ${i <= at ? "bg-ok" : "bg-line2"}`} />
          <span className={`font-mono text-caption2 uppercase tracking-eyebrow ${i === at ? "text-cream" : i < at ? "text-cream-muted" : "text-cream-dim"}`}>{w}</span>
        </li>
      ))}
    </ol>
  );
}
