import type { SupabaseClient } from "@supabase/supabase-js";
import { FOUNDING_MARKET } from "./markets";

// A RECEIPT, FILED — one home.
//
// The spend panel attached receipts to a logged row; the purchase sheet (components/LogPurchase)
// attaches one at the moment of capture, which is when the paper is still in someone's hand. Both go
// through this, so the bucket, the path and the size rule cannot drift between them.
//
// The receipts bucket is PRIVATE (0292): staff may read and insert, only the owner may delete. The
// path is derivable from the expense — `<market>/<expense id>.<ext>` — so two people cannot
// overwrite each other and a receipt can always be found from its row. A brand-new path is an
// insert, which the bucket allows; nothing here asks for update rights it does not have.

export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

export function receiptPath(expense: { id: string; market?: string | null }, fileName: string): string {
  const ext = (String(fileName).split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  return `${expense.market || FOUNDING_MARKET}/${expense.id}.${ext}`;
}

/** Upload the file and point the expense at it. Resolves to an error sentence, or null when filed. */
export async function attachReceipt(
  sb: SupabaseClient,
  expense: { id: string; market?: string | null },
  file: File,
): Promise<string | null> {
  if (file.size > RECEIPT_MAX_BYTES) return "That file is over 20MB — photograph it instead of scanning it.";
  const path = receiptPath(expense, file.name);
  const up = await sb.storage.from("receipts").upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (up.error && !/exists|duplicate/i.test(up.error.message)) return up.error.message;
  const { error } = await sb.from("expenses")
    .update({ receipt_path: path, receipt_uploaded_at: new Date().toISOString() }).eq("id", expense.id);
  return error ? error.message : null;
}
