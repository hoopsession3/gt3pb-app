import { NextResponse } from "next/server";
import { staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { raiseAlertOnce } from "@/lib/serverAlerts";
import { switchOffPaylink, type LinkOff } from "@/lib/officeLink";
import { isUuid } from "@/lib/uuid";
import { isMissingColumn, writeAcrossSkew } from "@/lib/schemaSkew";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";

// CANCEL AN OFFICE ORDER, AND ITS PAYMENT LINK WITH IT (R9, 2026-10-16 — the crew audit's second critical).
//
// The office board canceled with a plain update: no word about money, and the order's Square payment link stayed live.
// A paid order canceled raised no refund flag, and report_sales dropped it — the money kept vanished from Money too. An
// unpaid one with a link was paid later anyway: the webhook marked the canceled order paid, and nothing said a refund
// was owed. Now:
//   · the link is switched off at Square first (lib/officeLink) — an order still owed can no longer be paid through it;
//     one Square would not answer for is said to the crew, and the webhook flags a payment that lands anyway;
//   · the cancel is one write, once (an order canceled already is said, not canceled again), and a paid order's refund
//     flag is the database's, raised by that write (0416, refund_flag_office); its invoice goes void (0341).
// Staff, within their own tenant — as every office route (R-002).
async function post(req: Request) {
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "Crew only." }, { status: 401 });
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "No tenant on this session." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });

  let body: { orderId?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 }); }
  const orderId = isUuid(body.orderId) ? body.orderId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  if (!orderId) return NextResponse.json({ ok: false, error: "Which order?" }, { status: 400 });

  type Row = { id: string; company: string | null; payment_status: string | null; paylink_url: string | null; paylink_id?: string | null; square_order_id: string | null; canceled_at: string | null };
  // arrives-with: 0417 — until it is pasted the link's id is no column: read without it (lib/officeLink finds the link at
  // Square by the order it carries), and the cancel writes without it.
  // scoped-by: tenant_id = the caller's own tenant; the id is the caller's to name only within it.
  const BASE = "id, company, payment_status, paylink_url, square_order_id, canceled_at";
  let read = await supabaseAdmin.from("business_orders").select(`${BASE}, paylink_id`).eq("tenant_id", tenant).eq("id", orderId).maybeSingle();
  // scoped-by: the same order, in the caller's tenant
  if (read.error && isMissingColumn(read.error)) read = await supabaseAdmin.from("business_orders").select(BASE).eq("tenant_id", tenant).eq("id", orderId).maybeSingle();
  if (read.error) return NextResponse.json({ ok: false, error: "Couldn't read the order — nothing was canceled." }, { status: 503 });
  const o = read.data as Row | null;
  if (!o) return NextResponse.json({ ok: false, error: "That order isn't on the books." }, { status: 404 });
  if (o.canceled_at) return NextResponse.json({ ok: true, already: true });

  // Any link goes first, so it cannot be paid after the order is gone — an order marked paid by hand too: its link was
  // never switched off by the app from before (R9 review), and a client could pay it twice.
  let link: LinkOff = "none";
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (o.paylink_url || o.paylink_id || o.square_order_id) {
    link = token ? await switchOffPaylink(token, o) : "unknown";
  }

  // scoped-by: tenant_id = the caller's own tenant, the id just read in it, and only while it is not canceled.
  let gone: { id: string }[] | null = null;
  const { error } = await writeAcrossSkew(async (row) => {
    const r = await supabaseAdmin!.from("business_orders").update(row).eq("tenant_id", tenant).eq("id", orderId).is("canceled_at", null).select("id");
    gone = (r.data as { id: string }[] | null) ?? null;
    return r;
  }, { canceled_at: new Date().toISOString(), status: "issue", canceled_reason: reason || "canceled by the crew",
    ...(link === "off" ? { paylink_url: null, paylink_id: null } : {}) } as Record<string, unknown>, ["paylink_id"]);
  if (error) return NextResponse.json({ ok: false, error: "Couldn't cancel it — try again." }, { status: 500 });
  if (!(gone as { id: string }[] | null)?.length) return NextResponse.json({ ok: true, already: true });

  if (link === "unknown") {
    await raiseAlertOnce({
      severity: "important", category: "money", kind: "office_link_live", subjectId: orderId,
      title: "A canceled office order's payment link may still work",
      body: `${o.company ?? "An office"}'s order is canceled, but Square didn't confirm its payment link is off. Switch it off in Square (Online checkout → Payment links) — if they pay it first, a refund flag comes here.`,
      link: "/crew?s=money&a=pay",
    });
  }
  return NextResponse.json({ ok: true, paid: o.payment_status === "paid", link });
}

export const POST = route("office/cancel", post);
