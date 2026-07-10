// ONE calendar grammar. Company + Brand calendars both import from here, so a category or a
// content status can never be two different colors on two surfaces. Hues are picked to stay
// apart from each other AND to read on both the dark shell and white day-mode cards.
export const CAL_CAT: Record<string, { label: string; color: string; icon: string }> = {
  stop: { label: "Truck", color: "#5b9a6b", icon: "🚚" }, event: { label: "Events", color: "#6fa8dc", icon: "📍" },
  ops: { label: "Ops", color: "#e0892b", icon: "🛠️" }, admin: { label: "Admin", color: "#8b5cf6", icon: "📋" },
  content: { label: "Content", color: "#2bb3a3", icon: "🎨" }, task: { label: "Tasks", color: "#c2603f", icon: "⏰" },
  brew: { label: "Brew", color: "#c9a227", icon: "🍺" }, drop: { label: "Drops", color: "#c25b8e", icon: "📦" },
  delivery: { label: "Delivery", color: "#5c6bc0", icon: "🏠" },
};

// content_items.status → chip color (Brand calendar + Studio surfaces).
export const CONTENT_STATUS: Record<string, string> = { draft: "#9a8f7c", review: "var(--gold2)", changes: "#d2554a", approved: "#7bbf6a", scheduled: "#6fa8dc", published: "#7bbf6a" };
