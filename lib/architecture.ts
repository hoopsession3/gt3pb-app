// System architecture — a manifest of the GT3PB platform, layered the way a platform team maps it.
// Each component points to its source-of-truth (SOT) path in the repo, so the map drills into real
// files/configs and stays honest. Rendered owner-only at /architecture.

export const REPO = "hoopsession3/gt3pb-app";
export const sotUrl = (path: string) => `https://github.com/${REPO}/blob/main/${path}`;

export type ArchStatus = "live" | "configured" | "staged" | "planned";
export interface ArchComponent { name: string; status: ArchStatus; desc: string; detail?: string; config?: string; sot?: string }
export interface ArchLayer { id: string; tag: string; label: string; color: string; blurb: string; components: ArchComponent[] }

export const STATUS_LABEL: Record<ArchStatus, string> = { live: "Live", configured: "Configured", staged: "Staged", planned: "Planned" };

// High-level overview — the platform in one breath, and how a request flows through the layers.
export const ARCH_OVERVIEW = {
  summary: "GT3PB is a Next.js PWA on Supabase. People meet it at the Edge; the Control Plane authorizes every request; Capabilities do the work; Agents + the Model Layer reason over GT3's own governed knowledge; Data is the source of truth; Governance watches every layer.",
  flow: ["Edge Surfaces", "Control Plane", "Capabilities", "Agents + Model", "Data & Infrastructure", "Governance"],
};

// Database review — can each table be managed from the app, and how fully?
export type Manage = "full" | "partial" | "readonly" | "system";
export const MANAGE_LABEL: Record<Manage, string> = { full: "Full CRUD", partial: "Partial", readonly: "Read-only", system: "System" };
export interface DbEntry { table: string; manage: Manage; surface: string; note: string }
export const DATABASES: DbEntry[] = [
  // Fully manageable from the app (create · edit attributes · delete)
  { table: "products", manage: "full", surface: "Money → Menu & products", note: "Catalog + recipe (inventory) + price (card & cash)." },
  { table: "product_components", manage: "full", surface: "Money → Menu & products", note: "Each drink's recipe → inventory." },
  { table: "subscription_plans", manage: "full", surface: "Money → Membership plans", note: "Tiers, price, billing period, active." },
  { table: "events", manage: "full", surface: "Plan → Events", note: "Create/edit/delete events + menu flags." },
  { table: "stops", manage: "full", surface: "Now / Prep", note: "Truck stops + pick lists." },
  { table: "vendors", manage: "full", surface: "Plan → Vendors", note: "Create/edit/delete." },
  { table: "booking_requests", manage: "full", surface: "Plan → Bookings", note: "B2B booking pipeline." },
  { table: "event_tasks", manage: "full", surface: "Prep / Notes", note: "Pack lists + follow-ups (assign, flag, AI propose)." },
  { table: "event_staff", manage: "full", surface: "Plan → Events", note: "Crew on an event." },
  { table: "meeting_notes", manage: "full", surface: "Plan → Notes", note: "Create/edit/archive/search + AI summary." },
  { table: "inventory_items", manage: "full", surface: "Prep → Inventory", note: "Stock + reorder points." },
  { table: "assets", manage: "full", surface: "Prep → Gear", note: "Gear library." },
  { table: "compliance_rules", manage: "full", surface: "Prep → Inspection", note: "Per-jurisdiction; agent proposals approved here." },
  { table: "content_items", manage: "full", surface: "Studio", note: "Create/edit/schedule/delete content." },
  { table: "brand_kit", manage: "full", surface: "Studio → Brand", note: "Voice, palette, fonts, logos." },
  { table: "brand_assets", manage: "full", surface: "Studio → Brand", note: "Logo / asset library." },
  { table: "subscriptions", manage: "full", surface: "Money → Subscribers", note: "Member subs." },
  { table: "profiles", manage: "full", surface: "Team", note: "Name, role, points, credit, founding." },
  // Partial — manageable but bounded by design
  { table: "alerts", manage: "partial", surface: "My Day / Now", note: "Raised + acknowledged, not edited." },
  { table: "comments", manage: "partial", surface: "Throughout", note: "Post + delete; not edited." },
  { table: "reserves", manage: "partial", surface: "Plan → Reserves", note: "Create + update." },
  { table: "rsvps", manage: "partial", surface: "Events", note: "Create + update." },
  { table: "event_approvals", manage: "partial", surface: "Now (sign-off)", note: "Create + delete (the sign-off flow)." },
  { table: "event_economics", manage: "partial", surface: "Money → Event P&L", note: "P&L inputs (upsert)." },
  { table: "event_sales", manage: "partial", surface: "Money → Event P&L", note: "Sales inputs (upsert)." },
  { table: "product_economics", manage: "partial", surface: "Money", note: "Cost inputs (update)." },
  { table: "content_versions", manage: "partial", surface: "Studio (history)", note: "Immutable snapshots — restore, not edit." },
  { table: "academy_*", manage: "partial", surface: "Academy", note: "Progress/certs via training flow." },
  // System / external — intentionally not hand-edited
  { table: "orders", manage: "system", surface: "Checkout / Square", note: "Created at checkout; refunds in Square." },
  { table: "audit_log", manage: "readonly", surface: "—", note: "Append-only by triggers." },
  { table: "live_status", manage: "partial", surface: "Now → Go live", note: "Via the go-live control (RPC)." },
  { table: "tenants", manage: "system", surface: "—", note: "Single tenant; staged for multi-tenant." },
  { table: "push_subscriptions", manage: "system", surface: "—", note: "Managed by push registration." },
  { table: "referral_events", manage: "system", surface: "—", note: "Event log." },
  { table: "check_ins", manage: "system", surface: "—", note: "Event log." },
  { table: "reserve_claims", manage: "system", surface: "—", note: "Claimed via RPC." },
  { table: "admin_emails", manage: "readonly", surface: "SQL only", note: "Allowlist — not in-app." },
  { table: "subscription_interest", manage: "partial", surface: "Money", note: "Captured from interest signups." },
  { table: "trailer_profile", manage: "partial", surface: "Prep", note: "Singleton — update." },
];

