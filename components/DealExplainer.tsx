"use client";

import { useMemo, useState } from "react";
import { MARKET_LABEL, toMarket } from "@/lib/markets";
import { computeSplit, project, TIER, toTier, toStage, type DealTerms } from "@/lib/operatorDeal";
import {
  plainSplit, breakevenRevenueCents, fundingLadder, fundingVerdict,
  investmentPicture, tierLadder, whatIsNext, whatYouAreSigning,
} from "@/lib/dealExplainer";

// WHAT YOU'RE SIGNING — the same agreement, from the other side of the table.
//
// The builder in OperatorDeal.tsx is the owner's tool: it answers "what does this cost me". This
// answers the questions the person being offered the deal has, and it is a separate component
// because the honesty rules are different. Three of them, held deliberately:
//
//   1. EVERY SLIDER CAN MOVE THE NUMBER DOWN. A control that only improves the deal is a sales
//      device. The verdict line says "this position pays you nothing" when that is true.
//   2. THE TRADE IS SHOWN IN MONTHS, not only in percent. The more GT3 funds, the smaller the
//      operator's share and the longer their own money takes to come back. That relationship is the
//      deal working as intended, and it is invisible in a percentage.
//   3. MOVING A SLIDER CHANGES NOTHING. This is an illustration. The only thing that alters the
//      agreement is a counter, which goes through the same RPC the operator already has, and the
//      button for it is pre-filled with exactly what they moved.
//
// Numbers assume revenue holds steady. It will not. This is for comparing two positions against
// each other, and the panel says so where it could otherwise be mistaken for a forecast.

type Row = {
  id: string; market: string; operator_name: string; status: string;
  tier: string; stage: string; supply_funding: number;
  operator_pct: number; royalty_pct: number; market_pct: number;
  supply_sourcing?: string | null; supply_price_basis?: string | null;
  equity_eligible?: boolean | null; equity_scope?: string | null;
};

const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const months = (m: number | null) =>
  m === null ? "—" : m === Infinity ? "never at this revenue" : `${m} month${m === 1 ? "" : "s"}`;

