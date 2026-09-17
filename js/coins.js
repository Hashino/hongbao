/**
 * Coins — stacks on a tabletop, and the transfer between them.
 *
 * There is no simulation here. The money on this table is counted, not thrown:
 * each well holds a grid of stacks, and every coin's resting place is derived
 * from which stack it is in and how far up that stack it sits. That is the
 * whole model.
 *
 * A payout is the only thing that moves. A coin lifts off the top of one of
 * the dragon's stacks, fades as it rises, and is gone; a moment later another
 * appears above your side, settling onto whichever stack still has room — or
 * opening a new one. Nothing arcs across the table, nothing collides, nothing
 * can end up anywhere it should not be.
 *
 * Sprites are position:fixed and driven off measured viewport rectangles, so
 * layout and scroll cannot pull them away from the wells they sit in.
 */

/* The table's lean, in degrees. It has to be the same angle .surface is given
 * in the stylesheet: a circle in that plane projects to width × cos(TILT), and
 * that is where the coin sprite's proportions come from. */
const TILT = 15;
const SQUASH = Math.cos((TILT * Math.PI) / 180);

const COIN_W = 36;
const COIN_H = Math.round(COIN_W * SQUASH);

// The well holds at most COLS x ROWS stacks. A bigger wager therefore makes
// the stacks taller rather than scattering coins across the whole table, which
// is both what a real table looks like and what stays countable on a phone.
const COLS = 6;
const ROWS = 2;
const STACK_MIN = 4;   // any shorter and it does not read as a stack at all
const RISE = 5.6;      // how far up the screen each coin in a stack sits, at most
const LIFT = 46;       // how far a coin rises as it leaves, or falls as it arrives
const UP_MS = 280;     // rising off a stack and fading out
const DOWN_MS = 240;   // appearing over the far side and settling onto it
const GAP = 55;        // between one coin of a payout and the next

const EASE_UP = "cubic-bezier(0.35, 0, 0.7, 0.35)";   // gathers speed as it goes
const EASE_DOWN = "cubic-bezier(0.2, 0.9, 0.35, 1)";  // arrives and stops

let box = null;                       // the two wells, measured
let stacks = { pot: [], bank: [] };   // [{ x, y, coins: [el] }]
let timers = [];
let perStack = STACK_MIN;             // set from the round's coin count
let rise = RISE;                      // and the spacing that height has to fit in

/**
 * How far up the screen each coin in a stack sits.
 *
 * RISE is what it wants to be. A shallow well — a short viewport, mostly —
 * cannot hold a full stack at that spacing and still leave the daylight the
 * row in front of it needs, and a stack that does not fit climbs out over the
 * wall to stand on the table. So the spacing is squashed until the tallest
 * stack fits: the coins bite deeper into one another, and nothing leaves the
 * well. Both wells are cut to one depth, so one figure serves both.
 */