// Business architecture — the same platform, told operationally to an owner: the capabilities the
// business runs on, what each one DOES for GT3, where it lives in the app, and what's next. Plain
// language, not plumbing. Rendered as the "Business" view at /architecture.
export interface BizCapability { id: string; icon: string; name: string; outcome: string; built: string[]; where: string; status: ArchStatus; next?: string }
export const BUSINESS_OVERVIEW =
  "What we've built, in business terms: a single platform that sells and serves customers, runs every event end to end, keeps the truck stocked and compliant, makes on-brand marketing, and turns meetings and numbers into action — with AI that proposes and people who approve.";

export const BUSINESS: BizCapability[] = [
  {
    id: "sell", icon: "🛒", name: "Sell & Serve", status: "live",
    outcome: "Customers find the truck, see what's pouring, pay, and book you — without a human in the loop.",
    built: [
      "Customer PWA storefront — menu with live card & cash pricing",
      "Live truck status (open / where / what's on) flips instantly",
      "Square-backed checkout + order status",
      "Membership signup and the B2B booking pipeline (intake → review)",
    ],
    where: "Customer app · Money → Subscribers · Plan → Bookings",
    next: "Public AI concierge (answer guests' menu/booking questions) — scoped, not yet built.",
  },
  {
    id: "event", icon: "🎪", name: "Run the Event", status: "live",
    outcome: "Every event from booking to teardown is planned, packed, and signed off — nothing improvised on site.",
    built: [
      "Events with menu, rig, attendance, power/water and venue/vendor link",
      "Multi-day day planner / run of show — time by time (leave home → setup → doors → load out)",
      "Per-event pack lists + AI readiness so you roll fully stocked",
      "Go-live sign-off and live sales tracking to the event",
    ],
    where: "Plan → Events · Prep · Company Calendar",
  },
  {
    id: "prep", icon: "📦", name: "Prep & Readiness", status: "live",
    outcome: "You always know what to load and whether you're stocked — before you leave the driveway.",
    built: [
      "Inventory with reorder points + gear library, system-of-record in the app",
      "AI readiness check: upcoming events vs stock → gaps + a prep alert",
      "Pack/pick lists per event and per truck stop",
      "Combine-and-optimize packing across home→show (recipe-aware via products)",
    ],
    where: "Prep → Inventory / Gear / Readiness",
  },
  {
    id: "brand", icon: "🎨", name: "Brand & Marketing", status: "live",
    outcome: "You and Kayla make on-brand content together and ship it — selling by teaching, not shouting.",
    built: [
      "Studio: collaborative editor, real version history, scheduling, status workflow",
      "Brand Kit: voice, palette, type, editable logo/asset library",
      "Caption engine + one-tap campaign from an event (teaser → day-of → recap)",
      "Brand calendar; Canva template autofill + Webflow publish (config-gated)",
    ],
    where: "Studio",
  },
  {
    id: "plan", icon: "🗓️", name: "Plan & Coordinate", status: "live",
    outcome: "Everything dated lives in one pane, and meetings turn into tracked action instead of lost notes.",
    built: [
      "Company Calendar — events + admin/ops + to-dos, categorized, click-through to source",
      "Meeting Notes with AI summaries in your house format (Action Items → sectioned recap)",
      "Recap agent turns those into assignable follow-up tasks",
      "Day planner reachable straight from a calendar day",
    ],
    where: "Plan → Calendar / Notes",
    next: "Outlook two-way sync (Microsoft Graph) — UI is in, awaiting credentials.",
  },
  {
    id: "team", icon: "👥", name: "Team & Crew", status: "live",
    outcome: "Each person sees exactly their day and has answers in their pocket — operate 10/10 without you narrating.",
    built: [
      "Role-scoped crew console (My Day, Now, Prep, Plan, Studio, Money, Team)",
      "My Day rollup: flags, pings and tasks assigned to you",
      "Ask GT3 — grounded pocket-brain (recipes, the why, gear, stock, how-to)",
      "Academy: training, certifications, the cookbook (the brand source of truth)",
    ],
    where: "My Day · Team · QuickDock (every page)",
  },
  {
    id: "money", icon: "💰", name: "Money & Margins", status: "live",
    outcome: "You see price, membership revenue, and go/no-go ROI per event — decisions on numbers, not gut.",
    built: [
      "Menu & product manager — price (card & cash), relational to inventory & Square",
      "Membership plans editor + subscriber/MRR view",
      "Event P&L with recipe-level product economics (go/no-go ROI at a glance)",
      "Sales reports + snapshots",
    ],
    where: "Money",
  },
  {
    id: "trust", icon: "🛡️", name: "Compliance & Trust", status: "live",
    outcome: "You stay legal jurisdiction-to-jurisdiction and never make a claim you can't back — and it's all audited.",
    built: [
      "Inspection agent: web-researches a jurisdiction's permits → proposes rules you approve",
      "Per-jurisdiction compliance rules feeding event pack lists",
      "Claim-safety: a hard rule across every agent — no unsupported health/nutrition claims",
      "Risk Register (R-001…R-004) + append-only audit log",
    ],
    where: "Prep → Inspection · Governance",
  },
  {
    id: "ai", icon: "🤖", name: "The AI Layer", status: "live",
    outcome: "AI is a teammate, not a gimmick: it proposes, you approve — grounded in GT3's own governed truth.",
    built: [
      "8 agents: recap, action-resolver, readiness, Ask GT3, inspection, caption, campaign, summarizer",
      "Grounded in the Academy (brand/nutrition/ops) so answers trace to written, claim-checked truth",
      "Human-in-the-loop everywhere — nothing auto-publishes or auto-commits",
      "Claude Sonnet 4.6 internal · Haiku 4.5 for volume; key is server-only",
    ],
    where: "Throughout — surfaced where the work is",
  },
];

