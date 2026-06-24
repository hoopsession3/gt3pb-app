-- 0054 — seed the Branding & Marketing Studio spec as a Plan-section meeting note, so it lives
-- where Ryan + Kayla actually plan (and so the recap agent can later pull follow-ups from it).
-- Idempotent: only inserts if a note with this title doesn't already exist. created_by is null
-- (system-seeded). Dollar-quoted bodies avoid apostrophe escaping. Apply after 0049.

insert into public.meeting_notes (title, summary, body, source)
select
  $t$Branding & Marketing Studio — spec v1$t$,
  $s$Next pillar: Kayla's domain. Turn the GT3 brand voice into content that educates the audience so the product sells itself ("sell by talking less"). Both owners see every piece, edit in real time, approve or deny before it ships. Grounded in the brand Source of Truth; Canva + Webflow wired in.$s$,
  $b$THE JOB
Kayla owns brand + marketing. The Studio is where GT3's brand voice becomes content that EDUCATES the audience so the product sells itself — "sell by talking less." Ryan + Kayla both see every piece, edit in real time, and approve or deny before anything ships.

PRINCIPLES
- Education-first: lead with the WHY (primal, whole-food, non-toxic, no oxalates, the ingredient story), not a hard sell.
- Brand-safe by construction: grounded ONLY in the GT3 Source of Truth (Academy brand + nutrition + product modules). Same hard rule as the other agents — never invent health/nutrition claims; caffeine/nutrition is "estimated until lab-verified."
- Her domain, his sign-off: Kayla creates; both can edit; an owner approves. Real-time and collaborative.
- One brand: every asset traces to the brand standard ("Pure Signal. No Noise.") — premium, measured, no hype, no generic AI-slop look.

ARCHITECTURE (reuse what we built)
- Grounding: lib/academy.ts (brand standards, primal-nutrition, product talking points + FAQs) + products + live menu/events. Same pattern as lib/operatorKb.ts.
- Copy engine: a content agent (Sonnet 4.6 for hero pieces, Haiku for volume) that drafts on-brand copy from a brief + the grounded brand truth.
- Design: Canva (MCP already connected) — fill a GT3 brand template / generate a design from the copy; preview thumbnail + export.
- Publish: Webflow (MCP connected) for site/blog; export PNG/PDF for social.
- Collaboration: Supabase Realtime on the content table; reuse the comment threads (#18) and the owner sign-off pattern (event_approvals).

DATA MODEL (new)
- content_items: id, kind (post | carousel | caption | email | menu_card | promo | blog), channel (instagram | site | email | print), brief, title, body (the copy), design_url (Canva), export_url, status (draft | proposed | changes_requested | approved | scheduled | published), created_by, approved_by, scheduled_for, event_id (optional — tie a promo to an event), tenant_id, timestamps.
- content_comments: extend the polymorphic comments table (#18) to own content_items → threaded feedback for free.
- brand_assets (optional): logo lockups, palette, fonts, approved photography — or read straight from the Canva brand kit.

FEATURES (v1 scope)
1. Studio composer: pick kind + channel + brief — or "promote this event" / "explain this drink" — the agent drafts 2–3 on-brand options grounded in the brand truth; Kayla picks and edits.
2. Education-first generator: per product, turn the WHY into a shareable explainer / carousel (no oxalates, primal, the ingredient story) — claim-safe by construction.
3. Review & approve queue: shared and real-time. Each item shows copy + design preview. Approve / request changes (with a comment) / edit inline. Status drives the pipeline.
4. Canva pipeline: from approved copy, fill a brand template → preview → export PNG/PDF. (Canva MCP: create-design-from-brand-template, generate-design, export-design.)
5. Publish + schedule (v1.1+): push blog/landing to Webflow; schedule social exports; an event-tied promo rides the events spine.

ROLES & FLOW
Kayla drafts → both edit in real time → an owner approves → export / publish. Mirrors the event sign-off we already have — reuse event_approvals.

GUARDRAILS
- Claim safety (the hard rule) enforced in the system prompt + grounding.
- No customer PII in content.
- Brand voice: signal over noise, premium, measured. No hype; no generic AI aesthetics.
- Public publish (Webflow) is owner-approved only.

INTEGRATIONS NOTE
Canva + Webflow MCP servers are connected in the build environment. Production wiring runs server-side via API routes (like the other agents), with Canva/Webflow tokens as host secrets. Confirm a GT3 Canva brand kit + templates exist before the Canva pipeline.

PHASING
- v1: content_items + composer + real-time review/approve (pure copy).
- v1.1: Canva template fill + export.
- v1.2: Webflow publish + scheduling + event-tied promos.

OPEN DECISIONS (Ryan + Kayla)
- Channels for v1 (Instagram + site? add email?).
- Canva: which brand templates to standardize on.
- Approval: either owner can approve, or strictly Kayla-creates / Ryan-approves?
- Scheduling: in-app, or export to a social scheduler?
- "Talking less": confirm the education-first formats she wants (carousels, short explainers, reel scripts?).$b$,
  'manual'
where not exists (
  select 1 from public.meeting_notes where title = $t$Branding & Marketing Studio — spec v1$t$
);