function computeRise() {
  if (!box) return;
  const s = baseScale();
  const w = box.far;
  const depth = w.bottom - COIN_H * s * 0.5 - w.top;
  const gap = Math.min(COIN_H * s * 1.4, depth * 0.3);
  const room = Math.max(0, depth - gap * (ROWS - 1));
  rise = Math.max(1.8, Math.min(RISE * s, room / Math.max(1, perStack - 1)));
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Coins shrink with the table so a phone doesn't get boulders. */
function baseScale() {
  return Math.max(0.62, Math.min(1, window.innerWidth / 840));
}

function after(ms, fn) {
  const id = setTimeout(() => {
    timers = timers.filter((t) => t !== id);
    fn();
  }, ms);
  timers.push(id);
  return id;
}

function cancelPending() {
  for (const id of timers) clearTimeout(id);
  timers = [];
}

/* --------------------------------------------------------------- the table */

/**
 * Measure both wells off the live layout, and lay out the stack positions
 * inside them. Called on boot and on every resize.
 */
export function measure(matEl) {
  const s = baseScale();
  const padX = 8 * s + (COIN_W * s) / 2;
  const padY = 6 * s + (COIN_H * s) / 2;

  const well = (sel) => {
    const r = matEl.querySelector(sel).getBoundingClientRect();
    return {
      left: r.left + padX,
      right: Math.max(r.left + padX, r.right - padX),
      top: r.top + padY,
      bottom: Math.max(r.top + padY, r.bottom - padY),
      cx: (r.left + r.right) / 2,
      cy: (r.top + r.bottom) / 2,
    };
  };

  const m = matEl.getBoundingClientRect();
  box = {
    far: well(".well.far"),
    near: well(".well.near"),
    // the mat's own extent, used only for the perspective cue
    top: m.top,
    bottom: m.bottom,
  };

  computeRise();
  reseat("pot");
  reseat("bank");
  return box;
}

/**
 * Where the stacks stand inside a well.
 *
 * Both wells are laid out the same way: row 0 stands against the wall furthest
 * from the player and each row after it steps forward, toward him.
 *
 * That order is what makes a second row worth having. A stack grows upward
 * from its seat, so a row seated behind another is hidden by it, while a row
 * seated in front of another leaves its neighbour's top coins showing over the
 * near edge — which is how a table with money on it actually looks. Anchoring
 * at the back also means starting a full stack's height below that wall, so
 * the top coin lands on the wall rather than climbing out over it.
 *
 * Each row fills from its middle outward — the order a person stacks chips in,
 * which keeps a part-filled well looking deliberate instead of gap-toothed.
 */
function seats(side) {
  const far = side === "pot";
  const w = far ? box.far : box.near;
  const s = baseScale();
  const gapX = Math.min((w.right - w.left) / COLS, COIN_W * s * 1.9);
  const tall = (perStack - 1) * rise;
  // How close the front row may come to the near lip of its well. The dragon's
  // front row stops half a coin short of the envelopes; yours sits a touch off
  // the bottom edge, because money banked reads better lifted slightly clear
  // of it. Without either, the rows fill the well wall to wall by construction
  // and a big wager ends up pressed against whatever is on the other side.
  const clear = COIN_H * s * (far ? 0.5 : 0.42);
  const floor = w.bottom - clear;
  // whatever depth is left once the tallest stack has its room
  const spare = Math.max(0, floor - w.top - tall);
  const gapY = Math.min(spare / Math.max(1, ROWS - 1), COIN_H * s * 1.4);
  const base = w.top + tall;
  const step = gapY;

  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      out.push({
        row: r,
        x: w.cx + (c - (COLS - 1) / 2) * gapX,
        y: base + r * step,
      });
    }
  }
  return out.sort((a, b) => a.row - b.row || Math.abs(a.x - w.cx) - Math.abs(b.x - w.cx));
}

/** Move existing stacks onto freshly measured seats — the resize path. */
function reseat(side) {
  const spots = seats(side);
  stacks[side].forEach((st, i) => {
    const spot = spots[Math.min(i, spots.length - 1)];
    st.x = spot.x;
    st.y = spot.y;
    st.coins.forEach((el, k) => place(el, st, k, false));
  });
}

/* ---------------------------------------------------------------- sprites */

/**
 * All coins share one layer. It sits above the table and below the two HUD
 * bars, and being a stacking context of its own it lets stacks sort themselves
 * by depth without any coin ever painting over the interface.
 */