export const ARCHITECTURE: ArchLayer[] = [
  {
    id: "agents", tag: "Agent Operations", label: "Autonomous & AI-assisted execution", color: "#2bb3a3",
    blurb: "The agents that act on the platform — grounded in GT3's own truth, human-in-the-loop.",
    components: [
      { name: "Recap agent", status: "live", desc: "Meeting recap → concrete follow-up tasks (proposed for review).", sot: "app/api/agents/recap/route.ts" },
      { name: "Action resolver", status: "live", desc: "Proposes how to complete each follow-up; surfaces answers already in our data.", sot: "app/api/agents/resolve/route.ts" },
      { name: "Readiness agent", status: "live", desc: "Upcoming events vs inventory → gaps + a prep alert.", sot: "app/api/agents/readiness/route.ts" },
      { name: "Operator assistant (Ask GT3)", status: "live", desc: "Grounded pocket-brain chat: recipes, the why, gear, stock, how-to.", sot: "app/api/agents/operator/route.ts" },
      { name: "Inspection agent", status: "configured", desc: "Web-researches jurisdiction permits/inspection; proposes compliance rows for approval.", sot: "app/api/agents/inspection/route.ts" },
      { name: "Caption engine", status: "live", desc: "Suave, on-brand content options from a brief (Studio).", sot: "app/api/agents/caption/route.ts" },
      { name: "Campaign generator", status: "live", desc: "An event → teaser + day-of + recap, scheduled & event-linked.", sot: "app/api/agents/campaign/route.ts" },
      { name: "Summarizer", status: "live", desc: "Recreate a note's recap from the transcript.", sot: "app/api/agents/summarize/route.ts" },
    ],
  },
  {
    id: "edge", tag: "Edge Surfaces", label: "Where people meet the platform", color: "#3b82c4",
    blurb: "Customer and crew surfaces, plus the public endpoints the world talks to.",
    components: [
      { name: "Customer app", status: "live", desc: "PWA storefront — menu, live status, membership, booking.", sot: "app/page.tsx" },
      { name: "Crew console", status: "live", desc: "Role-scoped operator console (My Day, Now, Prep, Plan, Studio, Money, Team).", sot: "app/admin/page.tsx" },
      { name: "QuickDock", status: "live", desc: "Floating Ask GT3 + quick-note, on every crew page.", sot: "components/QuickDock.tsx" },
      { name: "Checkout / orders", status: "live", desc: "Square-backed checkout + order status.", sot: "app/api/checkout" },
      { name: "Square webhook", status: "live", desc: "Inbound payment/catalog events.", sot: "app/api/square" },
      { name: "Notes inbound", status: "live", desc: "Email-in → meeting note (Share Text → Mail).", sot: "app/api/notes" },
    ],
  },
  {
    id: "control", tag: "Control Plane", label: "Identity-aware access on every request", color: "#8b5cf6",
    blurb: "Who is this, what may they do — enforced at the database and the edge.",
    components: [
      { name: "Supabase Auth", status: "live", desc: "Email/password + magic link; session in the app.", sot: "components/AuthProvider.tsx" },
      { name: "API auth gate", status: "live", desc: "staffFromRequest / userFromRequest — server routes verify the caller's token.", sot: "lib/apiAuth.ts" },
      { name: "Role model", status: "live", desc: "member · server · operator · event_manager · contractor · admin · owner.", sot: "supabase/migrations/0031_academy_governance.sql" },
      { name: "Row-Level Security", status: "live", desc: "is_staff / is_admin / is_owner gate every table.", sot: "supabase/migrations/0039_rls_plan_stable.sql" },
      { name: "Multi-tenant scoping", status: "staged", desc: "tenant_id backfilled; per-tenant RLS staged (Risk R-002).", detail: "Every business table has tenant_id stamped by default, but policies don't yet filter by tenant — safe while single-tenant. Enforce before onboarding a second tenant.", sot: "supabase/migrations/0040_multitenant_foundation.sql" },
    ],
  },
  {
    id: "model", tag: "Model Layer", label: "The reasoning engines", color: "#22a06b",
    blurb: "The Claude models and the governed knowledge they're grounded in.",
    components: [
      { name: "Anthropic client", status: "configured", desc: "Server-only Messages API (tool use). Sonnet 4.6 internal · Haiku 4.5 high-volume.", detail: "Single shared client every agent calls. Never imported client-side — the browser only ever calls our own API routes, which hold the key.", config: "Models: claude-sonnet-4-6, claude-haiku-4-5 · Env: ANTHROPIC_API_KEY", sot: "lib/anthropic.ts" },
      { name: "Grounding (Source of Truth)", status: "live", desc: "Academy brand/nutrition/ops + products → claim-safe context.", detail: "Compiles the governed Academy content into the prompt so answers trace to written, claim-checked truth — no model freelancing on nutrition.", sot: "lib/operatorKb.ts" },
      { name: "Web search tool", status: "configured", desc: "Server-side web_search for the inspection agent.", detail: "Capped at 2 searches + 2 resume rounds per request to stay under the serverless time limit.", config: "Enable web search for the workspace in the Anthropic Console", sot: "app/api/agents/inspection/route.ts" },
      { name: "ANTHROPIC_API_KEY", status: "configured", desc: "Host secret. Agents degrade gracefully until set.", detail: "Inference-scoped — grants model calls only, no access to app/customer data. Exposure tracked as Risk R-004 (rotation deferred).", config: "Vercel → Settings → Environment Variables → Production", sot: "RISK_REGISTER.md" },
    ],
  },
  {
    id: "capabilities", tag: "Capabilities", label: "What the platform does", color: "#e0892b",
    blurb: "The product surfaces the business runs on.",
    components: [
      { name: "Studio", status: "live", desc: "Collaborative content: editor, calendar, brand kit, caption engine, Canva/Webflow.", sot: "components/Studio.tsx" },
      { name: "Brand Calendar", status: "live", desc: "Posts + events on one sticky, relational, drag-to-schedule month.", sot: "components/BrandCalendar.tsx" },
      { name: "Brand Kit", status: "live", desc: "Voice, palette, type system, logo/asset library.", sot: "components/BrandKit.tsx" },
      { name: "Events & Prep", status: "live", desc: "Events, pack lists, readiness, sign-off.", sot: "supabase/migrations/0025_event_execution.sql" },
      { name: "Inventory & Assets", status: "live", desc: "Stock + gear, system-of-record in Postgres.", sot: "supabase/migrations/0041_assets_inventory_postgres.sql" },
      { name: "Meeting Notes", status: "live", desc: "Talking points + AI follow-ups, archive, search.", sot: "supabase/migrations/0049_meeting_notes.sql" },
      { name: "Alerts spine", status: "live", desc: "One nervous system: push + inbox + flags/pings.", sot: "supabase/migrations/0050_alerts.sql" },
      { name: "Money", status: "live", desc: "Square pricing, subscriptions, reports, event P&L.", sot: "supabase/migrations/0048_mrr_and_event_pnl.sql" },
      { name: "Academy", status: "live", desc: "Training, certifications, the cookbook — the brand SOT.", sot: "lib/academy.ts" },
    ],
  },
  {
    id: "data", tag: "Data & Infrastructure", label: "Source of truth & infrastructure", color: "#b07b3a",
    blurb: "Where state lives and what runs it.",
    components: [
      { name: "Supabase Postgres", status: "live", desc: "System of record — 60+ versioned migrations, RLS-enforced.", detail: "Every business table lives here with Row-Level Security on. Realtime drives the live board/co-editing surfaces. Service-role key is server-only.", config: "Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY", sot: "supabase/migrations" },
      { name: "Edge Function: push", status: "configured", desc: "Notification dispatcher (push + inbox + Teams) off the alerts spine.", detail: "Invoked with the service-role key on alert/assignment writes; fans out to web-push, the in-app inbox, and Teams.", sot: "supabase/functions" },
      { name: "Square", status: "live", desc: "Catalog (menu prices) + payments + webhooks.", config: "Env: SQUARE_ACCESS_TOKEN, NEXT_PUBLIC_SQUARE_ENV", sot: "app/api/menu/route.ts" },
      { name: "Canva Connect", status: "configured", desc: "Studio → autofill a brand template, export the graphic.", config: "Env: CANVA_ACCESS_TOKEN, CANVA_BRAND_TEMPLATE_ID", sot: "lib/canva.ts" },
      { name: "Webflow Data API", status: "configured", desc: "Studio → publish a piece to the site.", config: "Env: WEBFLOW_API_TOKEN, WEBFLOW_SITE_ID, WEBFLOW_COLLECTION_ID", sot: "lib/webflow.ts" },
      { name: "Brand assets", status: "live", desc: "Logos, wordmarks, taglines, photos (public/brand + brand_assets).", sot: "supabase/migrations/0058_brand_assets.sql" },
      { name: "Vercel + Next.js", status: "live", desc: "App hosting + API routes + PWA.", sot: "package.json" },
    ],
  },
  {
    id: "governance", tag: "Governance & Observability", label: "Cross-cutting controls on every layer", color: "#c4453c",
    blurb: "The guardrails that keep the platform honest, safe, and auditable.",
    components: [
      { name: "Risk Register", status: "live", desc: "Tracked operational/security risks (R-001…R-004).", sot: "RISK_REGISTER.md" },
      { name: "Audit log", status: "live", desc: "Append-only trail on high-write tables (Risk R-003 monitors growth).", sot: "supabase/migrations/0042_audit_log.sql" },
      { name: "Claim-safety", status: "live", desc: "Hard rule across every agent: no unsupported health/nutrition claims.", sot: "lib/academy.ts" },
      { name: "Compliance rules", status: "live", desc: "Per-jurisdiction permit/inspection requirements; agent proposals approved before live.", sot: "supabase/migrations/0027_compliance_rules.sql" },
      { name: "Human-in-the-loop", status: "live", desc: "Agents propose; people approve (follow-ups, readiness, inspection, Studio).", sot: "app/api/agents/recap/route.ts" },
    ],
  },
];
