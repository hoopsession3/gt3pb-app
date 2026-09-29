// SEND IT AND WRITE DOWN THAT YOU SENT IT — server-only, one home for both halves.
//
// ── WHY THESE TWO THINGS ARE ONE FUNCTION ──────────────────────────────────────────────────────
// The checkout sends a receipt. The order record resends it. The Apliiq webhook sends a shipped
// notice. If each of those calls notifyCustomer and then, separately, remembers to insert a row
// into customer_messages, then the log is complete exactly as long as three authors stay
// disciplined — and the defect this whole table exists to fix was caused by one author, once, not
// remembering to look at a return value.
//
// So there is no way to send a customer message through this app and not have it recorded. The
// send and the record are the same call.
//
// The insert is best-effort in ONE direction only: if the message went out and the log write
// fails, the customer still got their email and the caller still hears that it sent. Never the
// reverse — this never reports "sent" for something that did not send.

import { supabaseAdmin } from "./supabaseAdmin";
import { notifyCustomer, type SendResult } from "./notify";

export type MessageKind = "receipt" | "receipt_resend" | "shipped" | "test" | "order_ready" | "delivered";

export type Told = {
  email: SendResult;
  detail?: string;
  /** True only for "sent". Everything else — off, failed, no-address — is false. */
  ok: boolean;
};

/**
 * Send one customer message and record it against the order.
 *
 * `sentBy` is the user id when a person pressed a button, null when the app did it on its own.
 * That difference is the first thing anyone asks when a customer reports two receipts.
 */
export async function tellCustomer(opts: {
  orderId: string | null;
  email: string | null | undefined;
  subject: string;
  message: string;
  kind: MessageKind;
  sentBy?: string | null;
}): Promise<Told> {
  const sent = await notifyCustomer({ email: opts.email, subject: opts.subject, message: opts.message });
  const ok = sent.email === "sent";

  try {
    if (supabaseAdmin && opts.email) {
      // "off" and "no-address" are not recorded as sends: the log is what the customer WAS TOLD,
      // and a message the app never handed to a provider is not something the customer was told.
      // They still reach the caller in `email`, which is what decides the alert.
      if (sent.email === "sent" || sent.email === "failed") {
        // scoped-by: tenant_id is stamped by the 0134 trigger; order_id is the caller's own order.
        await supabaseAdmin.from("customer_messages").insert({
          order_id: opts.orderId,
          channel: "email",
          kind: opts.kind,
          to_address: opts.email,
          subject: opts.subject.slice(0, 200),
          body: opts.message,
          status: ok ? "sent" : "failed",
          detail: ok ? null : (sent.emailDetail ?? null),
          // Resend's own id for this message. It is what /api/resend/webhook matches a later
          // bounce or complaint against — without it, "sent" would go on meaning "Resend accepted
          // it" forever, which is the same overstatement 0329 removed from the Apliiq status.
          provider_id: sent.emailId ?? null,
          sent_by: opts.sentBy ?? null,
        });
      }
    }
  } catch { /* the customer already has their email; a log write must never undo that */ }

  return { email: sent.email, detail: sent.emailDetail, ok };
}
