// TAILWIND, ON PURPOSE (2026-10-07). Tailwind CSS v4 builds app/tailwind.css — the utilities, on GT3's
// own tokens — and nothing else: its PostCSS plugin leaves a stylesheet alone unless it uses Tailwind's
// own at-rules, so app/globals.css passes through untouched (scripts/css.audit.mjs holds both to that).
// Create Next App wired this in on day one; the v3 port (e9963cf) took it out and left the packages, so
// for its first months the app carried Tailwind and shipped none of it. app/tailwind.css says what it is
// for now, and how it sits beside the house stylesheet.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
