# HONGBAO 拼手气 — Lucky Split

**Chain Jam Vol. 1 entry.** A casino game built on the Chain casino SDK.

**▸ [Play it](https://hashino.github.io/hongbao/)** — the page is the submission; it runs standalone with no wallet, and switches to the chain when a host connects.

> Six red envelopes hold a lucky split of the dragon's pot. Five are red. One is
> the white envelope — 白包 — and white is the funeral colour. Open them one at a
> time. After every red envelope you decide: keep what you banked, or reach for
> one more.

---

## Why this game does not exist yet

**拼手气红包** — "lucky split red envelope" — is the single most-played money
mechanic in human history. WeChat users send billions of them: one person drops
a pot in, the app splits it into random unequal shares, and everyone races to
grab one. The whole joy is the *unfair split* — one person gets ¥48, the next
gets ¥0.03, and the group screenshots it.

The West has the red envelope as **decoration**. Kalamba's *Hong Bao*, Zitro's
*Red Envelope Riches*, Aristocrat's *5 Dragons* bonus — all of them are ordinary
slots wearing a Lunar New Year skin. Nobody has shipped the **mechanic**: the
random split itself, as the game.

That is this game. The split is not a theme, it is the paytable.

And the risk half is drawn from the same culture rather than invented: at a
Chinese funeral the envelope is white, and receiving one is the opposite of
receiving a red one. So the game has exactly one rule you need to be told, and
it explains both the reward and the loss.

It is not a clone of anything on the jam's exclusion list — no blackjack, no
plinko, dice, limbo or crash. Mechanically it is closest to a press-your-luck
bank game, and the closest thing on chain.wtf's own SDK (mines) differs in the
part that matters: in mines every safe tile pays the same escalating multiplier,
while here **every grab is a different random slice of a shrinking pot**, so the
decision to stop changes value on every single open.

---

## How it plays

1. Place a wager. The dragon puts a pot on the table — between **0.45×** and
   **9×** your wager, drawn from a declared table.
2. Open an envelope. A red one **grabs 45–85 % of whatever is still on the
   table** and banks it for you. The white one ends the round at zero.
3. After each red envelope, **KEEP** (settle for what you banked) or **OPEN**
   another. The white risk climbs every time: 1/6, then 1/5, 1/4, 1/3, 1/2.
4. Open all five reds and the game settles for you — the sixth was always white.

The tension is front-loaded by design: the first envelope takes the biggest
bite, so quitting early is genuinely competitive (86 % RTP), going all the way
is genuinely bad (27 %), and the optimal line sits in a narrow band most players
will feel for rather than calculate.

| Strategy | RTP |
| --- | --- |
| keep after the 1st red | 86.09 % |
| keep after the 2nd red | 93.70 % |
| **keep at ~70 % of pot (optimal)** | **94.68 %** |
| never keep, open all five | 27.11 % |

Full paytable, hazard table and the proof: **[`spec/RTP.md`](spec/RTP.md)**.

---

## Eligibility checklist

| Gate | Status |
| --- | --- |
| Implements the Chain casino SDK exactly — contract, bridge, manifest | `contracts/HongbaoGame.sol` implements `ICasinoGameV2`; `game/js/bridge.js` uses the SDK guest bridge; `game/public/game.manifest.json` |
| Runs correctly in the local simulator, loads near-instantly | No framework, no bundler, no runtime deps — plain ES modules, all sound synthesised in WebAudio |
| Theoretical RTP 93–98 %, declared math matches the paytable | **94.7 %**, verified two independent ways — see below |
| Recognisably a casino game: wager in, outcome, payout | Yes |
| Novel concept, no clone | 拼手气 split mechanic; see "Why this game does not exist yet" |
| Runs standalone outside the chain.wtf iframe | Yes — the page detects it is not embedded and resolves rounds locally with the same math |
| Carries the jam widget | `jam.chain.wtf/widget.js` in `game/index.html` |

---

## The math is checked, not asserted

The declared 94.7 % comes from two implementations written independently of
each other, which agree to within Monte-Carlo noise:

```sh
python3 spec/rtp.py             # from-scratch probability model      -> 94.7 %
node    spec/verify.cjs 40000   # bit-exact mirror of the contract    -> 94.68 %
node    spec/compile.cjs        # compiles HongbaoGame.sol (4,169 bytes)
```

`spec/verify.cjs` reimplements the contract's integer path exactly — same bps
rounding, same keccak-derived draws, same rejection-sampling band, same state
machine — so it catches the class of bug where the whitepaper and the bytecode
disagree.

### Contract design notes

- **No hidden state.** Rather than storing a shuffled envelope order on chain,
  the white envelope is drawn per open at hazard `1/(7−k)`. That is the same
  joint distribution as a fixed shuffled position, with nothing for a player,
  the house or an indexer to read ahead of the reveal.
- **Unbiased draws.** Every random value uses full-word rejection sampling onto
  an exact multiple of the range, so no residue is favoured. Draws within one
  fulfillment are domain-separated by cursor, so the white hazard and the grab
  size are independent.
- **One payout function.** `quoteCaps`, `quoteRiskParams` and the settlement
  path all derive the cap from the same `_maxPayout`, which is the documented
  way to avoid top-multiplier wins reverting with `InvalidPayout`.
- **Honest forfeit quote.** `quoteForfeitPayout` returns the banked grabs. They
  are fully determined by already-revealed state, so this is a true anytime
  cash-out and not an adverse-selection hole.
- **Not heavy-tail.** Max multiplier 9× is below the 100× threshold, so the game
  takes the ordinary VaR reserve path rather than the tiered jackpot path.

---

## Layout

This repository is the submission: the game exactly as it is served, plus the
contract behind it and the math that checks it. GitHub Pages publishes the root,
which is why the game page sits at the top level — the host fetches
`game.manifest.json` from the game's own origin, so it has to be at the served
root.

```
index.html               the game page — no build step, no dependencies
js/math.js               the contract's math, for the standalone demo
js/game.js               state machine + render
js/coins.js              the stacks on the table, and the transfer between them
js/bridge.js             host mode: the SDK guest bridge
js/codec.js              ABI codec for HongbaoState / OpenAction
js/audio.js              synthesised sound — no audio files
css/hongbao.css          lacquer red, gold foil, ink black
game.manifest.json       served at the root, with CORS, as the host requires
vendor/                  the SDK's own src/guest.ts, compiled (see below)

contracts/HongbaoGame.sol  the game — implements ICasinoGameV2
spec/RTP.md                declared math, hazard table, results
spec/rtp.py                independent probability model
spec/verify.cjs            bit-exact mirror of the contract
spec/compile.cjs           solc build
```

`vendor/casino-sdk-guest.js` is the only file here that is not ours: it is
Chain's own `src/guest.ts` from the casino SDK, bundled with esbuild. It is
committed rather than built because the game has no build step and Pages serves
these files exactly as they are. Rebuild it from a checkout of the SDK with:

```sh
./node_modules/.bin/esbuild src/guest.ts \
  --bundle --format=esm --platform=browser --target=es2022 --minify \
  --outfile=<this repo>/vendor/casino-sdk-guest.js
```

## Running it

The standalone demo needs nothing but a static server:

```sh
python3 -m http.server 8731
# open http://localhost:8731
```

It resolves rounds locally with the same math the contract runs, so the page is
playable with no chain, no wallet and no SDK. If the guest bridge cannot reach a
host it stays in demo mode by design — it never silently half-connects. The chip
in the top right tells you which mode you are in: `demo` or `LIVE`.

## Running it against the chain

Verified against the real contract in the SDK's local simulator: `HongbaoGame`
deployed, three rounds resolved by the Verify Network's ECVRF, player balance up
**+25.81 chUSD** on chain, chip reading `LIVE`.

To reproduce it you need a checkout of the Chain casino SDK. Hand the contract
to the simulator's watcher, which compiles, deploys and registers anything in
`simulator/contracts` implementing `ICasinoGameV2`. `contracts/HongbaoGame.sol`
stays the only source; the copy just needs a flatter import path:

```sh
sed 's|"../simulator/contracts/ICasinoGameV2.sol"|"./ICasinoGameV2.sol"|' \
  contracts/HongbaoGame.sol > <sdk>/simulator/contracts/HongbaoGame.sol
```

Then, in three terminals:

```sh
npm --prefix simulator run local-node   # chain + Verify Network VRF node
npm --prefix simulator run dev          # the harness, on :3300
python3 -m http.server 8731             # this repo
```

Open the harness with the deployed address:

```
http://localhost:3300/?game=http://localhost:8731&gameAddress=<address>&gameName=HongbaoGame
```

Two things that cost time and are worth writing down. The manifest has to be
served with an `Access-Control-Allow-Origin` header, and a **404 on it looks
exactly like a CORS error**, because a 404 response carries no such header
either — check the file is where you think it is before you debug CORS. And the
SDK pins npm 12; if yours is older, install it into a prefix rather than
touching your global one:

```sh
npm install --prefix /tmp/npm12 npm@12.0.2
node /tmp/npm12/node_modules/npm/bin/npm-cli.js install
```

esbuild's postinstall is blocked by npm 12's default script policy. That is only
an optimisation — the JS shim resolves `@esbuild/<platform>` itself, and
`./node_modules/.bin/esbuild --version` confirms it works.

## Licence

MIT — see [LICENSE](LICENSE). `vendor/casino-sdk-guest.js` is Chain's, included
so the page runs; everything else here is original work.
