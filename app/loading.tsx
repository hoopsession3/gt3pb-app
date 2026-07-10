import PourFill from "@/components/PourFill";

// Route-level loading = the brand's pour, centered and quiet. Next shows this during route
// code-split loads; it replaces the browser-default blank flash with a GT3 moment.
export default function Loading() {
  return (
    <div className="g3pour-page">
      <PourFill size={54} label="Pouring…" />
    </div>
  );
}
