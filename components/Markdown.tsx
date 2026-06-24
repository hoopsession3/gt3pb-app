"use client";

import type { ReactNode } from "react";

// Tiny dependency-free markdown renderer — enough for AI meeting summaries and structured recaps:
// #/##/### headings, **bold**, bullet lists (- or •), "---" rules, and paragraphs. Intentionally
// minimal; we control the input (our own agents), so no need for a full CommonMark engine.

function inline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<b key={`${keyBase}-b${i++}`}>{m[1]}</b>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = (source || "").replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];
  let k = 0;
  const flushP = () => { if (para.length) { out.push(<p key={`p${k}`} className="md-p">{inline(para.join(" "), `p${k++}`)}</p>); para = []; } };
  const flushUl = () => { if (bullets.length) { const kk = k++; out.push(<ul key={`u${kk}`} className="md-ul">{bullets.map((b, j) => <li key={j}>{inline(b, `u${kk}-${j}`)}</li>)}</ul>); bullets = []; } };
  const flush = () => { flushP(); flushUl(); };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(t)) { flush(); out.push(<hr key={`h${k++}`} className="md-hr" />); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      const Tag = (lvl <= 1 ? "h3" : lvl === 2 ? "h4" : "h5") as keyof React.JSX.IntrinsicElements;
      out.push(<Tag key={`hd${k++}`} className={`md-h md-h${Math.min(lvl, 3)}`}>{inline(h[2], `hd${k}`)}</Tag>);
      continue;
    }
    const b = t.match(/^[-•*]\s+(.*)$/);
    if (b) { flushP(); bullets.push(b[1]); continue; }
    flushUl();
    para.push(t);
  }
  flush();
  return <div className={`md ${className ?? ""}`}>{out}</div>;
}
