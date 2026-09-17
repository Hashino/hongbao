/**
 * Host mode — the Chain.wtf iframe bridge.
 *
 * Loaded only when the page is embedded (see the tail of game.js). It follows
 * the guest lifecycle from the SDK docs §3.4:
 *   1. connectGameToHost({ setState })      — store every HostSnapshotV1
 *   2. await connection.promise             — enable actions once hostApi lands
 *   3. hostApi.revealOutcome({ sessionId }) — after our animation, so the host
 *                                             un-clamps its balance display
 *   4. connection.destroy() on teardown
 *
 * The chain is authoritative here: every envelope is a real VRF draw and the
 * local math in math.js is used only to *decode* HongbaoState, never to decide
 * an outcome.
 *
 * `vendor/casino-sdk-guest.js` is the SDK's own `src/guest.ts`, compiled.
 * Produce it with `npm run build:sdk` (see README) — until then this module
 * fails to import and the page stays in standalone demo mode, which is exactly
 * the intended fallback.
 */

import {
  connectGameToHost,
  observeGameContentSize,
  SessionPhase,
} from "../vendor/casino-sdk-guest.js";
import { decodeState, encodeKeep, encodeOpen } from "./codec.js";
import { ENVELOPES, fmt, multiplier, whiteOdds } from "./math.js";

