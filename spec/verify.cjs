/**
 * HONGBAO 拼手气 — exact mirror of HongbaoGame.sol integer math.
 * Same keccak draws, same bps rounding, same state machine. Confirms the
 * declared RTP matches the real paytable (jam eligibility requirement).
 */
const { keccak256, AbiCoder, randomBytes, hexlify } = require("/home/hashino/Projects/arc-metered-channel/node_modules/ethers");
const abi = AbiCoder.defaultAbiCoder();

const ENVELOPES = 6n, GRAB_LO_BPS = 4500n, GRAB_HI_BPS = 8500n, BPS_DEN = 10000n;
const M_BPS   = [4500n, 13500n, 27000n, 45000n, 90000n];
const M_W_BPS = [4200n,  3200n,  1600n,   800n,   200n];
const MAX = (1n << 256n) - 1n;

// mirrors _drawRange(seed, idx, n)
function drawRange(seedHex, idx, n) {
  let seed = keccak256(abi.encode(["bytes32", "uint256"], [seedHex, idx]));
  const accepted = (MAX / n) * n;
  for (;;) {
    const x = BigInt(seed);
    if (x < accepted) return { v: x % n, nextIdx: idx + 1n, seed };
    seed = keccak256(abi.encode(["bytes32"], [seed]));
  }
}

function drawPot(randomness) {
  const { v: r } = drawRange(randomness, 0n, BPS_DEN);
  let acc = 0n;
  for (let i = 0; i < M_BPS.length; i++) { acc += M_W_BPS[i]; if (r < acc) return M_BPS[i]; }
  return M_BPS[M_BPS.length - 1];
}

const rnd = () => hexlify(randomBytes(32));

/** Play one round. strat(banked, k, pot) -> true = KEEP. Returns payout (BigInt). */
function play(wager, strat) {
  let pot = (wager * drawPot(rnd())) / BPS_DEN;
  if (pot === 0n) return 0n;
  let remaining = pot, banked = 0n, opened = 0n;
  for (;;) {
    const k = opened + 1n;
    const randomness = rnd();
    const { v: r, nextIdx } = drawRange(randomness, 0n, ENVELOPES + 1n - k);
    if (r === 0n) return 0n;                                  // 白包 white envelope
    const lo = (remaining * GRAB_LO_BPS) / BPS_DEN;
    let hi = (remaining * GRAB_HI_BPS) / BPS_DEN;
    if (hi <= lo) hi = lo;
    const span = hi - lo + 1n;
    const { v: j } = drawRange(randomness, nextIdx, span);
    banked += lo + j;
    remaining = remaining > lo + j ? remaining - (lo + j) : 0n;
    opened = k;
    if (opened === ENVELOPES - 1n) return banked;             // 5 reds: auto-settle
    if (strat(banked, opened, pot)) return banked;            // KEEP
  }
}

const STRATS = {
  "keep after 1st": (b, k, P) => k >= 1n,
  "keep after 2nd": (b, k, P) => k >= 2n,
  "keep after 3rd": (b, k, P) => k >= 3n,
  "keep at 60% pot": (b, k, P) => b * 100n >= 60n * P,
  "keep at 70% pot": (b, k, P) => b * 100n >= 70n * P,
  "keep at 80% pot": (b, k, P) => b * 100n >= 80n * P,
  "never keep": () => false,
};

const WAGER = 10n ** 18n; // 1 chUSD in wei
const N = Number(process.argv[2] || 100000);
console.log(`HONGBAO — contract-exact simulation, ${N.toLocaleString()} rounds/strategy, wager = 1 chUSD\n`);
let best = 0, bestName = "";
for (const [name, f] of Object.entries(STRATS)) {
  let total = 0n, zeros = 0, max = 0n;
  const xs = [];
  for (let i = 0; i < N; i++) {
    const p = play(WAGER, f);
    total += p; if (p === 0n) zeros++; if (p > max) max = p;
    xs.push(Number(p / 10n ** 12n) / 1e6);
  }
  const r = Number(total / 10n ** 12n) / 1e6 / N;
  if (r > best) { best = r; bestName = name; }
  xs.sort((a, b) => a - b);
  const q = p => xs[Math.floor(N * p)].toFixed(2);
  console.log(`${name.padEnd(16)} RTP=${(r * 100).toFixed(2)}%  zero=${(zeros / N * 100).toFixed(1)}%  ` +
              `median=${q(0.5)}x p90=${q(0.9)}x p99=${q(0.99)}x max=${(Number(max / 10n ** 12n) / 1e6).toFixed(2)}x`);
}
console.log(`\nOptimal strategy: ${bestName} -> RTP ${(best * 100).toFixed(2)}%  ` +
            `${best >= 0.93 && best <= 0.98 ? "PASS (93-98% band)" : "FAIL"}`);
