/**
 * HONGBAO 拼手气 — game shell.
 *
 * Two modes, one UI:
 *   - demo   : standalone page, rounds resolved locally by js/math.js (the same
 *              math the contract runs). This is what anyone opening the URL gets.
 *   - host   : embedded in the Chain.wtf iframe; the chain is authoritative and
 *              js/bridge.js drives the same render from HostSnapshotV1.
 */

import { ENVELOPES, newRound, openNext, whiteOdds, fmt as fmtRaw, multiplier } from "./math.js";
import * as sfx from "./audio.js";
import * as coins from "./coins.js";

/** Amounts render in the host token's decimals (18 in standalone demo). */
const fmt = (v) => fmtRaw(v, state.decimals);

const UNIT = 10n ** 18n;

const el = {
  table: document.getElementById("table"),
  pot: document.getElementById("pot"),
  message: document.getElementById("message"),
  controls: document.getElementById("controls"),
  wagerRow: document.getElementById("wager-row"),
  wager: document.getElementById("wager"),
  mat: document.querySelector(".mat"),
  mode: document.getElementById("mode-chip"),
  mute: document.getElementById("mute"),
};

/** @type {{phase: string, round: any, wager: bigint, reveals: any[], busy: boolean}} */
const state = {
  phase: "idle", // idle | playing | settled | lost
  round: null,
  wager: 10n * UNIT,
  reveals: [], // [{white, grab}] in open order
  busy: false,
  lastPayout: 0n,
  coins: 0,        // coins on the table this round — one per token wagered
  shown: 0n,       // the figure on the Keep button, which counts up as coins land
  flying: false,   // true while coins are still crossing the table
  payToken: 0,     // bumped on every resolution; stale coin callbacks bail on it
  host: null,      // set by bridge.js when embedded in the Chain.wtf app
  decimals: 18,
};

/* ------------------------------------------------------------------ table */

function buildTable() {
  el.table.innerHTML = "";
  for (let i = 0; i < ENVELOPES; i++) {
    const env = document.createElement("div");
    env.className = "env";
    // Two real 3D faces: a sealed front and the inside of the envelope.
    env.innerHTML =
      '<div class="card">' +
      '  <div class="face front"><div class="seal">福</div></div>' +
      '  <div class="face back"><div class="amount"><b></b><i></i></div></div>' +
      '</div>';
    el.table.appendChild(env);
  }
}

function envs() {
  return [...el.table.children];
}

/**
 * Classes are toggled, never rewritten wholesale.
 *
 * Not for the reason it looks like: `env.className = "env"` followed by the
 * same classes being re-added does *not* restart the animations keyed off
 * them, because style changes inside one task are coalesced before they reach
 * the animation timeline — measured, same `Animation` object either way. The
 * reason is plainer: a wholesale rewrite silently drops any class this
 * function does not know about, `popping` among them, and makes every render
 * a rewrite of state it does not own.
 */
function renderTable() {
  envs().forEach((env, i) => {
    const reveal = state.reveals[i];
    const amount = env.querySelector(".amount b");
    const label = env.querySelector(".amount i");

    const opened = Boolean(reveal);
    const white = opened && reveal.white;
    const next = !opened && state.phase === "playing" && i === state.reveals.length;
    const spent = !opened && (state.phase === "settled" || state.phase === "lost");

    env.classList.toggle("opened", opened);
    env.classList.toggle("white", white);
    env.classList.toggle("next", next);
    env.classList.toggle("spent", spent);
    // the pop is owned by onOpen, and has never outlived the render after it
    env.classList.remove("popping");

    if (!opened) return;
    if (white) {
      amount.textContent = "白包";
      label.textContent = "empty";
    } else {
      amount.textContent = fmt(reveal.grab);
      label.textContent = `+${multiplier(reveal.grab, state.wager)}×`;
    }
  });
}

/* ------------------------------------------------------------------ coins */