/** Attach host mode to the already-running UI. */
export function attach(ui) {
  const { state, render, say, el, sfx, startCoins, payInto, sweepCoins } = ui;

  let hostApi = null;
  let snapshot = null;
  let sizeObserver = null;
  let revealed = new Set();
  // The contract stores totals, not a per-envelope list, so grabs are recovered
  // as the delta in `banked` between consecutive snapshots of the same session.
  let track = { sessionId: null, banked: 0n, grabs: [] };

  const connection = connectGameToHost({
    async setState(next) {
      snapshot = next;
      applySnapshot(next);
    },
  });

  connection.promise
    .then(async (api) => {
      hostApi = api;
      el.mode.textContent = "live";
      el.mode.classList.add("live");
      sizeObserver = observeGameContentSize(api);
      state.host = { openSession, submitKeep, submitOpen };
      render();
    })
    .catch(() => {
      /* stay in demo mode */
    });

  window.addEventListener("pagehide", () => {
    sizeObserver?.disconnect();
    connection.destroy();
  });

  /* ------------------------------------------------------------- snapshot */

  function activeSession() {
    const items = snapshot?.sessions?.items ?? [];
    const mine = items.filter(
      (s) => s.gameAddress?.toLowerCase() === snapshot.integration.gameAddress.toLowerCase(),
    );
    return mine.sort((a, b) => b.lastEventTimestamp - a.lastEventTimestamp)[0] ?? null;
  }

  function applySnapshot(next) {
    const session = activeSession();
    if (!session) return;

    const decimals = next.token?.decimals ?? 18;
    const wager = BigInt(session.stake ?? session.wager ?? "0");
    const decoded = session.raw?.gameState ? decodeState(session.raw.gameState) : null;
    if (!decoded) return;

    state.wager = wager;
    state.decimals = decimals;
    state.round = {
      pot: decoded.pot,
      remaining: decoded.remaining,
      banked: decoded.banked,
      opened: decoded.opened,
      done: false,
    };

    if (track.sessionId !== session.sessionId) {
      track = { sessionId: session.sessionId, banked: 0n, grabs: [] };
      startCoins(); // a new session: the dragon stacks his money again
    }
    const wasBanked = track.banked;
    while (track.grabs.length < decoded.opened) {
      // One or more envelopes opened since the last snapshot. Any grab we
      // missed the individual value of is folded into the newest one.
      const isNewest = track.grabs.length === decoded.opened - 1;
      track.grabs.push(isNewest ? decoded.banked - track.banked : 0n);
      if (isNewest) track.banked = decoded.banked;
    }
    state.reveals = track.grabs.map((grab) => ({ white: false, grab }));
    // Hand the difference across the table. The contract is the authority on
    // the amount; the coins only have to agree with it.
    if (track.banked > wasBanked) payInto(wasBanked, track.banked);

    switch (session.phaseName) {
      case "WAITING_PLAYER_ACTION":
        state.phase = "playing";
        state.busy = false;
        if (decoded.opened === 0) {
          say(
            `The dragon puts <b>${fmt(decoded.pot, decimals)}</b> on the table — ` +
              `<b>${multiplier(decoded.pot, wager)}×</b> your wager.`,
          );
        } else {
          say(
            `<b>${fmt(decoded.banked, decimals)}</b> banked, ` +
              `<b>${fmt(decoded.remaining, decimals)}</b> still on the table. ` +
              `The white envelope is now <b>${whiteOdds(decoded.opened + 1)}</b>.`,
          );
        }
        break;

      case "WAITING_RANDOMNESS":
        state.phase = "playing";
        state.busy = true;
        say("The dragon is drawing…");
        break;

      case "SETTLED": {
        const payout = BigInt(session.payout ?? "0");
        state.phase = payout === 0n ? "lost" : "settled";
        state.busy = false;
        if (payout === 0n) {
          if (state.reveals.length < ENVELOPES) {
            state.reveals.push({ white: true, grab: 0n });
          }
          sweepCoins();
          sfx.gong();
          say(
            `<b>白包</b> — the white envelope. Everything goes back to the sender.`,
            true,
          );
        } else {
          sfx.settle();
          say(
            `<b>${fmt(payout, decimals)}</b> — <b>${multiplier(payout, wager)}×</b>.`,
          );
        }
        // Step 3 of the guest lifecycle: tell the host our presentation is done
        // so it can credit the payout in its own balance UI.
        if (!revealed.has(session.sessionId)) {
          revealed.add(session.sessionId);
          void hostApi?.revealOutcome({ sessionId: session.sessionId });
        }
        break;
      }

      case "FORFEITED":
      case "CANCELLED":
        state.phase = "idle";
        state.busy = false;
        say("That round was closed out. Start another.");
        break;

      default:
        state.phase = "idle";
        state.busy = false;
    }

    render();
  }

  /* -------------------------------------------------------------- actions */

  async function openSession(wager) {
    if (!hostApi) return;
    state.busy = true;
    render();
    try {
      // gameData is empty: the wager alone configures a Hongbao round.
      await hostApi.openSession({ wager: wager.toString(), gameData: "0x" });
    } catch (err) {
      state.busy = false;
      say(friendlyError(err));
      render();
    }
  }

  async function submitOpen() {
    const session = activeSession();
    if (!hostApi || !session) return;
    state.busy = true;
    sfx.tear();
    render();
    try {
      await hostApi.submitAction({
        sessionId: session.sessionId,
        actionData: encodeOpen(),
      });
    } catch (err) {
      state.busy = false;
      say(friendlyError(err));
      render();
    }
  }

  async function submitKeep() {
    const session = activeSession();
    if (!hostApi || !session) return;
    state.busy = true;
    render();
    try {
      await hostApi.submitAction({
        sessionId: session.sessionId,
        actionData: encodeKeep(),
      });
    } catch (err) {
      state.busy = false;
      say(friendlyError(err));
      render();
    }
  }

  /** Map the facet's revert selectors to something a player can act on. */
  function friendlyError(err) {
    const text = String(err?.message ?? err ?? "");
    if (text.includes("BetRiskExceedsLimit") || text.includes("InsufficientPortfolioReserve")) {
      return "That wager is above what the house can cover right now. Try a smaller one.";
    }
    if (text.includes("User rejected") || text.includes("denied")) {
      return "Transaction cancelled.";
    }
    return "That didn't go through. Try again.";
  }

  return { SessionPhase };
}
