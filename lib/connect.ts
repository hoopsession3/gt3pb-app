// CONNECT — the GT3 hub, organized by INTENT, not a flat link dump. Someone pulls it up and the app
// asks what they're here for — "Wanna order?", "Learn the brew?", "Connect?" — and drops down the
// right links. Edit here; ConnectHub renders the groups + a QR of CONNECT_PRIMARY to scan off-screen.
export interface ConnectLink { label: string; sub?: string; href: string; badge: string }
export interface ConnectGroup { q: string; links: ConnectLink[] }

export const CONNECT_PRIMARY = "https://gt3pb.com"; // what the scan QR points at

export const CONNECT_GROUPS: ConnectGroup[] = [
  // Internal routes are RELATIVE ("/reserve") so the hub navigates in-app (clean) instead of opening
  // an in-app browser tab. External links (socials, the marketing site) stay absolute and open out.
  { q: "Wanna order?", links: [
    { label: "Sunday delivery", sub: "order by Fri 6 PM", href: "/delivery", badge: "🚚" },
    { label: "Reserve a drop", sub: "order ahead", href: "/reserve", badge: "◆" },
    { label: "See the menu", sub: "what's pouring", href: "/menu", badge: "≡" },
    { label: "Find the truck", sub: "where we are", href: "/truck", badge: "◎" },
  ] },
  { q: "Learn the brew?", links: [
    { label: "Read the chemistry", sub: "why it's clean", href: "https://gt3pb.com", badge: "⌘" },
    { label: "The GT3 story", sub: "who we are", href: "https://gt3pb.com", badge: "◷" },
  ] },
  { q: "Connect with us?", links: [
    { label: "Instagram", sub: "@gt3pb", href: "https://instagram.com/gt3pb", badge: "IG" },
    { label: "TikTok", sub: "@gt3pb", href: "https://tiktok.com/@gt3pb", badge: "TT" },
  ] },
  { q: "Wanna book us?", links: [
    { label: "Events & catering", sub: "bring the bar", href: "/book", badge: "✦" },
  ] },
];

// Leadership-only — appended to the hub when signed in as owner/crew, so you can pull up the
// investor brief mid-conversation. The partner one-pager is safe to show (no financials); the live
// architecture map is the owner deep-dive.
export const CONNECT_LEADERSHIP: ConnectGroup = {
  q: "Investor brief", links: [
    { label: "The playbook", sub: "strategy + every growth play", href: "/playbook", badge: "♟" },
    { label: "What we've built", sub: "partner one-pager", href: "/built/gt3-built-k7m9x4q2", badge: "★" },
    { label: "The build, live", sub: "architecture + status", href: "/architecture", badge: "⌬" },
  ],
};