/**
 * One coin per token wagered.
 *
 * That is the whole rule, and it is what makes the wager control mean
 * something: bet 1 and a single coin comes out, bet 100 and the dragon stacks
 * a hundred. Whatever the count, it is all the money there is — a grab does
 * not mint coins, it moves them from his side of the table to yours, which is
 * why his stacks visibly come down as you take from them.
 *
 * Capped, because past a point coins stop being countable and become texture,
 * and no screen needs more than this to read "a lot".
 */
const MAX_COINS = 120;

function coinsForWager(wager) {
  const tokens = Number((wager * 100n) / UNIT) / 100;
  return Math.max(1, Math.min(MAX_COINS, Math.round(tokens)));
}

/** Put the dragon's money on the table for a fresh round. */
function startCoins() {
  coins.clearCoins();
  state.payToken++;
  state.flying = false;
  state.shown = 0n;
  state.coins = coinsForWager(state.wager);
  coins.measure(el.mat);
  coins.pour(state.coins, { onLand: (pile) => sfx.clink(pile) });
}

/** 白包 — lift everything off the player's side and drop the readout to zero. */
function sweepCoins() {
  state.payToken++;
  state.flying = false;
  state.shown = 0n;
  coins.sweepBank({ onLift: () => sfx.scrape() });
}

/** How many of the round's coins a given amount is worth. */
function coinsFor(value) {
  if (!state.round || state.round.pot <= 0n || value <= 0n) return 0;
  const n = Number((value * BigInt(state.coins * 1000)) / state.round.pot) / 1000;
  return Math.max(1, Math.min(state.coins, Math.round(n)));
}

function renderScore() {
  el.pot.textContent = state.round ? `${fmt(state.round.remaining)} ` : "—";
}

/**
 * The banked figure lives on the Keep button and nowhere else — it is the
 * number you are deciding about, so it belongs on the thing you press.
 *
 * Patched in place rather than re-rendered: while coins are landing this runs
 * once per coin, and rebuilding the button under the player's cursor would
 * throw away its pressed state.
 */
function paintKeep() {
  const b = el.controls.querySelector("button.keep");
  if (!b) return;
  b.childNodes[0].nodeValue = `Keep ${fmt(state.shown)} `;
  b.querySelector(".sub").innerHTML = `${multiplier(state.shown, state.wager)}× &mdash; end the round`;
}

/* --------------------------------------------------------------- controls */

function button(label, sub, cls, onClick) {
  const b = document.createElement("button");
  b.className = `action ${cls}`;
  b.innerHTML = `${label}<span class="sub">${sub}</span>`;
  b.disabled = state.busy;
  b.addEventListener("click", onClick);
  return b;
}

function renderControls() {
  el.controls.innerHTML = "";
  el.controls.classList.toggle("single", state.phase !== "playing");

  // The wager row is locked during a round, never hidden. Taking it out of
  // flow would shrink the bottom bar mid-game, the table would jump up the
  // screen to fill the space, and every coin — placed in viewport pixels
  // against the wells — would have to be dragged after it.
  const playing = state.phase === "playing";
  el.wagerRow.classList.toggle("locked", playing);
  for (const node of el.wagerRow.querySelectorAll("input, button")) node.disabled = playing;

  if (state.phase === "playing") {
    const k = state.reveals.length + 1;
    el.controls.appendChild(
      button("Flip card", `white risk ${whiteOdds(k)}`, "ghost", onOpen),
    );
    // mid-payout the button shows however much has landed so far
    if (!state.flying) state.shown = state.round.banked;
    el.controls.appendChild(
      button(
        `Keep ${fmt(state.shown)} `,
        `${multiplier(state.shown, state.wager)}× &mdash; end the round`,
        "keep",
        onKeep,
      ),
    );
    return;
  }

  const label = state.phase === "idle" ? "Open the first envelope" : "Play again";
  el.controls.appendChild(button(label, "拼手气 &middot; lucky split", "", onStart));
}

function render() {
  renderTable();
  renderScore();
  renderControls();
}

function say(html, loss = false) {
  el.message.className = `message${loss ? " loss" : ""}`;
  el.message.innerHTML = html;
}

/* ---------------------------------------------------------------- payout */

/**
 * Hand the grab across the table and count the figure up as the coins arrive —
 * each one adds a tick to the sound and a step to the number, so the button
 * and the stacks finish together.
 */
