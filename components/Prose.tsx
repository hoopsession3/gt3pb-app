"use client";

import { Fragment } from "react";
import { parseProse, hasProseMarkup, type Block, type Item, type Line, type Span } from "@/lib/prose";

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

// A stack of lines, separated by real breaks. A paragraph and a list item are the same shape —
// the model writes a recipe as four short lines under a heading, and an action item as a bold
// title with its description underneath. Both are line stacks; joining them into one wrapped run
// loses the shape that makes them readable one-handed.
function Lines({ lines }: { lines: Line[] }) {
  return <>{lines.map((ln, i) => <Fragment key={i}>{i > 0 && <br />}<Spans spans={ln} /></Fragment>)}</>;
}

function Items({ items }: { items: Item[] }) {
  return <>{items.map((it, i) => (
    <li key={i}>
      {/* The first line is the item; anything after it is the description the house summary
          format indents underneath, so it reads as secondary rather than as a second bullet. */}
      <Spans spans={it.lines[0] ?? []} />
      {it.lines.length > 1 && <span className="pr-li-det"><Lines lines={it.lines.slice(1)} /></span>}
    </li>
  ))}</>;
}

function Piece({ b }: { b: Block }) {
  if (b.kind === "h") {
    // Everything below h3 collapses into h3 in the parser, so this is exhaustive. A chat bubble
    // is not a document — the levels exist to separate, not to build an outline.
    const Tag = (b.level === 1 ? "h3" : b.level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
    return <Tag className="pr-h"><Spans spans={b.spans} /></Tag>;
  }
  if (b.kind === "hr") return <hr className="pr-hr" />;
  if (b.kind === "ul") return <ul className="pr-ul"><Items items={b.items} /></ul>;
  if (b.kind === "ol") return <ol className="pr-ol" start={b.start}><Items items={b.items} /></ol>;
  return <p className="pr-p"><Lines lines={b.lines} /></p>;
}

/**
 * Render model prose.
 *
 * Text with no markers takes the plain path and renders exactly as it did before — same single
 * node, same pre-wrap. Only prose that actually carries structure pays for the structured render,
 * so a one-line answer cannot be reshaped by a parser it never needed.
 */
export default function Prose({ text, className }: { text: string | null | undefined; className?: string }) {
  // Nullable on purpose. Every column this renders — agent_convos.answer, event_tasks.ai_proposal,
  // meeting_notes.summary — is nullable in the schema, and both parser entry points already coerce
  // (`String(input ?? "")`). A narrower prop than the implementation only pushes a `?? ""` to every
  // call site, where it is one more thing to forget.
  const src = text ?? "";
  const cls = className ? `pr ${className}` : "pr";
  if (!hasProseMarkup(src)) return <div className={`${cls} pr-plain`}>{src}</div>;
  const blocks = parseProse(src);
  if (blocks.length === 0) return <div className={`${cls} pr-plain`}>{src}</div>;
  return <div className={cls}>{blocks.map((b, i) => <Piece key={i} b={b} />)}</div>;
}
