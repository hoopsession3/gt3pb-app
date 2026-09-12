// THE ONE PLACE MODEL PROSE BECOMES STRUCTURE.
//
// Ask GT3 rendered the assistant's reply as raw text, so a real answer on Ryan's phone read:
//
//     For a **Rise batch using 340 g of coffee**, scale linearly from the 2 gal / 560 g spec:
//     **Water:** 340 ÷ 560 × 2 gal = **~1.21 gal**
//     - Ratio: 1:13
//
// Every asterisk visible, every bullet a hyphen. The model emits markdown because nothing ever
// told it not to, and the panel printed the characters. A recipe read mid-shift, one-handed, is
// exactly the moment that formatting is load-bearing rather than decorative.
//
// ── WHY A PARSER AND NOT A LIBRARY ─────────────────────────────────────────────────────────────
// This returns DATA, never HTML. The input is model output, which means the input is arbitrary —
// and the single most common way a chat UI grows an XSS hole is reaching for
// dangerouslySetInnerHTML the day someone wants bold text. There is no HTML anywhere in this file
// or in components/Prose.tsx, so there is no injection surface to get wrong later.
//
// The subset is deliberately small: bold, italic, inline code, bullets, numbered steps, headings,
// and internal links. That is what these assistants actually produce — an answer, some emphasised
// quantities, short steps, and the concierge's "[See the full science →](/craft)". Tables, images
// and blockquotes are NOT parsed; they pass through as literal text, which is honest rather than
// half-rendered. The agent prompts name the same subset, so the writer and the reader agree
// instead of drifting apart.
//
// It replaced a SECOND renderer: components/Concierge.tsx had its own rich() doing bold and links
// on the customer side while the crew side did nothing at all. Same job, two implementations, and
// only one of them had thought about lists. Its link rule was the better half of it and is kept
// below, verbatim in intent and now tested.
//
// ── THE RULE FOR EVERY MARKER ──────────────────────────────────────────────────────────────────
// An unmatched marker is TEXT. `**bold` with no closer stays "**bold" — it does not swallow the
// rest of the message looking for a partner, and it does not silently disappear. Losing a
// customer's words to a stray asterisk is worse than showing the asterisk.

export type Span =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/**
 * A link is real ONLY when it points inside this app.
 *
 * Inherited from the concierge's own renderer, which this file replaced, and it is the one rule
 * here that is about safety rather than looks: the model writes "[See the full science →](/craft)"
 * because the system prompt asks it to, and an internal route is always safe to turn into an <a>.
 * A link to anywhere else — a domain the model invented, or one a customer talked it into — stays
 * inert text. Off-site is not a destination this chat gets to offer.
 *
 * Protocol-relative "//evil.example" is excluded deliberately: it starts with "/" and is NOT
 * internal, which is the trap a naive startsWith("/") walks into.
 */
export const isInternalHref = (href: string): boolean => /^\/(?!\/)[^\s)]*$/.test(href);

export type Block =
  | { kind: "p"; lines: Span[][] }
  | { kind: "ul"; items: Span[][] }
  | { kind: "ol"; items: Span[][]; start: number }
  | { kind: "h"; level: 1 | 2 | 3; spans: Span[] };

// ── inline ─────────────────────────────────────────────────────────────────────────────────────
// Ordered by binding strength: code first (its content is literal — `**not bold**` inside backticks
// must stay asterisks), then bold (** before *, or "**a**" parses as an empty italic), then italic.
// Symmetric markers only — a link is not one of these, and typing this as Span["kind"] let it
// claim it could produce one. tsc caught that the moment links existed.
const INLINE: { kind: "bold" | "em" | "code"; open: string; close: string }[] = [
  { kind: "code", open: "`", close: "`" },
  { kind: "bold", open: "**", close: "**" },
  { kind: "em", open: "_", close: "_" },
  { kind: "em", open: "*", close: "*" },
];

/**
 * One line of text → spans.
 *
 * Scans left to right and never backtracks past a marker it has already rejected, so a line full
 * of loose asterisks is linear rather than quadratic — this runs on every message in a chat log.
 */
