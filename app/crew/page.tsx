"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Children, Fragment, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useApp } from "@/components/AppProvider";
import { SectionHeader, InfoRow } from "@/components/kit";
import { Segmented, IconButton } from "@/components/controls";
import { useAuth, roleOf, type Profile } from "@/components/AuthProvider";
import { SENIORITY, roleLabel, tierOf, toRole, canOf, type Role, type Tier } from "@/lib/roles";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { authedFetch } from "@/lib/authedFetch";
import { normalizeCategory, alertWhen, type AlertCategory } from "@/lib/alertKinds";
import { useMyAlerts, type MyFlag } from "@/lib/useMyAlerts";
import { localToday, etToday, dayKey, dayWithDate, relativeDay, ageLabel, evDate, evTime } from "@/lib/dates";
import { orderClockFrom, waitingToOpen, waitingLabel } from "@/lib/ordering";
import { prepBucket } from "@/lib/readiness";
import { OPEN_PANEL_EVENT, scrollToAnchor } from "@/lib/anchors";
import { readParam, dropParam } from "@/lib/urlParam";
import { panelHome } from "@/lib/panelHome";
import { usePassMuted, setPassMuted } from "@/lib/passSound";
import { NotifPrefs, NotifPrefsSheet } from "@/components/NotifPrefs";
import { DeviceAlerts, AlertsOffLine } from "@/components/DeviceAlerts";
import { PassSound, Appearance } from "@/components/YouPrefs";
import { DisplayControls } from "@/components/DisplayToggle";
import { useSettingsGlance, GlanceText, OutlookGlance } from "@/components/SettingsGlance";
import type { Glance } from "@/lib/settingsGlance";
import GoLine from "@/components/GoLine";
import { mentionDraft, mentionChoices, insertMention, resolveMentions } from "@/lib/mentions";
import PersonPick from "@/components/PersonPick";
import { crewLabel } from "@/components/useCrew";
import { archiveOwner, setEventLive } from "@/lib/wrap";
import { downloadCsv } from "@/lib/csv";
import { brewStartOverdue } from "@/lib/brewMath";
import { useWorkStreams, streamOfCategory } from "@/lib/streams";
import { useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "@/components/AsyncSection";
import Owed from "@/components/Owed";  // daily path: the overdue list is on the default screen
// Daily path too (2026-10-04): today's op card lives here now, for everybody, so it is a static
// import like the rest of the morning screen — a crew member opening My Day must never wait on a
// chunk to see where they are working (see "Code-split" below).
import DayHeadline from "@/components/DayHeadline";
import EmptyState from "@/components/EmptyState";
import { rememberMode } from "@/lib/mode";
import { useOperatorSection, sectionsForRole, streamGroups, SECTION_LABEL, TODAY_GROUP, VALID as VALID_SECTIONS, type OpSection } from "@/components/OperatorNav";
import { useTaskSheet } from "@/components/TaskSheet";
import { useRecord } from "@/components/RecordSheet";
import { recordForAlert, TASK_ALERT_KINDS } from "@/lib/records";
import { owedLine, prepHandoffKey, prepHandoffValue, EVENT_STAGES, isEventStage, stageLabel, type EventStage, eventPiles, newestFirst, dateLine, placeBesideTitle } from "@/lib/eventRecord";
import { WayButtons } from "@/components/RecordWays";
import { goPlanTab, isPlanTab, planTabFromUrl, stampPlanTab, PLAN_TAB_KEY, PLAN_TAB_EVENT, type PlanTab } from "@/lib/planNav";
import SwipePager from "@/components/SwipePager";
import SwipeRow, { type RowAction } from "@/components/SwipeRow";
import GtmCard from "@/components/GtmCard";
import { CrumbProvider, Breadcrumbs, useCrumb } from "@/components/Crumbs";
import { recordRecent } from "@/components/recents";
import { queueOrderStatus, queueCollectCup, isNetworkError, saveSnapshot, readSnapshot, readQueue, OFFLINE_EVENT } from "@/components/offline";
import { canCollect, canUndo, collectPayment, undoCollection, collectedPatch, undonePatch, isSettled, paidHow, passWord, ledgerWord, VIA_LABEL, type CollectVia } from "@/lib/collect";
import { useCollectSheet } from "@/components/CollectSheet";
import { snapshotUsable } from "@/lib/offline";
import MenuRigChips, { MENU_RIG_COLUMNS, type MenuRigPatch, type MenuRigValue } from "@/components/MenuRigChips";
// ── Code-split (2026-07-29, speed round): every component below renders only inside ONE section
// (or opens on a tap), so it loads as its own chunk on demand instead of riding in the /crew
// route's first paint. Daily-path components (My Day, Live Ops' DropOps/DeliveryOps/EightySix,
// PrepBoard, CommandBoard/Goals) stay static imports on purpose — the morning screen and service
// screen must never wait on a chunk. Once fetched, the SW's cache-first asset rule keeps each
// chunk available offline. next/dynamic on a default export keeps full prop-type inference.
const TrailerLoadout = dynamic(() => import("@/components/TrailerLoadout"), { loading: () => <PourFill label="Loading…" /> });
import DropOps from "@/components/DropOps";
import OfficeOrders from "@/components/OfficeOrders";
const SiteCopyEditor = dynamic(() => import("@/components/SiteCopyEditor"), { loading: () => <PourFill label="Loading…" /> });
const OfficeSettings = dynamic(() => import("@/components/OfficeSettings"), { loading: () => <PourFill label="Loading…" /> });
const MarketsPanel = dynamic(() => import("@/components/MarketsPanel"), { loading: () => <PourFill label="Loading…" /> });
const CopilotDirectory = dynamic(() => import("@/components/CopilotDirectory"), { loading: () => <PourFill label="Loading…" /> });
// The Guide's Start here page (2026-10-08) — loaded when the Guide opens on it, not with the console.
const CrewStart = dynamic(() => import("@/components/CrewStart"), { loading: () => <PourFill label="Loading…" /> });
const AiSpend = dynamic(() => import("@/components/AiSpend"), { loading: () => <PourFill label="Loading…" /> });
const BroadcastEditor = dynamic(() => import("@/components/BroadcastEditor"), { loading: () => <PourFill label="Loading…" /> });
const MaintenanceLog = dynamic(() => import("@/components/MaintenanceLog"), { loading: () => <PourFill label="Loading…" /> });
import OpsPlan from "@/components/OpsPlan";
import NoteAttach from "@/components/NoteAttach";
import Goals from "@/components/Goals";
import { useLocationSuggestions } from "@/components/useLocationSuggestions";
import { completeTask, createEventTask, createEventTasks, deleteTask, deleteTasks, deleteTasksForParent, type NewEventTask, type TaskParent } from "@/lib/tasks";
const AiTraining = dynamic(() => import("@/components/AiTraining"), { loading: () => <PourFill label="Loading…" /> });
const PromoEditor = dynamic(() => import("@/components/PromoEditor"), { loading: () => <PourFill label="Loading…" /> });
import EightySix from "@/components/EightySix";
const ReviewsAdmin = dynamic(() => import("@/components/ReviewsAdmin"), { loading: () => <PourFill label="Loading…" /> });
import DeliveryOps from "@/components/DeliveryOps";
import PackPlan from "@/components/PackPlan";
const OrgChart = dynamic(() => import("@/components/OrgChart"), { loading: () => <PourFill label="Loading…" /> });
const WorkloadBoard = dynamic(() => import("@/components/WorkloadBoard"), { loading: () => <PourFill label="Loading…" /> });
const OperatingRhythm = dynamic(() => import("@/components/OperatingRhythm"), { loading: () => <PourFill label="Loading…" /> });
const Discussions = dynamic(() => import("@/components/Discussions"), { loading: () => <PourFill label="Loading…" /> });
const OsRegistry = dynamic(() => import("@/components/OsRegistry"), { loading: () => <PourFill label="Loading…" /> });
const KpiBoard = dynamic(() => import("@/components/KpiBoard"), { loading: () => <PourFill label="Loading…" /> });
const UtilizationPanel = dynamic(() => import("@/components/UtilizationPanel"), { loading: () => <PourFill label="Loading…" /> });
const CrewPerson = dynamic(() => import("@/components/CrewPerson"), { ssr: false });
import { RecordLink } from "@/components/RecordSheet";
// Owner-only and opened on a tap: loaded with the roster, not with the console.
const AddTeammate = dynamic(() => import("@/components/AddTeammate"), { loading: () => <PourFill label="Loading…" /> });
const CrmPanel = dynamic(() => import("@/components/CrmPanel"), { loading: () => <PourFill label="Loading…" /> });
const CodesPanel = dynamic(() => import("@/components/CodesPanel"), { loading: () => <PourFill label="Loading…" /> });
const PerksPanel = dynamic(() => import("@/components/PerksPanel"), { loading: () => <PourFill label="Loading…" /> });
import CustomerKpis from "@/components/CustomerKpis";
const VipQueue = dynamic(() => import("@/components/VipQueue"), { loading: () => <PourFill label="Loading…" /> });
const FunnelReport = dynamic(() => import("@/components/FunnelReport"), { loading: () => <PourFill label="Loading…" /> });
import { TeamKpis, PrepKpis, GarageKpis } from "@/components/CrewKpis";
import PrepBoard from "@/components/PrepBoard";
import InlineCreate from "@/components/InlineCreate";
const Changelog = dynamic(() => import("@/components/Changelog"), { loading: () => <PourFill label="Loading…" /> });
// Settings › You › Account (2026-10-06, the settings-by-category round): the account menu's door, as a
// row — the avatar's own menu and sheets (components/AccountPill useAccountDoor), so it has one home.
const AccountRow = dynamic(() => import("@/components/AccountRow"), { loading: () => <PourFill label="Loading…" /> });
import CommandBoard from "@/components/CommandBoard";
// Free-text times from before the field became type="time" still have to render. Anything the
// input can accept is handed through; anything it cannot (a bare "9", "9am", "2 pm") is normalised
// where that is unambiguous and otherwise left for the person to re-enter, rather than silently
// blanking a value somebody typed.
function toTimeInput(v: string | null | undefined): string {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "p") h += 12;
    return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  }
  const hm = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return `${String(Number(hm[1])).padStart(2, "0")}:${hm[2]}`;
  return "";
}

const FounderDigest = dynamic(() => import("@/components/FounderDigest"), { loading: () => <PourFill label="Loading…" /> });
const ListsPanel = dynamic(() => import("@/components/ListsPanel"), { loading: () => <PourFill label="Loading…" /> });
const SpendBudget = dynamic(() => import("@/components/SpendBudget"), { loading: () => <PourFill label="Loading…" /> });
const DriverDash = dynamic(() => import("@/components/DriverDash"), { loading: () => <PourFill label="Loading…" /> });
const PipelinePanel = dynamic(() => import("@/components/PipelinePanel"), { loading: () => <PourFill label="Loading…" /> });
const GearLibrary = dynamic(() => import("@/components/GearLibrary"), { loading: () => <PourFill label="Loading…" /> });
const InventoryLibrary = dynamic(() => import("@/components/InventoryLibrary"), { loading: () => <PourFill label="Loading…" /> });
const Reports = dynamic(() => import("@/components/Reports"), { loading: () => <PourFill label="Loading…" /> });
const SnapshotReport = dynamic(() => import("@/components/SnapshotReport"), { loading: () => <PourFill label="Loading…" /> });
const EventPnlReport = dynamic(() => import("@/components/EventPnlReport"), { loading: () => <PourFill label="Loading…" /> });
import SignIn from "@/components/SignIn";
import Sheet, { CloseButton, LeaveButton } from "@/components/Sheet";
import { NumberRoll } from "@/components/CountUp";
import PourFill from "@/components/PourFill";
import AlertAction, { alertHasInlineAction } from "@/components/AlertAction";
import { supabase } from "@/lib/supabase";
const AskGT3 = dynamic(() => import("@/components/AskGT3"), { loading: () => <PourFill label="Loading…" /> });
const Studio = dynamic(() => import("@/components/Studio"), { loading: () => <PourFill label="Loading…" /> });
const ShootPlanner = dynamic(() => import("@/components/ShootPlanner"), { loading: () => <PourFill label="Loading…" /> });
const MenuManager = dynamic(() => import("@/components/MenuManager"), { loading: () => <PourFill label="Loading…" /> });
const LessonsManager = dynamic(() => import("@/components/LessonsManager"), { loading: () => <PourFill label="Loading…" /> });
const MerchManager = dynamic(() => import("@/components/MerchManager"), { loading: () => <PourFill label="Loading…" /> });
const ShopOrders = dynamic(() => import("@/components/ShopOrders"), { loading: () => <PourFill label="Loading…" /> });
const OperatorDeal = dynamic(() => import("@/components/OperatorDeal"), { loading: () => <PourFill label="Loading…" /> });
const OfferLetters = dynamic(() => import("@/components/OfferLetters"), { loading: () => <PourFill label="Loading…" /> });
const ScheduleGaps = dynamic(() => import("@/components/ScheduleGaps"), { loading: () => <PourFill label="Loading…" /> });
const PaymentSettings = dynamic(() => import("@/components/PaymentSettings"), { loading: () => <PourFill label="Loading…" /> });
const MoneyKpis = dynamic(() => import("@/components/MoneyKpis"), { loading: () => <PourFill label="Loading…" /> });
const PlanEditor = dynamic(() => import("@/components/PlanEditor"), { loading: () => <PourFill label="Loading…" /> });
const CompanyCalendar = dynamic(() => import("@/components/CompanyCalendar"), { loading: () => <PourFill label="Loading…" /> });
const EventDayPlanner = dynamic(() => import("@/components/EventDayPlanner"), { loading: () => <PourFill label="Loading…" /> });
const EventGenerator = dynamic(() => import("@/components/EventGenerator"), { loading: () => <PourFill label="Loading…" /> });
const EventPrepAI = dynamic(() => import("@/components/EventPrepAI"), { loading: () => <PourFill label="Loading…" /> });
const TroubleshootAI = dynamic(() => import("@/components/TroubleshootAI"), { loading: () => <PourFill label="Loading…" /> });
const BrewPlanner = dynamic(() => import("@/components/BrewPlanner"), { loading: () => <PourFill label="Loading…" /> });
const CogsCalculator = dynamic(() => import("@/components/CogsCalculator"), { loading: () => <PourFill label="Loading…" /> });
const AssetMaintenance = dynamic(() => import("@/components/AssetMaintenance"), { loading: () => <PourFill label="Loading…" /> });
const ChiefOfStaff = dynamic(() => import("@/components/ChiefOfStaff"), { loading: () => <PourFill label="Loading…" /> });
const ChiefOfSales = dynamic(() => import("@/components/ChiefOfSales"), { loading: () => <PourFill label="Loading…" /> });
const AuditTrail = dynamic(() => import("@/components/AuditTrail"), { loading: () => <PourFill label="Loading…" /> });
const IntegrationsPanel = dynamic(() => import("@/components/IntegrationsPanel"), { loading: () => <PourFill label="Loading…" /> });
const OutlookConnect = dynamic(() => import("@/components/OutlookConnect"), { loading: () => <PourFill label="Loading…" /> });
const CupOrderingDial = dynamic(() => import("@/components/crew/CupOrderingDial"), { loading: () => <PourFill label="Loading…" /> });
const ErrorLog = dynamic(() => import("@/components/ErrorLog"), { loading: () => <PourFill label="Loading…" /> });
const SmartIntake = dynamic(() => import("@/components/SmartIntake"), { loading: () => <PourFill label="Loading…" /> });
const DocsFiled = dynamic(() => import("@/components/DocsFiled"), { loading: () => <PourFill label="Loading…" /> });
import Prose from "@/components/Prose";
import { chime, unlockAudio } from "@/lib/chime";
import { haptic } from "@/lib/haptics";
import { DRINKS, type DrinkId } from "@/lib/menu";
import { packListFor } from "@/lib/packlist";
import { complianceFor } from "@/lib/compliance";
import { projectEvent, reconcile, DEFAULT_ECON, type EventEcon, type ProductEcon, type Projection, econBreakdown, econBreakdownLabel, type EconDrink } from "@/lib/economics";
import { buildBrief } from "@/lib/eventbrief";
import { fetchInventory, inventoryForEvent, type InventoryResp } from "@/lib/inventory";
import { fetchAssets, type AssetsResp } from "@/lib/assets";
import type { Stop, EventRow, EventTask, BookingRequest, Order, Reserve, Subscription, Vendor, VendorLocation, MeetingNote, NoteAddendum, NoteFile, Comment } from "@/lib/db";
import { uploadToBucket } from "@/lib/uploads";
import { resolveVendor, addVendorLocation, type VendorMatch, type ResolveDecision } from "@/lib/vendorLink";
const VendorResolve = dynamic(() => import("@/components/VendorResolve"), { loading: () => <PourFill label="Loading…" /> });
import Icon from "@/components/Icon";
import { useJurisdictions } from "@/components/useJurisdictions";
import AcademyCard from "@/components/AcademyCard";
import { money, moneyPlain, moneyRound } from "@/lib/money";
import { FOUNDING_MARKET, toMarket } from "@/lib/markets";
import { setStock as planStock, setLeft as planLeft, goneOf, type StockChange } from "@/lib/reserveStock";
import { OwnerDetails } from "@/components/crew/OwnerDetails";
import VenuePick from "@/components/VenuePickLazy";
import { LocationEditor } from "@/components/crew/LocationEditor";
import { LiveControl } from "@/components/crew/LiveControl";
import { staffAccess } from "@/lib/access";
import { useConfirm } from "@/components/ConfirmSheet";

const SEC_LABEL: Record<OpSection, string> = { day: "My Day", now: "Live Ops", ask: "Ask GT3", command: "Command", prep: "Readiness", plan: "Plan", studio: "Studio", brew: "Brew", garage: "Assets", driver: "Delivery", notes: "Notes", money: "Money", catalog: "Catalog", customers: "Customers", team: "Team", settings: "Settings" };
const SEC_WHEN: Record<OpSection, string> = {
  day: "Start of shift", now: "During service", ask: "When you're stuck", command: "Are we on track?", prep: "Before the event",
  plan: "Booking ahead", studio: "Promoting a drop", brew: "Production days", garage: "Assets & stock", driver: "Delivery days", notes: "Any time", money: "The books", catalog: "Changing what we sell", customers: "Your regulars", team: "People & roles", settings: "Changing how it works",
};
const SEC_SUB: Record<OpSection, string> = {
  day: "Your tasks, flags, needs-you & what's on today.",
  command: "The shared board — initiatives, this week, blockers, done, money & goals.",
  now: "The pass, pack pickups & the 86 board — live service.",
  ask: "Recipes, gear, stock & how-to — from the GT3 playbook.",
  prep: "Stock, readiness & the pack list for what's next.",
  plan: "Calendar, events, the route, leads & vendors.",
  notes: "Notes — private or shared; follow-ups become tasks.",
  studio: "Draft, schedule & post — brand & marketing.",
  brew: "Schedule, start & log brews — sized to what's reserved.",
  garage: "Load-out & tow, gear, maintenance & inventory.",
  driver: "The delivery run — map, list & one big go button.",
  money: "Sales, costs, reserves & order history.",
  catalog: "The menu, merch, lessons, membership plans, codes & perks.",
  customers: "Every customer — orders, loyalty, contact info & messages.",
  team: "People, roles & training.",
  settings: "Your account, notifications & display — and how the business runs.",
};
const SEC_MORE: Record<OpSection, string> = {
  day: "Your personal launchpad — the console's one glance screen. Everything assigned to you, everything flagged for your attention, and (for leadership) the needs-you list: booking replies, past-due team tasks and restock lows.",
  command: "The shared war room both founders see — the digital version of the magnetic board. Your initiatives (a dated program like the Aug-1 launch) with a countdown and milestone progress, then This Week, Blockers, Done and Money in one glance. This is where you answer “are we on track?” together, instead of over text. Company goals live here too — owners, progress and check-ins — so the scoreboard and the steering wheel share one screen.",
  now: "The glance before the work. Alerts land here, the service pulse shows what's waiting (orders on the pass, items 86'd), and one tap opens The Pass — the working screen with the pass board, pickup checklist and 86 board. Prep lives here too: the drop's brew sheet and Sunday delivery.",
  prep: "Get ready before you roll. Build the pack list, check stock and readiness, and sign off that the truck's loaded for the next event or stop.",
  plan: "The forward calendar. Book events, plan the truck's route (locations and dates), work the leads — incoming booking requests and the sales board — and manage vendors and venues, weeks and months out. The whole arc lives here: a lead becomes an event becomes a stop on the route, without changing sections.",
  notes: "Every note, yours and the team's. Jot one for yourself (🔒 just me), share one with the crew, or file a meeting recap — tag follow-ups and they land in people's tasks with a ping. The ✦ button jots one from any screen.",
  studio: "Your marketing studio. Draft posts and flyers, keep them on-brand, plan the feed, schedule around your drops, and moderate the guest reviews that feed the truck display.",
  brew: "Production's home. Schedule brews sized to demand, hit start-by deadlines, log every batch — with coverage, serve-by and stock checks right on the card.",
  garage: "The physical operation: trailer load-out & tow plan, the gear library, asset maintenance, and inventory with pars.",
  driver: "Run day, from the wheel: how many porches, where, and one tap into driver mode with the map and run list.",
  money: "The books. Watch sales and reserve revenue, work out costs and margins, and review order history — the numbers behind the operation. How people pay is set in Settings; what we sell — the menu, merch, lessons and plans — is the Catalog.",
  catalog: "What the business sells, in one place: the menu and its products, the merch in the Shop, the Return to Primal lessons, and what members get — membership plans, discount codes and founding perks. What each costs and earns stays in Money.",
  customers: "Your customer book. Every person who's ordered — cup, pickup or delivery, with or without an account — with their history, loyalty and contact info in one place. Messages is here too: a live broadcast to everyone in the app.",
  team: "Your people. The roster — change someone's role and access right on their row — who's on what, the org chart, and training. Inviting someone new, who owns each lane and training the AI are in Settings.",
  ask: "Your pocket brain. Ask anything about recipes, the why, gear, stock or how-to and get an answer from the GT3 playbook — from any screen.",
  // THE GUIDE SAYS WHAT SETTINGS HOLDS (2026-10-06, the settings round; by category the same day). It
  // used to call Settings "the owner control room" holding "promos & codes" — the codes were in
  // Customers — and Money's list said the pay-at-pickup switch governed delivery, which PaymentSettings
  // itself says it does not: delivery is always prepaid. Both lists say the layout now, group by group.
  settings: "How the app and the business behave, by category — the way a phone's Settings reads. You — your account, notifications and display — is everyone's. Owners and admins see Business under it: payments & checkout, ordering & delivery, locations & markets, team & permissions, reports, integrations like Outlook, the AI, and the brand guests see. Advanced is about the software itself: the activity log, app health and the lists every picker offers. What the business sells is the Catalog, and a broadcast is Customers › Messages. Each thing's old spot keeps a line that brings you to it. Edits go live instantly, no deploy.",
};
const SEC_INSIDE: Record<OpSection, string[]> = {
  day: ["Your open tasks & due dates", "Alerts flagged for you — with discussion threads", "Needs you (leadership): booking replies, past-due tasks, restock", "What's on the calendar today", "Day-of brief — dress code & call time"],
  command: ["The portfolio — ten workstreams, one owner each, audited every Monday /10", "Initiatives — a dated program with countdown & milestone progress + the goals it serves", "This week — everything due across both task lists", "Blockers — incidents, overdue work & at-risk goals", "Done this week — momentum at a glance", "Goals — owners, live numbers, one-tap check-ins", "The twelve — the Playbook's KPI board, Monday entry"],
  now: ["Service pulse — live counts, one tap into the working screen", "The Pass — the pass board (guests ping it: on my way · outside · late), pickup checklist & 86 board on ONE screen", "The drop — brew sheet & window money (the checklist lives in Service)", "Delivery run — run sheet, brew totals & packout (outcomes are logged in driver mode)", "Live truck: go live, GPS broadcast (locations live in Plan › Route; the cup-ordering dial in Settings)", "Alerts & your tasks — pointers into My Day"],
  prep: ["Per-event & per-stop pack lists", "Readiness & inspection checks", "Crew assignments & sign-off", "Load-out & gear moved to Production › Assets"],
  plan: ["Company calendar", "Events", "Route — locations & go live (the cup-ordering dial is in Settings)", "Leads — booking requests & the sales board (lead → live → expand)", "Vendors & venues"],
  notes: ["Private notes — 🔒 just for you", "Team notes & meeting recaps", "Follow-ups → assigned tasks", "✨ Transcript → summary"],
  studio: ["Post & flyer drafting", "Brand kit — logo, palette, fonts & voice (the words guests read are edited in Settings)", "Feed planning grid", "Repurpose engine", "Publishing & scheduling", "Review Desk → the truck display (/display): add or approve reviews; ✨ Simplify de-claims + trims one to display-safe"],
  brew: ["Brew schedule with start-by deadlines", "Coverage — makes vs reserved", "Serve-by freshness windows", "Batch log & recipes"],
  garage: ["Load-out & tow plan", "Gear library — manuals & specs", "Asset maintenance & what's due", "Inventory — stock, costs & pars"],
  driver: ["Next run — porches & zips", "Driver mode — map & run list", "The ONE place outcomes are logged (swap · fresh · hold · not home)"],
  customers: ["Customer list — guests & members", "Cross-channel order history (cup · pickup · delivery)", "Loyalty — points & credit", "Contact info for outreach", "Messages — a live message or ad, to everyone in the app"],
  money: ["Refunds & disputes — the door to Square (the payment switches are in Settings)", "Sales · snapshot · per-event P&L", "Pricing & margins — product economics & COGS (the menu itself is in the Catalog)", "Subscribers & subscription interest (the plans are in the Catalog)", "Order history", "The Playbook (/playbook, owners) — every growth play + where its numbers land here", "Reserve drops — configure the limited drops"],
  catalog: ["Menu & products — every drink and product, its price, and whether it's on", "The Shop · merch", "Return to Primal · lessons", "Membership plans — what members pay, and what they get", "Discount codes — mint one, see who used it, turn one off", "Founding perks — what a founding member gets, and what a VIP gets"],
  team: ["Staff roster — change a role on the person's row", "Who's on what & the org chart", "Training & academy", "Manager approvals", "Invites, lane owners & Train the AI — in Settings"],
  ask: ["Recipes & the why", "Gear & stock how-to", "The GT3 playbook"],
  settings: ["You — your account; notifications: order alerts and the pass's sound on this phone, what pings you & quiet hours; display: day, dark or auto, text size (everyone)", "Business — payments & checkout: card, pay at pickup (pickup orders only: delivery is always prepaid on the card), subscriptions; ordering & delivery: the cup-ordering dial, office delivery pricing; locations & markets; team & permissions: invites & lane owners (a role is changed on Team's roster); reports: the founder digest; integrations & Outlook's two-way sync; the AI; brand & customer app: every line guests read, the app splash", "Advanced — the activity log, app health (errors & every audit run), and the dropdown lists every picker offers"],
};

// The interactive "when to use what" guide — every section the role can reach, each expandable to a
// plain-language explainer + what's inside, with a one-tap "Go there" jump. Opened from the crew
// eyebrow or the header WHEN pill.


// money helpers for the economics panels
// 2026-07-16: PHASE_LABEL used to rename the Service lane's own segmented tabs (Route → "Schedule",
// Live Ops → "Run", Readiness → "Prep") while the page header sitting directly above that same strip
// (SEC_LABEL, below) kept the plain names — so you'd tap "Run" and land on a screen titled "Live
// Ops." Confirmed as the single biggest driver of "everything's named three different things" in
// this round's crew-console audit (the comment describing the intended reading order didn't even
// match the renames it made). Retired rather than reconciled the other way: Route/Live Ops/Readiness
// are the names already used by SEC_LABEL, the in-app Guide, and OperatorNav's own SECTION_LABEL —
// this was the one outlier, not the other three.
const toCents = (s: string) => Math.max(0, Math.round((parseFloat(s) || 0) * 100));
const pctInt = (n: number) => Math.round(n * 100);
// local YYYY-MM-DD (not UTC) — for date inputs / "is it past due in the operator's timezone"
const localYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dueLabel = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

const STATUSES: BookingRequest["status"][] = ["new", "contacted", "booked", "declined"];

// ───────────────────────── time helpers ─────────────────────────
function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}
function ageMin(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
function ageSev(min: number) {
  return min >= 8 ? "late" : min >= 4 ? "warn" : "calm";
}

// ───────────────────────── the pass (KDS) ─────────────────────────
// One ticket, one next action. Oldest-first. Aging colour signals pressure.
// Void is demoted to a guarded overflow — never under the operator's thumb.
const NEXT: Record<Order["status"], Order["status"] | null> = { new: "preparing", preparing: "ready", ready: "done", done: null, void: null };
const PREV: Record<Order["status"], Order["status"] | null> = { new: null, preparing: "new", ready: "preparing", done: "ready", void: null };
const ACT_CLASS: Record<string, string> = { new: "go", preparing: "primary", ready: "done" };
// The three live stages of the pass. Tickets move down as the operator advances them.
const STAGES: { key: Order["status"]; label: string; action: string }[] = [
  { key: "new", label: "New", action: "Start" },
  { key: "preparing", label: "In progress", action: "Mark ready" },
  { key: "ready", label: "Ready · hand off", action: "Picked up" },
];
// Group identical drinks → "2× RISE" instead of "RISE · RISE".
function groupItems(items: string[]) {
  const m = new Map<string, number>();
  items.forEach((i) => m.set(i, (m.get(i) ?? 0) + 1));
  return [...m.entries()].map(([id, qty]) => ({ id, qty }));
}
const RECENT_MS = 30 * 60000; // picked-up orders linger 30 min for review / recall

// Kitchen mounts in the Now list AND full-screen Service mode; a fixed channel name races
// removeChannel on the toggle (realtime channels are keyed by name). Unique per subscription.
let kdsChanSeq = 0;
function Kitchen() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user, profile } = useAuth();
  const me = user?.id ?? null;
  const admin = canOf(profile).admin;
  const [askCollect, collectSheet] = useCollectSheet();
  const [orders, setOrders] = useState<Order[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  // The pass's sound is this phone's setting, kept in one home (lib/passSound) — the bell below and
  // Settings › You › Notifications › Pass sound both change it, and the Pass reads it as it draws (2026-10-06).
  const muted = usePassMuted();
  const [doneOpen, setDoneOpen] = useState(false);
  const [, setTick] = useState(0);
  const [err, setErr] = useState("");
  const [staleAt, setStaleAt] = useState(0); // >0 = board hydrated from the offline snapshot
  const seeded = useRef(false);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Active board + recently-completed (last 30 min) so picked-up orders linger for
  // review / recall instead of vanishing instantly.
  const load = useCallback(async () => {
    if (!supabase) return;
    const recentISO = new Date(Date.now() - RECENT_MS).toISOString();
    const { data, error } = await supabase.from("orders").select("*").neq("status", "void")
      .or(`status.neq.done,status_changed_at.gte.${recentISO}`).order("created_at");
    if (error) {
      // No signal on a fresh open → show the last-known board (clearly labeled) instead of an
      // error over a blank pass. Taps still work; writes queue and sync when the signal returns.
      if (!seeded.current && isNetworkError(error.message)) {
        const snap = readSnapshot<Order[]>("gt3-kds-snap");
        if (snap && snapshotUsable(snap.at, Date.now())) { setOrders(snap.data); setStaleAt(snap.at); seeded.current = true; return; }
      }
      setErr(error.message); return;
    }
    setErr(""); setStaleAt(0);
    if (data) { setOrders(data as Order[]); saveSnapshot("gt3-kds-snap", data); }
    seeded.current = true;
  }, []);
  // Merge a single row into state (no refetch). Keeps recently-done; drops voids and
  // stale dones (those fall off on the next reconcile).
  const apply = useCallback((row: Order | null, removed = false) => {
    if (!row?.id) return;
    setOrders((prev) => {
      const without = prev.filter((o) => o.id !== row.id);
      const isStaleDone = row.status === "done" && !(row.status_changed_at && Date.now() - new Date(row.status_changed_at).getTime() < RECENT_MS);
      if (!removed && row.status !== "void" && !isStaleDone) {
        without.push(row);
        without.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      }
      return without;
    });
  }, []);

  // Ring + buzz + flash when a genuinely new order lands (not on initial seed / own taps).
  const announceNew = useCallback((row: Order) => {
    if (!seeded.current) return;
    if (!mutedRef.current) { chime(); haptic("alert"); }
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, []);
  // "I'm OUTSIDE" rings the pass once per order — the customer is at the window, call the name.
  const rungOutside = useRef<Set<string>>(new Set());
  const announceOutside = useCallback((row: Order) => {
    if (!seeded.current || !row.eta_status || row.eta_status !== "outside" || rungOutside.current.has(row.id)) return;
    rungOutside.current.add(row.id);
    if (!mutedRef.current) { chime(); haptic("alert"); }
    setFlash((p) => new Set(p).add(row.id));
    setTimeout(() => setFlash((p) => { const n = new Set(p); n.delete(row.id); return n; }), 6000);
  }, []);

  useEffect(() => {
    load();
    const tick = setInterval(() => setTick((n) => n + 1), 1000);   // live clocks/colours
    const recon = setInterval(() => load(), 15000);                // reconcile safety net
    // When the offline queue drains (OfflineChip replayed it), reconcile immediately so the
    // board swaps from optimistic/snapshot state to server truth.
    const onQueue = () => { if (readQueue().length === 0) load(); };
    window.addEventListener(OFFLINE_EVENT, onQueue);
    if (!supabase) return () => { clearInterval(tick); clearInterval(recon); window.removeEventListener(OFFLINE_EVENT, onQueue); };
    const ch = supabase
      .channel(`admin-kds-${++kdsChanSeq}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        const row = (p.eventType === "DELETE" ? p.old : p.new) as Order;
        apply(row, p.eventType === "DELETE");
        if (p.eventType === "INSERT" && row?.status === "new") announceNew(row);
        if (p.eventType === "UPDATE" && row) announceOutside(row);
      })
      .subscribe();
    return () => { clearInterval(tick); clearInterval(recon); window.removeEventListener(OFFLINE_EVENT, onQueue); supabase?.removeChannel(ch); };
  }, [load, apply, announceNew, announceOutside]);

  // Instant: patch local state synchronously, fire the write, no refetch on success.
  const move = async (o: Order, to: Order["status"] | null) => {
    if (!to || !supabase) return;
    apply({ ...o, status: to, status_changed_at: new Date().toISOString() } as Order, false);
    haptic("medium");
    // Ready = tell the customer off-app too (SMS/email, env-gated server-side). Fire-and-forget:
    // the board never waits on a notification provider.
    if (to === "ready") {
      void (async () => {
        try {
          await authedFetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "order_ready", id: o.id }) });
        } catch { /* best-effort */ }
      })();
    }
    // Definer RPC so a 'server' can advance status without table-wide write access.
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: to });
    if (error) {
      // No signal ≠ stop service: keep the optimistic board, park the write for replay
      // (coalesced per order — the final state wins), and say so calmly.
      if (isNetworkError(error.message)) { queueOrderStatus(o.id, to); toast("No signal — saved, will sync", "info"); return; }
      setErr(error.message); toast(`Couldn't update — ${error.message}`, "error"); load();
    }
  };
  // ── MONEY AT THE WINDOW (2026-10-04, 0341) ─────────────────────────────────────────────────────
  // "UNPAID · collect at pickup" was a sentence with nothing behind it: nothing in the app could
  // mark a pay-at-pickup order paid. Taking it is instant like a move — the ticket says PAID the
  // moment the crew taps and the database answers after — and with no signal the tap is parked and
  // replayed, because the till does not wait for bars. Returns the row as now painted, or null.
  const takeMoney = async (o: Order, via: CollectVia): Promise<Order | null> => {
    if (!supabase) return null;
    const paidRow = { ...o, ...collectedPatch(o, via, new Date().toISOString(), me) } as Order;
    apply(paidRow, false);
    haptic("paid");
    const res = await collectPayment(supabase, "cup", o.id, via);
    if (res.error) {
      if (isNetworkError(res.error)) { queueCollectCup(o.id, via); toast(`No signal — ${VIA_LABEL[via].toLowerCase()} saved, will sync`, "info"); return paidRow; }
      apply(o, false);
      toast(`Couldn't record it — ${res.error}`, "error"); load(); return null;
    }
    if (res.already) { toast(`${o.customer ?? "Guest"} had already paid — nothing taken`); load(); }
    return paidRow;
  };
  const collect = async (o: Order) => {
    const how = await askCollect({ who: o.customer ?? "Guest", cents: o.total_cents });
    if (how === "cash" || how === "card_reader") await takeMoney(o, how);
  };
  // A wrong tap is put right by the one who made it, inside the hour (or an admin) — the database's
  // rule (staff_undo_collection), mirrored by canUndo so the button is only where it will work.
  const undoTake = async (o: Order) => {
    if (!supabase) return;
    const how = o.collected_via === "cash" ? "cash" : "card-reader";
    if (!(await confirm({ title: `Undo the ${money(o.total_cents)} ${how} payment from ${o.customer ?? "Guest"}?`, body: "Only if it wasn't paid that way. You can collect it again after.", confirmLabel: "Undo it" }))) return;
    apply({ ...o, ...undonePatch(o) } as Order, false);
    const res = await undoCollection(supabase, "cup", o.id);
    if (res.error) {
      apply(o, false);
      toast(isNetworkError(res.error) ? "No signal — undo it once you're back online" : `Couldn't undo it — ${res.error}`, "error");
      return;
    }
    toast(res.already ? "Nothing to undo — it wasn't taken at the window" : `${o.customer ?? "Guest"} — back to unpaid`);
  };
  // Handing it over is when the money is asked about: an order still owed does not leave the window
  // without the question. The third answer, handing it over unpaid, is there and says what it is.
  const advance = async (o: Order) => {
    const to = NEXT[o.status];
    if (to === "done" && canCollect(o)) {
      const how = await askCollect({ who: o.customer ?? "Guest", cents: o.total_cents, handOff: true });
      if (!how) return;
      const row = how === "unpaid" ? o : await takeMoney(o, how);
      if (!row) return;
      return move(row, to);
    }
    return move(o, to);
  };
  const recall = (o: Order) => move(o, PREV[o.status]);
  // Voiding a paid order is a refund somebody has to make. It used to say only "This can't be
  // undone" — about an order a card had paid for — and flag nobody; the pack board's cancel already
  // flagged its refunds (and 0242 made those critical so they escalate). Now both say the same.
  const voidOrder = async (o: Order) => {
    const how = paidHow(o);
    const amt = money(o.total_cents);
    const body = how === "cash" ? `They paid ${amt} cash — hand it back. This can't be undone.`
      : how === "card_reader" ? `They paid ${amt} on the card reader — refund it in Square; the inbox gets a flag. This can't be undone.`
      : how ? `They paid ${amt} online — refund it in Square; the inbox gets a flag. This can't be undone.`
      : "Nothing was paid. This can't be undone.";
    if (!(await confirm({ title: `Void ${o.customer ?? "this order"}?`, body, confirmLabel: "Void order", danger: true }))) return;
    if (!supabase) return;
    apply(o, true);
    const { error } = await supabase.rpc("staff_set_order_status", { p_order: o.id, p_status: "void" });
    if (error) {
      if (isNetworkError(error.message)) { queueOrderStatus(o.id, "void"); toast("No signal — void saved, will sync", "info"); }
      else { setErr(error.message); toast(`Couldn't void — ${error.message}`, "error"); load(); return; }
    }
    if (how && how !== "cash") {
      await raiseAlertClient({
        severity: "critical", category: "money", kind: "refund_needed", subjectId: o.id,
        title: "Voided a PAID order — refund needed",
        body: `${o.customer ?? "Guest"} · #${o.id.slice(0, 4).toUpperCase()} · ${amt} paid ${how === "card_reader" ? "on the card reader" : "online"}. Refund it in Square.`,
        link: "/crew?s=money&a=pay",
      });
    }
  };

  const toggle = (k: string) => setCollapsed((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleMute = () => { setPassMuted(!muted); unlockAudio(); };
  const active = orders.filter((o) => o.status !== "done");
  const done = orders.filter((o) => o.status === "done").sort((a, b) => (a.status_changed_at < b.status_changed_at ? 1 : -1));
  // A ticket's clock starts when its order can be made (lib/ordering, 0343): placed ahead of a stop,
  // that is the stop's opening — not 7am, three hours before the truck could have made it.
  const late = active.filter((o) => o.status !== "ready" && !waitingToOpen(o) && ageMin(orderClockFrom(o)) >= 8);

  return (
    <div className="adm-sec" id="kitchen-pass">
      {/* Service mode's .svc-bar already renders "The Pass" directly above Kitchen (see AdminPage's
          svc-bar, ~line 5730) — this SectionHeader only repeated it (case differs), so it's cut,
          same precedent as ReadinessAgent's redundant "Readiness" header being cut where a
          crew-group divider directly above already said it. The mute toggle + active count are
          real controls (not a title), so they're kept, right-aligned in a bare wrapper. Unlike
          .adm-prep-view (which has its own margin-left:auto), neither .k-count nor .kds-mute
          does, so the wrapper reproduces the rest of .k-sec-r's own layout too (align-items:center,
          gap:8px) rather than just justifyContent, so this doesn't lose the vertical centering or
          the pill↔button spacing the two had inside the old SectionHeader's right slot. */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        {active.length > 0 && <span className="k-count">{active.length} active</span>}
        <button type="button" className="kds-mute" onClick={toggleMute} aria-pressed={muted}>{muted ? "🔇 Muted" : <><Icon name="bell" /> Sound</>}</button>
      </div>

      {err && <div className="adm-attn" role="alert">Backend error: {err}</div>}
      {staleAt > 0 && (
        <div className="adm-attn" role="alert">
          <b>Offline</b> — showing the last-known board (from {ago(new Date(staleAt).toISOString())}). Taps still work and will sync when the signal returns.
        </div>
      )}
      {late.length > 0 && (
        <div className="adm-attn" role="alert">
          <b>{late.length} guest{late.length === 1 ? "" : "s"}</b> past 8 min — step over and reassure.
        </div>
      )}

      <div aria-live="polite">
        {STAGES.map((st) => {
          const list = orders.filter((o) => o.status === st.key);
          const isCol = collapsed.has(st.key);
          return (
            <div className="kds-stage" key={st.key}>
              <button type="button" className="kds-stage-h" onClick={() => toggle(st.key)} aria-expanded={!isCol}>
                <span className={`kds-caret${isCol ? " col" : ""}`} aria-hidden="true">›</span>
                <span className="kds-stage-name">{st.label}</span>
                <span className="kds-stage-n">{list.length}</span>
              </button>
              {!isCol && list.length === 0 && <div className="kds-empty">Nothing here.</div>}
              {!isCol && list.map((o) => {
                const waiting = waitingToOpen(o);
                const sev = waiting ? "calm" : ageSev(ageMin(orderClockFrom(o)));
                return (
                  <div className={`adm-order st-${o.status}${flash.has(o.id) ? " flash" : ""}`} key={o.id}>
                    <button className="adm-act-more" onClick={() => voidOrder(o)} aria-label={`Void ${o.customer ?? "order"}`}><Icon name="more" /></button>
                    <div className="adm-order-top">
                      <b>{o.customer ?? "Guest"}</b>
                      <span className={`adm-age ${sev}`}>{waiting && o.ready_from ? waitingLabel(o.ready_from) : ago(orderClockFrom(o))}</span>
                    </div>
                    <div className="adm-items">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")}</div>
                    {o.eta_status && (
                      <span className={`kds-eta ${o.eta_status}`}>
                        {o.eta_status === "outside" ? <><Icon name="pin" /> OUTSIDE — call the name</> : o.eta_status === "on_way" ? "🏃 On the way" : <><Icon name="clock" /> Running late</>}
                      </span>
                    )}
                    <div className="meta">#{o.id.slice(0, 4).toUpperCase()} · {money(o.total_cents)} · <span className={isSettled(o) ? "pd" : "unp"}>{passWord(o)}</span> · <span className="kds-stagetime">{ago(o.status_changed_at)} in stage</span></div>
                    <div className="adm-actions-row">
                      {PREV[o.status] && <button className="adm-recall" onClick={() => recall(o)} aria-label="Move back a stage">↩</button>}
                      {canCollect(o) && <button type="button" className="adm-recall adm-collect" onClick={() => collect(o)}>Collect {money(o.total_cents)}</button>}
                      {canUndo(o, me, admin) && (
                        <button type="button" className="adm-recall adm-collect done" onClick={() => undoTake(o)} aria-label={`Undo the ${o.collected_via === "cash" ? "cash" : "card-reader"} payment from ${o.customer ?? "Guest"}`}>
                          {o.collected_via === "cash" ? "Cash" : "Reader"} <Icon name="check" />
                        </button>
                      )}
                      <button className={`adm-act ${ACT_CLASS[o.status]}`} onClick={() => advance(o)}>{st.action}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {done.length > 0 && (
          <div className="kds-stage">
            <button type="button" className="kds-stage-h" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen}>
              <span className={`kds-caret${!doneOpen ? " col" : ""}`} aria-hidden="true">›</span>
              <span className="kds-stage-name">Just completed</span>
              <span className="kds-stage-n">{done.length}</span>
            </button>
            {doneOpen && done.map((o) => (
              <div className="adm-order st-done" key={o.id}>
                <div className="adm-order-top">
                  <b>{o.customer ?? "Guest"}</b>
                  <span className="adm-age calm">picked up {ago(o.status_changed_at)} ago</span>
                </div>
                <div className="adm-items">{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")}</div>
                <div className="meta">#{o.id.slice(0, 4).toUpperCase()} · {money(o.total_cents)} · <span className={isSettled(o) ? "pd" : "unp"}>{passWord(o, true)}</span></div>
                <div className="adm-actions-row">
                  <button className="adm-recall" onClick={() => recall(o)} aria-label={`Bring ${o.customer ?? "order"} back to ready`}>↩ Recall</button>
                  {/* Handed over unpaid and settled a minute later — a regular squaring up — is
                      still money taken at the window, and this tray is where that order still is. */}
                  {canCollect(o) && <button type="button" className="adm-recall adm-collect" onClick={() => collect(o)}>Collect {money(o.total_cents)}</button>}
                  {canUndo(o, me, admin) && (
                    <button type="button" className="adm-recall adm-collect done" onClick={() => undoTake(o)} aria-label={`Undo the ${o.collected_via === "cash" ? "cash" : "card-reader"} payment from ${o.customer ?? "Guest"}`}>
                      {o.collected_via === "cash" ? "Cash" : "Reader"} <Icon name="check" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {active.length === 0 && done.length === 0 && <EmptyState title="The pass is clear" sub="New orders arrive here in realtime." />}
      {collectSheet}
    </div>
  );
}

// ───────────────────────── service pulse: the glance before the work ─────────────────────────
// Now doesn't render the boards anymore — it renders their PULSE. One hero button carries the
// live counts (orders on the pass, items 86'd) and opens Service mode, where the work happens.
function ServicePulse({ onEnter }: { onEnter: () => void }) {
  const [pass, setPass] = useState<number | null>(null);
  const [out, setOut] = useState(0);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [o, p] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).neq("status", "void").neq("status", "done"),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true).eq("sold_out", true),
    ]);
    if (o.count !== null) setPass(o.count);
    if (p.count !== null) setOut(p.count);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["orders", "products"], load);
  return (
    <button type="button" className={`svc-enter${(pass ?? 0) > 0 ? " hot" : ""}`} onClick={onEnter}>
      <span className="svc-enter-t">▶ The Pass</span>
      <span className="svc-enter-s">
        {pass === null ? "The pass, pickups & the 86 board — one screen"
          : <>{pass > 0 ? <><b><NumberRoll value={pass} ms={450} /></b> on the pass</> : "The pass is clear"}{out > 0 && <> · <b><NumberRoll value={out} ms={450} /></b> 86&rsquo;d</>} — tap to work</>}
      </span>
    </button>
  );
}

// ───────────────────────── alerts: the "don't-miss" spine ─────────────────────────
// Leadership tier comes from the one shared definition (AuthProvider) — the audit found this list
// re-typed seven ways with drift. Alerts themselves are staff-wide since 0157.

// Raise an alert. The INSERT is the whole contract — the alerts_push_fanout trigger (0157)
// delivers push + Teams for every row, same as the server and pg_cron producers. Category is the
// closed lib/alertKinds vocabulary, so misrouted "Open →" buttons are a type error now.
// ONE alert producer (lib/clientAlerts) — this shim keeps the crew page's historical call shape but
// delegates to the shared helper, so the payload can never drift from every other surface again.
async function raiseAlert(a: {
  severity?: "critical" | "important" | "fyi"; category: AlertCategory; title: string;
  body?: string; link?: string; target_user_id?: string | null; created_by?: string | null;
  kind?: string; subject_id?: string | null; // 0174 action contract
}) {
  return raiseAlertClient({
    severity: a.severity ?? "important", category: a.category, title: a.title,
    body: a.body, link: a.link ?? "/crew", targetUserId: a.target_user_id,
    kind: a.kind, subjectId: a.subject_id ?? undefined, createdBy: a.created_by,
  });
}

// How many comments hang off each subject — drives the count badge on a 💬 toggle so activity is
// visible at a glance without opening every thread (organization/management at scale).
async function commentCounts(col: "event_task_id" | "meeting_note_id" | "alert_id", ids: string[]): Promise<Record<string, number>> {
  if (!supabase || ids.length === 0) return {};
  const { data } = await supabase.from("comments").select(col).in(col, ids);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Record<string, string | null>[]) { const k = r[col]; if (k) out[k] = (out[k] ?? 0) + 1; }
  return out;
}

// Where an alert lives — route it to the screen that owns it, so you can act on it immediately.
// Reservation alerts don't route at all: callers pop the drop sheet (DropOps) in place instead,
// so "Open" always visibly does something even when the alert's home is the screen you're on.
function alertIsReservation(title: string | null | undefined): boolean {
  return /reservation/i.test(title || "");
}
function alertDest(category: string | null | undefined, title?: string | null, link?: string | null): { section: OpSection; planTab?: string; anchor?: string } | null {
  // Priority (2026-07-30, Ryan: "When I hit open my alert from command, it takes me back to my
  // day… It doesn't flow"):
  //  1) The alert's OWN link, when it names a real section (?s=…) — the producer knows its home
  //     better than any category map (sign-ups link Customers, deliveries link Driver, and the
  //     old router threw all of that away and bounced them to My Day's task list).
  //  2) The category map below.
  //  3) null — this alert has NO home beyond its own card, so the card doesn't render Open at
  //     all. Teleporting somewhere unrelated and closing the inbox was the no-flow.
  //
  // A LINK TO A PANEL THAT MOVED (2026-10-06, the settings round). An alert keeps the link it was
  // raised with, so one raised before Settings gathered the menu, the plans, the codes and the perks
  // still says ?s=money&a=menu or ?s=customers&a=cust-codes. The panels kept their ids; lib/panelHome
  // says which section each one is in now, and the jump goes there.
  const s = /[?&]s=([a-z-]+)/.exec(link || "");
  if (s && VALID_SECTIONS.has(s[1] as OpSection)) {
    const a = /[?&]a=([a-z0-9-]+)/.exec(link || "");
    const home = panelHome(s[1], a?.[1]);
    return { section: home.section as OpSection, ...(home.anchor ? { anchor: home.anchor } : {}) };
  }
  // normalizeCategory folds the legacy vocabulary (orders/billing/assignment/note/…) into the
  // closed set, so historic rows route correctly too. The audit found the old router matched
  // "order" (which nothing emitted) while every real order ping fell through to My Day.
  const cat = normalizeCategory(category);
  if (cat === "order") return { section: "now", anchor: "kitchen-pass" };  // land ON the pass, even from the pass screen — jumpTo opens it
  if (cat === "money") return { section: "money" };
  if (cat === "brew") return { section: "brew" };
  if (cat === "booking") return { section: "plan", planTab: "leads" }; // leads live on Plan now (2026-07-30 merge)
  if (cat === "prep") return { section: "prep" };
  if (cat === "content" && !/content ready for review/i.test(title || "")) return { section: "studio" };
  if (cat === "strategy") return { section: "command", anchor: "goals" }; // goals live ON Command now (2026-07-29 merge)
  if (cat === "task") return { section: "day", anchor: "my-day-tasks" }; // your tasks DO live on My Day
  return null; // system & anything homeless: the card is the content
}
// THE PASS IS A SCREEN, NOT A PANEL (2026-10-06, the settings round). Order alerts were sent to
// #kitchen-pass to "land ON the pass" — but that id is drawn only while the Pass is open (service
// mode, AdminPage below), so the jump looked for it for five seconds and stopped at the top of Live
// Ops. A jump to the Pass opens it instead: OPEN_PASS_EVENT, which the page answers by going to Live
// Ops and opening service mode. Every other anchor is a panel, and goes to lib/anchors as before.
const PASS_ANCHOR = "kitchen-pass";
const OPEN_PASS_EVENT = "gt3-open-pass";
function jumpTo(anchor?: string): void {
  if (anchor === PASS_ANCHOR) { window.dispatchEvent(new Event(OPEN_PASS_EVENT)); return; }
  scrollToAnchor(anchor);
}
// After a section switch React needs a beat to mount the destination before we can scroll to it.
// JUMP TO A PANEL — the third round of the same bug, so this time it is written down.
//
// ── WHAT RYAN SAW ──────────────────────────────────────────────────────────────────────────────
// He tapped a link to draft a contract and landed on Money's Spend & budget card. Not an error —
// the RIGHT section, at the top, with the thing he asked for six screens below the fold.
//
// Measured in production before touching this: /crew?s=money&a=offers ends at scrollY 0 with
// #offers sitting 3,760px down a 635px viewport. The ?a= is stripped from the URL either way, so
// the deep link reports success by disappearing.
//
// ── WHY THE OLD ONE COULD NOT WORK ─────────────────────────────────────────────────────────────
// It was one setTimeout(…, 120). Three things happen after 120ms on this page:
//   · every Panel restores its open state from localStorage in its OWN effect, and each one that
//     expands pushes the target further down — Money has twenty of them;
//   · panel bodies are dynamic() imports that land later still;
//   · a smooth scroll started before that reflow gets absorbed by it.
// So it scrolled to where the anchor was before ~3,000px appeared above it. The earlier fix in
// Panel's header (giving the section a real DOM id, 7/16) was necessary and not sufficient: an id
// that exists is not the same as a place you arrive.
//
// And a COLLAPSED panel was never opened at all. The link worked for Ryan only to the extent that
// localStorage remembered he had opened it once by hand; for anyone else it scrolls to a shut
// accordion header. A link that half-works is worse than one that plainly does not — lib/records.ts
// wrote that rule down before this file broke it twice.
//
// The jump to a panel — and the event every <Panel> opens on — live in lib/anchors.ts (2026-10-03):
// the Readiness tiles had grown a second, weaker copy that never opened the panel it pointed at.
// Content-review alerts are handled IN PLACE (like reservations) — no jump to the noisy calendar.
function alertIsContentReview(title: string | null | undefined): boolean {
  return /content ready for review/i.test(title || "");
}
function postIdFromLink(link: string | null | undefined): string | null {
  const m = /[?&]post=([a-f0-9-]{6,})/i.exec(link || "");
  return m ? m[1] : null;
}

// Pop-out sheet to approve or revise a post right from the notification. Edit the caption, approve
// (saves the edit), or request changes with a note. Acting notifies the creator and clears the alert.
function ContentApprovalSheet({ contentId, meName, meId, onClose, onActioned }: { contentId: string; meName: string; meId: string | null; onClose: () => void; onActioned: () => void }) {
  const { toast } = useApp();
  type Post = { id: string; title: string; caption: string | null; hashtags: string[] | null; status: string; kind: string; channel: string; created_by: string | null };
  const [item, setItem] = useState<Post | null>(null);
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("content_items").select("id, title, caption, hashtags, status, kind, channel, created_by").eq("id", contentId).maybeSingle()
      .then(({ data }) => { if (data) { setItem(data as Post); setCaption((data as Post).caption || ""); } });
  }, [contentId]);

  const decide = async (status: "approved" | "changes") => {
    if (!supabase || busy) return;
    if (status === "changes" && !note.trim()) { toast("Add a quick note on what to change", "error"); return; }
    setBusy(true);
    const patch: Record<string, unknown> = { status };
    if (caption !== (item?.caption ?? "")) patch.caption = caption;           // revise inline
    if (status === "changes") patch.review_note = note.trim();
    await supabase.from("content_items").update(patch).eq("id", contentId);
    const t = (item?.title || "Untitled").slice(0, 80);
    if (item?.created_by && item.created_by !== meId) {
      await raiseAlert(status === "approved"
        ? { severity: "fyi", category: "content", kind: "content_approved", subject_id: contentId, title: `✅ Approved — ${t}`.slice(0, 180), body: `${meName} approved "${t}". Ready to schedule/publish.`.slice(0, 300), link: `/crew?post=${contentId}`, target_user_id: item.created_by }
        : { severity: "important", category: "content", kind: "content_changes", subject_id: contentId, title: `✏️ Changes requested — ${t}`.slice(0, 180), body: note.trim().slice(0, 300), link: `/crew?post=${contentId}`, target_user_id: item.created_by });
    }
    setBusy(false);
    toast(status === "approved" ? "Approved" : "Changes requested");
    onActioned(); // acks the review alert so it clears
  };

  return (
    <Sheet open onClose={onClose} label="Review post" dirty={!!item && (caption !== (item.caption ?? "") || !!note.trim())}
      header={<div style={{ display: "flex", alignItems: "center" }}><span>Review post</span><span style={{ marginLeft: "auto" }} /><CloseButton className="drop-sheet-x hit-44" onClick={onClose} /></div>}>
        {!item ? <div className="dops-empty"><PourFill size={38} label="Pulling it up…" /></div> : (
          <div className="capprove">
            <div className="capprove-meta">{item.kind} · {item.channel}{item.status ? ` · ${item.status}` : ""}</div>
            <div className="capprove-t">{item.title}</div>
            <label className="prod-f"><span>Caption — edit here to revise</span><textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
            {item.hashtags?.length ? <div className="capprove-tags">{item.hashtags.map((h) => `#${h}`).join(" ")}</div> : null}
            <input className="ev-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (only if requesting changes)" aria-label="What to change" />
            <div className="capprove-acts">
              <button type="button" className="oa-cta" disabled={busy} onClick={() => decide("approved")}>{busy ? "…" : <><Icon name="check" /> Approve</>}</button>
              <button type="button" className="studio-act" disabled={busy} onClick={() => decide("changes")}>Request changes</button>
            </div>
            <p className="insp-foot">Approving saves your caption edits. Once you act, this alert clears.</p>
          </div>
        )}
    </Sheet>
  );
}

// Pop-out card for reservation alerts — the full DropOps manager (brew totals, pickup checklist,
// bottles-in toggles) in a centered sheet, so a flag can be handled without leaving the screen.
function DropSheet({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const canPlan = (profile?.is_admin ?? false) || ["owner", "admin", "event_manager"].includes(profile?.role ?? "");
  return (
    <Sheet open onClose={onClose} header={<div style={{ display: "flex", alignItems: "center" }}><span>This week&rsquo;s drop</span><button type="button" className="drop-sheet-x hit-44" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>}>
        <DropOps canPlan={canPlan} />
        <button type="button" className="drop-sheet-done" onClick={onClose}>Done</button>
    </Sheet>
  );
}

// The "don't-miss" inbox — unacknowledged alerts for me (or all-leadership), critical first.
// Realtime, so a new alert lands at the top of the Now screen the instant it's raised.
// Its gear opens the notification settings (0177) — mutes and quiet hours — which live in
// components/NotifPrefs since 2026-10-06 (the settings round): Settings › You draws the same controls
// in place, and the gear still opens them in a sheet (NotifPrefsSheet).

function AlertsInbox({ userId, compact = false, title = "Alerts", onNavigate }: { userId: string | null; compact?: boolean; title?: string; onNavigate?: () => void }) {
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const { toast } = useApp();
  const meName = profile?.display_name?.trim() || "Me";
  // One source of truth for "what needs me" — the same hook drives My Day's flags and the nav
  // badge, so the three counters that used to disagree now agree by construction. Ack semantics
  // live in the hook: row-ack for targeted alerts, per-user read for broadcasts (0157).
  const { flags: mine, held, critCount: crit, error: readErr, reload, ack, clearAll, clearHeld, snooze, restore, unsnooze } = useMyAlerts(userId);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const streams = useWorkStreams();
  const myLane = (cat: string | null) => streams.some((s) => s.owner_user_id === userId && s.categories.includes(normalizeCategory(cat)));
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const loadCounts = useCallback(async () => { setCounts(await commentCounts("alert_id", mine.map((r) => r.id))); }, [mine]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useRealtimeTable("comments", loadCounts);
  // Respond immediately: reservation alerts pop the drop sheet right here; everything else jumps
  // to the screen that owns it.
  const [dropSheet, setDropSheet] = useState(false);
  const [reviewPost, setReviewPost] = useState<{ id: string; alert: MyFlag } | null>(null);
  const { openRecord } = useRecord();
  const { openTask } = useTaskSheet();
  // Whether Open has anywhere to go — the record or task an alert names, or the screen that owns it.
  const canOpen = (a: MyFlag) => !!recordForAlert(a.kind, a.subject_id)
    || (!!a.kind && TASK_ALERT_KINDS.includes(a.kind) && !!a.subject_id)
    || alertIsReservation(a.title) || alertIsContentReview(a.title) || alertDest(a.category, a.title, a.link) != null;
  const gotoAlert = (a: MyFlag) => {
    // An alert that names a ROW opens that row. The 0174 contract has carried subject_id since
    // before anything could open one, so every shop-order ping has known exactly which order it
    // meant and still landed people at the top of this page. (0313)
    const rec = recordForAlert(a.kind, a.subject_id);
    if (rec) { openRecord(rec.kind, rec.id); onNavigate?.(); return; }
    // An alert about ONE task opens that task (2026-10-04). "Ryan assigned you: Ice run" used to
    // scroll My Day's list, and a task_due ping landed on the top of Readiness.
    if (a.kind && TASK_ALERT_KINDS.includes(a.kind) && a.subject_id) { openTask(a.subject_id, "event"); onNavigate?.(); return; }
    if (alertIsReservation(a.title)) { setDropSheet(true); return; }
    if (alertIsContentReview(a.title)) {
      const pid = postIdFromLink(a.link);
      if (pid) { setReviewPost({ id: pid, alert: a }); return; }
      // No post id on the link (an older alert raised before the link format was fixed, or a
      // malformed one) — don't silently fall through to the generic My Day route below, which
      // reads as "Open" teleporting you somewhere unrelated instead of doing nothing useful.
      toast("Couldn't find that post — it may have been removed. Check Brand → Studio.", "error");
      return;
    }
    const d = alertDest(a.category, a.title, a.link);
    if (!d) return;              // homeless alert — the card is the content; Open isn't rendered for these
    onNavigate?.();              // close the inbox sheet FIRST — else the destination renders behind it
    if (d.planTab && isPlanTab(d.planTab)) { goPlanTab(d.planTab, { setSection }); } else { setSection(d.section); }
    jumpTo(d.anchor);            // a panel is scrolled to and opened; the Pass is opened (jumpTo)
  };

  const rank = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
  const sorted = [...mine].sort((a, b) => rank(a.severity) - rank(b.severity));

  // GOT IT, LATER — AND UNDO (2026-10-05, the gesture round). The ✓ and the clock, and the swipes that
  // stand for them, go through these: the flag goes at once, the toast says so with an Undo that
  // brings it back, and a write the database refused is said instead of the flag quietly returning on
  // the next read.
  const said = (t: string) => (t.length > 34 ? `${t.slice(0, 33).trimEnd()}…` : t);
  const clear = async (a: MyFlag) => {
    toast(`Cleared: ${said(a.title)}`, "success", { action: { label: "Undo", run: () => { void restore([a]).then((e) => { if (e) toast(`Couldn't bring it back — ${e}`, "error"); }); } } });
    const e = await ack(a);
    if (e) toast(`Couldn't clear it — ${e}`, "error");
  };
  const later = async (a: MyFlag) => {
    toast(`Snoozed for an hour: ${said(a.title)}`, "success", { action: { label: "Undo", run: () => { void unsnooze(a).then((e) => { if (e) toast(`Couldn't bring it back — ${e}`, "error"); }); } } });
    const e = await snooze(a, 3600_000);
    if (e) toast(`Couldn't snooze it — ${e}`, "error");
  };
  const clearEvery = async () => {
    const all = [...mine];
    toast(`Cleared ${all.length}`, "success", { action: { label: "Undo", run: () => { void restore(all).then((e) => { if (e) toast(`Couldn't bring them back — ${e}`, "error"); }); } } });
    const e = await clearAll();
    if (e) toast(`Couldn't clear them — ${e}`, "error");
  };

  // Compact strip (used in Now) — alerts have ONE home, the inbox. Opens it RIGHT HERE via
  // gt3-open-inbox (any screen can summon it) instead of routing through My Day first — the exact
  // bounce the alerts round killed (2026-08-01 audit).
  if (compact) {
    if (mine.length === 0) return null;   // during quiet hours the held digest stays off the service strip
    return (
      <button type="button" className={`alerts-strip${crit ? " crit" : ""}`} onClick={() => window.dispatchEvent(new Event("gt3-open-inbox"))}>
        <span className="alerts-strip-i" aria-hidden>{crit ? <Icon name="warning" /> : <Icon name="bell" />}</span>
        <span className="alerts-strip-t"><b>{mine.length} {mine.length === 1 ? "alert needs" : "alerts need"} you</b>{crit ? ` · ${crit} critical` : ""}</span>
        <span className="alerts-strip-go">Open inbox <Icon name="arrowRight" /></span>
      </button>
    );
  }

  // The ONE door to notification settings (mutes, quiet hours). It used to be drawn only beside a
  // list with something in it, so on a quiet day — the evening you would set quiet hours — the
  // inbox said "all caught up" and offered no way in (2026-10-04, the form audit). Both faces carry it.
  const prefsDoor = <button type="button" className="alert-prefs-btn" onClick={() => setPrefsOpen(true)} aria-label="Notification settings">⚙</button>;
  const prefsSheet = prefsOpen && <NotifPrefsSheet userId={userId} onClose={() => setPrefsOpen(false)} />;

  // Full/sheet face (My Day inbox): unlike the compact strip, this is a destination you open on
  // purpose — say something, don't just vanish. Held-quiet-hours-only counts as "nothing" here too.
  if (mine.length === 0 && held.length === 0) {
    return (
      <div className="adm-sec">
        <SectionHeader label={title} right={prefsDoor} />
        {prefsSheet}
        {/* "All caught up" is a claim about the inbox, so it needs the inbox to have answered. */}
        {readErr ? (
          <EmptyState role="alert" title="Couldn't check your inbox" sub={`${readErr}. This is not "all caught up" — the read did not answer.`}
            action={<button type="button" className="btn-ter" onClick={() => reload()}>Try again</button>} />
        ) : (
          <EmptyState title="You're all caught up" sub="No flags or pings need you right now." />
        )}
      </div>
    );
  }

  return (
    <div className="adm-sec">
      {dropSheet && <DropSheet onClose={() => setDropSheet(false)} />}
      {reviewPost && <ContentApprovalSheet contentId={reviewPost.id} meName={meName} meId={userId} onClose={() => setReviewPost(null)} onActioned={() => { ack(reviewPost.alert); setReviewPost(null); }} />}
      <SectionHeader label={title} right={<>
        {mine.length > 0 && <span className={`k-count${crit ? " due" : ""}`}>{mine.length}{crit ? ` · ${crit} critical` : ""}</span>}
        {mine.length > 1 && <button type="button" className="alert-clearall" onClick={() => clearEvery()}>Clear all</button>}
        {prefsDoor}
      </>} />
      {prefsSheet}

      {/* Quiet-hours digest (0177 + S·5b): non-criticals that arrived during your quiet window are
          held off the glance and gathered here — the morning digest. They surface on their own when
          quiet hours end; review or clear them anytime. Criticals never land here. */}
      {held.length > 0 && (
        <div className="digest">
          <button type="button" className="digest-head" onClick={() => setDigestOpen((v) => !v)} aria-expanded={digestOpen}>
            <span className="digest-t"><b>Quiet hours</b> · {held.length} held · surfaces when quiet hours end</span>
            <span className="digest-x">{digestOpen ? "Hide" : "Review"}</span>
          </button>
          {digestOpen && (
            <div className="digest-body">
              {held.map((a) => (
                <div key={a.id} className={`digest-item sev-${a.severity}`}>
                  <button type="button" className="digest-item-go" onClick={() => gotoAlert(a)}>
                    <span className="digest-item-t">{a.title}<span className="alert-when">{ageLabel(a.created_at)}</span></span>
                    {a.body && <span className="digest-item-b">{a.body}</span>}
                  </button>
                  <button type="button" className="digest-item-x" onClick={() => ack(a)} aria-label={`Dismiss ${a.title}`}><Icon name="close" /></button>
                </div>
              ))}
              <button type="button" className="digest-clear" onClick={() => clearHeld()}>Mark all read</button>
            </div>
          )}
        </div>
      )}

      {/* Each flag swipes the way a Mail row does (components/SwipeRow): left for Later and Got it — a
          long swipe clears it — right to open what it names. The buttons stay; the swipe is the fast
          way to them. */}
      {sorted.map((a) => (
        <SwipeRow key={a.id} className="alert-swipe"
          lead={canOpen(a) ? [{ key: "open", label: "Open", icon: "arrowRight", tone: "info", run: () => gotoAlert(a) }] : []}
          trail={[
            ...(a.severity !== "critical" ? [{ key: "later", label: "1 hour", icon: "clock", tone: "warn", removes: true, run: () => { void later(a); } } satisfies RowAction] : []),
            { key: "clear", label: "Got it", icon: "check", tone: "ok", removes: true, run: () => { void clear(a); } },
          ]}>
        <div className={`alert sev-${a.severity}`}>
          <div className="alert-row">
            {/* The words that name the thing open it (2026-10-04): only the small Open button used
                to, and "New reservation · Jess reserved a 6-pack…" was dead text beside it. */}
            {(() => {
              const main = (
                <>
                  <span className="alert-title">{a.title}{myLane(a.category) && <span className="myday-lane">your lane</span>}{(a.occurrences ?? 1) > 1 && <span className="alert-times" title={`Happened ${a.occurrences} times${a.last_seen_at ? `, last ${ageLabel(a.last_seen_at)}` : ""}`}>×{a.occurrences}</span>}<span className="alert-when">{ageLabel(alertWhen(a))}</span></span>
                  {a.body && <span className="alert-body">{a.body}</span>}
                </>
              );
              return canOpen(a)
                ? <button type="button" className="alert-main alert-main-go" onClick={() => gotoAlert(a)}>{main}</button>
                : <div className="alert-main">{main}</div>;
            })()}
            {counts[a.id] ? <button type="button" className="alert-discuss" onClick={() => setOpenThread(openThread === a.id ? null : a.id)} aria-label="Discuss"><Icon name="chat" /><span className="cmt-count">{counts[a.id]}</span></button> : null}
            {canOpen(a) && (
              <button type="button" className={alertHasInlineAction(a.kind) ? "alert-open ghost" : "alert-open"} onClick={() => gotoAlert(a)}>{alertHasInlineAction(a.kind) ? "Open" : <>Open <Icon name="arrowRight" /></>}</button>
            )}
            {a.severity !== "critical" && <button type="button" className="alert-snz" onClick={() => { void later(a); }} aria-label="Snooze 1 hour" title="Snooze 1 hour"><Icon name="clock" /></button>}
            <button type="button" className="alert-ack" onClick={() => { void clear(a); }} aria-label="Got it"><Icon name="check" /></button>
          </div>
          {alertHasInlineAction(a.kind) && <AlertAction flag={a} meId={userId} onResolved={() => ack(a)} />}
          {openThread === a.id && (
            <CommentThread subject={{ col: "alert_id", id: a.id }} notifyIds={[a.target_user_id, a.created_by]} label={a.title} meId={userId} meName={meName} />
          )}
        </div>
        </SwipeRow>
      ))}
    </div>
  );
}

// ───────────────────────── discussion threads (two-way collaboration) ─────────────────────────
// One reusable thread, keyed to any subject (a task, a meeting note, or an alert). A new reply
// notifies the counterparties + anyone @mentioned through the alert spine (push + inbox + Teams),
// so the back-and-forth lives in the app instead of Teams/text.
function CommentThread({ subject, notifyIds, label, meId, meName }: {
  subject: { col: "event_task_id" | "meeting_note_id" | "alert_id"; id: string };
  notifyIds: (string | null)[];
  label: string;
  meId: string | null;
  meName: string;
}) {
  const { toast } = useApp();
  const [comments, setComments] = useState<Comment[]>([]);
  const [cmtFailed, setCmtFailed] = useState(false);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // @ is a pick list (lib/mentions): who each inserted @token stands for, by id.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const replyRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    // "No notes on this stop" is a claim about the record, not about the network. Say which.
    const { data, error } = await supabase.from("comments").select("*").eq(subject.col, subject.id).order("created_at");
    if (error) { setCmtFailed(true); return; }
    setCmtFailed(false);
    setComments((data as Comment[]) ?? []);
  }, [subject.col, subject.id]);
  useEffect(() => {
    load();
    if (!supabase) return;
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data, error }) => { if (!error) setStaff((data as { id: string; display_name: string | null; role?: string | null }[]) ?? []); });
  }, [load]);
  useRealtimeTable({ table: "comments", filter: `${subject.col}=eq.${subject.id}` }, load);

  const nameOf = (uid: string | null) => (uid && uid === meId ? "You" : (staff.find((s) => s.id === uid)?.display_name?.trim() || "Crew"));
  const firstOf = (uid: string | null) => nameOf(uid).split(" ")[0];

  const draft = mentionDraft(text);
  const choices = draft === null ? [] : mentionChoices(staff.filter((s) => s.id !== meId), draft).slice(0, 6);
  const reach = resolveMentions(text, staff, picked);
  const reachIds = reach.ids.filter((id) => id !== meId);   // nobody is pinged about their own reply
  const send = async () => {
    if (!supabase || !text.trim() || sending) return;
    setSending(true);
    const sent = text.trim();
    // Who the @s reach — the people picked from the list, and a hand-typed first name that names
    // exactly one person (lib/mentions). Said under the box before Send, so a typo is seen in time.
    const mentionIds = resolveMentions(sent, staff, picked).ids;
    const { error } = await supabase.from("comments").insert({ [subject.col]: subject.id, body: sent, author_id: meId, mentions: mentionIds });
    setSending(false);
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    setText(""); setPicked({});
    load();
    // Ping the counterparties + mentions (never myself) so the reply doesn't go unseen.
    const recips = Array.from(new Set([...notifyIds, ...mentionIds])).filter((id): id is string => !!id && id !== meId);
    const meFirst = meName.split(" ")[0] || "Someone";
    recips.forEach((rid) => raiseAlert({
      severity: "important", category: "task", kind: `thread_reply_${subject.col === "event_task_id" ? "task" : subject.col === "meeting_note_id" ? "note" : "alert"}`, subject_id: subject.id,
      title: `${meFirst} replied`, body: `${label}: ${sent.slice(0, 140)}`,
      target_user_id: rid, created_by: meId,
    }));
  };
  const del = async (c: Comment) => {
    if (!supabase) return;
    setComments((p) => p.filter((x) => x.id !== c.id)); // optimistic; RLS allows author-only delete
    await supabase.from("comments").delete().eq("id", c.id);
  };

  return (
    <div className="cmt">
      {cmtFailed && (
        <p className="load-failed" role="status">
          Couldn&apos;t load the notes — this is not &ldquo;no notes&rdquo;.{" "}
          <button type="button" className="btn-ter" onClick={() => load()}>Try again</button>
        </p>
      )}
      {comments.map((c) => (
        <div key={c.id} className={`cmt-row${c.author_id === meId ? " me" : ""}`}>
          <span className="cmt-av">{(nameOf(c.author_id).charAt(0) || "?").toUpperCase()}</span>
          <div className="cmt-bub">
            <span className="cmt-meta">{firstOf(c.author_id)} · {new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {c.author_id === meId && <button type="button" className="cmt-del" onClick={() => del(c)} aria-label="Delete comment"><Icon name="close" /></button>}
            </span>
            <span className="cmt-body">{c.body}</span>
          </div>
        </div>
      ))}
      <div className="cmt-add">
        <input ref={replyRef} className="note-in" placeholder="Reply… (@name to notify)" aria-label="Reply to comment" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button type="button" className="note-fu-addbtn" onClick={send} disabled={!text.trim() || sending}>Send</button>
      </div>
      {choices.length > 0 && (
        <div className="ts-chips" role="group" aria-label="Who to notify">
          {choices.map((p) => (
            <button key={p.id} type="button" className="ts-chip" onClick={() => {
              const next = insertMention(text, p);
              setText(next.text); setPicked((x) => ({ ...x, [p.id]: next.token }));
              // Back to the box, at the end — the keyboard stays up and the sentence carries on.
              requestAnimationFrame(() => { const el = replyRef.current; if (el) { el.focus(); el.setSelectionRange(next.text.length, next.text.length); } });
            }}>{crewLabel({ display_name: p.display_name, role: staff.find((x) => x.id === p.id)?.role ?? null })}</button>
          ))}
        </div>
      )}
      {(reachIds.length > 0 || reach.unresolved.length > 0) && (
        <p className="od-note" role="status" style={{ marginTop: 4 }}>
          {reachIds.length > 0 && <>Notifies {reachIds.map((id) => firstOf(id)).join(", ")}. </>}
          {reach.unresolved.length > 0 && <>{reach.unresolved.join(", ")} {reach.unresolved.length === 1 ? "reaches" : "reach"} nobody — pick from the list after typing @.</>}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── pre-flight readiness ─────────────────────────
// ───────────────────────── my tasks: what's assigned to me, by priority ─────────────────────────
type MyTaskRow = EventTask & {
  events: { title: string | null; day: string | null; is_live: boolean | null } | null;
  meeting_notes: { title: string | null } | null;
  goals: { title: string | null } | null;
  source?: "event" | "todo";      // 'todo' rows are delegated to-dos (0210) folded into one plate
  category?: string | null;       // todos carry a category instead of an event/goal parent
};

// MY DAY — the personal rollup: what's on today, the flags & pings aimed at YOU (alerts targeted
// to your user), and your assigned tasks. The home base "where do my flags go?" answer.
// OWNER DETAILS — the identity (name, date, place, status) of an event or stop, editable inline so the
// prep view is the single place to manage the thing end to end — no hopping to the calendar or Live
// truck to change a name or date. Self-contained; works for events or stops. (Go-live + GPS stay in
// Now ▸ Live truck, which owns the broadcast.)
//
// Upcoming/Done default (stops only): a stop's status column reads "upcoming" forever unless a
// human flips it, but FindUs/Route/PrepBoard already treat a stop as past once it's 8h beyond its
// start (same grace window, mirrored here — see FieldOpSheet's copy of this same helper). An
// explicit "done" or a completed_at stamp (the Complete-stop wrap flow below) always wins over the
// date math. This is seeded only when edit mode opens (not on every load) so the read-only pill —
// which still must prompt for a recap even on a stale, never-completed stop — keeps reading the
// true stored value untouched.
function IncidentLog({ ownerCol, ownerId }: { ownerCol: "event_id" | "stop_id"; ownerId: string }) {
  const confirm = useConfirm();
  type Inc = { id: string; problem: string; severity: string; resolved: boolean; created_at: string; symptom: string | null };
  const [rows, setRows] = useState<Inc[]>([]);
  const [incFailed, setIncFailed] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from("incident_log").select("id, problem, severity, resolved, created_at, symptom").eq(ownerCol, ownerId).order("created_at", { ascending: false });
    if (error) { setIncFailed(true); return; }
    setIncFailed(false);
    setRows((data as Inc[]) ?? []);
  }, [ownerCol, ownerId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "incident_log", filter: `${ownerCol}=eq.${ownerId}` }, load);
  const toggle = async (r: Inc) => {
    if (!supabase) return;
    setRows((p) => p.map((x) => x.id === r.id ? { ...x, resolved: !x.resolved } : x));
    await supabase.from("incident_log").update({ resolved: !r.resolved, resolved_at: !r.resolved ? new Date().toISOString() : null }).eq("id", r.id);
  };
  const del = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ title: "Delete this incident from the log?", confirmLabel: "Delete", danger: true }))) return;
    setRows((p) => p.filter((x) => x.id !== id));
    await supabase.from("incident_log").delete().eq("id", id);
  };
  // The log hides itself when clean. A failed read hid it in exactly the same way, so an event
  // with three open blockers looked like an event with none.
  if (incFailed) return (
    <div className="inclog" role="status">
      <div className="brewlink-h"><Icon name="wrench" /> Incident log</div>
      <p className="load-failed">
        Couldn&apos;t load the incident log — this is not &ldquo;nothing went wrong&rdquo;.{" "}
        <button type="button" className="btn-ter" onClick={() => load()}>Try again</button>
      </p>
    </div>
  );
  if (rows.length === 0) return null;
  return (
    <div className="inclog">
      <div className="brewlink-h"><Icon name="wrench" /> Incident log</div>
      {rows.map((r) => (
        <div key={r.id} className={`inc-row${r.resolved ? " done" : ""}`}>
          <button type="button" className="inc-ck" onClick={() => toggle(r)} aria-label={r.resolved ? "Mark unresolved" : "Mark resolved"}>{r.resolved ? <Icon name="check" /> : <Icon name="dotOutline" />}</button>
          <span className="inc-main"><b className={r.severity === "blocker" ? "inc-blk" : ""}>{r.problem}</b><span>{[r.symptom, r.resolved ? "resolved" : null, new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}</span></span>
          <button type="button" className="inc-x hit-44" onClick={() => del(r.id)} aria-label="Delete incident"><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

// MENU & RIG — the same menu/site flags an event carries, on the prep hub for events AND stops, so
// "Generate pack list from menu" builds the right kit either way. Self-contained load/save;
// the chips themselves are the shared MenuRigChips (one option set with Plan › Events).
function MenuEditor({ ownerType, ownerId, isAdmin, onChanged }: { ownerType: "event" | "stop"; ownerId: string; isAdmin: boolean; onChanged: () => void }) {
  const table = ownerType === "event" ? "events" : "stops";
  const { toast } = useApp();
  const [f, setF] = useState<MenuRigValue | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    // `?? {}` made f truthy on a failed read, so the guard below passed and every rig field
    // rendered blank — a menu that looks unset rather than unread. Null keeps the panel closed.
    const { data, error } = await supabase.from(table).select(MENU_RIG_COLUMNS).eq("id", ownerId).maybeSingle();
    if (error) { setF(null); return; }
    setF((data as MenuRigValue | null) ?? {});
  }, [table, ownerId]);
  useEffect(() => { load(); }, [load]);

  // A chip that did not save goes back to what is saved, and says so (2026-10-04). The write's
  // result was ignored: a refused save left the chip showing a menu the pack list would never see.
  const save = async (patch: MenuRigPatch) => {
    if (!supabase || !f) return;
    const before = f;
    setF({ ...f, ...patch });
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    if (error) { setF(before); toast(`Couldn't save the menu — ${error.message}`, "error"); return; }
    onChanged();
  };
  if (!isAdmin || !f) return null;

  return (
    <div className="menued">
      <button type="button" className="prep-collapse prep-tool" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="prep-collapse-l"><b><Icon name="jar" /> Menu &amp; setup</b><span>what we&apos;re pouring · the rig · power &amp; water</span></span>
        <span className={`ev-chev${open ? " open" : ""}`}>›</span>
      </button>
      {open && (
        <div className="menued-body">
          <MenuRigChips variant="ts" value={f} onPatch={save} ownerType={ownerType} ownerId={ownerId} />
        </div>
      )}
    </div>
  );
}

// DAY-OF BRIEF — how the crew shows up: dress code + call time / parking / what to bring. Leadership
// edits it; assigned crew read it. Self-contained (loads + saves its own row), works for events or stops.
function DayBrief({ ownerCol, ownerId, isAdmin }: { ownerCol: "event_id" | "stop_id"; ownerId: string; isAdmin: boolean }) {
  // crew_brief + dress_code now live on the staff-only sibling (event_ops / stop_ops, 0181), keyed
  // by the parent id — off the world-readable events/stops row.
  const opsTable = ownerCol === "stop_id" ? "stop_ops" : "event_ops";
  const [dress, setDress] = useState("");
  const [brief, setBrief] = useState("");
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  const briefState = useAsyncData<{ dress: string; brief: string }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from(opsTable).select("dress_code, crew_brief").eq(ownerCol, ownerId).maybeSingle();
    return {
      dress: (data as { dress_code?: string | null } | null)?.dress_code ?? "",
      brief: (data as { crew_brief?: string | null } | null)?.crew_brief ?? "",
    };
  }, [opsTable, ownerCol, ownerId]);
  // Seed the editable copy from the fetch/reload — Cancel and realtime both flow back through here.
  useEffect(() => {
    if (!briefState.data) return;
    setDress(briefState.data.dress);
    setBrief(briefState.data.brief);
  }, [briefState.data]);

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    // Upsert the staff-only ops row (create it on first save; the parent may have none yet).
    await supabase.from(opsTable).upsert({ [ownerCol]: ownerId, dress_code: dress.trim() || null, crew_brief: brief.trim() || null }, { onConflict: ownerCol });
    setSaving(false); setEdit(false);
  };

  return (
    <AsyncSection
      state={briefState}
      isEmpty={() => false}
      emptyTitle="No brief yet"
      loadingLabel="Loading day-of brief…"
      errorTitle="Couldn't load the day-of brief"
    >
      {() => {
        const empty = !dress.trim() && !brief.trim();
        if (!isAdmin && empty) return null; // nothing to show crew yet
        return (
          <div className="daybrief">
            <div className="daybrief-h">Day-of brief · how to show up{isAdmin && !edit && <button type="button" className="daybrief-edit" onClick={() => setEdit(true)}>{empty ? "+ Add" : "Edit"}</button>}</div>
            {edit ? (
              <>
                <label className="prod-f"><span>Dress code — what to wear</span><input className="note-in" value={dress} onChange={(e) => setDress(e.target.value)} placeholder="e.g. Black GT3 tee, dark jeans, closed-toe shoes" maxLength={600} /></label>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Call time, parking, what to bring, anything else</span><textarea className="note-in" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={"Call 9:30a · park behind the pavilion · bring your apron + black hat · we pour 11–3"} maxLength={4000} /></label>
                <div className="prod-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="note-arch" onClick={() => { setEdit(false); briefState.reload(); }} disabled={saving}>Cancel</button>
                  <button type="button" className="note-save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save brief"}</button>
                </div>
              </>
            ) : empty ? (
              <EmptyState title="No brief yet" sub="Add dress code + call details so the crew knows how to show up." />
            ) : (
              <>
                {dress.trim() && <div className="daybrief-row"><b>Wear</b><span>{dress}</span></div>}
                {brief.trim() && <div className="daybrief-row"><b>Details</b><span style={{ whiteSpace: "pre-wrap" }}>{brief}</span></div>}
              </>
            )}
          </div>
        );
      }}
    </AsyncSection>
  );
}

type Rhythm = { stops: { id: string; name: string | null; starts_at: string | null }[]; dropPacks: number; porches: number; brews: { id: string; recipe_name: string; batch_gal: number; warn: boolean }[] };
const NO_RHYTHM: Rhythm = { stops: [], dropPacks: 0, porches: 0, brews: [] };

function MyDay({ userId, isLeader, canGoLive, canBrew }: { userId: string | null; isLeader: boolean; canGoLive: boolean; canBrew: boolean }) {
  // Flags ride the one shared hook (same source as the Now strip + nav badge). Crew see their own
  // pings + broadcasts now too — the old isLeader gate predates the staff-wide alerts RLS (0157).
  const { flags, error: flagsErr, reload: reloadFlags } = useMyAlerts(userId);
  const { setSection } = useOperatorSection();
  const { openRecord } = useRecord();
  const streams = useWorkStreams();
  const laneColor = (cat: string) => streamOfCategory(cat, streams)?.color;
  // The day's rhythm — the same anchors the company calendar carries. Stops use the operator's
  // wall-clock day; drop/delivery are BUSINESS days (ET) so a late evening doesn't flip them early.
  // A FAILED READ IS NOT A QUIET DAY (2026-10-04): these four read .data straight through PostgREST
  // error objects, so a failure drew no stop, no drop, no brew — exactly what an empty day draws.
  const rhythmLoader = useCallback(async (): Promise<Rhythm> => {
    if (!supabase) return NO_RHYTHM;
    const d = localToday();
    const dayStart = new Date(`${d}T00:00:00`);
    const bd = etToday();
    const [st, dr, de, br] = await Promise.all([
      supabase.from("stops").select("id, name, starts_at").is("archived_at", null).neq("status", "done").gte("starts_at", dayStart.toISOString()).lt("starts_at", new Date(dayStart.getTime() + 86400000).toISOString()),
      supabase.from("drop_orders").select("id", { count: "exact", head: true }).eq("drop_date", bd).is("canceled_at", null),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("delivery_date", bd).is("canceled_at", null),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, latest_start_at, status").in("status", ["planned", "brewing"]).eq("brew_date", d),
    ]);
    const failed = [st.error, dr.error, de.error, br.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    return {
      stops: ((st.data ?? []) as { id: string; name: string | null; starts_at: string | null }[]),
      dropPacks: dr.count ?? 0,
      porches: de.count ?? 0,
      brews: ((br.data ?? []) as { id: string; recipe_name: string; batch_gal: number; latest_start_at: string | null; status: string }[]).map((b) => ({ id: b.id, recipe_name: b.recipe_name, batch_gal: b.batch_gal, warn: brewStartOverdue(b) })),
    };
  }, []);
  const rhythmState = useAsyncData<Rhythm>(rhythmLoader, []);
  const rhythm = rhythmState.data ?? NO_RHYTHM;


  const [leadOpen, setLeadOpen] = useState(false); // leadership briefing/intake — collapsed by default (decrowd)
  return (
    <>
      {/* WHAT OPENS THE DAY IS THE DAY (2026-10-04, Ryan: "strategically look for where something is
          unnecessary information"). This screen used to open with a 30px greeting and a motto —
          "Evening, Ryan." over "Precision in every pour — let's make today one worth remembering."
          — about ninety pixels of the first screen an operator sees, ahead of the one thing the day
          is about. The greeting is gone, the motto with it (its copy key is retired, so Settings no
          longer offers to edit a line that shows nowhere), and the date rides on today's op card.
          The headline still comes before the plates, which is all P3 asked. */}
      <DayHeadline canGoLive={canGoLive} />
      {rhythmState.status === "error" && (
        <p className="load-failed" role="status">
          Couldn&apos;t read today&apos;s stops, drops and brews — this is not &ldquo;nothing on&rdquo;.{" "}
          <button type="button" className="btn-ter" onClick={() => rhythmState.reload()}>Try again</button>
        </p>
      )}
      {(rhythm.stops.length > 0 || rhythm.dropPacks > 0 || rhythm.porches > 0 || rhythm.brews.length > 0) && (
        <div className="myday-rhythm">
          {rhythm.stops.map((s) => (
            <button key={s.id} type="button" className="myday-chip" style={{ borderLeftColor: laneColor("stop") }} onClick={() => openRecord("stop", s.id)}>
              <Icon name="truck" /> {s.name || "Truck stop"}{s.starts_at ? ` · ${new Date(s.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""} ›
            </button>
          ))}
          {rhythm.dropPacks > 0 && <button type="button" className="myday-chip" style={{ borderLeftColor: laneColor("drop") }} onClick={() => setSection("now")}><Icon name="package" /> Drop today · {rhythm.dropPacks} pack{rhythm.dropPacks === 1 ? "" : "s"} ›</button>}
          {rhythm.porches > 0 && <button type="button" className="myday-chip" style={{ borderLeftColor: laneColor("delivery") }} onClick={() => { window.location.href = "/driver"; }}><Icon name="compass" /> Delivery run · {rhythm.porches} porch{rhythm.porches === 1 ? "" : "es"} ›</button>}
          {canBrew && rhythm.brews.map((b) => (
            <button key={b.id} type="button" className={`myday-chip${b.warn ? " warn" : ""}`} style={{ borderLeftColor: laneColor("brew") }} onClick={() => setSection("brew")}>
              <Icon name="coffee" /> Brew · {b.recipe_name} {b.batch_gal} gal{b.warn ? " — start now" : ""} ›
            </button>
          ))}
        </div>
      )}
      {/* THE INBOX HAS ONE DOOR, THE BELL (2026-10-04). A card here repeated the bell's number on
          the same screen — "10 flags & pings for you" under a bell reading 10 — and for every role
          but a manager the bell itself never loaded, so the card was papering over that. The bell
          loads for everyone now. What stays is the one thing the bell cannot say: that it failed. */}
      {flagsErr && flags.length === 0 && (
        <p className="load-failed" role="status">
          Couldn&apos;t check your flags &amp; pings — this is not &ldquo;nothing for you&rdquo;.{" "}
          <button type="button" className="btn-ter" onClick={() => reloadFlags()}>Try again</button>
        </p>
      )}
      {/* MY TASKS above the fold — the day's work leads; everything else follows. */}
      <MyTasks userId={userId} />
      {/* WHAT IS OWED (0320). Under the day's work, because a task due today outranks a permit due
          in a fortnight — but on the default screen, because until now the app stored eleven kinds
          of deadline and showed none of them. On the day this shipped: four pieces of equipment
          past their service date (the nitro tap by 69 days), two initiative targets and three
          workstream next-actions overdue, and six permit rules needing a re-check. Nothing in the
          product said so. Silence is only a signal when somebody is listening. */}
      <Owed />
      {/* "✎ Note to self" lived here — the same sheet the quick-actions button opens on its Note
          tab, from every screen. One door (2026-10-04). */}
      {/* Lead-the-week tools: collapsed to one chip until called for (decrowd — the briefing is
          on-demand by nature; it shouldn't occupy the glance screen). */}
      {isLeader && (
        <div style={{ marginTop: 18 }}>
          <button type="button" className="k-chip hit-y-44 k-chip-sec" onClick={() => setLeadOpen((o) => !o)} aria-expanded={leadOpen}>
            <Icon name="compass" /> Lead the week — GTM, briefing &amp; intake {leadOpen ? "▴" : "▾"}
          </button>
          {leadOpen && (
            <div style={{ marginTop: 12 }}>
              {/* GTM definition first — its home is the collapsed chip (Ryan: "GTM -> collapsed chip") */}
              <GtmCard onOpenSchedule={() => setSection("now")} onOpenInitiative={() => setSection("command")} />
              <ChiefOfStaff />
              <SmartIntake />
              {/* The read half of intake. Filing has worked since 0088; nothing in the app has ever
                  read public.documents, so a permit went in and could only be got back out of the
                  SQL editor. Mounted directly under the thing that writes it, because "where did
                  that go?" is asked in the place you put it. */}
              <DocsFiled />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MyTasks({ userId, chip = false }: { userId: string | null; chip?: boolean }) {
  const { setSection } = useOperatorSection();
  const { openTask } = useTaskSheet();
  const { toast } = useApp();
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A FAILED READ IS NOT AN EMPTY PLATE (2026-10-04). This read .data straight through PostgREST's
  // error object, so a failure drew "Nothing on your plate — you're clear for today": the most
  // reassuring sentence on the screen, said about a list it never saw.
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !userId) { setTasks([]); setLoaded(true); return; }
    // ONE task read: the all_tasks spine view (0210, enriched by 0225) — event_tasks ∪ todos with
    // the op/note/goal context joined in the database. Same plate the WorkloadBoard reads, so task
    // surfaces can't drift apart again. Op context rides the field_ops spine, which is why a
    // STOP-owned task now shows its stop's name (it rendered as a bare "Event" before).
    const { data, error } = await supabase
      .from("all_tasks")
      .select("*")
      .eq("assignee", userId)
      .eq("done", false)
      .order("sort", { ascending: true, nullsFirst: false });   // events keep their sort; sortless to-dos land after, as before
    if (error) { setErr(error.message); setLoaded(true); return; }
    setErr(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: MyTaskRow[] = ((data as any[]) ?? []).map((r) =>
      r.source === "todo"
        ? ({
            id: r.id, label: r.title, source: "todo", category: r.category,
            due_at: r.due ? new Date(`${r.due}T23:59:59`).toISOString() : null,   // local end-of-day as a REAL instant, so a to-do due today isn't "overdue" all evening (behind-UTC bug)
            critical: false, warn: false, events: null, meeting_notes: null, goals: null,
          } as MyTaskRow)
        : ({
            ...r, label: r.title, source: "event" as const,
            // != null (not truthiness): an empty-string title is still a real row — panel finding.
            // Stop dates bucket on the OPERATOR's wall clock (dayKey, the one-clock spine), not a UTC cast.
            events: r.op_name != null ? { title: r.op_kind === "stop" ? `🚚 ${r.op_name}` : r.op_name, day: r.op_day ?? (r.op_starts_at ? dayKey(new Date(r.op_starts_at)) : null), is_live: r.op_is_live } : null,
            meeting_notes: r.meeting_note_title != null ? { title: r.meeting_note_title } : null,
            goals: r.goal_title != null ? { title: r.goal_title } : null,
          } as MyTaskRow));
    setTasks(rows);
    setLoaded(true);
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "event_tasks", filter: `assignee=eq.${userId}` }, load, { enabled: !!userId });
  useRealtimeTable({ table: "todos", filter: `assignee=eq.${userId}` }, load, { enabled: !!userId });

  const complete = async (t: MyTaskRow) => {
    if (!supabase) return;
    setTasks((p) => p.filter((x) => x.id !== t.id)); // optimistic
    const ok = await completeTask(t.source === "todo" ? "todo" : "event", t.id, userId);   // ONE complete path (lib/tasks)
    // The tick took the row away before the write answered; a write that did not land puts it back.
    if (!ok) { toast(`Couldn't mark "${t.label}" done — try again.`, "error"); load(); }
  };

  if (!userId) return null;
  const empty = loaded && !err && tasks.length === 0;

  // Priority: critical first, then overdue, then important (warn), then tasks on a LIVE event, then by date.
  const nowIso = new Date().toISOString();
  const isOver = (t: MyTaskRow) => !!t.due_at && t.due_at < nowIso;
  const score = (t: MyTaskRow) => (t.critical ? 0 : isOver(t) ? 1 : t.warn ? 2 : t.events?.is_live ? 3 : 4);
  const sorted = [...tasks].sort((a, b) => score(a) - score(b) || (a.due_at ?? a.events?.day ?? "9999").localeCompare(b.due_at ?? b.events?.day ?? "9999"));
  const crit = tasks.filter((t) => t.critical).length;
  const over = tasks.filter(isOver).length;

  // Chip face (Live Ops): the full list has ONE home — My Day. During service this is a pointer,
  // the same pattern the alerts strip uses. Nothing on your plate → the pointer itself is noise.
  if (chip) {
    if (err) return (
      <button type="button" className="alerts-strip taskptr" onClick={() => setSection("day")}>
        <span className="alerts-strip-i" aria-hidden><Icon name="check" /></span>
        <span className="alerts-strip-t"><b>Couldn&apos;t check your tasks</b></span>
        <span className="alerts-strip-go">Open in My Day <Icon name="arrowRight" /></span>
      </button>
    );
    if (empty) return null;
    return (
      <button type="button" className="alerts-strip taskptr" onClick={() => setSection("day")}>
        <span className="alerts-strip-i" aria-hidden><Icon name="check" /></span>
        <span className="alerts-strip-t"><b>{tasks.length} task{tasks.length === 1 ? "" : "s"} on your plate</b>{over ? ` · ${over} overdue` : crit ? ` · ${crit} critical` : ""}</span>
        <span className="alerts-strip-go">Open in My Day <Icon name="arrowRight" /></span>
      </button>
    );
  }

  if (err) {
    return (
      <div className="adm-sec" id="my-day-tasks">
        <p className="load-failed" role="status">
          Couldn&apos;t load your tasks — this is not &ldquo;nothing on your plate&rdquo;.{" "}
          <button type="button" className="btn-ter" onClick={() => load()}>Try again</button>
        </p>
      </div>
    );
  }

  // My Day is the one place this list lives above the fold — say so on purpose when it's clear,
  // rather than leaving a gap where the day's work usually leads.
  if (empty) {
    return (
      <div className="adm-sec" id="my-day-tasks">
        <EmptyState title="Nothing on your plate" sub="You're clear for today — check Live Ops if something's moving." />
      </div>
    );
  }

  return (
    <div className="adm-sec" id="my-day-tasks">
      <SectionHeader label="My tasks" right={<span className={`k-count${crit || over ? " due" : ""}`}>{tasks.length}{over ? ` · ${over} overdue` : crit ? ` · ${crit} critical` : ""}</span>} />
      {sorted.map((t) => (
        <div key={t.id} className={`mytask${t.critical ? " crit" : isOver(t) ? " crit" : t.warn ? " warn" : ""}`}>
          <button type="button" className="task-check" onClick={() => complete(t)} aria-label={`Mark done: ${t.label}`}>
            <span className="task-box" />
          </button>
          <button type="button" className="mytask-main" onClick={() => openTask(t.id, t.source === "todo" ? "todo" : "event")} aria-label={`Open task: ${t.label}`}>
            <span className="mytask-label">{t.label}</span>
            <span className="mytask-ev">{t.source === "todo" ? `To-do${t.category ? ` · ${t.category}` : ""}` : t.meeting_notes ? `Follow-up · ${t.meeting_notes.title ?? "Meeting"}` : t.goals ? `Goal · ${t.goals.title ?? "Goal"}` : `${t.events?.title ?? "Event"}${t.events?.is_live ? " · LIVE" : t.events?.day ? ` · ${whenBucket(t.events.day).label}` : ""}`}{t.due_at ? ` · due ${dueLabel(t.due_at)}` : ""}</span>
          </button>
          {isOver(t) ? <span className="mytask-pri over">Overdue</span> : t.critical ? <span className="mytask-pri crit">Critical</span> : t.warn ? <span className="mytask-pri warn">Important</span> : null}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── per-event prep: card picker + detail ─────────────────────────
type Readiness = { done: number; total: number; crit: number };

// "By date / when" bucket for the Prep cards — lib/readiness decides (Past comes LAST there, named
// "not closed out"; it used to sort first and read "Not started", two months on).
const whenBucket = (day: string | null | undefined) => prepBucket(day, localToday());

// Pull-up sheet to categorize the card view (date/when sort direction).
function PrepViewSheet({ dir, setDir, onClose }: { dir: "asc" | "desc"; setDir: (d: "asc" | "desc") => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} label="Group tasks" header={<div style={{ display: "flex", alignItems: "center" }}>Group by · date / when</div>}>
        <div className="prep-sheet-opts">
          <button className={`prep-sheet-opt${dir === "asc" ? " on" : ""}`} onClick={() => { setDir("asc"); onClose(); }}>Soonest first</button>
          <button className={`prep-sheet-opt${dir === "desc" ? " on" : ""}`} onClick={() => { setDir("desc"); onClose(); }}>Latest first</button>
        </div>
    </Sheet>
  );
}

type PrepTarget = { kind: "event" | "stop"; id: string };

// The meetings behind this event/stop — titles + a first line, no click required to know what's
// there; the jump opens the full Notes page.
function NotesForTarget({ ownerCol, ownerId }: { ownerCol: "event_id" | "stop_id"; ownerId: string }) {
  const { setSection } = useOperatorSection();
  const [notes, setNotes] = useState<{ id: string; title: string; met_on: string; summary: string | null }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("meeting_notes").select("id, title, met_on, summary").eq(ownerCol, ownerId).is("archived_at", null)
      .order("met_on", { ascending: false }).limit(5)
      .then(({ data }) => setNotes((data as { id: string; title: string; met_on: string; summary: string | null }[]) ?? []));
  }, [ownerCol, ownerId]);
  if (notes.length === 0) return null;
  return (
    <div className="pnotes">
      <div className="dv-sub">Meeting notes · {notes.length}</div>
      {notes.map((n) => (
        <button key={n.id} type="button" className="pnotes-row" onClick={() => setSection("notes")}>
          <b>{n.title}</b>
          <span>{fmtNoteDate(n.met_on)}{n.summary ? ` — ${n.summary.slice(0, 90)}${n.summary.length > 90 ? "…" : ""}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

function PrepCard({ title, when, location, live, r, onOpen }: { title: string; when: string; location: string | null; live: boolean; r: Readiness; onOpen: () => void }) {
  const status = r.total === 0 ? "Not started" : r.done === r.total ? "✓ Ready to roll" : `Loaded ${r.done}/${r.total}`;
  const cls = r.total === 0 ? "none" : r.done === r.total ? "ok" : r.crit ? "miss" : "mid";
  const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
  return (
    <button className={`prep-card${live ? " live" : ""}`} onClick={onOpen} aria-label={`Prep ${title} — ${status}`}>
      <div className="prep-card-top">
        <span className="prep-card-when">{when || "—"}</span>
        {live && <span className="prep-card-livetag"><Icon name="dot" /> Live</span>}
      </div>
      <div className="prep-card-title">{title}</div>
      {location && <div className="prep-card-loc">{location}</div>}
      <div className="prep-card-foot">
        <span className={`prep-card-status ${cls}`}>{status}</span>
        {r.crit > 0 && <span className="prep-card-crit">{r.crit} critical</span>}
        <span className="prep-card-go">Prep ›</span>
      </div>
      {r.total > 0 && <div className="prep-card-bar"><span style={{ width: `${pct}%` }} /></div>}
    </button>
  );
}

// The picker: truck locations + events, each with its own independent pick list (0040).
// Tapping a card opens that target's checklist (PrepDetail).
// AGENT #2 — prep/readiness. On-demand: asks Claude if stock covers the next two weeks of events,
// shows the verdict, and (when there's a real gap) raises it on the alert spine.
function ReadinessAgent() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ headline: string; severity: string; gaps: { item: string; detail: string }[] } | null>(null);
  const run = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/agents/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!j.ok) toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
      else if (j.skipped) { setRes(null); toast("No upcoming events to check"); }
      else setRes({ headline: j.headline, severity: j.severity, gaps: j.gaps ?? [] });
    } catch { toast("Couldn't reach the readiness agent", "error"); }
    setBusy(false);
  };
  return (
    <div className="adm-sec">
      <div className="rdy">
        <div className="rdy-top">
          <span className="rdy-blurb">Ask the prep agent if you&apos;re stocked for the next two weeks.</span>
          <button type="button" className="rdy-run hit-y-44" onClick={run} disabled={busy}>{busy ? "Checking…" : <><Icon name="sparkles" /> Check</>}</button>
        </div>
        {res && (
          <div className={`rdy-out sev-${res.severity}`}>
            <span className="rdy-head">{res.headline}</span>
            {res.gaps.length > 0 && <ul className="rdy-gaps">{res.gaps.map((g, i) => <li key={i}><b>{g.item}</b> — {g.detail}</li>)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}

// OPERATOR MODE — the crew's pocket brain. The chat itself lives in components/AskGT3 so the
// Ask tab and the floating QuickDock share ONE assistant.
function OperatorAssistant() {
  return <div className="adm-sec"><AskGT3 /></div>;
}

// INSPECTION AGENT (admin) — research a jurisdiction's permit/inspection requirements, get a
// what-to-expect brief + prep checklist, and review agent-proposed compliance rows before they
// go live. "We have an inspection in GA tomorrow" → grounded answer + a do-list on the event.
type InspRule = { id: string; label: string; kind: string; critical: boolean; link: string | null };
type InspResult = { place: string; researched: boolean; summary: string; checklist: string[]; confidence: string; proposed: InspRule[]; tasksAdded: number };

function InspectionPrep() {
  const { toast } = useApp();
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [events, setEvents] = useState<{ id: string; title: string | null; day: string | null; day_label: string | null }[]>([]);
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<InspResult | null>(null);
  const [wait, setWait] = useState<string | null>(null); // background-research banner ("Researching…" / "Writing up…")
  const [open, setOpen] = useState(false); // collapsed until needed — keeps the Prep screen clean
  const aliveRef = useRef(true); // stop polling if the screen unmounts mid-research
  useEffect(() => () => { aliveRef.current = false; }, []);

  useEffect(() => {
    if (!open || !supabase) return;
    const today = localToday();
    supabase.from("events").select("id, title, day, day_label").is("archived_at", null).gte("day", today).order("day").limit(40)
      .then(({ data }) => setEvents(data ?? []));
  }, [open]);

  // Uncovered jurisdictions research in the background (the route returns a job id and runs the lean
  // research after the response is flushed). Poll the job row — staff RLS allows the read — keeping the
  // waiting banner up until it finishes or the deadline (~3 min).
  const waitForJob = async (jobId: string): Promise<{ status: string; result: InspResult | null; error: string | null; place: string } | null> => {
    if (!supabase) return null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && aliveRef.current) {
      await new Promise((r) => setTimeout(r, 3000));
      if (!aliveRef.current) return null;
      const { data } = await supabase.from("inspection_research_jobs").select("status, result, error, place").eq("id", jobId).maybeSingle();
      if (!data) continue;
      if (data.status === "done" || data.status === "error") return data as { status: string; result: InspResult | null; error: string | null; place: string };
      setWait("Researching the jurisdiction…");
    }
    return null;
  };

  const run = async () => {
    if (!supabase || busy || !state.trim()) return;
    setBusy(true); setRes(null); setWait(null);
    try {
      const r = await authedFetch("/api/agents/inspection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, county, event_id: eventId }) });
      const j = await r.json();
      if (!j.ok) { toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error"); setBusy(false); return; }
      if (j.status === "pending" && j.job_id) {
        setWait("Researching the jurisdiction…");
        const done = await waitForJob(j.job_id);
        setWait(null);
        if (!aliveRef.current) return;
        if (!done) { toast(`Research for ${j.place} took too long — try again, or add a county to narrow it`, "error"); setBusy(false); return; }
        if (done.status === "error" || !done.result) { toast(`Couldn't finish researching ${j.place} — try again, or add a county to narrow it`, "error"); setBusy(false); return; }
        const out = { ...done.result, place: done.place };
        setRes(out);
        toast(`Researched ${out.place}${out.proposed?.length ? ` — ${out.proposed.length} rules to review` : ""}`);
      } else {
        setRes(j);
        toast(j.researched ? `Researched ${j.place}${j.proposed.length ? ` — ${j.proposed.length} rules to review` : ""}` : `Brief ready for ${j.place}`);
      }
    } catch { toast("Couldn't reach the inspection agent", "error"); setWait(null); }
    setBusy(false);
  };

  // Approve and dismiss used to drop the proposal from the list and say "Approved" whatever the
  // database answered — an approve refused by RLS (only an owner or admin may write a rule, 0027)
  // looked done and never reached the checklist. An approved rule has no date until somebody checks
  // it with the authority, so it arrives under Needs you to be re-checked (0342) — on purpose: the
  // agent's research is not a check.
  const decide = async (id: string, approve: boolean) => {
    if (!supabase) return;
    const { error } = approve
      ? await supabase.from("compliance_rules").update({ active: true, verified: true }).eq("id", id)
      : await supabase.from("compliance_rules").delete().eq("id", id);
    if (error) { toast(`Couldn't ${approve ? "approve" : "dismiss"} it — ${error.message}`, "error"); return; }
    setRes((r) => r ? { ...r, proposed: r.proposed.filter((p) => p.id !== id) } : r);
    toast(approve ? "Approved — on the checklist. Check it with the authority to date it." : "Dismissed");
  };

  return (
    <div className="adm-sec">
      <button type="button" className="prep-collapse" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="prep-collapse-l"><b>Inspection prep</b><span>Permit / health-dept research — open it when one is coming up</span></span>
        <span className={`ev-chev${open ? " open" : ""}`}>›</span>
      </button>
      {open && (
      <div className="rdy" style={{ marginTop: 10 }}>
        <div className="insp-form">
          <input className="insp-in insp-st" value={state} onChange={(e) => setState(e.target.value)} placeholder="State (GA)" aria-label="State" maxLength={4} />
          <input className="insp-in" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County (optional)" aria-label="County" />
          <select className="insp-in" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">No event — just brief me</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.day_label || ev.day || ""} · {ev.title || "Event"}</option>)}
          </select>
          <button type="button" className="rdy-run hit-y-44" onClick={run} disabled={busy || !state.trim()}>{busy ? "Researching…" : <><Icon name="sparkles" /> Research</>}</button>
        </div>
        {wait && (
          <div className="insp-wait" role="status" aria-live="polite">
            <span className="insp-wait-dot" /><span>{wait}</span><span className="insp-wait-sub">this can take a minute or two — you can keep working</span>
          </div>
        )}
        {res && (
          <div className="insp-out">
            <div className="insp-head">{res.place}{res.researched ? "" : " · from your records"}{res.confidence === "low" ? " · low confidence — verify with the county" : ""}</div>
            <p className="insp-sum">{res.summary}</p>
            {res.checklist.length > 0 && (
              <><div className="insp-lbl">Prep checklist{res.tasksAdded ? ` · added ${res.tasksAdded} to the event` : ""}</div>
              <ul className="rdy-gaps">{res.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul></>
            )}
            {res.proposed.length > 0 && (
              <><div className="insp-lbl">Proposed rules — approve to make official</div>
              {res.proposed.map((p) => (
                <div key={p.id} className="insp-rule">
                  <span className="insp-rule-t">{p.critical ? <><Icon name="warning" /> </> : ""}<b>{p.kind}</b> — {p.label}{p.link ? <a href={p.link} target="_blank" rel="noreferrer" className="insp-src"> source</a> : null}</span>
                  <span className="insp-rule-act">
                    <button type="button" className="insp-yes" onClick={() => decide(p.id, true)}>Approve</button>
                    <button type="button" className="insp-no" onClick={() => decide(p.id, false)}>Dismiss</button>
                  </span>
                </div>
              ))}</>
            )}
            <p className="insp-foot">Always confirm with the jurisdiction's health department for your specific date.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function EventPrep({ sel, setSel }: { sel: PrepTarget | null; setSel: Dispatch<SetStateAction<PrepTarget | null>> }) {
  // Selection lives in the PARENT (2026-07-30): the KPI strip above this list re-scopes to the
  // drilled-in target, so the two components share one selection instead of this one hoarding it.
  const selected = sel, setSelected = setSel;
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [sheet, setSheet] = useState(false);

  const prepState = useAsyncData<{ events: EventRow[]; stops: Stop[]; liveStopId: string | null; ready: Record<string, Readiness> }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const [{ data: evs }, { data: sts }, { data: ls }, { data: t }] = await Promise.all([
      supabase.from("events").select("*").order("sort"),
      supabase.from("stops").select("*").order("sort"),
      supabase.from("live_status").select("current_stop_id, is_live").maybeSingle(),
      supabase.from("event_tasks").select("event_id, stop_id, done, critical"),
    ]);
    // Active prep = not archived AND not completed. Completing an event stamps stage:"done"
    // (0121); finishing a truck stop sets status:"done". Either way it drops off the active
    // list — it's still reachable via history/archive, just not cluttering today's prep.
    const evList = ((evs as EventRow[]) ?? []).filter((e) => !e.archived_at && e.stage !== "done");
    const stopList = ((sts as Stop[]) ?? []).filter((s) => !s.archived_at && s.status !== "done");
    const lstat = ls as { current_stop_id: string | null; is_live: boolean } | null;
    const liveStopId = lstat?.is_live ? lstat.current_stop_id : null;
    const map: Record<string, Readiness> = {};
    for (const row of (t as { event_id: string | null; stop_id: string | null; done: boolean; critical: boolean }[]) ?? []) {
      const key = row.event_id ?? row.stop_id;
      if (!key) continue;
      const m = (map[key] ??= { done: 0, total: 0, crit: 0 });
      m.total++;
      if (row.done) m.done++;
      else if (row.critical) m.crit++;
    }
    return { events: evList, stops: stopList, liveStopId, ready: map };
  }, []);
  // Auto-open the live event the first time the list loads — never steals a selection the
  // operator already made (prev ?? …), including one set by the deep-link effect below.
  useEffect(() => {
    if (!prepState.data) return;
    const live = prepState.data.events.find((e) => e.is_live);
    setSelected((prev) => prev ?? (live ? { kind: "event", id: live.id } : null));
  }, [prepState.data]);
  useEffect(() => {
    // Deep-link from an event editor's "Open prep".
    try {
      const tgt = localStorage.getItem(prepHandoffKey);
      if (tgt) { localStorage.removeItem(prepHandoffKey); const isStop = tgt.startsWith("stop:"); const id = tgt.includes(":") ? tgt.slice(tgt.indexOf(":") + 1) : tgt; setSelected({ kind: isStop ? "stop" : "event", id }); }
    } catch { /* ignore */ }
    // ⌘K / recents jump: open the requested target even if we're already on the Prep list (the
    // mount-time read above only fires on first render).
    const onOpen = () => {
      try {
        const tgt = localStorage.getItem(prepHandoffKey);
        if (tgt) { localStorage.removeItem(prepHandoffKey); const isStop = tgt.startsWith("stop:"); const id = tgt.includes(":") ? tgt.slice(tgt.indexOf(":") + 1) : tgt; setSelected({ kind: isStop ? "stop" : "event", id }); }
      } catch { /* ignore */ }
    };
    window.addEventListener("gt3-open-prep", onOpen);
    return () => window.removeEventListener("gt3-open-prep", onOpen);
  }, []);
  useRealtimeTable(["events", "stops", "event_tasks"], prepState.reload);

  if (selected) return <PrepDetail target={selected} onBack={() => setSelected(null)} />;

  return (
    <>
    {/* Opening a target gives prep the full screen. (The "At a glance" Overview block that opened
        this list died 2026-07-30 — it restated the exact target cards below it and Live Ops' own
        live status. Ryan: "feels unnecessary and like it's in other sections. Redundant.") */}
    <div className="adm-sec adm-prep">
      <div style={{ display: "flex" }}><button className="adm-prep-view" onClick={() => setSheet(true)} aria-haspopup="dialog">View ⌄</button></div>
      <AsyncSection
        state={prepState}
        isEmpty={(d) => d.events.length === 0 && d.stops.length === 0}
        emptyTitle="Nothing to prep yet"
        emptySub="Add an event (Plan → Events) or a truck location (Now → Live truck)."
        loadingLabel="Loading prep…"
        errorTitle="Couldn't load prep"
      >
        {(d) => {
          // events grouped by date/when; dir flips order
          const by: Record<string, { key: number; label: string; items: EventRow[] }> = {};
          for (const ev of d.events) {
            const b = whenBucket(ev.day);
            (by[b.label] ??= { key: b.key, label: b.label, items: [] }).items.push(ev);
          }
          const groups = Object.values(by).sort((a, b) => a.key - b.key);
          const cmp = (a: EventRow, b: EventRow) => (a.day ?? "9999").localeCompare(b.day ?? "9999") || a.sort - b.sort;
          for (const g of groups) g.items.sort(cmp);
          if (dir === "desc") { groups.reverse(); for (const g of groups) g.items.reverse(); }
          return (
            <>
              {d.stops.length > 0 && (
                <div className="prep-group">
                  <div className="prep-group-h">Truck locations <span>{d.stops.length}</span></div>
                  <div className="prep-cards">
                    {d.stops.map((s) => (
                      <PrepCard key={s.id} title={s.name} when={s.id === d.liveStopId ? "Live now" : [(s as { starts_at?: string | null }).starts_at ? new Date((s as { starts_at?: string | null }).starts_at as string).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null, s.when_label].filter(Boolean).join(" · ") || "Unscheduled"} location={s.location_text} live={s.id === d.liveStopId}
                        r={d.ready[s.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelected({ kind: "stop", id: s.id })} />
                    ))}
                  </div>
                </div>
              )}

              {groups.map((g) => (
                <div key={g.label} className="prep-group">
                  <div className="prep-group-h">{g.label} <span>{g.items.length}</span></div>
                  <div className="prep-cards">
                    {g.items.map((ev) => (
                      <PrepCard key={ev.id} title={ev.title} when={[ev.day ? new Date(`${ev.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : ev.day_label, ev.start_time].filter(Boolean).join(" · ") || "Unscheduled"} location={ev.location_text} live={!!ev.is_live}
                        r={d.ready[ev.id] ?? { done: 0, total: 0, crit: 0 }} onOpen={() => setSelected({ kind: "event", id: ev.id })} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          );
        }}
      </AsyncSection>
      {sheet && <PrepViewSheet dir={dir} setDir={setDir} onClose={() => setSheet(false)} />}
    </div>
    </>
  );
}

// ── The garage — the standing libraries (load-out, gear, maintenance, inventory) collapsed to
// quiet one-line rows. They're reference until there's something to pack for: the load-out row
// auto-opens only when an event or stop is live or within the next 7 days. Bodies mount on open,
// so a quiet week also skips their data fetches.
// Production › Garage as a dedicated page: Garage needs events/stops only for the "event is
// near — check the load" auto-open, so this wrapper loads just that.
function GarageSection() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [liveStopId, setLiveStopId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [e, s, l] = await Promise.all([
      supabase.from("events").select("*").is("archived_at", null),
      supabase.from("stops").select("*").is("archived_at", null).neq("status", "done"),
      supabase.from("live_status").select("current_stop_id, is_live").maybeSingle(),
    ]);
    setEvents((e.data as EventRow[]) ?? []);
    setStops((s.data as Stop[]) ?? []);
    const ls = l.data as { current_stop_id: string | null; is_live: boolean | null } | null;
    setLiveStopId(ls?.is_live ? ls.current_stop_id : null);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable(["events", "stops", "live_status"], load);
  return <Garage events={events} stops={stops} liveStopId={liveStopId} loaded={loaded} />;
}

function Garage({ events, stops, liveStopId, loaded }: { events: EventRow[]; stops: Stop[]; liveStopId: string | null; loaded: boolean }) {
  const packSoon = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + 7);
    const within = (d?: string | null) => { if (!d) return false; const x = new Date(`${d.slice(0, 10)}T12:00:00`); return x >= today && x <= horizon; };
    return Boolean(liveStopId) || events.some((e) => e.is_live || within(e.day))
      || stops.some((s) => within((s as { starts_at?: string | null }).starts_at));
  }, [events, stops, liveStopId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const autoRef = useRef(false);
  useEffect(() => { if (loaded && packSoon && !autoRef.current) { autoRef.current = true; setOpen((o) => ({ ...o, loadout: true })); } }, [loaded, packSoon]);
  const row = (id: string, icon: ReactNode, title: string, hint: string, body: ReactNode) => (
    <div className={`garage-row${open[id] ? " open" : ""}`}>
      <button type="button" className="garage-head" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))} aria-expanded={!!open[id]}>
        <span className="garage-ic">{icon}</span>
        <span className="garage-t">{title}</span>
        {!open[id] && <span className="garage-hint">{hint}</span>}
        <span className="garage-chev">{open[id] ? "▾" : <Icon name="chevronRight" />}</span>
      </button>
      {open[id] && <div className="garage-body">{body}</div>}
    </div>
  );
  return (
    <div className="garage">
      {row("loadout", <Icon name="truck" />, "Load-out & tow plan", packSoon ? "event this week — check the load" : "quiet until an event is near", <TrailerLoadout />)}
      {row("gear", <Icon name="wrench" />, "Gear library", "manuals · specs · how-tos", <GearLibrary />)}
      {row("maint", <Icon name="wrench" />, "Asset maintenance", "service log · what's due", <AssetMaintenance />)}
      {row("inventory", <Icon name="package" />, "Inventory", "stock, costs & pars", <InventoryLibrary />)}
    </div>
  );
}

// Detail: a per-target pick list. For an EVENT it's the full thing (auto-generate from
// rig/menu, crew roster, owner+manager sign-off). For a TRUCK STOP it's the same checklist
// engine (assign, supply/gear picker, My Tasks) minus the event-only bits. Owner = event_id
// XOR stop_id (migration 0040).
function PrepDetail({ target, onBack }: { target: { kind: "event" | "stop"; id: string }; onBack: () => void }) {
  const confirm = useConfirm();
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const isEvent = target.kind === "event";
  const ownerCol = isEvent ? "event_id" : "stop_id";
  // The same fact in the write spine's vocabulary. lib/tasks takes a parent, not a column name —
  // which is the point: a column name is a string anyone can mistype, and did.
  const ownerParent: TaskParent = isEvent ? { event: target.id } : { stop: target.id };
  const [ev, setEv] = useState<EventRow | null>(null); // full event row (events only; drives generate)
  const [name, setName] = useState<string | null>(null); // display name for either kind
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [crew, setCrew] = useState<{ id: string; user_id: string; role_label: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role: string | null }[]>([]);
  const [approvals, setApprovals] = useState<{ approver_id: string }[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [generating, setGenerating] = useState(false);
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  const [showSupplies, setShowSupplies] = useState(false);
  // Breadcrumb: Prep › <this target>. Clicking the "Prep" root (or the name) steps back to the list.
  useCrumb("prep-detail", name ?? (isEvent ? "Event" : "Location"), onBack);
  // Recents: remember this event/stop so ⌘K can jump straight back to it later.
  useEffect(() => { if (name) recordRecent(isEvent ? "event" : "stop", target.id, name); }, [name, isEvent, target.id]);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [prepAIOpen, setPrepAIOpen] = useState(false);
  const [troubleshootOpen, setTroubleshootOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false); // stop run-of-show / when-to-leave planner
  const [loadoutOpen, setLoadoutOpen] = useState(false); // load-out & tow, scoped to this owner
  const [packPlanOpen, setPackPlanOpen] = useState(false); // kegs-vs-bottles pack-out plan
  const [brewBatches, setBrewBatches] = useState<{ id: string; recipe_name: string | null; batch_gal: number; status: string; ready_at: string | null }[]>([]);
  const [stopMeta, setStopMeta] = useState<{ day: string | null; plan_days: number }>({ day: null, plan_days: 1 });
  // Which city's shelf this load-out is against. 0288 made stock per market; this screen was the
  // one place still adding every city together. lib/markets' contract: unknown resolves to founding.
  const [market, setMarket] = useState<string>(FOUNDING_MARKET);
  const [onHand, setOnHand] = useState<{ item: string; bal: number }[]>([]); // carried-in stock (ledger balance)
  const [onHandFailed, setOnHandFailed] = useState(false); // read failed ≠ nothing carried in

  const loadOnHand = useCallback(async () => {
    if (!supabase) return;
    // The balance has a canonical home — public.inventory_on_hand, which 0288 fixed to group by
    // (item, MARKET). This screen used to fetch every ledger row and re-add them up here, grouped by
    // item alone, which is the exact defect 0288 exists to prevent, still running in the browser.
    // Reading the view means one definition of "on hand" and one place to fix it.
    //
    // It also has to be able to fail out loud: the section below renders only when onHand is
    // non-empty, so a blip did not show an error, it showed a truck with nothing carried in, to the
    // person deciding what to load. Empty and broken must not look the same when somebody is about
    // to pack against the answer.
    const { data, error } = await supabase.from("inventory_on_hand").select("item, on_hand").eq("market", market);
    if (error) { setOnHandFailed(true); return; } // keep whatever is on screen and say so instead
    setOnHandFailed(false);
    setOnHand(((data as { item: string; on_hand: number | string }[]) ?? [])
      .map((r) => ({ item: r.item, bal: Number(r.on_hand) }))
      .filter((x) => Number.isFinite(x.bal) && Math.abs(x.bal) > 0.0001)
      .sort((a, b) => a.item.localeCompare(b.item)));
  }, [market]);
  useEffect(() => { loadOnHand(); }, [loadOnHand]);

  const prepState = useAsyncData<true>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // Resolve the target's display name (+ the full event row for events).
    if (isEvent) {
      const { data: e } = await supabase.from("events").select("*").eq("id", target.id).maybeSingle();
      setEv((e as EventRow) ?? null);
      setName((e as EventRow)?.title ?? null);
      setMarket(toMarket((e as unknown as { market?: string | null } | null)?.market));
    } else {
      const { data: s } = await supabase.from("stops").select("name, starts_at, plan_days, market").eq("id", target.id).maybeSingle();
      setEv(null);
      const sm = s as { name: string; starts_at: string | null; plan_days: number | null; market?: string | null } | null;
      setName(sm?.name ?? null);
      setMarket(toMarket(sm?.market));
      setStopMeta({ day: sm?.starts_at ? sm.starts_at.slice(0, 10) : null, plan_days: Math.max(1, sm?.plan_days ?? 1) });
    }
    const { data: t, error: tErr } = await supabase.from("event_tasks").select("*").eq(ownerCol, target.id).order("sort");
    if (tErr) throw new Error(tErr.message);   // an empty run-of-show is the crew's whole job, missing
    const seen = new Set<string>();
    const deduped = ((t as EventTask[]) ?? []).filter((x) => { const k = `${x.section ?? ""}|${x.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
    setTasks(deduped);
    commentCounts("event_task_id", deduped.map((x) => x.id)).then(setCounts);
    // Crew + sign-off work for events AND stops (owner-generic) — a stop staffs up just like an event.
    {
      const [{ data: c }, { data: ap }] = await Promise.all([
        supabase.from("event_staff").select("id, user_id, role_label").eq(ownerCol, target.id),
        supabase.from("event_approvals").select("*").eq(ownerCol, target.id),
      ]);
      setCrew((c as { id: string; user_id: string; role_label: string | null }[]) ?? []);
      setApprovals((ap as { approver_id: string }[]) ?? []);
    }
    if (isAdmin) {
      const { data: p, error: pErr } = await supabase.from("profiles").select("id, display_name, role").neq("role", "member");
      if (pErr) throw new Error(pErr.message);
      setStaff((p as { id: string; display_name: string | null; role: string | null }[]) ?? []);
    }
    // Brew batches serving THIS event/stop (many-to-many via the link table).
    const { data: bl } = await supabase.from("brew_batch_links").select("brew_batches(id, recipe_name, batch_gal, status, ready_at)").eq(ownerCol, target.id);
    type BB = { id: string; recipe_name: string | null; batch_gal: number; status: string; ready_at: string | null };
    const seenB = new Set<string>();
    const rows = (bl as unknown as { brew_batches: BB | BB[] | null }[]) ?? [];
    setBrewBatches(rows.flatMap((r) => (Array.isArray(r.brew_batches) ? r.brew_batches : r.brew_batches ? [r.brew_batches] : []))
      .filter((b) => !seenB.has(b.id) && (seenB.add(b.id), true)));
    return true;
  }, [target.id, isEvent, ownerCol, isAdmin]);
  // `load` stays the name every mutation handler below already calls — it's now the hook's reload.
  // The loader still owns its setState calls directly (unchanged from before); useAsyncData only
  // layers status/error tracking + a race-safe reload on top, so this stays a light-touch wrap
  // rather than a rewrite of every optimistic-update call site in this hub.
  const load = prepState.reload;
  useRealtimeTable(["event_tasks", "event_staff", "event_approvals", "comments", "brew_batch_links", "brew_batches"], load);

  // Clear, identifiable labels — staff often sign in without setting a name, so fall back
  // to something readable instead of an anonymous "—" that makes assignments look empty.
  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || "Unnamed crew";
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];
  const initialOf = (uid: string) => { const n = staff.find((s) => s.id === uid)?.display_name?.trim(); return n ? n.charAt(0).toUpperCase() : "?"; };
  const nameOf = (uid: string) => staffName(uid);
  const generate = async (regen = false) => {
    if (!supabase || generating) return;
    // The menu/rig/site row that drives packListFor — the event row, or the stop's own menu columns.
    let menuRow = ev as EventRow | null;
    if (!isEvent) {
      const { data: s } = await supabase.from("stops").select(MENU_RIG_COLUMNS).eq("id", target.id).maybeSingle();
      menuRow = (s as unknown as EventRow) ?? null;
    }
    if (!menuRow) return;
    if (regen && !(await confirm({ title: `Refresh the pack list from the ${isEvent ? "event" : "stop"}'s current menu and rig?`, body: "New items are added and dropped ones removed — your existing checkmarks are kept.", confirmLabel: "Refresh" }))) return;
    setGenerating(true);
    // Pack list (rig/menu) for both; compliance (state/county) for events, which carry a jurisdiction.
    // Menu comes from the 0173 relation (real product slugs) when it has rows; the legacy menu_*
    // booleans on the row remain the fallback for owners whose relation was never written.
    const { data: mi } = await supabase.from("event_menu_items").select("product_slug").eq(ownerCol, target.id);
    const menuSlugs = new Set(((mi as { product_slug: string }[] | null) ?? []).map((r) => r.product_slug));
    const pack: NewEventTask[] = packListFor(menuRow, menuSlugs.size ? menuSlugs : null).map((p, i) => ({ parent: ownerParent, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "pack", link: null, sort: i }));
    // Compliance is events-only and binds to the EVENT, not to whichever target this is — the one
    // place in this function where the parent is not ownerParent, which is why it says so.
    const comp: NewEventTask[] = isEvent && ev ? (await complianceFor(ev, supabase)).map((p, i) => ({ parent: { event: ev.id }, label: p.label, section: p.section, critical: !!p.critical, warn: !!p.warn, kind: "task", link: p.link ?? null, sort: 100 + i })) : [];
    const rows = [...pack, ...comp];
    if (!rows.length) { setGenerating(false); toast(`Set the ${isEvent ? "event" : "stop"}'s menu + rig first — tap Menu & setup`, "error"); return; }
    const keyOf = (r: { section?: string | null; label: string }) => `${r.section ?? ""}|${r.label}`;
    const { data: existing } = await supabase.from("event_tasks").select("id, label, section, kind").eq(ownerCol, target.id);
    const ex = (existing as { id: string; label: string; section: string | null; kind: string | null }[]) ?? [];
    if (!ex.length) {
      // First generation — straight insert.
      const { error } = await createEventTasks(rows);
      setGenerating(false);
      toast(error ? `Error: ${error}` : `Generated ${pack.length} pack${comp.length ? ` + ${comp.length} compliance` : ""} items`, error ? "error" : undefined);
      if (!error) load();
      return;
    }
    if (!regen) { setGenerating(false); load(); return; } // idempotent: a plain generate never double-inserts
    // DIFF regen (audit P1·8) — preserve crew progress: add only the items that are new, remove only
    // the auto-generated PACK rows that are no longer on the menu, and leave everything else (checked
    // items, manual tasks, follow-ups, compliance) exactly as it is.
    const existingKeys = new Set(ex.map(keyOf));
    const desiredKeys = new Set(rows.map(keyOf));
    const toAdd = rows.filter((r) => !existingKeys.has(keyOf(r)));
    const staleIds = ex.filter((r) => r.kind === "pack" && !desiredKeys.has(keyOf(r))).map((r) => r.id);
    // Both writes are now checked. They were not: the two bare awaits this replaced discarded their
    // error objects, and the toast below then announced "N added, M removed" whether or not a single
    // row had moved. A refresh that silently does nothing is worse than one that fails.
    const addErr = toAdd.length ? (await createEventTasks(toAdd)).error : undefined;
    if (addErr) { setGenerating(false); toast(`Couldn't refresh — ${addErr}`, "error"); return; }
    const delErr = staleIds.length ? (await deleteTasks("event", staleIds)).error : undefined;
    setGenerating(false);
    if (delErr) { toast(`Added ${toAdd.length}, but couldn't remove the dropped items — ${delErr}`, "error"); load(); return; }
    toast(toAdd.length || staleIds.length ? `Refreshed — ${toAdd.length} added, ${staleIds.length} removed, checkmarks kept` : "Already up to date");
    load();
  };
  // Plan a brew for exactly this one: Brew's picker opens with it already chosen (2026-07-29).
  const planBrew = () => {
    try { localStorage.setItem("gt3-brew-target", `${isEvent ? "e" : "s"}:${target.id}`); } catch { /* ignore */ }
    setSection("brew");
  };
  // Nuke / reset — wipe everything built for this event/stop (AI-generated prep + run-of-show schedule)
  // so the crew can start clean. The event/stop itself, its date, and its day-of brief stay.
  const resetAll = async () => {
    if (!supabase || generating) return;
    const what = isEvent ? "event" : "truck stop";
    if (!(await confirm({ title: `Reset this ${what}?`, body: `This deletes its entire prep checklist and run-of-show schedule — everything you and the AI have built. The ${what} itself and its date stay. It can't be undone.`, confirmLabel: "Reset it", cancelLabel: "Keep it", danger: true }))) return;
    setGenerating(true);
    const [t1, t2] = await Promise.all([
      deleteTasksForParent(ownerParent),
      supabase.from("event_schedule_items").delete().eq(ownerCol, target.id),
    ]);
    setGenerating(false);
    const e = t1.error || t2.error?.message;
    toast(e ? `Reset failed — ${e}` : `Reset — this ${what}'s prep & schedule are cleared`, e ? "error" : undefined);
    if (!e) load();
  };
  const toggle = async (t: EventTask) => {
    if (!supabase) return;
    const next = !t.done;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("event_tasks").update({ done: next, done_by: next ? user?.id ?? null : null, done_at: next ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic — the assignment shows immediately
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); return; }
    toast(next ? `Assigned to ${firstNameOf(next)}` : "Unassigned");
    // Notify the newly-assigned member (best-effort; lights up once the push Edge Function is redeployed).
    if (next) {
      // Alerts are staff-wide since 0157 — every assignee gets the flag, and the fan-out trigger
      // delivers the push. The old leadership-only guard (and its direct push.invoke fallback that
      // bypassed the spine) is gone with it.
      if (next !== user?.id) {
        raiseAlert({
          severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: name ? `On ${isEvent ? "event" : "location"} · ${name}` : undefined,
          target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  // Confirm the actual count for a planned item — what's confirmed moves into "On hand". Setting an
  // actual also checks the line off (it's done once you've confirmed what you really have).
  const confirmQty = async (t: EventTask, v: string) => {
    if (!supabase) return;
    const n = v.trim() === "" ? null : Number(v);
    if (n != null && !Number.isFinite(n)) { toast("That isn't a number", "error"); return; }
    const delta = (n ?? 0) - (t.actual_qty ?? 0);
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, actual_qty: n, done: n != null } : x)));
    const { error } = await supabase.from("event_tasks").update({ actual_qty: n, done: n != null, done_at: n != null ? new Date().toISOString() : null, done_by: n != null ? user?.id ?? null : null }).eq("id", t.id);
    if (error) { toast(`Couldn't confirm — ${error.message}`, "error"); load(); return; }
    // back the clean UI with an append-only ledger entry (signed delta) for reports + carryover.
    //
    // ON THIS EVENT'S SHELF (2026-10-04, the form audit). The entry carried no market, so it took
    // the column's default (0288: 'greenville') — an Atlanta event's confirmed count went onto
    // Greenville's shelf, and this screen, which reads on-hand for the event's own market, never
    // showed it. adjustOnHand below has always passed `market`; now both do.
    if (delta !== 0) {
      const { error: le } = await supabase.from("inventory_ledger").insert({
        item: t.label.slice(0, 160), task_id: t.id, kind: "confirm", qty: delta, market,
        event_id: isEvent ? target.id : null, stop_id: isEvent ? null : target.id, created_by: user?.id ?? null,
      });
      if (le) toast(`Confirmed, but on-hand didn't move — ${le.message}`, "error");
      loadOnHand();
    }
  };
  // Correct the real count of a carried-in item (e.g. the leftover after an event). The ledger is
  // append-only signed movements, so a correction is still written as a DELTA — but 0318 computes
  // that delta on the server, against the shelf as it stands, under a lock on (item, market).
  //
  // It used to be computed here from `onHand`, which was loaded when the screen opened. Anything
  // that moved the item in between — someone logging use, an event deducting stock — made `cur`
  // stale, and the shelf landed on `actual + want - cur` instead of the number the person typed.
  // It failed silently: the write succeeded and the input showed what they entered.
  const adjustOnHand = async (item: string, v: string) => {
    if (!supabase) return;
    const want = v.trim() === "" ? 0 : Number(v);
    if (!Number.isFinite(want)) { toast("That isn't a number", "error"); return; }
    const { data, error } = await supabase.rpc("set_on_hand", {
      p_item: item, p_want: want, p_market: market,
      p_event: isEvent ? target.id : null, p_stop: isEvent ? null : target.id,
    });
    if (error) { toast(`Couldn't correct ${item} — ${error.message}`, "error"); loadOnHand(); return; }
    // Show what the SERVER says the shelf holds, not what we assumed it would.
    const landed = Number(data);
    setOnHand((p) => p.map((o) => (o.item === item ? { ...o, bal: Number.isFinite(landed) ? landed : o.bal } : o)));
  };
  const addTask = async () => {
    if (!supabase || !newTask.trim()) return;
    const due_at = newTaskDue.trim() === "" ? null : new Date(`${newTaskDue}T23:59:59`).toISOString();
    const { error } = await createEventTask({ parent: ownerParent, label: newTask.trim(), kind: "task", section: "Task", sort: tasks.length, dueISO: due_at });
    setNewTask(""); setNewTaskDue("");
    if (error) toast(`Error: ${error}`, "error"); else load();
  };
  const addCrew = async (uid: string) => {
    if (!supabase || !uid) return;
    const { error } = await supabase.from("event_staff").insert({ [ownerCol]: target.id, user_id: uid });
    if (error) toast(error.code === "23505" ? "Already on crew" : `Error: ${error.message}`, "error"); else load();
  };
  const removeCrew = async (id: string) => { if (supabase) { await supabase.from("event_staff").delete().eq("id", id); load(); } };
  // Add supplies the crew must bring — picked from the Notion inventory catalog or typed
  // off-catalog. Each becomes a checklist line under "Supplies" (no inventory duplication).
  const addSupplies = async (items: { label: string; critical: boolean }[]) => {
    setShowSupplies(false);
    if (!supabase || items.length === 0) return;
    const have = new Set(tasks.map((t) => t.label.trim().toLowerCase()));
    const rows: NewEventTask[] = items
      .filter((i) => !have.has(i.label.trim().toLowerCase()))
      .map((i, idx) => ({ parent: ownerParent, label: i.label.trim(), section: "Supplies", kind: "pack", critical: i.critical, sort: 40 + idx }));
    if (rows.length === 0) { toast("Those are already on the list"); return; }
    const { error } = await createEventTasks(rows);
    toast(error ? `Error: ${error}` : `Added ${rows.length} suppl${rows.length === 1 ? "y" : "ies"}`, error ? "error" : undefined);
    if (!error) load();
  };
  // Tag/untag a crew member as a manager — managers must approve the prep too.
  const setManager = async (crewRowId: string, makeMgr: boolean) => {
    if (!supabase) return;
    await supabase.from("event_staff").update({ role_label: makeMgr ? "manager" : null }).eq("id", crewRowId);
    load();
  };
  const toggleApproval = async (mine: boolean) => {
    if (!user || !supabase) return;
    if (mine) {
      await supabase.from("event_approvals").delete().eq(ownerCol, target.id).eq("approver_id", user.id);
      toast("Approval withdrawn");
    } else {
      const { error } = await supabase.from("event_approvals").insert({ [ownerCol]: target.id, approver_id: user.id });
      toast(error ? `Error: ${error.message}` : "Prep approved", error ? "error" : undefined);
    }
    load();
  };
  const requestSignoff = async (approverIds: string[]) => {
    if (!supabase || approverIds.length === 0) { toast("Everyone's already approved"); return; }
    const requester = profile?.display_name?.split(" ")[0] || "A manager";
    const label = name ?? (isEvent ? "Event" : "Stop");
    // Route through the alerts spine (inbox · My Day · digest) — one alert per pending approver — so
    // an approver with no push subscription still sees it; the 0157 alerts_push_fanout trigger also
    // delivers the web push, so the old push-only edge call is redundant. Toast reflects the write.
    const { error } = await supabase.from("alerts").insert(
      approverIds.map((id) => ({
        severity: "important", category: "prep", kind: "prep_signoff_request", subject_id: target.id,
        title: `${requester} needs your sign-off: ${label}`,
        body: `Prep is ready for your approval${name ? ` · ${name}` : ""}`,
        link: "/crew", target_user_id: id, created_by: user?.id ?? null,
      })),
    );
    if (error) { toast(`Couldn't request sign-off: ${error.message}`, "error"); return; }
    toast("Sign-off requested");
  };

  const total = tasks.length, doneN = tasks.filter((t) => t.done).length;
  const critOut = tasks.filter((t) => t.critical && !t.done);
  const ready = total > 0 && doneN === total;
  const sections = [...new Set(tasks.map((t) => t.section ?? "Task"))];

  // Sign-off: an owner + every tagged manager must approve. Editing checklist content
  // re-opens it (DB trigger). Checking items / assigning crew does NOT re-open.
  const managers = crew.filter((c) => c.role_label === "manager");
  const approvedIds = new Set(approvals.map((a) => a.approver_id));
  const ownerApproved = approvals.some((a) => staff.find((s) => s.id === a.approver_id)?.role === "owner");
  const ownerIds = staff.filter((s) => s.role === "owner").map((s) => s.id);
  const fullyApproved = ownerApproved && managers.every((m) => approvedIds.has(m.user_id));
  const approvedCount = (ownerApproved ? 1 : 0) + managers.filter((m) => approvedIds.has(m.user_id)).length;
  const isOwner = roleOf(profile) === "owner";
  const iAmRequired = !!user && (isOwner || managers.some((m) => m.user_id === user.id));
  const iApproved = !!user && approvedIds.has(user.id);
  const pendingApprovers = [...new Set([...managers.map((m) => m.user_id), ...ownerIds])].filter((id) => !approvedIds.has(id));

  return (
    <AsyncSection
      state={prepState}
      isEmpty={() => false}
      emptyTitle="Nothing to prep yet"
      loadingLabel={`Loading ${isEvent ? "event" : "location"} prep…`}
      errorTitle={`Couldn't load ${isEvent ? "event" : "location"} prep`}
    >
      {() => {
        if (name === null) {
          return (
            <div className="adm-sec adm-prep">
              <button className="adm-prep-back" onClick={onBack}>‹ All prep</button>
              <EmptyState title={`${isEvent ? "Event" : "Location"} not found`} sub="It may have been removed." />
            </div>
          );
        }
        return (
    <div className="adm-sec adm-prep">
      <button className="adm-prep-back" onClick={onBack}>‹ All prep</button>
      <SectionHeader label={name ?? "…"} annotation="prep" right={<>
        {isEvent && ev?.is_live && <span className="k-count due">LIVE</span>}
        {!isEvent && <span className="k-count">Location</span>}
      </>} />
      {/* Identity / date / place / status — managed right here, so a stop or event is one screen
          end to end. The wrapper id is the scoped "Days to go" KPI tile's drill target. */}
      <div id="prep-target-details">
        <OwnerDetails ownerType={target.kind} ownerId={target.id} isAdmin={isAdmin} onSaved={(nm) => { setName(nm); load(); }} onRemoved={onBack} />
      </div>
      {total > 0 ? (
        <>
          <div className={`adm-ready-bar${ready ? " ok" : critOut.length ? " miss" : ""}`}>
            <b>Loaded {doneN}/{total}</b>
            {critOut.length > 0 && <span className="adm-ready-miss"> · {critOut.length} critical to load: {critOut.slice(0, 2).map((t) => t.label).join(", ")}{critOut.length > 2 ? ` +${critOut.length - 2}` : ""}</span>}
            {ready && <span> · ready to roll</span>}
          </div>
          {isAdmin && (
            <div className="adm-prep-actions">
              <button className="adm-regen" onClick={() => generate(true)} disabled={generating}>↻ Regenerate from menu</button>
              <button className="adm-regen" onClick={() => setPrepAIOpen(true)}><Icon name="sparkles" /> AI prep list</button>
              <button className="adm-regen ts-btn" onClick={() => setTroubleshootOpen(true)}><Icon name="wrench" /> Troubleshoot</button>
              <button className="adm-regen" onClick={() => setShowSupplies(true)}>+ Add supplies</button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        // id: the scoped "No pick list yet" tile lands here — on the buttons that make one.
        <div className="adm-prep-actions" id="prep-target-start" style={{ flexWrap: "wrap" }}>
          <button className="adm-btn primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate pack list from menu"}</button>
          <button className="adm-btn" onClick={() => setPrepAIOpen(true)}><Icon name="sparkles" /> AI prep list</button>
          <button className="adm-btn ts-btn" onClick={() => setTroubleshootOpen(true)}><Icon name="wrench" /> Troubleshoot</button>
        </div>
      ) : <div id="prep-target-start"><EmptyState title="No pick list yet" /></div>}
      {prepAIOpen && (
        <EventPrepAI ownerType={target.kind} ownerId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          onClose={() => setPrepAIOpen(false)} onAdded={load} />
      )}
      {troubleshootOpen && (
        <TroubleshootAI ownerType={target.kind} ownerId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          onClose={() => setTroubleshootOpen(false)} onLogged={load} />
      )}

      {/* Menu & rig — the same flags an event carries; drives "Generate pack list from menu" for both. */}
      <MenuEditor ownerType={target.kind} ownerId={target.id} isAdmin={isAdmin} onChanged={load} />

      {/* Brew serving this event/stop — sits right under Menu & rig (a batch can serve several).
          2026-07-29: used to be read-only — seeing an already-linked batch here but having no way
          to start a NEW one without leaving for the separate Brew section and hunting through every
          event/stop ever made for this one. The button below skips all of that: it drops this exact
          target into Brew's picker (already pre-selected) and jumps straight there. */}
      {/* THE TOOLS FOR THIS ONE, IN ONE SHAPE (2026-10-04, Ryan's prep screen at 10:44 PM). Menu &
          setup and Load-out & tow were cards with a chevron; "Plan a brew" was a tinted pill;
          "Schedule · when to leave" and "Pack-out plan · kegs vs bottles" were thin gold text that
          read as labels — three looks for five doors, two of which did not look like doors. Each is
          the same card now: what it is, what is in it, ›. */}
      {brewBatches.length > 0 && (
        <div className="brewlink">
          <div className="brewlink-h"><Icon name="coffee" /> Brew coming to this {isEvent ? "event" : "stop"}</div>
          {brewBatches.map((b) => (
            <div key={b.id} className="brewlink-row">
              <span className="brewlink-name">{b.recipe_name || "Batch"} · {b.batch_gal} gal</span>
              <span className="brewlink-st">{b.status}{b.ready_at && (b.status === "brewing" || b.status === "planned") ? ` · ready ${new Date(b.ready_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</span>
            </div>
          ))}
          {isAdmin && <button type="button" className="brewlink-plan" onClick={planBrew}><Icon name="coffee" /> Plan another brew for this {isEvent ? "event" : "stop"}</button>}
        </div>
      )}
      {brewBatches.length === 0 && isAdmin && (
        <button type="button" className="prep-collapse prep-tool" onClick={planBrew}>
          <span className="prep-collapse-l"><b><Icon name="coffee" /> Brew</b><span>nothing planned for this {isEvent ? "event" : "stop"} yet — plan one</span></span>
          <span className="ev-chev" aria-hidden="true">›</span>
        </button>
      )}

      {/* Run-of-show / "when do we leave" planner — identical for events and stops. */}
      {isAdmin && (
        <button type="button" className="prep-collapse prep-tool" onClick={() => setPlanOpen(true)}>
          <span className="prep-collapse-l"><b><Icon name="calendar" /> Schedule</b><span>when to leave · the run of show</span></span>
          <span className="ev-chev" aria-hidden="true">›</span>
        </button>
      )}
      {planOpen && (
        <EventDayPlanner
          ownerType={target.kind} eventId={target.id} title={name ?? (isEvent ? "Event" : "Stop")}
          eventDay={isEvent ? (ev?.day ?? null) : stopMeta.day}
          planDays={isEvent ? Math.max(1, ev?.plan_days ?? 1) : stopMeta.plan_days}
          onPlanDays={(n) => {
            if (isEvent) { supabase?.from("events").update({ plan_days: n }).eq("id", target.id).then(() => {}); }
            else { setStopMeta((m) => ({ ...m, plan_days: n })); supabase?.from("stops").update({ plan_days: n }).eq("id", target.id).then(() => {}); }
          }}
          onClose={() => setPlanOpen(false)} />
      )}

      {/* Load-out & tow + pack-out plan, scoped to this event/stop — part of the one hub. */}
      {isAdmin && (
        <>
          <button type="button" className="prep-collapse prep-tool" onClick={() => setLoadoutOpen((o) => !o)} aria-expanded={loadoutOpen}>
            <span className="prep-collapse-l"><b><Icon name="truck" /> Load-out &amp; tow</b><span>space plan · tongue weight · the load checklist</span></span>
            <span className={`ev-chev${loadoutOpen ? " open" : ""}`}>›</span>
          </button>
          <button type="button" className="prep-collapse prep-tool" onClick={() => setPackPlanOpen(true)}>
            <span className="prep-collapse-l"><b><Icon name="package" /> Pack-out plan</b><span>kegs vs bottles, from the brew coming here</span></span>
            <span className="ev-chev" aria-hidden="true">›</span>
          </button>
        </>
      )}
      {loadoutOpen && isAdmin && <TrailerLoadout lockTo={{ kind: target.kind, id: target.id }} />}
      {packPlanOpen && <PackPlan ownerType={target.kind} ownerId={target.id} title={name ?? ""} onClose={() => setPackPlanOpen(false)} />}

      {/* Incidents logged here by the Troubleshoot agent — resolve or delete them. */}
      <IncidentLog ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} />

      {/* How the crew shows up — dress code + call details. Leadership edits; assigned crew read it. */}
      <DayBrief ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} isAdmin={isAdmin} />
      <NotesForTarget ownerCol={ownerCol as "event_id" | "stop_id"} ownerId={target.id} />

      {/* Nuke / reset — wipe the prep + schedule built for this event/stop and start clean. */}
      {isAdmin && total > 0 && (
        <div className="adm-reset-row">
          <button type="button" className="adm-reset-btn" onClick={resetAll} disabled={generating}>Reset this {isEvent ? "event" : "truck stop"} — clear prep &amp; schedule</button>
        </div>
      )}

      {isAdmin && (
        <div className="adm-crew-row">
          {crew.map((c) => {
            const mgr = c.role_label === "manager";
            return (
              <span key={c.id} className={`adm-crew-chip${mgr ? " mgr" : ""}`}>
                <button type="button" className="crew-mgr" onClick={() => setManager(c.id, !mgr)} title={mgr ? "Remove manager" : "Make manager (must approve)"} aria-label={mgr ? "Remove manager" : "Make manager"}>{mgr ? <Icon name="star" /> : "☆"}</button>
                <span className="crew-name">{nameOf(c.user_id)}</span>
                <button type="button" className="crew-x" onClick={() => removeCrew(c.id)} aria-label="Remove from crew"><Icon name="close" /></button>
              </span>
            );
          })}
          <select className="adm-role" value="" onChange={(e) => { addCrew(e.target.value); e.target.value = ""; }} aria-label="Add crew">
            <option value="">+ crew</option>
            {staff.filter((s) => !crew.some((c) => c.user_id === s.id)).map((s) => <option key={s.id} value={s.id}>{crewLabel(s)}</option>)}
          </select>
        </div>
      )}

      {total > 0 && (
        <div className={`adm-approve${fullyApproved ? " ok" : ""}`}>
          <div className="adm-approve-h">
            <b>{fullyApproved ? "Prep approved" : "Prep sign-off"}</b>
            <span>{approvedCount}/{1 + managers.length} approved</span>
          </div>
          <div className="adm-approve-rows">
            <div className={`adm-approve-row${ownerApproved ? " done" : ""}`}><span>Owner</span><span className="adm-approve-mark">{ownerApproved ? <Icon name="check" /> : "—"}</span></div>
            {managers.map((m) => (
              <div key={m.id} className={`adm-approve-row${approvedIds.has(m.user_id) ? " done" : ""}`}><span>{firstNameOf(m.user_id)} · mgr</span><span className="adm-approve-mark">{approvedIds.has(m.user_id) ? <Icon name="check" /> : "—"}</span></div>
            ))}
          </div>
          <div className="adm-approve-actions">
            {iAmRequired && <button className={`adm-btn${iApproved ? " ghost" : " primary"}`} onClick={() => toggleApproval(iApproved)}>{iApproved ? "Withdraw approval" : "Approve prep"}</button>}
            {isAdmin && !fullyApproved && pendingApprovers.length > 0 && <button className="adm-btn ghost" onClick={() => requestSignoff(pendingApprovers)}>Request sign-off</button>}
          </div>
          {managers.length === 0 && <div className="h-sub" style={{ marginTop: 6 }}>Tag a crew member <Icon name="star" /> as manager to require their approval too.</div>}
        </div>
      )}

      {onHandFailed && (
        <div className="onhand carryin" role="status">
          <div className="onhand-h"><Icon name="package" /> On hand now <span>couldn&apos;t load carried-in stock — this is not &ldquo;nothing on hand&rdquo;</span></div>
          <button type="button" className="btn ghost sm" onClick={() => loadOnHand()}>Try again</button>
        </div>
      )}

      {onHand.length > 0 && (
        <div className="onhand carryin">
          <div className="onhand-h"><Icon name="package" /> On hand now <span>carried in — correct any count</span></div>
          {onHand.map((o) => (
            <div key={o.item} className="onhand-row">
              <span className="onhand-label">{o.item}</span>
              <span className="onhand-nums">
                <input type="number" className="onhand-in" defaultValue={o.bal} onBlur={(e) => adjustOnHand(o.item, e.target.value)} aria-label={`On hand ${o.item}`} />
                <span className="onhand-of">on hand</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {tasks.some((t) => t.target_qty != null) && (
        <div className="onhand">
          <div className="onhand-h">On hand <span>plan <Icon name="arrowRight" /> confirm what&apos;s real</span></div>
          {tasks.filter((t) => t.target_qty != null).map((t) => {
            const a = t.actual_qty, plan = t.target_qty as number;
            const short = a != null && a < plan;
            return (
              <div key={t.id} className={`onhand-row${a != null ? " done" : ""}`}>
                <span className="onhand-label">{t.label}</span>
                <span className="onhand-nums">
                  <input type="number" min="0" className="onhand-in" defaultValue={a ?? ""} placeholder="—"
                    onBlur={(e) => { if ((e.target.value === "" ? null : Number(e.target.value)) !== (a ?? null)) confirmQty(t, e.target.value); }} aria-label={`Confirm actual for ${t.label}`} />
                  <span className="onhand-of">/ {plan}{a != null && <b className={short ? "shy" : "ok"}>{short ? `· ${plan - a} short` : "· on hand"}</b>}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* The checklist — wrapper id is the scoped "Open tasks" tile's drill target; the first open
          critical line carries its own id for the "Critical open" tile (absent when 0: no-op). */}
      <div id="prep-target-tasks">
      {sections.map((sec) => (
        <div key={sec} className="adm-prep-sec">
          <div className="adm-prep-label">{sec}</div>
          {tasks.filter((t) => (t.section ?? "Task") === sec).map((t) => (
            <div key={t.id} className="adm-task-wrap" id={t.id === critOut[0]?.id ? "prep-first-crit" : undefined}>
              <div className={`adm-task${t.done ? " done" : ""}${t.critical ? " crit" : t.warn ? " warn" : ""}`}>
                <button type="button" className="task-check" aria-pressed={t.done} onClick={() => toggle(t)} aria-label={`${t.done ? "Mark not loaded" : "Mark loaded"}: ${t.label}`}>
                  <span className="task-box">{t.done && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
                  <span className="task-label">{t.label}{t.target_qty != null && <span className="task-qty">{t.actual_qty ?? "—"}/{t.target_qty}</span>}{t.due_at && <span className={`task-due${!t.done && t.due_at < new Date().toISOString() ? " over" : ""}`}>{!t.done && t.due_at < new Date().toISOString() ? <><Icon name="warning" /> </> : ""}due {dueLabel(t.due_at)}</span>}</span>
                </button>
                <div className="task-right">
                  {t.link && <a className="adm-task-link" href={t.link} target="_blank" rel="noopener noreferrer" aria-label="Open reference / application"><Icon name="externalLink" /></a>}
                  <button type="button" className="task-discuss" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label={`Discuss ${t.label}`}><Icon name="chat" />{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : <span className="task-discuss-l">Discuss</span>}</button>
                  {isAdmin && <button type="button" className="task-discuss" onClick={() => openTask(t.id, "event")} aria-label={`Edit ${t.label}`} title="Edit task">✎</button>}
                  {isAdmin ? (
                    <button type="button" className={`task-assign${t.assignee ? " set" : ""}`} onClick={() => setAssignFor(t)} aria-label={t.assignee ? `Reassign ${t.label} — currently ${staffName(t.assignee)}` : `Assign ${t.label} to crew`}>
                      {t.assignee
                        ? <><span className="task-assign-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></>
                        : <span className="task-assign-add">+ Assign</span>}
                    </button>
                  ) : t.assignee ? (
                    <span className="task-assign set readonly"><span className="task-assign-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></span>
                  ) : null}
                </div>
              </div>
              {openThread === t.id && (
                <CommentThread subject={{ col: "event_task_id", id: t.id }} notifyIds={[t.assignee]} label={t.label} meId={user?.id ?? null} meName={profile?.display_name?.trim() || "Me"} />
              )}
            </div>
          ))}
        </div>
      ))}
      </div>
      {isAdmin && total > 0 && (
        <div className="adm-task-add">
          <input className="subpitch-email" style={{ marginBottom: 0 }} placeholder="Add a task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} aria-label="Add a task" />
          <input type="date" className="subpitch-email adm-task-due" style={{ marginBottom: 0 }} value={newTaskDue} onChange={(e) => setNewTaskDue(e.target.value)} aria-label="Due date (optional)" title="Due date (optional)" />
          <button className="adm-btn" onClick={addTask}>Add</button>
        </div>
      )}

      {assignFor && (
        <AssignSheet
          task={assignFor}
          staff={staff}
          crewIds={crew.map((c) => c.user_id)}
          meId={user?.id ?? null}
          meName={profile?.display_name?.trim() || "Me"}
          onPick={(uid) => assign(assignFor, uid)}
          onClose={() => setAssignFor(null)}
        />
      )}


      {showSupplies && (
        <SupplyPicker ev={ev} title={name ?? (isEvent ? "this event" : "this location")} have={new Set(tasks.map((t) => t.label.trim().toLowerCase()))} onAdd={addSupplies} onClose={() => setShowSupplies(false)} />
      )}
    </div>
        );
      }}
    </AsyncSection>
  );
}

// Mobile-friendly assignee picker — a bottom sheet with big tap rows, crew first.
function AssignSheet({ task, staff, crewIds, meId, meName, onPick, onClose }: {
  task: EventTask;
  staff: { id: string; display_name: string | null }[];
  crewIds: string[];
  meId: string | null;
  meName: string;
  onPick: (uid: string) => void;
  onClose: () => void;
}) {
  const label = (s: { display_name: string | null }) => s.display_name?.trim() || "Unnamed crew";
  const initial = (s: { display_name: string | null }) => { const n = s.display_name?.trim(); return n ? n.charAt(0).toUpperCase() : "?"; };
  // The current user can always assign to themselves, even if their profile name/role
  // would otherwise keep them out of the staff list — that's "assign to me".
  const crew = staff.filter((s) => crewIds.includes(s.id) && s.id !== meId);
  const others = staff.filter((s) => !crewIds.includes(s.id) && s.id !== meId);
  const Row = (s: { id: string; display_name: string | null }) => (
    <button key={s.id} type="button" className={`assign-row${task.assignee === s.id ? " on" : ""}`} onClick={() => onPick(s.id)} aria-pressed={task.assignee === s.id}>
      <span className="assign-av">{initial(s)}</span>
      <span className="assign-name">{label(s)}</span>
      {task.assignee === s.id && <span className="assign-check"><Icon name="check" /></span>}
    </button>
  );
  return (
    <Sheet open onClose={onClose} label="Assign task" header={<div style={{ display: "flex", alignItems: "center" }}>Assign · <b>{task.label}</b></div>}>
        {meId && (
          <button type="button" className={`assign-row me${task.assignee === meId ? " on" : ""}`} onClick={() => onPick(meId)} aria-pressed={task.assignee === meId}>
            <span className="assign-av">{(meName.trim().charAt(0) || "M").toUpperCase()}</span>
            <span className="assign-name">Assign to me{meName && meName !== "Me" ? ` · ${meName.split(" ")[0]}` : ""}</span>
            {task.assignee === meId && <span className="assign-check"><Icon name="check" /></span>}
          </button>
        )}
        {crew.length === 0 && others.length === 0 && !meId && <EmptyState title="No staff yet" sub="Add people and set their role/name in Team." />}
        {crew.length > 0 && <div className="assign-group">On this crew</div>}
        {crew.map(Row)}
        {others.length > 0 && <div className="assign-group">All staff</div>}
        {others.map(Row)}
        {task.assignee && (
          <button type="button" className="assign-row clear" onClick={() => onPick("")}>
            <span className="assign-av none">—</span><span className="assign-name">Unassign</span>
          </button>
        )}
    </Sheet>
  );
}

// Shared task editor — one bottom sheet that edits ANY event_task (it's polymorphic at the schema
// level: owned by an event, a stop, OR a meeting note). Updates are by id, so the same sheet works
// from Prep and from Meeting Notes; the edit relates straight back to the source. Fills the gap the
// per-surface rows left: rename the task, set its section, type (pack/to-do), and priority.
type SupplyItem = { name: string; category: string; qty: number | null; unit: string | null; critical: boolean };

// Supply picker — one searchable catalog over BOTH Notion DBs: inventory (consumables,
// /api/inventory) and assets/gear (/api/assets). Pre-selects what the event needs, and
// anything in neither DB can be typed in off-catalog. (GearLibrary stays the manuals view.)
function SupplyPicker({ ev, title, have, onAdd, onClose }: {
  ev: EventRow | null; // null for a truck stop (no menu/rig to pre-select from)
  title: string;
  have: Set<string>;
  onAdd: (items: { label: string; critical: boolean }[]) => void;
  onClose: () => void;
}) {
  const [inv, setInv] = useState<InventoryResp | null>(null);
  const [assets, setAssets] = useState<AssetsResp | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  useEffect(() => { fetchInventory().then(setInv); fetchAssets().then(setAssets); }, []);
  // Pre-check the consumables this event actually draws on (from its menu/rig answers).
  // A stop has no menu/rig, so nothing is pre-selected — the operator picks what to bring.
  useEffect(() => {
    if (!inv || !ev) return;
    const relevant = inventoryForEvent(inv.items, ev).relevant;
    setSel(new Set(relevant.filter((it) => !have.has(it.name.trim().toLowerCase())).map((it) => it.name)));
  }, [inv, ev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge both catalogs into one list (inventory wins on a name clash so qty/critical stick).
  const invItems: SupplyItem[] = (inv?.items ?? []).map((it) => ({ name: it.name, category: it.category || "Supplies", qty: it.qty, unit: it.unit, critical: it.critical }));
  const seenInv = new Set(invItems.map((i) => i.name.trim().toLowerCase()));
  const gearItems: SupplyItem[] = (assets?.items ?? [])
    .filter((it) => !seenInv.has(it.name.trim().toLowerCase()))
    .map((it) => ({ name: it.name, category: it.category?.[0] || it.brand || "Gear", qty: it.qty, unit: null, critical: false }));
  const items: SupplyItem[] = [...invItems, ...gearItems];
  const loaded = inv !== null && assets !== null;
  const enabled = Boolean(inv?.enabled || assets?.enabled);

  const ql = q.trim().toLowerCase();
  const onList = (name: string) => have.has(name.trim().toLowerCase());
  const relevantNames = inv && ev ? new Set(inventoryForEvent(inv.items, ev).relevant.map((it) => it.name)) : new Set<string>();
  const filtered = ql ? items.filter((it) => it.name.toLowerCase().includes(ql) || it.category.toLowerCase().includes(ql)) : items;
  const exactMatch = items.some((it) => it.name.trim().toLowerCase() === ql);
  const toggle = (name: string) => setSel((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const confirm = () => onAdd(items.filter((it) => sel.has(it.name) && !onList(it.name)).map((it) => ({ label: it.name, critical: it.critical })));
  const addCustom = () => { if (ql) onAdd([{ label: q.trim(), critical: false }]); };
  const selCount = [...sel].filter((n) => !onList(n)).length;

  // Group: what this event needs first, then by catalog category — easier to scan than one flat list.
  const groupsMap = new Map<string, SupplyItem[]>();
  for (const it of filtered) {
    const g = relevantNames.has(it.name) ? "Needed for this event" : (it.category || "Other");
    const arr = groupsMap.get(g) ?? [];
    if (arr.length === 0) groupsMap.set(g, arr);
    arr.push(it);
  }
  const groupEntries = [...groupsMap.entries()].sort((a, b) =>
    a[0] === "Needed for this event" ? -1 : b[0] === "Needed for this event" ? 1 : a[0].localeCompare(b[0])
  );

  const Item = (it: SupplyItem) => {
    const already = onList(it.name);
    const picked = sel.has(it.name);
    return (
      <button key={it.name} type="button" className={`assign-row${picked && !already ? " on" : ""}`} disabled={already} onClick={() => toggle(it.name)}>
        <span className={`task-box${picked && !already ? " on" : ""}`}>{picked && !already && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>}</span>
        <span className="assign-name">{it.name}{it.critical && <span className="supply-crit"> · critical</span>}{already && <span className="supply-off"> · on list</span>}</span>
        {it.qty != null && <span className="orderbar-tag">{it.qty}{it.unit ? ` ${it.unit}` : ""}</span>}
      </button>
    );
  };

  return (
    <Sheet open onClose={onClose} label="Event supplies" header={<div style={{ display: "flex", alignItems: "center" }}>Supplies for · <b>{title}</b></div>}>
        <div className="supply-head">
          <input className="subpitch-email" style={{ marginBottom: 0 }} placeholder="Search inventory + gear…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search supplies" autoFocus />
          {ql && !exactMatch && (
            <button type="button" className="assign-row me" style={{ marginTop: 8 }} onClick={addCustom}>
              <span className="assign-av none">+</span>
              <span className="assign-name">Add &ldquo;{q.trim()}&rdquo; <span className="supply-off">off-catalog</span></span>
            </button>
          )}
        </div>
        <div className="supply-list">
          {!loaded && <div className="h-sub" style={{ margin: "6px 0" }}>Loading inventory + gear…</div>}
          {loaded && !enabled && <EmptyState title="Catalogs not connected" sub="Type a name above and tap Add to put it on the list." />}
          {loaded && enabled && groupEntries.length === 0 && <EmptyState title={ql ? `No matches for “${q.trim()}”` : "No matches"} sub="Type to add it off-catalog." />}
          {groupEntries.map(([g, list]) => (
            <div key={g}>
              <div className="assign-group">{g} <span className="supply-count">{list.length}</span></div>
              {list.map(Item)}
            </div>
          ))}
        </div>
        <button className="handle supply-add" onClick={confirm} disabled={selCount === 0}>
          <span>{selCount > 0 ? `Add ${selCount} to checklist` : "Select items to add"}</span>
        </button>
    </Sheet>
  );
}

// ───────────────────────── one stop: go-live + location + notes ─────────────────────────
// Polymorphic location editor — one accordion card that edits EITHER a truck stop OR a vendor/venue,
// dispatching on `kind` to the matching source table. Both share the bulk of the form (name, geocoded
// address pin, POC trio, service dates, notes, archive/delete); the stop adds go-live, a calendar date,
// and the vendor picker. Unifies what used to be StopControl + VendorCard (near-identical), and upgrades
// the vendor to the stop's nicer modal address-pin flow. Stop-only props are optional.
const fmtNoteDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// Meeting notes live in Supabase (operational, relational, tenant-scoped) — not Notion. A note's
// follow-ups become event_tasks owned by meeting_note_id, so they ride the same assign + My Tasks +
// push engine as event/stop prep. Leadership-only (RLS gates to event_manager/crew/owner).
function MeetingNotes() {
  const confirm = useConfirm();
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const isAdmin = roleOf(profile) === "admin" || roleOf(profile) === "owner";
  const meId = user?.id ?? null;
  const meName = profile?.display_name?.trim() || "Me";
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [noteStops, setNoteStops] = useState<{ id: string; name: string | null }[]>([]);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [cTitle, setCTitle] = useState("");
  const [cDate, setCDate] = useState(() => localToday());
  const [cSummary, setCSummary] = useState("");
  const [cBody, setCBody] = useState("");
  const [cActions, setCActions] = useState<{ title: string; category: string; critical: boolean; assignee?: string | null }[]>([]);
  const [cLink, setCLink] = useState(""); // "" | event:<id> | stop:<id> | opp:<id>
  const [cVis, setCVis] = useState<"private" | "team" | "collab">("private");
  const [visTouched, setVisTouched] = useState(false);
  // 0262 — attachments now KEEP the file (private note-files bucket), not just its transcription.
  // Held here until save (the note id doesn't exist yet), then uploaded + rowed in note_files.
  const [cFiles, setCFiles] = useState<File[]>([]);
  const [noteOpps, setNoteOpps] = useState<{ id: string; label: string }[]>([]);
  const [noteVendors, setNoteVendors] = useState<{ id: string; name: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [mineOnly, setMineOnly] = useState(false);

  const summarize = async () => {
    if (!supabase || summarizing) return;
    const src = (cBody.trim() || cSummary.trim());
    if (!src) { toast("Add a transcript or recap first"); return; }
    setSummarizing(true);
    try {
      const r = await authedFetch("/api/agents/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: src }) });
      const j = await r.json();
      if (j.ok) {
        setCSummary(j.summary);
        if (!cTitle.trim() && j.title) setCTitle(j.title);   // fill the title only if you haven't typed one
        // Never orphaned: a follow-up the summary could not give to anyone starts as the author's
        // (the rule /api/agents/recap already keeps) — My Tasks only shows what is assigned to you.
        setCActions(((j.actionItems ?? []) as { title: string; category: string; critical: boolean; assignee?: string | null }[]).map((a) => ({ ...a, assignee: a.assignee ?? meId })));
        toast(`Recap ready${j.actionItems?.length ? ` · ${j.actionItems.length} task${j.actionItems.length === 1 ? "" : "s"} to add on save` : ""}`);
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error}`, "error");
    } catch { toast("Couldn't reach the summarizer", "error"); }
    setSummarizing(false);
  };
  const archive = async (n: MeetingNote, on: boolean) => {
    if (!supabase) return;
    await supabase.from("meeting_notes").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", n.id);
    toast(on ? "Note archived" : "Note restored"); load();
  };

  const notesState = useAsyncData<MeetingNote[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("meeting_notes").select("*").order("met_on", { ascending: false }).order("created_at", { ascending: false });
    return (data as MeetingNote[]) ?? [];
  }, []);
  const load = notesState.reload;
  // `notes` stays the editable/optimistic local copy (onVisibility below patches it directly on a
  // successful save, no round trip) — reseed it from the fetch on every load/reload.
  useEffect(() => { if (notesState.data) setNotes(notesState.data); }, [notesState.data]);
  useEffect(() => {
    if (!supabase) return;
    // These five feed the "what is this note about?" pickers. Swallowed, a failure offered nothing
    // to link a note TO — so the note got filed against nothing and the connection was lost quietly.
    supabase.from("events").select("id, title").is("archived_at", null).order("day", { ascending: false }).then(({ data, error }) => { if (!error) setEvents((data as { id: string; title: string }[]) ?? []); });
    supabase.from("stops").select("id, name").is("archived_at", null).neq("status", "done").then(({ data, error }) => { if (!error) setNoteStops((data as { id: string; name: string | null }[]) ?? []); });
    supabase.from("opportunities").select("id, stage, vendors(name)").neq("stage", "lost").then(({ data, error }) => {
      if (error) return;
      setNoteOpps((((data ?? []) as unknown) as { id: string; vendors: { name: string } | null }[]).map((o) => ({ id: o.id, label: o.vendors?.name ?? "Opportunity" })));
    });
    supabase.from("vendors").select("id, name").is("archived_at", null).order("name").then(({ data, error }) => { if (!error) setNoteVendors((data as { id: string; name: string | null }[]) ?? []); });
    supabase.from("profiles").select("id, display_name, role").neq("role", "member").then(({ data, error }) => { if (!error) setStaff((data as { id: string; display_name: string | null; role?: string | null }[]) ?? []); });
  }, []);
  useRealtimeTable("meeting_notes", load);

  const save = async () => {
    if (!supabase || !cTitle.trim() || saving) return;
    setSaving(true);
    const linkEvent = cLink.startsWith("event:") ? cLink.slice(6) : null;
    const linkStop = cLink.startsWith("stop:") ? cLink.slice(5) : null;
    const linkOpp = cLink.startsWith("opp:") ? cLink.slice(4) : null;
    const linkVendor = cLink.startsWith("vendor:") ? cLink.slice(7) : null;
    const { data, error } = await supabase.from("meeting_notes").insert({
      title: cTitle.trim(), met_on: cDate, summary: cSummary.trim() || null,
      body: cBody.trim() || null, event_id: linkEvent, stop_id: linkStop, opportunity_id: linkOpp,
      vendor_id: linkVendor, visibility: cVis, created_by: meId,
    }).select("id").single();
    // Follow-ups ride the ONE task engine. Linked note → tasks file under the event/stop (so they
    // land on its prep checklist); no link → note-owned as before. origin_note_id (0167) is pure
    // attribution — the note always knows the tasks it spawned, wherever they live.
    const noteId = (data as { id: string } | null)?.id;
    if (!error && noteId && cActions.length) {
      const owner: TaskParent = linkEvent ? { event: linkEvent } : linkStop ? { stop: linkStop } : { note: noteId };
      const { rows: made } = await createEventTasks(cActions.map((a, i) => ({
        parent: owner, originNoteId: noteId, label: a.title, kind: "task" as const, section: "Follow-up",
        critical: a.critical, assignee: a.assignee ?? null, sort: 1000 + i,
      })));
      // Assigned follow-ups ping their partner — the alert carries kind task_assigned, so it lands
      // in their My Day and is completable right on the card (0174). No leaving the note to delegate.
      const meFirst = (profile?.display_name || "A teammate").split(" ")[0];
      for (const t of made) {
        if (t.assignee) raiseAlert({ severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${meFirst} assigned you: ${t.label}`.slice(0, 180), body: `From the note "${cTitle.trim()}"`.slice(0, 300),
          target_user_id: t.assignee, created_by: meId });
      }
    }
    // 0262 — the files themselves, kept. Upload failures degrade to a toast, never to a lost note
    // (the transcription already rode into the body, so the words survive either way).
    let filed = 0, fileErr = 0;
    if (!error && noteId && cFiles.length) {
      for (const f of cFiles) {
        const up = await uploadToBucket({ bucket: "note-files", file: f, prefix: noteId });
        if ("error" in up) { fileErr++; continue; }
        const { error: fe } = await supabase.from("note_files").insert({
          note_id: noteId, path: up.path, name: f.name.slice(0, 160), mime: f.type || null, size_bytes: f.size, created_by: meId });
        if (fe) fileErr++; else filed++;
      }
    }
    setSaving(false);
    if (error) { toast(`Error: ${error.message}`, "error"); return; }
    const dest = linkEvent ? "the event's prep list" : linkStop ? "the stop's prep list" : "the note";
    toast(`Note saved${cActions.length ? ` · ${cActions.length} task${cActions.length === 1 ? "" : "s"} → ${dest}` : ""}${filed ? ` · ${filed} file${filed === 1 ? "" : "s"} kept` : ""}${fileErr ? ` · ${fileErr} file${fileErr === 1 ? "" : "s"} couldn't upload` : ""}`, fileErr ? "error" : undefined);
    setCTitle(""); setCSummary(""); setCBody(""); setCLink(""); setCVis("private"); setVisTouched(false); setCActions([]); setCFiles([]); setComposing(false);
    load();
  };
  const remove = async (n: MeetingNote) => {
    if (!supabase || !isAdmin) return;
    if (!(await confirm({ title: `Delete “${n.title}”?`, body: "This also removes its follow-ups.", confirmLabel: "Delete", danger: true }))) return;
    await supabase.from("meeting_notes").delete().eq("id", n.id);
    toast("Note deleted"); load();
  };

  return (
    <div className="adm-sec">
      <SectionHeader label="Notes" right={<span className="k-count">{notes.length}</span>} />
      <div className="h-sub note-intro">Pick who sees each one (<Icon name="lock" /> me · <Icon name="team" /> team · <Icon name="partners" /> team&nbsp;+&nbsp;comments). Follow-ups land in My&nbsp;Tasks; <Icon name="sparkles" /> summarize turns a transcript into the note. Notes grow — <b>＋&nbsp;add</b> anytime; nothing is ever overwritten.</div>

      <button type="button" className="note-new" onClick={() => setComposing(true)}>✎ New note</button>
      {composing && (
        <Sheet open onClose={() => { setComposing(false); setCActions([]); setCFiles([]); }} label="New note" className="note-lux"
          // The words stay with the page when the composer closes; its follow-ups and files do not.
          dirty={cActions.length > 0 || cFiles.length > 0}
          header={<div className="note-lux-head"><span className="note-lux-eyb">New note</span><CloseButton onClick={() => { setComposing(false); setCActions([]); setCFiles([]); }} /></div>}
          footer={<div className="note-actions"><LeaveButton className="note-cancel" onClick={() => { setComposing(false); setCActions([]); setCFiles([]); }}>Cancel</LeaveButton><button type="button" className="note-save" disabled={!cTitle.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save note"}</button></div>}>
          <div className="note-composer">
            <input className="note-in note-lux-title" placeholder="What&rsquo;s this note about?" value={cTitle} onChange={(e) => setCTitle(e.target.value)} autoFocus />
            <div className="note-row">
              <input type="date" className="note-in" value={cDate} onChange={(e) => setCDate(e.target.value)} aria-label="Date" />
              <select className="note-in" value={cLink} onChange={(e) => { setCLink(e.target.value); if (!visTouched) setCVis(e.target.value ? "collab" : "private"); }} aria-label="Attach to">
                <option value="">Attach to&hellip; (nothing)</option>
                <optgroup label="Events">
                  {events.map((ev) => <option key={ev.id} value={`event:${ev.id}`}>{ev.title}</option>)}
                </optgroup>
                <optgroup label="Truck stops">
                  {noteStops.map((s) => <option key={s.id} value={`stop:${s.id}`}>{s.name || "Untitled location"}</option>)}
                </optgroup>
                <optgroup label="Pipeline">
                  {noteOpps.map((o) => <option key={o.id} value={`opp:${o.id}`}>{o.label}</option>)}
                </optgroup>
                <optgroup label="Partners">
                  {noteVendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.name || "Partner"}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="note-vis-chips" role="radiogroup" aria-label="Who can see this note">
              {([["private",<><Icon name="lock" /> Just me</>],["team",<><Icon name="team" /> Team</>],["collab",<><Icon name="partners" /> Team + comments</>]] as const).map(([v,l]) => (
                <button key={v} type="button" role="radio" aria-checked={cVis === v} className={`note-vischip${cVis === v ? " on" : ""}`} onClick={() => { setCVis(v); setVisTouched(true); }}>{l}</button>
              ))}
            </div>
            <textarea className="note-area" placeholder="The note — a thought, a plan, a recap…" value={cSummary} onChange={(e) => setCSummary(e.target.value)} rows={cSummary.length > 200 ? 10 : 3} />
            <details className="note-transcript">
              <summary>Transcript or attachments? Add them and <Icon name="sparkles" /> summarize</summary>
              <NoteAttach onText={(t) => setCBody((b) => (b ? b + "\n\n" + t : t))} onFiles={(fs) => setCFiles((p) => [...p, ...fs].slice(0, 8))} />
              {cFiles.length > 0 && (
                <div className="note-pfiles">
                  {cFiles.map((f, i) => (
                    <span key={i} className="note-pfile">📎 {f.name}<button type="button" onClick={() => setCFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Icon name="close" /></button></span>
                  ))}
                  <span className="note-pfiles-hint">kept on the note when you save</span>
                </div>
              )}
              <textarea className="note-area" placeholder="Paste a transcript — or attach files above to fill this in…" value={cBody} onChange={(e) => setCBody(e.target.value)} rows={4} />
              <button type="button" className="note-suggest note-sum" onClick={summarize} disabled={summarizing}>{summarizing ? "Summarizing…" : <><Icon name="sparkles" /> Summarize <Icon name="arrowRight" /> title · recap · tasks</>}</button>
            </details>
            <div className="note-fu-h">Follow-ups
              <button type="button" className="note-fu-add" onClick={() => setCActions((a) => [...a, { title: "", category: "task", critical: false, assignee: meId }])}>+ Add</button>
            </div>
            {cActions.length === 0 && <div className="note-fu-empty">No follow-ups yet — add one and assign it to a partner, or <Icon name="sparkles" /> summarize a transcript to pull them out.</div>}
            {cActions.map((a, i) => (
              <div className="note-fu-edit" key={i}>
                <input className="note-in" placeholder="Follow-up task…" value={a.title} onChange={(e) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <div className="note-fu-edit-r">
                  <PersonPick label="Assign to" className="note-in" value={{ id: a.assignee ?? null, name: "" }} allowOther={false} allowNone noneLabel="Unassigned"
                              onChange={(v) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, assignee: v.id } : x))} />
                  <button type="button" className={`note-fu-crit${a.critical ? " on" : ""}`} onClick={() => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, critical: !x.critical } : x))} aria-pressed={a.critical} title="Mark critical"><Icon name="warning" /></button>
                  <button type="button" className="note-fu-del" onClick={() => setCActions((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="close" /></button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}

      <AsyncSection
        state={notesState}
        isEmpty={() => false}
        emptyTitle="No notes yet"
        loadingLabel="Loading notes…"
        errorTitle="Couldn't load notes"
      >
        {() => {
        const archivedCount = notes.filter((n) => n.archived_at).length;
        const q = query.trim().toLowerCase();
        const shown = notes.filter((n) => (tab === "archived" ? n.archived_at : !n.archived_at))
          .filter((n) => !mineOnly || n.created_by === meId)
          .filter((n) => !q || n.title.toLowerCase().includes(q) || (n.summary || "").toLowerCase().includes(q) || (events.find((e) => e.id === n.event_id)?.title || "").toLowerCase().includes(q) || (noteStops.find((s) => s.id === n.stop_id)?.name || "").toLowerCase().includes(q));
        return (
          <>
            <div className="note-filter">
              <input className="note-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" aria-label="Search notes" />
              <div className="note-tabs">
                <button type="button" className={`note-tab hit-y-44${mineOnly ? " on" : ""}`} onClick={() => setMineOnly((v) => !v)}>Mine</button>
                <button type="button" className={`note-tab hit-y-44${tab === "active" ? " on" : ""}`} onClick={() => setTab("active")}>Active</button>
                <button type="button" className={`note-tab hit-y-44${tab === "archived" ? " on" : ""}`} onClick={() => setTab("archived")}>Archived{archivedCount ? ` ${archivedCount}` : ""}</button>
              </div>
            </div>
            {shown.map((n) => (
              <MeetingNoteCard
                key={n.id} note={n} open={openId === n.id} onToggle={() => setOpenId(openId === n.id ? null : n.id)}
                staff={staff} meId={meId} meName={meName} isAdmin={isAdmin}
                eventTitle={events.find((e) => e.id === n.event_id)?.title ?? (n.stop_id ? <><Icon name="pin" /> {noteStops.find((s) => s.id === n.stop_id)?.name ?? "location"}</> : n.vendor_id ? <><Icon name="partners" /> {noteVendors.find((v) => v.id === n.vendor_id)?.name ?? "Partner"}</> : n.opportunity_id ? (noteOpps.find((o) => o.id === n.opportunity_id)?.label ?? "Opportunity") : null)} onDelete={() => remove(n)}
                onArchive={() => archive(n, !n.archived_at)}
                onVisibility={(v) => setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, visibility: v } : x)))}
                onRenamed={(t) => setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, title: t } : x)))}
                onSummary={(s) => setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, summary: s } : x)))}
              />
            ))}
            {shown.length === 0 && !composing && (
              <EmptyState
                title={q ? "No notes match your search" : tab === "archived" ? "No archived notes" : "No notes yet"}
                sub={!q && tab !== "archived" ? "Tap “New note” after your next sit-down." : undefined}
              />
            )}
          </>
        );
        }}
      </AsyncSection>
    </div>
  );
}

function MeetingNoteCard({ note, open, onToggle, staff, meId, meName, isAdmin, eventTitle, onDelete, onArchive, onVisibility, onRenamed, onSummary }: {
  note: MeetingNote;
  open: boolean;
  onToggle: () => void;
  staff: { id: string; display_name: string | null; role?: string | null }[];
  meId: string | null;
  meName: string;
  isAdmin: boolean;
  eventTitle: ReactNode | null;
  onDelete: () => void;
  onArchive: () => void;
  onVisibility?: (v: "private" | "team" | "collab") => void;
  onRenamed?: (t: string) => void;
  onSummary?: (s: string) => void;
}) {
  const confirm = useConfirm();
  const { openTask } = useTaskSheet(); // the ONE task editor, on the spine
  const { user, profile } = useAuth();
  const { toast } = useApp();
  const [items, setItems] = useState<EventTask[]>([]);
  const [newItem, setNewItem] = useState("");
  const [assignFor, setAssignFor] = useState<EventTask | null>(null);
  // Rename (2026-08-01, Ryan: "I can't edit the name of notes") — the title was the ONE thing on
  // this card with no editor: visibility, follow-ups, links all edit in place; the name was fixed
  // at creation. Author-or-admin, same gate as the visibility row.
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(note.title);
  const saveTitle = async () => {
    if (!supabase || !titleDraft.trim()) return;
    const v = titleDraft.trim().slice(0, 120);
    if (v === note.title) { setRenaming(false); return; }
    const { error } = await supabase.from("meeting_notes").update({ title: v }).eq("id", note.id);
    toast(error ? `Couldn't rename — ${error.message}` : "Renamed", error ? "error" : undefined);
    if (!error) { setRenaming(false); onRenamed?.(v); }
  };
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  // 0262 note continuation — the note is append-only now, never frozen: addenda (timestamped,
  // attributed additions), kept files (private bucket + signed URLs), a note-level Discuss thread
  // (the "Team + comments" promise, finally plugged in), and a summary refresh over the whole
  // immutable record. Ryan (2026-08-02): "can I add to a note … and not override the current note?"
  const [addenda, setAddenda] = useState<NoteAddendum[]>([]);
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [noteCmts, setNoteCmts] = useState(0);
  const [noteThread, setNoteThread] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [addSaving, setAddSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data }, { data: adds }, { data: fls }] = await Promise.all([
      supabase.from("event_tasks").select("*").or(`meeting_note_id.eq.${note.id},origin_note_id.eq.${note.id}`).order("sort"),
      supabase.from("note_addenda").select("*").eq("note_id", note.id).order("created_at"),
      supabase.from("note_files").select("*").eq("note_id", note.id).order("created_at"),
    ]);
    const rows = (data as EventTask[]) ?? [];
    setItems(rows);
    setAddenda((adds as NoteAddendum[]) ?? []);
    setFiles((fls as NoteFile[]) ?? []);
    setCounts(await commentCounts("event_task_id", rows.map((r) => r.id)));
    setNoteCmts((await commentCounts("meeting_note_id", [note.id]))[note.id] ?? 0);
  }, [note.id]);
  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);
  useRealtimeTable([{ table: "event_tasks", filter: `meeting_note_id=eq.${note.id}` }, { table: "note_addenda", filter: `note_id=eq.${note.id}` }, "comments"], load, { enabled: open });

  const staffName = (uid: string) => staff.find((s) => s.id === uid)?.display_name?.trim() || (uid === meId ? meName : "Unnamed crew");
  const firstNameOf = (uid: string) => staffName(uid).split(" ")[0];
  const authorName = note.created_by ? (note.created_by === meId ? "you" : firstNameOf(note.created_by)) : null;

  // A follow-up added here files where the new-note sheet files them (2026-10-04, the form audit):
  // under the note's event or stop when it has one, so it reaches that prep checklist, with the
  // note as its origin (this card reads both) — and it is yours until you hand it on. It was filed
  // on the note alone, assigned to nobody, and so on nobody's My Tasks.
  const add = async () => {
    if (!supabase || !newItem.trim()) return;
    const parent: TaskParent = note.event_id ? { event: note.event_id } : note.stop_id ? { stop: note.stop_id } : { note: note.id };
    const { error } = await createEventTask({ parent, originNoteId: note.id, label: newItem.trim(), kind: "task", section: "Follow-up", sort: items.length, assignee: meId });
    setNewItem("");
    if (error) toast(`Error: ${error}`, "error"); else load();
  };
  // ── 0262 continuation handlers ──
  // "Add to this note" — a new attributed, timestamped addendum row. The original body/summary are
  // never written; there is no update path to an addendum either (append-only by RLS design).
  const saveAdd = async () => {
    if (!supabase || addSaving || (!addDraft.trim() && addFiles.length === 0)) return;
    setAddSaving(true);
    let addendumId: string | null = null;
    if (addDraft.trim()) {
      const { data, error } = await supabase.from("note_addenda")
        .insert({ note_id: note.id, body: addDraft.trim().slice(0, 8000), created_by: meId }).select("id").single();
      if (error) { toast(`Couldn't add — ${error.message}`, "error"); setAddSaving(false); return; }
      addendumId = (data as { id: string } | null)?.id ?? null;
    }
    let filed = 0, fileErr = 0;
    for (const f of addFiles) {
      const up = await uploadToBucket({ bucket: "note-files", file: f, prefix: note.id });
      if ("error" in up) { fileErr++; continue; }
      const { error: fe } = await supabase.from("note_files").insert({
        note_id: note.id, addendum_id: addendumId, path: up.path, name: f.name.slice(0, 160), mime: f.type || null, size_bytes: f.size, created_by: meId });
      if (fe) fileErr++; else filed++;
    }
    setAddSaving(false);
    toast(`Added to the note${filed ? ` · ${filed} file${filed === 1 ? "" : "s"} kept` : ""}${fileErr ? ` · ${fileErr} couldn't upload` : ""}`, fileErr ? "error" : undefined);
    setAddDraft(""); setAddFiles([]); setAdding(false);
    load();
  };
  // Kept files open through short-lived signed URLs — the bucket is private; visibility rides the
  // note_files RLS (you can only list what you can read), the link itself expires in 10 minutes.
  const openFile = async (f: NoteFile) => {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("note-files").createSignedUrl(f.path, 600);
    if (error || !data?.signedUrl) { toast("Couldn't open the file — try again", "error"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const removeFile = async (f: NoteFile) => {
    if (!supabase) return;
    if (!(await confirm({ title: `Remove “${f.name}” from this note?`, confirmLabel: "Remove", danger: true }))) return;
    const { error } = await supabase.from("note_files").delete().eq("id", f.id);
    if (error) { toast(`Couldn't remove — ${error.message}`, "error"); return; }
    await supabase.storage.from("note-files").remove([f.path]);   // best-effort; the row is the gate
    toast("File removed"); load();
  };
  // ⚖ Log a decision (0263 exec-rhythm P2) — a strategic call made IN this note lands in the
  // append-only ledger with provenance (note_id) and, optionally, the follow-through task it
  // spawns — filed on this very note, so "what happened next" is answerable forever.
  const [logging, setLogging] = useState(false);
  const [dec, setDec] = useState({ key: "", decision: "", why: "", fu: "" });
  const saveDecision = async () => {
    if (!supabase || !dec.decision.trim()) return;
    let follow_up_task_id: string | null = null;
    if (dec.fu.trim()) {
      // The follow-through is the decision-maker's until they hand it on — unassigned, it reached nobody.
      const { id } = await createEventTask({ parent: { note: note.id }, label: dec.fu.trim(), kind: "task", section: "Follow-up", sort: 999, assignee: meId });
      follow_up_task_id = id ?? null;
    }
    const { error } = await supabase.from("strategy_decisions").insert({
      key: dec.key.trim().slice(0, 60) || note.title.slice(0, 60), decision: dec.decision.trim(), why: dec.why.trim() || null,
      author_id: meId, author_name: profile?.display_name ?? null, note_id: note.id, follow_up_task_id,
    });
    if (error) { toast(`Couldn't log — ${error.message}`, "error"); return; }
    toast("Logged — the record stands");
    setDec({ key: "", decision: "", why: "", fu: "" }); setLogging(false); load();
  };

  // ✦ Refresh recap — recompute the summary from the ENTIRE immutable record (original body +
  // every addendum). Derived content only: sources are never touched, and the change log ignores
  // summary churn on purpose (0262).
  const refresh = async () => {
    if (!supabase || refreshing) return;
    const src = [note.body || note.summary || "", ...addenda.map((a) => `Addition (${fmtNoteDate(a.created_at.slice(0, 10))}):\n${a.body}`)].filter(Boolean).join("\n\n");
    if (!src.trim()) return;
    setRefreshing(true);
    try {
      const r = await authedFetch("/api/agents/summarize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: src.slice(0, 14000) }) });
      const j = await r.json();
      if (j.ok && j.summary) {
        const { error } = await supabase.from("meeting_notes").update({ summary: j.summary }).eq("id", note.id);
        if (error) toast(`Couldn't save the recap — ${error.message}`, "error");
        else { onSummary?.(j.summary); toast("Recap refreshed — additions folded in"); }
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
    } catch { toast("Couldn't reach the summarizer", "error"); }
    setRefreshing(false);
  };
  // Agent #1 — let Claude pull the follow-ups out of the recap, proposed for review.
  // Propose how to COMPLETE a follow-up (surfacing answers we already have). Persists on the task.
  // silent=true in the batch auto-propose loop (so one outage doesn't spew toasts); a direct tap surfaces it.
  const resolve = useCallback(async (t: EventTask, silent = false) => {
    if (!supabase || t.ai_proposal || resolving.has(t.id)) return;
    setResolving((s) => new Set(s).add(t.id));
    try {
      const r = await authedFetch("/api/agents/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id: t.id }) });
      const j = await r.json();
      if (j.ok) setItems((p) => p.map((x) => (x.id === t.id ? { ...x, ai_proposal: j.proposal, ai_has_answer: j.have_answer } : x)));
      else if (!silent) toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : "Couldn't propose a completion — try again", "error");
    } catch { if (!silent) toast("Couldn't reach the resolve agent — try again", "error"); }
    setResolving((s) => { const n = new Set(s); n.delete(t.id); return n; });
  }, [resolving, toast]);

  const suggest = async () => {
    if (!supabase || suggesting) return;
    setSuggesting(true);
    try {
      const r = await authedFetch("/api/agents/recap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note_id: note.id }) });
      const j = await r.json();
      if (!j.ok) toast(j.error === "AI not configured (set ANTHROPIC_API_KEY)" ? "AI isn't switched on yet — add the API key" : `Error: ${j.error ?? r.status}`, "error");
      else {
        toast(j.added ? `Added ${j.added} follow-up${j.added === 1 ? "" : "s"} — proposing how to finish each…` : "No new action items found");
        await load();
        // Auto-propose a completion for the freshly generated items.
        const { data: fresh } = await supabase.from("event_tasks").select("*").eq("meeting_note_id", note.id).is("ai_proposal", null).order("sort", { ascending: false }).limit(8);
        for (const t of (fresh as EventTask[] ?? [])) await resolve(t, true);
      }
    } catch { toast("Couldn't reach the recap agent", "error"); }
    setSuggesting(false);
  };
  const toggle = async (t: EventTask) => {
    if (!supabase) return;
    const next = !t.done;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("event_tasks").update({ done: next, done_by: next ? user?.id ?? null : null, done_at: next ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(`Error: ${error.message}`, "error"); load(); return; }
    toast(next ? `Assigned to ${firstNameOf(next)}` : "Unassigned");
    if (next) {
      // Staff-wide alerts (0157): every assignee gets the flag; the trigger delivers the push.
      if (next !== user?.id) {
        raiseAlert({
          severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
          title: `${profile?.display_name?.split(" ")[0] || "A manager"} assigned you: ${t.label}`,
          body: `Follow-up · ${note.title}`, target_user_id: next, created_by: user?.id ?? null,
        });
      }
    }
  };
  // Promote a follow-up to a can't-miss alert (the "flag this" the talking-point becomes urgent).
  const flag = async (t: EventTask) => {
    await raiseAlert({
      severity: "critical", category: "task", kind: "task_assigned", subject_id: t.id,
      title: `Flagged: ${t.label}`, body: `From meeting · ${note.title}`,
      target_user_id: t.assignee ?? null, created_by: user?.id ?? null,
    });
    toast("Flagged — sent to alerts");
  };
  const removeItem = async (t: EventTask) => {
    if (!supabase) return;
    const before = items;
    setItems((p) => p.filter((x) => x.id !== t.id));
    // event_tasks DELETE is admin-only (0025). This used to drop the row from the screen and throw
    // the error away, so a non-admin watched the item vanish and then reappear on the next load —
    // the optimistic update was the only thing that had happened. Put it back and say so instead.
    const { error } = await deleteTask("event", t.id);
    if (error) { setItems(before); toast(`Couldn't remove that — ${error}`, "error"); }
  };

  const openCount = items.filter((i) => !i.done).length;
  return (
    <div className={`note-card${open ? " open" : ""}`}>
      <button type="button" className="note-head" onClick={onToggle} aria-expanded={open}>
        <div className="note-head-main">
          <span className="note-title">{note.title}{note.source === "email" && <span className="note-src">email</span>}{note.source === "review" && <span className="note-src rite">weekly review</span>}{note.source === "strategy" && <span className="note-src rite">strategy session</span>}</span>
          <span className="note-meta">{fmtNoteDate(note.met_on)}{authorName ? ` · ${authorName}` : ""}{eventTitle ? <> · {eventTitle}</> : ""}{note.visibility === "private" ? <> · <Icon name="lock" /> private</> : note.visibility === "team" ? <> · <Icon name="team" /> team</> : ""}{items.length ? ` · ${openCount}/${items.length} follow-ups` : ""}</span>
        </div>
        <span className={`note-chev${open ? " open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="note-body">
          {(note.created_by === meId || isAdmin) && (
            renaming ? (
              <div className="note-rename">
                <input className="note-in" value={titleDraft} autoFocus maxLength={120} aria-label="Note name"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setRenaming(false); setTitleDraft(note.title); } }} />
                <button type="button" className="note-save" onClick={saveTitle} disabled={!titleDraft.trim()}>Save</button>
                <button type="button" className="note-arch" onClick={() => { setRenaming(false); setTitleDraft(note.title); }}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="note-renamelink" onClick={() => { setTitleDraft(note.title); setRenaming(true); }}>✎ Rename this note</button>
            )
          )}
          {(note.created_by === meId || isAdmin) && (
            <div className="note-vis-row">
              <span>Who sees this</span>
              <select className="note-in note-vis" value={note.visibility ?? "collab"} onChange={async (e) => {
                if (!supabase) return;
                const v = e.target.value as "private" | "team" | "collab";
                const { error } = await supabase.from("meeting_notes").update({ visibility: v }).eq("id", note.id);
                toast(error ? `Couldn't change — ${error.message}` : v === "private" ? "Now just for you" : v === "team" ? "Team can read it now" : "Team can read & comment now", error ? "error" : undefined);
                if (!error) onVisibility?.(v);
              }} aria-label="Who can see this note">
                <option value="private">🔒 Just me</option>
                <option value="team">👥 Team — everyone reads</option>
                <option value="collab">🤝 Team + comments</option>
              </select>
            </div>
          )}
          {note.summary && <Prose text={note.summary} className="pr-doc note-summary" />}
          {note.body && <details className="note-full"><summary>Full notes</summary><p>{note.body}</p></details>}
          {/* 0262 — the continuation record: additions render as attributed, timestamped blocks
              UNDER the original (which is never edited); kept files open via signed URLs. */}
          {addenda.map((a) => (
            <div key={a.id} className="note-addm">
              <div className="note-addm-h">
                <span>Added {fmtNoteDate(a.created_at.slice(0, 10))}{a.created_by ? ` · ${a.created_by === meId ? "you" : firstNameOf(a.created_by)}` : ""}</span>
                {(a.created_by === meId || isAdmin) && <button type="button" className="note-addm-x" onClick={async () => {
                  if (!supabase) return;
                  if (!(await confirm({ title: "Remove this addition?", body: "Files it brought stay on the note.", confirmLabel: "Remove", danger: true }))) return;
                  const { error } = await supabase.from("note_addenda").delete().eq("id", a.id);
                  if (error) toast(`Couldn't remove — ${error.message}`, "error"); else { toast("Addition removed"); load(); }
                }} aria-label="Remove this addition"><Icon name="close" /></button>}
              </div>
              <p className="note-addm-b">{a.body}</p>
            </div>
          ))}
          {files.length > 0 && (
            <div className="note-files">
              {files.map((f) => (
                <div key={f.id} className="note-file">
                  <button type="button" className="note-file-open" onClick={() => openFile(f)} title="Open (secure link, 10 min)">
                    <span aria-hidden="true">📎</span> {f.name}{f.size_bytes ? <i>{f.size_bytes > 1048576 ? `${(f.size_bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size_bytes / 1024))} KB`}</i> : null}
                  </button>
                  {(f.created_by === meId || isAdmin) && <button type="button" className="note-addm-x" onClick={() => removeFile(f)} aria-label={`Remove ${f.name}`}><Icon name="close" /></button>}
                </div>
              ))}
            </div>
          )}
          {(note.created_by === meId || isAdmin) && (
            adding ? (
              <div className="note-addbox">
                <textarea className="note-area" placeholder="What's new since — a call, a decision, the next conversation…" value={addDraft}
                  onChange={(e) => setAddDraft(e.target.value)} rows={addDraft.length > 200 ? 8 : 3} autoFocus />
                <NoteAttach onText={(t) => setAddDraft((b) => (b ? b + "\n\n" + t : t))} onFiles={(fs) => setAddFiles((p) => [...p, ...fs].slice(0, 8))} />
                {addFiles.length > 0 && (
                  <div className="note-pfiles">
                    {addFiles.map((f, i) => (
                      <span key={i} className="note-pfile">📎 {f.name}<button type="button" onClick={() => setAddFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Icon name="close" /></button></span>
                    ))}
                    <span className="note-pfiles-hint">kept on the note</span>
                  </div>
                )}
                <div className="note-addbox-r">
                  <button type="button" className="note-arch" onClick={() => { setAdding(false); setAddDraft(""); setAddFiles([]); }}>Cancel</button>
                  <button type="button" className="note-save" onClick={saveAdd} disabled={addSaving || (!addDraft.trim() && addFiles.length === 0)}>{addSaving ? "Adding…" : "Add to note"}</button>
                </div>
              </div>
            ) : (
              <div className="note-cont-row">
                <button type="button" className="note-renamelink" onClick={() => setAdding(true)}>＋ Add to this note</button>
                {addenda.length > 0 && (note.body || note.summary) && (
                  <button type="button" className="note-renamelink" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : <><Icon name="sparkles" /> Refresh recap</>}</button>
                )}
              </div>
            )
          )}
          {(note.visibility === "collab" || note.created_by === meId) && (
            <>
              <button type="button" className="note-discuss" onClick={() => setNoteThread((v) => !v)} aria-expanded={noteThread}>
                <Icon name="chat" /> Discuss this note{noteCmts ? <span className="cmt-count">{noteCmts}</span> : null}
              </button>
              {noteThread && (
                <CommentThread subject={{ col: "meeting_note_id", id: note.id }} notifyIds={[note.created_by]} label={note.title} meId={meId} meName={meName} />
              )}
            </>
          )}
          {isAdmin && (
            logging ? (
              <div className="note-decbox">
                <div className="note-decbox-h">⚖ Log a decision — append-only, it can never be edited or deleted</div>
                <input className="note-in" placeholder={`What it concerns (blank = "${note.title.slice(0, 36)}${note.title.length > 36 ? "…" : ""}")`} value={dec.key} onChange={(e) => setDec({ ...dec, key: e.target.value })} maxLength={60} />
                <input className="note-in" placeholder="The decision, one sentence" value={dec.decision} onChange={(e) => setDec({ ...dec, decision: e.target.value })} />
                <input className="note-in" placeholder="Why (optional — future-you will ask)" value={dec.why} onChange={(e) => setDec({ ...dec, why: e.target.value })} />
                <input className="note-in" placeholder="Follow-up task (optional — files on this note)" value={dec.fu} onChange={(e) => setDec({ ...dec, fu: e.target.value })} />
                <div className="note-addbox-r">
                  <button type="button" className="note-arch" onClick={() => { setLogging(false); setDec({ key: "", decision: "", why: "", fu: "" }); }}>Cancel</button>
                  <button type="button" className="note-save" onClick={saveDecision} disabled={!dec.decision.trim()}>Log it</button>
                </div>
              </div>
            ) : (
              <button type="button" className="note-renamelink" onClick={() => setLogging(true)}>⚖ Log a decision</button>
            )
          )}
          <OpsPlan noteId={note.id} />
          <div className="note-fu-h">Follow-ups
            <button type="button" className="note-suggest" onClick={suggest} disabled={suggesting}>{suggesting ? "Reading…" : <><Icon name="sparkles" /> Suggest</>}</button>
          </div>
          {items.map((t) => (
            <div key={t.id} className="note-fu-wrap">
              <div className={`note-fu${t.done ? " done" : ""}`}>
                <button type="button" className="task-check" onClick={() => toggle(t)} aria-label={`Mark done: ${t.label}`}>
                  <span className="task-box">{t.done && <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-11" /></svg>}</span>
                </button>
                <span className="note-fu-label">{t.label}</span>
                <button type="button" className="note-fu-assign" onClick={() => setAssignFor(t)}>{t.assignee ? firstNameOf(t.assignee) : "Assign"}</button>
                <button type="button" className="note-fu-flag" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label="Discuss" title="Discuss"><Icon name="chat" />{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : null}</button>
                <button type="button" className="note-fu-flag" onClick={() => flag(t)} aria-label="Flag as can't-miss" title="Flag as can't-miss">⚑</button>
                {!t.ai_proposal && <button type="button" className="note-fu-solve" onClick={() => resolve(t)} disabled={resolving.has(t.id)} title="Propose how to complete this">{resolving.has(t.id) ? "…" : "💡"}</button>}
                {isAdmin && <button type="button" className="note-fu-flag" onClick={() => openTask(t.id, "event")} aria-label="Edit follow-up" title="Edit follow-up">✎</button>}
                {isAdmin && <button type="button" className="note-fu-x hit-44" onClick={() => removeItem(t)} aria-label="Remove follow-up"><Icon name="close" /></button>}
              </div>
              {t.ai_proposal && (
                <div className={`fu-prop${t.ai_has_answer ? " has" : ""}`}>
                  <div className="fu-prop-h">{t.ai_has_answer ? <><Icon name="check" /> We already have this</> : "💡 Proposed"}</div>
                  {/* Model prose, so it goes through the one reader — it was printing its own
                      asterisks here exactly the way Ask GT3 used to. */}
                  <Prose text={t.ai_proposal} className="fu-prop-b" />
                </div>
              )}
              {openThread === t.id && (
                <CommentThread subject={{ col: "event_task_id", id: t.id }} notifyIds={[t.assignee, note.created_by]} label={t.label} meId={meId} meName={meName} />
              )}
            </div>
          ))}
          <div className="note-fu-add">
            <input className="note-in" placeholder="Add a follow-up…" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <button type="button" className="note-fu-addbtn" onClick={add} disabled={!newItem.trim()}>Add</button>
          </div>
          <div className="note-foot">
            <button type="button" className="note-arch" onClick={onArchive}>{note.archived_at ? "Restore" : "Archive"}</button>
            {isAdmin && <button type="button" className="note-del" onClick={onDelete}>Delete note</button>}
          </div>
        </div>
      )}
      {assignFor && (
        <AssignSheet task={assignFor} staff={staff} crewIds={[]} meId={meId} meName={meName}
          onPick={(uid) => assign(assignFor, uid)} onClose={() => setAssignFor(null)} />
      )}
    </div>
  );
}

// ───────────────────────── booking requests ─────────────────────────
// Inbound requests land here; promoting one opens a pursuit on the Pipeline board below. The
// "Won on the pipeline" mirror this used to render (the July bridge) died in the 2026-07-30
// redundancy audit: Bookings and PipelinePanel now share ONE screen, so the mirror showed every
// won private-event deal twice, one card above the other — and its "Open in Pipeline" button was
// a no-op (you were already there). PipelinePanel's Won stage is the one home.
function Bookings() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { user } = useAuth();
  const [reqs, setReqs] = useState<BookingRequest[]>([]);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteResolve, setPromoteResolve] = useState<{ req: BookingRequest; name: string; candidates: VendorMatch[] } | null>(null);
  const bookingsState = useAsyncData<{ reqs: BookingRequest[] }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data: reqData } = await supabase.from("booking_requests").select("*").order("created_at", { ascending: false });
    return { reqs: (reqData as BookingRequest[]) ?? [] };
  }, []);
  const load = bookingsState.reload;
  // reqs stays the editable/optimistic local copy — del() below removes a row instantly, before
  // the round-trip — reseeded from the fetch on every load/reload.
  useEffect(() => { if (bookingsState.data) setReqs(bookingsState.data.reqs); }, [bookingsState.data]);
  useRealtimeTable(["booking_requests"], load);

  const setStatus = async (id: string, status: BookingRequest["status"]) => {
    const { error } = await supabase!.from("booking_requests").update({ status }).eq("id", id);
    toast(error ? `Error: ${error.message}` : `Marked ${status}`, error ? "error" : undefined);
    if (!error) load();
  };
  // One tap: the request becomes a lead on the calendar/prep/economics rails — no retyping.
  const makeEvent = async (r: BookingRequest) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(r.event_date ?? "") ? r.event_date : null;
    const day_label = day ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${day}T12:00:00`).getDay()] : (r.event_date ?? null);
    const { error } = await supabase!.from("events").insert({
      title: r.name ? `${r.name} booking` : "Booking", stage: "lead", day, day_label,
      location_text: r.location_text ?? null, blurb: r.notes?.slice(0, 300) ?? null,
    });
    if (error) { toast(`Couldn't create the event — ${error.message}`, "error"); return; }
    toast("Added to Events as a lead — it's on the calendar now");
    if (r.status === "new") setStatus(r.id, "contacted");
  };
  // The bridge, outbound direction: one tap turns a request into a pursuit on the pipeline —
  // account from the requester (reused if we already know them), stage "warm" (they opened the
  // conversation), and the request context as the first pursuit-trail entry. The request itself
  // stays here, linked, so the button can't double-promote.
  //
  // It said "talking" until 2026-10-04 — a stage 0265 retired in August (its own map: talking →
  // warm), so every promote since made the account and then failed on opportunities_stage_check.
  // scripts/vocab.audit.mjs found it, and now holds every literal this app writes to a checked
  // column to the migration that checks it.
  const promote = async (r: BookingRequest, decision?: ResolveDecision) => {
    if (!supabase || !user || promoting) return;
    setPromoting(r.id);
    try {
      const nm = r.name?.trim() || r.email?.trim() || "Booking request";
      // Known-contact pre-check first (email beats name), then the ONE resolver (0226): a
      // look-alike name surfaces the confirm sheet instead of silently minting an account copy.
      let vendorId: string | undefined;
      if (r.email) {
        const { data: byEmail } = await supabase.from("vendors").select("id").eq("poc_email", r.email).limit(1);
        vendorId = byEmail?.[0]?.id;
      }
      if (!vendorId) {
        const res = await resolveVendor(nm, {
          status: "approved", vendorType: "venue", source: "a booking request", decision,
          extra: { poc_name: r.name, poc_email: r.email, poc_phone: r.phone, location_text: r.location_text ?? null },
        });
        if (res.kind === "similar") { setPromoteResolve({ req: r, name: nm, candidates: res.candidates }); return; }
        if (res.kind === "error") { toast(`Couldn't create the account — ${res.message}`, "error"); return; }
        vendorId = res.id;
      }
      const { data: opp, error: oppErr } = await supabase.from("opportunities").insert({
        vendor_id: vendorId, stage: "warm", source: "inbound",
        next_step: "Reply to their request", created_by: user.id,
      }).select("id").single();
      if (oppErr) { toast(`Couldn't open the opportunity — ${oppErr.message}`, "error"); return; }
      const oppId = (opp as { id: string }).id;
      const when = [r.event_date, r.headcount ? `${r.headcount} ppl` : null, r.location_text].filter(Boolean).join(" · ");
      const who = [r.name, r.email, r.phone].filter(Boolean).join(" · ");
      const ctx = [
        "Inbound booking request — promoted from Business › Pipeline.",
        when && `Event: ${when}`,
        who && `Contact: ${who}`,
        r.notes?.trim() && `Notes: ${r.notes.trim().slice(0, 400)}`,
      ].filter(Boolean).join("\n");
      const { error: cErr } = await supabase.from("comments").insert({ strategy_key: `opp:${oppId}`, body: ctx, author_id: user.id });
      if (cErr) toast(`Opportunity's up, but the context note didn't save — ${cErr.message}`, "error");
      const { error: linkErr } = await supabase.from("booking_requests")
        .update({ opportunity_id: oppId, ...(r.status === "new" ? { status: "contacted" } : {}) }).eq("id", r.id);
      if (linkErr) toast(`Opportunity's up, but the request didn't link — ${linkErr.message}`, "error");
      else toast("Promoted — the pursuit lives in Business › Pipeline now");
      load();
    } finally { setPromoting(null); }
  };
  const del = async (r: BookingRequest) => {
    if (!(await confirm({ title: `Delete the booking request from ${r.name ?? "this contact"}?`, body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
    setReqs((p) => p.filter((x) => x.id !== r.id)); // optimistic
    const { error } = await supabase!.from("booking_requests").delete().eq("id", r.id);
    if (error) { toast(`Couldn't delete — ${error.message}`, "error"); load(); } else toast("Booking request deleted");
  };

  const open = reqs.filter((r) => r.status === "new").length;
  return (
    <div className="adm-sec">
      <AsyncSection
        state={bookingsState}
        isEmpty={() => false}
        emptyTitle="No booking requests yet"
        loadingLabel="Loading booking requests…"
        errorTitle="Couldn't load booking requests"
      >
        {() => (
          <>
      <SectionHeader label="Inbox · booking requests" annotation="each one becomes an event, a pipeline account, or a decline" right={open > 0 ? <span className="k-count">{open} new</span> : undefined} />
      {reqs.map((r) => (
        <div className={`adm-req${r.status === "new" ? " new" : ""}`} key={r.id}>
          <div className="adm-member-top">
            <b>{r.name ?? "—"}{r.event_date && <span className="k-count ml-2" title={`Requested event date: ${r.event_date}`}>Event {relativeDay(r.event_date)}</span>}</b>
            <span className="adm-ref">{[r.headcount ? `${r.headcount} ppl` : null, `submitted ${relativeDay(r.created_at)}`].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="meta">
            {r.email && <><a href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? " · " : ""}</>}{r.phone}
            {r.location_text && <> · {r.location_text}</>}
            {r.notes && <><br />{r.notes}</>}
          </div>
          {/* Decision anatomy (2026-08-01 audit): the status ladder and the forward doors were seven
              identically-dressed mysteries on one row. Two LABELED groups now — "Status" (choose a
              state) and "Turn it into" (go somewhere) — with delete as a quiet text action, not a
              floating red circle that read as close-this-card. */}
          <div className="adm-status">
            <span className="adm-ctl-k">Status</span>
            {STATUSES.map((s) => (
              <button key={s} className={r.status === s ? "on" : ""} onClick={() => setStatus(r.id, s)}>{s}</button>
            ))}
          </div>
          <div className="adm-status adm-doors">
            <span className="adm-ctl-k">Turn it into</span>
            <button className="adm-req-mk" onClick={() => makeEvent(r)}><Icon name="arrowRight" /> An event</button>
            {r.opportunity_id ? (
              <button className="adm-req-mk linked" onClick={() => document.getElementById("pipeline-board")?.scrollIntoView({ behavior: "smooth", block: "start" })}>On the pipeline <Icon name="arrowRight" /></button>
            ) : (
              <button className="adm-req-mk" onClick={() => promote(r)} disabled={promoting === r.id}>{promoting === r.id ? "Promoting…" : <><Icon name="arrowRight" /> A pipeline account</>}</button>
            )}
            <button className="adm-req-quietdel" onClick={() => del(r)} aria-label={`Delete booking request from ${r.name ?? "contact"}`}>Delete</button>
          </div>
        </div>
      ))}
      {reqs.length === 0 && <EmptyState title="No requests yet" sub="They land here from the Book the bar form." />}
          </>
        )}
      </AsyncSection>
      {/* Chief of Sales moved to the leads tab's bottom Tools zone (2026-08-01 audit) — a monthly
          planning tool no longer interrupts between the inbox and the pipeline. */}
      {promoteResolve && (
        <VendorResolve name={promoteResolve.name} candidates={promoteResolve.candidates}
          onUse={(c) => { const { req } = promoteResolve; setPromoteResolve(null); promote(req, { linkTo: c.id }); }}
          onAddLocation={async (c) => {
            const { req, name } = promoteResolve; setPromoteResolve(null);
            await addVendorLocation(c.id, { label: name, location_text: req.location_text ?? null });
            promote(req, { linkTo: c.id });
          }}
          onCreateDistinct={() => { const { req } = promoteResolve; setPromoteResolve(null); promote(req, { createDistinct: true }); }}
          onClose={() => setPromoteResolve(null)}
        />
      )}
    </div>
  );
}

// ───────────────────────── reserves (limited drops) ─────────────────────────
function ReservesAdmin() {
  const confirm = useConfirm();
  const { toast } = useApp();
  // Which card is correcting Left by hand (lib/reserveStock.setLeft) — Stock is the usual box.
  const [fixingLeft, setFixingLeft] = useState<string | null>(null);
  const reservesState = useAsyncData<Reserve[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // A failed read is not "No reserves yet" — it was, until the error was read.
    const { data, error } = await supabase.from("reserves").select("*").order("sort");
    if (error) throw new Error(error.message);
    return (data as Reserve[]) ?? [];
  }, []);
  const load = reservesState.reload;

  // STOCK AND LEFT MOVE TOGETHER (lib/reserveStock). The write is matched on the two numbers it was
  // worked out from: a member claiming in between makes it miss, and it is worked out again from the
  // row as it now stands — never written over a claim. Returns whether it landed.
  const writeStock = async (r: Reserve, plan: (cur: Reserve) => StockChange, said: (c: StockChange & { ok: true }) => string): Promise<boolean> => {
    if (!supabase) return false;
    let cur = r;
    for (let i = 0; i < 3; i++) {
      const c = plan(cur);
      if (!c.ok) { toast(c.reason, "error"); return false; }
      const { data, error } = await supabase.from("reserves").update(c.patch)
        .eq("id", cur.id).eq("stock_total", cur.stock_total).eq("stock_remaining", cur.stock_remaining).select("id");
      if (error) { toast(`Couldn't update — ${error.message}`, "error"); load(); return false; }
      if (data && data.length) { toast(said(c)); load(); return true; }
      const { data: fresh, error: again } = await supabase.from("reserves").select("*").eq("id", cur.id).maybeSingle();
      if (again || !fresh) { toast(`Couldn't update — ${again?.message ?? "that reserve is gone"}`, "error"); load(); return false; }
      cur = fresh as Reserve;
    }
    toast("Claims kept landing while this saved — nothing changed. Try again.", "error");
    load();
    return false;
  };

  const update = async (id: string, patch: Partial<Reserve>) => {
    const { error } = await supabase!.from("reserves").update(patch).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Reserve updated", error ? "error" : undefined);
    if (!error) load();
  };
  const add = async () => {
    const { error } = await supabase!.from("reserves").insert({
      name: "", price_cents: 1200, stock_total: 12, stock_remaining: 12, status: "draft", sort: reservesState.data?.length ?? 0,
    });
    toast(error ? `Error: ${error.message}` : "Reserve created — set details, then set it Live", error ? "error" : undefined);
    if (!error) load();
  };
  const archive = async (id: string) => {
    if (!(await confirm({ title: "Archive this reserve?", body: "It disappears from the app.", confirmLabel: "Archive" }))) return;
    await update(id, { status: "archived" });
  };
  const remove = async (id: string, nm: string) => {
    if (!(await confirm({ title: `Delete “${nm}” for good?`, body: "This permanently removes the reserve and any claims on it. It can't be undone. Archive instead if you just want it hidden.", confirmLabel: "Delete for good", cancelLabel: "Keep it", danger: true }))) return;
    const { error } = await supabase!.from("reserves").delete().eq("id", id);
    toast(error ? `Couldn't delete — ${error.message}` : "Reserve deleted", error ? "error" : undefined);
    if (!error) load();
  };

  return (
    <div className="adm-sec">
      <SectionHeader label="Reserves" right={<button type="button" className="btn-sec" onClick={add}>+ Add</button>} />
      <AsyncSection
        state={reservesState}
        isEmpty={(rows) => rows.filter((r) => r.status !== "archived").length === 0}
        emptyTitle="No reserves yet"
        emptySub="Add a limited drop to sell to members."
        loadingLabel="Loading reserves…"
        errorTitle="Couldn't load reserves"
      >
        {(rows) => {
          const active = rows.filter((r) => r.status !== "archived");
          return (
            <>
              {active.map((r) => (
                <div className="adm-member" key={r.id}>
                  <div className="adm-member-top">
                    <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px" }} maxLength={120} defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
                  </div>
                  <input className="auth-input" style={{ fontSize: 16, padding: "9px 11px", marginTop: 6 }} maxLength={300} defaultValue={r.blurb ?? ""} placeholder="One line guests see" onBlur={(e) => (e.target.value.trim() || null) !== r.blurb && update(r.id, { blurb: e.target.value.trim() || null })} />
                  <div className="adm-fields">
                    <label>Price $<input type="text" inputMode="decimal" defaultValue={moneyPlain(r.price_cents)} onBlur={(e) => update(r.id, { price_cents: Math.max(0, Math.round(parseFloat(e.target.value || "0") * 100)) })} /></label>
                    <label>Stock<input type="number" min={goneOf(r)} defaultValue={r.stock_total} key={`st-${r.stock_total}`} onBlur={async (e) => {
                      const el = e.currentTarget;
                      const n = Number(el.value);
                      if (el.value.trim() === "" || n === r.stock_total) { el.value = String(r.stock_total); return; }
                      const landed = await writeStock(r, (cur) => planStock(cur, n), (c) => `Stock ${c.patch.stock_total} · ${c.patch.stock_remaining} left${c.gone ? ` · ${c.gone} claimed or held` : ""}`);
                      if (!landed) el.value = String(r.stock_total);
                    }} /></label>
                    {fixingLeft === r.id ? (
                      <label>Left<input type="number" min={0} max={r.stock_total} defaultValue={r.stock_remaining} autoFocus onBlur={async (e) => {
                        const el = e.currentTarget;
                        const n = Number(el.value);
                        if (el.value.trim() !== "" && n !== r.stock_remaining) await writeStock(r, (cur) => planLeft(cur, n), (c) => `${c.patch.stock_remaining} left of ${c.patch.stock_total}`);
                        setFixingLeft(null);
                      }} /></label>
                    ) : (
                      <span className="adm-left">
                        {`${r.stock_remaining} left${goneOf(r) ? ` · ${goneOf(r)} claimed or held` : ""}`}
                        <button type="button" className="btn-ter" onClick={() => setFixingLeft(r.id)}>Correct</button>
                      </span>
                    )}
                    <label>Limit<input type="number" min={1} defaultValue={r.per_member_limit} onBlur={(e) => update(r.id, { per_member_limit: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
                  </div>
                  <div className="adm-fields">
                    <label>Status
                      <select defaultValue={r.status} onChange={(e) => update(r.id, { status: e.target.value as Reserve["status"] })}>
                        <option value="draft">Draft (hidden)</option>
                        <option value="live">Live</option>
                        <option value="sold_out">Sold out</option>
                      </select>
                    </label>
                    <label className="adm-check"><input type="checkbox" defaultChecked={r.member_only} onChange={(e) => update(r.id, { member_only: e.target.checked })} />Members</label>
                    <button type="button" className="btn-ter" onClick={() => archive(r.id)}>Archive</button>
                    <button type="button" className="btn-ter" style={{ color: "#e07a76" }} onClick={() => remove(r.id, r.name)}>Delete</button>
                  </div>
                </div>
              ))}
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}

// ───────────────────────── subscribers (read-only mirror) ─────────────────────────
function Subscribers() {
  const [names, setNames] = useState<Record<string, string>>({});
  const subsState = useAsyncData<Subscription[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    const rows = (data as Subscription[]) ?? [];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    if (ids.length) {
      const { data: p } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      const m: Record<string, string> = {};
      (p as { id: string; display_name: string | null }[] | null)?.forEach((x) => { m[x.id] = x.display_name ?? "—"; });
      setNames(m);
    }
    return rows;
  }, []);
  useRealtimeTable("subscriptions", subsState.reload);

  // Fulfillment-first ordering: trouble (past_due) and soonest-due float to the top so
  // an admin sees "who do I prep next / who needs a nudge" at a glance.
  const rank: Record<string, number> = { past_due: 0, active: 1, pending: 2, paused: 3, canceled: 4 };
  const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null);
  const packOf = (plan: string) => { const n = plan?.match(/\d+/)?.[0]; return n ? `${n} bottles · every 2 wks` : plan; };
  const renew = (s: Subscription) => {
    if (s.status === "past_due") return { text: "Payment failed — card needs updating", cls: "due" };
    const n = daysTo(s.current_period_end);
    if (n == null) return { text: packOf(s.plan), cls: "" };
    const when = n < 0 ? `overdue ${-n}d` : n === 0 ? "due today" : `fulfill in ${n}d`;
    return { text: `${packOf(s.plan)} · ${when}`, cls: n <= 0 ? "due" : n <= 3 ? "soon" : "" };
  };
  return (
    <AsyncSection
      state={subsState}
      isEmpty={(subs) => subs.length === 0}
      emptyTitle="No subscribers yet"
      emptySub="Members subscribe from their 3MPIRE."
      loadingLabel="Loading subscribers…"
      errorTitle="Couldn't load subscribers"
    >
      {(subs) => {
        const ordered = [...subs].sort(
          (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || ((a.current_period_end ?? "9") < (b.current_period_end ?? "9") ? -1 : 1)
        );
        const active = subs.filter((s) => s.status === "active");
        const dueSoon = active.filter((s) => { const n = daysTo(s.current_period_end); return n != null && n <= 3; }).length;
        return (
          <div className="adm-sec">
            <SectionHeader label="Subscribers" right={<>
              {active.length > 0 && <span className="k-count">{active.length} active</span>}
              {dueSoon > 0 && <span className="k-count due">{dueSoon} due soon</span>}
            </>} />
            <div className="k-rows">
              {ordered.map((s) => {
                const r = renew(s);
                return (
                  <InfoRow
                    key={s.id}
                    name={<RecordLink kind="person" id={s.user_id}>{names[s.user_id] ?? "Member"}</RecordLink>}
                    nameExtra={<span className={`adm-substat ${s.status}`}>{s.status.replace("_", " ")}</span>}
                    meta={<span className={`sub-renew ${r.cls}`}>{r.text}</span>}
                  />
                );
              })}
            </div>
          </div>
        );
      }}
    </AsyncSection>
  );
}

// ───────────────────────── member management ─────────────────────────
// The full role set lives in profiles.role (migration 0031). roleOf() COLLAPSES it
// (operator/event_manager/contractor → member), so the team console never uses it — it reads
// the RAW role via toRole() and adds the one thing lib/roles cannot know: which sections of THIS
// console each role unlocks (kept in lockstep with OperatorNav's scope so "what can they see" is
// never a guess), plus the tone its chip is drawn in.
//
// The label and the tier used to be columns of this same map. They are not local facts — the org
// chart, the invite form and the offer letter each named the same seven roles independently, and
// two of them had already drifted on "Event Manager"/"Event manager". Both now come from
// lib/roles: roleLabel() names a role, tierOf() derives lead/crew/member from LEADERSHIP_ROLES and
// STAFF_ROLES rather than restating a partition those lists already decide.
type RoleKey = Role;
const ROLE_META: Record<RoleKey, { scope: string; tone: string }> = {
  owner:         { scope: "Full access — every section",    tone: "red" },
  admin:         { scope: "Full access — every section",    tone: "red" },
  event_manager: { scope: "Everything but Money & Team",    tone: "gold" },
  operator:      { scope: "Service · Prep · Brew · Assets · Pipeline · Notes · Drive", tone: "cream" },
  contractor:    { scope: "Service · Prep · Assets · Notes · Drive", tone: "cream" },
  server:        { scope: "My Day · Live Ops · Notes · Drive", tone: "cream" },
  member:        { scope: "Customer — loyalty only",        tone: "muted" },
};
const TIERS: { key: Tier; title: string; hint: string }[] = [
  { key: "lead", title: "Leadership", hint: "Run the business" },
  { key: "crew", title: "Crew", hint: "Work the shifts" },
];
const rawRole = (m: { role?: string | null }): RoleKey => toRole(m.role);
const initials = (name: string | null) =>
  (name ?? "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "·";

function MemberRow({ m, isSelf, ownerCount, onPatch, onSaved }: { m: Profile; isSelf: boolean; ownerCount: number; onPatch: (id: string, role: string) => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const { toast } = useApp();
  const [name, setName] = useState(m.display_name ?? "");
  const role = rawRole(m);
  const meta = ROLE_META[role];
  const [pts, setPts] = useState(m.points);
  const [credit, setCredit] = useState(moneyPlain(m.credit_cents));
  const [founding, setFounding] = useState(m.founding_member);
  const [isDriver, setIsDriver] = useState(!!m.is_driver);
  const toggleDriver = async () => {
    const next = !isDriver; setIsDriver(next);
    const { error } = await supabase!.rpc("admin_set_driver", { member: m.id, val: next });
    if (error) { setIsDriver(!next); toast(`Error: ${error.message}`, "error"); }
    else toast(next ? `${m.display_name ?? "Member"} tagged as driver 🚗` : "Driver tag removed");
  };
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  // Keep the loyalty inputs honest if a realtime reload changes them underneath us.
  useEffect(() => { setPts(m.points); setCredit(moneyPlain(m.credit_cents)); setFounding(m.founding_member); }, [m.points, m.credit_cents, m.founding_member]);
  const dirty = name !== (m.display_name ?? "") || pts !== m.points || credit !== moneyPlain(m.credit_cents) || founding !== m.founding_member;

  const save = async () => {
    setBusy(true);
    if (name !== (m.display_name ?? "")) await supabase!.rpc("admin_set_display_name", { member: m.id, name });
    const { error } = await supabase!.rpc("admin_set_member", {
      member: m.id,
      new_points: pts,
      new_credit_cents: Math.max(0, Math.round(parseFloat(credit || "0") * 100)),
      new_founding: founding,
    });
    setBusy(false);
    toast(error ? `Error: ${error.message}` : `Saved ${m.display_name ?? "member"}`, error ? "error" : undefined);
    if (!error) onSaved();
  };
  const setRole = async (next: string) => {
    if (next === role) return;
    const name = m.display_name ?? "this person";
    // Safety rails: never strand the business without an owner; double-check elevations + demotions.
    if (role === "owner" && next !== "owner" && ownerCount <= 1) { toast("Can't remove the last owner — promote someone else first.", "error"); return; }
    if (isSelf && role === "owner" && next !== "owner") { if (!(await confirm({ title: "Demote yourself from Owner?", body: "You'll lose full access immediately.", confirmLabel: "Demote me", danger: true }))) return; }
    else if (next === "owner" || next === "admin" || role === "owner") { if (!(await confirm({ title: `Set ${name} to ${roleLabel(next)}?`, confirmLabel: "Set role" }))) return; }
    onPatch(m.id, next); // optimistic — reflect the pick instantly
    const { error } = await supabase!.rpc("admin_set_role", { member: m.id, new_role: next });
    if (error) { onPatch(m.id, role); toast(`Error: ${error.message}`, "error"); }
    else { toast(`${m.display_name ?? "Member"} → ${roleLabel(next)}`); onSaved(); }
  };

  return (
    <div className="adm-member tm-row">
      <div className="tm-head">
        <span className={`tm-av tone-${meta.tone}`}>{initials(m.display_name)}</span>
        <div className="tm-id">
          <b>{m.display_name ?? "Unnamed"}{isSelf && <span className="tm-you">you</span>}</b>
          <span className="adm-ref">{m.referral_code || "—"}</span>
        </div>
        {isDriver && <span className="tm-driver" title="Delivery driver"><Icon name="compass" /></span>}
      </div>
      <label className="tm-rolepick">
        <select className="adm-role" value={role} onChange={(e) => setRole(e.target.value)} aria-label={`Role for ${m.display_name ?? "member"}`}>
          {SENIORITY.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
        </select>
        <i className="tm-scope">{meta.scope}</i>
      </label>
      {/* THE DOOR THAT WAS MISSING. Tapping a person here used to open Points and Credit —
          customer fields, on an employee — and everything that actually matters about them lived
          on six other screens. This opens the one place they all meet.
          ONE LINE OF ACTIONS (2026-10-07): the profile and the details were two full-width buttons
          under a role badge that repeated the role pick above them. The badge is gone (the pick
          says the role) and the two doors share a line. */}
      <div className="tm-acts">
        <button type="button" className="tm-act" onClick={() => setProfile(true)}>
          <Icon name="team" /> {(m.display_name ?? "Their").split(" ")[0]}&apos;s profile <span className="ev-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="tm-act" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide details" : `Name, driver & loyalty · ${pts} pts`} <span className={`ev-chev${open ? " open" : ""}`} aria-hidden="true">›</span></button>
      </div>
      {profile && <CrewPerson userId={m.id} onClose={() => setProfile(false)} onChanged={onSaved} />}
      {open && (
        <div className="adm-fields tm-loyalty">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" /></label>
          <label>Points<input type="number" min={0} value={pts} onChange={(e) => setPts(Math.max(0, parseInt(e.target.value) || 0))} /></label>
          <label>Credit $<input type="text" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
          <label className="adm-check"><input type="checkbox" checked={founding} onChange={(e) => setFounding(e.target.checked)} />Founding</label>
          {role !== "member" && <label className="adm-check"><input type="checkbox" checked={isDriver} onChange={toggleDriver} /><Icon name="compass" /> Driver</label>}
          <button className={`adm-btn${dirty ? " primary" : ""}`} onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
        </div>
      )}
    </div>
  );
}

// ADD A TEAMMATE — one door (components/AddTeammate, 2026-10-07): someone with an account is brought
// on (promote_to_crew — role, city and the city they lead, in one transaction, 0299); an email with
// none is invited; either way they get a GT3 welcome letter. It replaced "Bring someone onto the
// crew" here and "Invite a teammate" in Settings — two doors for one job.
function Members() {
  const { user } = useAuth();
  const { setSection } = useOperatorSection();
  const [q, setQ] = useState("");
  // ?promote=<their profile id> — a customer's card sends an owner here with them named. Read on the
  // first render (lib/urlParam) so the door is born open with them wanted, then cleared from the
  // address so a refresh or a section change never repeats it.
  const [promoteFor] = useState<string | null>(() => readParam("promote"));
  useEffect(() => { if (promoteFor) dropParam("promote"); }, [promoteFor]);
  const membersState = useAsyncData<Profile[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("profiles").select("*").order("display_name");
    return (data as Profile[]) ?? [];
  }, []);
  const [members, setMembers] = useState<Profile[]>([]);
  useEffect(() => { if (membersState.data) setMembers(membersState.data); }, [membersState.data]);
  // Optimistic local patch so a role pick reflects instantly, before the round-trip.
  const patch = useCallback((id: string, role: string) =>
    setMembers((ms) => ms.map((x) => (x.id === id ? { ...x, role: role as Profile["role"] } : x))), []);
  // Real-time: any role/loyalty change (this manager, another manager, or the affected user's
  // own session re-reading their access) lands here live — no refresh.
  useRealtimeTable("profiles", membersState.reload);

  const ql = q.trim().toLowerCase();
  const staff = members.filter((m) => rawRole(m) !== "member");
  const shown = staff.filter((m) =>
    !ql || (m.display_name ?? "").toLowerCase().includes(ql) || (m.referral_code ?? "").toLowerCase().includes(ql) || roleLabel(m.role).toLowerCase().includes(ql)
  );
  const customerCount = members.length - staff.length;
  const ownerCount = staff.filter((m) => rawRole(m) === "owner").length;

  return (
    <AsyncSection
      state={membersState}
      isEmpty={() => false}
      emptyTitle="No one here yet"
      emptySub="People appear here when they sign in."
      loadingLabel="Loading team…"
      errorTitle="Couldn't load the team"
    >
      {() => (
    <div className="adm-sec tm">
      <SectionHeader label="Team" annotation={`${staff.length} member${staff.length === 1 ? "" : "s"}`} />
      {customerCount > 0 && (
        <button type="button" className="team-crm-link" onClick={() => setSection("customers")}>
          {customerCount} customer account{customerCount === 1 ? "" : "s"} moved to <b>Customers</b>{" "}— the CRM. This roster is leadership &amp; crew. ›
        </button>
      )}
      <AddTeammate promoteFor={promoteFor} onDone={membersState.reload} />
      {staff.length > 5 && (
        <input className="auth-input tm-search" placeholder="Search name, code, or role" aria-label="Search team" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {TIERS.map((tier) => {
        const rows = shown
          .filter((m) => tierOf(m.role) === tier.key)
          .sort((a, b) => SENIORITY.indexOf(rawRole(a)) - SENIORITY.indexOf(rawRole(b)) || (a.display_name ?? "").localeCompare(b.display_name ?? ""));
        if (rows.length === 0) return null;
        return (
          <div key={tier.key} className="tm-group">
            <div className="tm-gh"><span>{tier.title}</span><i>{tier.hint}</i><b>{rows.length}</b></div>
            {rows.map((m) => <MemberRow key={m.id} m={m} isSelf={m.id === user?.id} ownerCount={ownerCount} onPatch={patch} onSaved={membersState.reload} />)}
          </div>
        );
      })}
      {staff.length === 0 && <EmptyState title="No one here yet" sub="People appear here once they sign in." />}
      {staff.length > 0 && shown.length === 0 && <div className="h-sub">No match for &ldquo;{q}&rdquo;.</div>}
    </div>
      )}
    </AsyncSection>
  );
}

// ───────────────────────── events ─────────────────────────
// ───────────────────────── live event HUD (command center) ─────────────────────────
// The 3 numbers that matter mid-event, scoped to the live event. Sales = paid app orders
// + Square POS mirror (event_sales), so walk-up cart sales count too.
// The next event on the calendar, as v_event_record reads it — enough to say when it is and the one
// loudest thing it is waiting on (lib/eventRecord owedLine), without opening it.
type NextEvent = {
  id: string; title: string | null; day: string | null; stage: string | null; phase: string | null;
  tasks: number | null; tasks_open: number | null; tasks_critical_open: number | null;
  staff: number | null; sales_count: number | null; recap: string | null;
};
function EventHUD({ onGoEvents }: { onGoEvents?: () => void }) {
  const { toast } = useApp();
  const { openRecord } = useRecord();
  const [ev, setEv] = useState<EventRow | null>(null);
  // undefined = still looking; "error" = could not read it (never shown as "nothing on the calendar")
  const [next, setNext] = useState<NextEvent | null | "error" | undefined>(undefined);
  const [arming, setArming] = useState(false);
  const [stats, setStats] = useState<{ cents: number; orders: number; firstAt: string | null }>({ cents: 0, orders: 0, firstAt: null });
  const [econ, setEcon] = useState<EventEcon | null>(null);
  const [catalog, setCatalog] = useState<ProductEcon[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: e } = await supabase.from("events").select("*").eq("is_live", true).maybeSingle();
    setEv((e as EventRow) ?? null);
    if (!e) {
      setStats({ cents: 0, orders: 0, firstAt: null });
      // Nothing live: say what IS coming, instead of an empty box. Not archived, not done, today
      // or later on the operator's calendar, soonest first.
      const { data: nx, error: nxErr } = await supabase.from("v_event_record")
        .select("id, title, day, stage, phase, tasks, tasks_open, tasks_critical_open, staff, sales_count, recap")
        .is("archived_at", null).neq("stage", "done").gte("day", localToday())
        .order("day", { ascending: true }).limit(1).maybeSingle();
      setNext(nxErr ? "error" : ((nx as NextEvent | null) ?? null));
      return;
    }
    const eid = (e as EventRow).id;
    const [{ data: ords }, { data: sales }, { data: cat }, { data: ec }] = await Promise.all([
      supabase.from("orders").select("total_cents, paid, payment_id, created_at").eq("event_id", eid),
      supabase.from("event_sales").select("amount_cents, square_payment_id, created_at").eq("event_id", eid),
      supabase.from("product_economics_live").select("*").eq("active", true).order("sort"),
      supabase.from("event_economics").select("*").eq("event_id", eid).maybeSingle(),
    ]);
    const o = (ords as { total_cents: number; paid: boolean; payment_id: string | null; created_at: string }[]) ?? [];
    // A card paid online is a Square payment too, and the webhook mirrors every completed Square
    // payment into event_sales — so this HUD added the same money twice for every app order paid
    // during the event. report_sales has never done that (it drops event_sales rows whose payment
    // is an order's, 0216/0220); now the live number agrees with it.
    const linked = new Set(o.map((x) => x.payment_id).filter(Boolean));
    const s = ((sales as { amount_cents: number; square_payment_id: string | null; created_at: string }[]) ?? [])
      .filter((x) => !x.square_payment_id || !linked.has(x.square_payment_id));
    const cents = o.filter((x) => x.paid).reduce((a, x) => a + x.total_cents, 0) + s.reduce((a, x) => a + x.amount_cents, 0);
    const times = [...o.map((x) => x.created_at), ...s.map((x) => x.created_at)].filter(Boolean).sort();
    setStats({ cents, orders: o.length + s.length, firstAt: times[0] ?? null });
    setCatalog((cat as ProductEcon[]) ?? []);
    setEcon((ec as EventEcon) ?? null);
  }, []);
  useEffect(() => {
    load();
    // Reconcile every 15s so Square POS walk-ups + the $/hr clock advance even if a
    // realtime event is missed (matches the KDS's reconcile).
    const recon = setInterval(load, 15000);
    return () => clearInterval(recon);
  }, [load]);
  useRealtimeTable(["orders", "event_sales", "events"], load);
  if (!ev) {
    // The Panel wrapping EventHUD (id="hud", "Event heads-up") is gated on canManage only, not on
    // whether an event is live, so a manager always sees a tappable panel — which most of the time
    // (no live event) used to open onto a totally blank body.
    // 2026-07-29 audit: this told you where to go ("Sales and pace will show here once an event
    // goes live") without a way to actually get there; the empty state grew a Go to Events button.
    // 2026-10-04, Ryan's Live Ops at 9 PM on a Saturday: that empty state was the biggest thing on
    // the screen — a dashed box inside the panel's card saying nothing about what is coming. It says
    // what is coming now, in the panel's own box: the next event, when, and the one thing it is
    // waiting on; an event that is TODAY and not live says so and offers to make it live, because
    // the Square mirror files a card sale against the live event and against nothing otherwise
    // (0024) — a forgotten switch is exactly how an event ends up "complete, with nothing recorded
    // as taken". The truck instrument above answers the same question for stops.
    const goEvents = onGoEvents ? { label: "Go to Events", go: true, onClick: onGoEvents } : null;
    if (next === undefined) return <div className="adm-sec adm-hud"><p className="cp-line dim">Checking the calendar…</p></div>;
    if (next === "error") {
      return (
        <div className="adm-sec adm-hud">
          <p className="cp-line">No event live. Couldn&apos;t read what&apos;s next just now.</p>
          {goEvents && <WayButtons ways={[goEvents]} />}
        </div>
      );
    }
    if (next === null) {
      return (
        <div className="adm-sec adm-hud">
          <p className="cp-line"><b>Nothing on the calendar.</b> Sales and pace show here once an event goes live.</p>
          {onGoEvents && <WayButtons ways={[{ label: "Plan an event", go: true, onClick: onGoEvents }]} />}
        </div>
      );
    }
    const title = next.title?.trim() || "Untitled event";
    const isToday = next.day === localToday();
    const makeLive = async () => {
      if (!supabase || arming) return;
      setArming(true);
      const { error } = await setEventLive(supabase, next.id, true);
      setArming(false);
      if (error) { toast(`Couldn't make it live — ${error.message}`, "error"); return; }
      toast("Event is live — sales now track to it");
      load();
    };
    return (
      <div className="adm-sec adm-hud">
        {isToday ? (
          <>
            <p className="cp-line"><b>{title}</b> is today, and it isn&apos;t live.</p>
            <p className="cp-line dim">Card sales only count toward an event while it&apos;s live.</p>
          </>
        ) : (
          <>
            <p className="cp-line">Next: <b>{title}</b> · {next.day ? dayWithDate(next.day) : "no date yet"}</p>
            <p className="cp-line dim">{owedLine(next)}</p>
          </>
        )}
        <WayButtons ways={[
          ...(isToday ? [{ label: "Make it live", busy: arming, onClick: makeLive }] : []),
          { label: "Open it", go: true, onClick: () => openRecord("event", next.id) },
        ]} />
      </div>
    );
  }
  const hrs = stats.firstAt ? Math.max(0.25, (Date.now() - new Date(stats.firstAt).getTime()) / 3600000) : 0;
  const perHr = hrs ? stats.cents / hrs : 0;
  // plan vs actual — feed the real gross into the projection's cost structure
  const proj = projectEvent(ev, econ ?? DEFAULT_ECON, catalog);
  const recon = reconcile(proj, stats.cents, econ ?? DEFAULT_ECON);
  const hasPlan = proj.revenueCents > 0;
  const pctOfPlan = hasPlan ? Math.round((stats.cents / proj.revenueCents) * 100) : 0;
  const netUp = recon.actualNetCents >= 0;
  return (
    <div className="adm-sec adm-hud">
      <SectionHeader label={ev.title} right={<span className="k-count due">LIVE</span>} />
      {/* One hero mid-service — sales — and one quiet line. The full plan-vs-actual story
          (ROI, break-even, plan totals) lives in Money → Per-event P&L, not on the Now screen. */}
      <div className="adm-hud-hero"><b>{moneyRound(stats.cents)}</b><span>in sales</span></div>
      <p className="adm-hud-line">{stats.orders} order{stats.orders === 1 ? "" : "s"} · {moneyRound(perHr)}/hr{hasPlan && <> · {pctOfPlan}% of plan · net <b className={netUp ? "ok" : "red"}>{moneyRound(recon.actualNetCents)}</b></>}</p>
    </div>
  );
}

// ───────────────────────── event ROI / P&L (telemetry money panel) ─────────────────────────
// Live projection — recomputes on every keystroke; persists on blur. Reads the
// event's own config (attendance/hours/crew/menu) so the plan tracks reality.
function EventEconomics({ e, econRow, catalog, onSave }: {
  e: EventRow; econRow: EventEcon | null; catalog: ProductEcon[];
  onSave: (econ: EventEcon) => void;
}) {
  const [econ, setEcon] = useState<EventEcon>(econRow ?? DEFAULT_ECON);
  useEffect(() => { if (econRow) setEcon(econRow); }, [econRow]);
  const proj = useMemo(() => projectEvent(e, econ, catalog), [e, econ, catalog]);
  const live = (patch: Partial<EventEcon>) => setEcon((p) => ({ ...p, ...patch }));   // live gauge
  const commit = () => onSave(econ);                                                    // persist
  const fixed = econ.booth_cents + econ.transport_cents + econ.permit_cents + econ.consumables_cents;
  const profitable = proj.netCents >= 0;
  const uncosted = proj.lines.some((l) => !l.costed);
  const { profile } = useAuth();
  const { setSection } = useOperatorSection();
  const canSetCosts = canOf(profile).admin;   // Money is an admin's screen

  return (
    <div className="ev-group ev-pnl">
      <div className="ev-group-h">Economics · projected ROI</div>

      {proj.enabledLines === 0 ? (
        <EmptyState title="No menu lines enabled" sub="Turn on the menu lines you'll pour (above) to project revenue & ROI." />
      ) : (
        <>
          <div className="ev-pnl-gauges">
            <div className="gauge"><div className={`gv ${profitable ? "gold" : "red"}`}>{pctInt(proj.roiPct)}%</div><div className="gl">ROI</div></div>
            <div className="gauge"><div className={`gv ${profitable ? "ok" : "red"}`}>{moneyRound(proj.netCents)}</div><div className="gl">Net profit</div></div>
            <div className="gauge"><div className="gv">{pctInt(proj.netMarginPct)}%</div><div className="gl">Margin</div></div>
          </div>

          <div className="pnl-rows">
            <div className="pnl-row"><span className="k">Revenue · {Math.round(proj.projectedUnits)} units</span><span className="v">{moneyRound(proj.revenueCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Product COGS</span><span className="v">−{moneyRound(proj.cogsCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Labor</span><span className="v">−{moneyRound(proj.laborCents)}</span></div>
            <div className="pnl-row neg"><span className="k">− Booth · transport · permit · bottles</span><span className="v">−{moneyRound(fixed)}</span></div>
            <div className={`pnl-row net ${profitable ? "" : "neg"}`}><span className="k">Net profit</span><span className="v">{moneyRound(proj.netCents)}</span></div>
          </div>

          <div className="pnl-be">
            {proj.breakEvenGuests != null
              ? <>Break-even ≈ {Math.ceil(proj.breakEvenGuests)} buying guests · you&apos;re projecting {Math.round(proj.projectedGuests)}</>
              : <>Set a unit price to compute break-even</>}
          </div>
          {/* The direction became the door (2026-10-04): "set their unit cost in Money → Product
              economics" was a sentence. Whoever can open Money gets the button; anyone else is told
              who can, not sent somewhere they cannot go. */}
          {uncosted && (
            <div className="pnl-note">
              Some lines use the blended {pctInt(econ.cogs_pct)}% COGS — their own unit cost gives the exact margin.
              {canSetCosts
                ? <button type="button" className="adm-golink hit-y-44" onClick={() => { setSection("money"); scrollToAnchor("econ"); }}>Set unit costs <Icon name="arrowRight" /></button>
                : <> An owner or admin sets them.</>}
            </div>
          )}
        </>
      )}

      <div className="ev-sub-h">Projection knobs</div>
      <div className="ev-grid">
        <label className="ev-f">Capture %<input type="number" min={0} max={100} value={pctInt(econ.capture_pct)} onChange={(ev) => live({ capture_pct: (parseFloat(ev.target.value) || 0) / 100 })} onBlur={commit} /></label>
        <label className="ev-f">Units/guest<input type="number" min={0} step={0.1} value={econ.items_per_guest} onChange={(ev) => live({ items_per_guest: parseFloat(ev.target.value) || 0 })} onBlur={commit} /></label>
        <label className="ev-f">COGS %<input type="number" min={0} max={100} value={pctInt(econ.cogs_pct)} onChange={(ev) => live({ cogs_pct: (parseFloat(ev.target.value) || 0) / 100 })} onBlur={commit} /></label>
      </div>

      <div className="ev-sub-h">Cost lines</div>
      <div className="ev-grid">
        <label className="ev-f">Labor $/hr<input type="number" min={0} value={(econ.labor_rate_cents / 100) || 0} onChange={(ev) => live({ labor_rate_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Booth $<input type="number" min={0} value={(econ.booth_cents / 100) || 0} onChange={(ev) => live({ booth_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Transport $<input type="number" min={0} value={(econ.transport_cents / 100) || 0} onChange={(ev) => live({ transport_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Permit $<input type="number" min={0} value={(econ.permit_cents / 100) || 0} onChange={(ev) => live({ permit_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Bottles/ice $<input type="number" min={0} value={(econ.consumables_cents / 100) || 0} onChange={(ev) => live({ consumables_cents: toCents(ev.target.value) })} onBlur={commit} /></label>
        <label className="ev-f">Labor total<input type="text" readOnly value={moneyRound(proj.laborCents)} tabIndex={-1} /></label>
      </div>
    </div>
  );
}

// Per-category price + unit cost feeding every event ROI projection (Money tab). Since 0256 the
// numbers are LIVE where they can be: price = avg of the category's active products (Menu &
// products — the same price checkout charges), cost = avg recipe-derived COGS (the same math as
// the COGS calculator below, so the two displays can't disagree). The inputs here remain ONLY as
// the fallback for unmapped/uncosted lines (e.g. `bottles`, a pack format with no drink recipe)
// — editing a live number happens where it lives: price in Menu & products, cost in the recipes.
type LiveEcon = ProductEcon & { price_live?: boolean; cost_live?: boolean };
function ProductCatalog() {
  const { toast } = useApp();
  // Both halves in ONE read: the line's live number, and the drinks it is the average OF. Fetched
  // together so the explanation can never be from a different moment than the thing it explains.
  const catalogState = useAsyncData<{ rows: LiveEcon[]; drinks: EconDrink[] }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const [live, prods] = await Promise.all([
      supabase.from("product_economics_live").select("*").order("sort"),
      supabase.from("products").select("name, price_cents, econ_key, active").order("sort"),
    ]);
    return { rows: (live.data as LiveEcon[]) ?? [], drinks: (prods.data as EconDrink[]) ?? [] };
  }, []);
  const save = async (key: string, patch: Partial<ProductEcon>) => {
    const { error } = await supabase!.from("product_economics").update(patch).eq("product_key", key);
    if (error) toast(`Error: ${error.message}`, "error"); else catalogState.reload();
  };
  return (
    <AsyncSection
      state={catalogState}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle="No catalog yet"
      emptySub="Apply migration 0028 to seed it."
      loadingLabel="Loading product economics…"
      errorTitle="Couldn't load product economics"
    >
      {({ rows, drinks }) => (
        <div className="adm-sec">
          <SectionHeader label="Product economics" />
          <div className="pnl-note" style={{ marginBottom: 10 }}>What every event ROI projects on. <b>Live</b> numbers flow in from Menu &amp; products (price) and the drink recipes (cost) — change them there. The inputs are the manual fallback for lines with no mapped drinks.</div>
          {rows.map((r) => (
            <div className="cat-row" key={r.product_key}>
              <div className="cat-name">{r.label}</div>
              {r.price_live
                ? <div className="ev-f cat-live">Price {money(r.price_cents)} <span className="cat-live-tag">live</span></div>
                : <label className="ev-f">Price $<input type="number" min={0} defaultValue={(r.price_cents / 100) || 0} onBlur={(ev) => toCents(ev.target.value) !== r.price_cents && save(r.product_key, { price_cents: toCents(ev.target.value) })} /></label>}
              {r.cost_live
                ? <div className="ev-f cat-live" title="Recipe-derived: ingredients × inventory unit costs, same math as the COGS calculator.">Cost {money(r.unit_cost_cents ?? null)} <span className="cat-live-tag">recipes</span></div>
                : <label className="ev-f">Cost $<input type="number" min={0} defaultValue={r.unit_cost_cents != null ? (r.unit_cost_cents / 100) : ""} placeholder="—" onBlur={(ev) => save(r.product_key, { unit_cost_cents: ev.target.value.trim() ? toCents(ev.target.value) : null })} /></label>}
              <div className="cat-margin">{r.unit_cost_cents != null && r.price_cents > 0 ? `${pctInt((r.price_cents - r.unit_cost_cents) / r.price_cents)}%` : "—"}</div>
              {/* WHAT THE LIVE NUMBER IS MADE OF, on the row. It is an average, and until now the
                  only place that said so was a title tooltip — which does not exist on a phone.
                  When our arithmetic disagrees with the server's we say THAT instead of inventing
                  a tidy explanation for a number we cannot account for. */}
              {r.price_live && (() => {
                const b = econBreakdown(drinks, r.product_key, r.price_cents);
                if (b.n <= 1) return null;
                return <div className={`cat-from${b.agrees ? "" : " off"}`}>
                  {b.agrees ? econBreakdownLabel(b) : `${b.n} drinks mapped — this line does not add up to the stored price; check Menu & products`}
                </div>;
              })()}
            </div>
          ))}
        </div>
      )}
    </AsyncSection>
  );
}

// Event Brief — computed prep intelligence (demand → brew/pack → ingredient pull →
// crew check → readiness → risk flags). Turns the menu/attendance config into knowledge.
function BriefPanel({ e, proj, inventory }: { e: EventRow; proj: Projection; inventory: InventoryResp }) {
  const b = useMemo(() => buildBrief(e, proj), [e, proj]);
  const inv = useMemo(() => inventoryForEvent(inventory.items, e), [inventory, e]);
  return (
    <div className="ev-group ev-brief">
      <div className="ev-group-h">Event brief · what to bring</div>
      <div className="ev-pnl-gauges">
        {/* "Planned", not "Ready" — this scores the plan inputs (menu, permit, crew, water,
            forecast). Prep readiness is the task list's "Loaded n/n"; two different facts. */}
        <div className="gauge"><div className={`gv ${b.readiness >= 80 ? "ok" : b.readiness >= 50 ? "gold" : "red"}`}><NumberRoll value={b.readiness} suffix="%" /></div><div className="gl">Planned</div></div>
        <div className="gauge"><div className="gv"><NumberRoll value={b.projectedUnits} /></div><div className="gl">Units</div></div>
        <div className="gauge"><div className={`gv ${b.crewOk ? "ok" : "red"}`}>{b.crewHave}/{b.crewNeeded || "–"}</div><div className="gl">Crew</div></div>
      </div>

      {b.risks.length > 0 && (
        <div className="ev-risks">
          {b.risks.map((r, i) => (<div key={i} className={`ev-risk ${r.level}`}><span className="ev-risk-dot" />{r.text}</div>))}
        </div>
      )}

      {b.prep.length > 0 && (
        <>
          <div className="ev-sub-h">Brew &amp; pack</div>
          <div className="ev-prep-list">
            {b.prep.map((p) => (
              <div key={p.key} className="ev-prep-row">
                <span className="ev-prep-n">{p.units}</span>
                <span className="ev-prep-x"><b>{p.label}</b><span>{p.prep}</span></span>
              </div>
            ))}
          </div>
          <div className="ev-sub-h">Ingredient pull</div>
          <div className="ev-ing">
            {b.ingredients.map((g, i) => (<div key={i} className="ev-ing-row"><span>{g.name}</span><span className="ev-ing-q">{g.qty}</span></div>))}
          </div>

          <div className="ev-sub-h">Inventory check{inventory.enabled && <span className="ev-inv-live"> <Icon name="dot" /> live</span>}</div>
          {!inventory.enabled ? (
            <div className="pnl-note">Quantities above are estimates. Connect your Notion inventory (set <b>NOTION_TOKEN</b> + share the GT3 — Inventory DB with the integration) to check real on-hand stock against this event here.</div>
          ) : inv.low.length === 0 ? (
            <div className="ev-risk info"><span className="ev-risk-dot" />{inv.onHandCount} relevant item{inv.onHandCount === 1 ? "" : "s"} on hand · nothing below reorder point.</div>
          ) : (
            <div className="ev-invlist">
              {inv.low.map((it, i) => (
                <div key={i} className={`ev-inv-row${(it.qty ?? 0) <= 0 ? " out" : ""}`}>
                  <span className="ev-inv-n">{it.qty ?? "—"}</span>
                  <span className="ev-inv-x"><b>{it.name}</b><span>reorder at {it.reorderPoint ?? "—"}{it.unit ? ` ${it.unit}` : ""}</span></span>
                  {it.reorderLink && <a className="ev-inv-link" href={it.reorderLink} target="_blank" rel="noreferrer">Reorder ›</a>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One event as a collapsible card: clean header when closed, full editor when open.
// Event lifecycle — Lead → Confirmed → In prep → Live → Done. Live/Done are driven by the green flag
// and archive; the planning stages you set. The current stage is shown everywhere at a glance.
// The stage's WORDS have one home, lib/eventRecord: the record sheet and Needs sorting read them
// there, and this card was the third vocabulary — "Prep" on the card, "In prep" on the sheet, for
// the same row (2026-10-05). The colour is this card's own; nothing else paints a stage.
const STAGE_COLOR: Record<EventStage, string> = {
  lead: "#9aa0a6", confirmed: "#6fa8dc", prep: "#e0892b", live: "#2bb3a3", done: "#7bbf6a",
};
// 0075's column default is 'confirmed', so a row without a known stage reads as the database would.
const stageOf = (e: { stage?: string | null; is_live?: boolean }): EventStage =>
  e.is_live ? "live" : isEventStage(e.stage) ? e.stage : "confirmed";
// The list's three piles, in reading order, with the words each is headed by (lib/eventRecord.eventPiles).
const EVENT_PILES = [["next", "Coming up"], ["unwrapped", "Past · not wrapped"], ["done", "Done"]] as const;

function EventCard({ e, today, open, onToggle, onUpdate, onRemove, onSetLive, onArchive, econRow, catalog, inventory, onSaveEcon, onOpenPrep }: {
  e: EventRow;
  today: string;
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<EventRow>) => void;
  onRemove: () => void;
  onSetLive: (live: boolean) => void;
  onArchive: () => void;
  econRow: EventEcon | null;
  catalog: ProductEcon[];
  inventory: InventoryResp;
  onSaveEcon: (econ: EventEcon) => void;
  onOpenPrep: (id: string) => void;
}) {
  const confirm = useConfirm();
  const juris = useJurisdictions();
  const [planOpen, setPlanOpen] = useState(false);
  const [prepAIOpen, setPrepAIOpen] = useState(false);
  const locSugs = useLocationSuggestions(); // venue datalist — one shared cache across all cards
  // Lazy per-card status: the loader no-ops while collapsed (avoids firing prep/schedule queries
  // for every event in a long list), and re-fetches for real once the card opens. useAsyncData's
  // status still gives this a real loading vs. error split instead of a "…" that never resolved.
  const cardState = useAsyncData<{ prep: { done: number; total: number; crit: number } | null; planCount: number | null }>(async () => {
    if (!open || !supabase) return { prep: null, planCount: null };
    const [{ count }, { data }] = await Promise.all([
      supabase.from("event_schedule_items").select("id", { count: "exact", head: true }).eq("event_id", e.id),
      supabase.from("event_tasks").select("done, critical").eq("event_id", e.id),
    ]);
    const rows = (data as { done: boolean; critical: boolean }[]) ?? [];
    return {
      prep: { done: rows.filter((r) => r.done).length, total: rows.length, crit: rows.filter((r) => r.critical && !r.done).length },
      planCount: count ?? 0,
    };
  }, [open, e.id]);
  const prep = cardState.data?.prep ?? null;
  const planCount = cardState.data?.planCount ?? null;
  const statusErr = cardState.status === "error";
  // WHAT THE CLOSED CARD SAYS (2026-10-05, Ryan's screenshot of this list). The line above the
  // title was "EVENT 01", "EVENT 02" — a number for where the row happened to fall, on a list that
  // fell in the order the rows were created — and the date itself was never on the card: only the
  // weekday, then the times exactly as typed ("6:00PM"), then the venue, which half the time is the
  // title again ("SASSAFRAS FLOWER FARM" under Sassafras Flower Farm). Now the date leads, said
  // against today; the hours go through lib/dates' one formatter, as the calendar's do; and the
  // venue shows when it adds something the title does not already say.
  const tag = dateLine(e.day, today);
  const sub = [evTime(e), placeBesideTitle(e.title, e.location_text)].filter(Boolean).join(" · ");
  const st = stageOf(e);
  // go/no-go ROI at a glance — from saved economics, no need to expand
  const proj = useMemo(() => projectEvent(e, econRow ?? DEFAULT_ECON, catalog), [e, econRow, catalog]);
  const showRoi = catalog.length > 0 && proj.revenueCents > 0;
  return (
    <div className={`ev-card${e.is_live ? " live" : ""}${open ? " open" : ""}`}>
      <button className="ev-head" onClick={onToggle} aria-expanded={open}>
        {/* The light is the live flag and nothing else. Off, it was an empty ring on every card —
            which on a phone reads as a checkbox nobody can tick. */}
        {e.is_live && <span className="ev-led" />}
        <span className="ev-head-main">
          <span className="ev-tag">{tag}</span>
          <span className="ev-title">{e.title || "Untitled event"}</span>
          {/* No hours and a venue the title already says — Soul Yoga, Sassafras on Ryan's list — is
              an empty line, not "Tap to set up": those events are set up, and the date leads now. */}
          {sub && <span className="ev-sub">{sub}</span>}
        </span>
        <span className="ev-head-badges">
          <span className="ev-badge stage" style={{ ["--c" as string]: STAGE_COLOR[st] }}>{stageLabel(st)}</span>
          {showRoi && <span className={`ev-badge roi${proj.netCents < 0 ? " neg" : ""}`}>ROI {pctInt(proj.roiPct)}%</span>}
          {e.member_only && <span className="ev-badge gold">Members</span>}
          <span className="ev-chev">›</span>
        </span>
      </button>

      {open && (
        <div className="ev-body">
          {/* Lifecycle — where this event stands. Live is set by the green flag below; the rest you set. */}
          <div className="ev-stage" role="tablist" aria-label="Event stage">
            {EVENT_STAGES.map((k) => {
              const cur = st === k;
              const settable = !e.is_live && k !== "live"; // Live is driven by the green flag, not a tap
              return (
                <button key={k} type="button" role="tab" aria-selected={cur} disabled={!settable && !cur}
                  className={`ev-stage-pill${cur ? " on" : ""}`} style={{ ["--c" as string]: STAGE_COLOR[k] }}
                  onClick={() => { if (settable && !cur) onUpdate({ stage: k }); }}>{stageLabel(k)}</button>
              );
            })}
          </div>

          {/* The one action that matters most gets its own banner — throw the green flag. */}
          <button className={`ev-golive${e.is_live ? " on" : ""}`} onClick={async () => { if (e.is_live && !(await confirm({ title: "Close this event?", body: "Sales tracking stops and the command-center HUD goes dark.", confirmLabel: "Close event" }))) return; onSetLive(!e.is_live); }}>
            <span className="ev-golive-dot" />
            <span>{e.is_live ? "Green flag out — POS & app sales tracking here" : "Throw the green flag — go live"}</span>
            <span className="ev-golive-state">{e.is_live ? "LIVE" : "OFF"}</span>
          </button>

          {/* Relational link to this event's pack/pick list (lives in Prep) */}
          <button type="button" className={`ev-prep${prep && prep.total > 0 && prep.done === prep.total ? " ok" : prep && prep.crit ? " miss" : ""}`} onClick={() => onOpenPrep(e.id)}>
            <span className="ev-prep-main">
              <b>Prep · pick list</b>
              <span>{prep === null ? (statusErr ? "Couldn't load — tap to open Prep" : "…") : prep.total === 0 ? "Not generated yet — open Prep to build it" : `Loaded ${prep.done}/${prep.total}${prep.crit ? ` · ${prep.crit} critical to load` : prep.done === prep.total ? " · ready" : ""}`}</span>
            </span>
            <span className="ev-prep-go">Open ›</span>
          </button>

          {/* AI prep — tell it about this event, it builds a grounded to-do list (SOPs + inventory + compliance) */}
          <button type="button" className="ev-prep" onClick={() => setPrepAIOpen(true)}>
            <span className="ev-prep-main">
              <b><Icon name="sparkles" /> AI prep list</b>
              <span>Tell it about this event — it builds the to-do list from your SOPs, inventory &amp; the rules</span>
            </span>
            <span className="ev-prep-go">Build ›</span>
          </button>
          {prepAIOpen && (
            <EventPrepAI ownerType="event" ownerId={e.id} title={e.title}
              onClose={() => setPrepAIOpen(false)}
              onAdded={cardState.reload} />
          )}

          {/* Multi-day run of show — leave home → drive → setup → service → teardown, time by time */}
          <button type="button" className={`ev-prep${planCount && planCount > 0 ? " ok" : ""}`} onClick={() => setPlanOpen(true)}>
            <span className="ev-prep-main">
              <b><Icon name="calendar" /> Daily schedule · run of show</b>
              <span>{planCount === null ? (statusErr ? "Couldn't load — tap to open" : "…") : planCount === 0 ? "Build a time-by-time plan for each day" : `${planCount} block${planCount === 1 ? "" : "s"} across ${Math.max(1, e.plan_days ?? 1)} day${Math.max(1, e.plan_days ?? 1) === 1 ? "" : "s"}`}</span>
            </span>
            <span className="ev-prep-go">Plan ›</span>
          </button>
          {planOpen && (
            <EventDayPlanner
              eventId={e.id} title={e.title} eventDay={e.day} planDays={Math.max(1, e.plan_days ?? 1)}
              onPlanDays={(n) => onUpdate({ plan_days: n })}
              onClose={() => { setPlanOpen(false); cardState.reload(); }}
            />
          )}

          {/* What guests see */}
          <div className="ev-group">
            <div className="ev-group-h">Guest facing</div>
            <label className="ev-fld">Title<input className="ev-input" maxLength={200} defaultValue={e.title} placeholder="Event title" aria-label="Event title"
              onBlur={(ev) => ev.target.value !== e.title && onUpdate({ title: ev.target.value })} /></label>
            <label className="ev-fld">Details guests see<textarea className="ev-input ev-area" maxLength={300} rows={2} defaultValue={e.blurb ?? ""} placeholder="One line guests read when they tap this event" aria-label="Event details"
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.blurb && onUpdate({ blurb: ev.target.value.trim() || null })} /></label>
            {/* THE VENUE, ONCE (2026-10-05, the form audit, part 4). This card had a vendor <select>
                in a group of its own above the prep buttons AND a "Location / venue" box down here —
                two controls for one fact, and linking wrote the vendor's name into the box without
                reading the database's answer. One pick now (components/VenuePick, the control every
                stop and event editor uses), writing as it is picked through the card's own update,
                which says when it is refused; what guests read stays editable under it, and follows
                the venue until someone types over it. A venue the words already spell is offered,
                not taken: opening a card does not change the event. */}
            <VenuePick kind="event" source="an event" match={false} contact fieldClass="ev-fld" inputClass="ev-input"
              rec={{ vendor_id: e.vendor_id, name: e.title, location_text: e.location_text, market: e.market }}
              onChange={(fill) => onUpdate(fill.text)} />
            <label className="ev-fld">Where guests see it<input key={e.location_text ?? ""} className="ev-input" maxLength={200} defaultValue={e.location_text ?? ""} placeholder="e.g. Duncan Town Square" aria-label="Where guests see it" list={e.vendor_id ? undefined : `gt3-locs-${e.id}`}
              onBlur={(ev) => (ev.target.value.trim() || null) !== e.location_text && onUpdate({ location_text: ev.target.value.trim() || null })} /></label>
            {!e.vendor_id && locSugs.length > 0 && <datalist id={`gt3-locs-${e.id}`}>{locSugs.map((s) => <option key={s} value={s} />)}</datalist>}
            <div className="ev-grid">
              <label className="ev-f full">Date<input type="date" defaultValue={e.day ?? ""} aria-label="Event date"
                onBlur={(ev) => { const v = ev.target.value || null; if (v !== (e.day ?? null)) { const upd: { day: string | null; day_label?: string } = { day: v }; if (v) upd.day_label = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${v}T12:00:00`).getDay()]; onUpdate(upd); } }} /></label>
              {/* The weekday is DERIVED, not asked for. The Date field above already computes
                  day_label on blur, and this used to be a free-text box beside it — so the app
                  worked the answer out and then asked anyway, and a typed value could overwrite
                  the computed one and never resync. Shown, not editable. */}
              <label className="ev-f">Day<input readOnly value={e.day_label ?? (e.day ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][new Date(`${e.day}T12:00:00`).getDay()] : "")} aria-label="Day of week, from the date" title="Taken from the date" /></label>
              {/* Real time inputs, matching the truck-stop editor, which has used type="time" for
                  the same concept all along. These were plain text with placeholders reading
                  "e.g. 9:00" — so "9", "9am" and "9:00 AM" all stored fine and none of them sort
                  or feed the calendar maths. Existing free-text values survive: toTimeInput keeps
                  anything already parseable and hands the rest back unchanged. */}
              <label className="ev-f">Start<input type="time" defaultValue={toTimeInput(e.start_time)} aria-label="Start time" onBlur={(ev) => (ev.target.value.trim() || null) !== e.start_time && onUpdate({ start_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">End<input type="time" defaultValue={toTimeInput(e.end_time)} aria-label="End time" onBlur={(ev) => (ev.target.value.trim() || null) !== e.end_time && onUpdate({ end_time: ev.target.value.trim() || null })} /></label>
              <label className="ev-f">Going<input type="text" readOnly value={`${e.going_count ?? 0} · from RSVPs`} title="Live headcount from member RSVPs — not editable" /></label>
            </div>
            <button className={`ev-toggle${e.member_only ? " on" : ""}`} onClick={() => onUpdate({ member_only: !e.member_only })} aria-pressed={e.member_only}>
              <span className="ev-toggle-track"><span className="ev-toggle-knob" /></span>
              Members only
            </button>
          </div>

          {/* What the crew needs */}
          <div className="ev-group">
            <div className="ev-group-h">Crew prep · pack signal</div>
            <div className="ev-grid">
              {/* THE WORST FIELD IN THE APP TO GET QUIETLY WRONG. lib/compliance.ts matches these
                  two strings against compliance_rules; "Ga." or "Fulton County" matches nothing and
                  renders a permit checklist that looks complete. They now offer the jurisdictions
                  the rules can actually answer for — still typable, because a county nobody has
                  researched yet must not block a booking, but the common case stops being a
                  spelling test. The line underneath says how many rules actually back the pair,
                  which is the thing free text could never tell you. */}
              <label className="ev-f">State<input maxLength={20} placeholder="GA" list="gt3-juris-states" defaultValue={e.state ?? ""} onBlur={(ev) => onUpdate({ state: ev.target.value.trim().toUpperCase() || null })} /></label>
              <datalist id="gt3-juris-states">{juris.states.map((st) => <option key={st} value={st} />)}</datalist>
              <label className="ev-f">County<input maxLength={40} placeholder="Fulton" list={`gt3-juris-counties-${e.id}`} defaultValue={e.county ?? ""} onBlur={(ev) => onUpdate({ county: ev.target.value.trim() || null })} /></label>
              <datalist id={`gt3-juris-counties-${e.id}`}>{juris.countiesFor(e.state).map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="ev-grid">
              <label className="ev-f">Attendance<input type="number" min={0} defaultValue={e.expected_attendance ?? 0} onBlur={(ev) => onUpdate({ expected_attendance: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
              <label className="ev-f">Hours<input type="number" min={0} step={0.5} defaultValue={e.duration_hrs ?? 0} onBlur={(ev) => onUpdate({ duration_hrs: parseFloat(ev.target.value) || 0 })} /></label>
              <label className="ev-f">Crew<input type="number" min={0} defaultValue={e.staff_count ?? 0} onBlur={(ev) => onUpdate({ staff_count: Math.max(0, parseInt(ev.target.value) || 0) })} /></label>
            </div>

            {/* Menu, rig & site flags — the shared chip set (one option list with the prep hub's
                Menu & rig editor). Patches flow through the same events update as every field here. */}
            <MenuRigChips variant="ev" value={e} onPatch={onUpdate} ownerType="event" ownerId={e.id} />
          </div>

          <BriefPanel e={e} proj={proj} inventory={inventory} />

          <EventEconomics e={e} econRow={econRow} catalog={catalog} onSave={onSaveEcon} />

          <div className="ev-card-foot">
            <button className="ev-archive" onClick={onArchive}>{e.is_live ? "Close & archive" : "Archive event"}</button>
            <button className="ev-delete" onClick={onRemove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventsAdmin() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { setSection } = useOperatorSection();
  const openPrep = (id: string) => { try { localStorage.setItem(prepHandoffKey, prepHandoffValue("event", id)); } catch { /* ignore */ } setSection("prep"); };
  const [openId, setOpenId] = useState<string | null>(null); // single-open accordion
  const [genOpen, setGenOpen] = useState(false); // "create from notes" agent
  const [showArch, setShowArch] = useState(false);
  const today = etToday(); // the business day — the one v_event_record (0348) and Needs sorting use
  const [inventory, setInventory] = useState<InventoryResp>({ enabled: false, items: [] });
  useEffect(() => { fetchInventory().then(setInventory); }, []); // live stock from Notion (token-gated)
  const eventsState = useAsyncData<{ events: EventRow[]; catalog: ProductEcon[]; econMap: Record<string, EventEcon> }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // events + economics catalog + per-event econ in one round (catalog/econ tables may not exist
    // pre-migration — fail soft). The venue book is the card's VenuePick's own read (useVenues).
    const [evs, cat, ec] = await Promise.all([
      supabase.from("events").select("*").order("sort"),
      supabase.from("product_economics_live").select("*").eq("active", true).order("sort"),
      supabase.from("event_economics").select("*"),
    ]);
    const econMap: Record<string, EventEcon> = {};
    for (const r of (ec.data ?? []) as ({ event_id: string } & EventEcon)[]) econMap[r.event_id] = r;
    return {
      events: (evs.data as EventRow[]) ?? [],
      catalog: (cat.data as ProductEcon[]) ?? [],
      econMap,
    };
  }, []);
  const load = eventsState.reload;
  // Local mirrors: econMap takes an optimistic patch in saveEcon() below (no flicker on the live
  // gauge), and events/catalog ride along as the same editable-until-reload copy.
  const [events, setEvents] = useState<EventRow[]>([]);
  const [catalog, setCatalog] = useState<ProductEcon[]>([]);
  const [econMap, setEconMap] = useState<Record<string, EventEcon>>({});
  useEffect(() => {
    if (!eventsState.data) return;
    setEvents(eventsState.data.events);
    setCatalog(eventsState.data.catalog);
    setEconMap(eventsState.data.econMap);
  }, [eventsState.data]);

  // upsert the full econ row (keeps DB authoritative copy in sync with the panel)
  const saveEcon = async (id: string, econ: EventEcon) => {
    setEconMap((m) => ({ ...m, [id]: econ })); // optimistic — no flicker on the live gauge
    await supabase!.from("event_economics").upsert({ event_id: id, ...econ }, { onConflict: "event_id" });
  };

  const update = async (id: string, patch: Partial<EventRow>) => {
    const { error } = await supabase!.from("events").update(patch).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event updated", error ? "error" : undefined);
    if (!error) load();
  };
  const addEvent = async (title: string) => {
    // Born dated (next Saturday) — a dateless event is invisible to the calendar, which reads as "it vanished".
    const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return localYMD(d); })();
    // Born at 11:00 — the same de facto standard start time stops already get (FieldOpSheet,
    // AddSheet, CalEdit's defTime all default here); a blank Start field was the one place an event
    // didn't match. Still just a starting point — fully editable on the card.
    const { data, error } = await supabase!.from("events").insert({ title, day_label: "SAT", day: nextSat, start_time: "11:00", sort: events.length }).select("id").single();
    toast(error ? `Error: ${error.message}` : "Event added", error ? "error" : undefined);
    if (!error) { if (data) setOpenId((data as { id: string }).id); load(); } // open the new one for editing
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: "Remove this event?", confirmLabel: "Remove", danger: true }))) return;
    const { error } = await supabase!.from("events").delete().eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event removed", error ? "error" : undefined);
    if (!error) load();
  };
  // Mark an event live — sales (POS + app) start tracking to it; only one live at a time.
  const setLive = async (id: string, live: boolean) => {
    const { error } = await setEventLive(supabase!, id, live);
    toast(error ? `Error: ${error.message}` : live ? "Event is live — sales now track to it" : "Event closed", error ? "error" : undefined);
    if (!error) load();
  };
  // Archive — closes the event (clears live) and files it out of the active workspace.
  // It stays in the DB for records/AAR; restore brings it back.
  const archive = async (id: string) => {
    const { error } = await archiveOwner(supabase!, { kind: "event", id });
    toast(error ? `Error: ${error.message}` : "Event archived", error ? "error" : undefined);
    if (!error) { setOpenId(null); load(); }
  };
  const restore = async (id: string) => {
    const { error } = await supabase!.from("events").update({ archived_at: null }).eq("id", id);
    toast(error ? `Error: ${error.message}` : "Event restored", error ? "error" : undefined);
    if (!error) load();
  };

  return (
    <div className="adm-sec">
      <SectionHeader label="Events" right={<>
        <button className="adm-btn eg-btn" onClick={() => setGenOpen(true)}><Icon name="sparkles" /> From notes</button>
        <InlineCreate label="+ Add" placeholder="Event title" onCreate={addEvent} />
      </>} />
      {genOpen && <EventGenerator onClose={() => setGenOpen(false)} onCreated={load} />}
      <AsyncSection
        state={eventsState}
        isEmpty={() => false}
        emptyTitle="No events yet"
        loadingLabel="Loading events…"
        errorTitle="Couldn't load events"
      >
        {() => {
          // THREE PILES, EACH IN DATE ORDER (2026-10-05). The list came back in `sort` order, which
          // is creation order — Ryan's phone: Oct 24, Aug 15, Aug 23, Jul 31. What is coming up now
          // leads; what has passed without being wrapped is next, under a heading that says so,
          // rather than mixed in among the upcoming ones still saying "Confirmed"; what is done is
          // last. The rule is lib/eventRecord.eventPiles, on the business day — Needs sorting's.
          const active = events.filter((e) => !e.archived_at);
          const archived = events.filter((e) => e.archived_at).sort(newestFirst);
          const piles = eventPiles(active, today);
          const card = (e: EventRow) => (
            <EventCard
              key={e.id}
              e={e}
              today={today}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              onUpdate={(patch) => update(e.id, patch)}
              onRemove={() => remove(e.id)}
              onSetLive={(live) => setLive(e.id, live)}
              onArchive={() => archive(e.id)}
              econRow={econMap[e.id] ?? null}
              catalog={catalog}
              inventory={inventory}
              onSaveEcon={(econ) => saveEcon(e.id, econ)}
              onOpenPrep={openPrep}
            />
          );
          return (
            <>
              {active.length === 0 && (
                <EmptyState title="No active events" sub={archived.length ? "Tap + Add above to create one, or reopen one below." : "Tap + Add above to create one."} />
              )}
              {EVENT_PILES.map(([k, label]) => piles[k].length > 0 && (
                <section key={k} aria-label={label}>
                  <div className="dv-sub">{label} · {piles[k].length}</div>
                  <div className="ev-list">{piles[k].map(card)}</div>
                </section>
              ))}

              {archived.length > 0 && (
                <div className="ev-archived">
                  <button className="ev-arch-head" onClick={() => setShowArch((s) => !s)} aria-expanded={showArch}>
                    Archived · {archived.length}<span className={`ev-chev${showArch ? " open" : ""}`}>›</span>
                  </button>
                  {showArch && archived.map((e) => (
                    <div className="ev-arch-row" key={e.id}>
                      <span className="ev-arch-name">{e.title || "Untitled event"}</span>
                      {/* Which one: two archived rows can share a title (0314's twins). */}
                      <span className="ev-arch-when">{evDate(e) ?? "No date"}</span>
                      <button className="ev-arch-btn" onClick={() => restore(e.id)}>Restore</button>
                      <button className="ev-arch-btn del" onClick={() => remove(e.id)}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        }}
      </AsyncSection>
    </div>
  );
}

// ───────────────────────── subscription interest (waitlist / demand signal) ─────────────────────────
function SubInterest() {
  const subState = useAsyncData<{ pack_size: string | null; email: string | null; created_at: string }[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("subscription_interest").select("pack_size,email,created_at").order("created_at", { ascending: false }).limit(100);
    return (data as { pack_size: string | null; email: string | null; created_at: string }[]) ?? [];
  }, []);
  return (
    <AsyncSection
      state={subState}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="No interest yet"
      emptySub="It lands here when people tap “Notify me” on the subscription pitch."
      loadingLabel="Loading subscription interest…"
      errorTitle="Couldn't load subscription interest"
    >
      {(rows) => {
        const byPack = (k: string) => rows.filter((r) => r.pack_size === k).length;
        return (
          <div className="adm-sec">
            <SectionHeader label="Subscription interest" right={<span className="k-count">{rows.length}</span>} />
            <div className="meta" style={{ marginBottom: 10 }}>6-pack · {byPack("6")} &nbsp;|&nbsp; 12-pack · {byPack("12")} &nbsp;|&nbsp; 18-pack · {byPack("18")}</div>
            <div className="k-rows">
              {rows.map((r, i) => (
                <InfoRow
                  key={i}
                  name={r.email ?? "—"}
                  nameExtra={<span className="adm-substat active">{r.pack_size ? `${r.pack_size}-pack` : "—"}</span>}
                  meta={new Date(r.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                />
              ))}
            </div>
          </div>
        );
      }}
    </AsyncSection>
  );
}

// ───────────────────────── order history (review past orders) ─────────────────────────
function OrdersHistory() {
  const [q, setQ] = useState("");
  const ordersState = useAsyncData<Order[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("orders").select("*").in("status", ["done", "void"]).order("status_changed_at", { ascending: false }).limit(300);
    return (data as Order[]) ?? [];
  }, []);
  useRealtimeTable("orders", ordersState.reload);
  return (
    <AsyncSection
      state={ordersState}
      isEmpty={() => false}
      emptyTitle="No completed orders yet"
      emptySub="They appear here after pickup."
      loadingLabel="Loading order history…"
      errorTitle="Couldn't load order history"
    >
      {(rows) => {
        const done = rows.filter((r) => r.status === "done").length;
        // Under pressure a manager needs to LOOK UP an order — filter by name, order #, item, or amount.
        const term = q.trim().toLowerCase();
        const shown = term
          ? rows.filter((o) => {
              const name = (o.customer ?? "guest").toLowerCase();
              const id = o.id.slice(0, 4).toLowerCase();
              const items = o.items.map((i) => (DRINKS[i as DrinkId]?.n ?? i)).join(" ").toLowerCase();
              return name.includes(term) || id.includes(term) || items.includes(term) || moneyPlain(o.total_cents).includes(term);
            })
          : rows;
        return (
          <div className="adm-sec">
            {/* "It's my data" (enterprise round P2) — the accountant handoff, from the rows shown */}
            <button type="button" className="dops-mini" style={{ marginBottom: 8 }} onClick={() => downloadCsv("gt3-orders.csv", shown.map((o) => ({
              when: o.status_changed_at ?? "", order: o.id.slice(0, 4), customer: o.customer ?? "guest",
              items: o.items.map((i) => DRINKS[i as DrinkId]?.n ?? i).join(" · "),
              total: moneyPlain(o.total_cents), status: o.status, paid: ledgerWord(o),
            })))}>Export CSV</button>
            <SectionHeader label="Order history" right={done > 0 ? <span className="k-count">{done} completed</span> : undefined} />
            <input className="adm-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name · order # · item · amount" aria-label="Search order history" />
            {term && <div className="h-sub" style={{ margin: "2px 2px 10px" }}>{shown.length} match{shown.length === 1 ? "" : "es"}</div>}
            <div className="k-rows">
              {shown.map((o) => (
                <InfoRow
                  key={o.id}
                  name={<RecordLink kind="customer" id={o.customer_id}>{o.customer ?? "Guest"}</RecordLink>}
                  nameExtra={<span className={`adm-substat ${o.status === "void" ? "past_due" : "active"}`}>{o.status}</span>}
                  meta={<>{groupItems(o.items).map((g) => `${g.qty > 1 ? g.qty + "× " : ""}${DRINKS[g.id as DrinkId]?.n ?? g.id}`).join(" · ")} · {money(o.total_cents)} · {new Date(o.status_changed_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</>}
                />
              ))}
            </div>
            {rows.length === 0 && <EmptyState title="No completed orders yet" sub="They appear here after pickup." />}
            {rows.length > 0 && shown.length === 0 && <EmptyState title={`No matches for “${q.trim()}”`} sub="Try a different name, order #, item, or amount." />}
          </div>
        );
      }}
    </AsyncSection>
  );
}

// "Turn on order alerts" lived here (EnableAlerts) until 2026-10-06 (the settings round). Ryan, the
// 2026-07-29 audit: "Turn on order alerts out of place, WTF." It was given a heading then, and stayed
// at the bottom of Live Ops. It is a setting of this phone, so it is Settings › You › Notifications › Alerts on this
// device now (components/DeviceAlerts), and Live Ops keeps one line while alerts are off here.

// ───────────────────────── back office ─────────────────────────
// The "Overview / At a glance" component that lived here died 2026-07-30 (Ryan's screenshot:
// "feels unnecessary and like it's in other sections. Redundant"): its coming-up line restated
// the exact This week / Truck locations cards rendered directly below it on the prep list, and
// its live-status line was Live Ops' job (which always had its own LiveControl). Two fetches, a
// realtime subscription and a debounce timer, all to summarize the screen they sat on.
// ───────────────────────── vendors (relational venue records) ─────────────────────────
type VendorSug = { kind: "stop" | "event"; id: string; name: string; sub: string; stop?: Stop; event?: EventRow };

// A vendor's places (0226) — list, add, set primary, archive. Rendered under the open vendor row.
function VendorLocationsEditor({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const { toast } = useApp();
  const [nm, setNm] = useState("");
  const [addr, setAddr] = useState("");
  const locsState = useAsyncData<VendorLocation[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const { data } = await supabase.from("vendor_locations").select("*").eq("vendor_id", vendorId).is("archived_at", null).order("is_primary", { ascending: false }).order("sort");
    return (data as VendorLocation[]) ?? [];
  }, [vendorId]);
  const load = locsState.reload;
  const add = async () => {
    if (!nm.trim()) return;
    const made = await addVendorLocation(vendorId, { label: nm.trim(), address: addr.trim() || null });
    if (!made) { toast("Couldn't add the location", "error"); return; }
    setNm(""); setAddr(""); toast("Location added"); load();
  };
  const setPrimary = async (id: string) => {
    if (!supabase) return;
    // Clear the old primary first — the partial unique index enforces ONE.
    await supabase.from("vendor_locations").update({ is_primary: false }).eq("vendor_id", vendorId).eq("is_primary", true);
    const { error } = await supabase.from("vendor_locations").update({ is_primary: true }).eq("id", id);
    toast(error ? `Couldn't set primary — ${error.message}` : "Primary location set", error ? "error" : undefined);
    load();
  };
  const archiveLoc = async (id: string, label: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("vendor_locations").update({ is_primary: false, archived_at: new Date().toISOString() }).eq("id", id);
    toast(error ? `Couldn't remove — ${error.message}` : `${label} removed`, error ? "error" : undefined);
    load();
  };
  return (
    <div className="vloc" style={{ padding: "0 12px 10px" }}>
      <div className="ev-group-h">Locations · {vendorName}</div>
      <AsyncSection
        state={locsState}
        isEmpty={(locs) => locs.length === 0}
        emptyTitle="No locations yet"
        emptySub="The vendor's own address acts as its place."
        loadingLabel="Loading locations…"
        errorTitle="Couldn't load locations"
      >
        {(locs) => (
          <>
            {locs.map((l) => (
              <div className="vloc-row" key={l.id}>
                <div className="vloc-main"><b>{l.label}</b>{(l.address || l.location_text) && <span>{l.address ?? l.location_text}</span>}</div>
                {l.is_primary ? <span className="vloc-pri">Primary</span> : <button className="ev-arch-btn" onClick={() => setPrimary(l.id)}>Make primary</button>}
                <button className="ev-arch-btn del" onClick={() => archiveLoc(l.id, l.label)}>Remove</button>
              </div>
            ))}
          </>
        )}
      </AsyncSection>
      <div className="vnew-row" style={{ marginTop: 8 }}>
        <input className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Location name" maxLength={80} />
        <input className="ev-input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Address (optional)" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button type="button" className="adm-btn" onClick={add} disabled={!nm.trim()}>Add</button>
      </div>
    </div>
  );
}

function VendorsAdmin() {
  const confirm = useConfirm();
  const { toast } = useApp();
  const { profile } = useAuth();
  const isAdmin = ["owner", "admin"].includes(roleOf(profile));
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArch, setShowArch] = useState(false);
  type DupePair = { a: string; a_name: string; b: string; b_name: string; sim: number };
  const [merging, setMerging] = useState(false);
  // The look-alike confirm sheet's pending question: which path asked, and with what payload.
  const [resolve, setResolve] = useState<{ name: string; candidates: VendorMatch[]; ctx: { type: "add" } | { type: "from"; sug: VendorSug } } | null>(null);
  const vendorsState = useAsyncData<{ vendors: Vendor[]; stops: Stop[]; events: EventRow[]; dupes: DupePair[] }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const [{ data: v }, { data: s }, { data: e }, dup] = await Promise.all([
      supabase.from("vendors").select("*").order("sort"),
      supabase.from("stops").select("*"),
      supabase.from("events").select("*"),
      supabase.rpc("vendor_dupe_candidates"),
    ]);
    return {
      vendors: (v as Vendor[]) ?? [],
      stops: ((s as Stop[]) ?? []).filter((x) => !x.archived_at),
      events: ((e as EventRow[]) ?? []).filter((x) => !x.archived_at),
      dupes: (dup.data as DupePair[]) ?? [],
    };
  }, []);
  const load = vendorsState.reload;
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [dupes, setDupes] = useState<DupePair[]>([]);
  useEffect(() => {
    if (!vendorsState.data) return;
    setVendors(vendorsState.data.vendors);
    setStops(vendorsState.data.stops);
    setEvents(vendorsState.data.events);
    setDupes(vendorsState.data.dupes);
  }, [vendorsState.data]);
  // ONE resolver (0226): exact → open the existing record · look-alike → the confirm sheet ·
  // clean miss → create approved (this is the deliberate vendor book, not an on-the-fly add).
  const add = async (name: string, decision?: ResolveDecision) => {
    const r = await resolveVendor(name, { status: "approved", source: "the vendor book", sort: vendors.length, decision });
    if (r.kind === "similar") { setResolve({ name, candidates: r.candidates, ctx: { type: "add" } }); return; }
    if (r.kind === "error") { toast(`Error: ${r.message}`, "error"); return; }
    setResolve(null);
    toast(r.kind === "created" ? "Vendor added" : "Already in the book — opened it");
    setOpenId(r.id); load();
  };
  // Relational fill: materialize a vendor from an existing stop/event and link the source —
  // and if the name look-alikes an existing vendor, LINK the source to it instead of minting
  // a copy (the whole point of the guard).
  const createFrom = async (sug: VendorSug, decision?: ResolveDecision) => {
    let extra: Partial<Vendor> = {};
    if (sug.kind === "stop" && sug.stop) {
      const s = sug.stop;
      // POC/service-dates no longer live on stops (0240 — they were dead columns, never carried
      // real data); a materialized vendor starts with location only and gets its contact filled
      // in directly, same as any other new vendor-book entry.
      extra = { location_text: s.location_text, address: s.address, lat: s.lat, lng: s.lng };
    } else if (sug.event) {
      extra = { location_text: sug.event.location_text };
    }
    const r = await resolveVendor(sug.name, { status: "approved", source: "the vendor book", sort: vendors.length, extra: extra as Record<string, unknown>, decision });
    if (r.kind === "similar") { setResolve({ name: sug.name, candidates: r.candidates, ctx: { type: "from", sug } }); return; }
    if (r.kind === "error") { toast(`Error: ${r.message}`, "error"); return; }
    setResolve(null);
    if (sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: r.id }).eq("id", sug.id);
    else await supabase!.from("events").update({ vendor_id: r.id }).eq("id", sug.id);
    toast(r.kind === "created" ? `Vendor created from ${sug.name} — now linked` : `${sug.name} linked to the existing vendor`);
    load();
  };
  // Owner-gated merge (0226): repoints stops/events/pipeline/notes/spend, archives the dupes.
  const merge = async (keep: DupePair["a"], dupe: string, keepName: string, dupeName: string) => {
    if (!supabase || merging) return;
    if (!(await confirm({ title: `Merge “${dupeName}” into “${keepName}”?`, body: `Everything linked to ${dupeName} gets repointed; it's archived (reversible), never deleted.`, confirmLabel: "Merge" }))) return;
    setMerging(true);
    const { data, error } = await supabase.rpc("merge_vendors", { p_keep: keep, p_dupes: [dupe] });
    setMerging(false);
    if (error) { toast(`Couldn't merge — ${error.message}`, "error"); return; }
    const rep = (data as { repointed?: Record<string, number> })?.repointed ?? {};
    const moved = Object.entries(rep).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ");
    toast(`Merged into ${keepName}${moved ? ` — repointed ${moved}` : ""}`);
    load();
  };
  const archive = async (id: string) => { await supabase!.from("vendors").update({ archived_at: new Date().toISOString() }).eq("id", id); setOpenId(null); load(); };
  const restore = async (id: string) => { await supabase!.from("vendors").update({ archived_at: null }).eq("id", id); load(); };
  const del = async (id: string, nm: string) => { if (!(await confirm({ title: `Delete ${nm}?`, confirmLabel: "Delete", danger: true }))) return; await supabase!.from("vendors").delete().eq("id", id); load(); };
  // Approve a venue that was added on the fly from a truck stop (0191) — it becomes a first-class
  // vendor. Opening it to fill in the contact details is the natural next step.
  const approve = async (id: string) => { await supabase!.from("vendors").update({ status: "approved" }).eq("id", id); toast("Vendor approved"); setOpenId(id); load(); };
  const active = vendors.filter((v) => !v.archived_at);
  const pending = active.filter((v) => v.status === "pending");
  const archived = vendors.filter((v) => v.archived_at);

  // Suggestions = stops/events not yet linked to a vendor, whose name isn't already a vendor.
  const vendorNames = new Set(vendors.map((v) => v.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const suggestions: VendorSug[] = [
    ...stops.filter((s) => !s.vendor_id && s.name).map((s) => ({ kind: "stop" as const, id: s.id, name: s.name, sub: s.location_text ?? s.address ?? "Stop", stop: s })),
    ...events.filter((e) => !e.vendor_id && e.title).map((e) => ({ kind: "event" as const, id: e.id, name: e.title, sub: e.location_text ?? "Event", event: e })),
  ].filter((x) => {
    const k = x.name.trim().toLowerCase();
    if (vendorNames.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div className="adm-sec">
      <SectionHeader label="Vendors" right={<InlineCreate label="+ Add vendor" placeholder="Vendor name" onCreate={(name) => add(name)} />} />
      <div className="pnl-note" style={{ marginBottom: 6 }}>One record per venue/partner — linked from truck stops and events. Edit a POC here and it updates everywhere it&apos;s linked. A vendor can hold several locations.</div>
      <AsyncSection
        state={vendorsState}
        isEmpty={() => false}
        emptyTitle="No vendors yet"
        loadingLabel="Loading vendors…"
        errorTitle="Couldn't load vendors"
      >
        {() => (
          <>
            {dupes.length > 0 && (
              <div className="vdupe">
                <div className="vdupe-h">Possible duplicates · {dupes.length}</div>
                {dupes.map((d) => (
                  <div className="vdupe-row" key={`${d.a}-${d.b}`}>
                    <span className="vdupe-names"><b>{d.a_name}</b><em>{Math.round(d.sim * 100)}%</em><b>{d.b_name}</b></span>
                    {isAdmin ? (
                      <span style={{ display: "flex", gap: 6 }}>
                        <button className="adm-btn" disabled={merging} onClick={() => merge(d.a, d.b, d.a_name, d.b_name)}>Keep {d.a_name}</button>
                        <button className="adm-btn" disabled={merging} onClick={() => merge(d.b, d.a, d.b_name, d.a_name)}>Keep {d.b_name}</button>
                      </span>
                    ) : (
                      <span className="pnl-note">Owner can merge these</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pending.length > 0 && (
              <div className="vendor-pending">
                <div className="ev-group-h" style={{ marginBottom: 8, color: "var(--warn)" }}>Awaiting your approval · {pending.length}</div>
                {pending.map((v) => (
                  <div className="vendor-sug pend" key={`pend-${v.id}`}>
                    <div className="vendor-sug-main"><b>{v.name}</b><span>Added from a truck stop — approve to add it to the book</span></div>
                    <button className="adm-btn primary" onClick={() => approve(v.id)}>Approve</button>
                  </div>
                ))}
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="vendor-sugs">
                <div className="ev-group-h" style={{ marginBottom: 8 }}>Create from your stops &amp; events</div>
                {suggestions.map((sug) => (
                  <div className="vendor-sug" key={`${sug.kind}-${sug.id}`}>
                    <div className="vendor-sug-main"><b>{sug.name}</b><span>{sug.kind === "stop" ? "Stop" : "Event"}{sug.sub ? ` · ${sug.sub}` : ""}</span></div>
                    <button className="adm-btn" onClick={() => createFrom(sug)}>+ Create</button>
                  </div>
                ))}
              </div>
            )}
            {active.length === 0 && suggestions.length === 0 && (
              <EmptyState title="No vendors yet" sub="Tap + Add vendor above to create one." />
            )}
            <div className="ev-list">
              {active.map((v) => (
                <div key={v.id}>
                  <LocationEditor kind="vendor" row={v} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onArchive={() => archive(v.id)} onChanged={load} />
                  {openId === v.id && <VendorLocationsEditor vendorId={v.id} vendorName={v.name} />}
                </div>
              ))}
            </div>
            {archived.length > 0 && (
              <div className="ev-archived">
                <button className="ev-arch-head" onClick={() => setShowArch((s) => !s)} aria-expanded={showArch}>Archived vendors · {archived.length}<span className={`ev-chev${showArch ? " open" : ""}`}>›</span></button>
                {showArch && archived.map((v) => (
                  <div className="ev-arch-row" key={v.id}><span className="ev-arch-name">{v.name}</span><button className="ev-arch-btn" onClick={() => restore(v.id)}>Restore</button><button className="ev-arch-btn del" onClick={() => del(v.id, v.name)}>Delete</button></div>
                ))}
              </div>
            )}
          </>
        )}
      </AsyncSection>
      {resolve && (
        <VendorResolve name={resolve.name} candidates={resolve.candidates}
          onUse={async (c) => {
            const ctx = resolve.ctx; setResolve(null);
            if (ctx.type === "add") { setOpenId(c.id); toast(`${c.name} is already in the book — opened it`); return; }
            if (ctx.sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            else await supabase!.from("events").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            toast(`${ctx.sug.name} linked to ${c.name}`); load();
          }}
          onAddLocation={async (c) => {
            const ctx = resolve.ctx; setResolve(null);
            const src = ctx.type === "from" && ctx.sug.kind === "stop" ? ctx.sug.stop : null;
            await addVendorLocation(c.id, { label: resolve.name, address: src?.address ?? null, location_text: src?.location_text ?? null, lat: src?.lat ?? null, lng: src?.lng ?? null });
            if (ctx.type === "from") {
              if (ctx.sug.kind === "stop") await supabase!.from("stops").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
              else await supabase!.from("events").update({ vendor_id: c.id }).eq("id", ctx.sug.id);
            }
            toast(`Added “${resolve.name}” as a location of ${c.name}`); load();
          }}
          onCreateDistinct={() => {
            const ctx = resolve.ctx; setResolve(null);
            if (ctx.type === "add") add(resolve.name, { createDistinct: true });
            else createFrom(ctx.sug, { createDistinct: true });
          }}
          onClose={() => setResolve(null)}
        />
      )}
    </div>
  );
}

// Reusable venue picker — links a stop/event to a vendor, and is the ONE place a stop is bound to the
// vendor book. A truck stop should always name a known venue; if it's a new place, you add it here and
// it's created PENDING with an owner-approval alert (0191) — never a silent orphan. Shows the linked
// vendor's POC live (relational), edit-once-updates-everywhere.
const GUIDE_PAGES = ["start", "sections"];
function SectionGuide({ allowed, current, start, onGo, onClose }: { allowed: OpSection[]; current: OpSection; start: boolean; onGo: (s: OpSection) => void; onClose: () => void }) {
  // The sheet owns the scroll — the page behind must not move under a finger on the overlay.
  useEffect(() => {
    const b = document.getElementById("body") ?? document.body;
    const prev = b.style.overflow;
    b.style.overflow = "hidden";
    return () => { b.style.overflow = prev; };
  }, []);
  const [open, setOpen] = useState<OpSection>(current);
  // WHAT'S NEW (2026-10-06, the settings-by-category round). The changelog sat in Settings › Advanced,
  // where only an owner or an admin ever saw it; release notes are help, not a setting. The Guide is
  // the console's help, and every role opens it — and every staff role can read the changelog (0260:
  // "changelog staff read").
  const [news, setNews] = useState(false);
  // START HERE (2026-10-08) — the first day, lib/crewStart's steps with the tap that does each. The
  // Guide was only "when to use what"; the first day lived in Ryan's texts. Two pages of one guide,
  // not a second guide: the ⓘ still opens on the sections, the letter's link and a first visit on
  // Start here.
  const [page, setPage] = useState<"start" | "sections">(start ? "start" : "sections");
  return (
    <Sheet open onClose={onClose} labelledBy="section-guide-title" header={
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <div>
            <div className="guide-t" id="section-guide-title">{page === "start" ? "Start here" : "When to use what"}</div>
            <div className="guide-lede">{page === "start" ? "Your first day on the crew — each step, and one tap that does it." : "Each section is one job at one moment. Tap to learn more, then jump straight there."}</div>
          </div>
          <button type="button" className="guide-x ml-auto" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <Segmented label="Guide" size="sm" value={page} onChange={setPage}
          options={[{ key: "start", label: "Start here" }, { key: "sections", label: "Every section" }]} />
      </div>}>
      {/* The two pages turn with a sideways swipe too, like every row of tabs (the gesture round). */}
      <SwipePager levels={[{ keys: GUIDE_PAGES, current: page, go: (k) => setPage(k as "start" | "sections"), depth: 0 }]}>
      {page === "start" ? (
        <CrewStart onSection={(s, anchor) => { onGo(s); if (anchor) scrollToAnchor(anchor); }} onClose={onClose} />
      ) : (<>
        {(allowed.includes("plan") || allowed.includes("prep")) && (
          <button type="button" className="guide-create" onClick={() => { window.dispatchEvent(new CustomEvent("gt3-copilot", { detail: "event-build" })); onClose(); }}>
            <span className="guide-create-x"><b><Icon name="sparkles" /> Create an event or truck stop</b><span>Say it in plain words — the chief of staff drafts it, you confirm.</span></span>
            <span className="guide-create-go" aria-hidden><Icon name="arrowRight" /></span>
          </button>
        )}
        <div className="guide-list">
          {allowed.map((s, i) => {
            const isOpen = open === s;
            const here = current === s;
            return (
              <div key={s} className={`guide-row${isOpen ? " open" : ""}${here ? " here" : ""}`}>
                <button type="button" className="guide-row-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? ("" as OpSection) : s)}>
                  <span className="guide-num">{i + 1}</span>
                  <span className="guide-row-tt">
                    <span className="guide-row-t">{SEC_LABEL[s]}{here && <span className="guide-here-dot"><Icon name="dot" /> here now</span>}</span>
                    <span className="guide-row-sub">{SEC_SUB[s]}</span>
                  </span>
                  <span className="guide-when">{SEC_WHEN[s]}</span>
                  <span className={`guide-chev ev-chev${isOpen ? " open" : ""}`} aria-hidden>›</span>
                </button>
                {isOpen && (
                  <div className="guide-body">
                    <p className="guide-more">{SEC_MORE[s]}</p>
                    <div className="guide-inside-h">What's inside</div>
                    <ul className="guide-inside">{SEC_INSIDE[s].map((x) => <li key={x}>{x}</li>)}</ul>
                    {here
                      ? <div className="guide-here-note">You're in {SEC_LABEL[s]} now.</div>
                      : <button type="button" className="guide-go" onClick={() => { onGo(s); onClose(); }}>Go to {SEC_LABEL[s]} ›</button>}
                  </div>
                )}
              </div>
            );
          })}
          <div className={`guide-row${news ? " open" : ""}`}>
            <button type="button" className="guide-row-h" aria-expanded={news} onClick={() => setNews(!news)}>
              <span className="guide-row-tt">
                <span className="guide-row-t">What&rsquo;s new</span>
                <span className="guide-row-sub">Everything we&rsquo;ve shipped, newest first.</span>
              </span>
              <span className={`guide-chev ev-chev${news ? " open" : ""}`} aria-hidden>›</span>
            </button>
            {news && <div className="guide-body"><Changelog /></div>}
          </div>
        </div>
      </>)}
      </SwipePager>
    </Sheet>
  );
}

// Collapsible panel — tames a long section into tidy, tappable cards. Remembers open/closed per id,
// and hides the wrapped panel's own title (the Panel supplies it) while keeping its actions.
// `id` was only ever used internally (the storeKey) and never landed on the actual DOM node — every
// scrollToAnchor("pay")-style deep link into a Panel was silently a no-op, getElementById found
// nothing. Found while wiring up the settings-card anchors and the live-copy edit bridge (7/16);
// fixed here since both depend on it.
//
// A ROW THAT SAYS WHAT IT HOLDS (2026-10-06, the settings round). `sub` is a line under the title
// saying what is inside; `value` is what it is set to now, on the right — the way a phone's Settings
// reads ("Wi-Fi … Home ›"). A closed panel with a `sub` is a list row, not a blind header, and the
// accordion-wall gate (scripts/design.ratchet.mjs, collapsedPanels) counts only the blind ones.
// `remember={false}` is Settings' choice: it comes back to its list every time, as a phone's Settings
// does, rather than reopening whatever was open last (a deep link still opens its panel).
function Panel({ title, sub, value, id, defaultOpen = false, remember = true, children }: {
  title: string; sub?: string; value?: ReactNode; id: string; defaultOpen?: boolean; remember?: boolean; children: ReactNode;
}) {
  const storeKey = `gt3-mpanel-${id}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!remember) return;
    try { const v = localStorage.getItem(storeKey); if (v !== null) setOpen(v === "1"); } catch { /* ignore */ }
  }, [storeKey, remember]);
  const keep = useCallback((n: boolean) => {
    if (!remember) return;
    try { localStorage.setItem(storeKey, n ? "1" : "0"); } catch { /* ignore */ }
  }, [storeKey, remember]);
  // A deep link asks for this panel by id. Without this, ?a=<id> scrolled to a CLOSED accordion
  // header — it only ever appeared to work for someone whose localStorage remembered opening it by
  // hand. Persisted too (where the panel remembers): having been sent here, you should still find it
  // open next time.
  useEffect(() => {
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setOpen(true);
      keep(true);
    };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, [id, keep]);
  // The write happens beside the state change, not inside its updater (an updater runs twice under
  // StrictMode, and is no place for work).
  const toggle = () => { const n = !open; setOpen(n); keep(n); };
  return (
    <section id={id} className={`mpanel${open ? " open" : ""}`} style={{ scrollMarginTop: 16 }}>
      <button type="button" className="mpanel-h" onClick={toggle} aria-expanded={open}>
        {sub
          ? <span className="mpanel-tt"><span className="mpanel-t">{title}</span><span className="mpanel-s">{sub}</span></span>
          : <span className="mpanel-t">{title}</span>}
        {value != null && <span className="mpanel-v">{value}</span>}
        <span className="mpanel-chev" aria-hidden="true">›</span>
      </button>
      {open && <div className="mpanel-body">{children}</div>}
    </section>
  );
}

// ───────────────────────── settings: every switch, one home ─────────────────────────
// SETTINGS HAS A HOME (2026-10-06, the settings round). Ryan: "Anything that changes a feature should
// be inside of the settings tab … it feels 2/10, scattered." The switches were spread over six
// sections and three floating icons: the payment switches in Money › Get paid, the menu and the plans
// in Money, codes and perks in Customers, invites and Train the AI on Team, Outlook under the
// calendar, the cup-ordering dial on Plan › Route, the mutes behind the inbox's gear, order alerts at
// the bottom of Live Ops, the theme as a floating moon, text size on the rail.
//
// They are here now, in the order a person reaches for them: what is yours, then the business. Every
// panel keeps the gate it had where it came from, and the page is open to every role — so crew see
// only You. Each old spot keeps one line that leads here (components/GoLine). Panels that moved kept
// their ids, so old links still land (lib/panelHome); the new ones are set-*.
//
// A LIST, LIKE A PHONE'S SETTINGS. The first draw opened the big panels at rest — the copy editor,
// Train the AI, invites — and the page ran to fourteen screens, a form wall between the rows. Now each
// group is one grouped list (SetList) of rows, all closed: a title, a line saying what is inside,
// and, where it is one fact, what it is set to now (components/SettingsGlance). Tap a row to change
// it; Settings comes back to its list next time (remember={false}).
//
// BY CATEGORY (2026-10-06, the settings-by-category round). Ryan: "Are the settings even organized?
// … based on categories … industry standard". Three groups — You, Business, Advanced — of one row per
// topic (lib/settingsLayout says why, and holds the order and the gates). A topic's pieces are PARTS
// of its row (SetPart): each keeps the id it had as a row of its own, so every link to it still lands
// — lib/anchors opens the row that holds it first. What the business sells moved to the Catalog;
// a broadcast to Customers › Messages; the changelog to the Guide's What's new.
function SetList({ children }: { children: ReactNode }) {
  return Children.toArray(children).length ? <div className="set-list">{children}</div> : null;
}

/** One piece of a Settings row: its own id (the anchor links name), and a small heading when the
 *  component inside does not carry one of its own. */
function SetPart({ id, label, children }: { id?: string; label?: string; children: ReactNode }) {
  return (
    <div id={id} className="set-part">
      {label && <div className="rdg-row-h set-part-h">{label}</div>}
      {children}
    </div>
  );
}

function SettingsHome({ userId, isAdmin, isOwner }: { userId: string | null; isAdmin: boolean; isOwner: boolean }) {
  const g = useSettingsGlance(userId, isAdmin);
  const v = (x: Glance) => <GlanceText g={x} />;
  const outlook = isOwner ? <OutlookGlance /> : null;
  return (
    <>
      <p className="set-lead">{isAdmin
        ? "Yours first, then the business’s. Tap a row to change it — a change goes live at once, no deploy."
        : "Your account, your notifications, and how the app looks on this phone."}</p>
      <SectionHeader label="You" annotation="you · this phone" />
      <SetList>
        <div id="set-account" className="set-row set-acct"><AccountRow /></div>
        <Panel id="set-notify" title="Notifications" sub="Order alerts and sound on this phone, what pings you, quiet hours" value={v(g.notify)} remember={false}>
          <SetPart id="set-alerts"><DeviceAlerts userId={userId} /></SetPart>
          <SetPart id="set-sound"><PassSound /></SetPart>
          <SetPart label="What pings you"><NotifPrefs userId={userId} /></SetPart>
        </Panel>
        <Panel id="set-display" title="Display" sub="Day, dark or auto; text size, bold, spacing — this phone" value={v(g.display)} remember={false}>
          <SetPart id="set-theme"><Appearance /></SetPart>
          <SetPart><DisplayControls /></SetPart>
        </Panel>
      </SetList>

      {isAdmin && <SectionHeader label="Business" annotation="owners & admins" />}
      <SetList>
        {isAdmin && <Panel id="set-pay" title="Payments & checkout" sub="Card checkout, pay at pickup, subscriptions" value={v(g.pay)} remember={false}><PaymentSettings /></Panel>}
        {isAdmin && (
          <Panel id="set-ordering" title="Ordering & delivery" sub="When cup pre-orders open; office delivery’s price and minimum" value={v(g.ordering)} remember={false}>
            <SetPart id="set-dial"><CupOrderingDial /></SetPart>
            <SetPart id="set-office" label="Office delivery"><OfficeSettings /></SetPart>
          </Panel>
        )}
        {/* 0296/0297 built the readiness engine — eight named checks per city, rolled up into
            can_open — and nothing in the app read it. Opening Atlanta was a SQL-editor operation
            until this panel. Admins see it; opening a city, and its terms, stay the owner's. */}
        {isAdmin && <Panel id="set-markets" title="Locations & markets" sub="Which cities can open — and if not, why not" remember={false}><MarketsPanel /></Panel>}
        {isAdmin && (
          <Panel id="set-team" title="Team & permissions" sub={isOwner ? "Invite someone, who owns each lane, roles" : "Who owns each lane"} value={v(g.lanes)} remember={false}>
            {/* Adding someone and changing a role both happen on Team, where the people are (2026-10-07):
                one door above the roster — components/AddTeammate — and the role on each person's row. */}
            {isOwner && <SetPart id="set-invite" label="Add a teammate"><GoLine to="team" anchor="team-members">Add someone, or change a role</GoLine></SetPart>}
            <SetPart id="set-lanes"><OrgChart part="lanes" /></SetPart>
          </Panel>
        )}
        {isAdmin && <Panel id="set-digest" title="Reports" sub="The founder digest — the business roll-up, and how often" value={v(g.digest)} remember={false}><FounderDigest /></Panel>}
        {/* Enterprise round (2026-08-01): one honest pane of what's connected, admin-only, read-only —
            and, for the owner, connecting Outlook under it. */}
        {isAdmin && (
          <Panel id="set-integrations" title="Integrations" sub={isOwner ? "What the app is connected to, and Outlook" : "What the app is connected to"} value={outlook} remember={false}>
            <IntegrationsPanel />
            {isOwner && <SetPart id="set-outlook" label="Outlook calendar"><OutlookConnect /></SetPart>}
          </Panel>
        )}
        {isAdmin && (
          <Panel id="set-ai" title="AI" sub={isOwner ? "Train the AI, the copilots, and what they cost" : "The copilots, and what they cost"} remember={false}>
            {isOwner && <SetPart id="set-train"><AiTraining /></SetPart>}
            <SetPart label="Copilots"><CopilotDirectory /></SetPart>
            <SetPart id="set-spend" label="What they cost"><AiSpend /></SetPart>
          </Panel>
        )}
        {/* The words guests read and the splash. An event manager keeps the brand kit in Studio ›
            Brand; Studio's line to this editor is drawn for an owner or an admin. */}
        {isAdmin && (
          <Panel id="set-brand" title="Brand & customer app" sub="Every line guests read, and the app’s splash" remember={false}>
            <SetPart id="set-copy"><SiteCopyEditor /></SetPart>
            <SetPart id="splash"><PromoEditor /></SetPart>
          </Panel>
        )}
      </SetList>

      {/* 2026-07-16 scope assessment: the change log, errors and the audit log are tools ABOUT the
          software itself rather than tools for running the business, so they sit last, behind their
          own divider. The reading end of the error intake (0133, lib/errorIntake): every alert that
          says "App error" or "Server error" points at a row that, until that panel, only the SQL
          editor could show. 0306 moved every dropdown's list into the database so the same column
          stopped being a picker on one screen and a text box on another; the lists are edited here,
          or adding a unit means opening the SQL editor. */}
      {isAdmin && <SectionHeader label="Advanced" annotation="about the software" />}
      <SetList>
        {isAdmin && <Panel id="set-admintrail" title="Activity log" sub="Who changed what, and when" remember={false}><AuditTrail /></Panel>}
        {isAdmin && (
          <Panel id="set-errors" title="App health" sub="What broke, and every review run on the app" remember={false}>
            <ErrorLog />
            <SetPart id="set-audit" label="Audits & maintenance">
              <p className="set-lead">Every review run on the app — security, privacy, performance, accessibility, UI cohesion, data — with a score, the date, the prompt used, and when it&apos;s due to run again. Log a new one any time you run a check.</p>
              <MaintenanceLog />
            </SetPart>
          </Panel>
        )}
        {isAdmin && <Panel id="set-lists" title="Data & lists" sub="The choices every picker in the app offers" remember={false}><ListsPanel /></Panel>}
      </SetList>
    </>
  );
}

// Plan's tabs in the order its row shows them — and so the order a sideways swipe turns through them.
const PLAN_PAGES: readonly PlanTab[] = ["calendar", "events", "route", "leads", "vendors"];
const PLAN_LABEL: Record<PlanTab, string> = { calendar: "Calendar", events: "Events", route: "Route", leads: "Leads", vendors: "Vendors" };

export default function AdminPage() {
  const { ready, enabled, user, profile, profileStatus, refreshProfile } = useAuth();
  const { section, setSection, back, canGoBack, groupId: navGroupId, setGroupId } = useOperatorSection();
  const router = useRouter();
  const streams = useWorkStreams();

  // Derive role + nav constants before any conditional return (Rules of Hooks).
  // profiles.role: member/server/operator/event_manager/contractor/admin/owner (0031).
  const role = roleOf(profile);
  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const canManage = isAdmin || role === "event_manager";
  const canPrep = canManage || role === "operator" || role === "contractor";
  const allowed = sectionsForRole(role);
  // Fallback for a section this role can't open is My Day (home), not Live Ops — a server tapping
  // a prep deep-link should land somewhere that explains itself, and the URL/localStorage must not
  // keep re-teleporting her on every cold open.
  const sec: OpSection = allowed.includes(section) ? section : "day";
  const [planTab, setPlanTab] = useState<PlanTab>("calendar");
  // THE GUIDE OPENS ON A PAGE (2026-10-08): "start" — the first day (components/CrewStart) — or
  // "sections", what each section is for. ?guide=start is the welcome letter's link (lib/crewStart
  // START_PATH): read once, in the initializer (the console renders nothing until the session is
  // known, so the first paint cannot disagree with the server's), and taken off the address.
  const [guideAsked] = useState<string | null>(() => readParam("guide"));
  useEffect(() => { if (guideAsked) dropParam("guide"); }, [guideAsked]);
  const [guide, setGuide] = useState<null | "start" | "sections">(() => (guideAsked ? (guideAsked === "sections" ? "sections" : "start") : null));
  const [inboxOpen, setInboxOpen] = useState(false);
  // The header 🔔 badge, for EVERY role (2026-10-04). It was gated on canManage — the leader-only rule
  // 0157 retired for alerts — so a server's bell never loaded while My Day and the nav badge counted
  // her pings from the same hook. The bell is the inbox's one door now; it has to open for everyone.
  const { flags: hdrFlags, critCount: hdrCrit } = useMyAlerts(user?.id ?? null);
  // First-run: the guide explains the console's language (Live Ops, Readiness, Route) — open it
  // once for a brand-new staffer instead of hoping she finds the ⓘ pill. It opens on Start here now
  // (2026-10-08): someone on the crew side for the first time on a phone needs the first day before
  // the vocabulary — and a phone that came by the letter's link has already opened it there.
  useEffect(() => {
    try {
      if (!localStorage.getItem("gt3-guide-seen")) { localStorage.setItem("gt3-guide-seen", "1"); setGuide((g) => g ?? "start"); }
    } catch { /* ignore */ }
  }, []);
  // Cross-route deep link: /crew?s=settings&a=set-copy (or a specific copy group, e.g. sc-craft-page
  // from the owner-only Edit pill on a live page) lands on the right SECTION via
  // OperatorSectionProvider's own ?s= hydration; this consumes the matching ?a= once that section has
  // actually mounted, via the same scrollToAnchor alert links already use. Own ref (not state) so it
  // fires once per page load and never re-triggers on an in-app section change afterward.
  // A link to the Pass (&a=kitchen-pass, 2026-10-06) opens it (jumpTo) — and waits until the
  // address's ?s=now has landed, because "leaving Live Ops closes the Pass" (below) would otherwise
  // close it again on the way in, while the section is still the one this page started on.
  const consumedAnchorRef = useRef(false);
  useEffect(() => {
    if (consumedAnchorRef.current) return;
    const a = readParam("a");
    if (!a) return;
    if (a === PASS_ANCHOR && sec !== "now" && readParam("s") === "now") return;
    consumedAnchorRef.current = true;
    dropParam("a");
    jumpTo(a);
  }, [sec]);
  // The header 🔔 opens the ONE inbox (your flags + the needs-you queue). Any screen can summon it
  // (a badged nav tab, the Now strip) via the gt3-open-inbox event; navigating a section closes it.
  useEffect(() => {
    const open = () => setInboxOpen(true);
    window.addEventListener("gt3-open-inbox", open);
    return () => window.removeEventListener("gt3-open-inbox", open);
  }, []);
  useEffect(() => { setInboxOpen(false); }, [sec]);
  // Utilization (0267): each section visit is an action ping — "last action" reads like
  // "crew:command" in the report. Throttled inside lib/track (1/15s), fire-and-forget.
  useEffect(() => { import("@/lib/track").then((m) => m.trackUser(`crew:${sec}`), () => {}); }, [sec]);
  // Prep drill-in, lifted (2026-07-30): EventPrep drives it, PrepKpis re-scopes its tiles to it —
  // one selection, two readers. Living here (not inside EventPrep) also means stepping out to
  // another section and back no longer loses your place mid-prep.
  const [prepSel, setPrepSel] = useState<PrepTarget | null>(null);
  // Service mode — full-screen KDS (pass + pickups). Esc exits; leaving Now exits.
  const [svc, setSvc] = useState(false);
  useEffect(() => {
    if (!svc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSvc(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [svc]);
  useEffect(() => { if (section !== "now") setSvc(false); }, [section]);
  // THE PASS OPENS FROM A JUMP (2026-10-06, the settings round) — an order alert's Open, or a link
  // that ends &a=kitchen-pass (jumpTo, near alertDest). The Pass is a screen on Live Ops, so the jump
  // goes to Live Ops and opens it, instead of hunting for an id that exists only once it is open.
  useEffect(() => {
    const open = () => { setSection("now"); setSvc(true); };
    window.addEventListener(OPEN_PASS_EVENT, open);
    return () => window.removeEventListener(OPEN_PASS_EVENT, open);
  }, [setSection]);
  // Focus the section region when you switch sections (skip the first render so we don't yank focus
  // on initial load). This USED to say "programmatic focus won't trigger :focus-visible, so there's
  // no stray ring" — and it did, a 2px frame around the whole screen on iPhone, because WebKit never
  // focused the tapped tab and so had no pointer history to suppress the ring with. The ring is
  // suppressed in globals.css (.op-trans:focus-visible) and measured by scripts/design.ratchet.mjs.
  const opBodyRef = useRef<HTMLDivElement>(null);
  const firstSecRef = useRef(true);
  useEffect(() => {
    if (firstSecRef.current) { firstSecRef.current = false; return; }
    opBodyRef.current?.focus();
  }, [section]);
  // deep-link from Studio's "Company calendar ↗" → land on the Plan calendar. Also listens for
  // gt3-plan-tab-set while ON Plan: the calendar's lead/pipeline chips jump to the Leads tab from
  // inside the section, where a sec change alone would never re-run this consume.
  useEffect(() => {
    if (sec !== "plan" || typeof window === "undefined") return;
    // ?t= WINS, exactly the way ?s= wins for the section (OperatorNav's hydrate). That is what makes
    // a Plan tab a place you can link to, bookmark, or send to somebody — it could not be, before,
    // and a link into one broke twice in two different ways because the only mechanism was invisible
    // to anyone writing an href. The localStorage handoff stays as the in-page channel: a jump that
    // does not navigate has no URL to read yet.
    const consume = () => {
      const fromUrl = planTabFromUrl();
      if (fromUrl) { setPlanTab(fromUrl); return; }
      const t = localStorage.getItem(PLAN_TAB_KEY);
      if (isPlanTab(t)) { localStorage.removeItem(PLAN_TAB_KEY); setPlanTab(t); }
    };
    consume();
    window.addEventListener(PLAN_TAB_EVENT, consume);
    return () => window.removeEventListener(PLAN_TAB_EVENT, consume);
  }, [sec]);
  // Keep the address honest: whichever tab is showing is the one in the URL. replaceState, not push
  // — a sub-tab is a label on the entry you are already on, not a new place in history.
  useEffect(() => { if (sec === "plan") stampPlanTab(planTab); }, [sec, planTab]);
  // A BADGE COUNTS WHAT NEEDS YOU, NOT WHAT EXISTS (0316).
  //
  // The Events badge used to count `events where day >= today` — upcoming events. On production it
  // read "1" directly above a panel reading "4 things need sorting", and it was structurally
  // incapable of ever agreeing with it: three of those four are on events whose day has PASSED, and
  // `day >= today` excludes those by construction. That is the exact blind spot the gap panels were
  // built for — "a list sorted by date files 'still confirmed five weeks later' in the past, where
  // nobody scrolls" — reproduced in the one number you see WITHOUT opening the tab.
  //
  // Route had no badge at all while its panel listed five, three of them visible to guests.
  //
  // Both now count their gap view, so the badge and the panel are the same number by construction.
  // Severity rides along: high means somebody is looking at it now (a stale name or a missing pin
  // on the public page), and that gets the loud treatment.
  // Bookings only. The Events and Route badges are gone with the two gap panels they counted —
  // ONE schedule check now lives above the tabs, so a 4 on one tab and a 5 on the other would be
  // two numbers for one list. Their queries went with them rather than being left to run for a
  // badge nobody renders, which is the writer-with-no-reader defect this round exists to remove.
  const [planCounts, setPlanCounts] = useState<{ bookings: number }>({ bookings: 0 });
  useEffect(() => {
    if (sec !== "plan" || !canManage || !supabase) return;
    (async () => {
      const b = await supabase!.from("booking_requests").select("id", { count: "exact", head: true }).eq("status", "new");
      setPlanCounts({ bookings: b.count ?? 0 });
    })();
  }, [sec, canManage, planTab]); // refetch when you switch tabs so badges reflect what you just did

  // This device opens on the crew side from now on, until Customer view or Exit says otherwise
  // (lib/mode.ts). The condition is INSIDE the effect — a hook after the guard returns below is a
  // Rules-of-Hooks violation (the lint ratchet caught exactly that placement) — and it is the same
  // test the guards make, so a member bounced off the console never records "crew".
  useEffect(() => {
    if (enabled && ready && user && staffAccess(true, profileStatus, profile) === "allow") rememberMode("crew");
  }, [enabled, ready, user, profileStatus, profile]);

  // Guard returns — all hooks live above (Rules of Hooks compliant).
  if (!enabled) return <section className="screen"><div className="h-title">Admin</div><div className="h-sub">The live backend isn&apos;t configured here.</div></section>;
  if (!ready) return <section className="screen" />;
  if (!user) return <SignIn />;
  // KNOWING NOTHING IS NOT THE SAME AS KNOWING YOU ARE A CUSTOMER. roleOf(null) is "member", and
  // `ready` only covers the auth session — so between session-ready and profile-loaded, and after
  // any failed profile read, an owner used to be shown "Staff only" and shut out of this console.
  const access = staffAccess(!!user, profileStatus, profile);
  if (access === "wait") return <section className="screen" />;
  if (access === "failed") return (
    <section className="screen">
      <div className="toprow"><div className="eyb">Crew</div><Link className="pf hit-44" href="/">‹</Link></div>
      <div className="h-title">Couldn&apos;t load your account.</div>
      <div className="h-sub">This is not a permissions problem — we couldn&apos;t read your profile just now, so we don&apos;t know what you can see. Nothing has changed.</div>
      <button type="button" className="note-save" style={{ marginTop: 14 }} onClick={() => refreshProfile()}>Try again</button>
    </section>
  );
  if (role === "member") {
    return (
      <section className="screen">
        <div className="toprow"><div className="eyb">Crew</div><Link className="pf hit-44" href="/">‹</Link></div>
        <div className="h-title">Staff only.</div>
        <div className="h-sub">This area is for GT3PB staff. If that&apos;s you, ask the owner to add you — then tap below.</div>
        <button type="button" className="note-save" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>I&apos;ve been added — check again</button>
      </section>
    );
  }

  // The lane the section is in (a section can live in two lanes — prep is Service's and Events' — so
  // the tapped tab, tracked as groupId, wins the ambiguity): its sections are the toggle under the
  // header, and the pages a sideways swipe turns through.
  const lanes = [{ id: "today", label: "Today", members: TODAY_GROUP.members.filter((m) => allowed.includes(m)) }, ...streamGroups(streams, role)];
  const grp = (navGroupId && lanes.find((g) => g.id === navGroupId && g.members.includes(sec))) || lanes.find((g) => g.members.includes(sec));
  const lane = { label: grp?.label ?? "", members: grp ? grp.members.filter((m: OpSection) => allowed.includes(m)) : [] };
  // A move along the lane stays in the lane. Readiness is in Service and in Events: reached from Plan
  // (Events), it is Events' Readiness — the row under the header and the lane lit below keep saying
  // Events, as they do when the lane's own tab was tapped to get there.
  const inLane = (m: OpSection) => { if (grp) setGroupId(grp.id); setSection(m); };

  // Overview's jump links map onto the operator sections — and the Plan sub-tab when relevant,
  // so "Events" actually lands on Plan→Events instead of whatever tab was last open.
  const goSection = (t: string) => {
    const map: Record<string, OpSection> = { events: "plan", vendors: "plan", bookings: "plan", money: "money", members: "team", stops: "plan", tasks: "day" };
    const tab: Record<string, typeof planTab> = { events: "events", vendors: "vendors", stops: "route", bookings: "leads" };
    if (tab[t]) setPlanTab(tab[t]);
    setSection(map[t] ?? "prep");
  };

  return (
    <CrumbProvider>
    <section className="screen admin">
      {/* THE HEADER, ONE KIT (2026-10-07, the pill round). Ryan's My Day at 9:17: five controls, five
          recipes — the mode switch as 10px mono words, a 32px outlined bell, Jump and Guide as 26px
          outlined pills in two colours, Back as a 38px red circle on the right, the loudest thing on
          the screen. Now the way back leads the row, quiet; the mode is a switch that looks like one;
          search, the guide and the inbox are three equal round buttons, the inbox's count ringed on it.
          Every one is 44px to the thumb (components/kit.tsx, app/globals.css "PILLS, ONE KIT"). */}
      <div className="toprow">
        <div className="toprow-lead">
          {/* Back = the previous section within crew mode, shown only when there is one (2026-10-04).
              With no history it used to become "Exit Crew Mode" — a back arrow that flipped the
              device into the customer app — beside the Customer switch that already does that. */}
          {canGoBack && <IconButton icon="chevronLeft" label="Back" onClick={() => back()} />}
          {/* Mode switch — you're in Crew; Customer drops to the customer app ("/"). Leaving is
              remembered (lib/mode.ts), so the app opens on the customer side next time; arriving here
              is remembered below, so it opens here until you leave again. */}
          <Segmented kind="choice" size="sm" label="View mode" value="crew"
            options={[{ key: "crew", label: "Crew" }, { key: "customer", label: "Customer", title: "Customer view — the app as a customer sees it" }]}
            onChange={() => { rememberMode("customer"); router.push("/"); }} />
        </div>
        <div className="toprow-actions">
          {/* Jump — touch entry to the command palette (⌘K on a keyboard). */}
          <IconButton icon="search" label="Jump to a section, recent, or action" hint="⌘K" onClick={() => window.dispatchEvent(new Event("gt3-open-cmdk"))} />
          {/* Section guide — what each section is for + jump there. */}
          <IconButton icon="info" label="Guide — start here, and what each section is for" aria-haspopup="dialog" onClick={() => setGuide("sections")} />
          {/* Inbox — the one place everything that needs you rolls up (flags + needs-you), from any screen. */}
          <IconButton icon="bell" label={hdrFlags.length ? `Inbox — ${hdrFlags.length} for you` : "Inbox"} badge={hdrFlags.length} crit={hdrCrit > 0} onClick={() => setInboxOpen(true)} />
        </div>
      </div>
      {guide && <SectionGuide allowed={allowed} current={sec} start={guide === "start"} onGo={setSection} onClose={() => setGuide(null)} />}
      {inboxOpen && (
        <Sheet open onClose={() => setInboxOpen(false)} label="Inbox" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "Inter", fontSize: 15 }}><Icon name="bell" /> Inbox</b><CloseButton onClick={() => setInboxOpen(false)} /></div>}>
          <AlertsInbox userId={user?.id ?? null} title="Flags & pings for you" onNavigate={() => setInboxOpen(false)} />
        </Sheet>
      )}
      <div className="op-head">
        {/* Breadcrumb trail — only appears once a deep view registers a crumb (e.g. Prep › event). */}
        <Breadcrumbs root={SEC_LABEL[sec]} />
        <div className="op-head-row">
          {/* 2026-07-29 a11y: real per-section h1 (was a div) — AppShell's route-level sr-only h1
              is static ("Crew console") and never reflected which of the 17 sections you were in;
              /crew joined H1_SKIP so this is the one heading now, and it actually updates with sec. */}
          <h1 className="op-head-t">{SEC_LABEL[sec]}</h1>
          {/* The WHEN pill ("START OF SHIFT ⓘ", "DURING SERVICE ⓘ") stood here until 2026-10-04: a
              fixed tagline styled as a status — it said "During service" at 10 PM with the truck
              offline — opening the same guide as the Guide button two inches above it. The guide
              still carries each section's "when" (SEC_WHEN); the title no longer pretends to. */}
        </div>
      </div>

      {/* Secondary toggle — the ACTIVE LANE's sections (a section can live in two lanes — prep is
          Service's and Events' — so the tapped tab, tracked as groupId, wins the ambiguity). */}
      {/* One track, the section you are in on a thumb that slides to the one you tap (2026-10-07, the
          pill round) — three outlined pills before, the chosen one filled. The row shares its width
          equally and scrolls when a lane's names will not fit (the larger text sizes). */}
      {lane.members.length >= 2 && (
        <Segmented fill className="lane-tabs mb-3.5" label={lane.label} value={sec}
          options={lane.members.map((m: OpSection) => ({ key: m, label: SECTION_LABEL[m] }))} onChange={(m) => inLane(m)} />
      )}

      {/* SWIPE BETWEEN TABS (components/SwipePager, 2026-10-05): a sideways swipe on the section turns
          to the lane's next or previous section — and on Plan, to its next or previous tab first,
          Calendar → Events → Route → Leads → Vendors, then on to the lane's next section. Each turn is
          the tap it stands for (setSection / setPlanTab), so the address, history and focus agree. */}
      <SwipePager levels={[
        lane.members.length >= 2 && { keys: lane.members, current: sec, go: (k) => inLane(k as OpSection), depth: 0 },
        sec === "plan" && canManage && { keys: PLAN_PAGES, current: planTab, go: (k) => setPlanTab(k as PlanTab), depth: 1 },
      ]}>
      {/* Shared-axis transition: keying on `sec` remounts the body on each section change so it
          fades+slides in. planTab changes keep the same key, so sub-tabs don't re-animate.
          role=region + focus-on-change: keyboard/SR users land in the new section, not adrift. */}
      <div className="op-trans" key={sec} ref={opBodyRef} tabIndex={-1} role="region" aria-label={`${SEC_LABEL[sec]} section`}>
      {sec === "day" && (
        <>
          {/* P3 (2026-08-03): a leader's day opens with the headline — today's op + top 3 due —
              before the plates. MyDay renders it now (2026-10-04), under the greeting, so the
              greeting opens the screen and today's op has one card for everybody. */}
          <MyDay userId={user?.id ?? null} isLeader={canManage} canGoLive={isAdmin} canBrew={canManage || role === "operator"} />
        </>
      )}
      {sec === "command" && canManage && (
        <>
          {/* GT3 COMMAND (2026-08-03): the Executive OS lands. The portfolio registry LEADS —
              ten workstreams, Monday-audited — then the war room, then goals, then the twelve
              KPIs. One screen = the state of the company; Plan = the cadence that changes it. */}
          <OsRegistry />
          <CommandBoard />
          {/* Goals moved home 2026-07-29 (was its own section): "are we on track?" and "where are
              we steering?" are the same leadership conversation — one screen answers both now.
              Goals keeps its id="goals" anchor, so strategy alerts land right on it.
              PlanningBoard cut 2026-07-30 (redundancy audit): it re-listed every goal card below
              it — same title, progress, owner — as a non-tappable horizon grid, and the horizon
              already sits on each card as its tier chip. One list, one home. */}
          <SectionHeader label="Goals" />
          <Goals />
          <KpiBoard />
        </>
      )}

      {sec === "now" && (
        <>
          {/* Now is the GLANCE + DISPATCH screen: unacked alerts → the service pulse (live counts,
              one tap into the working screen) → the drop's prep face (what to brew, what money) →
              Sunday delivery (folds until run day) → dispatch panels → personal tasks. The boards
              themselves (pass, pickup checklist, 86) render in ONE place: Service mode. */}
          <AlertsInbox userId={user?.id ?? null} compact />
          {!svc && (
            <>
              <ServicePulse onEnter={() => setSvc(true)} />
              {/* The truck instrument rides directly under the pulse — going live IS the first act
                  of service, not a panel below the fold. */}
              {canManage && <LiveControl compact />}
              <DropOps brief onOpen={() => setSvc(true)} canPlan={canManage} />
              <DeliveryOps />
              <OfficeOrders />
            </>
          )}
          {canManage && <Panel id="hud" title="Event heads-up"><EventHUD onGoEvents={() => goSection("events")} /></Panel>}
          <MyTasks userId={user?.id ?? null} chip />
          {/* Turning order alerts on is Settings › You › Notifications › Alerts on this device now (2026-10-06, the
              settings round); here, one line, and only while they are off on this phone. */}
          <AlertsOffLine />
        </>
      )}
      {/* SERVICE MODE — the KDS as ONE working surface: the pass is the board (tickets flow 2-up
          on wide screens), and a sticky rail keeps pickups, the Sunday run sheet and the 86 board
          in reach without ever leaving the screen — 86ing a flavor mid-rush is a tap, not an exit.
          Exit with the button or Esc; leaving the Now section exits too. */}
      {svc && sec === "now" && (
        <div className="svc-full" role="dialog" aria-modal="true" aria-label="The Pass">
          <div className="svc-bar">
            <b>The Pass</b>
            <button type="button" className="svc-exit" onClick={() => setSvc(false)}><Icon name="close" /> Exit</button>
          </div>
          <div className="svc-grid">
            <div className="svc-main"><Kitchen /></div>
            <aside className="svc-rail" aria-label="Pickups & sold-out">
              <DropOps canPlan={canManage} />
              <EightySix />
            </aside>
          </div>
        </div>
      )}

      {sec === "ask" && <OperatorAssistant />}

      {sec === "prep" && canPrep && (
        <>
          {/* Money template: glance-first KPIs → crew-group dividers → the modules. The strip
              re-scopes itself to whichever event/stop is drilled into below (Ryan, 2026-07-30:
              "when a event or truck stop is clicked into the above dashboard should [be]
              dynamic"), and the global all-prep board bows out while a single target has the
              floor — its numbers would contradict the scoped tiles right above it. */}
          <PrepKpis target={prepSel} />
          {!prepSel && <SectionHeader label="All open prep · one board" />}
          {!prepSel && <Panel id="prep-board" title="Work every open task — critical first" defaultOpen><PrepBoard /></Panel>}
          {/* 2026-07-30 (Ryan's screenshot): this screen used to stack the stock-check agent +
              Inspection prep ABOVE the actual work, and an "At a glance" block (Overview)
              summarized the exact target cards rendered right below it. The glance is deleted
              (the cards ARE the glance; live status is Live Ops' job), the stock-check moved home
              to Assets beside the inventory it reads, and Inspection prep — real prep, but
              occasional-use by its own copy — parks at the bottom, collapsed, instead of first. */}
          {!prepSel && <SectionHeader label="Event prep · by stop" />}
          <EventPrep sel={prepSel} setSel={setPrepSel} />
          {!prepSel && canManage && <InspectionPrep />}
        </>
      )}

      {sec === "plan" && canManage && (
        <>
          <div className="subnav" role="tablist" aria-label="Plan">
            {/* This week — what's hot at this stage */}
            {/* Ordered by operating rhythm (not alphabet): when → what → where → requests in →
                production → notes. Back office (rarely touched) sits after the divider. */}
            {/* Route joined Plan 2026-07-29 (was its own "stops" section): an event and a stop are
                the same planned thing — the calendar above already rolls both up, and the customer
                page unified them as field_ops. Planning them in two sections was the seam. */}
            {/* Leads joined Plan 2026-07-30 (Ryan: "Pipeline plan yes") — the last section merge:
                a lead becomes an event becomes a route stop without leaving the section. Operators
                lose lead visibility by Ryan's explicit call (sales is leadership work). */}
            {/* `hot` was defined in globals.css:3286 with a comment saying what it was for —
                "pending bookings = money waiting — always loud" — and never applied to anything.
                Wired here, plus the two gap badges when something on them is guest-visible. The
                `what` word is the accessible name: a bare number tells a screen reader nothing. */}
            {/* The row is drawn from PLAN_PAGES, the order a swipe turns through — one list, so the
                tab a swipe lands on is always the one beside the tab it left. */}
            {PLAN_PAGES.map((k) => {
              // Leads counts the booking requests waiting — money waiting, so always loud when there are any.
              const n = k === "leads" ? planCounts.bookings : 0, hot = n > 0, what = "new booking requests";
              return (
                <Fragment key={k}>
                  {/* Back office — rarely touched — sits after the divider. */}
                  {k === "vendors" && <span className="subnav-div" aria-hidden />}
                  <button type="button" role="tab" aria-selected={planTab === k} className={`subnav-tab hit-y-44${k === "vendors" ? " back" : ""}${planTab === k ? " on" : ""}`} onClick={() => setPlanTab(k)}>
                    {PLAN_LABEL[k]}{n > 0 && <span className={`subnav-badge${hot ? " hot" : ""}`} aria-label={`${n} ${what}`}>{n}</span>}
                  </button>
                </Fragment>
              );
            })}
          </div>
          {/* ONE "needs sorting" list for the whole schedule (0324). It sits ABOVE the tabs, not
              inside one, because it covers both: the Events tab and the Route tab each used to open
              with their own copy of this panel, so flipping between them showed the same construct
              twice with two headlines and two badges — 9 rows describing 6 real problems. The
              placement rule from 0314/0315 still holds and is now stated once: above the list,
              because a list sorted by date will never surface "still marked confirmed five weeks
              after it happened" — it files that in the past, where nobody scrolls. */}
          {(planTab === "events" || planTab === "route" || planTab === "calendar") && (
            <Panel id="schedule-gaps" title="Needs sorting · events &amp; stops" defaultOpen><ScheduleGaps /></Panel>
          )}
          {planTab === "calendar" && (
            <>
              {/* Needs sorting → the calendar → the rituals → discussions (2026-10-02, Ryan: "do all
                  6"). 0263 had put the rituals at the TOP of Plan; two months on, both read
                  "Latest: Aug 2" and sat — a paragraph, a pulse line and two cards — between the
                  problems and the calendar, which is what Plan is opened for. The rituals are
                  weekly and keep their cards; they are just below the thing you came for. */}
              <CompanyCalendar />
              <OperatingRhythm isAdmin={isAdmin} onOpenNotes={() => setSection("notes")} />
              <Panel id="plan-discussions" title="Discussions · every open thread, one place"><Discussions onOpenNotes={() => setSection("notes")} /></Panel>
            </>
          )}
          {planTab === "events" && (
            <div id="plan-events">
              <EventsAdmin />
            </div>
          )}
          {planTab === "route" && (
            <>
              {/* Route is where the truck PARKS. The delivery run — residential porches and
                  corporate office orders — lives in Live Ops (DeliveryOps + OfficeOrders) and is
                  driven from /driver; the word "route" doing both jobs is why that needs saying
                  out loud. See 0324's header. */}
              <LiveControl manage />
            </>
          )}
          {planTab === "leads" && (
            <>
              {/* One lead funnel (typed): inbound booking requests are the intake stage, then the
                  B2B pipeline board, then the Tools zone (Chief of Sales + the deal catalog rides
                  PipelinePanel's own bottom block) — daily flow above, monthly setup below. */}
              <Bookings />
              <SectionHeader id="pipeline-board" label="Pipeline" annotation="accounts being worked — stage by stage to Won" />
              <PipelinePanel isAdmin={isAdmin} />
              <SectionHeader label="Tools" />
              <ChiefOfSales />
            </>
          )}
          {planTab === "vendors" && <VendorsAdmin />}
        </>
      )}

      {/* Crew Plan = the ONE company calendar, read-only (2026-08-01, Ryan: "so I can see
          everything in one stop pane" — and the 10/10 engagement call: every role sees the same
          shared schedule; My Day stays their actionable lens). No subnav — the manage tabs
          (Events/Route/Leads/Vendors) are leadership surfaces. */}
      {sec === "plan" && !canManage && <CompanyCalendar readOnly />}

      {sec === "studio" && canManage && (
        <>
          <Studio />
          <SectionHeader label="Shoots" />
          <Panel id="shoots" title="Shoot planning · shot list &amp; call sheet"><ShootPlanner /></Panel>
          <Panel id="reviews" title="Customer reviews"><ReviewsAdmin /></Panel>
        </>
      )}

      {/* SETTINGS HAS A HOME (2026-10-06, the settings round). It was an owner/admin "control room"
          nothing in the nav opened — only Jump and the Guide reached it. Every role opens it now
          (More › Settings), and each panel inside keeps the gate it had where it came from. */}
      {sec === "settings" && <SettingsHome userId={user?.id ?? null} isAdmin={isAdmin} isOwner={isOwner} />}

      {sec === "money" && isAdmin && (
        <>
          {/* Dashboard, not a filing cabinet: live numbers first, then modules grouped by job. */}
          <MoneyKpis />
          <SectionHeader label="Spend & budget" />
          <Panel id="spend" title="Spend & budget · what the business spends" defaultOpen><SpendBudget /></Panel>
          <SectionHeader label="Get paid" />
          {/* THE PAY PANEL STAYS (2026-10-06, the settings round). The switches it held — card
              checkout, pay at pickup, subscriptions — are Settings › Business › Payments & checkout now. The
              panel keeps its id: a voided paid order raises a refund alert that links
              /crew?s=money&a=pay, and a refund is still Money's — so it keeps the door to them, and
              one line to the switches. */}
          <Panel id="pay" title="Refunds & payment settings" defaultOpen>
            {/* Refunds live in Square by design (the card data never touches this app) — but the
                DOOR to them belongs here (enterprise round P3). */}
            <a className="adm-golink hit-y-44" style={{ display: "inline-block", marginTop: 10 }} href="https://squareup.com/dashboard/sales/transactions" target="_blank" rel="noreferrer">Refunds &amp; disputes — Square Dashboard <Icon name="externalLink" /></a>
            <GoLine to="settings" anchor="set-pay">Payment settings</GoLine>
          </Panel>
          <SectionHeader label="The numbers" />
          {/* Open at rest (2026-10-02, Ryan: "do all 6"): Money used to open on MoneyKpis and then
              seventeen closed titles — the accordion wall. One panel per section opens on its own,
              the one most looked at; here that is Sales. The rest stay folded and remembered. */}
          <Panel id="sales" title="Sales" defaultOpen><Reports /></Panel>
          <Panel id="snapshot" title="Business snapshot"><SnapshotReport /></Panel>
          <Panel id="pnl" title="Per-event P&L"><EventPnlReport /></Panel>
          <Panel id="funnels" title="Funnels · where people drop off"><FunnelReport /></Panel>
          <SectionHeader label="Pricing & margins" />
          {/* What the business sells — the menu, the merch, the lessons — is the Catalog (2026-10-06,
              the settings-by-category round); what each costs and earns stays here. */}
          <GoLine to="catalog" anchor="menu">Menu, merch &amp; lessons</GoLine>
          <Panel id="econ" title="Product economics"><ProductCatalog /></Panel>
          <Panel id="cogs" title="COGS calculator"><CogsCalculator /></Panel>
          <SectionHeader label="Operators" />
          {/* The deal itself: what an operator gets, what they fund, what they earn, and what comes
              back as royalty — built on a slider anchored to the agreed 50/30/20, then sent for their
              response. The money math lives in lib/operatorDeal.ts and is unit-tested. */}
          <Panel id="operators" title="Operator agreements · deals, levels &amp; royalties"><OperatorDeal /></Panel>
          <Panel id="offers" title="Offer letters · hire someone"><OfferLetters /></Panel>
          <SectionHeader label="Members & subscriptions" />
          {/* The plans themselves (id "plans") are the Catalog's (2026-10-06); who subscribed, and who
              asked to, stay with the money. */}
          <GoLine to="catalog" anchor="plans">Membership plans</GoLine>
          <Panel id="subs" title="Subscribers"><Subscribers /></Panel>
          <Panel id="subint" title="Subscription interest"><SubInterest /></Panel>
          <SectionHeader label="Records" />
          <Panel id="resv" title="Reserve drops"><ReservesAdmin /></Panel>
          <Panel id="orders" title="Order history"><OrdersHistory /></Panel>
          {/* The storefront queue. Lives here rather than under Catalog & pricing with the
              merch manager: a paid order is a record with a person attached, not a product. */}
          <Panel id="shoporders" title="The Shop · orders" defaultOpen><ShopOrders /></Panel>
        </>
      )}

      {sec === "notes" && <MeetingNotes />}
      {sec === "brew" && canPrep && <BrewPlanner />}
      {sec === "garage" && canPrep && (
        <>
          <GarageKpis />
          {/* Stock-check agent moved here from Readiness (2026-07-30): "are we stocked for the
              next two weeks" is a question about THIS screen's inventory — it lives with its
              subject now instead of squatting above the prep list. */}
          {canManage && <ReadinessAgent />}
          <SectionHeader label="Assets & stock" />
          <GarageSection />
        </>
      )}
      {sec === "driver" && <DriverDash isLead={canManage} />}

      {/* THE CATALOG (2026-10-06, the settings-by-category round). What the business sells, in one
          section beside Money: the menu, the merch, the lessons, and what members get. They were in
          Settings since the settings round (and Money and Customers before it); Ryan chose the
          store-admin shape — "Move them out" — so Settings holds only how things behave. Every panel
          kept its id; an old link lands here through lib/panelHome. */}
      {sec === "catalog" && isAdmin && (
        <>
          <SectionHeader label="What we sell" />
          <Panel id="menu" title="Menu & products" sub="Every drink and product, its price, and whether it’s on" defaultOpen><MenuManager /></Panel>
          <Panel id="merch" title="The Shop · merch" sub="Shirts and gear in the online shop"><MerchManager /></Panel>
          <Panel id="lessons" title="Return to Primal · lessons" sub="The lessons members can take"><LessonsManager /></Panel>
          <SectionHeader label="Memberships & offers" />
          <Panel id="plans" title="Membership plans" sub="What members pay, and what they get"><PlanEditor /></Panel>
          <Panel id="cust-codes" title="Discount codes" sub="Mint a code, see who used it, turn one off"><CodesPanel /></Panel>
          <Panel id="cust-perks" title="Founding perks" sub="What a founding member gets, and what a VIP gets"><PerksPanel /></Panel>
        </>
      )}

      {sec === "customers" && isAdmin && (
        <>
          {/* Money's 10/10 template: glance-first KPIs → crew-group dividers → uniform Panels. */}
          <CustomerKpis />
          <SectionHeader label="The people" />
          <Panel id="cust-book" title="Customer book · every guest &amp; member" defaultOpen><CrmPanel /></Panel>
          {/* Discount codes and the founding perks (ids "cust-codes", "cust-perks") are the Catalog's
              (2026-10-06): what a member gets is part of what the business sells. One line where they
              were. */}
          <GoLine to="catalog" anchor="cust-codes">Codes &amp; perks</GoLine>
          <SectionHeader label="VIP verification" />
          <Panel id="cust-vip" title="Bottle-owner proofs · verify → Founding" defaultOpen><VipQueue /></Panel>
          {/* MESSAGES (2026-10-06, the settings-by-category round): a broadcast is something the business
              says to its customers, not a setting — so it left Settings for the customer book. */}
          <SectionHeader label="Messages" />
          <Panel id="cust-broadcast" title="Broadcast" sub="A live message or ad, to everyone in the app"><BroadcastEditor /></Panel>
        </>
      )}

      {sec === "team" && isAdmin && (
        <>
          {/* THE PEOPLE FIRST (2026-10-07, Ryan: "Invite and bring team member on seems redundant, bad CSS
              flow"). The page opened on stat tiles and a usage report, listed the same people three
              times (who's on what, the org chart, the roster) and put the way to add someone at the
              bottom, two screens down. Now it opens on the roster with its one door, Add a teammate
              (components/AddTeammate), then who's on what, the structure, and the activity numbers.
              The roster keeps its id: Settings' "Add someone, or change a role" lands on it. */}
          {isOwner && <div id="team-members" style={{ scrollMarginTop: 16 }}><Members /></div>}
          {/* Who owns each lane is Settings › Business › Team & permissions (2026-10-06); an admin's line goes there. */}
          {!isOwner && <GoLine to="settings" anchor="set-lanes">Lane owners</GoLine>}
          <SectionHeader label="Who's on what" />
          <WorkloadBoard />
          {/* Was "Roster" (2026-07-16, ground-up redesign): OrgChart rendered two labeled concerns
              (the org chart's reporting tiers, then work streams' ownership grid). Since 2026-10-06 the
              lane owners are Settings › Business › Team & permissions (OrgChart part="lanes"); the
              picture of the people stays here. */}
          <SectionHeader label="Team structure" />
          <OrgChart part="people" />
          <TeamKpis />
          {/* Utilization (0267, Ryan: "so you don't have to ask me this no more") — who's actually
              IN the system: active days, sign-ins, actions, last-seen per person, plus the
              anonymous guest pulse. Admin-only data by RLS. */}
          <UtilizationPanel />
          <SectionHeader label="Growth & training" />
          {/* Was a flat link with no state, on a page where everything else shows live numbers — so it
              was the one block the eye skipped, and the Academy had zero progress rows for anybody.
              The card now carries the reader's own role path, which lib/academy could already derive. */}
          <AcademyCard />
          {/* Train the AI is Settings › Business › AI now (2026-10-06, the settings round). */}
          {isOwner && <GoLine to="settings" anchor="set-train">Train the AI</GoLine>}
        </>
      )}
      </div>
      </SwipePager>
    </section>
    </CrumbProvider>
  );
}