export default function DealExplainer({ row, onCounter }: { row: Row; onCounter?: (note: string) => void }) {
  const offered = Math.round(Number(row.supply_funding) || 0);
  const [funding, setFunding] = useState(offered);
  const [revK, setRevK] = useState(20);        // $ thousands per month
  const [supK, setSupK] = useState(4);         // $ thousands per month
  const [myPutIn, setMyPutIn] = useState(15);  // $ thousands, one-off
  const [gt3PutIn, setGt3PutIn] = useState(40);

  const terms: DealTerms = useMemo(
    () => ({ supplyFunding: funding, stage: toStage(row.stage), tier: toTier(row.tier) }),
    [funding, row.stage, row.tier],
  );

  const revC = revK * 100_000;   // thousands of dollars → cents
  const supC = supK * 100_000;

  const split = computeSplit(terms);
  const proj = project(terms, revC, supC);
  const shares = plainSplit(terms);
  const breakeven = breakevenRevenueCents(terms, supC);
  const ladder = fundingLadder(terms, revC, supC, 10);
  const verdict = fundingVerdict(terms, revC, supC);
  const pic = investmentPicture({
    terms, monthlyRevenueCents: revC, monthlySuppliesCents: supC,
    gt3ContributionCents: gt3PutIn * 100_000, operatorContributionCents: myPutIn * 100_000,
  });
  const rungs = tierLadder(toTier(row.tier));
  const facts = whatYouAreSigning({
    stage: toStage(row.stage),
    supplySourcing: row.supply_sourcing ?? "undecided",
    priceBasis: row.supply_price_basis ?? null,
    equityEligible: !!row.equity_eligible,
    equityScope: row.equity_scope ?? "undecided",
  });

  const moved = funding !== offered;
  const maxNet = Math.max(1, ...ladder.map((s) => Math.abs(s.netCents)));

  return (
    <div className="dx">
      <p className="dx-lede">
        This is your agreement for {MARKET_LABEL[toMarket(row.market)]}, with the numbers you can
        actually check. <strong>Nothing here changes the offer</strong> — move anything you like and
        see what it would mean. If a position suits you better, ask for it at the bottom.
      </p>

      {/* ── the three shares ── */}
      <div className="dx-shares">
        {shares.map((s) => (
          <div key={s.key} className={`dx-share ${s.key}`}>
            <p className="dx-share-n">{s.pct}%</p>
            <p className="dx-share-w">{s.who}</p>
            <p className="dx-share-m">{s.means}</p>
          </div>
        ))}
      </div>

      {/* ── the controls ── */}
      <div className="dx-dials">
        <label className="dx-dial">
          <span>Share of supplies <b>you</b> fund<em>{funding}%{moved ? ` · offered ${offered}%` : " · as offered"}</em></span>
          <input type="range" min={0} max={100} step={5} value={funding}
            onChange={(e) => setFunding(Number(e.target.value))} />
        </label>
        <label className="dx-dial">
          <span>Revenue a month<em>{money(revC)}</em></span>
          <input type="range" min={2} max={80} step={1} value={revK} onChange={(e) => setRevK(Number(e.target.value))} />
        </label>
        <label className="dx-dial">
          <span>Supplies a month<em>{money(supC)}</em></span>
          <input type="range" min={0} max={40} step={1} value={supK} onChange={(e) => setSupK(Number(e.target.value))} />
        </label>
        <label className="dx-dial">
          <span>What <b>you</b> put in up front<em>{money(myPutIn * 100_000)}</em></span>
          <input type="range" min={0} max={100} step={5} value={myPutIn} onChange={(e) => setMyPutIn(Number(e.target.value))} />
        </label>
        <label className="dx-dial">
          <span>What <b>GT3</b> puts in up front<em>{money(gt3PutIn * 100_000)}</em></span>
          <input type="range" min={0} max={200} step={5} value={gt3PutIn} onChange={(e) => setGt3PutIn(Number(e.target.value))} />
        </label>
      </div>

      {/* ── what it pays you ── */}
      <div className="dx-out">
        <div className="dx-big">
          <p className="dx-big-n">{money(proj.operatorNetCents)}</p>
          <p className="dx-big-l">yours, a month — after the supplies you fund</p>
        </div>
        <dl className="dx-facts">
          <div><dt>Your share of revenue</dt><dd>{money(proj.operatorGrossCents)}</dd></div>
          <div><dt>Supplies you pay for</dt><dd>−{money(proj.operatorSuppliesCents)}</dd></div>
          <div><dt>Back to GT3 as royalty</dt><dd>{money(proj.royaltyCents)}</dd></div>
          <div><dt>Reinvested in your city</dt><dd>{money(proj.marketCents)}</dd></div>
          <div><dt>You have to clear</dt>
            <dd>{breakeven === null ? "nothing — you fund no supplies"
                : breakeven === Infinity ? "—"
                : `${money(breakeven)} a month before you earn a dollar`}</dd></div>
        </dl>
      </div>

      <p className={`dx-verdict${/nothing|worth asking|worth raising/i.test(verdict) ? " warn" : ""}`}>{verdict}</p>

      {/* ── the whole slider, drawn ── */}
      <p className="dx-h">Every position on the slider, at these numbers</p>
      <div className="dx-ladder">
        {ladder.map((s) => (
          <div key={s.funding} className={`dx-rung${s.best ? " best" : ""}${s.funding === funding ? " here" : ""}`}>
            <span className="dx-rung-bar" style={{ height: `${Math.max(2, (Math.abs(s.netCents) / maxNet) * 100)}%` }} />
            <span className="dx-rung-f">{s.funding}%</span>
          </div>
        ))}
      </div>
      <p className="dx-note">
        Each bar is what you&rsquo;d take home a month at that funding position. The tallest is not
        always the right end of the slider — it depends on what supplies actually cost you.
      </p>

      {/* ── the trade, in months ── */}
      <p className="dx-h">When each side gets their money back</p>
      <div className="dx-pay">
        <div>
          <p className="dx-pay-w">You</p>
          <p className="dx-pay-n">{months(pic.operator.months)}</p>
          <p className="dx-pay-s">{money(pic.operator.contributionCents)} in, {money(pic.operator.monthlyCents)} a month back</p>
        </div>
        <div>
          <p className="dx-pay-w">GT3</p>
          <p className="dx-pay-n">{months(pic.gt3.months)}</p>
          <p className="dx-pay-s">{money(pic.gt3.contributionCents)} in, {money(pic.gt3.monthlyCents)} a month in royalty</p>
        </div>
      </div>
      <p className="dx-trade">{pic.tradeoff}</p>
      <p className="dx-note">
        These months assume revenue holds steady, which it won&rsquo;t. They&rsquo;re for comparing
        two positions against each other, not for planning your year.
      </p>

      {/* ── where you sit ── */}
      <p className="dx-h">Where this puts you, and what&rsquo;s above it</p>
      <ol className="dx-tiers">
        {rungs.map((r) => (
          <li key={r.tier} className={`${r.reached ? "reached" : ""}${r.current ? " current" : ""}`}>
            <span className="dx-tier-l">{r.label}</span>
            <span className="dx-tier-u">{r.uplift > 0 ? `+${r.uplift}% share` : "starting share"}</span>
            <span className="dx-tier-a">{r.advance}</span>
          </li>
        ))}
      </ol>
      <p className="dx-note">Next for you: {whatIsNext(toTier(row.tier))}</p>

      {/* ── what accepting does ── */}
      <p className="dx-h">What accepting actually does</p>
      <dl className="dx-signing">
        {facts.map((f) => (
          <div key={f.k} className={f.heavy ? "heavy" : ""}>
            <dt>{f.k}</dt><dd>{f.v}</dd>
          </div>
        ))}
      </dl>

      {moved && onCounter && (
        <div className="dx-ask">
          <p>
            You&rsquo;ve moved supply funding from <b>{offered}%</b> to <b>{funding}%</b>. At the
            numbers above that changes your share from {computeSplit({ ...terms, supplyFunding: offered }).operatorPct}%
            to {split.operatorPct}%.
          </p>
          <button type="button" className="btn-pri" onClick={() =>
            onCounter(`I'd like supply funding at ${funding}% rather than ${offered}% — that puts my share at ${split.operatorPct}%. Happy to talk it through.`)
          }>Ask for {funding}% instead</button>
        </div>
      )}
    </div>
  );
}
