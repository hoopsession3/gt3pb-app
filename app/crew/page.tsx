"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Children, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useAppStable } from "@/components/AppProvider";
import { SectionHeader, InfoRow, Columns, Column } from "@/components/kit";
import FoldCard from "@/components/crew/FoldCard";
import { Segmented, IconButton, tabPanel } from "@/components/controls";
import { BackButton } from "@/components/BackButton";
import { useAuth, roleOf, type Profile } from "@/components/AuthProvider";
import { SENIORITY, STAFF_ROLES, roleLabel, tierOf, toRole, canOf, type Role, type Tier } from "@/lib/roles";
import { raiseAlertClient } from "@/lib/clientAlerts";
import { authedFetch } from "@/lib/authedFetch";
import { normalizeCategory, alertWhen, type AlertCategory } from "@/lib/alertKinds";
import { useMyAlerts, type MyFlag } from "@/lib/useMyAlerts";
import { localToday, etToday, relativeDay, ageLabel, evDate, evTime } from "@/lib/dates";
import { prepBucket } from "@/lib/readiness";
import { OPEN_PANEL_EVENT, scrollToAnchor } from "@/lib/anchors";
import { readParam, dropParam } from "@/lib/urlParam";
import { panelHome } from "@/lib/panelHome";
import { useWakeLock } from "@/lib/useWakeLock";
import { unlockAudio } from "@/lib/chime";
import { keepPassOpen, passWasOpen, PASS_OPEN_BEAT_MS } from "@/lib/passOpen";
import { usePassHeartbeat } from "@/components/usePassHeartbeat";
import { useEtDay } from "@/lib/useEtDay";
import { useMinute } from "@/lib/useMinute";
import { NotifPrefs, NotifPrefsSheet } from "@/components/NotifPrefs";
import { DeviceAlerts } from "@/components/DeviceAlerts";
import { RingThisPhone } from "@/components/RingThisPhone";
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
import { useTwoStep } from "@/lib/twoStep";
import { refreshLive, useRealtimeTable } from "@/lib/realtime";
import { useAsyncData } from "@/lib/useAsyncData";
import { useChanged } from "@/lib/useChanged";
import { useLatestRead } from "@/lib/useLatestRead";
import AsyncSection from "@/components/AsyncSection";
import Owed from "@/components/Owed";  // daily path: the overdue list is on the default screen
import HomeNumbers from "@/components/HomeNumbers";  // daily path: the home's three numbers
const MoneyAttention = dynamic(() => import("@/components/MoneyAttention"), { loading: () => <PourFill label="Loading…" /> });  // Money's first screen, under Performance
import TodayList from "@/components/TodayList";      // daily path: the home's Today list
import ComingUp from "@/components/ComingUp";        // daily path: the home's next seven days
import { flagIsToday, rhythmDay, RHYTHM_TABLES } from "@/lib/home";
// Daily path too (2026-10-04): today's op card lives here now, for everybody, so it is a static
// import like the rest of the morning screen — a crew member opening My Day must never wait on a
// chunk to see where they are working (see "Code-split" below).
import DayHeadline from "@/components/DayHeadline";
import EmptyState from "@/components/EmptyState";
import Fence from "@/components/Fence";
import { rememberMode } from "@/lib/mode";
import { useRouter } from "next/navigation";
import { useOperatorSection, sectionsForRole, streamGroups, SECTION_LABEL, TODAY_GROUP, VALID as VALID_SECTIONS, type OpSection } from "@/components/OperatorNav";
import { useTaskSheet } from "@/components/TaskSheet";
import { useRecord } from "@/components/RecordSheet";
import { recordForAlert, TASK_ALERT_KINDS } from "@/lib/records";
import { prepHandoffKey, prepHandoffValue, EVENT_STAGES, isEventStage, stageLabel, type EventStage, eventPiles, newestFirst, dateLine, placeBesideTitle } from "@/lib/eventRecord";
import { WayButtons } from "@/components/RecordWays";
import { goPlanTab, isPlanTab, planTabFromUrl, stampPlanTab, PLAN_TAB_KEY, PLAN_TAB_EVENT, type PlanTab } from "@/lib/planNav";
import SwipePager from "@/components/SwipePager";
import SwipeRow, { type RowAction } from "@/components/SwipeRow";
import LongPress, { useLongPress, RowMenu, type MenuItem } from "@/components/LongPress";
import { useBack } from "@/components/useBack";
import { useBackStep } from "@/components/useBackStep";
import { CrumbProvider, Breadcrumbs, useCrumb, useCrumbs } from "@/components/Crumbs";
import { recordRecent } from "@/components/recents";
import MenuRigChips, { MENU_RIG_COLUMNS, type MenuRigPatch, type MenuRigValue } from "@/components/MenuRigChips";
import { wrote } from "@/lib/wrote";
// ── Code-split (2026-07-29, speed round): every component below renders only inside ONE section
// (or opens on a tap), so it loads as its own chunk on demand instead of riding in the /crew
// route's first paint. Daily-path components (My Day, Live Ops' DropOps/DeliveryOps, the Pass and its 86 board,
// PrepBoard, CommandBoard/Goals) stay static imports on purpose — the morning screen and service
// screen must never wait on a chunk. Once fetched, the SW's cache-first asset rule keeps each
// chunk available offline. next/dynamic on a default export keeps full prop-type inference.
// THE CONSOLE LOADS THE SECTION IT OPENS ON (R13 — the 10/10 audit's performance pass, F11). A phone opening the Pass
// downloaded every section first — 1.76 MB of script, the Academy's whole course text among it (AcademyCard, at the
// foot of Team). My Day, Live Ops and the Pass load with the page; Command, Prep, Money, Customers, Team, the garage
// and the plans' tools come down when they are opened, as the sixty-odd panels below already did.
const TrailerLoadout = dynamic(() => import("@/components/TrailerLoadout"), { loading: () => <PourFill label="Loading…" /> });
import DropOps from "@/components/DropOps";
const ReserveClaims = dynamic(() => import("@/components/crew/ReserveClaims"), { loading: () => <PourFill label="Loading…" /> });
import { reserveStopLabel } from "@/lib/reservePickup";
import ThePass from "@/components/pass/ThePass";
import OfficeOrders from "@/components/OfficeOrders";
const SiteCopyEditor = dynamic(() => import("@/components/SiteCopyEditor"), { loading: () => <PourFill label="Loading…" /> });
const OfficeSettings = dynamic(() => import("@/components/OfficeSettings"), { loading: () => <PourFill label="Loading…" /> });
const MarketsPanel = dynamic(() => import("@/components/MarketsPanel"), { loading: () => <PourFill label="Loading…" /> });
const CopilotDirectory = dynamic(() => import("@/components/CopilotDirectory"), { loading: () => <PourFill label="Loading…" /> });
// The Guide's Start here page (2026-10-08) — loaded when the Guide opens on it, not with the console.
const CrewStart = dynamic(() => import("@/components/CrewStart"), { loading: () => <PourFill label="Loading…" /> });
// An owner's or admin's two-step code (R28, 0433) — loaded only when one is owed.
const TwoStepPrompt = dynamic(() => import("@/components/TwoStepPrompt"), { loading: () => <PourFill label="Loading…" /> });
const AiSpend = dynamic(() => import("@/components/AiSpend"), { loading: () => <PourFill label="Loading…" /> });
const BroadcastEditor = dynamic(() => import("@/components/BroadcastEditor"), { loading: () => <PourFill label="Loading…" /> });
const MaintenanceLog = dynamic(() => import("@/components/MaintenanceLog"), { loading: () => <PourFill label="Loading…" /> });
const OpsPlan = dynamic(() => import("@/components/OpsPlan"), { loading: () => <PourFill label="Loading…" /> });
import NoteAttach from "@/components/NoteAttach";
import { noteAnchor, pendingNoteAsk, clearNoteAsk, onNoteAsk, focusNoteWhenThere } from "@/lib/noteLink";
const Goals = dynamic(() => import("@/components/Goals"), { loading: () => <PourFill label="Loading…" /> });
import { useLocationSuggestions } from "@/components/useLocationSuggestions";
import { completeTask, createEventTask, createEventTasks, deleteTask, deleteTasks, deleteTasksForParent, type NewEventTask, type TaskParent } from "@/lib/tasks";
import { loadMyTasks, type MyTaskRow } from "@/lib/myTasks";
const AiTraining = dynamic(() => import("@/components/AiTraining"), { loading: () => <PourFill label="Loading…" /> });
const PromoEditor = dynamic(() => import("@/components/PromoEditor"), { loading: () => <PourFill label="Loading…" /> });
const ReviewsAdmin = dynamic(() => import("@/components/ReviewsAdmin"), { loading: () => <PourFill label="Loading…" /> });
import DeliveryOps from "@/components/DeliveryOps";
import DueList, { useDueFeeds } from "@/components/crew/DueList";
const PackPlan = dynamic(() => import("@/components/PackPlan"), { loading: () => <PourFill label="Loading…" /> });
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
const CustomerKpis = dynamic(() => import("@/components/CustomerKpis"), { loading: () => <PourFill label="Loading…" /> });
const VipQueue = dynamic(() => import("@/components/VipQueue"), { loading: () => <PourFill label="Loading…" /> });
const FunnelReport = dynamic(() => import("@/components/FunnelReport"), { loading: () => <PourFill label="Loading…" /> });
const TeamKpis = dynamic(() => import("@/components/CrewKpis").then((m) => m.TeamKpis), { loading: () => <PourFill label="Loading…" /> });
const PrepKpis = dynamic(() => import("@/components/CrewKpis").then((m) => m.PrepKpis), { loading: () => <PourFill label="Loading…" /> });
const GarageKpis = dynamic(() => import("@/components/CrewKpis").then((m) => m.GarageKpis), { loading: () => <PourFill label="Loading…" /> });
const PrepBoard = dynamic(() => import("@/components/PrepBoard"), { loading: () => <PourFill label="Loading…" /> });
import InlineCreate from "@/components/InlineCreate";
const Changelog = dynamic(() => import("@/components/Changelog"), { loading: () => <PourFill label="Loading…" /> });
// Settings › You › Account (2026-10-06, the settings-by-category round): the account menu's door, as a
// row — the avatar's own menu and sheets (components/AccountPill useAccountDoor), so it has one home.
const AccountRow = dynamic(() => import("@/components/AccountRow"), { loading: () => <PourFill label="Loading…" /> });
const CommandBoard = dynamic(() => import("@/components/CommandBoard"), { loading: () => <PourFill label="Loading…" /> });
const CommandViews = dynamic(() => import("@/components/CommandFold").then((m) => m.CommandViews), { loading: () => <PourFill label="Loading…" /> });
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
const GetPaid = dynamic(() => import("@/components/GetPaid"), { loading: () => <PourFill label="Loading…" /> });
import SignIn from "@/components/SignIn";
import Sheet, { CloseButton, LeaveButton, sheetOpen } from "@/components/Sheet";
import { NumberRoll } from "@/components/CountUp";
import PourFill from "@/components/PourFill";
import AlertAction, { alertHasInlineAction } from "@/components/AlertAction";
import { supabase } from "@/lib/supabase";
const AskGT3 = dynamic(() => import("@/components/AskGT3"), { loading: () => <PourFill label="Loading…" /> });
const Studio = dynamic(() => import("@/components/Studio"), { loading: () => <PourFill label="Loading…" /> });
const ShootPlanner = dynamic(() => import("@/components/ShootPlanner"), { loading: () => <PourFill label="Loading…" /> });
const MenuManager = dynamic(() => import("@/components/MenuManager"), { loading: () => <PourFill label="Loading…" /> });
const LessonsManager = dynamic(() => import("@/components/LessonsManager"), { loading: () => <PourFill label="Loading…" /> });
const CourseStudents = dynamic(() => import("@/components/nutrition/CourseStudents"), { loading: () => <PourFill label="Loading…" /> });
const MerchManager = dynamic(() => import("@/components/MerchManager"), { loading: () => <PourFill label="Loading…" /> });
const ShopOrders = dynamic(() => import("@/components/ShopOrders"), { loading: () => <PourFill label="Loading…" /> });
const OrderLedger = dynamic(() => import("@/components/OrderLedger"), { loading: () => <PourFill label="Loading…" /> });
const OperatorDeal = dynamic(() => import("@/components/OperatorDeal"), { loading: () => <PourFill label="Loading…" /> });
const OfferLetters = dynamic(() => import("@/components/OfferLetters"), { loading: () => <PourFill label="Loading…" /> });
const ScheduleGaps = dynamic(() => import("@/components/ScheduleGaps"), { loading: () => <PourFill label="Loading…" /> });
const PaymentSettings = dynamic(() => import("@/components/PaymentSettings"), { loading: () => <PourFill label="Loading…" /> });
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
import Prose from "@/components/Prose";
import { packListFor } from "@/lib/packlist";
import { complianceFor } from "@/lib/compliance";
import { projectEvent, reconcile, DEFAULT_ECON, planWords, type EventEcon, type ProductEcon, type Projection, econBreakdown, econBreakdownLabel, type EconDrink } from "@/lib/economics";
import { buildBrief } from "@/lib/eventbrief";
import { fetchInventory, inventoryForEvent, type InventoryResp } from "@/lib/inventory";
import { fetchAssets, type AssetsResp } from "@/lib/assets";
import type { Stop, EventRow, EventTask, BookingRequest, Reserve, Subscription, Vendor, VendorLocation, MeetingNote, NoteAddendum, NoteFile, Comment } from "@/lib/db";
import { uploadToBucket } from "@/lib/uploads";
import { resolveVendor, addVendorLocation, type VendorMatch, type ResolveDecision } from "@/lib/vendorLink";
const VendorResolve = dynamic(() => import("@/components/VendorResolve"), { loading: () => <PourFill label="Loading…" /> });
import Icon, { type IconName } from "@/components/Icon";
import { useJurisdictions } from "@/components/useJurisdictions";
const AcademyCard = dynamic(() => import("@/components/AcademyCard"), { loading: () => <PourFill label="Loading…" /> });
import { money, moneyPlain, moneyRound } from "@/lib/money";
import { FOUNDING_MARKET, toMarket } from "@/lib/markets";
import { setStock as planStock, setLeft as planLeft, goneOf, type StockChange } from "@/lib/reserveStock";
import { OwnerDetails } from "@/components/crew/OwnerDetails";
import VenuePick from "@/components/VenuePickLazy";
import { LocationEditor } from "@/components/crew/LocationEditor";
import { LiveControl } from "@/components/crew/LiveControl";
import { PassRow, ExceptionLine } from "@/components/crew/LiveOpsRows";
import { alertHome } from "@/lib/liveOps";
import { staffAccess } from "@/lib/access";
import { useConfirm } from "@/components/ConfirmSheet";
import { SECTION_TITLE } from "@/lib/routeTitles";
import { announce } from "@/components/Announcer";
import Button from "@/components/Button";
import { scrollMotion } from "@/lib/motion";
import { rovingKeys, rovingTab } from "@/components/roving";
import { eventTotals, type EventTotals } from "@/lib/eventTotals";
import Said from "@/components/Said";
import type { TablesUpdate } from "@/lib/database.types";
import { keyed } from "@/lib/dbTypes";
import { plainFailure, failureWords, failureOr } from "@/lib/failureWords";

