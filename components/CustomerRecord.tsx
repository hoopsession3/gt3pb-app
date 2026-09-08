"use client";

import { useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAsyncData } from "@/lib/useAsyncData";
import AsyncSection from "./AsyncSection";
import Sheet, { CloseButton } from "./Sheet";
import { CrmDetail, type Customer } from "./CrmPanel";

// CUSTOMERRECORD — a customer, opened by id from anywhere.
//
// CrmDetail is the best-designed record view in the app: order history off the all_orders spine,
// loyalty, perks, VIP proof, and the door onto the crew. The survey found exactly one problem with
// it — NOTHING LINKS TO IT. It lives inside a Panel inside the Customers section and takes a whole
// Customer object, so the only way to reach it is to already be looking at the customer list.
//
// So this does not rebuild it. It loads the row by id and hands it over. Every place that prints a
// customer's name — the order history, the drop pickup list, the subscriber roll, the VIP queue —
// now opens the same view rather than each growing its own half of one.
export default function CustomerRecord({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const loader = useCallback(async (): Promise<Customer | null> => {
    if (!supabase) return null;
    const { data, error } = await supabase.from("customers")
      .select("id, user_id, name, phone, email, tier, vip_verified, created_at")
      .eq("id", customerId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Customer) ?? null;
  }, [customerId]);
  const state = useAsyncData<Customer | null>(loader, [customerId]);

  return (
    <Sheet open onClose={onClose} label="Customer"
      header={<div className="cp-head">
        <b>Customer</b>
        <CloseButton onClick={onClose} />
      </div>}>
      <AsyncSection state={state} isEmpty={(c) => !c}
        emptyTitle="Not found"
        emptySub="That customer record is gone, or you do not have access to it."
        loadingLabel="Loading…" errorTitle="Couldn't load this customer">
        {(c) => (
          <>
            <div className="cp-id">
              <span className="cp-av">{(c!.name ?? "?").trim().charAt(0).toUpperCase() || "?"}</span>
              <div className="cp-id-t">
                <b>{c!.name?.trim() || "Unnamed"}</b>
                <span>{c!.email || c!.phone || "no contact on file"}</span>
              </div>
            </div>
            <CrmDetail c={c!} />
          </>
        )}
      </AsyncSection>
    </Sheet>
  );
}
