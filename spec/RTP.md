# HONGBAO 拼手气 — declared math

> Eligibility requires "theoretical RTP between 93–98%, declared math matching the
> actual paytable". This document is that declaration. Both numbers below come from
> two independent implementations that agree: a from-scratch probability model
> (`spec/rtp.py`) and a bit-exact mirror of the deployed contract's integer math
> (`spec/verify.cjs`).

## The game

A dragon hands you a stack of **six red envelopes**. Five hold a *lucky split* of the
round's pot; one is the **white envelope (白包)** — in Chinese custom white is the
funeral colour, and it sends everything you grabbed back to the sender.

You open them one at a time. Every red envelope grabs a slice of what is still on the
table and banks it. After every red envelope you choose: **KEEP** what you banked, or
**OPEN** another. The white envelope pays zero.

## Parameters (contract constants)

| Constant | Value | Meaning |
| --- | --- | --- |
| `ENVELOPES` | 6 | 5 red + 1 white |
| `GRAB_LO_BPS` | 4 500 | each red grabs ≥ 45 % of the **remaining** pot |
| `GRAB_HI_BPS` | 8 500 | each red grabs ≤ 85 % of the **remaining** pot |
| `MAX_MULT_BPS` | 90 000 | payout cap = 9× wager |

### Pot table

The pot is drawn once per round, before the first envelope.

| Pot (× wager) | `multiplierBps` | Weight |
| --- | --- | --- |
| 0.45× | 4 500 | 42 % |
| 1.35× | 13 500 | 32 % |
| 2.70× | 27 000 | 16 % |
| 4.50× | 45 000 | 8 % |
| 9.00× | 90 000 | 2 % |

`E[M] = 1.593`. Weights sum to 10 000 bps exactly.

### White-envelope hazard

Exactly one of the six envelopes is white. Rather than store a hidden shuffled
position on-chain, the contract draws the hazard **per open**:

| Open *k* | P(white) | Equals |
| --- | --- | --- |
| 1 | 1/6 | `1 / (7 − k)` |
| 2 | 1/5 | |
| 3 | 1/4 | |
| 4 | 1/3 | |
| 5 | 1/2 | |
| 6 | — | certain; the contract auto-settles after the 5th red |

This is the **same joint distribution** as a fixed shuffled deck (the position of the
white envelope is uniform over the six slots), with one advantage: there is no hidden
state on chain for anyone — player, house, or indexer — to read ahead of the reveal.

## Randomness

Every draw is unbiased by **full-word rejection sampling**: only values in
`[0, ⌊2²⁵⁶−1 / n⌋ · n)` are accepted, then reduced `mod n`. That band is an exact
multiple of `n`, so no residue is favoured. Words outside it are rehashed. Naïve
`% n` on a 256-bit word would bias small residues; per the SDK's own randomness
rules, that is treated as a defect.

Draws are domain-separated by cursor: `keccak256(abi.encode(seed, idx))`, so the
white-envelope hazard and the grab size within one fulfillment are independent.

## Results

Bit-exact contract mirror, 40 000 rounds per strategy, wager = 1 chUSD:

| Strategy | RTP | Zero rate | Median | p90 | p99 | Max seen |
| --- | --- | --- | --- | --- | --- | --- |
| keep after 1st red | 86.09 % | 16.5 % | 0.37× | 2.12× | 5.31× | 7.65× |
| keep after 2nd red | 93.70 % | 32.9 % | 0.41× | 2.47× | 7.68× | 8.76× |
| keep after 3rd red | 74.48 % | 50.3 % | 0.00× | 2.56× | 7.77× | 8.95× |
| keep at 60 % of pot | 93.15 % | 23.1 % | 0.38× | 2.27× | 6.53× | 8.42× |
| **keep at 70 % of pot (optimal)** | **94.68 %** | 27.1 % | 0.39× | 2.36× | 6.95× | 8.56× |
| keep at 80 % of pot | 93.05 % | 33.3 % | 0.40× | 2.45× | 7.56× | 8.68× |
| never keep (all 5 reds) | 27.11 % | 83.1 % | 0.00× | 0.45× | 4.48× | 9.00× |

**Declared theoretical RTP: 94.7 %** (optimal play) — inside the 93–98 % band.
House edge 5.3 %. Greedy play is punished hard (27 %), and so is quitting on the
first envelope (86 %): the interesting band is narrow and that is the game.

`quoteRiskParams` reports `probabilityWad = 0.8333e18` (P(payout > 0) ≤ P(first
envelope is red) = 5/6), `expectedPayout = 0.947 × wager`, `maxPayout = 9 × wager`.
Max multiplier 9× is below the heavy-tail threshold (100×), so the game takes the
ordinary VaR reserve path, not the tiered jackpot path.

## Reproducing

```sh
python3 spec/rtp.py            # independent probability model
node    spec/verify.cjs 40000  # bit-exact mirror of HongbaoGame.sol
node    spec/compile.cjs       # compiles the contract (solc 0.8.x, paris)
```
