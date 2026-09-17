// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ICasinoGameV2, SessionContext, SessionPhase, StepResult} from "../simulator/contracts/ICasinoGameV2.sol";

/// @title HONGBAO 拼手气 (Lucky Split)
/// @notice Six red envelopes hold a lucky split of the dragon's pot; one holds the
///         white envelope (白包) and returns your grabs to the sender. Open one at a
///         time, KEEP what you have banked whenever you want.
///
///  Declared math (see spec/RTP.md):
///   - Pot multiplier M (bps of wager): 4500 w=4200 | 13500 w=3200 | 27000 w=1600 |
///     45000 w=800 | 90000 w=200.  E[M] = 1.593, max payout = 9x wager.
///   - Exactly one white envelope among 6, drawn per-open by hazard 1/(7-k):
///     1/6, 1/5, 1/4, 1/3, 1/2 (jointly identical to a fixed shuffled position,
///     but no hidden on-chain state exists).
///   - Red grab: v in [45%, 85%] of the remaining pot (front-loaded lucky split).
///   - RTP: 94.7% (optimal play, Monte-Carlo of this exact paytable); 85.9% if you
///     always keep after the first red envelope.
contract HongbaoGame is ICasinoGameV2 {
    // ------------------------------------------------------------------ errors
    error Hongbao__BadGameData();
    error Hongbao__NoPlayerActionExpected();
    error Hongbao__BadAction();
    error Hongbao__NothingBanked();
    error Hongbao__BadPhase();

    // ------------------------------------------------------------- parameters
    uint8   public constant ENVELOPES     = 6;
    uint16  public constant GRAB_LO_BPS   = 4_500; // 45% of remaining
    uint16  public constant GRAB_HI_BPS   = 8_500; // 85% of remaining
    uint32  public constant MAX_MULT_BPS  = 90_000; // 9x — payout cap
    uint256 internal constant BPS_DEN     = 10_000;

    /// @notice Pot table: (multiplierBps, weightBps). Weights sum to 10_000.
    uint32[5] internal M_BPS   = [4_500, 13_500, 27_000, 45_000, 90_000];
    uint16[5] internal M_W_BPS = [4_200,  3_200,  1_600,    800,    200];

    // ---------------------------------------------------------------- state
    struct HongbaoState {
        uint256 pot;       // pot = wager * M / BPS_DEN, fixed at round start
        uint256 remaining; // unclaimed part of the pot
        uint256 banked;    // grabbed so far (cashable)
        uint8 opened;      // red envelopes opened so far (0..5)
    }

    struct OpenAction { bool keep; } // keep=true => KEEP; else OPEN next envelope

    // ------------------------------------------------------- payout (single route)
    function _maxPayout(uint256 wager) internal pure returns (uint256) {
        return (wager * MAX_MULT_BPS) / BPS_DEN;
    }

    // -------------------------------------------------- unbiased draws from seed
    /// @dev Unbiased integer in [0, n) via full-word rejection sampling.
    function _drawRange(bytes32 seed, uint256 idx, uint256 n)
        internal pure returns (uint256 v, uint256 nextIdx, bytes32 nextSeed)
    {
        seed = keccak256(abi.encode(seed, idx)); // per-cursor domain separation
        uint256 accepted = (type(uint256).max / n) * n; // largest multiple of n
        while (true) {
            uint256 x = uint256(seed);
            // Only the band [0, accepted) is an exact multiple of n, so `% n` there
            // is uniform. Rejecting outside it removes modulo bias entirely.
            if (x < accepted) return (x % n, idx + 1, seed);
            seed = keccak256(abi.encode(seed));
        }
    }

    /// @dev Draw the pot multiplier index from the weight table (weight in bps).
    function _drawPot(bytes32 randomness) internal view returns (uint256 potBps) {
        (uint256 r, , ) = _drawRange(randomness, 0, BPS_DEN);
        uint256 acc;
        for (uint256 i; i < M_BPS.length; ++i) {
            acc += M_W_BPS[i];
            if (r < acc) return M_BPS[i];
        }
        return M_BPS[M_BPS.length - 1];
    }

    // ------------------------------------------------------------ ICasinoGameV2
    function quoteCaps(uint256 wager, bytes calldata gameData)
        external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit)
    {
        if (gameData.length != 0) revert Hongbao__BadGameData();
        maxEscrowStake = wager;
        uint256 maxPayout = _maxPayout(wager);
        maxReservedProfit = maxPayout > wager ? maxPayout - wager : 0;
    }

    function quoteRiskParams(uint256 wager, bytes calldata gameData)
        external view returns (uint256 maxPayout, uint256 probabilityWad, uint256 expectedPayout, uint256 subJackpotVarianceScaled)
    {
        if (gameData.length != 0) revert Hongbao__BadGameData();
        maxPayout = _maxPayout(wager);
        // P(any payout > 0) is at most P(first envelope is red) = 5/6.
        // P(payout > 0) <= P(first envelope is red) = 5/6 = 0.8333...e18 (<= 1e18).
        probabilityWad = 833_333_333_333_333_334;
        expectedPayout = (wager * 947) / 1_000; // declared RTP 94.7%
        subJackpotVarianceScaled = 0;
    }

    function onSessionStart(SessionContext calldata ctx)
        external pure returns (StepResult memory stepResult)
    {
        if (ctx.gameData.length != 0) revert Hongbao__BadGameData();
        uint256 maxPayout = _maxPayout(ctx.wagerBase);
        stepResult.newGameState = abi.encode(HongbaoState({pot: 0, remaining: 0, banked: 0, opened: 0}));
        stepResult.escrowDelta = 0;
        stepResult.reservedProfitDelta = int256(maxPayout > ctx.wagerBase ? maxPayout - ctx.wagerBase : 0);
        stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS; // draw #1: the pot
        stepResult.requestRandomnessNow = true;
        stepResult.payout = 0;
    }

    function onPlayerAction(SessionContext calldata ctx, bytes calldata actionData)
        external pure returns (StepResult memory stepResult)
    {
        if (ctx.gameState.length == 0) revert Hongbao__BadPhase();
        HongbaoState memory s = abi.decode(ctx.gameState, (HongbaoState));
        if (actionData.length != 32) revert Hongbao__BadAction();
        bool keep = abi.decode(actionData, (OpenAction)).keep;

        if (keep) {
            if (s.banked == 0) revert Hongbao__NothingBanked();
            // KEEP: settle with the banked grabs. Reserve is released by the facet.
            stepResult.newGameState = abi.encode(s);
            stepResult.escrowDelta = 0;
            stepResult.reservedProfitDelta = 0; // never release on the settling step
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.requestRandomnessNow = false;
            stepResult.payout = s.banked;
        } else {
            // OPEN the next envelope: needs fresh randomness (white hazard + grab).
            if (s.opened >= ENVELOPES - 1) revert Hongbao__BadAction();
            stepResult.newGameState = abi.encode(s);
            stepResult.escrowDelta = 0;
            stepResult.reservedProfitDelta = 0;
            stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
            stepResult.requestRandomnessNow = true;
            stepResult.payout = 0;
        }
    }

    function onRandomness(SessionContext calldata ctx, bytes32 randomness)
        external view returns (StepResult memory stepResult)
    {
        HongbaoState memory s = abi.decode(ctx.gameState, (HongbaoState));

        if (s.opened == 0 && s.pot == 0) {
            // Draw #1: the dragon's pot for this round.
            s.pot = (ctx.wagerBase * _drawPot(randomness)) / BPS_DEN;
            if (s.pot == 0) {
                // Degenerate wager: rounds to zero. Settle immediately, pay nothing.
                stepResult.newGameState = abi.encode(s);
                stepResult.escrowDelta = 0;
                stepResult.reservedProfitDelta = 0;
                stepResult.nextPhase = SessionPhase.SETTLED;
                stepResult.requestRandomnessNow = false;
                stepResult.payout = 0;
                return stepResult;
            }
            s.remaining = s.pot;
            stepResult.newGameState = abi.encode(s);
            stepResult.escrowDelta = 0;
                stepResult.reservedProfitDelta = 0;
            stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
            stepResult.requestRandomnessNow = false;
            stepResult.payout = 0;
            return stepResult;
        }

        // Draw #(k+1): open envelope k = s.opened + 1.
        uint256 k = s.opened + 1;
        (uint256 r, uint256 nextIdx, ) = _drawRange(randomness, 0, ENVELOPES + 1 - k);

        if (r == 0) {
            // The white envelope (白包): grabs return to the sender.
            stepResult.newGameState = abi.encode(s);
            stepResult.escrowDelta = 0;
            stepResult.reservedProfitDelta = 0;
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.requestRandomnessNow = false;
            stepResult.payout = 0;
            return stepResult;
        }

        // Red envelope: grab v in [45%, 85%] of what remains on the table.
        uint256 lo = (s.remaining * GRAB_LO_BPS) / BPS_DEN;
        uint256 hi = (s.remaining * GRAB_HI_BPS) / BPS_DEN;
        if (hi <= lo) hi = lo; // tiny remainders: whole-range degenerate grab
        uint256 span = hi - lo + 1;
        (uint256 j, , ) = _drawRange(randomness, nextIdx, span);
        uint256 v = lo + j;

        s.banked += v;
        s.remaining = s.remaining > v ? s.remaining - v : 0;
        s.opened = uint8(k);

        if (s.opened == ENVELOPES - 1) {
            // All five reds opened; the sixth is certainly the white one. Auto-settle.
            stepResult.newGameState = abi.encode(s);
            stepResult.escrowDelta = 0;
            stepResult.reservedProfitDelta = 0;
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.requestRandomnessNow = false;
            stepResult.payout = s.banked;
            return stepResult;
        }

        stepResult.newGameState = abi.encode(s);
        stepResult.escrowDelta = 0;
        stepResult.reservedProfitDelta = 0;
        stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
        stepResult.requestRandomnessNow = false;
        stepResult.payout = 0;
    }

    /// @notice Mines-style true cash-out: the banked grabs are fully determined by
    ///         already-revealed state, so abandoned sessions pay them (minus the
    ///         facet's 10% forfeit cut).
    function quoteForfeitPayout(SessionContext calldata ctx) external pure returns (uint256) {
        if (ctx.gameState.length == 0) return 0;
        HongbaoState memory s = abi.decode(ctx.gameState, (HongbaoState));
        return s.banked;
    }
}
