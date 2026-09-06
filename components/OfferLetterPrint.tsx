"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MARKET_LABEL, toMarket } from "@/lib/markets";
import { ROLE_ACCESS, toRoleKey, money, STATUTORY_FIELDS } from "@/lib/offerLetter";

// THE LETTER, AS A LETTER (0286).
//
// The offer record is a row. What a candidate should receive is a document, and the difference is
// not cosmetic: S.C. Code 41-10-30 wants four specific facts communicated IN WRITING at the time of
// hiring, and 41-1-110 wants the at-will disclaimer in underlined capital letters ON THE FIRST PAGE.
// A row in a table satisfies neither. This renders both, from one read of v_offer_letter, so the
// print and the record cannot drift apart.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//   · It does not invent the disclaimer. If the market has none on file, the letter prints a loud
//     block saying so where the disclaimer belongs. A letter that LOOKS finished and isn't is the
//     failure mode worth engineering against — silence there would be the dangerous option.
//   · It does not send anything. Printing is not sending; the status is unchanged by opening this.
//
// Portalled to document.body and gated on a mounted flag, for the same reason StoryViewer is: a
// portal read during render is a hydration mismatch.

export type LetterRow = {
  id: string; status: string; market: string; market_label: string | null;
  candidate_name: string; candidate_email: string; title: string; role: string;
  employment_type: string; base_cents: number | null; rate_per: string | null;
  commission_pct: number | null; starts_on: string | null; reports_to: string | null;
  package: { label: string; included: boolean; note?: string }[] | null; notes: string | null;
  normal_hours: string | null; pay_schedule: string | null; pay_method: string | null;
  deductions: string | null; offer_disclaimer: string | null; disclaimer_missing: boolean;
};

const longDate = (iso?: string | null) =>
  iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString(undefined,
    { year: "numeric", month: "long", day: "numeric" }) : null;

export default function OfferLetterPrint({ row, onClose }: { row: LetterRow; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // The print rule keys off a class on <body>, because the sheet is portalled and everything else
  // that must disappear is a sibling of it, not a descendant.
  useEffect(() => {
    document.body.classList.add("printing-offer");
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { document.body.classList.remove("printing-offer"); window.removeEventListener("keydown", esc); };
  }, [onClose]);

  if (!mounted) return null;

  const market = toMarket(row.market);
  const access = ROLE_ACCESS[toRoleKey(row.role)];
  const pkg = (row.package ?? []).filter((p) => p.included);
  const isContractor = row.employment_type === "contractor";

  const pay: string[] = [];
  if (row.base_cents) pay.push(`${money(row.base_cents)} per ${row.rate_per === "hour" ? "hour" : "year"}`);
  if (row.commission_pct) pay.push(`${row.commission_pct}% commission`);

  const statutory = STATUTORY_FIELDS.map((f) => ({
    label: f.label,
    value: (row as unknown as Record<string, string | null>)[
      { normalHours: "normal_hours", paySchedule: "pay_schedule", payMethod: "pay_method", deductions: "deductions" }[f.key] as string
    ],
  }));

  return createPortal(
    <div className="ofl-root" role="dialog" aria-modal="true" aria-label="Printable offer letter">
      <div className="ofl-bar">
        <button type="button" className="btn-ter" onClick={onClose}>Close</button>
        <p className="ofl-bar-note">
          {row.disclaimer_missing
            ? "This letter is missing its at-will disclaimer — it is not ready to send."
            : "Printing does not send anything. The offer's status is unchanged."}
        </p>
        <button type="button" className="btn-pri" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="ofl-sheet">
        <header className="ofl-head">
          <p className="ofl-mark">GT<i>3</i></p>
          <p className="ofl-sub">Performance Bar · {row.market_label ?? MARKET_LABEL[market]}</p>
        </header>

        {/* FIRST PAGE, UNDERLINED CAPITALS — S.C. Code 41-1-110 says where and how, and this is it. */}
        {row.disclaimer_missing ? (
          <p className="ofl-disclaimer missing">
            [ NO AT-WILL DISCLAIMER ON FILE FOR {(row.market_label ?? MARKET_LABEL[market]).toUpperCase()} —
            THIS LETTER IS NOT READY TO SEND. AN OWNER MUST SET IT FROM COUNSEL FIRST. ]
          </p>
        ) : (
          <p className="ofl-disclaimer">{row.offer_disclaimer}</p>
        )}

        <p className="ofl-date">{longDate(new Date().toISOString().slice(0, 10))}</p>

        <p className="ofl-to">
          {row.candidate_name}<br />
          <span className="ofl-to-mail">{row.candidate_email}</span>
        </p>

        <p>Dear {row.candidate_name.split(" ")[0] || row.candidate_name},</p>

        <p>
          We&rsquo;re glad to offer you the position of <strong>{row.title}</strong> with GT3 Performance
          Bar in {row.market_label ?? MARKET_LABEL[market]}
          {row.starts_on ? <>, beginning <strong>{longDate(row.starts_on)}</strong></> : null}
          {row.reports_to ? <>, reporting to {row.reports_to}</> : null}. This is
          {isContractor ? " an independent contractor engagement" : " an employee position"}.
        </p>

        <h2 className="ofl-h">Your pay</h2>
        <p>{pay.length ? pay.join(", plus ") + "." : "To be confirmed in writing before your start date."}</p>

        {/* The statutory four, laid out as a definition list so none of them can be quietly dropped. */}
        <h2 className="ofl-h">Hours, payment and deductions</h2>
        <dl className="ofl-terms">
          {statutory.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value?.trim() ? s.value : <em className="ofl-gap">Not stated — this letter is incomplete.</em>}</dd>
            </div>
          ))}
        </dl>

        {pkg.length > 0 && (
          <>
            <h2 className="ofl-h">What comes with the role</h2>
            <ul className="ofl-pack">
              {pkg.map((p) => <li key={p.label}>{p.label}{p.note ? ` — ${p.note}` : ""}</li>)}
            </ul>
          </>
        )}

        <h2 className="ofl-h">Access this role carries</h2>
        <p className="ofl-access">
          As {access.label.toLowerCase()}, you&rsquo;ll be able to reach {access.reaches[0].toLowerCase()}
          {access.reaches.length > 1 ? `, and ${access.reaches.length - 1} other ${access.reaches.length === 2 ? "area" : "areas"} of the business` : ""}.
          We&rsquo;ll walk you through it on your first day.
        </p>

        {row.notes?.trim() && (<><h2 className="ofl-h">Also</h2><p>{row.notes}</p></>)}

        <p className="ofl-close">
          If this looks right, sign below and return a copy. We&rsquo;re looking forward to it.
        </p>

        <div className="ofl-sigs">
          <div><span className="ofl-rule" /><p>For GT3 Performance Bar</p></div>
          <div><span className="ofl-rule" /><p>{row.candidate_name}</p></div>
          <div><span className="ofl-rule" /><p>Date</p></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