export function parseSpans(line: string): Span[] {
  const out: Span[] = [];
  let buf = "";
  let i = 0;
  const flush = () => { if (buf) { out.push({ kind: "text", text: buf }); buf = ""; } };

  while (i < line.length) {
    let matched = false;

    // Links first — "[a](/b)" has a shape of its own, and its label can contain the emphasis
    // markers below. An off-site or malformed target falls through to the literal text.
    if (line[i] === "[") {
      const close = line.indexOf("](", i);
      if (close > i) {
        const end = line.indexOf(")", close + 2);
        if (end > close) {
          const label = line.slice(i + 1, close);
          const href = line.slice(close + 2, end);
          if (label.trim() && isInternalHref(href)) {
            flush();
            out.push({ kind: "link", text: label, href });
            i = end + 1;
            continue;
          }
        }
      }
    }

    for (const m of INLINE) {
      if (!line.startsWith(m.open, i)) continue;
      const from = i + m.open.length;
      // A marker followed by a space is not an opener: "2 * 3 = 6" and a bullet-looking "* " are
      // arithmetic and punctuation, not emphasis.
      if (line[from] === " " || from >= line.length) continue;
      const end = line.indexOf(m.close, from);
      if (end < 0) continue;                       // unmatched → fall through and keep the literal
      const inner = line.slice(from, end);
      if (!inner.trim()) continue;                 // "**"/"``" with nothing in it is text
      flush();
      out.push({ kind: m.kind, text: inner });
      i = end + m.close.length;
      matched = true;
      break;
    }
    if (!matched) { buf += line[i]; i++; }
  }
  flush();
  return out;
}

// ── blocks ─────────────────────────────────────────────────────────────────────────────────────
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;

/**
 * Model prose → blocks.
 *
 * A blank line ends the current block. Consecutive plain lines stay in ONE paragraph but keep
 * their own line breaks: the model writes a recipe as several short lines under a heading, and
 * joining them into a wall of text would lose the shape that makes it readable one-handed.
 */
export function parseProse(input: string): Block[] {
  const src = String(input ?? "").replace(/\r\n?/g, "\n");
  const blocks: Block[] = [];
  let para: Span[][] = [];
  let list: Span[][] | null = null;
  let listKind: "ul" | "ol" | null = null;
  let listStart = 1;

  const endPara = () => { if (para.length) { blocks.push({ kind: "p", lines: para }); para = []; } };
  const endList = () => {
    if (list && list.length) {
      blocks.push(listKind === "ol" ? { kind: "ol", items: list, start: listStart } : { kind: "ul", items: list });
    }
    list = null; listKind = null;
  };
  const endAll = () => { endPara(); endList(); };

  for (const raw of src.split("\n")) {
    if (!raw.trim()) { endAll(); continue; }

    const h = raw.match(HEADING);
    if (h) {
      endAll();
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({ kind: "h", level, spans: parseSpans(h[2].trim()) });
      continue;
    }

    const n = raw.match(NUMBER);
    if (n) {
      endPara();
      if (listKind !== "ol") { endList(); list = []; listKind = "ol"; listStart = Number(n[1]) || 1; }
      list!.push(parseSpans(n[2]));
      continue;
    }

    const b = raw.match(BULLET);
    // "*emphasis* at the start of a line" is not a bullet — a bullet needs the space the regex
    // already demands, and the italic opener is rejected when followed by one. This check keeps
    // the two rules from disagreeing about the same character.
    if (b) {
      endPara();
      if (listKind !== "ul") { endList(); list = []; listKind = "ul"; }
      list!.push(parseSpans(b[1]));
      continue;
    }

    endList();
    para.push(parseSpans(raw.trim()));
  }
  endAll();
  return blocks;
}

/** Plain text of a parsed block tree — for aria-labels, previews and tests. */
export function proseText(blocks: Block[]): string {
  const spans = (s: Span[]) => s.map((x) => x.text).join("");
  return blocks.map((b) =>
    b.kind === "p" ? b.lines.map(spans).join("\n")
    : b.kind === "h" ? spans(b.spans)
    : b.items.map(spans).join("\n")).join("\n\n");
}

/**
 * Does this text carry formatting worth rendering? A one-line answer with no markers renders
 * identically either way, so the chat keeps its simple bubble for those and only pays for the
 * structured path when there is structure.
 */
export function hasProseMarkup(input: string): boolean {
  const s = String(input ?? "");
  return /\*\*[^*\n]+\*\*/.test(s) || /(^|\n)\s*[-*•]\s+\S/.test(s)
    || /(^|\n)\s*\d{1,2}[.)]\s+\S/.test(s) || /(^|\n)\s*#{1,6}\s+\S/.test(s)
    || /`[^`\n]+`/.test(s) || /\[[^\]\n]+\]\(\/[^)\n]*\)/.test(s);
}