// The sections' names have one home now (lib/routeTitles): this heading, the guide, and the title bar's
// title and its ‹ read the same words (2026-10-08, the navigation round).
const SEC_LABEL = SECTION_TITLE;
const SEC_WHEN: Record<OpSection, string> = {
  day: "Start of shift", now: "During service", ask: "When you're stuck", command: "Are we on track?", prep: "Before the event",
  plan: "Booking ahead", studio: "Promoting a drop", brew: "Production days", garage: "Assets & stock", driver: "Delivery days", notes: "Any time", money: "The books", catalog: "Changing what we sell", customers: "Your regulars", team: "People & roles", settings: "Changing how it works",
};
const SEC_SUB: Record<OpSection, string> = {
  day: "Your tasks, flags, needs-you, what's on today & what's coming.",
  command: "The shared board — initiatives, this week, blockers, done, money & goals.",
  now: "The pass, pack pickups & the 86 board — live service.",
  ask: "Recipes, gear, stock & how-to — from the GT3 playbook.",
  prep: "Stock, readiness & the pack list for what's next.",
  plan: "The calendar — and from it, leads, events, truck stops, venues & suppliers.",
  notes: "Notes — private or shared; follow-ups become tasks.",
  studio: "Draft, schedule & post — brand & marketing.",
  brew: "Schedule, start & log brews — sized to what's reserved.",
  garage: "Load-out & tow, gear, maintenance & inventory.",
  driver: "The delivery run — map, list & one big go button.",
  money: "How the business is doing, what needs you, what to do next — then the reports.",
  catalog: "The menu, merch & its orders, reserve drops, lessons, plans, codes & perks.",
  customers: "Every customer — orders, loyalty, members, messages & where people drop off.",
  team: "People, roles, deals & offers, and training.",
  settings: "Your account, notifications & display — and how the business runs.",
};
const SEC_MORE: Record<OpSection, string> = {
  day: "Your personal launchpad — the console's one glance screen. Everything assigned to you, everything flagged for your attention, the deadlines that are yours, and (for leadership) booking replies and restock lows — then what's coming: the events, stops and dated tasks of yours in the next seven days. The team's late work is on Command, with who each task is waiting on.",
  command: "The shared war room both founders see — the digital version of the magnetic board. Your initiatives (a dated program like the Aug-1 launch) with a countdown and milestone progress, then This Week, Blockers, Done and Money in one glance. This is where you answer “are we on track?” together, instead of over text. Company goals live here too — owners, progress and check-ins — so the scoreboard and the steering wheel share one screen.",
  now: "The glance before the work. Alerts land here, the service pulse shows what's waiting (orders on the pass, items 86'd), and one tap opens The Pass — the working screen with the pass board, pickup checklist and 86 board. Prep lives here too: the drop's brew sheet and Sunday delivery.",
  prep: "Get ready before you roll. Build the pack list, check stock and readiness, and sign off that the truck's loaded for the next event or stop.",
  plan: "The forward calendar — Plan opens on it. Add an event or a truck stop on any day and open anything on it; work the leads — incoming booking requests and the sales board — behind Leads; and keep the full lists of events, truck stops, venues and suppliers behind Lists, weeks and months out. The whole arc lives here: a lead becomes an event becomes a stop, without changing sections.",
  notes: "Every note, yours and the team's. Jot one for yourself (🔒 just me), share one with the crew, or file a meeting recap — tag follow-ups and they land in people's tasks with a ping. The ✦ button jots one from any screen.",
  studio: "Your marketing studio. Draft posts and flyers, keep them on-brand, plan the feed, schedule around your drops, and moderate the guest reviews that feed the truck display.",
  brew: "Production's home. Schedule brews sized to demand, hit start-by deadlines, log every batch — with coverage, serve-by and stock checks right on the card.",
  garage: "The physical operation: trailer load-out & tow plan, the gear library, asset maintenance, and inventory with pars.",
  driver: "Run day, from the wheel: how many porches, where, and one tap into driver mode with the map and run list.",
  money: "The books, in three answers. Performance — the week's sales and margin against last week's, what customers owe you, and the next drop. Needs attention — a shop order waiting on us, a chargeback's date, a late invoice, a refund Square and the app disagree about, a budget over its line, worst first. Do next — log a purchase, get paid. Then the reports and the records, one row each. How people pay is set in Settings; what we sell, and the shop's orders, are the Catalog.",
  catalog: "What the business sells, in one place: the menu and its products, the merch in the Shop and the orders waiting to be sent, the limited reserve drops, the Return to Primal lessons, and what members get — membership plans, discount codes and founding perks. What each costs and earns stays in Money.",
  customers: "Your customer book. Every person who's ordered — cup, pickup or delivery, with or without an account — with their history, loyalty and contact info in one place. Messages is here too: a live broadcast to everyone in the app. And the members — who pays monthly, who asked for a plan — and the funnels: where people drop off.",
  team: "Your people. The roster — change someone's role and access right on their row — who's on what, the org chart, operator deals and offer letters, and training. Inviting someone new, who owns each lane and training the AI are in Settings.",
  ask: "Your pocket brain. Ask anything about recipes, the why, gear, stock or how-to and get an answer from the GT3 playbook — from any screen.",
  // THE GUIDE SAYS WHAT SETTINGS HOLDS (2026-10-06, the settings round; by category the same day). It
  // used to call Settings "the owner control room" holding "promos & codes" — the codes were in
  // Customers — and Money's list said the pay-at-pickup switch governed delivery, which PaymentSettings
  // itself says it does not: delivery is always prepaid. Both lists say the layout now, group by group.
  settings: "How the app and the business behave, by category — the way a phone's Settings reads. You — your account, notifications and display — is everyone's. Owners and admins see Business under it: payments & checkout, ordering & delivery, locations & markets, team & permissions, reports, integrations like Outlook, the AI, and the brand guests see. Advanced is about the software itself: the activity log, app health and the lists every picker offers. What the business sells is the Catalog, and a broadcast is Customers › Messages. Each thing's old spot keeps a line that brings you to it. Edits go live instantly, no deploy.",
};
const SEC_INSIDE: Record<OpSection, string[]> = {
  day: ["Your open tasks & due dates", "Alerts flagged for you — with discussion threads", "Needs you — the deadlines that are yours; booking replies & restock for leadership", "What's on the calendar today", "Coming up — your next 7 days: events & stops you're on, dated tasks", "Day-of brief — dress code & call time"],
  command: ["The portfolio — ten workstreams, one owner each, audited every Monday /10", "Initiatives — a dated program with countdown & milestone progress + the goals it serves", "This week — everything due across both task lists", "Blockers — incidents, overdue work & at-risk goals", "Done this week — momentum at a glance", "Goals — owners, live numbers, one-tap check-ins", "The twelve — the Playbook's KPI board, Monday entry"],
  now: ["Service pulse — live counts, one tap into the working screen", "The Pass — the pass board (guests ping it: on my way · outside · late), pickup checklist & 86 board on ONE screen", "The drop — brew sheet & window money (the checklist lives in Service)", "Delivery run — run sheet, brew totals & packout (outcomes are logged in driver mode)", "Live truck: go live, GPS broadcast (locations live in Plan › Lists › Truck stops; the cup-ordering dial in Settings)", "Alerts & your tasks — pointers into My Day"],
  prep: ["Per-event & per-stop pack lists", "Readiness & inspection checks", "Crew assignments & sign-off", "Load-out & gear moved to Production › Assets"],
  plan: ["The company calendar — + on any day adds, a tap opens anything on it", "Leads — booking requests & the sales board (lead → live → expand)", "Lists — every event; truck stops: locations & go live (the cup-ordering dial is in Settings); venues & suppliers"],
  notes: ["Private notes — 🔒 just for you", "Team notes & meeting recaps", "Follow-ups → assigned tasks", "✨ Transcript → summary"],
  studio: ["Post & flyer drafting", "Brand kit — logo, palette, fonts & voice (the words guests read are edited in Settings)", "Feed planning grid", "Repurpose engine", "Publishing & scheduling", "Review Desk → the truck display (/display): add or approve reviews; ✨ Simplify de-claims + trims one to display-safe"],
  brew: ["Brew schedule with start-by deadlines", "Coverage — makes vs reserved", "Serve-by freshness windows", "Batch log & recipes"],
  garage: ["Load-out & tow plan", "Gear library — manuals & specs", "Asset maintenance & what's due", "Inventory — stock, costs & pars"],
  driver: ["Next run — porches & zips", "Driver mode — map & run list", "The ONE place outcomes are logged (swap · fresh · hold · not home)"],
  customers: ["Customer list — guests & members", "Cross-channel order history (cup · pickup · delivery)", "Loyalty — points & credit", "Contact info for outreach", "Messages — a live message or ad, to everyone in the app", "Members — who pays monthly, and who's waiting for a plan", "Funnels — where people drop off"],
  money: ["Performance — sales & margin on last week, what's owed to you, the next drop", "Needs attention — waiting shop orders, chargebacks, late invoices, refunds that disagree, budgets over", "Do next — log a purchase; get paid: what's owed, chargebacks & refunds (made in Square; the switches are in Settings)", "Reports — sales, events, subscriptions, margins by product & COGS, spend vs budget", "Records — order history; the shop's orders are in the Catalog", "The Playbook (/playbook, owners) — every growth play + where its numbers land here"],
  catalog: ["Menu & products — every drink and product, its price, and whether it's on", "The Shop · merch — and its orders: send, ship, refund", "Reserve drops — the limited drops, and who is owed one", "GT3 Nutrition · students — who has the course, how far along; give it, export it", "GT3 Nutrition · lessons — write and publish them", "Membership plans — what members pay, and what they get", "Discount codes — mint one, see who used it, turn one off", "Founding perks — what a founding member gets, and what a VIP gets"],
  team: ["Staff roster — change a role on the person's row", "Who's on what & the org chart", "Deals & offers — operator agreements and offer letters", "Training & academy", "Manager approvals", "Invites, lane owners & Train the AI — in Settings"],
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

// ───────────────────────── the pass (KDS) ─────────────────────────
// THE PASS IS ITS OWN MODULE (2026-10-11, the KDS program, wave 2): components/pass — ThePass (the screen: its bar, the
// board, the rail), Ticket (one ticket) and usePassBoard (the read, the feed, the reconcile) — on lib/passBoard's rules.
// Live Ops below keeps only the mount: `svc`, Escape, the wake lock.

// ───────────────────────── service pulse: the glance before the work ─────────────────────────
// THE PASS'S ROW (2026-10-12, the Live Ops round, approved). The pulse was a gold hero button — "▶ The Pass" over "The
// pass is clear · 2 86'd — tap to work" — and this phone's alerts-off line and the Devices card were two more blocks
// under the truck. It is one row now, components/crew/LiveOpsRows PassRow: "Pass clear · 2 86'd · 2 phones can ring" or
// "3 on the Pass · 1 ahead", the phones' trouble in words on it and their rows one tap away; a tap opens the Pass.
// Counted as it was (lib/passBoard readPulse: the Pass's own lanes), and a count that did not answer is said.

// DUE NEXT (2026-10-11, the KDS audit — Ryan: "KDS x Dispatcher deliveries, only — right call?"). Live Ops' second
// half: what leaves the truck besides the cups — the pickup drop, the Sunday porches, the office route — as one list,
// the soonest first. Each card still folds to one row until its day (components/crew/FoldCard) and says its own day;
// it reports that day here (onDue), so the order follows the calendar rather than the code. A card with nothing
// scheduled goes last, or hides, as it always has.
// ONE LIST ABOVE THEM (2026-10-11, the dispatch round): every pack, porch, office stop and cup placed ahead, soonest
// first, one row each and in words; a row opens its card (components/crew/DueList, lib/dueNext). Each card hands up the
// rows it read (onRows) — the list reads no table twice and cannot disagree with the card below it.
// THE DROP IS A ROW OF THE LIST (2026-10-12, the Live Ops round, approved): its card sat under the list, so on a quiet
// day "Nothing due next." stood over "Pickup drop · This Sat · no reservations yet". The list draws it among its rows, by
// its day (components/crew/DueList `drop`); the porches and the office route stay cards under it, in the order due.
type DueKey = "drop" | "porch" | "office";
const DUE_KEYS: DueKey[] = ["drop", "porch", "office"];
function DueNext({ canPlan, onOpenPass }: { canPlan: boolean; onOpenPass: () => void }) {
  const [due, setDue] = useState<Record<DueKey, string | null>>({ drop: null, porch: null, office: null });
  const report = useMemo(() => {
    const at = (k: DueKey) => (day: string | null) => setDue((d) => (d[k] === day ? d : { ...d, [k]: day }));
    return { drop: at("drop"), porch: at("porch"), office: at("office") };
  }, []);
  const { feeds, report: rows } = useDueFeeds();
  const order = [...DUE_KEYS].sort((a, b) => (due[a] ?? "9999-12-31").localeCompare(due[b] ?? "9999-12-31"));
  const card: Record<DueKey, ReactNode> = {
    drop: <DropOps key="drop" brief onOpen={onOpenPass} canPlan={canPlan} onDue={report.drop} onRows={rows.pickup} />,
    porch: <DeliveryOps key="porch" onDue={report.porch} onRows={rows.porch} />,
    office: <OfficeOrders key="office" onDue={report.office} onRows={rows.office} />,
  };
  return (
    <section aria-label="Due next" className="due-next">
      <SectionHeader label="Due next" annotation="pickups · porches · office · cups ahead" />
      <DueList feeds={feeds} onOpenPass={onOpenPass} drop={card.drop} />
      {order.filter((k) => k !== "drop").map((k) => card[k])}
    </section>
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
  const { toast } = useAppStable();
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
    const patch: TablesUpdate<"content_items"> = { status };
    if (caption !== (item?.caption ?? "")) patch.caption = caption;           // revise inline
    if (status === "changes") patch.review_note = note.trim();
    // Approved — or changes asked for — only once the post says so (R12b, F4): the maker was told either way.
    if (!wrote(await supabase.from("content_items").update(patch).eq("id", contentId), toast, status === "approved" ? "Couldn't approve it" : "Couldn't send the changes")) { setBusy(false); return; }
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
              <button type="button" className="btn-pri flex-1" disabled={busy} onClick={() => decide("approved")}>{busy ? "…" : <><Icon name="check" /> Approve</>}</button>
              <button type="button" className="btn-sec btn-sm" disabled={busy} onClick={() => decide("changes")}>Request changes</button>
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
    <Sheet open onClose={onClose} label="This week’s drop" header={<div style={{ display: "flex", alignItems: "center" }}><span>This week&rsquo;s drop</span><button type="button" className="drop-sheet-x hit-44" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>}>
        <DropOps canPlan={canPlan} />
        <button type="button" className="btn-sec btn-wide mt-3" onClick={onClose}>Done</button>
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
  const { toast } = useAppStable();
  const meName = profile?.display_name?.trim() || "Me";
  // One source of truth for "what needs me" — the same hook drives My Day's flags and the nav
  // badge, so the three counters that used to disagree now agree by construction. Ack semantics
  // live in the hook: row-ack for targeted alerts, per-user read for broadcasts (0157).
  // SOMEBODY HAS IT (2026-10-12, 0383): the first Got it on a team alert is a claim, and a team alert someone
  // else has comes apart (`claimed`, its words on `claim`: "Max has it"). It is listed after everything still
  // open and counted nowhere: the number here, Clear all and the service strip are the open ones'.
  const { flags: open, claimed, held, critCount: crit, error: readErr, reload, ack, clearAll, clearHeld, snooze, restore, unsnooze } = useMyAlerts(userId);
  const mine = useMemo(() => [...open, ...claimed], [open, claimed]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const streams = useWorkStreams();
  const myLane = (cat: string | null) => streams.some((s) => s.owner_user_id === userId && s.categories.includes(normalizeCategory(cat)));
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // The counts are read for the alerts listed: again when that list changes — not on every read of the alerts — and when
  // a comment on one of them changes — not on every comment anywhere in the business (R13 — the 10/10 audit, F15).
  const ids = useMemo(() => mine.map((r) => r.id).sort().join(","), [mine]);
  const readCounts = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const loadCounts = useCallback(() => readCounts(() => commentCounts("alert_id", ids ? ids.split(",") : []), setCounts), [readCounts, ids]);
  useEffect(() => { loadCounts(); }, [loadCounts]);
  useRealtimeTable({ table: "comments", filter: `alert_id=in.(${ids})` }, loadCounts, { enabled: !!ids });
  // Respond immediately: reservation alerts pop the drop sheet right here; everything else jumps
  // to the screen that owns it.
  const [dropSheet, setDropSheet] = useState(false);
  const [reviewPost, setReviewPost] = useState<{ id: string; alert: MyFlag } | null>(null);
  const { openRecord } = useRecord();
  const { openTask } = useTaskSheet();
  // AN ALERT OPENS ONLY WHERE ITS READER CAN GO (2026-10-12, the Live Ops round, approved). Open went to the section that
  // owns the alert whoever was reading, and a section the reader's role cannot open falls back to My Day (AdminPage's
  // `sec`): a server's "Paid order didn't record" (Money's) landed on My Day. The home counts only when this role can
  // open it (components/OperatorNav sectionsForRole, lib/liveOps alertHome); otherwise the alert opens its record or
  // task, or stays here in the inbox, its words the content — Open is not drawn.
  const reachable = sectionsForRole(roleOf(profile));
  const destOf = (a: MyFlag) => alertHome(alertDest(a.category, a.title, a.link), reachable);
  // Whether Open has anywhere to go — the record or task an alert names, or the screen that owns it.
  const canOpen = (a: MyFlag) => !!recordForAlert(a.kind, a.subject_id)
    || (!!a.kind && TASK_ALERT_KINDS.includes(a.kind) && !!a.subject_id)
    || alertIsReservation(a.title) || alertIsContentReview(a.title) || destOf(a) != null;
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
      toast("Couldn't find that post — it may have been removed. Check Brand.", "error");
      return;
    }
    const d = destOf(a);
    if (!d) return;              // homeless alert, or a home this role can't open — the card is the content; Open isn't rendered for these
    onNavigate?.();              // close the inbox sheet FIRST — else the destination renders behind it
    if (d.planTab && isPlanTab(d.planTab)) { goPlanTab(d.planTab, { setSection }); } else { setSection(d.section); }
    jumpTo(d.anchor);            // a panel is scrolled to and opened; the Pass is opened (jumpTo)
  };

  const rank = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
  const sorted = [...open].sort((a, b) => rank(a.severity) - rank(b.severity));
  const rows = [...sorted, ...[...claimed].sort((a, b) => rank(a.severity) - rank(b.severity))];

  // GOT IT, LATER — AND UNDO (2026-10-05, the gesture round). The ✓ and the clock, and the swipes that
  // stand for them, go through these: the flag goes at once, the toast says so with an Undo that
  // brings it back, and a write the database refused is said instead of the flag quietly returning on
  // the next read.
  const said = (t: string) => (t.length > 34 ? `${t.slice(0, 33).trimEnd()}…` : t);
  const clear = async (a: MyFlag) => {
    // A team alert nobody has is yours once you tap Got it, and the team sees it is (0383).
    toast(`${!a.target_user_id && !a.claim ? "You have it" : "Cleared"}: ${said(a.title)}`, "success", { action: { label: "Undo", run: () => { void restore([a]).then((e) => { if (e) toast(`Couldn't bring it back — ${e}`, "error"); }); } } });
    const e = await ack(a);
    if (e) toast(`Couldn't clear it — ${e}`, "error");
  };
  const later = async (a: MyFlag) => {
    toast(`Snoozed for an hour: ${said(a.title)}`, "success", { action: { label: "Undo", run: () => { void unsnooze(a).then((e) => { if (e) toast(`Couldn't bring it back — ${e}`, "error"); }); } } });
    const e = await snooze(a, 3600_000);
    if (e) toast(`Couldn't snooze it — ${e}`, "error");
  };
  const clearEvery = async () => {
    const all = [...open];
    toast(`Cleared ${all.length}`, "success", { action: { label: "Undo", run: () => { void restore(all).then((e) => { if (e) toast(`Couldn't bring them back — ${e}`, "error"); }); } } });
    const e = await clearAll();
    if (e) toast(`Couldn't clear them — ${e}`, "error");
  };

  // Compact strip (used in Now) — alerts have ONE home, the inbox. Opens it RIGHT HERE via
  // gt3-open-inbox (any screen can summon it) instead of routing through My Day first — the exact
  // bounce the alerts round killed (2026-08-01 audit).
  // ONE ALERT NUMBER (2026-10-10, the Live Ops fold). It said "12 alerts need you" two inches under a bell
  // that said 3: the bell counts today (lib/home flagIsToday), the strip counted the thirty days behind
  // it. The count is the bell's alone now. The strip is for what must interrupt service — a critical
  // alert of today, by its name — and is silent otherwise; the inbox behind both still lists them all.
  if (compact) {
    const today = localToday();
    const hot = sorted.filter((f) => f.severity === "critical" && flagIsToday(f, today));
    if (hot.length === 0) return null;   // during quiet hours the held digest stays off the service strip
    return (
      <button type="button" className="alerts-strip crit" onClick={() => window.dispatchEvent(new Event("gt3-open-inbox"))}>
        <span className="alerts-strip-i" aria-hidden><Icon name="warning" /></span>
        <span className="alerts-strip-t"><b>{hot[0].title}</b>{hot.length > 1 ? ` · and ${hot.length - 1} more` : ""}</span>
        <span className="alerts-strip-go">Open <Icon name="arrowRight" /></span>
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
          <EmptyState role="alert" title="Couldn't check your inbox" sub={`${failureWords(readErr)} This is not "all caught up" — the read did not answer.`}
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
        {open.length > 0 && <span className={`k-count${crit ? " due" : ""}`}>{open.length}{crit ? ` · ${crit} critical` : ""}</span>}
        {open.length > 1 && <button type="button" className="btn-ter" onClick={() => clearEvery()}>Clear all</button>}
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
                    <span className="digest-item-t">{a.title}{a.claim && <span className="k-tag ok txt ml-1.5">{a.claim}</span>}<span className="alert-when">{ageLabel(a.created_at)}</span></span>
                    {a.body && <span className="digest-item-b">{a.body}</span>}
                  </button>
                  <button type="button" className="digest-item-x" onClick={() => ack(a)} aria-label={`Dismiss ${a.title}`}><Icon name="close" /></button>
                </div>
              ))}
              <button type="button" className="btn-ter self-start" onClick={() => clearHeld()}>Mark all read</button>
            </div>
          )}
        </div>
      )}

      {/* Each flag swipes the way a Mail row does (components/SwipeRow): left for Later and Got it — a
          long swipe clears it — right to open what it names. A long press raises the same, by name
          (components/LongPress). The buttons stay; the swipe and the press are the fast ways to them.
          A team alert someone else has comes after the open ones, saying who (0383); Got it on it is
          yours alone — it leaves your list, and the claim stays theirs. */}
      {rows.map((a) => (
        <SwipeRow key={a.id} className="alert-swipe"
          lead={canOpen(a) ? [{ key: "open", label: "Open", icon: "arrowRight", tone: "info", run: () => gotoAlert(a) }] : []}
          trail={[
            ...(a.severity !== "critical" ? [{ key: "later", label: "1 hour", icon: "clock", tone: "warn", removes: true, run: () => { void later(a); } } satisfies RowAction] : []),
            { key: "clear", label: "Got it", icon: "check", tone: "ok", removes: true, run: () => { void clear(a); } },
          ]}>
        <LongPress title={a.title} items={[
          ...(canOpen(a) ? [{ key: "open", label: "Open", icon: "arrowRight", run: () => gotoAlert(a) } satisfies MenuItem] : []),
          ...(counts[a.id] ? [{ key: "discuss", label: openThread === a.id ? "Hide the discussion" : "Discuss", icon: "chat", run: () => setOpenThread(openThread === a.id ? null : a.id) } satisfies MenuItem] : []),
          ...(a.severity !== "critical" ? [{ key: "later", label: "Snooze for an hour", icon: "clock", run: () => { void later(a); } } satisfies MenuItem] : []),
          { key: "clear", label: "Got it", icon: "check", run: () => { void clear(a); } },
        ]}>{(press) => (
        <div className={`alert sev-${a.severity}`}>
          <div {...press.bind} className="alert-row pressable">
            {/* The words that name the thing open it (2026-10-04): only the small Open button used
                to, and "New reservation · Jess reserved a 6-pack…" was dead text beside it. */}
            {(() => {
              const main = (
                <>
                  <span className="alert-title">{a.title}{myLane(a.category) && <span className="myday-lane">your lane</span>}{a.claim && <span className="k-tag ok txt ml-1.5">{a.claim}</span>}{(a.occurrences ?? 1) > 1 && <span className="k-tag ml-1.5" title={`Happened ${a.occurrences} times${a.last_seen_at ? `, last ${ageLabel(a.last_seen_at)}` : ""}`}>×{a.occurrences}</span>}<span className="alert-when">{ageLabel(alertWhen(a))}</span></span>
                  {a.body && <span className="alert-body">{a.body}</span>}
                </>
              );
              return canOpen(a)
                ? <button type="button" className="alert-main alert-main-go" onClick={() => gotoAlert(a)}>{main}</button>
                : <div className="alert-main">{main}</div>;
            })()}
            {counts[a.id] ? <button type="button" className="alert-discuss" onClick={() => setOpenThread(openThread === a.id ? null : a.id)} aria-label="Discuss"><Icon name="chat" /><span className="cmt-count">{counts[a.id]}</span></button> : null}
            {canOpen(a) && (
              <button type="button" className={alertHasInlineAction(a.kind) ? "btn-sec btn-sm shrink-0" : "btn-pri btn-sm shrink-0"} onClick={() => gotoAlert(a)}>{alertHasInlineAction(a.kind) ? "Open" : <>Open <Icon name="arrowRight" /></>}</button>
            )}
            {a.severity !== "critical" && <button type="button" className="k-icon-btn shrink-0" onClick={() => { void later(a); }} aria-label="Snooze 1 hour" title="Snooze 1 hour"><Icon name="clock" /></button>}
            <button type="button" className="k-icon-btn shrink-0" onClick={() => { void clear(a); }} aria-label="Got it"><Icon name="check" /></button>
          </div>
          {alertHasInlineAction(a.kind) && <AlertAction flag={a} meId={userId} onResolved={() => ack(a)} />}
          {openThread === a.id && (
            <CommentThread subject={{ col: "alert_id", id: a.id }} notifyIds={[a.target_user_id, a.created_by]} label={a.title} meId={userId} meName={meName} />
          )}
        </div>
        )}</LongPress>
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
  const { toast } = useAppStable();
  const [comments, setComments] = useState<Comment[]>([]);
  const [cmtFailed, setCmtFailed] = useState(false);
  const [staff, setStaff] = useState<{ id: string; display_name: string | null; role?: string | null }[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // @ is a pick list (lib/mentions): who each inserted @token stands for, by id.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const replyRef = useRef<HTMLInputElement | null>(null);

  const read = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const load = useCallback(() => read(async () => (supabase
    // "No notes on this stop" is a claim about the record, not about the network. Say which.
    ? await supabase.from("comments").select("*").eq(subject.col, subject.id).order("created_at")
    : null), (r) => {
    if (!r) return;
    if (r.error) { setCmtFailed(true); return; }
    setCmtFailed(false);
    setComments((r.data as Comment[]) ?? []);
  }), [read, subject.col, subject.id]);
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
    const { error } = await supabase.from("comments").insert({ ...keyed(subject.col, subject.id), body: sent, author_id: meId, mentions: mentionIds });
    setSending(false);
    if (error) { toast(failureWords(error), "error"); return; }
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
    // A refused delete puts the comment back (R12b, F4): it vanished here and stayed for everyone else.
    if (!wrote(await supabase.from("comments").delete().eq("id", c.id), toast, "Couldn't delete the comment")) load();
  };

  return (
    <div className="cmt">
      {cmtFailed && (
        <p className="load-failed">
          <Said as="span" assertive>Couldn&apos;t load the notes — this is not &ldquo;no notes&rdquo;.</Said>{" "}
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
        <Button type="button" kind="primary" compact onClick={send} disabled={!text.trim() || sending}>Send</Button>
      </div>
      {choices.length > 0 && (
        <div className="ts-chips" role="group" aria-label="Who to notify">
          {choices.map((p) => (
            <button key={p.id} type="button" className="k-chip" onClick={() => {
              const next = insertMention(text, p);
              setText(next.text); setPicked((x) => ({ ...x, [p.id]: next.token }));
              // Back to the box, at the end — the keyboard stays up and the sentence carries on.
              requestAnimationFrame(() => { const el = replyRef.current; if (el) { el.focus(); el.setSelectionRange(next.text.length, next.text.length); } });
            }}>{crewLabel({ display_name: p.display_name, role: staff.find((x) => x.id === p.id)?.role ?? null })}</button>
          ))}
        </div>
      )}
      {(reachIds.length > 0 || reach.unresolved.length > 0) && (
        <Said as="p" className="od-note" style={{ marginTop: 4 }}>
          {reachIds.length > 0 && <>Notifies {reachIds.map((id) => firstOf(id)).join(", ")}. </>}
          {reach.unresolved.length > 0 && <>{reach.unresolved.join(", ")} {reach.unresolved.length === 1 ? "reaches" : "reach"} nobody — pick from the list after typing @.</>}
        </Said>
      )}
    </div>
  );
}

// ───────────────────────── pre-flight readiness ─────────────────────────
// ───────────────────────── my tasks: what's assigned to me, by priority ─────────────────────────
// The row and its one read live in lib/myTasks (2026-10-09, One home): the home's Today list reads
// the same plate.

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
  const { toast } = useAppStable();
  type Inc = { id: string; problem: string; severity: string; resolved: boolean; created_at: string; symptom: string | null };
  const [rows, setRows] = useState<Inc[]>([]);
  const [incFailed, setIncFailed] = useState(false);
  const read = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const load = useCallback(() => read(async () => (supabase
    ? await supabase.from("incident_log").select("id, problem, severity, resolved, created_at, symptom").eq(ownerCol, ownerId).order("created_at", { ascending: false })
    : null), (r) => {
    if (!r) return;
    if (r.error) { setIncFailed(true); return; }
    setIncFailed(false);
    setRows((r.data as Inc[]) ?? []);
  }), [read, ownerCol, ownerId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeTable({ table: "incident_log", filter: `${ownerCol}=eq.${ownerId}` }, load);
  const toggle = async (r: Inc) => {
    if (!supabase) return;
    setRows((p) => p.map((x) => x.id === r.id ? { ...x, resolved: !x.resolved } : x));
    // Refused, the incident goes back to where it stood (R12b, F4): a blocker showed resolved that the log still had open.
    if (!wrote(await supabase.from("incident_log").update({ resolved: !r.resolved, resolved_at: !r.resolved ? new Date().toISOString() : null }).eq("id", r.id), toast, r.resolved ? "Couldn't reopen it" : "Couldn't resolve it"))
      setRows((p) => p.map((x) => x.id === r.id ? { ...x, resolved: r.resolved } : x));
  };
  const del = async (id: string) => {
    if (!supabase) return;
    if (!(await confirm({ title: "Delete this incident from the log?", confirmLabel: "Delete", danger: true }))) return;
    setRows((p) => p.filter((x) => x.id !== id));
    if (!wrote(await supabase.from("incident_log").delete().eq("id", id), toast, "Couldn't delete the incident")) load();
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
  const { toast } = useAppStable();
  const [f, setF] = useState<MenuRigValue | null>(null);
  const [open, setOpen] = useState(false);

  const read = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const load = useCallback(() => read(async () => (supabase ? await supabase.from(table).select(MENU_RIG_COLUMNS).eq("id", ownerId).maybeSingle() : null), (r) => {
    if (!r) return;
    // `?? {}` made f truthy on a failed read, so the guard below passed and every rig field
    // rendered blank — a menu that looks unset rather than unread. Null keeps the panel closed.
    if (r.error) { setF(null); return; }
    setF((r.data as MenuRigValue | null) ?? {});
  }), [read, table, ownerId]);
  useEffect(() => { load(); }, [load]);

  // A chip that did not save goes back to what is saved, and says so (2026-10-04). The write's
  // result was ignored: a refused save left the chip showing a menu the pack list would never see.
  const save = async (patch: MenuRigPatch) => {
    if (!supabase || !f) return;
    const before = f;
    setF({ ...f, ...patch });
    const { error } = await supabase.from(table).update(patch).eq("id", ownerId);
    if (error) { setF(before); toast(failureWords(error, "Couldn't save the menu"), "error"); return; }
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
  const [dress, setDress] = useState("");
  const [brief, setBrief] = useState("");
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useAppStable();

  const briefState = useAsyncData<{ dress: string; brief: string }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // A failed read is a failure, not "No brief yet" (R12b, F4) — the editor would have saved blanks over the brief.
    const { data, error } = ownerCol === "stop_id"
      ? await supabase.from("stop_ops").select("dress_code, crew_brief").eq("stop_id", ownerId).maybeSingle()
      : await supabase.from("event_ops").select("dress_code, crew_brief").eq("event_id", ownerId).maybeSingle();
    if (error) throw new Error(error.message);
    return { dress: data?.dress_code ?? "", brief: data?.crew_brief ?? "" };
  }, [ownerCol, ownerId]);
  // Seed the editable copy from the fetch/reload — Cancel and realtime both flow back through here.
  // During render, not by an effect (R17, lib/useChanged): a fresh load seeds the copy before anything is drawn.
  if (useChanged(briefState.data) && briefState.data) { setDress(briefState.data.dress); setBrief(briefState.data.brief); }

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    // Upsert the staff-only ops row (create it on first save; the parent may have none yet).
    // The editor closes on a brief that landed (R12b, F4): it closed whatever the save answered, and the crew found no
    // brief on the day.
    const said = { dress_code: dress.trim() || null, crew_brief: brief.trim() || null };
    const ok = wrote(ownerCol === "stop_id"
      ? await supabase.from("stop_ops").upsert({ stop_id: ownerId, ...said }, { onConflict: "stop_id" })
      : await supabase.from("event_ops").upsert({ event_id: ownerId, ...said }, { onConflict: "event_id" }), toast, "Couldn't save the brief");
    setSaving(false);
    if (ok) { setEdit(false); toast("Brief saved"); }
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
            <div className="daybrief-h">Day-of brief · how to show up{isAdmin && !edit && <button type="button" className="btn-ter ml-auto" onClick={() => setEdit(true)}>{empty ? "+ Add" : "Edit"}</button>}</div>
            {edit ? (
              <>
                <label className="prod-f"><span>Dress code — what to wear</span><input className="note-in" value={dress} onChange={(e) => setDress(e.target.value)} placeholder="e.g. Black GT3 tee, dark jeans, closed-toe shoes" maxLength={600} /></label>
                <label className="prod-f" style={{ marginTop: 8 }}><span>Call time, parking, what to bring, anything else</span><textarea className="note-in" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={"Call 9:30a · park behind the pavilion · bring your apron + black hat · we pour 11–3"} maxLength={4000} /></label>
                <div className="prod-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="note-arch" onClick={() => { setEdit(false); briefState.reload(); }} disabled={saving}>Cancel</button>
                  <button type="button" className="btn-pri" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save brief"}</button>
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

function MyDay({ userId, canGoLive, canBrew }: { userId: string | null; canGoLive: boolean; canBrew: boolean }) {
  // Flags ride the one shared hook (same source as the Now strip + nav badge). Crew see their own
  // pings + broadcasts now too — the old isLeader gate predates the staff-wide alerts RLS (0157).
  const { flags, error: flagsErr, reload: reloadFlags } = useMyAlerts(userId);
  const { setSection } = useOperatorSection();
  const { openRecord } = useRecord();
  const streams = useWorkStreams();
  const laneColor = (cat: string) => streamOfCategory(cat, streams)?.color;
  // The driver's page is a route of its own: the router opens it (R30) — a page load was only slower.
  const router = useRouter();
  // The day's rhythm — the same anchors the company calendar carries.
  // A FAILED READ IS NOT A QUIET DAY (2026-10-04): these four read .data straight through PostgREST
  // error objects, so a failure drew no stop, no drop, no brew — exactly what an empty day draws.
  // ONE DAY, ON THE REFRESH (2026-10-12, the My Day audit): stops and brews read the phone's day while
  // drops and porches read the market's, and the four were read once, on mount — so pull to refresh,
  // coming back and the day turning never woke them. The market's day for all four (lib/home rhythmDay),
  // and the loader is registered with the app's refresh on the tables it reads (RHYTHM_TABLES).
  const rhythmLoader = useCallback(async (): Promise<Rhythm> => {
    if (!supabase) return NO_RHYTHM;
    const { day, from, to } = rhythmDay();
    const [st, dr, de, br] = await Promise.all([
      supabase.from("stops").select("id, name, starts_at").is("archived_at", null).neq("status", "done").gte("starts_at", from).lt("starts_at", to),
      supabase.from("drop_orders").select("id", { count: "exact", head: true }).eq("drop_date", day).is("canceled_at", null),
      supabase.from("delivery_orders").select("id", { count: "exact", head: true }).eq("delivery_date", day).is("canceled_at", null),
      supabase.from("brew_batches").select("id, recipe_name, batch_gal, latest_start_at, status").in("status", ["planned", "brewing"]).eq("brew_date", day),
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
  useRealtimeTable(RHYTHM_TABLES, rhythmState.reload);
  const rhythm = rhythmState.data ?? NO_RHYTHM;


  return (
    <>
      {/* WHAT OPENS THE DAY IS THE DAY (2026-10-04, Ryan: "strategically look for where something is
          unnecessary information"). This screen used to open with a 30px greeting and a motto —
          "Evening, Ryan." over "Precision in every pour — let's make today one worth remembering."
          — about ninety pixels of the first screen an operator sees, ahead of the one thing the day
          is about. The greeting is gone, the motto with it (its copy key is retired, so Settings no
          longer offers to edit a line that shows nowhere), and the date rides on today's op card.
          The headline still comes before the plates, which is all P3 asked. */}
      {/* ONE HOME (2026-10-09, round 2 of the UX plan, approved): how are we doing, and what's next —
          in one look. On the left the day itself (today's op, its stops, drops and brews) and the
          week's three numbers, each with its change and its cause; beside it, at most three things due
          today, with the equipment, the stale and the full lists each folded to one row. A phone reads
          them in this order. My tasks and Needs you are whole, one tap down, in "All tasks". */}
      {/* THE NUMBERS LEFT MY DAY (2026-10-12, the My Day audit, approved). Sales over the fortnight, margin and
          the next drop's packs stood beside the day for whoever holds Money or manages — the figures Money
          opens on, Command's board and Live Ops' Due next say again — on the screen whose questions are what
          needs me, what next and what's coming. They are Money's alone now (components/HomeNumbers, here=
          "money"); nothing linked into them here: no anchor, no ?s=day link, no line of the Guide. */}
      <Columns>
      <Column>
      <DayHeadline canGoLive={canGoLive} />
      {rhythmState.status === "error" && (
        <p className="load-failed">
          <Said as="span" assertive>Couldn&apos;t read today&apos;s stops, drops and brews — this is not &ldquo;nothing on&rdquo;.</Said>{" "}
          <button type="button" className="btn-ter" onClick={() => rhythmState.reload()}>Try again</button>
        </p>
      )}
      {(rhythm.stops.length > 0 || rhythm.dropPacks > 0 || rhythm.porches > 0 || rhythm.brews.length > 0) && (
        <div className="myday-rhythm">
          {rhythm.stops.map((s) => (
            <button key={s.id} type="button" className="k-chip sm" onClick={() => openRecord("stop", s.id)}>
              <Icon name="truck" style={{ color: laneColor("stop") }} /> {s.name || "Truck stop"}{s.starts_at ? ` · ${new Date(s.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""} ›
            </button>
          ))}
          {rhythm.dropPacks > 0 && <button type="button" className="k-chip sm" onClick={() => setSection("now")}><Icon name="package" style={{ color: laneColor("drop") }} /> Drop today · {rhythm.dropPacks} pack{rhythm.dropPacks === 1 ? "" : "s"} ›</button>}
          {rhythm.porches > 0 && <button type="button" className="k-chip sm" onClick={() => router.push("/driver")}><Icon name="compass" style={{ color: laneColor("delivery") }} /> Delivery run · {rhythm.porches} porch{rhythm.porches === 1 ? "" : "es"} ›</button>}
          {canBrew && rhythm.brews.map((b) => (
            <button key={b.id} type="button" className={`k-chip sm${b.warn ? " warn" : ""}`} onClick={() => setSection("brew")}>
              <Icon name="coffee" style={b.warn ? undefined : { color: laneColor("brew") }} /> Brew · {b.recipe_name} {b.batch_gal} gal{b.warn ? " — start now" : ""} ›
            </button>
          ))}
        </div>
      )}
      {/* THE INBOX HAS ONE DOOR, THE BELL (2026-10-04). A card here repeated the bell's number on
          the same screen — "10 flags & pings for you" under a bell reading 10 — and for every role
          but a manager the bell itself never loaded, so the card was papering over that. The bell
          loads for everyone now. What stays is the one thing the bell cannot say: that it failed. */}
      {flagsErr && flags.length === 0 && (
        <p className="load-failed">
          <Said as="span" assertive>Couldn&apos;t check your flags &amp; pings — this is not &ldquo;nothing for you&rdquo;.</Said>{" "}
          <button type="button" className="btn-ter" onClick={() => reloadFlags()}>Try again</button>
        </p>
      )}
      {/* TODAY: what is due, and only that, from My tasks and Needs you together (components/TodayList).
          WHAT IS OWED (0320) still reads here — until it shipped the app stored eleven kinds of deadline
          and showed none of them, and silence is only a signal when somebody is listening — but a
          deadline months past no longer leads the morning: it waits, counted, in one row. Under the
          day itself, so a phone reaches it on the first screen (2026-10-09: the numbers stood above it
          and left two of its rows above the tab bar). */}
      <TodayList allTasks={<><MyTasks userId={userId} anchor={false} /><Owed /></>} />
      {/* LEAD THE WEEK LEFT MY DAY (2026-10-09, One home; Ryan: "whats the lead the week, gtm briefing &
          intake, any operational purposes?"). A chip that folded three tools a leader reaches for weekly or
          less: a go-to-market card of fixed text whose anchor was Aug 1 (retired — Command's initiatives
          and goals are the live version of "what we're driving to"), the Chief of Staff briefing (on
          Command now, where the week is led), and Smart intake with what it filed (Quick actions › File,
          from every screen — a permit arrives in the hand, not at My Day). A daily screen holds the day. */}
      </Column>
      <Column>
      {/* COMING UP (2026-10-12, the My Day audit, approved): what's coming, the third question My Day had
          no answer to — one line per commitment of yours in the next seven days (an event or stop you're
          on, one you have work for, a dated task), each opening its record. Read only; Plan is the record.
          Beside the day on a desk, after To do on a phone. */}
      <ComingUp />
      </Column>
      </Columns>
    </>
  );
}

function MyTasks({ userId, anchor = true }: { userId: string | null; anchor?: boolean }) {
  const { openTask } = useTaskSheet();
  const { toast } = useAppStable();
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A FAILED READ IS NOT AN EMPTY PLATE (2026-10-04). This read .data straight through PostgREST's
  // error object, so a failure drew "Nothing on your plate — you're clear for today": the most
  // reassuring sentence on the screen, said about a list it never saw.
  const [err, setErr] = useState<string | null>(null);

  const read = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  // ONE task read: the all_tasks spine view (0210, enriched by 0225), in lib/myTasks — the same
  // plate the WorkloadBoard and the home's Today list read, so task surfaces can't drift apart
  // again. Op context rides the field_ops spine, which is why a STOP-owned task shows its stop's name.
  const load = useCallback(() => read(() => loadMyTasks(userId), ({ rows, error }) => {
    if (error) { setErr(error); setLoaded(true); return; }
    setErr(null);
    setTasks(rows);
    setLoaded(true);
  }), [read, userId]);

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

  if (err) {
    return (
      <div className="adm-sec" id={anchor ? "my-day-tasks" : undefined}>
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
      <div className="adm-sec" id={anchor ? "my-day-tasks" : undefined}>
        <EmptyState title="Nothing on your plate" sub="You're clear for today — check Live Ops if something's moving." />
      </div>
    );
  }

  return (
    <div className="adm-sec" id={anchor ? "my-day-tasks" : undefined}>
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
        <div className="k-chips">
          <button type="button" className={`k-chip flex-1${dir === "asc" ? " on" : ""}`} aria-pressed={dir === "asc"} onClick={() => { setDir("asc"); onClose(); }}>Soonest first</button>
          <button type="button" className={`k-chip flex-1${dir === "desc" ? " on" : ""}`} aria-pressed={dir === "desc"} onClick={() => { setDir("desc"); onClose(); }}>Latest first</button>
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
  const { toast } = useAppStable();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ headline: string; severity: string; gaps: { item: string; detail: string }[] } | null>(null);
  const run = async () => {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      const r = await authedFetch("/api/agents/readiness", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (!j.ok) toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : failureOr(j.error, "That didn't go through — try again in a moment."), "error");
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
          <button type="button" className="btn-pri btn-sm shrink-0" onClick={run} disabled={busy}>{busy ? "Checking…" : <><Icon name="sparkles" /> Check</>}</button>
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
  const { toast } = useAppStable();
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
      if (!j.ok) { toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : failureOr(j.error, "That didn't go through — try again in a moment."), "error"); setBusy(false); return; }
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
    if (error) { toast(`Couldn't ${approve ? "approve" : "dismiss"} it — ${plainFailure(error)}`, "error"); return; }
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
          <select aria-label="Event (optional)" className="insp-in" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">No event — just brief me</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.day_label || ev.day || ""} · {ev.title || "Event"}</option>)}
          </select>
          <button type="button" className="btn-pri btn-sm shrink-0" onClick={run} disabled={busy || !state.trim()}>{busy ? "Researching…" : <><Icon name="sparkles" /> Research</>}</button>
        </div>
        {wait && (
          <div className="insp-wait">
            <span className="insp-wait-dot" /><Said as="span" className="contents"><span>{wait}</span><span className="insp-wait-sub">this can take a minute or two — you can keep working</span></Said>
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
            <p className="insp-foot">Always confirm with the jurisdiction&apos;s health department for your specific date.</p>
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
  // ONCE (2026-10-11, the review): this ran on every load of the list — and the list reloads on any change to an
  // event, a stop or a task (realtime, below) — so backing out of the live event reopened it the next time anything
  // moved, now with a back step and the page sent to its top. The first load opens it; after that, the list is yours.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!prepState.data || autoOpened.current) return;
    autoOpened.current = true;
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

  // keyed by the target (R33 — the audit's FE11-05): ⌘K or a recent jumps from one event or stop to another in place, and a
  // slow read of the first, answering after the second's, set its name, tasks and crew under the second's header — a tick
  // then ticked the first's task. A new target is a new PrepDetail: what the old one's read sets lands on nothing.
  if (selected) return <PrepDetail key={`${selected.kind}:${selected.id}`} target={selected} onBack={() => setSelected(null)} />;

  return (
    <>
    {/* Opening a target gives prep the full screen. (The "At a glance" Overview block that opened
        this list died 2026-07-30 — it restated the exact target cards below it and Live Ops' own
        live status. Ryan: "feels unnecessary and like it's in other sections. Redundant.") */}
    <div className="adm-sec adm-prep">
      <div className="flex justify-end"><button className="btn-ter" onClick={() => setSheet(true)} aria-haspopup="dialog">View ⌄</button></div>
      <AsyncSection
        state={prepState}
        isEmpty={(d) => d.events.length === 0 && d.stops.length === 0}
        emptyTitle="Nothing to prep yet"
        emptySub="Add an event or a truck stop on the Plan calendar — + on any day."
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
  const read = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const load = useCallback(() => read(async () => (supabase ? await Promise.all([
    supabase.from("events").select("*").is("archived_at", null),
    supabase.from("stops").select("*").is("archived_at", null).neq("status", "done"),
    supabase.from("live_status").select("current_stop_id, is_live").maybeSingle(),
  ]) : null), (r) => {
    if (!r) return;
    const [e, s, l] = r;
    setEvents((e.data as EventRow[]) ?? []);
    setStops((s.data as Stop[]) ?? []);
    const ls = l.data as { current_stop_id: string | null; is_live: boolean | null } | null;
    setLiveStopId(ls?.is_live ? ls.current_stop_id : null);
    setLoaded(true);
  }), [read]);
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
  // WHAT IS LATE IS SAID, AND OPENS ITS ROW (2026-10-10, the crew round). Gear past its service sat in a closed row
  // whose line read "service log · what's due" whatever was late. The count is My Day's (v_obligations, lib/upkeep's
  // rule — the panel's own), on the row while it is closed, and a late one opens the row once, as an event this
  // week opens the load-out.
  const [lateGear, setLateGear] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("v_obligations").select("subject_id", { count: "exact", head: true }).eq("source", "asset_maintenance").lt("days_out", 0)
      .then(({ count, error }) => { if (!error) setLateGear(count ?? 0); });
  }, []);
  const lateRef = useRef(false);
  useEffect(() => { if (lateGear > 0 && !lateRef.current) { lateRef.current = true; setOpen((o) => ({ ...o, maint: true })); } }, [lateGear]);
  const row = (id: string, icon: ReactNode, title: string, hint: ReactNode, body: ReactNode) => (
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
      {row("maint", <Icon name="wrench" />, "Asset maintenance", lateGear > 0 ? <span className="k-count due">{lateGear} overdue</span> : "service log · what's due", <AssetMaintenance />)}
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
  const { toast } = useAppStable();
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
  // Breadcrumb: Readiness › <this target>. Clicking the "Readiness" root steps back to the list.
  useCrumb("prep-detail", name ?? (isEvent ? "Event" : "Location"), onBack);
  // ONE WAY BACK, NAMED FOR WHERE IT GOES (2026-10-11, Ryan: "the bread crumb trail is not flawless"). The detail
  // is a screen pushed over the list, as on an iPhone: the bar's ‹ says "Readiness" and takes you there, the edge
  // swipe does the same, the detail opens at its top and the list comes back scrolled where you left it
  // (components/useBackStep). Its own "‹ All prep" — a third name for the same place, in the page, that scrolled
  // away with it — is gone; the trail over the title says Readiness › this one.
  useBackStep(SEC_LABEL.prep, onBack);
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

  const readOnHand = useLatestRead();   // read, then set — the newest read's answer only (R17, lib/useLatestRead)
  const loadOnHand = useCallback(() => readOnHand(async () => (supabase ? await supabase.from("inventory_on_hand").select("item, on_hand").eq("market", market) : null), (r) => {
    if (!r) return;
    // The balance has a canonical home — public.inventory_on_hand, which 0288 fixed to group by
    // (item, MARKET). This screen used to fetch every ledger row and re-add them up here, grouped by
    // item alone, which is the exact defect 0288 exists to prevent, still running in the browser.
    // Reading the view means one definition of "on hand" and one place to fix it.
    //
    // It also has to be able to fail out loud: the section below renders only when onHand is
    // non-empty, so a blip did not show an error, it showed a truck with nothing carried in, to the
    // person deciding what to load. Empty and broken must not look the same when somebody is about
    // to pack against the answer.
    if (r.error) { setOnHandFailed(true); return; } // keep whatever is on screen and say so instead
    setOnHandFailed(false);
    setOnHand(((r.data as { item: string; on_hand: number | string }[]) ?? [])
      .map((x) => ({ item: x.item, bal: Number(x.on_hand) }))
      .filter((x) => Number.isFinite(x.bal) && Math.abs(x.bal) > 0.0001)
      .sort((a, b) => a.item.localeCompare(b.item)));
  }), [readOnHand, market]);
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
  // Every table's change, unfiltered on purpose: Supabase can't filter a delete, and a filtered channel would miss a task
  // another crew member removed (R33 weighed the audit's FE11-05 filter and kept this).
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
      toast(error ? failureWords(error) : `Generated ${pack.length} pack${comp.length ? ` + ${comp.length} compliance` : ""} items`, error ? "error" : undefined);
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
    const e = t1.error || t2.error;
    toast(e ? failureWords(e, "Reset failed") : `Reset — this ${what}'s prep & schedule are cleared`, e ? "error" : undefined);
    if (!e) load();
  };
  const toggle = async (t: EventTask) => {
    if (!supabase) return;
    const next = !t.done;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, done: next } : x)));
    const { error } = await supabase.from("event_tasks").update({ done: next, done_by: next ? user?.id ?? null : null, done_at: next ? new Date().toISOString() : null }).eq("id", t.id);
    if (error) { toast(failureWords(error), "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic — the assignment shows immediately
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(failureWords(error), "error"); load(); return; }
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
    if (error) { toast(failureWords(error, "Couldn't confirm"), "error"); load(); return; }
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
      if (le) toast(failureWords(le, "Confirmed, but on-hand didn't move"), "error");
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
    // An empty box is no count at all, never a count of 0 (2026-10-11, the review — the box's blur says the same).
    if (!supabase || v.trim() === "") return;
    const want = Number(v);
    if (!Number.isFinite(want)) { toast("That isn't a number", "error"); return; }
    const { data, error } = await supabase.rpc("set_on_hand", {
      p_item: item, p_want: want, p_market: market,
      p_event: isEvent ? target.id : null, p_stop: isEvent ? null : target.id,
    });
    if (error) { toast(`Couldn't correct ${item} — ${plainFailure(error)}`, "error"); loadOnHand(); return; }
    // Show what the SERVER says the shelf holds, not what we assumed it would.
    const landed = Number(data);
    setOnHand((p) => p.map((o) => (o.item === item ? { ...o, bal: Number.isFinite(landed) ? landed : o.bal } : o)));
  };
  const addTask = async () => {
    if (!supabase || !newTask.trim()) return;
    const due_at = newTaskDue.trim() === "" ? null : new Date(`${newTaskDue}T23:59:59`).toISOString();
    const { error } = await createEventTask({ parent: ownerParent, label: newTask.trim(), kind: "task", section: "Task", sort: tasks.length, dueISO: due_at });
    setNewTask(""); setNewTaskDue("");
    if (error) toast(failureWords(error), "error"); else load();
  };
  const addCrew = async (uid: string) => {
    if (!supabase || !uid) return;
    const { error } = await supabase.from("event_staff").insert({ ...keyed(ownerCol, target.id), user_id: uid });
    if (error) toast(error.code === "23505" ? "Already on crew" : failureWords(error), "error"); else load();
  };
  const removeCrew = async (id: string) => { if (supabase) { if (wrote(await supabase.from("event_staff").delete().eq("id", id), toast, "Couldn't take them off the crew")) load(); } };
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
    toast(error ? failureWords(error) : `Added ${rows.length} suppl${rows.length === 1 ? "y" : "ies"}`, error ? "error" : undefined);
    if (!error) load();
  };
  // Tag/untag a crew member as a manager — managers must approve the prep too.
  const setManager = async (crewRowId: string, makeMgr: boolean) => {
    if (!supabase) return;
    if (!wrote(await supabase.from("event_staff").update({ role_label: makeMgr ? "manager" : null }).eq("id", crewRowId), toast, makeMgr ? "Couldn't make them a manager" : "Couldn't take the manager tag off")) return;
    load();
  };
  const toggleApproval = async (mine: boolean) => {
    if (!user || !supabase) return;
    if (mine) {
      if (!wrote(await supabase.from("event_approvals").delete().eq(ownerCol, target.id).eq("approver_id", user.id), toast, "Couldn't withdraw the approval")) return;
      toast("Approval withdrawn");
    } else {
      const { error } = await supabase.from("event_approvals").insert({ ...keyed(ownerCol, target.id), approver_id: user.id });
      toast(error ? failureWords(error) : "Prep approved", error ? "error" : undefined);
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
    if (error) { toast(`Couldn't request sign-off: ${plainFailure(error)}`, "error"); return; }
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
              <EmptyState title={`${isEvent ? "Event" : "Location"} not found`} sub="It may have been removed." />
            </div>
          );
        }
        return (
    <div className="adm-sec adm-prep">
      {/* ITS OWN SCREEN (2026-10-11, Ryan: "Is the service page service for just the event? … am I managing one event
          or am I in a menu?"). Opened from Readiness, a stop was drawn under the console's "Service", the Readiness ·
          Live Ops · Delivery switch and a crumb trail — a menu's furniture over one event. On a phone (and in the
          frame) it is a screen pushed over the list, as on an iPhone: its name is the title, "‹ Readiness" is the way
          back (the console's row, components/useBackStep), and the switch and the trail step aside while it is open
          (OpViewAware, below). The desk keeps its trail and the section's title over the canvas; this card's heading
          is the stop's name there. */}
      <header className="desk:hidden mb-3">
        <h1 className="op-head-t">{name}</h1>
        <p className="mt-1.5 flex items-center gap-2 text-footnote text-cream-dim">
          {isEvent ? "Event" : "Truck stop"}{isEvent && ev?.is_live && <span className="k-count due">LIVE</span>}
        </p>
      </header>
      <div className="hidden desk:block">
        <SectionHeader label={name ?? "…"} annotation="prep" right={<>
          {isEvent && ev?.is_live && <span className="k-count due">LIVE</span>}
          {!isEvent && <span className="k-count">Truck stop</span>}
        </>} />
      </div>
      {/* the title bar (components/TitleBar) names this one, not the section, once its name has scrolled away */}
      <div data-large-title data-title={name} aria-hidden className="h-0" />
      {/* Identity / date / place / status — managed right here, so a stop or event is one screen
          end to end. The wrapper id is the scoped "Days to go" KPI tile's drill target. */}
      <div id="prep-target-details">
        <OwnerDetails ownerType={target.kind} ownerId={target.id} isAdmin={isAdmin} onSaved={(nm) => { setName(nm); load(); }} onRemoved={onBack} />
      </div>
      {/* This one's numbers, under its name and its details — the list's tiles stay with the list (2026-10-11). */}
      <PrepKpis target={target} />
      {total > 0 ? (
        <>
          <div className={`adm-ready-bar${ready ? " ok" : critOut.length ? " miss" : ""}`}>
            <b>Loaded {doneN}/{total}</b>
            {critOut.length > 0 && <span className="adm-ready-miss"> · {critOut.length} critical to load: {critOut.slice(0, 2).map((t) => t.label).join(", ")}{critOut.length > 2 ? ` +${critOut.length - 2}` : ""}</span>}
            {ready && <span> · ready to roll</span>}
          </div>
          {isAdmin && (
            <div className="adm-prep-actions">
              <button className="btn-ter mt-2" onClick={() => generate(true)} disabled={generating}>↻ Regenerate from menu</button>
              <button className="btn-ter mt-2" onClick={() => setPrepAIOpen(true)}><Icon name="sparkles" /> AI prep list</button>
              <button className="btn-ter mt-2" onClick={() => setTroubleshootOpen(true)}><Icon name="wrench" /> Troubleshoot</button>
              <button className="btn-ter mt-2" onClick={() => setShowSupplies(true)}>+ Add supplies</button>
            </div>
          )}
        </>
      ) : isAdmin ? (
        // id: the scoped "No pick list yet" tile lands here — on the buttons that make one.
        <div className="adm-prep-actions" id="prep-target-start" style={{ flexWrap: "wrap" }}>
          <Button kind="primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate pack list from menu"}</Button>
          <Button kind="secondary" onClick={() => setPrepAIOpen(true)}><Icon name="sparkles" /> AI prep list</Button>
          <Button kind="secondary" onClick={() => setTroubleshootOpen(true)}><Icon name="wrench" /> Troubleshoot</Button>
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
            if (!supabase) return;
            // How many days the plan runs, kept — or said not kept (R12b, F4): the answer was dropped either way.
            if (isEvent) { void supabase.from("events").update({ plan_days: n }).eq("id", target.id).then((r) => { wrote(r, toast, "Couldn't change the plan's days"); }); }
            else {
              const was = stopMeta.plan_days;
              setStopMeta((m) => ({ ...m, plan_days: n }));
              void supabase.from("stops").update({ plan_days: n }).eq("id", target.id).then((r) => { if (!wrote(r, toast, "Couldn't change the plan's days")) setStopMeta((m) => ({ ...m, plan_days: was })); });
            }
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
          <Button type="button" kind="destructive" onClick={resetAll} disabled={generating}>Reset this {isEvent ? "event" : "truck stop"} — clear prep &amp; schedule</Button>
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
            {iAmRequired && <Button kind={iApproved ? "secondary" : "primary"} onClick={() => toggleApproval(iApproved)}>{iApproved ? "Withdraw approval" : "Approve prep"}</Button>}
            {isAdmin && !fullyApproved && pendingApprovers.length > 0 && <Button kind="secondary" onClick={() => requestSignoff(pendingApprovers)}>Request sign-off</Button>}
          </div>
          {managers.length === 0 && <div className="h-sub" style={{ marginTop: 6 }}>Tag a crew member <Icon name="star" /> as manager to require their approval too.</div>}
        </div>
      )}

      {onHandFailed && (
        <div className="onhand carryin">
          <div className="onhand-h"><Icon name="package" /> On hand now <Said as="span" assertive>couldn&apos;t load carried-in stock — this is not &ldquo;nothing on hand&rdquo;</Said></div>
          <button type="button" className="btn ghost sm" onClick={() => loadOnHand()}>Try again</button>
        </div>
      )}

      {onHand.length > 0 && (
        <div className="onhand carryin">
          <div className="onhand-h"><Icon name="package" /> On hand now <span>carried in — correct any count</span></div>
          {onHand.map((o) => {
            // UNDER ZERO IS NOT A COUNT (2026-10-11, Ryan's screenshot: −420, −1.5 and −24 in boxes wider than the
            // names beside them, each name broken over six lines). A shelf reads below zero when more was logged as
            // used than was ever logged in, so nobody knows what is on it: the row asks for a count instead of
            // offering the minus sign as one, and leaving its box empty writes nothing. The box is a number's width
            // (it took the row and left the name 28px), so a name keeps its line.
            const unknown = o.bal < 0;
            return (
              <div key={o.item} className="onhand-row">
                <span className="onhand-label">{o.item}{unknown && <span className="block text-caption text-warn">More was used than logged in — count it</span>}</span>
                <span className="onhand-nums">
                  <input type="number" inputMode="decimal" min="0" className="onhand-in w-22 tabular-nums" defaultValue={unknown ? "" : o.bal} placeholder={unknown ? "Count" : undefined}
                    onBlur={(e) => {
                      // An empty box is not a count of 0 (2026-10-11, the review): clearing a box to type a new number and
                      // leaving it set the shelf to 0. It writes nothing now, and a box that had a count shows it again.
                      if (e.target.value.trim() === "") { if (!unknown) e.target.value = String(o.bal); return; }
                      adjustOnHand(o.item, e.target.value);
                    }} aria-label={`On hand ${o.item}`} />
                  <span className="onhand-of">on hand</span>
                </span>
              </div>
            );
          })}
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
                  <input type="number" inputMode="decimal" min="0" className="onhand-in w-22 tabular-nums" defaultValue={a ?? ""} placeholder="—"
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
                    <button type="button" className="k-chip" onClick={() => setAssignFor(t)} aria-label={t.assignee ? `Reassign ${t.label} — currently ${staffName(t.assignee)}` : `Assign ${t.label} to crew`}>
                      {t.assignee
                        ? <><span className="k-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></>
                        : "+ Assign"}
                    </button>
                  ) : t.assignee ? (
                    <span className="k-chip"><span className="k-av">{initialOf(t.assignee)}</span><span className="task-assign-name">{firstNameOf(t.assignee)}</span></span>
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
          <Button kind="secondary" compact onClick={addTask}>Add</Button>
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
  // Seeded as the inventory or the event arrives, during render (R17, lib/useChanged) — not by an effect a render later.
  const invNew = useChanged(inv), evNew = useChanged(ev);
  if ((invNew || evNew) && inv && ev) {
    const relevant = inventoryForEvent(inv.items, ev).relevant;
    setSel(new Set(relevant.filter((it) => !have.has(it.name.trim().toLowerCase())).map((it) => it.name)));
  }

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
        <button type="button" className="btn-pri btn-wide mt-4.5" onClick={confirm} disabled={selCount === 0}>
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
// Who can see a note, in the order its chips are drawn (the arrows move along them — R12, F7).
const NOTE_VIS = ["private", "team", "collab"] as const;
function MeetingNotes() {
  const confirm = useConfirm();
  const { user, profile } = useAuth();
  const { toast } = useAppStable();
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
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : failureWords(j.error), "error");
    } catch { toast("Couldn't reach the summarizer", "error"); }
    setSummarizing(false);
  };
  const archive = async (n: MeetingNote, on: boolean) => {
    if (!supabase) return;
    if (!wrote(await supabase.from("meeting_notes").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", n.id), toast, on ? "Couldn't archive the note" : "Couldn't restore the note")) return;
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
  if (useChanged(notesState.data) && notesState.data) setNotes(notesState.data);   // during render (R17, lib/useChanged)
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

  // OPEN THAT NOTE (2026-10-12, lib/noteLink). The Plan card's "open in Notes", an assembled review or strategy
  // session and a filed transcript each name one note, and used to land here with it closed somewhere down the
  // list. The asked-for note is taken once the notes are read: shown on its shelf (Active or Archived, with the
  // search and Mine cleared so nothing hides it), opened — adjusted while rendering, as the house does
  // (components/MerchManager) — then scrolled to and focused from an effect. A note not read yet (one just written
  // arrives with the next reload) stays asked for until it is.
  const [askedNote, setAskedNote] = useState<string | null>(pendingNoteAsk);
  useEffect(() => onNoteAsk(setAskedNote), []);
  const [landing, setLanding] = useState<{ id: string } | null>(null);
  const askedFound = askedNote ? notesState.data?.find((n) => n.id === askedNote) ?? null : null;
  if (askedFound) {
    setAskedNote(null);
    setTab(askedFound.archived_at ? "archived" : "active"); setQuery(""); setMineOnly(false);
    setOpenId(askedFound.id); setLanding({ id: askedFound.id });
  }
  useEffect(() => {
    if (!landing) return;
    clearNoteAsk(landing.id);
    scrollToAnchor(noteAnchor(landing.id));
    focusNoteWhenThere(landing.id);
  }, [landing]);

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
    // A refused follow-up insert is said (R34): it came back as no rows, and "Note saved · 3 tasks → the note" was said anyway.
    let tasksErr: string | undefined;
    if (!error && noteId && cActions.length) {
      const owner: TaskParent = linkEvent ? { event: linkEvent } : linkStop ? { stop: linkStop } : { note: noteId };
      const { rows: made, error: madeErr } = await createEventTasks(cActions.map((a, i) => ({
        parent: owner, originNoteId: noteId, label: a.title, kind: "task" as const, section: "Follow-up",
        critical: a.critical, assignee: a.assignee ?? null, sort: 1000 + i,
      })));
      tasksErr = madeErr;
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
    if (error) { toast(failureWords(error), "error"); return; }
    const dest = linkEvent ? "the event's prep list" : linkStop ? "the stop's prep list" : "the note";
    const tasksWords = !cActions.length ? "" : tasksErr
      ? ` · the follow-up${cActions.length === 1 ? "" : "s"} didn't save (${plainFailure(tasksErr)}) — add ${cActions.length === 1 ? "it" : "them"} from the note`
      : ` · ${cActions.length} task${cActions.length === 1 ? "" : "s"} → ${dest}`;
    toast(`Note saved${tasksWords}${filed ? ` · ${filed} file${filed === 1 ? "" : "s"} kept` : ""}${fileErr ? ` · ${fileErr} file${fileErr === 1 ? "" : "s"} couldn't upload` : ""}`, fileErr || tasksErr ? "error" : undefined);
    setCTitle(""); setCSummary(""); setCBody(""); setCLink(""); setCVis("private"); setVisTouched(false); setCActions([]); setCFiles([]); setComposing(false);
    load();
  };
  const remove = async (n: MeetingNote) => {
    if (!supabase || !isAdmin) return;
    if (!(await confirm({ title: `Delete “${n.title}”?`, body: "This also removes its follow-ups.", confirmLabel: "Delete", danger: true }))) return;
    if (!wrote(await supabase.from("meeting_notes").delete().eq("id", n.id), toast, "Couldn't delete the note")) return;
    toast("Note deleted"); load();
  };

  return (
    <div className="adm-sec">
      {/* NEW NOTE LEADS (2026-10-10, the crew round). The screen opened on a header saying "Notes" under the lane's
          "Notes", a paragraph explaining the composer's own chips, and New note as a quiet outline. The one thing
          this screen is opened to do is now the first thing on it; who sees a note is said on its chips, where it
          is chosen, and where a follow-up lands is said beside the follow-ups. */}
      <Button kind="primary" wide onClick={() => setComposing(true)}>+ New note</Button>
      {composing && (
        <Sheet open onClose={() => { setComposing(false); setCActions([]); setCFiles([]); }} label="New note" className="note-lux"
          // The words stay with the page when the composer closes; its follow-ups and files do not.
          dirty={cActions.length > 0 || cFiles.length > 0}
          header={<div className="note-lux-head"><span className="note-lux-eyb">New note</span><CloseButton onClick={() => { setComposing(false); setCActions([]); setCFiles([]); }} /></div>}
          footer={<div className="note-actions"><LeaveButton className="btn-sec" onClick={() => { setComposing(false); setCActions([]); setCFiles([]); }}>Cancel</LeaveButton><button type="button" className="btn-pri" disabled={!cTitle.trim() || saving} onClick={save}>{saving ? "Saving…" : "Save note"}</button></div>}>
          <div className="note-composer">
            <input aria-label="Note title" className="note-in note-lux-title" placeholder="What&rsquo;s this note about?" value={cTitle} onChange={(e) => setCTitle(e.target.value)} autoFocus />
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
            <div className="note-vis-chips" role="radiogroup" aria-label="Who can see this note" onKeyDown={(e) => rovingKeys(e, NOTE_VIS.length, NOTE_VIS.indexOf(cVis), (i) => { setCVis(NOTE_VIS[i]); setVisTouched(true); })}>
              {([["private",<><Icon name="lock" /> Just me</>],["team",<><Icon name="team" /> Team</>],["collab",<><Icon name="partners" /> Team + comments</>]] as const).map(([v,l], i) => (
                <button key={v} type="button" role="radio" aria-checked={cVis === v} tabIndex={rovingTab(i, NOTE_VIS.indexOf(cVis))} className={`k-chip${cVis === v ? " on" : ""}`} onClick={() => { setCVis(v); setVisTouched(true); }}>{l}</button>
              ))}
            </div>
            <textarea aria-label="The note" className="note-area" placeholder="The note — a thought, a plan, a recap…" value={cSummary} onChange={(e) => setCSummary(e.target.value)} rows={cSummary.length > 200 ? 10 : 3} />
            <details className="note-transcript">
              <summary>Transcript or attachments? Add them and <Icon name="sparkles" /> summarize</summary>
              <NoteAttach onText={(t) => setCBody((b) => (b ? b + "\n\n" + t : t))} onFiles={(fs) => setCFiles((p) => [...p, ...fs].slice(0, 8))} />
              {cFiles.length > 0 && (
                <div className="note-pfiles">
                  {cFiles.map((f, i) => (
                    <span key={i} className="k-tag txt max-w-[230px]"><span className="truncate min-w-0">📎 {f.name}</span><button type="button" className="k-tag-x" onClick={() => setCFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Icon name="close" /></button></span>
                  ))}
                  <span className="note-pfiles-hint">kept on the note when you save</span>
                </div>
              )}
              <textarea aria-label="Transcript" className="note-area" placeholder="Paste a transcript — or attach files above to fill this in…" value={cBody} onChange={(e) => setCBody(e.target.value)} rows={4} />
              <button type="button" className="btn-sec btn-sm btn-wide mt-0.5 mb-1" onClick={summarize} disabled={summarizing}>{summarizing ? "Summarizing…" : <><Icon name="sparkles" /> Summarize <Icon name="arrowRight" /> title · recap · tasks</>}</button>
            </details>
            <div className="note-fu-h">Follow-ups
              <button type="button" className="btn-ter" onClick={() => setCActions((a) => [...a, { title: "", category: "task", critical: false, assignee: meId }])}>+ Add</button>
            </div>
            {cActions.length === 0 && <div className="note-fu-empty">No follow-ups yet — add one and assign it: it lands in their My Tasks. Or <Icon name="sparkles" /> summarize a transcript to pull them out.</div>}
            {cActions.map((a, i) => (
              <div className="note-fu-edit" key={i}>
                <input aria-label="Follow-up task" className="note-in" placeholder="Follow-up task…" value={a.title} onChange={(e) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <div className="note-fu-edit-r">
                  <PersonPick label="Assign to" className="note-in" value={{ id: a.assignee ?? null, name: "" }} allowOther={false} allowNone noneLabel="Unassigned"
                              onChange={(v) => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, assignee: v.id } : x))} />
                  <button type="button" className={`k-icon-btn self-center${a.critical ? " on" : ""}`} onClick={() => setCActions((arr) => arr.map((x, j) => j === i ? { ...x, critical: !x.critical } : x))} aria-pressed={a.critical} title="Mark critical"><Icon name="warning" /></button>
                  <button type="button" className="k-icon-btn self-center" onClick={() => setCActions((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="close" /></button>
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
                <button type="button" className={`k-chip${mineOnly ? " on" : ""}`} aria-pressed={mineOnly} onClick={() => setMineOnly((v) => !v)}>Mine</button>
                <button type="button" className={`k-chip${tab === "active" ? " on" : ""}`} aria-pressed={tab === "active"} onClick={() => setTab("active")}>Active</button>
                <button type="button" className={`k-chip${tab === "archived" ? " on" : ""}`} aria-pressed={tab === "archived"} onClick={() => setTab("archived")}>Archived{archivedCount ? ` ${archivedCount}` : ""}</button>
              </div>
            </div>
            {/* On the desk (2026-10-09, redesign 5) the notes stand two to a row, and an opened one reads at half the
                canvas — about a phone's width and a half. Elsewhere the list is the list (not a box at all). */}
            <div className="contents desk:grid desk:grid-cols-2 desk:gap-x-3 desk:items-start">
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
            </div>
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
  const { toast } = useAppStable();
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
    toast(error ? failureWords(error, "Couldn't rename") : "Renamed", error ? "error" : undefined);
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

  // Read, then set — the newest read's answer only (R17, lib/useLatestRead). The note's own comment count rides with the
  // first reads; the tasks' counts need the tasks; all of it is set together, so no count is drawn as 0 and then fills in.
  const read = useLatestRead();
  const load = useCallback(() => read(async () => {
    if (!supabase) return null;
    const [{ data }, { data: adds }, { data: fls }, noteCounts] = await Promise.all([
      supabase.from("event_tasks").select("*").or(`meeting_note_id.eq.${note.id},origin_note_id.eq.${note.id}`).order("sort"),
      supabase.from("note_addenda").select("*").eq("note_id", note.id).order("created_at"),
      supabase.from("note_files").select("*").eq("note_id", note.id).order("created_at"),
      commentCounts("meeting_note_id", [note.id]),
    ]);
    const rows = (data as EventTask[]) ?? [];
    return { rows, adds: (adds as NoteAddendum[]) ?? [], fls: (fls as NoteFile[]) ?? [], taskCounts: await commentCounts("event_task_id", rows.map((r) => r.id)), noteCount: noteCounts[note.id] ?? 0 };
  }, (r) => {
    if (!r) return;
    setItems(r.rows);
    setAddenda(r.adds);
    setFiles(r.fls);
    setCounts(r.taskCounts);
    setNoteCmts(r.noteCount);
  }), [read, note.id]);
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
    if (error) toast(failureWords(error), "error"); else load();
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
      if (error) { toast(failureWords(error, "Couldn't add"), "error"); setAddSaving(false); return; }
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
    if (error) { toast(failureWords(error, "Couldn't remove"), "error"); return; }
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
      // Its follow-through is part of the record (R34): a refused task insert logged the decision with none, and said nothing.
      const { id, error: fuErr } = await createEventTask({ parent: { note: note.id }, label: dec.fu.trim(), kind: "task", section: "Follow-up", sort: 999, assignee: meId });
      if (fuErr || !id) { toast(failureWords(fuErr, "Nothing was logged — the follow-through couldn't be added"), "error"); return; }
      follow_up_task_id = id;
    }
    const { error } = await supabase.from("strategy_decisions").insert({
      key: dec.key.trim().slice(0, 60) || note.title.slice(0, 60), decision: dec.decision.trim(), why: dec.why.trim() || null,
      author_id: meId, author_name: profile?.display_name ?? null, note_id: note.id, follow_up_task_id,
    });
    if (error) { toast(failureWords(error, "Couldn't log"), "error"); return; }
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
        if (error) toast(failureWords(error, "Couldn't save the recap"), "error");
        else { onSummary?.(j.summary); toast("Recap refreshed — additions folded in"); }
      } else toast(String(j.error ?? "").includes("ANTHROPIC") ? "AI isn't switched on yet — add the API key" : failureOr(j.error, "That didn't go through — try again in a moment."), "error");
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
      if (!j.ok) toast(j.error === "AI not configured (set ANTHROPIC_API_KEY)" ? "AI isn't switched on yet — add the API key" : failureOr(j.error, "That didn't go through — try again in a moment."), "error");
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
    if (error) { toast(failureWords(error), "error"); load(); }
  };
  const assign = async (t: EventTask, uid: string) => {
    if (!supabase) return;
    const prev = t.assignee ?? null;
    const next = uid || null;
    setAssignFor(null);
    if (next === prev) return;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, assignee: next } : x))); // optimistic
    const { error } = await supabase.from("event_tasks").update({ assignee: next }).eq("id", t.id);
    if (error) { toast(failureWords(error), "error"); load(); return; }
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
  // A LONG PRESS ON A NOTE (2026-10-08, the navigation round, approved): on its head, the note's own buttons
  // by name — open it, rename it, add to it, discuss it, archive or restore it, delete it. One that works
  // inside the note opens the note too. The note's words still select: the press is the head's.
  const canEdit = note.created_by === meId || isAdmin;
  const inside = (f: () => void) => () => { f(); if (!open) onToggle(); };
  const press = useLongPress(note.title, [
    { key: "open", label: open ? "Close the note" : "Open the note", icon: open ? "close" : "info", run: onToggle },
    ...(canEdit ? [{ key: "rename", label: "Rename this note", icon: "edit", run: inside(() => { setTitleDraft(note.title); setRenaming(true); }) } satisfies MenuItem] : []),
    ...(canEdit ? [{ key: "add", label: "Add to this note", icon: "plus", run: inside(() => setAdding(true)) } satisfies MenuItem] : []),
    ...(note.visibility === "collab" || note.created_by === meId ? [{ key: "discuss", label: "Discuss this note", icon: "chat", run: inside(() => setNoteThread(true)) } satisfies MenuItem] : []),
    { key: "archive", label: note.archived_at ? "Restore" : "Archive", run: onArchive },
    ...(isAdmin ? [{ key: "delete", label: "Delete note", icon: "close", danger: true, run: onDelete } satisfies MenuItem] : []),
  ]);
  return (
    // The card's id is what "open that note" lands on (lib/noteLink, 2026-10-12).
    <div id={noteAnchor(note.id)} className={`note-card scroll-mt-4${open ? " open" : ""}`}>
      {press.menu}
      <button {...press.bind} type="button" className="note-head pressable" onClick={onToggle} aria-expanded={open}>
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
                <button type="button" className="btn-pri" onClick={saveTitle} disabled={!titleDraft.trim()}>Save</button>
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
                toast(error ? failureWords(error, "Couldn't change") : v === "private" ? "Now just for you" : v === "team" ? "Team can read it now" : "Team can read & comment now", error ? "error" : undefined);
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
                  if (error) toast(failureWords(error, "Couldn't remove"), "error"); else { toast("Addition removed"); load(); }
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
                <textarea aria-label="What's new" className="note-area" placeholder="What's new since — a call, a decision, the next conversation…" value={addDraft}
                  onChange={(e) => setAddDraft(e.target.value)} rows={addDraft.length > 200 ? 8 : 3} autoFocus />
                <NoteAttach onText={(t) => setAddDraft((b) => (b ? b + "\n\n" + t : t))} onFiles={(fs) => setAddFiles((p) => [...p, ...fs].slice(0, 8))} />
                {addFiles.length > 0 && (
                  <div className="note-pfiles">
                    {addFiles.map((f, i) => (
                      <span key={i} className="k-tag txt max-w-[230px]"><span className="truncate min-w-0">📎 {f.name}</span><button type="button" className="k-tag-x" onClick={() => setAddFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><Icon name="close" /></button></span>
                    ))}
                    <span className="note-pfiles-hint">kept on the note</span>
                  </div>
                )}
                <div className="note-addbox-r">
                  <button type="button" className="note-arch" onClick={() => { setAdding(false); setAddDraft(""); setAddFiles([]); }}>Cancel</button>
                  <button type="button" className="btn-pri" onClick={saveAdd} disabled={addSaving || (!addDraft.trim() && addFiles.length === 0)}>{addSaving ? "Adding…" : "Add to note"}</button>
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
              <button type="button" className="btn-ter mt-3" onClick={() => setNoteThread((v) => !v)} aria-expanded={noteThread}>
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
                <input aria-label="What it concerns" className="note-in" placeholder={`What it concerns (blank = "${note.title.slice(0, 36)}${note.title.length > 36 ? "…" : ""}")`} value={dec.key} onChange={(e) => setDec({ ...dec, key: e.target.value })} maxLength={60} />
                <input aria-label="The decision" className="note-in" placeholder="The decision, one sentence" value={dec.decision} onChange={(e) => setDec({ ...dec, decision: e.target.value })} />
                <input aria-label="Why" className="note-in" placeholder="Why (optional — future-you will ask)" value={dec.why} onChange={(e) => setDec({ ...dec, why: e.target.value })} />
                <input aria-label="Follow-up task" className="note-in" placeholder="Follow-up task (optional — files on this note)" value={dec.fu} onChange={(e) => setDec({ ...dec, fu: e.target.value })} />
                <div className="note-addbox-r">
                  <button type="button" className="note-arch" onClick={() => { setLogging(false); setDec({ key: "", decision: "", why: "", fu: "" }); }}>Cancel</button>
                  <button type="button" className="btn-pri" onClick={saveDecision} disabled={!dec.decision.trim()}>Log it</button>
                </div>
              </div>
            ) : (
              <button type="button" className="note-renamelink" onClick={() => setLogging(true)}>⚖ Log a decision</button>
            )
          )}
          <OpsPlan noteId={note.id} />
          <div className="note-fu-h">Follow-ups
            {/* An owner's or admin's (R32 — the follow-ups are tasks, and tasks are theirs to add: /api/agents/recap asks the same) */}
            {isAdmin && <button type="button" className="btn-ter ml-auto" onClick={suggest} disabled={suggesting}>{suggesting ? "Reading…" : <><Icon name="sparkles" /> Suggest</>}</button>}
          </div>
          {items.map((t) => (
            <div key={t.id} className="note-fu-wrap">
              <div className={`note-fu${t.done ? " done" : ""}`}>
                <button type="button" className="task-check" onClick={() => toggle(t)} aria-label={`Mark done: ${t.label}`}>
                  <span className="task-box">{t.done && <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-11" /></svg>}</span>
                </button>
                <span className="note-fu-label">{t.label}</span>
                <button type="button" className="btn-sec btn-sm shrink-0" onClick={() => setAssignFor(t)}>{t.assignee ? firstNameOf(t.assignee) : "Assign"}</button>
                <button type="button" className="note-fu-flag" onClick={() => setOpenThread(openThread === t.id ? null : t.id)} aria-label="Discuss" title="Discuss"><Icon name="chat" />{counts[t.id] ? <span className="cmt-count">{counts[t.id]}</span> : null}</button>
                <button type="button" className="note-fu-flag" onClick={() => flag(t)} aria-label="Flag as can't-miss" title="Flag as can't-miss">⚑</button>
                {!t.ai_proposal && <button type="button" className="note-fu-flag" onClick={() => resolve(t)} disabled={resolving.has(t.id)} aria-label="Propose how to complete this" title="Propose how to complete this">{resolving.has(t.id) ? "…" : "💡"}</button>}
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
            <input aria-label="New follow-up" className="note-in" placeholder="Add a follow-up…" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button type="button" kind="primary" compact onClick={add} disabled={!newItem.trim()}>Add</Button>
          </div>
          <div className="note-foot">
            <button type="button" className="note-arch" onClick={onArchive}>{note.archived_at ? "Restore" : "Archive"}</button>
            {isAdmin && <button type="button" className="btn-del mt-4" onClick={onDelete}>Delete note</button>}
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
  const { toast } = useAppStable();
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
  if (useChanged(bookingsState.data) && bookingsState.data) setReqs(bookingsState.data.reqs);   // during render (R17, lib/useChanged)
  useRealtimeTable(["booking_requests"], load);

  const setStatus = async (id: string, status: BookingRequest["status"]) => {
    const { error } = await supabase!.from("booking_requests").update({ status }).eq("id", id);
    toast(error ? failureWords(error) : `Marked ${status}`, error ? "error" : undefined);
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
    if (error) { toast(failureWords(error, "Couldn't create the event"), "error"); return; }
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
        if (res.kind === "error") { toast(failureWords(res, "Couldn't create the account"), "error"); return; }
        vendorId = res.id;
      }
      const { data: opp, error: oppErr } = await supabase.from("opportunities").insert({
        vendor_id: vendorId, stage: "warm", source: "inbound",
        next_step: "Reply to their request", created_by: user.id,
      }).select("id").single();
      if (oppErr) { toast(failureWords(oppErr, "Couldn't open the opportunity"), "error"); return; }
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
      if (cErr) toast(failureWords(cErr, "Opportunity's up, but the context note didn't save"), "error");
      const { error: linkErr } = await supabase.from("booking_requests")
        .update({ opportunity_id: oppId, ...(r.status === "new" ? { status: "contacted" } : {}) }).eq("id", r.id);
      if (linkErr) toast(failureWords(linkErr, "Opportunity's up, but the request didn't link"), "error");
      else toast("Promoted — the pursuit lives in Business › Pipeline now");
      load();
    } finally { setPromoting(null); }
  };
  const del = async (r: BookingRequest) => {
    if (!(await confirm({ title: `Delete the booking request from ${r.name ?? "this contact"}?`, body: "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
    setReqs((p) => p.filter((x) => x.id !== r.id)); // optimistic
    const { error } = await supabase!.from("booking_requests").delete().eq("id", r.id);
    if (error) { toast(failureWords(error, "Couldn't delete"), "error"); load(); } else toast("Booking request deleted");
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
            <span className="adm-ref">{[r.headcount ? `${r.headcount} ppl` : null, `submitted ${relativeDay(r.created_at)}`, r.quiet ? "came in a burst, not announced" : null].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="meta">
            {r.email && <><a href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? " · " : ""}</>}{r.phone}
            {r.location_text && <> · {r.location_text}</>}
            {r.notes && <><br />{r.notes}</>}
          </div>
          {/* Decision anatomy (2026-08-01 audit): the status ladder and the forward doors were seven
              identically-dressed mysteries on one row. Two LABELED groups now — "Status" (choose a
              state: the kit's chips) and "Turn it into" (go somewhere: the kit's compact buttons) — with
              delete as the kit's destructive words, not a floating red circle that read as close-this-card. */}
          <div className="adm-status">
            <span className="adm-ctl-k">Status</span>
            {STATUSES.map((s) => (
              <button key={s} type="button" className={`k-chip sm${r.status === s ? " on" : ""}`} aria-pressed={r.status === s} onClick={() => setStatus(r.id, s)}>{s}</button>
            ))}
          </div>
          <div className="adm-status adm-doors">
            <span className="adm-ctl-k">Turn it into</span>
            <button className="btn-sec btn-sm" onClick={() => makeEvent(r)}><Icon name="arrowRight" /> An event</button>
            {r.opportunity_id ? (
              <button className="btn-sec btn-sm" onClick={() => document.getElementById("pipeline-board")?.scrollIntoView({ behavior: scrollMotion(), block: "start" })}>On the pipeline <Icon name="arrowRight" /></button>
            ) : (
              <button className="btn-sec btn-sm" onClick={() => promote(r)} disabled={promoting === r.id}>{promoting === r.id ? "Promoting…" : <><Icon name="arrowRight" /> A pipeline account</>}</button>
            )}
            <button type="button" className="btn-del ml-auto" onClick={() => del(r)} aria-label={`Delete booking request from ${r.name ?? "contact"}`}>Delete</button>
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
  const { toast } = useAppStable();
  // Which card is correcting Left by hand (lib/reserveStock.setLeft) — Stock is the usual box.
  const [fixingLeft, setFixingLeft] = useState<string | null>(null);
  // R50: a search over the drops (the console audit's point 2).
  const [q, setQ] = useState("");
  const reservesState = useAsyncData<Reserve[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // A failed read is not "No reserves yet" — it was, until the error was read.
    const { data, error } = await supabase.from("reserves").select("*").order("sort");
    if (error) throw new Error(error.message);
    return (data as Reserve[]) ?? [];
  }, []);
  const load = reservesState.reload;
  // THE PICKUP A RESERVE IS HANDED OVER AT (0400): a stop on the schedule — from a month back (a reserve keeps the pickup it
  // had) to what is coming. A reserve with none is "opening soon" on the page and cannot be paid for.
  const stopsState = useAsyncData<{ id: string; name: string | null; starts_at: string | null; canceled_at: string | null }[]>(async () => {
    if (!supabase) return [];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("stops").select("id, name, starts_at, canceled_at").gte("starts_at", since).order("starts_at").limit(80);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; name: string | null; starts_at: string | null; canceled_at: string | null }[];
  }, []);

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
      if (error) { toast(failureWords(error, "Couldn't update"), "error"); load(); return false; }
      if (data && data.length) { toast(said(c)); load(); return true; }
      const { data: fresh, error: again } = await supabase.from("reserves").select("*").eq("id", cur.id).maybeSingle();
      if (again || !fresh) { toast(`Couldn't update — ${again ? plainFailure(again) : "that reserve is gone"}`, "error"); load(); return false; }
      cur = fresh as Reserve;
    }
    toast("Claims kept landing while this saved — nothing changed. Try again.", "error");
    load();
    return false;
  };

  const update = async (id: string, patch: Partial<Reserve>) => {
    const { error } = await supabase!.from("reserves").update(patch).eq("id", id);
    toast(error ? failureWords(error) : "Reserve updated", error ? "error" : undefined);
    if (!error) load();
  };
  const add = async () => {
    const { error } = await supabase!.from("reserves").insert({
      name: "", price_cents: 1200, stock_total: 12, stock_remaining: 12, status: "draft", sort: reservesState.data?.length ?? 0,
    });
    toast(error ? failureWords(error) : "Reserve created — set details, then set it Live", error ? "error" : undefined);
    if (!error) load();
  };
  const archive = async (id: string) => {
    if (!(await confirm({ title: "Archive this reserve?", body: "It disappears from the app.", confirmLabel: "Archive" }))) return;
    await update(id, { status: "archived" });
  };
  const remove = async (id: string, nm: string) => {
    if (!(await confirm({ title: `Delete “${nm}” for good?`, body: "This permanently removes the reserve and any claims on it. It can't be undone. Archive instead if you just want it hidden.", confirmLabel: "Delete for good", cancelLabel: "Keep it", danger: true }))) return;
    const { error } = await supabase!.from("reserves").delete().eq("id", id);
    toast(error ? failureWords(error, "Couldn't delete") : "Reserve deleted", error ? "error" : undefined);
    if (!error) load();
  };

  return (
    <div className="adm-sec">
      <SectionHeader label="Reserves" right={<Button type="button" kind="quiet" onClick={add}>+ Add</Button>} />
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
          const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
          const shown = active.filter((r) => {
            const hay = `${r.name} ${r.blurb ?? ""} ${r.status}`.toLowerCase();
            return terms.every((t) => hay.includes(t));
          });
          const pickupOf = (r: Reserve) => {
            const st = (stopsState.data ?? []).find((x) => x.id === r.stop_id);
            return st ? reserveStopLabel(st) : r.stop_id ? "Its pickup" : "";
          };
          return (
            <>
              <div className="flex flex-wrap gap-2 items-center mb-2">
                <div className="flex-1 min-w-0">
                  <input type="search" className="w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drops"
                         aria-label="Search the reserve drops" enterKeyHint="search" autoComplete="off" />
                </div>
                {/* R50: the drops shown, as a file (the console audit's point 10). */}
                <button type="button" className="btn-sec btn-sm shrink-0" disabled={!shown.length} onClick={() => void downloadCsv("gt3-reserves.csv", shown.map((r) => ({
                  Name: r.name, Blurb: r.blurb ?? "", Price: moneyPlain(r.price_cents), Stock: r.stock_total, Left: r.stock_remaining,
                  "Per member": r.per_member_limit, "Members only": r.member_only ? "yes" : "no", Status: r.status, Pickup: pickupOf(r), "Drop at": r.drop_at ?? "",
                })))}>Export CSV</button>
              </div>
              {terms.length > 0 && shown.length === 0 && <p className="cp-line dim">No matches.</p>}
              {shown.map((r) => (
                <div className="adm-member" key={r.id}>
                  <div className="adm-member-top">
                    <input aria-label="Reserve name" className="auth-input" style={{ fontSize: 16, padding: "9px 11px" }} maxLength={120} defaultValue={r.name} onBlur={(e) => e.target.value !== r.name && update(r.id, { name: e.target.value })} />
                  </div>
                  <input aria-label="The line guests see" className="auth-input" style={{ fontSize: 16, padding: "9px 11px", marginTop: 6 }} maxLength={300} defaultValue={r.blurb ?? ""} placeholder="One line guests see" onBlur={(e) => (e.target.value.trim() || null) !== r.blurb && update(r.id, { blurb: e.target.value.trim() || null })} />
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
                    <Button type="button" kind="destructive" onClick={() => remove(r.id, r.name)}>Delete</Button>
                  </div>
                  <div className="adm-fields">
                    <label>Pickup
                      <select defaultValue={r.stop_id ?? ""} key={`stop-${r.stop_id ?? ""}`} onChange={(e) => update(r.id, { stop_id: e.target.value || null })}>
                        <option value="">None yet — opening soon</option>
                        {r.stop_id && !(stopsState.data ?? []).some((st) => st.id === r.stop_id) && <option value={r.stop_id}>Its pickup</option>}
                        {(stopsState.data ?? []).map((st) => (
                          <option key={st.id} value={st.id}>{reserveStopLabel(st)}{st.canceled_at ? " · called off" : ""}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <ReserveClaims reserveId={r.id} />
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
  // The clock, read as the screen renders (lib/useMinute) — not Date.now() in a render (R16: the purity rule).
  const now = useMinute();
  const subsState = useAsyncData<Subscription[]>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    // A FAILED READ IS NOT "NO SUBSCRIBERS YET" (2026-10-12): the error went unread, null became [], and the panel
    // said nobody had subscribed. It is an error now, with Try again.
    const { data, error } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
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
  const daysTo = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - now) / 86400000) : null);
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
      errorSub="This is not an empty list — we could not read the subscriptions just now."
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
  const { toast } = useAppStable();
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
    if (error) { setIsDriver(!next); toast(failureWords(error), "error"); }
    else toast(next ? `${m.display_name ?? "Member"} tagged as driver 🚗` : "Driver tag removed");
  };
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  // Keep the loyalty inputs honest if a realtime reload changes them underneath us.
  // During render (R17, lib/useChanged): the inputs follow the record the moment it changes, not a render later.
  const ptsNew = useChanged(m.points), creditNew = useChanged(m.credit_cents), foundingNew = useChanged(m.founding_member);
  if (ptsNew || creditNew || foundingNew) { setPts(m.points); setCredit(moneyPlain(m.credit_cents)); setFounding(m.founding_member); }
  const dirty = name !== (m.display_name ?? "") || pts !== m.points || credit !== moneyPlain(m.credit_cents) || founding !== m.founding_member;

  const save = async () => {
    setBusy(true);
    // The name first, and nothing more if it was refused (R12b, F4): "Saved" followed a name that never changed.
    if (name !== (m.display_name ?? "") && !wrote(await supabase!.rpc("admin_set_display_name", { member: m.id, name }), toast, "Couldn't change the name")) { setBusy(false); return; }
    // Only what was changed goes (0414): the points, the credit or Founding as read when the form loaded would write back
    // over a spend at the window or a referral's undoing made since — null leaves each as the database has it.
    const { error } = await supabase!.rpc("admin_set_member", {
      member: m.id,
      new_points: pts !== m.points ? pts : null,
      new_credit_cents: credit !== moneyPlain(m.credit_cents) ? Math.max(0, Math.round(parseFloat(credit || "0") * 100)) : null,
      new_founding: founding !== m.founding_member ? founding : null,
    });
    setBusy(false);
    toast(error ? failureWords(error) : `Saved ${m.display_name ?? "member"}`, error ? "error" : undefined);
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
    if (error) { onPatch(m.id, role); toast(failureWords(error), "error"); }
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
          <Button kind="primary" compact onClick={save} disabled={!dirty || busy}>{busy ? "…" : "Save"}</Button>
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
  // THE CREW, NOT EVERY ACCOUNT (R38 — the fresh audit's PERF11-09). Team read every account — customers too, every
  // column — to draw a dozen rows, and read them all again on any change to any account: profiles.points moves with each
  // member's pickup, so a busy service re-downloaded every customer on every device showing Team. It reads the crew now
  // (lib/roles STAFF_ROLES — exactly the roles rawRole doesn't call a member) and counts every account; a read that fails
  // is said, never an empty roster. The channel still listens to every profile, as before — not a filter on the crew's
  // roles, which a demotion's new row (a member's) would never match — and what it reads again is the dozen and a count.
  const membersState = useAsyncData<{ staff: Profile[]; total: number | null }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const [crew, all] = await Promise.all([
      supabase.from("profiles").select("*").in("role", STAFF_ROLES).order("display_name"),
      supabase.from("profiles").select("id", { count: "exact", head: true }),
    ]);
    if (crew.error) throw crew.error;
    return { staff: (crew.data as Profile[]) ?? [], total: all.error ? null : (all.count ?? null) };
  }, []);
  const [members, setMembers] = useState<Profile[]>([]);
  if (useChanged(membersState.data) && membersState.data) setMembers(membersState.data.staff);   // during render (R17, lib/useChanged)
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
  // Every account less the crew; a count that couldn't be read says nothing (null), never "no customers".
  const total = membersState.data?.total ?? null;
  const customerCount = total === null ? 0 : Math.max(0, total - staff.length);
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
// The next event on the calendar, as v_event_record reads it — the panel asks whether it is today.
type NextEvent = {
  id: string; title: string | null; day: string | null; stage: string | null; phase: string | null;
  tasks: number | null; tasks_open: number | null; tasks_critical_open: number | null;
  staff: number | null; sales_count: number | null; recap: string | null;
};
// WHERE IT STANDS (2026-10-10, the Live Ops fold). It was one folded panel — "Event heads-up", a title
// with nothing under it — at the bottom of Live Ops, so a live event's sales sat a tap and 2,300px
// down, and an event that was today and not live (its card sales counting toward nothing) said so
// only to whoever opened it. Two places now, one rule — the day decides:
//   · "top": the live event's numbers, or today's event that is not live yet, above the Pass;
//   · "later": the next event on the calendar, one row in the right column until it is today.
// Each place reads what it needs; only a live event is polled (the $/hr clock, Square walk-ups).
// THE LIVE EVENT (Command, since 2026-10-11 — it led Live Ops): its sales, pace and plan while it is live; today's
// event, not live yet, with its "Make it live"; nothing otherwise. Its "Next event" row went with the move: the next
// event is Readiness' and Plan's, where it already was.
function EventHUD() {
  const { toast } = useAppStable();
  const now = useMinute();   // the clock, read as the screen renders (R16: the purity rule)
  const { openRecord } = useRecord();
  const [ev, setEv] = useState<EventRow | null | undefined>(undefined);
  // undefined = still looking; "error" = could not read it (never shown as "nothing on the calendar")
  const [next, setNext] = useState<NextEvent | null | "error" | undefined>(undefined);
  const [arming, setArming] = useState(false);
  // The takings as last read, and whose (the R20 review): null until a read of them answers — never $0 for "no answer" —
  // and another event's never drawn under this one's title.
  const [stats, setStats] = useState<{ eid: string; totals: EventTotals } | null>(null);
  const [econ, setEcon] = useState<EventEcon | null>(null);
  const [catalog, setCatalog] = useState<ProductEcon[]>([]);
  // Read, then set — the newest read's answer only (R17, lib/useLatestRead): the live event and what goes with it land
  // together, so the HUD never draws a live event with the last one's numbers.
  const read = useLatestRead();
  const load = useCallback(() => read(async () => {
    if (!supabase) return null;
    const { data: e } = await supabase.from("events").select("*").eq("is_live", true).maybeSingle();
    if (!e) {
      // Nothing live: say what IS coming, instead of an empty box. Not archived, not done, today
      // or later on the operator's calendar, soonest first.
      const { data: nx, error: nxErr } = await supabase.from("v_event_record")
        .select("id, title, day, stage, phase, tasks, tasks_open, tasks_critical_open, staff, sales_count, recap")
        .is("archived_at", null).neq("stage", "done").gte("day", localToday())
        .order("day", { ascending: true }).limit(1).maybeSingle();
      return { live: null, next: nxErr ? ("error" as const) : ((nx as NextEvent | null) ?? null) };
    }
    const eid = (e as EventRow).id;
    // The takings, added up by the database (R20 — performance F6, 0426 event_totals; lib/eventTotals keeps the rule):
    // three numbers, not every order and sale of the event on every change. A card paid online is a Square payment too,
    // mirrored into event_sales, and is counted once — as report_sales does (0216/0220). Unread, the numbers on the
    // screen stay (null): never $0 for "no answer".
    const totals = await eventTotals(supabase, eid);
    return { live: { ev: e as EventRow, stats: totals } };
  }, (r) => {
    if (!r) return;
    if (!r.live) {
      setEv(null);
      setStats(null);
      setNext(r.next);
      return;
    }
    setEv(r.live.ev);
    if (r.live.stats) setStats({ eid: r.live.ev.id, totals: r.live.stats });
  }), [read]);
  useEffect(() => { load(); }, [load]);
  const liveId = ev?.id ?? null;
  // THE CATALOG AND THE EVENT'S OWN COSTS, READ FOR THE EVENT — NOT FOR EVERY ORDER (R38 — the fresh audit's PERF F6).
  // Both were read again with every order, every walk-up and every 15 seconds while an event was live; neither changes
  // with an order. Read as the event goes live, again when a product changes (products is in the realtime publication),
  // and once a minute while the console is on screen — the event's costs and the products' own aren't published, so a fee
  // entered on another device reaches the gauge within the minute (it was fifteen seconds, with every order). A read that
  // fails keeps what is on the screen.
  const readSide = useLatestRead();
  const loadSide = useCallback(() => readSide(async () => {
    if (!supabase || !liveId) return null;
    const [cat, ec] = await Promise.all([
      supabase.from("product_economics_live").select("*").eq("active", true).order("sort"),
      supabase.from("event_economics").select("*").eq("event_id", liveId).maybeSingle(),
    ]);
    return { catalog: cat.error ? null : ((cat.data as ProductEcon[]) ?? []), econ: ec.error ? undefined : ((ec.data as EventEcon) ?? null) };
  }, (r) => {
    if (!r) return;
    if (r.catalog) setCatalog(r.catalog);
    if (r.econ !== undefined) setEcon(r.econ);
  }), [readSide, liveId]);
  useEffect(() => { loadSide(); }, [loadSide]);
  useRealtimeTable(["products"], loadSide, { enabled: !!liveId });
  useEffect(() => {
    if (!liveId) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") loadSide(); }, 60_000);
    return () => clearInterval(t);
  }, [liveId, loadSide]);
  // Reconcile every 15s while an event is live, so Square POS walk-ups + the $/hr clock advance even if
  // a realtime event is missed (matches the KDS's reconcile). Nothing live, nothing to poll — and a console in a hidden
  // tab doesn't poll either (R38): coming back reads it again (lib/realtime's resume).
  useEffect(() => {
    if (!liveId) return;
    const recon = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000);
    return () => clearInterval(recon);
  }, [liveId, load]);
  useRealtimeTable(["orders", "event_sales", "events"], load);
  // Still reading: out of the way (most days nothing is live, and a placeholder here would jump away).
  if (ev === undefined || (ev === null && next === undefined)) return null;
  if (!ev) {
    // An event that is TODAY and not live says so and offers to make it live (2026-10-04), because the Square mirror
    // files a card sale against the live event and against nothing otherwise (0024) — a forgotten switch is exactly
    // how an event ends up "complete, with nothing recorded as taken". Anything else: nothing (the next event is
    // Readiness' and Plan's). The truck instrument answers the same question for stops, on Live Ops.
    // A read that failed is said (quiet is right for "nothing today", wrong for "we could not find out").
    if (next === "error") {
      return (
        <FoldCard id="hud" title="Today's event" sub="Couldn't check the calendar just now" today={false} label="Today's event">
          <p className="cp-line dim">Couldn&apos;t check whether an event is on today. If one is, make it live from its page so card sales count toward it.</p>
        </FoldCard>
      );
    }
    if (next === undefined || next === null || next.day !== localToday()) return null;
    const title = next.title?.trim() || "Untitled event";
    const makeLive = async () => {
      if (!supabase || arming) return;
      setArming(true);
      const { error } = await setEventLive(supabase, next.id, true);
      setArming(false);
      if (error) { toast(failureWords(error, "Couldn't make it live"), "error"); return; }
      toast("Event is live — sales now track to it");
      load();
    };
    return (
      <FoldCard id="hud" title={title} sub="Today — not live yet" today label="Today's event">
        <div className="adm-sec adm-hud">
          <p className="cp-line">Card sales only count toward an event while it&apos;s live.</p>
          <WayButtons ways={[
            { label: "Make it live", busy: arming, onClick: makeLive },
            { label: "Open it", go: true, onClick: () => openRecord("event", next.id) },
          ]} />
        </div>
      </FoldCard>
    );
  }
  const took = stats && stats.eid === ev.id ? stats.totals : null;   // this event's, read — or not yet
  const hrs = took?.firstAt ? Math.max(0.25, (now - new Date(took.firstAt).getTime()) / 3600000) : 0;
  const perHr = took && hrs ? took.cents / hrs : 0;
  // plan vs actual — feed the real gross into the projection's cost structure
  const proj = projectEvent(ev, econ ?? DEFAULT_ECON, catalog);
  const recon = reconcile(proj, took?.cents ?? 0, econ ?? DEFAULT_ECON);
  const hasPlan = proj.revenueCents > 0;
  const pctOfPlan = hasPlan && took ? Math.round((took.cents / proj.revenueCents) * 100) : 0;
  const netUp = recon.actualNetCents >= 0;
  // THE NET IS AN ESTIMATE, AND SAYS WHAT IT ASSUMED (2026-10-12). It is sales less ingredients at the plan's cost ratio,
  // the crew at its rate for the hours planned and the fixed costs saved — and for an event with no saved economics, the
  // default plan (lib/economics DEFAULT_ECON). It printed "net $312" as if counted; it says "est. net", and names the
  // default plan when that is what it stands on.
  return (
    // One hero mid-service — sales — and one quiet line. The full plan-vs-actual story (ROI, break-even,
    // plan totals) lives in Money → Per-event P&L, not on the Now screen.
    <FoldCard id="hud" title={ev.title} sub="Live now" today label="The live event">
      <div className="adm-sec adm-hud">
        <div className="adm-hud-hero"><b>{took ? moneyRound(took.cents) : "—"}</b><span>in sales</span></div>
        {took
          ? <p className="adm-hud-line">{took.orders} order{took.orders === 1 ? "" : "s"} · {moneyRound(perHr)}/hr{hasPlan && <> · {pctOfPlan}% of plan · est. net <b className={netUp ? "ok" : "red"}>{moneyRound(recon.actualNetCents)}</b></>}</p>
          : <Said as="p" className="adm-hud-line" assertive>Couldn&apos;t read the sales yet — trying again.</Said>}
        {hasPlan && !econ && <p className="cp-line dim">Estimated on the default plan: {planWords()}. Save this event&apos;s economics to use its own.</p>}
      </div>
    </FoldCard>
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
  if (useChanged(econRow) && econRow) setEcon(econRow);   // a fresh row from the parent, during render (R17, lib/useChanged)
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
  const { toast } = useAppStable();
  // Both halves in ONE read: the line's live number, and the drinks it is the average OF. Fetched
  // together so the explanation can never be from a different moment than the thing it explains.
  const catalogState = useAsyncData<{ rows: LiveEcon[]; drinks: EconDrink[] }>(async () => {
    if (!supabase) throw new Error("Supabase client not configured");
    const [live, prods] = await Promise.all([
      supabase.from("product_economics_live").select("*").order("sort"),
      supabase.from("products").select("name, price_cents, econ_key, active").order("sort"),
    ]);
    // A FAILED READ IS NOT AN UNSEEDED CATALOG (2026-10-12): neither error was read, so a failed read drew "No catalog
    // yet — Apply migration 0028 to seed it", sending the owner to re-run a migration over a network blip. Either
    // failing is an error now, with Try again.
    if (live.error) throw new Error(live.error.message);
    if (prods.error) throw new Error(prods.error.message);
    return { rows: (live.data as LiveEcon[]) ?? [], drinks: (prods.data as EconDrink[]) ?? [] };
  }, []);
  const save = async (key: string, patch: Partial<ProductEcon>) => {
    const { error } = await supabase!.from("product_economics").update(patch).eq("product_key", key);
    if (error) toast(failureWords(error), "error"); else catalogState.reload();
  };
  return (
    <AsyncSection
      state={catalogState}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle="No catalog yet"
      emptySub="Apply migration 0028 to seed it."
      loadingLabel="Loading product economics…"
      errorTitle="Couldn't load product economics"
      errorSub="This is not an empty catalog — we could not read prices and costs just now."
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
  onUpdate: (patch: TablesUpdate<"events">) => void;   // the events row's own columns (lib/database.types)
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
          {/* Setting the stage writes the event, so these are buttons that say which is set (aria-pressed), each its own
              stop — not tabs, which a screen reader expects to show a view (R12 — the 10/10 audit, F7). */}
          <div className="ev-stage" role="group" aria-label="Event stage">
            {EVENT_STAGES.map((k) => {
              const cur = st === k;
              const settable = !e.is_live && k !== "live"; // Live is driven by the green flag, not a tap
              return (
                <button key={k} type="button" aria-pressed={cur} disabled={!settable && !cur}
                  className={`k-chip sm hue${cur ? " on" : ""}`} style={{ ["--k-tone" as string]: STAGE_COLOR[k] }}
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
            <button type="button" role="switch" aria-checked={!!e.member_only} className="ev-toggle" onClick={() => onUpdate({ member_only: !e.member_only })}>
              <span className={`k-switch${e.member_only ? " on" : ""}`} aria-hidden><span className="k-switch-k" /></span>
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
            <button className="btn-sec btn-sm" onClick={onArchive}>{e.is_live ? "Close & archive" : "Archive event"}</button>
            <button className="ev-delete" onClick={onRemove}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EventsAdmin() {
  const confirm = useConfirm();
  const { toast } = useAppStable();
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
  if (useChanged(eventsState.data) && eventsState.data) {   // during render (R17, lib/useChanged)
    setEvents(eventsState.data.events);
    setCatalog(eventsState.data.catalog);
    setEconMap(eventsState.data.econMap);
  }

  // upsert the full econ row (keeps DB authoritative copy in sync with the panel)
  const saveEcon = async (id: string, econ: EventEcon) => {
    const was = econMap[id];
    setEconMap((m) => ({ ...m, [id]: econ })); // optimistic — no flicker on the live gauge
    // Refused, the gauge goes back to what the database holds (R12b, F4): it showed numbers that were never kept.
    if (!wrote(await supabase!.from("event_economics").upsert({ event_id: id, ...econ }, { onConflict: "event_id" }), toast, "Couldn't save the event's numbers"))
      setEconMap((m) => { const next = { ...m }; if (was) next[id] = was; else delete next[id]; return next; });
  };

  const update = async (id: string, patch: TablesUpdate<"events">) => {
    const { error } = await supabase!.from("events").update(patch).eq("id", id);
    toast(error ? failureWords(error) : "Event updated", error ? "error" : undefined);
    if (!error) load();
  };
  const addEvent = async (title: string) => {
    // Born dated (next Saturday) — a dateless event is invisible to the calendar, which reads as "it vanished".
    const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return localYMD(d); })();
    // Born at 11:00 — the same de facto standard start time stops already get (FieldOpSheet,
    // AddSheet, CalEdit's defTime all default here); a blank Start field was the one place an event
    // didn't match. Still just a starting point — fully editable on the card.
    const { data, error } = await supabase!.from("events").insert({ title, day_label: "SAT", day: nextSat, start_time: "11:00", sort: events.length }).select("id").single();
    toast(error ? failureWords(error) : "Event added", error ? "error" : undefined);
    if (!error) { if (data) setOpenId((data as { id: string }).id); load(); } // open the new one for editing
  };
  const remove = async (id: string) => {
    if (!(await confirm({ title: "Remove this event?", confirmLabel: "Remove", danger: true }))) return;
    const { error } = await supabase!.from("events").delete().eq("id", id);
    toast(error ? failureWords(error) : "Event removed", error ? "error" : undefined);
    if (!error) load();
  };
  // Mark an event live — sales (POS + app) start tracking to it; only one live at a time.
  const setLive = async (id: string, live: boolean) => {
    const { error } = await setEventLive(supabase!, id, live);
    toast(error ? failureWords(error) : live ? "Event is live — sales now track to it" : "Event closed", error ? "error" : undefined);
    if (!error) load();
  };
  // Archive — closes the event (clears live) and files it out of the active workspace.
  // It stays in the DB for records/AAR; restore brings it back.
  const archive = async (id: string) => {
    const { error } = await archiveOwner(supabase!, { kind: "event", id });
    toast(error ? failureWords(error) : "Event archived", error ? "error" : undefined);
    if (!error) { setOpenId(null); load(); }
  };
  const restore = async (id: string) => {
    const { error } = await supabase!.from("events").update({ archived_at: null }).eq("id", id);
    toast(error ? failureWords(error) : "Event restored", error ? "error" : undefined);
    if (!error) load();
  };

  return (
    <div className="adm-sec">
      <SectionHeader label="Events" right={<>
        <Button kind="quiet" className="mr-2" onClick={() => setGenOpen(true)}><Icon name="sparkles" /> From notes</Button>
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
                      <Button kind="secondary" compact onClick={() => restore(e.id)}>Restore</Button>
                      <Button kind="destructive" onClick={() => remove(e.id)}>Delete</Button>
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
    // A FAILED READ IS NOT "NO INTEREST YET" (2026-10-12): the error went unread and null became an empty list.
    const { data, error } = await supabase.from("subscription_interest").select("pack_size,email,created_at").order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
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
      errorSub="This is not an empty list — we could not read who asked just now."
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
// ORDER HISTORY IS EVERY ORDER, BY THE DAY IT WAS BOUGHT (R51 — Ryan, 2026-10-24: "pull orders and attach orders based on
// the date of purchase"). It was the truck's cups alone, done or void, in the order they were finished; it is every
// channel now — cups, pickups, deliveries, office, the shop — under the day each was bought (components/OrderLedger).
function OrdersHistory() {
  return <OrderLedger />;
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
  const { toast } = useAppStable();
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
    // Clear the old primary first — the partial unique index enforces ONE — and stop there if that was refused.
    if (!wrote(await supabase.from("vendor_locations").update({ is_primary: false }).eq("vendor_id", vendorId).eq("is_primary", true), toast, "Couldn't set primary")) return;
    const { error } = await supabase.from("vendor_locations").update({ is_primary: true }).eq("id", id);
    toast(error ? failureWords(error, "Couldn't set primary") : "Primary location set", error ? "error" : undefined);
    load();
  };
  const archiveLoc = async (id: string, label: string) => {
    if (!supabase) return;
    const { error } = await supabase.from("vendor_locations").update({ is_primary: false, archived_at: new Date().toISOString() }).eq("id", id);
    toast(error ? failureWords(error, "Couldn't remove") : `${label} removed`, error ? "error" : undefined);
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
                {l.is_primary ? <span className="vloc-pri">Primary</span> : <Button kind="secondary" compact onClick={() => setPrimary(l.id)}>Make primary</Button>}
                <Button kind="destructive" onClick={() => archiveLoc(l.id, l.label)}>Remove</Button>
              </div>
            ))}
          </>
        )}
      </AsyncSection>
      <div className="vnew-row" style={{ marginTop: 8 }}>
        <input aria-label="Location name" className="ev-input" value={nm} onChange={(e) => setNm(e.target.value)} placeholder="Location name" maxLength={80} />
        <input aria-label="Address" className="ev-input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Address (optional)" maxLength={300} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <Button type="button" kind="secondary" compact onClick={add} disabled={!nm.trim()}>Add</Button>
      </div>
    </div>
  );
}

function VendorsAdmin() {
  const confirm = useConfirm();
  const { toast } = useAppStable();
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
  if (useChanged(vendorsState.data) && vendorsState.data) {   // during render (R17, lib/useChanged)
    setVendors(vendorsState.data.vendors);
    setStops(vendorsState.data.stops);
    setEvents(vendorsState.data.events);
    setDupes(vendorsState.data.dupes);
  }
  // ONE resolver (0226): exact → open the existing record · look-alike → the confirm sheet ·
  // clean miss → create approved (this is the deliberate vendor book, not an on-the-fly add).
  const add = async (name: string, decision?: ResolveDecision) => {
    const r = await resolveVendor(name, { status: "approved", source: "the vendor book", sort: vendors.length, decision });
    if (r.kind === "similar") { setResolve({ name, candidates: r.candidates, ctx: { type: "add" } }); return; }
    if (r.kind === "error") { toast(failureWords(r), "error"); return; }
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
    if (r.kind === "error") { toast(failureWords(r), "error"); return; }
    setResolve(null);
    const linked = await supabase!.from(sug.kind === "stop" ? "stops" : "events").update({ vendor_id: r.id }).eq("id", sug.id);
    if (!wrote(linked, toast, r.kind === "created" ? `Vendor created, but ${sug.name} isn't linked to it` : `Couldn't link ${sug.name}`)) { load(); return; }
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
    if (error) { toast(failureWords(error, "Couldn't merge"), "error"); return; }
    const rep = (data as { repointed?: Record<string, number> })?.repointed ?? {};
    const moved = Object.entries(rep).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(" · ");
    toast(`Merged into ${keepName}${moved ? ` — repointed ${moved}` : ""}`);
    load();
  };
  // Each one done only when the book says so (R12b, F4).
  const archive = async (id: string) => { if (!wrote(await supabase!.from("vendors").update({ archived_at: new Date().toISOString() }).eq("id", id), toast, "Couldn't archive the vendor")) return; setOpenId(null); load(); };
  const restore = async (id: string) => { if (!wrote(await supabase!.from("vendors").update({ archived_at: null }).eq("id", id), toast, "Couldn't restore the vendor")) return; load(); };
  const del = async (id: string, nm: string) => { if (!(await confirm({ title: `Delete ${nm}?`, confirmLabel: "Delete", danger: true }))) return; if (!wrote(await supabase!.from("vendors").delete().eq("id", id), toast, `Couldn't delete ${nm}`)) return; toast(`${nm} deleted`); load(); };
  // Approve a venue that was added on the fly from a truck stop (0191) — it becomes a first-class
  // vendor. Opening it to fill in the contact details is the natural next step.
  const approve = async (id: string) => { if (!wrote(await supabase!.from("vendors").update({ status: "approved" }).eq("id", id), toast, "Couldn't approve the vendor")) return; toast("Vendor approved"); setOpenId(id); load(); };
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
      <SectionHeader label="Venues & suppliers" right={<InlineCreate label="+ Add" placeholder="Venue or supplier name" onCreate={(name) => add(name)} />} />
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
                        <Button kind="secondary" compact disabled={merging} onClick={() => merge(d.a, d.b, d.a_name, d.b_name)}>Keep {d.a_name}</Button>
                        <Button kind="secondary" compact disabled={merging} onClick={() => merge(d.b, d.a, d.b_name, d.a_name)}>Keep {d.b_name}</Button>
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
                    <Button kind="primary" compact onClick={() => approve(v.id)}>Approve</Button>
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
                    <Button kind="secondary" compact onClick={() => createFrom(sug)}>+ Create</Button>
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
                  <div className="ev-arch-row" key={v.id}><span className="ev-arch-name">{v.name}</span><Button kind="secondary" compact onClick={() => restore(v.id)}>Restore</Button><Button kind="destructive" onClick={() => del(v.id, v.name)}>Delete</Button></div>
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
            if (!wrote(await supabase!.from(ctx.sug.kind === "stop" ? "stops" : "events").update({ vendor_id: c.id }).eq("id", ctx.sug.id), toast, `Couldn't link ${ctx.sug.name}`)) return;
            toast(`${ctx.sug.name} linked to ${c.name}`); load();
          }}
          onAddLocation={async (c) => {
            const ctx = resolve.ctx; setResolve(null);
            const src = ctx.type === "from" && ctx.sug.kind === "stop" ? ctx.sug.stop : null;
            const made = await addVendorLocation(c.id, { label: resolve.name, address: src?.address ?? null, location_text: src?.location_text ?? null, lat: src?.lat ?? null, lng: src?.lng ?? null });
            if (!made) { toast(`Couldn't add “${resolve.name}” as a location of ${c.name}`, "error"); return; }
            if (ctx.type === "from" && !wrote(await supabase!.from(ctx.sug.kind === "stop" ? "stops" : "events").update({ vendor_id: c.id }).eq("id", ctx.sug.id), toast, `Added the location, but couldn't link ${ctx.sug.name}`)) { load(); return; }
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
          <button type="button" className="k-icon-btn ml-auto" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <Segmented label="Guide" size="sm" panelId="guide-page" value={page} onChange={setPage}
          options={[{ key: "start", label: "Start here" }, { key: "sections", label: "Every section" }]} />
      </div>}>
      {/* The two pages turn with a sideways swipe too, like every row of tabs (the gesture round). */}
      <SwipePager levels={[{ keys: GUIDE_PAGES, current: page, go: (k) => setPage(k as "start" | "sections"), depth: 0 }]} panel={tabPanel("guide-page", page)}>
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
                  <span className="k-tag gold">{SEC_WHEN[s]}</span>
                  <span className={`guide-chev ev-chev${isOpen ? " open" : ""}`} aria-hidden>›</span>
                </button>
                {isOpen && (
                  <div className="guide-body">
                    <p className="guide-more">{SEC_MORE[s]}</p>
                    <div className="guide-inside-h">What&apos;s inside</div>
                    <ul className="guide-inside">{SEC_INSIDE[s].map((x) => <li key={x}>{x}</li>)}</ul>
                    {here
                      ? <div className="guide-here-note">You&apos;re in {SEC_LABEL[s]} now.</div>
                      : <Button type="button" kind="primary" compact onClick={() => { onGo(s); onClose(); }}>Go to {SEC_LABEL[s]} ›</Button>}
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
  // Whether it was left open, read once as it is made (R17): the console draws nothing until the session is known (see
  // guideAsked below), so this first draw is the phone's own — no effect setting it a render later.
  const [open, setOpen] = useState(() => {
    if (!remember) return defaultOpen;
    try { const v = localStorage.getItem(storeKey); return v === null ? defaultOpen : v === "1"; } catch { return defaultOpen; }
  });
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
    <section id={id} className={`mpanel scroll-mt-4${open ? " open" : ""}`}>
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
      {/* ON THE DESK (2026-10-09, redesign 5): the three groups in two columns — You, and Advanced under it, on the
          left; the Business beside them (app/tailwind.css desk-settings). A phone reads You, Business, Advanced. */}
      <div className="desk-settings">
      <div className="set-grp set-you">
      <SectionHeader label="You" annotation="you · this phone" />
      <SetList>
        <div id="set-account" className="set-row set-acct"><AccountRow /></div>
        <Panel id="set-notify" title="Notifications" sub="Order alerts and a test ring on this phone, sound, what pings you, quiet hours" value={v(g.notify)} remember={false}>
          <SetPart id="set-alerts"><DeviceAlerts /></SetPart>
          <SetPart id="set-ring"><RingThisPhone /></SetPart>
          <SetPart id="set-sound"><PassSound /></SetPart>
          <SetPart label="What pings you"><NotifPrefs userId={userId} /></SetPart>
        </Panel>
        <Panel id="set-display" title="Display" sub="Day, dark or auto; text size, bold, spacing — this phone" value={v(g.display)} remember={false}>
          <SetPart id="set-theme"><Appearance /></SetPart>
          <SetPart><DisplayControls /></SetPart>
        </Panel>
      </SetList>
      </div>

      <div className="set-grp set-biz">
      {isAdmin && <SectionHeader label="Business" annotation="owners & admins" />}
      <SetList>
        {/* THE STORE, FROM SETTINGS (R48 — Ryan, 2026-10-23: "one would think that what I'm looking for would be in settings
            under business"). What the business sells lives in Catalog, beside its orders and its customers; Settings keeps
            one row that names all of it and opens each where it is — a door, not a second copy (components/GoLine). */}
        {isAdmin && (
          <Panel id="set-store" title="Store & catalog" sub="What you sell — the menu, merch, GT3 Nutrition, drops, plans and codes" remember={false}>
            <GoLine to="catalog" anchor="menu">Menu & products — prices, on or off, sold out</GoLine>
            <GoLine to="catalog" anchor="merch">The Shop · merch — live, hidden, prices</GoLine>
            <GoLine to="catalog" anchor="students">GT3 Nutrition — the course, its price, its students</GoLine>
            <GoLine to="catalog" anchor="lessons">GT3 Nutrition · lessons</GoLine>
            <GoLine to="catalog" anchor="resv">Reserve drops</GoLine>
            <GoLine to="catalog" anchor="plans">Membership plans</GoLine>
            <GoLine to="catalog" anchor="cust-codes">Discount codes</GoLine>
            <GoLine to="catalog" anchor="shoporders">The Shop · orders</GoLine>
          </Panel>
        )}
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
        {/* The words guests read and the splash. An event manager keeps the brand kit in Brand ›
            Kit; Brand's line to this editor is drawn for an owner or an admin. */}
        {isAdmin && (
          <Panel id="set-brand" title="Brand & customer app" sub="Every line guests read, and the app’s splash" remember={false}>
            <SetPart id="set-copy"><SiteCopyEditor /></SetPart>
            <SetPart id="splash"><PromoEditor /></SetPart>
          </Panel>
        )}
      </SetList>
      </div>

      {/* 2026-07-16 scope assessment: the change log, errors and the audit log are tools ABOUT the
          software itself rather than tools for running the business, so they sit last, behind their
          own divider. The reading end of the error intake (0133, lib/errorIntake): every alert that
          says "App error" or "Server error" points at a row that, until that panel, only the SQL
          editor could show. 0306 moved every dropdown's list into the database so the same column
          stopped being a picker on one screen and a text box on another; the lists are edited here,
          or adding a unit means opening the SQL editor. */}
      <div className="set-grp set-adv">
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
      </div>
      </div>
    </>
  );
}

// PROOFS WAITING COME FIRST (2026-10-10, the crew round). Customers opened on the customer book — every guest and
// member, open — and the bottle-owner proofs waiting to be verified sat under it, below hundreds of rows on a phone.
// While any is waiting the queue leads (and on the desk, the left column); with none, it keeps its place beside
// the broadcast and says so there, instead of an empty panel above the book.
function CustomersBody() {
  const [vipWaiting, setVipWaiting] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("vip_verifications").select("id", { count: "exact", head: true }).eq("status", "pending")
      .then(({ count, error }) => { if (!error) setVipWaiting(count ?? 0); });
  }, []);
  const vip = (
    <>
      <SectionHeader label="VIP verification" />
      <Panel id="cust-vip" title="Bottle-owner proofs · verify → Founding" defaultOpen><VipQueue /></Panel>
    </>
  );
  return (
    // On the desk: the customer book on the left; the broadcast on the right — and the proofs over whichever side
    // says they are waiting.
    <Columns>
    <Column>
    {vipWaiting > 0 && vip}
    <SectionHeader label="The people" />
    <Panel id="cust-book" title="Customer book · every guest &amp; member" defaultOpen><CrmPanel /></Panel>
    {/* Discount codes and the founding perks (ids "cust-codes", "cust-perks") are the Catalog's (2026-10-06): what a
        member gets is part of what the business sells. One line where they were. */}
    <GoLine to="catalog" anchor="cust-codes">Codes &amp; perks</GoLine>
    </Column>
    <Column>
    {vipWaiting === 0 && vip}
    {/* MESSAGES (2026-10-06, the settings-by-category round): a broadcast is something the business says to its
        customers, not a setting — so it left Settings for the customer book. */}
    <SectionHeader label="Messages" />
    <Panel id="cust-broadcast" title="Broadcast" sub="A live message or ad, to everyone in the app"><BroadcastEditor /></Panel>
    {/* FROM MONEY (2026-10-15, release 3 of the Plan & Money audit): who pays monthly, who asked for a plan, and where
        people drop off are about customers — the money members bring is Money's Reports › Subscriptions. The ids
        stayed (lib/panelHome). */}
    <SectionHeader label="Members" />
    <Panel id="subs" title="Members" sub="Who pays monthly, and for which plan"><Subscribers /></Panel>
    <Panel id="subint" title="Waiting for a plan" sub="People who asked to hear when a plan opens"><SubInterest /></Panel>
    <GoLine to="catalog" anchor="plans">Membership plans</GoLine>
    <SectionHeader label="Growth" />
    <Panel id="funnels" title="Funnels" sub="Where people drop off — ordering, reserving, delivery, signing up"><FunnelReport /></Panel>
    </Column>
    </Columns>
  );
}

// PLAN IS THE CALENDAR (2026-10-10, Ryan: "Do you even need a tab called calendar" — no; "Plan is the
// calendar", approved). Plan opened on a row of five tabs, Calendar · Events · Route · Leads · Vendors, and
// the first one named the page it opened on. The calendar is the page now: + on any day adds, a tap opens
// any event or stop. The other four are views Plan opens over it, the way a pushed screen opens on an
// iPhone — Back, the edge swipe, a swipe toward the calendar or a tap on Plan in the lane closes one:
// Leads from a button carrying the count of requests waiting (the Inbox on Calendar), and Events, Truck
// stops and Venues & suppliers from Lists. Each keeps its address (?t=, lib/planNav), so every link into
// one still lands there.
const PLAN_LABEL: Record<PlanTab, string> = { calendar: "Calendar", events: "Events", route: "Truck stops", leads: "Leads", vendors: "Venues & suppliers" };
const PLAN_LISTS: readonly { tab: PlanTab; icon: IconName }[] = [{ tab: "events", icon: "event" }, { tab: "route", icon: "pin" }, { tab: "vendors", icon: "partners" }];
/** A list over the calendar says where it is, as Prep › an event does: "Plan › Leads" over the title, Plan a tap
 *  back to the calendar; and the title bar names the list once its heading scrolls away. */
function PlanCrumb({ tab, onBack }: { tab: PlanTab; onBack: () => void }) {
  useCrumb("plan-list", PLAN_LABEL[tab], onBack);
  // On a phone a list is its own screen, as a stop opened from Readiness is (OpViewAware, 2026-10-11): its name is the
  // title under "‹ Plan". The desk keeps "Plan › Truck stops" over the section's title.
  return (
    <>
      <h1 className="op-head-t desk:hidden mb-3">{PLAN_LABEL[tab]}</h1>
      <div data-large-title data-title={PLAN_LABEL[tab]} aria-hidden className="h-0" />
    </>
  );
}

// A VIEW A SECTION OPENED INSIDE ITSELF (a stop's prep, a Plan list) is its own screen on a phone and in the frame
// (2026-10-11, Ryan: "am I managing one event or am I in a menu?"): while one is open, the console's crumb trail, its
// title and the lane's switch step aside — the view names itself, and the row's "‹ Readiness" is the way back. The
// desk keeps all three over its canvas. A view says it is open the way it always has, with a crumb (components/Crumbs).
function OpViewAware({ children }: { children: (open: boolean) => React.ReactNode }) {
  const { crumbs } = useCrumbs();
  return <>{children(crumbs.length > 0)}</>;
}

// The kept Pass is read once a draw (lib/passOpen); nothing outside the page changes it while the page is up.
const neverChanges = () => () => {};
const closedOnServer = () => false;

export default function AdminPage() {
  const { ready, enabled, user, profile, profileStatus, refreshProfile, leader, waitingForCode, waitForCode } = useAuth();
  const { section, setSection, groupId: navGroupId, setGroupId, addressGen } = useOperatorSection();
  const router = useRouter();
  const streams = useWorkStreams();

  // Derive role + nav constants before any conditional return (Rules of Hooks).
  // profiles.role: member/server/operator/event_manager/contractor/admin/owner (0031).
  const role = roleOf(profile);
  const isOwner = role === "owner";
  const isAdmin = role === "admin" || isOwner;
  const canManage = isAdmin || role === "event_manager";
  const canPrep = canManage || role === "operator" || role === "contractor";
  // TWO-STEP FOR THE OWNERS AND ADMINS (R28 — the 10/10 audit, security F6; 0433): an owner or admin with an
  // authenticator gives its code before the console reads anything — once a sign-in (lib/twoStep, TwoStepPrompt). Asked of
  // the role as stored (`leader`): while "Not now" holds, `profile` — and so `role` above — is drawn as an event manager's.
  const twoStep = useTwoStep(leader && profileStatus === "ready", user?.id ?? null, { waiting: waitingForCode, wait: waitForCode });
  const allowed = sectionsForRole(role);
  // Fallback for a section this role can't open is My Day (home), not Live Ops — a server tapping
  // a prep deep-link should land somewhere that explains itself, and the URL/localStorage must not
  // keep re-teleporting her on every cold open.
  const sec: OpSection = allowed.includes(section) ? section : "day";
  // THE SECTION'S NAME, AS THE PAGE'S TITLE — AND SAID (R12 — the 10/10 audit, F11). A section changes by the address's ?s=
  // alone (OperatorSection pushes it), which Next does not hear as a navigation: the title stayed the console's and a screen
  // reader was told nothing. The title names the section now, and a change of section is said (not the first, which the
  // page's load says).
  const saidSection = useRef<OpSection | null>(null);
  useLayoutEffect(() => {
    const name = SECTION_TITLE[sec] ?? "Crew";
    document.title = `${name} — GT3 Performance Bar`;
    if (saidSection.current !== null && saidSection.current !== sec) announce(name);
    saidSection.current = sec;
  }, [sec]);
  const [planTab, setPlanTab] = useState<PlanTab>("calendar");
  // THE GUIDE OPENS ON A PAGE (2026-10-08): "start" — the first day (components/CrewStart) — or
  // "sections", what each section is for. ?guide=start is the welcome letter's link (lib/crewStart
  // START_PATH): read once, in the initializer (the console renders nothing until the session is
  // known, so the first paint cannot disagree with the server's), and taken off the address.
  const [guideAsked] = useState<string | null>(() => readParam("guide"));
  useEffect(() => { if (guideAsked) dropParam("guide"); }, [guideAsked]);
  // First run (the phone has never opened it): it opens on Start here, read in the initializer like ?guide= (R17).
  const [firstRun] = useState(() => { try { return !localStorage.getItem("gt3-guide-seen"); } catch { return false; } });
  const [guide, setGuide] = useState<null | "start" | "sections">(() => (guideAsked ? (guideAsked === "sections" ? "sections" : "start") : firstRun ? "start" : null));
  const [inboxOpen, setInboxOpen] = useState(false);
  const [laneMenu, setLaneMenu] = useState(false);
  // The header 🔔 badge, for EVERY role (2026-10-04). It was gated on canManage — the leader-only rule
  // 0157 retired for alerts — so a server's bell never loaded while My Day and the nav badge counted
  // her pings from the same hook. The bell is the inbox's one door now; it has to open for everyone.
  // THE BELL COUNTS TODAY (2026-10-09, One home). It counted every unanswered alert of the last thirty,
  // so it read the same at 7 AM as at 11 PM and never reached zero. It counts what was true today
  // (lib/home flagIsToday); the inbox behind it, and every other reader of the hook, keep them all.
  const { flags: hdrFlags } = useMyAlerts(user?.id ?? null);
  const hdrToday = hdrFlags.filter((f) => flagIsToday(f, localToday()));
  const hdrTodayCrit = hdrToday.filter((f) => f.severity === "critical").length;
  // First-run: the guide explains the console's language (Live Ops, Readiness, Route) — open it
  // once for a brand-new staffer instead of hoping she finds the ⓘ pill. It opens on Start here now
  // (2026-10-08): someone on the crew side for the first time on a phone needs the first day before
  // the vocabulary — and a phone that came by the letter's link has already opened it there.
  useEffect(() => {
    if (!firstRun) return;
    try { localStorage.setItem("gt3-guide-seen", "1"); } catch { /* ignore */ }
  }, [firstRun]);
  // Cross-route deep link: /crew?s=settings&a=set-copy (or a specific copy group, e.g. sc-craft-page
  // from the owner-only Edit pill on a live page) lands on the right SECTION via
  // OperatorSectionProvider's own ?s= hydration; this consumes the matching ?a= once that section has
  // actually mounted, via the same scrollToAnchor alert links already use.
  // A link to the Pass (&a=kitchen-pass, 2026-10-06) opens it (jumpTo) — and waits until the
  // address's ?s=now has landed, because "leaving Live Ops closes the Pass" (below) would otherwise
  // close it again on the way in, while the section is still the one this page started on.
  // EVERY ARRIVAL, NOT ONLY THE PAGE'S FIRST (R33 — the audit's FE11-01). It was read once per page load (a ref), so a
  // link the router opened in the app — a tapped order alert, a universal link — left its ?a= in the address, unread,
  // until the next section tap threw the crew member into the Pass. It is read whenever the router moves the address
  // (addressGen) and the section lands, and taken out of the address as it is used: an ?a= is read once because it is
  // gone, not because the page remembers.
  useEffect(() => {
    const a = readParam("a");
    if (!a) return;
    if (a === PASS_ANCHOR && sec !== "now" && readParam("s") === "now") return;
    dropParam("a");
    // A LINK TO A PANEL THAT MOVED, OPENED AS A PAGE (2026-10-15): a push, a crew member's "Draft their offer letter"
    // or a bookmark still names the old section (?s=money&a=offers), and the page looked for the panel there. Go to the
    // panel's home first, as an alert tapped in the app does (alertDest → lib/panelHome). Here and not in the section
    // provider: that is in every page's bundle, guests' too, and this effect runs before it reads the address.
    const named = readParam("s") ?? sec;
    const home = panelHome(named, a);
    if (home.section !== named && VALID_SECTIONS.has(home.section as OpSection)) setSection(home.section as OpSection);
    jumpTo(home.anchor ?? a);
  }, [sec, setSection, addressGen]);
  // The header 🔔 opens the ONE inbox (your flags + the needs-you queue). Any screen can summon it
  // (a badged nav tab, the Now strip) via the gt3-open-inbox event; navigating a section closes it.
  useEffect(() => {
    const open = () => setInboxOpen(true);
    window.addEventListener("gt3-open-inbox", open);
    return () => window.removeEventListener("gt3-open-inbox", open);
  }, []);
  // The Guide and the customer's view open from More (2026-10-09, the navigation round), the way the inbox
  // opens from anywhere. Leaving for the customer side is remembered (lib/mode), as the header switch was.
  useEffect(() => {
    const open = () => setGuide("sections");
    const leave = () => { rememberMode("customer"); router.push("/"); };
    window.addEventListener("gt3-open-guide", open);
    window.addEventListener("gt3-customer-view", leave);
    return () => { window.removeEventListener("gt3-open-guide", open); window.removeEventListener("gt3-customer-view", leave); };
  }, [router]);
  if (useChanged(sec)) setInboxOpen(false);   // a new section closes the inbox, during render (R17, lib/useChanged)
  // Utilization (0267): each section visit is an action ping — "last action" reads like
  // "crew:command" in the report. Throttled inside lib/track (1/15s), fire-and-forget.
  useEffect(() => { import("@/lib/track").then((m) => m.trackUser(`crew:${sec}`), () => {}); }, [sec]);
  // Prep drill-in, lifted (2026-07-30): EventPrep drives it, PrepKpis re-scopes its tiles to it —
  // one selection, two readers. Living here (not inside EventPrep) also means stepping out to
  // another section and back no longer loses your place mid-prep.
  const [prepSel, setPrepSel] = useState<PrepTarget | null>(null);
  // Service mode — full-screen KDS (pass + pickups). Esc exits; leaving Now exits. A sheet open over the Pass
  // (Collect, the void's question, a ticket's menu) takes Escape for itself, and the Pass stays (2026-10-08).
  // THE PASS STAYS OPEN THROUGH A RELOAD (R11, lib/passOpen). Until it is opened or closed here, whether it is open is
  // what the phone kept: a Pass phone that reloads on Live Ops — a deploy's self-heal, an update, a relaunch — opens it
  // again, for two hours after it was last open. Read as a store, so the server and the first draw say closed.
  const [chosen, setSvc] = useState<boolean | null>(null);
  const kept = useSyncExternalStore(neverChanges, passWasOpen, closedOnServer);
  const svc = chosen ?? (kept && section === "now");
  // Opened by a touch, the Pass's sound is asked for in that touch (lib/chime, R11): a browser starts sound only from one,
  // and a web Pass opened without asking stayed silent through its first orders.
  const openPass = () => { unlockAudio(); setSvc(true); };
  // Closed on purpose: the phone forgets it was open.
  const closePass = () => { keepPassOpen(false); setSvc(false); };
  // Closed, focus goes back to the Pass's row on Live Ops (R12 — the 10/10 audit, F8): the Pass took the focus with it, and
  // Exit, Escape or leaving left it on nothing — the top of the page, for a keyboard or VoiceOver.
  const passWas = useRef(svc);
  useEffect(() => {
    if (passWas.current && !svc) {
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost) requestAnimationFrame(() => document.querySelector<HTMLElement>('section[aria-label="The Pass"] button')?.focus());
    }
    passWas.current = svc;
  }, [svc]);
  useEffect(() => {
    if (!svc) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !sheetOpen()) { keepPassOpen(false); setSvc(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [svc]);
  // Leaving Live Ops closes it — and a section left after the Pass was on it forgets it; the page's first section, before
  // the address's ?s=now lands, is not a leaving.
  const sectionWas = useRef(section);
  // The Pass's open state follows the section during render (R17, lib/useChanged); the phone's memory of it, which is
  // outside React, in the effect.
  if (useChanged(section) && section !== "now") setSvc((v) => (v ? false : v));
  useEffect(() => {
    if (sectionWas.current === "now" && section !== "now") keepPassOpen(false);
    sectionWas.current = section;
  }, [section]);
  useEffect(() => {
    if (!svc) return;
    keepPassOpen(true);
    const beat = setInterval(() => keepPassOpen(true), PASS_OPEN_BEAT_MS);
    return () => clearInterval(beat);
  }, [svc]);
  // THE SCREEN STAYS ON WHILE THE PASS IS OPEN (2026-10-11, lib/useWakeLock): a phone propped by the window dimmed and
  // locked mid-rush, and a locked phone rings for nobody. Asked again whenever the app comes back; let go on Exit (and
  // on leaving Live Ops, which closes the Pass, above).
  useWakeLock(svc);
  usePassHeartbeat(svc); // …and the device checks in once a minute: Live Ops' Devices card, 0376's alert (components/usePassHeartbeat)
  // THE DAY TURNS OVER ON A SCREEN LEFT OPEN (2026-10-11, lib/useEtDay). Each card reads "today" when it loads, and a
  // phone kept awake through midnight kept yesterday's until something else changed. When the ET day turns, every live
  // screen reads again (lib/realtime refreshLive: the pickup board finds its drop, the runs their next day) and the page
  // renders its day words afresh.
  const etDay = useEtDay();
  const dayWas = useRef(etDay);
  useEffect(() => { if (dayWas.current !== etDay) { dayWas.current = etDay; void refreshLive(); } }, [etDay]);
  // THE PASS OPENS FROM A JUMP (2026-10-06, the settings round) — an order alert's Open, or a link
  // that ends &a=kitchen-pass (jumpTo, near alertDest). The Pass is a screen on Live Ops, so the jump
  // goes to Live Ops and opens it, instead of hunting for an id that exists only once it is open.
  useEffect(() => {
    const open = () => { setSection("now"); unlockAudio(); setSvc(true); };
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
  // FROM THE TWO-STEP PROMPT TO THE CONSOLE, FOCUS GOES WITH IT (R34 — the audit's UX11-05): the code given (or "Not now"),
  // the prompt's field and button went with the prompt and focus fell to the page — a screen reader heard nothing open.
  // The console's section takes it, once, as a section change does.
  const twoStepAskedRef = useRef(false);
  useEffect(() => {
    if (twoStep.need === "code" || twoStep.need === "setup") { twoStepAskedRef.current = true; return; }
    if (twoStep.need !== "none" || !twoStepAskedRef.current) return;
    twoStepAskedRef.current = false;
    opBodyRef.current?.focus({ preventScroll: true });
  }, [twoStep.need]);
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
  // A list Plan opened over the calendar is a step (components/useBack): Back closes it, back to the calendar.
  const planOver = sec === "plan" && canManage && planTab !== "calendar";
  useBackStep(planOver ? "Plan" : null, () => setPlanTab("calendar"));
  const [listsOpen, setListsOpen] = useState(false);
  // The header's ‹ goes where the title bar's and the edge swipe's go (components/useBack): a list Plan opened
  // closes first, then the section before this one. It went straight to the section before, under an open list.
  const backWay = useBack();

  // This device opens on the crew side from now on, until Customer view or Exit says otherwise
  // (lib/mode.ts). The condition is INSIDE the effect — a hook after the guard returns below is a
  // Rules-of-Hooks violation (the lint ratchet caught exactly that placement) — and it is the same
  // test the guards make, so a member bounced off the console never records "crew".
  useEffect(() => {
    if (enabled && ready && user && staffAccess(true, profileStatus, profile) === "allow") rememberMode("crew");
  }, [enabled, ready, user, profileStatus, profile]);

  // Guard returns — all hooks live above (Rules of Hooks compliant). A message here is drawn in the theme's ink
  // (text-cream, R29): its title sets no colour of its own, and on the day console it inherited the body's night cream.
  if (!enabled) return <section className="screen text-cream"><div className="h-title">Admin</div><div className="h-sub">The live backend isn&apos;t configured here.</div></section>;
  // Opening, said (R34 — the audit's UX11-13): a blank screen while the session, the profile and two-step loaded — on a
  // slow signal a crew member saw nothing and a screen reader heard nothing. The brand's loading mark is a status region.
  if (!ready) return <section className="screen"><PourFill label="Opening the console…" /></section>;
  if (!user) return <SignIn context={{ title: "The GT3 console.", sub: "Sign in with your crew account — your shift, prep, plan and money are inside." }} />;
  // KNOWING NOTHING IS NOT THE SAME AS KNOWING YOU ARE A CUSTOMER. roleOf(null) is "member", and
  // `ready` only covers the auth session — so between session-ready and profile-loaded, and after
  // any failed profile read, an owner used to be shown "Staff only" and shut out of this console.
  const access = staffAccess(!!user, profileStatus, profile);
  if (access === "wait") return <section className="screen"><PourFill label="Opening the console…" /></section>;
  if (access === "failed") return (
    <section className="screen text-cream">
      <div className="toprow"><div className="eyb">Crew</div><Link className="k-icon-btn" href="/" aria-label="Back to the app"><Icon name="chevronLeft" /></Link></div>
      <div className="h-title">Couldn&apos;t load your account.</div>
      <div className="h-sub">This is not a permissions problem — we couldn&apos;t read your profile just now, so we don&apos;t know what you can see. Nothing has changed.</div>
      <button type="button" className="btn-pri mt-3.5" onClick={() => refreshProfile()}>Try again</button>
    </section>
  );
  if (role === "member") {
    return (
      <section className="screen text-cream">
        <div className="toprow"><div className="eyb">Crew</div><Link className="k-icon-btn" href="/" aria-label="Back to the app"><Icon name="chevronLeft" /></Link></div>
        <div className="h-title">Staff only.</div>
        <div className="h-sub">This area is for GT3PB staff. If that&apos;s you, ask the owner to add you — then tap below.</div>
        <button type="button" className="btn-pri mt-3.5" onClick={() => window.location.reload()}>I&apos;ve been added — check again</button>
      </section>
    );
  }
  // An owner or admin who owes this sign-in their two-step code gives it first (R28) — or sets one up, where their
  // business requires it; "Not now" opens the console with the crew's tools.
  if (twoStep.need === "checking") return <section className="screen"><PourFill label="Opening the console…" /></section>;
  if (twoStep.need === "code" || twoStep.need === "setup") return <TwoStepPrompt need={twoStep.need} onDone={twoStep.done} onLater={twoStep.later} />;

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
  // A LANE TOO LONG FOR ITS ROW (2026-10-10, the 9→10 round). Business holds six sections (seven where Settings
  // is filed under it), and its row on a phone ran off both edges — "Te" at the right on Money, "ney" at the
  // left on Team. Past three, the title is the switch: it names the section you are in, a chevron beside it, and
  // opens the lane's sections in a sheet, the one you are in checked — the way iOS draws a title that opens a
  // menu. The desk (redesign 5) is wide enough for the row and keeps it, under the lane's name. A sideways
  // swipe turns through a lane's sections either way.
  const switcher = lane.members.length > 3;


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
          {/* NAMED FOR WHERE IT GOES (2026-10-11): "‹ Readiness", as an iPhone's back button says the screen it returns
              to — a round ‹ said nothing, and the crumb trail that did is a desktop's (it steps aside on a phone). */}
          {backWay && <BackButton label={backWay.label} onClick={backWay.go} />}
          {/* THREE CONTROLS (2026-10-09, the navigation round — Ryan: "Switch + Guide to More", approved). The
              Crew/Customer switch and the Guide stood here every day for a choice made once a week: they are
              rows in More now (components/OperatorNav, MoreSheet), and the row holds what is used all day. */}
        </div>
        <div className="toprow-actions">
          {/* Quick actions on a phone — run a copilot, ask GT3, a note, a purchase (2026-10-08, the iPhone
              chrome round, approved): the ✦ that floated over every crew screen lives here, beside search.
              The frame (desktop, iPad) keeps the floating button and does not draw this one; the desk (2026-10-09,
              redesign 5) draws this one, and nothing floats over its canvas. */}
          <IconButton icon="sparkles" label="Quick actions — run a copilot, ask GT3, take a note, or log a purchase" className="frame:hidden! desk:inline-flex!" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("gt3-quick-do"))} />
          {/* Jump — touch entry to the command palette (⌘K on a keyboard). */}
          <IconButton icon="search" label="Jump to a section, recent, or action" hint="⌘K" onClick={() => window.dispatchEvent(new Event("gt3-open-cmdk"))} />
          {/* Inbox — the one place everything that needs you rolls up (flags + needs-you), from any screen. */}
          <IconButton icon="bell" label={hdrToday.length ? `Inbox — ${hdrToday.length} today` : "Inbox"} badge={hdrToday.length} crit={hdrTodayCrit > 0} onClick={() => setInboxOpen(true)} />
        </div>
      </div>
      {guide && <SectionGuide allowed={allowed} current={sec} start={guide === "start"} onGo={setSection} onClose={() => setGuide(null)} />}
      {/* "Not now" on the two-step code (R28): the owner's and admin's tools wait for it, and this asks again. */}
      {twoStep.deferred && (
        <p className="dp-hint" role="note">
          The owner and admin tools are waiting for your two-step code.{" "}
          <button type="button" className="auth-link min-h-11 inline-flex items-center" onClick={twoStep.ask}>Enter it</button>
        </p>
      )}
      {inboxOpen && (
        <Sheet open onClose={() => setInboxOpen(false)} label="Inbox" header={<div style={{ display: "flex", alignItems: "center" }}><b style={{ fontFamily: "var(--sans)", fontSize: 15 }}><Icon name="bell" /> Inbox</b><CloseButton onClick={() => setInboxOpen(false)} /></div>}>
          <AlertsInbox userId={user?.id ?? null} title="Flags & pings for you" onNavigate={() => setInboxOpen(false)} />
        </Sheet>
      )}
      <OpViewAware>{(inView) => (
      <div className={`op-head${inView ? " hidden desk:block" : ""}`}>
        {/* Breadcrumb trail — only appears once a deep view registers a crumb (e.g. Prep › event). The desk's: on a
            phone the view is its own screen and the row's back says where it goes (OpViewAware). */}
        <Breadcrumbs root={SEC_LABEL[sec]} />
        <div className="op-head-row">
          {/* 2026-07-29 a11y: real per-section h1 (was a div) — AppShell's route-level sr-only h1
              is static ("Crew console") and never reflected which of the 17 sections you were in;
              /crew joined H1_SKIP so this is the one heading now, and it actually updates with sec. */}
          {/* data-large-title: the title bar (components/TitleBar) names the section once this has scrolled away. */}
          {/* THE NAME, ONCE (2026-10-09, the navigation round). Over a lane's row of sections the title said the
              section the row's thumb already showed — "My Day" over "My Day", under a tab that said "Today". It
              names the lane now, as the tab does; the row names the section. A lane of one names its section. A lane
              of more than three has no row on a phone (A LANE TOO LONG FOR ITS ROW, above): its title names the section
              and is the switch, and the sheet it opens names the lane. */}
          {switcher ? (
            <h1 className="op-head-t" data-large-title>
              {/* the title's own type, a chevron beside it in the quieter ink; the whole of it is the target, 44px tall,
                  its negative margin keeping the title's line where it was; pressed, it dims, as a bar button does */}
              <button type="button" className="desk:hidden! inline-flex items-center gap-1.5 min-h-11 -my-2 p-0 border-0 bg-transparent text-cream [font:inherit] text-left cursor-pointer appearance-none transition-opacity active:opacity-55"
                aria-haspopup="dialog" aria-expanded={laneMenu} onClick={() => setLaneMenu(true)}>
                {SEC_LABEL[sec]}<Icon name="chevronDown" stroke={3} className="size-5 text-cream-muted" />
              </button>
              <span className="hidden desk:inline">{lane.label}</span>
            </h1>
          ) : (
            <h1 className="op-head-t" data-large-title>{lane.members.length >= 2 ? lane.label : SEC_LABEL[sec]}</h1>
          )}
          {/* The WHEN pill ("START OF SHIFT ⓘ", "DURING SERVICE ⓘ") stood here until 2026-10-04: a
              fixed tagline styled as a status — it said "During service" at 10 PM with the truck
              offline — opening the same guide as the Guide button two inches above it. The guide
              still carries each section's "when" (SEC_WHEN); the title no longer pretends to. */}
        </div>
      </div>
      )}</OpViewAware>

      {/* Secondary toggle — the ACTIVE LANE's sections (a section can live in two lanes — prep is
          Service's and Events' — so the tapped tab, tracked as groupId, wins the ambiguity). */}
      {/* One track, the section you are in on a thumb that slides to the one you tap (2026-10-07, the
          pill round) — three outlined pills before, the chosen one filled. The row shares its width
          equally and scrolls when a lane's names will not fit (the larger text sizes). */}
      {/* Past three (the switch, above), the row is the desk's alone. */}
      {lane.members.length >= 2 && (
        <OpViewAware>{(inView) => (
          <Segmented fill className={`lane-tabs mb-3.5${switcher || inView ? " hidden! desk:flex!" : ""}`} label={lane.label} panelId="lane-panel" value={sec}
            options={lane.members.map((m: OpSection) => ({ key: m, label: SECTION_LABEL[m] }))} onChange={(m) => inLane(m)}
            onReselect={(m) => { if (m === "plan" && planOver) setPlanTab("calendar"); }} />
        )}</OpViewAware>
      )}
      {/* The switch's sheet: the lane's sections by the row's names, the one you are in checked. Picking it again
          does what tapping its segment again does (Plan, over a list: back to the calendar). */}
      {laneMenu && switcher && (
        <RowMenu title={lane.label} label={`${lane.label} — sections`} onClose={() => setLaneMenu(false)}
          items={lane.members.map((m: OpSection) => ({ key: m, label: SECTION_LABEL[m], current: m === sec, icon: m === sec ? "check" as const : undefined,
            run: () => { if (m !== sec) inLane(m); else if (m === "plan" && planOver) setPlanTab("calendar"); } }))} />
      )}

      {/* SWIPE BETWEEN TABS (components/SwipePager, 2026-10-05): a sideways swipe on the section turns
          to the lane's next or previous section. On a list Plan opened over the calendar, a swipe toward
          the calendar is the way back to it (2026-10-10, Plan is the calendar). Each turn is the tap it
          stands for (setSection / setPlanTab), so the address, history and focus agree. */}
      <SwipePager levels={[
        lane.members.length >= 2 && { keys: lane.members, current: sec, go: (k) => inLane(k as OpSection), depth: 0 },
        planOver && { keys: ["calendar", planTab], current: planTab, go: (k) => setPlanTab(k as PlanTab), depth: 1 },
      ]}>
      {/* Shared-axis transition: keying on `sec` remounts the body on each section change so it
          fades+slides in. planTab changes keep the same key, so sub-tabs don't re-animate.
          role=region + focus-on-change: keyboard/SR users land in the new section, not adrift. */}
      {/* The lane's row of sections is a tab list, and the section its panel (R12 — the 10/10 audit, F7); a lane of one
          section has no row, and the section is a named region. */}
      <div className="op-trans" key={sec} ref={opBodyRef} tabIndex={-1} {...(lane.members.length >= 2 ? tabPanel("lane-panel", sec) : { role: "region", "aria-label": `${SEC_LABEL[sec]} section` })}>
      {/* ONE SECTION FAILS ALONE (R33 — the audit's FE11-07): a panel that threw took the whole console — and the open
          Pass with it — to the page's crash screen mid-service. The section steps aside with a Try again; the nav, the
          Pass and every other section stay. */}
      <Fence name={`section:${sec}`} fallback={(retry) => (
        <EmptyState role="alert" title={`${SEC_LABEL[sec]} didn't load`} sub="The rest of the console still works — try this section again."
          action={<button type="button" className="btn-ter" onClick={retry}>Try again</button>} />
      )}>
      {sec === "day" && (
        <>
          {/* P3 (2026-08-03): a leader's day opens with the headline — today's op + top 3 due —
              before the plates. MyDay renders it now (2026-10-04), under the greeting, so the
              greeting opens the screen and today's op has one card for everybody. */}
          <MyDay userId={user?.id ?? null} canGoLive={isAdmin} canBrew={canManage || role === "operator"} />
        </>
      )}
      {sec === "command" && canManage && (
        <>
          {/* GT3 COMMAND (2026-08-03): the Executive OS lands. The portfolio registry LEADS —
              ten workstreams, Monday-audited — then the war room, then goals, then the twelve
              KPIs. One screen = the state of the company; Plan = the cadence that changes it. */}
          {/* THE REST FOLDS (2026-10-12, the Command audit, approved): under today's event, the portfolio and the team's
              week, the initiatives, the briefing, the goals and the twelve are a row each that opens as its own screen
              (components/CommandFold) — 2,979 points of Command on an iPhone 17 were three and a half screens. */}
          <CommandViews back={SEC_LABEL.command}>
          {/* THE LIVE EVENT, HERE (2026-10-11, the KDS audit): its sales, pace and plan — or today's event, not live
              yet, with its "Make it live" — the width of the screen, first. It led Live Ops, which is the pass and
              the runs now; the people who read it are the people who read this screen. */}
          {/* THE VISION (R52): "What are our plans? What's next?" — the roadmap, the store in 3D, and Present, one tap away. */}
          <Link href="/vision" className="btn-sec w-full mb-3">◆ The vision — roadmap, the store, Present ›</Link>
          <EventHUD />
          {/* ON THE DESK (2026-10-09, redesign 5): the portfolio on the left; the team's week and the rows on the right
              (2026-10-12: the war room is a line and a row now, and sits with the rest of the rows). */}
          <Columns>
          <Column>
          <OsRegistry />
          </Column>
          <Column>
          <CommandBoard />
          {/* THE WEEK, LED FROM HERE (2026-10-09): the Chief of Staff briefing came from My Day's "Lead the
              week" fold — on demand, owner-run, and about the period, so it sits with the goals it ranks.
              ONLY FOR WHO CAN RUN IT (2026-10-12): Command is open to admins and event managers, and the full-width
              "Brief & lead my week" answered every one of them "owner-only". /api/agents/chief admits ownerFromRequest
              alone — is_owner() (0023): profiles.role = 'owner', nothing else — so the card shows on exactly that,
              the profile's stored role. Not isOwner above: roleOf reads a legacy is_admin as owner, and is_owner()
              does not. */}
          {profile?.role === "owner" && <ChiefOfStaff />}
          {/* Goals moved home 2026-07-29 (was its own section): "are we on track?" and "where are
              we steering?" are the same leadership conversation — one screen answers both now.
              Goals keeps its id="goals" anchor, so strategy alerts land right on it.
              PlanningBoard cut 2026-07-30 (redundancy audit): it re-listed every goal card below
              it — same title, progress, owner — as a non-tappable horizon grid, and the horizon
              already sits on each card as its tier chip. One list, one home.
              ONE "GOALS" (2026-10-09): Goals draws its own head, with the count — this one stood above it, so the
              screen said GOALS twice and a screen reader heard two headings of the same name. Since 2026-10-12 that
              head is its row (the count beside it), and its screen's title once it is opened. */}
          <Goals />
          <KpiBoard />
          </Column>
          </Columns>
          </CommandViews>
        </>
      )}

      {sec === "now" && (
        <>
          {/* LIVE OPS IS THE PASS AND WHAT IS DUE NEXT (2026-10-11, the KDS audit, approved). Ryan: "This what live
              ops page suppose to be … KDS x Dispatcher deliveries, only right?" It was ten things, and one of them —
              the button into the Pass — was about an order in front of you. Now it is two: the Pass (with the truck
              that is serving it) and Due next, the pickups, porches and office route in the order they are due.
              What left, and where it lives: the live event's numbers and its "Make it live" → Command (and My Day,
              which already offered the switch); the next event → Readiness and Plan; your tasks → My Day; today's
              critical alerts → the header's bell, and in the Pass its own bell and the strip that names a critical one. The alerts-off line
              stays: it says whether this phone can ring for an order, and only when it can't (since 2026-10-12, as words on
              the Pass's row — below). The boards themselves (pass, pickup checklist, 86) render in ONE
              place: Service mode. */}
          {/* AT A GLANCE (2026-10-12, the Live Ops round — the owner approved its six items). Measured on an iPhone 17 on a
              quiet day: about 425 points of status cards before Due next — the Pass's hero button, the truck's ~195-point
              card, the alerts-off line, the Devices card. Now: one line at the top only while an alert is hurting service
              (tickets past their promise, no phone on the Pass that can ring, a paid order that didn't record), then one
              row for the Pass and one for the truck, each a dot, its state in words and its one action — the alerts-off
              line and the Devices card are words on the Pass's row, their detail one tap away. What each says, and why,
              is lib/liveOps; the rows are components/crew/LiveOpsRows and LiveControl. The exception line reads the
              header bell's own list (hdrFlags), so the two cannot disagree; under the Pass, the Pass's strip says it. */}
          {!svc && <ExceptionLine flags={hdrFlags} onOpenPass={openPass} />}
          {/* ON THE DESK (2026-10-09, redesign 5): service on the left, dispatch on the right. */}
          <Columns>
          <Column>
          {!svc && <PassRow canManage={canManage} onOpenPass={openPass} />}
          {/* The truck instrument rides directly under the pulse — going live IS the first act
              of service, not a panel below the fold.
              IT STAYS MOUNTED UNDER THE PASS (2026-10-11). Opening the Pass unmounted it, and its cleanup
              stopped the GPS broadcast: the customers' dot froze the moment service began. Under the Pass
              it is still drawn, out of reach — inert takes it out of the tab order and away from a screen
              reader, and the Pass covers it; `contents` leaves Live Ops' layout as it was. */}
          {canManage && <div className="contents" inert={svc ? true : undefined}><Fence name="live-control"><LiveControl compact /></Fence></div>}
          </Column>
          <Column>
          {!svc && <DueNext canPlan={canManage} onOpenPass={openPass} />}
          </Column>
          </Columns>
        </>
      )}
      {/* SERVICE MODE — the Pass, full screen over Live Ops (components/pass/ThePass: its bar, the board, the rail beside
          it). Exit with the button or Esc; leaving the Now section exits too. Its own bell, because the Pass covers the
          header's, and today's critical alert strip, are the page's — handed in. */}
      {svc && sec === "now" && (
        <ThePass canPlan={canManage} onExit={closePass}
          bell={<IconButton icon="bell" label={hdrToday.length ? `Inbox — ${hdrToday.length} today` : "Inbox"} badge={hdrToday.length} crit={hdrTodayCrit > 0} onClick={() => setInboxOpen(true)} />}
          strip={<AlertsInbox userId={user?.id ?? null} compact />} />
      )}

      {sec === "ask" && <OperatorAssistant />}

      {sec === "prep" && canPrep && (
        <>
          {/* Money template: glance-first KPIs → crew-group dividers → the modules. Drilled into one event or stop, its
              own tiles go with it (Ryan, 2026-07-30: "when a event or truck stop is clicked into the above dashboard
              should [be] dynamic") — under its name, on its own screen since 2026-10-11 (PrepDetail) — and the global
              all-prep board bows out while a single target has the floor. */}
          {!prepSel && <PrepKpis />}
          {/* THE CARDS FIRST (2026-10-10, the crew round). Readiness is opened to ask "are we ready for the next one?",
              and each stop's card answers it — the cards are the glance. The board of every open task sat above them,
              so on a phone the next event was below the whole board. On the desk: the cards on the left, the board on
              the right. Drilled into one stop, the board bows out and the stop has the canvas. */}
          <Columns>
          <Column>
          {/* 2026-07-30 (Ryan's screenshot): this screen used to stack the stock-check agent +
              Inspection prep ABOVE the actual work, and an "At a glance" block (Overview)
              summarized the exact target cards rendered right below it. The glance is deleted
              (the cards ARE the glance; live status is Live Ops' job), the stock-check moved home
              to Assets beside the inventory it reads, and Inspection prep — real prep, but
              occasional-use by its own copy — parks at the bottom, collapsed, instead of first. */}
          {!prepSel && <SectionHeader label="Event prep · by stop" />}
          <EventPrep sel={prepSel} setSel={setPrepSel} />
          </Column>
          <Column>
          {!prepSel && <SectionHeader label="All open prep · one board" />}
          {!prepSel && <Panel id="prep-board" title="Work every open task — critical first" defaultOpen><PrepBoard /></Panel>}
          {!prepSel && canManage && <InspectionPrep />}
          </Column>
          </Columns>
        </>
      )}

      {sec === "plan" && canManage && (
        <>
          {/* Route joined Plan 2026-07-29 (was its own "stops" section): an event and a stop are the same planned
              thing, and the calendar rolls both up. Leads joined 2026-07-30 (Ryan: "Pipeline plan yes"): a lead
              becomes an event becomes a stop without leaving the section; operators do not see leads, by Ryan's
              call (sales is leadership work). Since 2026-10-10 none of them is a tab: the calendar is the page,
              and this row holds the two doors off it (PLAN_LABEL's header says why). */}
          {planTab === "calendar" ? (
            <div className="mb-3 flex items-center justify-end gap-2">
              {/* Requests waiting are money waiting — always loud. The words are the accessible name: a bare
                  number tells a screen reader nothing. */}
              <button type="button" className="k-chip sm" onClick={() => setPlanTab("leads")}
                aria-label={planCounts.bookings > 0 ? `Leads — ${planCounts.bookings} new booking request${planCounts.bookings === 1 ? "" : "s"}` : "Leads"}>
                Leads{planCounts.bookings > 0 && <span className="k-count sm crit" aria-hidden>{planCounts.bookings}</span>}
              </button>
              <button type="button" className="k-chip sm" aria-haspopup="dialog" onClick={() => setListsOpen(true)}>
                Lists <Icon name="more" />
              </button>
            </div>
          ) : (
            <PlanCrumb tab={planTab} onBack={() => setPlanTab("calendar")} />
          )}
          {listsOpen && (
            <RowMenu title="Lists" onClose={() => setListsOpen(false)}
              items={PLAN_LISTS.map(({ tab, icon }) => ({ key: tab, label: PLAN_LABEL[tab], icon, run: () => setPlanTab(tab) }))} />
          )}
          {/* ONE "needs sorting" list for the whole schedule (0324), above the calendar and above the Events and
              Truck stops lists, because it covers both: each used to open with its own copy of this panel, so
              flipping between them showed the same construct twice with two headlines and two badges — 9 rows
              describing 6 real problems. The placement rule from 0314/0315 holds: above the list, because a
              list sorted by date will never surface "still marked confirmed five weeks after it happened" — it
              files that in the past, where nobody scrolls. */}
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
              {/* On the desk the calendar keeps the canvas's width; the rituals and the threads sit side by side under it. */}
              <Columns>
              <Column><OperatingRhythm isAdmin={isAdmin} onOpenNotes={() => setSection("notes")} /></Column>
              <Column><Panel id="plan-discussions" title="Discussions · every open thread, one place"><Discussions onOpenNotes={() => setSection("notes")} /></Panel></Column>
              </Columns>
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
              {/* On the desk: what came in on the left, the accounts being worked on the right. */}
              <Columns>
              <Column><Bookings /></Column>
              <Column>
              <SectionHeader id="pipeline-board" label="Pipeline" annotation="accounts being worked — stage by stage to Won" />
              <PipelinePanel isAdmin={isAdmin} />
              <SectionHeader label="Tools" />
              <ChiefOfSales isAdmin={isAdmin} />
              </Column>
              </Columns>
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
          {/* MONEY ANSWERS THREE QUESTIONS, IN ORDER (2026-10-15, release 3 of the Plan & Money audit; Ryan, shown the
              mockups on the iPhone 17 and the SE: "Yes, build it", and of the moves, "Yes, all seven"). It was the three
              numbers and then fifteen panels under seven headings, each added where it was built, and nothing decided
              what mattered now: the shop's queue of paid orders waiting on us — where every stalled-order alert points —
              was the last panel, 2,236 points down on an iPhone 17. Now the first screen says how the business is doing
              (Performance: the numbers, and what customers owe us) and what needs a person (Needs attention: the waiting
              order, a chargeback's date, a late invoice, a refund Square and the app disagree about, a budget over its
              line — components/MoneyAttention); the next says what to do (Do next: log a purchase, get paid); the rest is
              one row each — the reports, then the records. Seven panels that were never about the books went where their
              work is: the shop's orders and the reserve drops to the Catalog, members, plan interest and the funnels to
              Customers, operator deals and offer letters to Team. Each kept its id, so every old link lands on its new
              home (lib/panelHome). */}
          <HomeNumbers money drops here="money" />
          {/* On the desk, the numbers stand over both columns, as they did: what needs a person and what to do next on the
              left, the reports and the records on the right. A phone reads them in that order. */}
          <Columns>
          <Column>
          <MoneyAttention />
          <SectionHeader label="Do next" />
          <SetList>
            {/* The capture sheet lives in the quick-actions dock (components/QuickDock → LogPurchase), receipt first;
                this row is one more way in, as Spend vs budget's button is. */}
            <section className="mpanel">
              <button type="button" className="mpanel-h" onClick={() => window.dispatchEvent(new Event("gt3-log-purchase"))}>
                <span className="mpanel-tt"><span className="mpanel-t">Log a purchase</span><span className="mpanel-s">Receipt first, from any screen</span></span>
                <span className="mpanel-chev" aria-hidden="true">›</span>
              </button>
            </section>
            {/* GET PAID KEEPS ITS ID (2026-10-06, the settings round; listed 2026-10-15). A voided paid order raises a
                refund alert that links /crew?s=money&a=pay, and a refund is still Money's. It lists now what Square has
                told us and what is owed (components/GetPaid); the refund itself is made in Square, the payment switches
                are Settings' — one line each, inside it. */}
            <Panel id="pay" title="Get paid" sub="What’s owed to you, chargebacks and refunds"><GetPaid /></Panel>
          </SetList>
          </Column>
          <Column>
          <SectionHeader label="Reports" />
          <SetList>
            <Panel id="sales" title="Sales" sub="By channel, event and day"><Reports /></Panel>
            <Panel id="pnl" title="Events" sub="What each event made, after its costs"><EventPnlReport /></Panel>
            <Panel id="snapshot" title="Subscriptions" sub="Recurring revenue and members"><SnapshotReport /></Panel>
            {/* What the business sells is the Catalog (2026-10-06); what each costs and earns stays here. */}
            <Panel id="econ" title="Margins by product" sub="What each costs to make, and earns"><ProductCatalog /></Panel>
            <Panel id="cogs" title="COGS calculator" sub="A drink’s cost, from its recipe"><CogsCalculator /></Panel>
            <Panel id="spend" title="Spend vs budget" sub="This month’s spend, and receipts owed"><SpendBudget /></Panel>
          </SetList>
          <SectionHeader label="Records" />
          <SetList>
            <Panel id="orders" title="Orders · by the day bought" sub="Every channel — cups, pickups, delivery, office, shop"><OrdersHistory /></Panel>
          </SetList>
          {/* The shop's queue is the Catalog's now, beside the merch it fulfils; Needs attention above says when an
              order waits on us. */}
          <GoLine to="catalog" anchor="shoporders">The Shop · orders</GoLine>
          </Column>
          </Columns>
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
          {/* On the desk: the stock-check agent beside the assets it reads. */}
          <Columns>
          <Column>{canManage && <ReadinessAgent />}</Column>
          <Column>
          <SectionHeader label="Assets & stock" />
          <GarageSection />
          </Column>
          </Columns>
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
          {/* On the desk: what we sell on the left, what members get on the right. */}
          <Columns>
          <Column>
          <SectionHeader label="What we sell" />
          <Panel id="menu" title="Menu & products" sub="Every drink and product, its price, and whether it’s on" defaultOpen><MenuManager /></Panel>
          <Panel id="merch" title="The Shop · merch" sub="Shirts and gear in the online shop"><MerchManager /></Panel>
          {/* FROM MONEY (2026-10-15, release 3 of the Plan & Money audit): the shop's paid orders, fulfilled beside the
              merch they are, and the limited drops, sold beside the menu. Money's Needs attention says when an order
              waits on us, and links here. Both kept their ids (lib/panelHome). */}
          <Panel id="shoporders" title="The Shop · orders" sub="Paid merch orders — send, ship, refund"><ShopOrders /></Panel>
          <Panel id="resv" title="Reserve drops" sub="The limited drops to sell, and who is owed one"><ReservesAdmin /></Panel>
          <Panel id="students" title="GT3 Nutrition · students" sub="Who has the course, how far they are — give it, export it"><CourseStudents /></Panel>
          <Panel id="lessons" title="GT3 Nutrition · lessons" sub="Write, edit and publish the Return to Primal lessons"><LessonsManager /></Panel>
          </Column>
          <Column>
          <SectionHeader label="Memberships & offers" />
          <Panel id="plans" title="Membership plans" sub="What members pay, and what they get"><PlanEditor /></Panel>
          <Panel id="cust-codes" title="Discount codes" sub="Mint a code, see who used it, turn one off"><CodesPanel /></Panel>
          <Panel id="cust-perks" title="Founding perks" sub="What a founding member gets, and what a VIP gets"><PerksPanel /></Panel>
          </Column>
          </Columns>
        </>
      )}

      {sec === "customers" && isAdmin && (
        <>
          {/* Money's 10/10 template: glance-first KPIs → crew-group dividers → uniform Panels. */}
          <CustomerKpis />
          <CustomersBody />
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
          {/* ON THE DESK (2026-10-09, redesign 5): the people and who is on what on the left; the structure, the
              numbers and training on the right. */}
          <Columns>
          <Column>
          {isOwner && <div id="team-members" className="scroll-mt-4"><Members /></div>}
          {/* Who owns each lane is Settings › Business › Team & permissions (2026-10-06); an admin's line goes there. */}
          {!isOwner && <GoLine to="settings" anchor="set-lanes">Lane owners</GoLine>}
          <SectionHeader label="Who's on what" />
          <WorkloadBoard />
          </Column>
          <Column>
          {/* Was "Roster" (2026-07-16, ground-up redesign): OrgChart rendered two labeled concerns
              (the org chart's reporting tiers, then work streams' ownership grid). Since 2026-10-06 the
              lane owners are Settings › Business › Team & permissions (OrgChart part="lanes"); the
              picture of the people stays here. */}
          {/* THE SAME PEOPLE, ONCE AT REST (2026-10-10, the crew round). Team listed everyone four times — the roster,
              who's on what, the org chart, the usage report — each open. The roster and who's on what stay open: they
              are the work. The org chart and the usage report fold to a row each, a tap away, as Money's panels do. */}
          <TeamKpis />
          <Panel id="team-org" title="Org chart" sub="Who reports where — tap a person to open them"><OrgChart part="people" bare /></Panel>
          {/* Utilization (0267, Ryan: "so you don't have to ask me this no more") — who's actually
              IN the system: active days, sign-ins, actions, last-seen per person, plus the
              anonymous guest pulse. Admin-only data by RLS. */}
          <Panel id="team-usage" title="Who's in the system" sub="The last 30 days, person by person, and the guest pulse"><UtilizationPanel bare /></Panel>
          {/* FROM MONEY (2026-10-15, release 3 of the Plan & Money audit): an operator's deal and an offer letter are about
              a person joining or running a truck — the links from a crew member's page open them here. The ids stayed
              (lib/panelHome), and an offer's deadline on My Day comes here too (lib/obligations). */}
          <SectionHeader label="Deals & offers" />
          <Panel id="operators" title="Operator agreements" sub="Deals, levels and royalties"><OperatorDeal /></Panel>
          <Panel id="offers" title="Offer letters" sub="Hire someone — the offer, its approval and their answer"><OfferLetters /></Panel>
          <SectionHeader label="Growth & training" />
          {/* Was a flat link with no state, on a page where everything else shows live numbers — so it
              was the one block the eye skipped, and the Academy had zero progress rows for anybody.
              The card now carries the reader's own role path, which lib/academy could already derive. */}
          <AcademyCard />
          {/* Train the AI is Settings › Business › AI now (2026-10-06, the settings round). */}
          {isOwner && <GoLine to="settings" anchor="set-train">Train the AI</GoLine>}
          </Column>
          </Columns>
        </>
      )}
      </Fence>
      </div>
      </SwipePager>
    </section>
    </CrumbProvider>
  );
}
