// THE PASS'S CLOCK (2026-10-11, the KDS program, wave 2).
//
// The Pass ticked once a second by setting a state at the top of the board, so every second it drew every ticket again —
// each one's buttons, its long-press menu, its money line — to move a few labels that say "45s" or "8m". On a busy pass
// that is a few hundred tickets redrawn a second, on the phone that is also ringing, buzzing and saving the board.
//
// Two clocks now, both on one shared second:
//   · second() — what an age label reads. Only the labels that show a time subscribe to it (components/pass/clock
//     useSecond), so a tick redraws the labels and nothing else.
//   · strikeClock() — what the board reads. It changes only when it is told the board will: a ticket placed ahead comes
//     due, a ticket crosses the late line (lib/passBoard nextBoardChange). Between those it never moves, so the board,
//     its lanes and its banners are not drawn again by the time passing — only by an order changing.
//
// Pure apart from the timer, so scripts/pass.test.mjs runs it with a fake one. The interval runs only while something is
// listening, and stops with the last listener.

type Fn = () => void;

const ticks = new Set<Fn>();
let timer: ReturnType<typeof setInterval> | null = null;
let sec = 0;
const read = (): number => Math.floor(Date.now() / 1000);

/** Run `fn` on every second while it is subscribed. Returns the unsubscribe. */
export function onSecond(fn: Fn): () => void {
  ticks.add(fn);
  if (!timer) {
    sec = read();
    timer = setInterval(() => { sec = read(); for (const f of [...ticks]) f(); }, 1000);
  }
  return () => {
    ticks.delete(fn);
    if (!ticks.size && timer) { clearInterval(timer); timer = null; }
  };
}

/** The second a label draws, in ms: the last tick's while the clock runs — the same answer however often it is asked
 *  inside one second — and the true one before it starts. */
export const second = (): number => (timer ? sec : read()) * 1000;

/** Is the shared second running? (For the test: it stops with its last listener.) */
export const ticking = (): boolean => timer !== null;

/** A clock that moves only when aimed: `get` is the instant it last struck, `aim` names the next instant it should, and on
 *  the first second at or after that instant it strikes once and waits to be aimed again. */
export function strikeClock(now: () => number = Date.now) {
  let at = now();
  let next = Infinity;
  return {
    get: (): number => at,
    aim: (t: number | null): void => { next = t ?? Infinity; },
    subscribe: (cb: Fn): (() => void) => onSecond(() => {
      const t = now();
      if (t < next) return;
      at = t;
      next = Infinity;
      cb();
    }),
  };
}
