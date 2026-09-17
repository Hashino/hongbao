#!/usr/bin/env python3
"""HONGBAO 拼手气 — final model MC (stdlib only).
N=6 envelopes, 1 white; hazard at open k = 1/(7-k): 1/6,1/5,1/4,1/3,1/2, then auto-settle.
Red grab: v_k uniform in [LO*R, HI*R] (lucky-split feel, front-loaded).
Pot P = wager * M from declared table. Unclaimed remainder -> house."""
import random

WAGER = 100
N, LO, HI = 6, 0.45, 0.85
M_TABLE = [(0.45, 0.42), (1.35, 0.32), (2.7, 0.16), (4.5, 0.08), (9.0, 0.02)]  # E[M]=1.59, cap 9x

def play(rnd, strat):
    x, acc = rnd.random(), 0.0
    for m, w in M_TABLE:
        acc += w
        if x < acc: break
    P = int(WAGER * m); R = P; banked = 0
    for k in range(1, N):                     # opens 1..5
        if rnd.random() < 1.0 / (N - k + 1): return 0
        lo, hi = max(1, int(LO * R)), max(1, int(HI * R))
        v = rnd.randint(lo, hi) if hi > lo else lo
        banked += v; R -= v
        if k == N - 1 or strat(banked, k, P): return banked
    return banked

STRATS = {
    "keep1": lambda b, k, P: k >= 1,
    "keep2": lambda b, k, P: k >= 2,
    "keep3": lambda b, k, P: k >= 3,
    "keep4": lambda b, k, P: k >= 4,
    "g50":   lambda b, k, P: b >= 0.50 * P,
    "g60":   lambda b, k, P: b >= 0.60 * P,
    "g70":   lambda b, k, P: b >= 0.70 * P,
    "g90":   lambda b, k, P: b >= 0.90 * P,
    "g80":   lambda b, k, P: b >= 0.80 * P,
}
def rtp(f, n=1_000_000, seed=7):
    rnd = random.Random(seed)
    return sum(play(rnd, f) for _ in range(n)) / (n * WAGER)

if __name__ == "__main__":
    E = sum(m * w for m, w in M_TABLE)
    print(f"E[M]={E:.3f}  (cap 10x)")
    for s, f in STRATS.items(): print(f"  {s:>6}: {rtp(f):.4f}")
    rnd = random.Random(99); n = 300_000
    outs = sorted(play(rnd, STRATS["keep2"]) for _ in range(n))
    q = lambda p: outs[int(n * p)] / WAGER
    print(f"\ng60 outcomes: median={q(.5):.2f}x p90={q(.9):.2f}x p99={q(.99):.2f}x max={outs[-1]/WAGER:.2f}x zero={outs.count(0)/n:.3f}")
