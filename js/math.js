/**
 * HONGBAO 拼手气 — the contract's math, mirrored for the standalone demo.
 *
 * These constants and this state machine are the same ones in HongbaoGame.sol.
 * In host mode the chain is authoritative and this file is only used to decode
 * and label state; in standalone demo mode it *is* the game.
 * See spec/RTP.md for the declared paytable and the RTP proof.
 */

export const ENVELOPES = 6;
export const GRAB_LO_BPS = 4500n;
export const GRAB_HI_BPS = 8500n;
export const BPS_DEN = 10000n;
export const MAX_MULT_BPS = 90000n;

/** Pot table: [multiplierBps, weightBps]. Weights sum to 10_000. */
export const POT_TABLE = [
  [4500n, 4200n],
  [13500n, 3200n],
  [27000n, 1600n],
  [45000n, 800n],
  [90000n, 200n],
];

/**
 * Unbiased integer in [0, n) — rejection sampling over the same full word the
 * contract uses.
 *
 * The word has to be 256 bits, not 64: a grab is drawn from a range of wei, so
 * n is routinely larger than 2^64. With a 64-bit word the largest multiple of n
 * that fits is zero, nothing is ever accepted, and the draw spins forever.
 */
function drawRange(n) {
  if (n <= 1n) return 0n;
  const max = 2n ** 256n - 1n;
  const accepted = (max / n) * n; // largest multiple of n that fits the word
  const buf = new BigUint64Array(4);
  for (;;) {
    crypto.getRandomValues(buf);
    let x = 0n;
    for (let i = 0; i < 4; i++) x = (x << 64n) | buf[i];
    if (x < accepted) return x % n;
  }
}

function drawPot() {
  const r = drawRange(BPS_DEN);
  let acc = 0n;
  for (const [mult, weight] of POT_TABLE) {
    acc += weight;
    if (r < acc) return mult;
  }
  return POT_TABLE[POT_TABLE.length - 1][0];
}

/** P(white envelope) at open k (1-based) = 1 / (ENVELOPES + 1 - k). */
export function whiteOdds(k) {
  return `1/${ENVELOPES + 1 - k}`;
}

/**
 * A local round, driven one envelope at a time so the UI can animate each reveal.
 * Mirrors HongbaoGame.sol: pot fixed at start, per-open white hazard, grab in
 * [45%, 85%] of the remaining pot, auto-settle after the 5th red.
 */
export function newRound(wager) {
  const pot = (wager * drawPot()) / BPS_DEN;
  return { pot, remaining: pot, banked: 0n, opened: 0, done: false, white: false };
}

/** Open the next envelope. Returns { white, grab, round }. */
export function openNext(round) {
  if (round.done) throw new Error("round already settled");
  const k = round.opened + 1;
  if (drawRange(BigInt(ENVELOPES + 1 - k)) === 0n) {
    return { white: true, grab: 0n, round: { ...round, done: true, white: true, banked: 0n } };
  }
  const lo = (round.remaining * GRAB_LO_BPS) / BPS_DEN;
  let hi = (round.remaining * GRAB_HI_BPS) / BPS_DEN;
  if (hi <= lo) hi = lo;
  const grab = lo + drawRange(hi - lo + 1n);
  const next = {
    ...round,
    banked: round.banked + grab,
    remaining: round.remaining > grab ? round.remaining - grab : 0n,
    opened: k,
  };
  next.done = next.opened === ENVELOPES - 1; // 6th is certainly white
  return { white: false, grab, round: next };
}

/** Format a wei-scaled bigint for display. */
export function fmt(v, decimals = 18, places = 2) {
  const unit = 10n ** BigInt(decimals);
  const whole = v / unit;
  const frac = ((v % unit) * 10n ** BigInt(places)) / unit;
  return `${whole}.${frac.toString().padStart(places, "0")}`;
}

export function multiplier(payout, wager) {
  if (wager === 0n) return "0.00";
  return (Number((payout * 1000n) / wager) / 1000).toFixed(2);
}
