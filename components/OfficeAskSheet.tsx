"use client";

import { useRef, useState } from "react";
import Sheet, { CloseButton } from "@/components/Sheet";
import { Segmented } from "@/components/controls";
import { useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase";
import { haptic } from "@/lib/haptics";
import { nextIdem, type IdemState } from "@/lib/idempotency";
import { refusalText } from "@/lib/refusal";
import { REQUEST_KINDS, type RequestKind } from "@/lib/officeChange";

// ASK GT3 (2026-10-07, Phase 2A-2). Everything a client used to text: an extra delivery, an event,
// another location, equipment, a billing question, something that went wrong. office_request (0359)
// makes it a record with a status and an owner and tells the crew once — so it becomes GT3's work, and
// its answer comes back to the client's home, not to a text thread nobody else can see. One key per
// send (lib/idempotency): a double tap, or a retry after a dropped connection, is the same request.

const PROMPTS: Record<string, string> = {
  extra_delivery: "Which day, and how many gallons?",
  event: "The date, how many people, and where",
  new_location: "The address, and who's there to receive",
  equipment: "What you need — a dispenser, more jugs, a stand",
  billing: "The invoice or charge, and the question",
  service_issue: "What happened, and which delivery",
  other: "What do you need?",
};

export default function OfficeAskSheet({ companyId, startKind = "extra_delivery", onClose, onSent }: { companyId: string; startKind?: RequestKind; onClose: () => void; onSent: () => void }) {
  const { toast } = useApp();
  const [kind, setKind] = useState<RequestKind>(startKind);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef<IdemState | null>(null);

  const send = async () => {
    if (!supabase || busy) return;
    const text = body.trim();
    if (!text) { haptic("boundary"); toast("Say what you need first", "info"); return; }
    setBusy(true);
    key.current = nextIdem(key.current, companyId, { kind, text });
    const { error } = await supabase.rpc("office_request", {
      p_kind: kind, p_body: text, p_order: null, p_company: companyId, p_wants: null, p_key: key.current.key,
    });
    setBusy(false);
    if (error) { toast(refusalText(error) ?? "Couldn't send it — try again", "error"); return; }
    key.current = null;
    haptic("success");
    toast("Sent — GT3 has it and will reply here");
    onSent();
    onClose();
  };

  const header = (
    <div className="office-head">
      <span className="office-head-t">Ask GT3</span>
      <CloseButton className="isheet-x" onClick={onClose} />
    </div>
  );

  return (
    <Sheet open onClose={onClose} label="Ask GT3" header={header} className="office-sheet" dirty={body.trim().length > 0} dismissible={!busy}
      footer={<button type="button" className="btn-pri btn-wide mt-4.5" onClick={send} disabled={busy || !body.trim()}><span>{busy ? "Sending…" : "Send to GT3"}</span></button>}>
      <p className="office-lede">It lands with the crew as a request, and the answer comes back here — on your GT3 page, not in a text thread.</p>
      <div className="flex flex-col gap-2">
        <span className="office-k">What is it about?</span>
        <Segmented kind="choice" label="What is it about" value={kind} onChange={(k) => { haptic("selection"); setKind(k); }}
          options={REQUEST_KINDS.map((k) => ({ key: k.key, label: k.label }))} />
      </div>
      <label className="flex flex-col gap-2 mt-4">
        <span className="office-k">Tell us</span>
        <textarea className="auth-input min-h-[110px] resize-none" rows={4} maxLength={1000} value={body}
          onChange={(e) => setBody(e.target.value)} placeholder={PROMPTS[kind] ?? PROMPTS.other} />
      </label>
    </Sheet>
  );
}