function payInto(before, after) {
  // One coin has to stay behind for whatever the readout still says is on the
  // dragon's half, or rounding empties his side of the table while the pot
  // reads 0.62 — the coins would be lying about the numbers next to them.
  const cap = state.coins - (state.round.remaining > 0n ? 1 : 0);
  const want = Math.min(coinsFor(after), cap);
  const moving = Math.max(want - coins.counts().bank, 0);

  const showTotal = (v) => {
    state.shown = v;
    paintKeep();
  };

  if (moving === 0) {
    showTotal(after);
    return;
  }

  // Coins already in the air outlive the step that threw them. If the next
  // reveal resolves first — a 白包 wipes the bank — their callbacks must not
  // write a stale total back over it.
  const token = ++state.payToken;
  const stale = () => token !== state.payToken;

  state.flying = true;
  let landed = 0;
  let total = moving;
  // The figure follows the coins: each one that settles on your side moves it
  // up a step, so the button and the handover finish together.
  const onLand = (pile) => {
    if (stale()) return;
    sfx.clink(pile);
    landed++;
    showTotal(before + ((after - before) * BigInt(landed)) / BigInt(total || 1));
    if (landed >= total) {
      state.flying = false;
      showTotal(after);
    }
  };
  const thrown = coins.payOut(moving, { onLand, onLift: () => sfx.scrape() });
  total = thrown;
  if (thrown === 0) {
    state.flying = false;
    showTotal(after);
  }
}

/* ---------------------------------------------------------------- actions */

function parseWager() {
  const raw = (el.wager.value || "").trim().replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10n * UNIT;
  return BigInt(Math.round(n * 1e6)) * 10n ** 12n;
}

function onStart() {
  state.wager = parseWager();
  if (state.host) return void state.host.openSession(state.wager);
  state.round = newRound(state.wager);
  state.reveals = [];
  state.phase = "playing";
  state.lastPayout = 0n;
  sfx.tear();
  render();
  startCoins(); // his money is on the table before anything else happens
  say(
    `The dragon puts <b>${fmt(state.round.pot)}</b> on the table &mdash; ` +
      `<b>${multiplier(state.round.pot, state.wager)}×</b> your wager. Take it a slice at a time.`,
  );
  render();
}

function onOpen() {
  if (state.busy || state.phase !== "playing") return;
  if (state.host) return void state.host.submitOpen();
  state.busy = true;
  renderControls();

  const index = state.reveals.length;
  const envEl = envs()[index];
  envEl.classList.add("popping");
  sfx.tear();

  // Resolve behind the flip: the card starts turning at once, and the payout
  // lands as the inside of the envelope comes round to face the player.
  const before = state.round.banked;
  const result = openNext(state.round);
  state.round = result.round;
  state.reveals.push({ white: result.white, grab: result.grab });
  renderTable(); // adds .opened, which starts the 3D turn

  // All six turn the same way, over the .card transition's 0.62s. A grab is
  // dealt with as soon as the inside comes round to face the player (~0.4s);
  // 白包 ends the round, so it waits for the card to finish landing.
  setTimeout(() => {
    if (result.white) {
      state.phase = "lost";
      sweepCoins();
      sfx.gong();
      say(
        `<b>白包</b> &mdash; the white envelope. In Chinese custom white is the funeral colour, ` +
          `and it sends everything back to the sender. You walked away with <b>nothing</b>.`,
        true,
      );
    } else {
      sfx.coin(index);
      payInto(before, state.round.banked);
      if (state.round.done) {
        state.phase = "settled";
        state.lastPayout = state.round.banked;
        setTimeout(() => sfx.settle(), 420);
        say(
          `All five red envelopes, and you never blinked. ` +
            `<b>${fmt(state.round.banked)}</b> &mdash; <b>${multiplier(state.round.banked, state.wager)}×</b>. ` +
            `The sixth was always going to be white.`,
        );
      } else {
        say(
          `<b>+${fmt(result.grab)}</b> grabbed. <b>${fmt(state.round.remaining)}</b> still on the table, ` +
            `and the white envelope is now <b>${whiteOdds(state.reveals.length + 1)}</b>.`,
        );
      }
    }

    state.busy = false;
    render();
  }, result.white ? 620 : 380);
}

