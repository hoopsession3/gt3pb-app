"use client";

import { Fragment } from "react";
import { parseProse, hasProseMarkup, type Block, type Span } from "@/lib/prose";

// THE READER for model prose. lib/prose.ts decides what the text MEANS; this decides what it
// looks like, and the split is the point — the meaning is testable without a DOM, and the looks
// are changeable without touching the parser.
//
// React elements, never HTML. There is no dangerouslySetInnerHTML in this file and there must
// never be one: the input is whatever the model said, and the day someone adds "just a bit of
// HTML for links" is the day a chat panel becomes an injection surface.

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => (
        <Fragment key={i}>
          {s.kind === "bold" ? <strong>{s.text}</strong>
            : s.kind === "em" ? <em>{s.text}</em>
            : s.kind === "code" ? <code>{s.text}</code>
            // The parser has already refused anything that is not an internal route, so this href
            // cannot be off-site. No target="_blank", no rel juggling — it is our own page.
            : s.kind === "link" ? <a className="pr-a" href={s.href}>{s.text}</a>
            : s.text}
        </Fragment>
      ))}
    </>
  );
}

function Piece({ b }: { b: Block }) {
  if (b.kind === "h") {
    // Everything below h3 collapses into h3 in the parser, so this is exhaustive. A chat bubble
    // is not a document — the levels exist to separate, not to build an outline.
    const Tag = (b.level === 1 ? "h3" : b.level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
    return <Tag className="pr-h"><Spans spans={b.spans} /></Tag>;
  }
  if (b.kind === "ul") {
    return <ul className="pr-ul">{b.items.map((it, i) => <li key={i}><Spans spans={it} /></li>)}</ul>;
  }
  if (b.kind === "ol") {
    return <ol className="pr-ol" start={b.start}>{b.items.map((it, i) => <li key={i}><Spans spans={it} /></li>)}</ol>;
  }
  // A paragraph keeps the model's own line breaks — a recipe written as four short lines under a
  // heading is shaped that way on purpose, and joining them into one wrapped block loses the shape
  // that makes it readable one-handed.
  return (
    <p className="pr-p">
      {b.lines.map((ln, i) => (
        <Fragment key={i}>{i > 0 && <br />}<Spans spans={ln} /></Fragment>
      ))}
    </p>
  );
}

/**
 * Render model prose.
 *
 * Text with no markers takes the plain path and renders exactly as it did before — same single
 * node, same pre-wrap. Only prose that actually carries structure pays for the structured render,
 * so a one-line answer cannot be reshaped by a parser it never needed.
 */
export default function Prose({ text, className }: { text: string; className?: string }) {
  const cls = className ? `pr ${className}` : "pr";
  if (!hasProseMarkup(text)) return <div className={`${cls} pr-plain`}>{text}</div>;
  const blocks = parseProse(text);
  if (blocks.length === 0) return <div className={`${cls} pr-plain`}>{text}</div>;
  return <div className={cls}>{blocks.map((b, i) => <Piece key={i} b={b} />)}</div>;
}
