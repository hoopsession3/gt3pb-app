// ONE calendar grammar. Company + Brand calendars both import from here, so a category or a
// content status can never be two different colors on two surfaces. Hues are picked to stay
// apart from each other AND to read on both the dark shell and white day-mode cards.
export const CAL_CAT: Record<string, { label: string; color: string; icon: string }> = {
  stop: { label: "Truck", color: "#5b9a6b", icon: "🚚" }, event: { label: "Events", color: "#6fa8dc", icon: "📍" },
  ops: { label: "Ops", color: "#e0892b", icon: "🛠️" }, admin: { label: "Admin", color: "#8b5cf6", icon: "📋" },
  content: { label: "Content", color: "#2bb3a3", icon: "🎨" }, task: { label: "Tasks", color: "#c2603f", icon: "⏰" },
  brew: { label: "Brew", color: "#c9a227", icon: "🍺" }, drop: { label: "Drops", color: "#c25b8e", icon: "📦" },
  delivery: { label: "Delivery", color: "#5c6bc0", icon: "🏠" },
  goal: { label: "Goals", color: "#c8a661", icon: "🎯" },
  // 2026-08-01 (Ryan: "events, truck stops, opportunities, and meetings … roll up to the one
  // business calendar"): the sales/relationship rhythm joins the grammar. lead = an inbound
  // booking request's event date; pipe = a pipeline opportunity's next-step date; meeting = a
  // meeting note's met_on. All three are read-only rollups on the calendar — the rows live on
  // Plan › Leads and Notes.
  lead: { label: "Leads", color: "#3fb0c9", icon: "🤝" },
  pipe: { label: "Pipeline", color: "#9aa83a", icon: "📈" },
  meeting: { label: "Meetings", color: "#8d6e63", icon: "🗣️" },
};

// content_items.status → chip color (Brand calendar + Studio surfaces).
export const CONTENT_STATUS: Record<string, string> = { draft: "#9a8f7c", review: "var(--gold2)", changes: "#d2554a", approved: "#7bbf6a", scheduled: "#6fa8dc", published: "#7bbf6a" };