function onKeep() {
  if (state.busy || state.phase !== "playing" || state.round.banked === 0n) return;
  if (state.host) return void state.host.submitKeep();
  state.phase = "settled";
  state.lastPayout = state.round.banked;
  sfx.settle();
  say(
    `Kept <b>${fmt(state.round.banked)}</b> &mdash; <b>${multiplier(state.round.banked, state.wager)}×</b>. ` +
      `Knowing when to stop is the whole game.`,
  );
  render();
}

/* ------------------------------------------------------------------ boot */

el.wagerRow.querySelectorAll(".presets button").forEach((b) => {
  b.addEventListener("click", () => {
    el.wager.value = b.dataset.w;
  });
});

/* A speaker, drawn rather than typed: the one glyph every player already reads
 * as sound. Muted is the same cone with the waves struck through, so the two
 * states differ by the mark that means "off" and not by an unrelated symbol. */
const SPEAKER = '<path d="M4 9h3.5L12 4.5v15L7.5 15H4z"/>';
const WAVES = '<path d="M15.5 8.8a4.4 4.4 0 0 1 0 6.4M18 6a8 8 0 0 1 0 12" fill="none"/>';
const CROSS = '<path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none"/>';
const icon = (muted) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;

el.mute.addEventListener("click", () => {
  const next = !sfx.isMuted();
  sfx.setMuted(next);
  el.mute.innerHTML = icon(next);
  el.mute.classList.toggle("off", next);
});

/**
 * A shortcut presses the button; it does not reach past it.
 *
 * Going through .click() means the same handler runs, a disabled button stays
 * inert, and there is one route into every action whichever way it was asked
 * for. `.pressed` is the same declaration :active uses, held just long enough
 * to be seen — without it the block never moves for a key, and the bar looks
 * broken while it is working.
 */
function press(btn) {
  if (!btn || btn.disabled) return;
  btn.classList.add("pressed");
  // Down first, act after — the block has to be seen going down, and clicking
  // straight away rebuilds the controls and throws away the button that was
  // holding the class. 90ms is the press transition's own duration.
  setTimeout(() => {
    btn.classList.remove("pressed");
    btn.click();
  }, 90);
}

document.addEventListener("keydown", (e) => {
  // the first control is whatever the round is offering: flip, or play again
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    press(el.controls.querySelector("button"));
  }
  // Tab keeps, but only mid-round. That is the only time there is anything to
  // keep, and the only time the wager row is locked out of the tab order
  // anyway — outside a round Tab still walks the bar as it should.
  if ((e.key === "Tab" || e.key.toLowerCase() === "k") && state.phase === "playing") {
    e.preventDefault();
    press(el.controls.querySelector("button.keep"));
  }
});

buildTable();
render();

/**
 * Re-measure whenever the table could have moved.
 *
 * A window resize is the obvious case, but not the common one: the wager row
 * comes back at the end of a round, the bottom bar grows, and the mat is
 * pushed up the screen without the window changing size at all. Coins are
 * placed in viewport pixels, so anything that moves the wells has to be
 * followed or they are left floating where the wells used to be.
 */
let layoutTimer = null;
function remeasure() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    const { pot, bank } = coins.counts();
    if (pot + bank > 0) coins.measure(el.mat);
  }, 50);
}

window.addEventListener("resize", remeasure);
if (window.ResizeObserver) {
  // the mat's own size, and both bars, since either one growing shifts it
  const watch = new ResizeObserver(remeasure);
  for (const node of [el.mat, document.querySelector(".hud.top"), document.querySelector(".hud.bottom")]) {
    if (node) watch.observe(node);
  }
}

/* Host mode attaches itself when this page is embedded in the Chain.wtf app. */
if (window.parent !== window) {
  import("./bridge.js")
    .then((m) => m.attach({ state, render, say, el, sfx, startCoins, payInto, sweepCoins }))
    .catch(() => {
      /* standalone demo stays fully playable if the bridge is unavailable */
    });
}