let layer = null;
function coinLayer() {
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "coin-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

function sprite() {
  const el = document.createElement("div");
  el.className = "coin";
  // each coin was struck at its own angle, so a stack is not an extrusion
  el.style.setProperty("--spin", `${Math.random() * 360}deg`);
  coinLayer().appendChild(el);
  return el;
}

/** The perspective cue: coins nearer the player are drawn slightly larger. */
function scaleAt(y) {
  const t = Math.min(1, Math.max(0, (y - box.top) / Math.max(1, box.bottom - box.top)));
  return baseScale() * (0.84 + 0.28 * t);
}

/**
 * Put a coin where its stack says it belongs. `k` is its index from the
 * bottom; `lifted` draws it one LIFT above that, which is where it enters from
 * and where it leaves to.
 */
function place(el, st, k, lifted) {
  const s = scaleAt(st.y);
  const x = st.x - (COIN_W * s) / 2;
  const y = st.y - (COIN_H * s) / 2 - k * rise - (lifted ? LIFT * s : 0);
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
  // near stacks in front of far ones, and within a stack the top coin in front
  el.style.zIndex = String(400 + Math.round(st.y) * 8 + k);
}

/* ------------------------------------------------------------- the stacks */

/** The stack a new coin joins: the first with room, else a new one. */
function openStack(side) {
  const list = stacks[side];
  for (const st of list) if (st.coins.length < perStack) return st;
  const spots = seats(side);
  // every seat taken and every stack full: keep the cluster level by growing
  // the shortest one rather than piling the overflow onto a single seat
  if (list.length >= spots.length) {
    return list.reduce((a, b) => (b.coins.length < a.coins.length ? b : a));
  }
  const spot = spots[list.length];
  const st = { x: spot.x, y: spot.y, coins: [] };
  list.push(st);
  return st;
}

/** The stack a coin leaves from: the tallest, so the cluster comes down level. */
function tallestStack(side) {
  let best = null;
  for (const st of stacks[side]) {
    if (!st.coins.length) continue;
    if (!best || st.coins.length > best.coins.length) best = st;
  }
  return best;
}

/**
 * Drop one coin onto `side`, arriving from above. The callback gets how many
 * coins were already under it, which is what makes a payout descend in tone.
 */
function arrive(side, delay, onLand) {
  const st = openStack(side);
  const k = st.coins.length;
  const el = sprite();
  st.coins.push(el);

  if (reduced()) {
    place(el, st, k, false);
    onLand?.(k);
    return;
  }

  el.style.transition = "none";
  el.style.opacity = "0";
  place(el, st, k, true);

  after(delay, () => {
    el.style.transition = `transform ${DOWN_MS}ms ${EASE_DOWN}, opacity ${Math.round(DOWN_MS * 0.55)}ms linear`;
    el.style.opacity = "1";
    place(el, st, k, false);
    after(DOWN_MS, () => {
      el.style.transition = "";
      onLand?.(k);
    });
  });
}

/** Lift the top coin off `side` and let it fade out. Calls back as it goes. */
function depart(side, delay, onGone) {
  const st = tallestStack(side);
  if (!st) return false;
  const el = st.coins.pop();
  if (!st.coins.length) stacks[side] = stacks[side].filter((s) => s !== st);
  const k = st.coins.length; // the height it was sitting at

  if (reduced()) {
    el.remove();
    onGone?.(k);
    return true;
  }

  after(delay, () => {
    el.style.transition = `transform ${UP_MS}ms ${EASE_UP}, opacity ${UP_MS}ms ease-in`;
    el.style.opacity = "0";
    place(el, st, k, true);
    onGone?.(k);
    after(UP_MS, () => el.remove());
  });
  return true;
}

/* -------------------------------------------------------------------- api */

/**
 * The dragon sets `n` coins down in his well, one after another, so you watch
 * the pot being built rather than finding it already there.
 */
export function pour(n, hooks = {}) {
  if (!box) return;
  // tall stacks for a big wager, not a carpet of loose coins
  perStack = Math.max(STACK_MIN, Math.ceil(n / (COLS * ROWS)));
  computeRise();
  // and setting down a hundred coins must not take four times as long as ten
  const step = Math.min(26, 620 / Math.max(1, n));
  for (let i = 0; i < n; i++) {
    arrive("pot", reduced() ? 0 : step * i, hooks.onLand);
  }
}

/**
 * Move `n` coins from the dragon's well to yours.
 *
 * Each one rises off his stack and vanishes, and its counterpart appears over
 * your side just after — the handover reads as a single coin crossing, but
 * nothing has to fly, so it can never land somewhere it does not belong.
 * Returns how many actually moved; the dragon cannot pay what he does not
 * have on the table.
 */
export function payOut(n, hooks = {}) {
  if (!box) return 0;
  const have = counts().pot;
  const take = Math.min(n, have);
  const gap = Math.min(GAP, 900 / Math.max(1, take));
  for (let i = 0; i < take; i++) {
    const delay = reduced() ? 0 : gap * i;
    depart("pot", delay, hooks.onLift);
    arrive("bank", delay + Math.round(UP_MS * 0.55), hooks.onLand);
  }
  return take;
}

/** 白包 — everything you banked rises off the table and is gone. */
export function sweepBank(hooks = {}) {
  const n = counts().bank;
  const step = Math.min(34, 700 / Math.max(1, n));
  for (let i = 0; i < n; i++) depart("bank", reduced() ? 0 : step * i, hooks.onLift);
}

export function counts() {
  const tally = (side) => stacks[side].reduce((n, st) => n + st.coins.length, 0);
  return { pot: tally("pot"), bank: tally("bank") };
}

/** Park everything instantly — reduced motion, and the resize path. */
export function settleAll() {
  cancelPending();
  for (const side of ["pot", "bank"]) {
    for (const st of stacks[side]) {
      st.coins.forEach((el, k) => {
        el.style.transition = "none";
        el.style.opacity = "1";
        place(el, st, k, false);
      });
    }
  }
}

export function clearCoins() {
  cancelPending();
  for (const side of ["pot", "bank"]) {
    for (const st of stacks[side]) for (const el of st.coins) el.remove();
    stacks[side] = [];
  }
}
