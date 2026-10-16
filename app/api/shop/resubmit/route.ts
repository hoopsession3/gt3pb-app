import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { staffFromRequest, tenantFromRequest } from "@/lib/apiAuth";
import { submitOrderToApliiq } from "@/lib/apliiq";
import { skuFor } from "@/lib/apliiqOrder";
import { raiseAlert } from "@/lib/serverAlerts";
import { route } from "@/lib/apiRoute";

export const runtime = "nodejs";
// Apliiq is given 25 seconds to answer (lib/apliiq APLIIQ_SUBMIT_TIMEOUT_MS): the function outlives the wait.
export const maxDuration = 60;

// SEND A PAID ORDER TO THE PRINTER — the button that did not exist (0335).
//
// submitOrderToApliiq had exactly ONE caller: app/api/shop/checkout, at the moment of payment. If
// that call failed — Apliiq unreachable, no payment method on their account, a 2xx we could not
// read — the order landed in the crew queue and the only way out was to open Apliiq's dashboard and
// type it in by hand. The status text has been saying "Submit it by hand" since 0313 and it meant
// that literally.
//
// Doing it by hand also breaks the ending. /api/apliiq/fulfillment finds our order by the
// external_id we sent them (API orders only) or by apliiq_order_id (null until one comes back), so
// a hand-typed order matches NEITHER: when Apliiq ships it the callback 404s, the status never
// reaches 'shipped', and the customer never gets their tracking number. Going through this route
// keeps that thread attached.
async function post(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Not configured." }, { status: 503 });
  // Crew only, and the FIRST thing: this spends money at a vendor.
  if (!(await staffFromRequest(req))) return NextResponse.json({ ok: false, error: "Crew only." }, { status: 403 });

  // R-002. supabaseAdmin bypasses RLS, so tenancy is enforced HERE or nowhere. An orderId arriving
  // in a request body is a caller-supplied id: staff of one tenant could otherwise hand this
  // another tenant's order and have it placed at the printer on this deployment's account. Fails
  // closed — tenantFromRequest returns null rather than throwing, and null must never mean "all".
  //
  // The first cut of this route shipped without it and failed the R-002 ratchet with three unscoped
  // accesses. It failed for the right reason.
  const tenant = await tenantFromRequest(req);
  if (!tenant) return NextResponse.json({ ok: false, error: "Crew only." }, { status: 403 });

  let orderId = "";
  try { orderId = String(((await req.json()) as { orderId?: string })?.orderId ?? "").trim(); } catch { /* handled next */ }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return NextResponse.json({ ok: false, error: "Which order?" }, { status: 400 });

  // THE CLAIM, BEFORE ANYTHING ELSE. Submitting is not idempotent at Apliiq — it places an order
  // against a card — so "has this already gone?" cannot be a read here followed by a write later:
  // two clicks would both read "no". 0335 makes it one atomic UPDATE that only one caller wins.
  const { data: claim, error: claimErr } = await supabaseAdmin
    .rpc("claim_shop_order_for_submit", { p_order: orderId, p_tenant: tenant });
  // A FAILED READ IS NOT A CLAIM. If we cannot tell whether somebody else is already sending it,
  // we do NOT send — the failure mode here is a second cap and a second charge.
  if (claimErr) return NextResponse.json({ ok: false, error: "Could not check whether this order is already being sent. Nothing was sent." }, { status: 503 });
  if (claim !== "ok") return NextResponse.json({ ok: false, error: String(claim) }, { status: 409 });

  // Released when nothing went to the printer, so a press after the reason is fixed is not refused for two minutes.
  // scoped-by: the order this request just claimed, in the caller's tenant, while Apliiq has no id for it.
  const release = () => supabaseAdmin!.from("shop_orders")
    .update({ apliiq_submit_started_at: null, apliiq_submit_unknown_at: null })
    .eq("id", orderId).eq("tenant_id", tenant).is("apliiq_order_id", null);

  const { data: order } = await supabaseAdmin.from("shop_orders")
    .select("id, ship_name, ship_address, email").eq("id", orderId).eq("tenant_id", tenant).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "That order no longer exists." }, { status: 404 });

  // scoped-by: orderId is the order this request just claimed (claim_shop_order_for_submit, the caller's tenant) and read in it
  const { data: items } = await supabaseAdmin.from("shop_order_items")
    .select("product_id, title, variant, qty, unit_cents").eq("order_id", orderId);
  if (!items || items.length === 0) {
    await release();
    return NextResponse.json({ ok: false, error: "That order has no line items to send." }, { status: 409 });
  }

  // THE SKU IS NOT ON THE ORDER. checkout resolves apliiq_sku from the product's variant list and
  // the shopper's choice and then throws it away ("the fulfilment call downstream sees only the
  // line and cannot work it out later" — its own comment). So it is re-resolved here through the
  // SAME skuFor, never a second implementation.
  //
  // If a product's variants have changed since the sale, skuFor returns null and buildOrderPayload
  // refuses the WHOLE order naming the item — which is right. Half an order is worse than none.
  const ids = [...new Set(items.map((i) => String((i as { product_id: string }).product_id)))];
  const { data: prods } = await supabaseAdmin.from("shop_products")
    .select("id, variants").in("id", ids).eq("tenant_id", tenant);
  const variantsOf = new Map((prods ?? []).map((p) => [(p as { id: string }).id, (p as { variants?: unknown }).variants]));

  // WRITTEN BEFORE IT LEAVES (R9, 0417). From here the order may reach Apliiq, so it reads "no clear answer" until one
  // comes: a function stopped mid-send — a timeout of the platform's, a crash — leaves the order waiting for the crew to
  // look in Apliiq, never offering Send again two minutes later. A clear answer below takes it off again. If it cannot
  // be written, nothing is sent.
  // scoped-by: the order this request just claimed, in the caller's tenant, while Apliiq has no id for it.
  const marked = await supabaseAdmin.from("shop_orders")
    .update({ apliiq_submit_unknown_at: new Date().toISOString() })
    .eq("id", orderId).eq("tenant_id", tenant).is("apliiq_order_id", null).select("id");
  if (marked.error || !marked.data?.length) {
    await release();
    return NextResponse.json({ ok: false, error: "Couldn't get the order ready to send. Nothing was sent — try again." }, { status: 503 });
  }

  const a = (order as { ship_address?: Record<string, string> | null }).ship_address ?? {};
  const submit = await submitOrderToApliiq({
    id: orderId,
    ship: {
      name: String((order as { ship_name?: string }).ship_name ?? ""),
      street: String(a.street ?? ""), city: String(a.city ?? ""),
      state: String(a.state ?? ""), zip: String(a.zip ?? ""),
    },
    items: items.map((i) => {
      const it = i as { product_id: string; title: string; variant: unknown; qty: number; unit_cents: number };
      return { id: it.product_id, title: it.title, qty: it.qty, priceCents: it.unit_cents,
               sku: skuFor(variantsOf.get(it.product_id) as never, it.variant ?? null) };
    }),
  });

  const who = (order as { ship_name?: string }).ship_name ?? "An order";
  if (!submit.ok && submit.unclear) {
    // NO CLEAR ANSWER: Apliiq may have it. The order stays as written above, and the send is over, so the order's
    // panel asks the crew to look in Apliiq (0417 shop_apliiq_checked) — the claim refuses another send until they do.
    // scoped-by: the order this request claimed, in the caller's tenant, while Apliiq has no id for it.
    const settle = () => supabaseAdmin!.from("shop_orders")
      .update({ apliiq_submit_unknown_at: new Date().toISOString(), apliiq_submit_started_at: null })
      .eq("id", orderId).eq("tenant_id", tenant).is("apliiq_order_id", null);
    if ((await settle()).error) await settle();
    await raiseAlert({
      severity: "important", category: "order", kind: "printer_unclear", subjectId: orderId,
      title: "Sent to the printer — no clear answer",
      body: `${who}'s order went to Apliiq and no clear answer came back (${submit.error}). Apliiq may have it. `
          + `Look in Apliiq's pending orders, then say on the order whether it's there — sending it again before that could print and charge a second one.`,
      link: "/crew?s=catalog&a=shoporders",
    });
    return NextResponse.json({ ok: false, unclear: true, error: "Apliiq didn't say whether it took this order. Look in Apliiq before anything else, then say on the order whether it's there." }, { status: 502 });
  }
  if (!submit.ok) {
    // REFUSED, or it never reached them: nothing is at the printer. The claim is let go, so a press after the reason is
    // fixed goes through — not refused for two minutes as before, nor offered while the first is still out.
    if ((await release()).error) await release();
    await raiseAlert({
      severity: "important", category: "order", kind: "fulfillment", subjectId: orderId,
      title: "Sending an order to the printer failed",
      body: `${who}'s cap could not be sent: ${submit.error}. `
          + `Nothing reached the printer. The money is still collected and the order is still in the queue.`,
      link: "/crew?s=catalog&a=shoporders",
    });
    return NextResponse.json({ ok: false, error: submit.error }, { status: 502 });
  }

  // submit.ok now GUARANTEES a real id (0334 narrowed the type), and 0334's CHECK refuses this
  // write without one — so the status and the evidence for it land together or not at all.
  // scoped-by: the order this request claimed, in the caller's tenant.
  const atPrinter = () => supabaseAdmin!.from("shop_orders")
    .update({ apliiq_order_id: submit.apliiqOrderId, status: "submitted", apliiq_submit_unknown_at: null, updated_at: new Date().toISOString() })
    .eq("id", orderId).eq("tenant_id", tenant);
  let { error: writeErr } = await atPrinter();
  if (writeErr) ({ error: writeErr } = await atPrinter());

  if (writeErr) {
    // THE ORDER IS AT THE PRINTER AND THIS APP DOES NOT KNOW. That is the one outcome here that
    // costs real money if it stays quiet: a retry would make a second cap. Critical, with their id
    // in the text, because recovering it means somebody typing that id onto the row by hand. Since
    // R9 the order still reads "no clear answer" (written before it left), so the button cannot send
    // it again meanwhile — and the order's own panel is where their id goes.
    await raiseAlert({
      severity: "critical", category: "money", kind: "ops_incident", subjectId: orderId,
      title: "Order went to the printer but did not save",
      body: `Apliiq accepted this order as ${submit.apliiqOrderId} and writing that back here failed. `
          + `DO NOT send it again — it is already being made. On the order, say it's at Apliiq as ${submit.apliiqOrderId}.`,
      link: "/crew?s=catalog&a=shoporders",
    });
    return NextResponse.json({ ok: false, unclear: true, error: `Apliiq took it as ${submit.apliiqOrderId}, but saving that here failed. Do not send it again — say on the order it's at Apliiq as ${submit.apliiqOrderId}.` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, apliiqOrderId: submit.apliiqOrderId });
}

export const POST = route("shop/resubmit", post);
