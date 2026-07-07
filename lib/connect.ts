// CONNECT — the GT3 hub, organized by INTENT, not a flat link dump. Someone pulls it up and the app
// asks what they're here for — "Wanna order?", "Learn the brew?", "Connect?" — and drops down the
// right links. Edit here; ConnectHub renders the groups + a QR of CONNECT_PRIMARY to scan off-screen.
export interface ConnectLink { label: string; sub?: string; href: string; badge: string }
export interface ConnectGroup { q: string; links: ConnectLink[] }

export const CONNECT_PRIMARY = "https://gt3pb.com"; // what the scan QR points at

export const CONNECT_GROUPS: ConnectGroup[] = [
  { q: "Wanna order?", links: [
    { label: "Reserve a drop", sub: "order ahead", href: "https://app.gt3pb.com/reserve", badge: "◆" },
    { label: "See the menu", sub: "what's pouring", href: "https://app.gt3pb.com/menu", badge: "≡" },
    { label: "Find the truck", sub: "where we are", href: "https://app.gt3pb.com/truck", badge: "◎" },
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
    { label: "Events & catering", sub: "bring the bar", href: "https://app.gt3pb.com/book", badge: "✦" },
  ] },
];
