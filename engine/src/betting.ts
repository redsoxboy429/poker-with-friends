// ============================================================
// Betting Logic
// ============================================================
// Handles bet validation and available actions for all three
// betting structures: no-limit, pot-limit, and fixed-limit.

import {
  BettingStructure,
  type PlayerState,
  type AvailableActions,
  type HandState,
  GamePhase,
  CHIP_UNIT,
} from './types.js';

const BETTING_PHASES = new Set([
  GamePhase.BettingPreflop, GamePhase.BettingFlop, GamePhase.BettingTurn,
  GamePhase.BettingRiver, GamePhase.BettingThird, GamePhase.BettingFourth,
  GamePhase.BettingFifth, GamePhase.BettingSixth, GamePhase.BettingSeventh,
  GamePhase.BettingPostDraw1, GamePhase.BettingPostDraw2, GamePhase.BettingPostDraw3,
  GamePhase.BettingAfterDraw,
]);

/**
 * Calculate the current pot size including all bets on the table.
 */
export function calculatePotTotal(state: HandState): number {
  const potTotal = state.pots.reduce((sum, p) => sum + p.amount, 0);
  const tableBets = state.players.reduce((sum, p) => sum + p.bet, 0);
  return potTotal + tableBets;
}

/**
 * Calculate the maximum pot-limit raise.
 * In pot-limit: max raise = pot + all bets + call amount.
 * The "raise to" amount is: call + (pot after calling).
 */
export function calculatePotLimitMax(state: HandState, player: PlayerState): number {
  const pot = calculatePotTotal(state);
  const callAmount = state.currentBet - player.bet;
  // Pot after calling = current pot + call
  const potAfterCall = pot + callAmount;
  // Max raise TO = call + pot after call
  return callAmount + potAfterCall;
}

/**
 * Get available actions for the active player.
 */
export function getAvailableActions(state: HandState): AvailableActions {
  const player = state.players[state.activePlayerIndex];
  if (!BETTING_PHASES.has(state.phase) || !player || player.folded || player.allIn || player.sittingOut) {
    return {
      canFold: false, canCheck: false, canCall: false, callAmount: 0,
      canBet: false, minBet: 0, maxBet: 0,
      canRaise: false, minRaise: 0, maxRaise: 0,
    };
  }

  const effectiveStack = player.chips; // What they have left to put in
  const toCall = state.currentBet - player.bet;
  const facingBet = toCall > 0;

  // Can always fold if facing a bet
  let canFold = facingBet;

  // Can check if not facing a bet
  let canCheck = !facingBet;

  // Can call if facing a bet and have chips
  const canCall = facingBet && effectiveStack > 0;
  const callAmount = Math.min(toCall, effectiveStack);

  // Betting/raising depends on the structure
  let canBet = false;
  let minBet = 0;
  let maxBet = 0;
  let canRaise = false;
  let minRaise = 0;
  let maxRaise = 0;
  let betOptions: number[] | undefined;
  let raiseOptions: number[] | undefined;

  switch (state.bettingStructure) {
    case BettingStructure.NoLimit: {
      if (!facingBet) {
        // Can open bet: minimum is big blind
        canBet = effectiveStack > 0;
        minBet = Math.min(state.bigBlind, effectiveStack);
        maxBet = effectiveStack; // All-in
      } else {
        // Can raise: min raise = last raise size (or big blind if no raise yet)
        const raiseIncrement = Math.max(state.lastRaise, state.bigBlind);
        const minRaiseTo = state.currentBet + raiseIncrement;
        canRaise = effectiveStack > toCall; // Must have more than call amount
        minRaise = Math.min(minRaiseTo, player.bet + effectiveStack); // Can always all-in
        maxRaise = player.bet + effectiveStack; // All-in (raise TO this amount)
      }
      break;
    }

    case BettingStructure.PotLimit: {
      const potMax = calculatePotLimitMax(state, player);
      if (!facingBet) {
        canBet = effectiveStack > 0;
        minBet = Math.min(state.bigBlind, effectiveStack);
        maxBet = Math.min(potMax, effectiveStack);
      } else {
        const raiseIncrement = Math.max(state.lastRaise, state.bigBlind);
        const minRaiseTo = state.currentBet + raiseIncrement;
        const maxRaiseTo = player.bet + potMax;
        canRaise = effectiveStack > toCall;
        minRaise = Math.min(minRaiseTo, player.bet + effectiveStack);
        maxRaise = Math.min(maxRaiseTo, player.bet + effectiveStack);
      }
      break;
    }

    case BettingStructure.FixedLimit: {
      // Fixed limit: bet/raise is always the fixed increment
      // Small bet on early streets, big bet on later streets
      const increment = getFixedLimitIncrement(state);
      // Cap at 4 bets per round (1 bet + 3 raises), but ONLY in multiway pots.
      // A round that STARTS heads-up is uncapped (docs/NINE-GAME-RULES.md §3).
      const betsThisRound = countBetsThisRound(state);
      const isHeadsUp = state.playersAtStreetStart <= 2;
      const atCap = !isHeadsUp && betsThisRound >= 4;
      const allInTo = player.bet + effectiveStack;
      const sizes = (amounts: number[], cap: number) =>
        [...new Set(amounts.map(a => Math.min(a, cap)))].sort((a, b) => a - b);

      if (state.pendingBringIn) {
        // Stud bring-in: post the bring-in or complete to the small bet.
        // It is forced, so there is no check or fold.
        canCheck = false;
        canFold = false;
        canBet = effectiveStack > 0;
        betOptions = sizes([state.bringIn, state.smallBet], effectiveStack);
        minBet = betOptions[0];
        maxBet = betOptions[betOptions.length - 1];
      } else if (!facingBet) {
        canBet = effectiveStack > 0 && !atCap;
        minBet = Math.min(increment, effectiveStack);
        maxBet = minBet; // Fixed: only one size
        if (openPairChoice(state)) {
          betOptions = sizes([state.smallBet, state.bigBet], effectiveStack);
          maxBet = betOptions[betOptions.length - 1];
        }
      } else if (!atCap) {
        // If currentBet is below the increment (bring-in or a short all-in), the
        // first "raise" is a completion TO the bet, not currentBet + increment.
        const raiseTo = state.currentBet < increment
          ? increment                        // Complete to the small bet
          : state.currentBet + increment;     // Normal raise by one increment
        canRaise = effectiveStack > toCall;
        minRaise = Math.min(raiseTo, allInTo);
        maxRaise = minRaise; // Fixed: only one size
        if (openPairChoice(state) && state.currentBet >= state.smallBet) {
          raiseOptions = sizes([state.currentBet + state.smallBet, state.currentBet + state.bigBet], allInTo);
          maxRaise = raiseOptions[raiseOptions.length - 1];
        }
      }

      // An all-in of less than half a bet does not reopen the betting for a
      // player who has already acted this round (Robert's Rules; spec §3).
      if (canRaise) {
        const round = state.actionHistory.slice(state.phaseStartActionIndex);
        let lastOwn = -1;
        round.forEach((a, i) => { if (a.playerId === player.id && a.betLevel !== undefined) lastOwn = i; });
        if (lastOwn >= 0) {
          const reopened = round.slice(lastOwn + 1)
            .some(a => (a.type === 'bet' || a.type === 'raise') && a.fullRaise !== false);
          if (!reopened) canRaise = false;
        }
      }
      break;
    }
  }

  if (state.bettingStructure !== BettingStructure.FixedLimit) {
    const last = [...state.actionHistory.slice(state.phaseStartActionIndex)].reverse()
      .find(a => a.playerId === player.id && a.betLevel !== undefined);
    // A short all-in does not reopen a player who already called or raised.
    // Multiple short raises reopen when their combined increase reaches a full raise.
    if (last && !(last.type === 'check' && last.betLevel === 0) &&
        state.currentBet - last.betLevel! < Math.max(state.lastRaise, state.bigBlind)) {
      canRaise = false;
      canBet = false;
    }
  }
  if (!state.players.some(p => p.id !== player.id && !p.folded && !p.sittingOut && !p.allIn && p.chips > 0)) {
    canBet = false;
    canRaise = false;
  }

  return {
    canFold, canCheck, canCall, callAmount,
    canBet, minBet, maxBet,
    canRaise, minRaise, maxRaise,
    ...(canBet && betOptions && betOptions.length > 1 ? { betOptions } : {}),
    ...(canRaise && raiseOptions && raiseOptions.length > 1 ? { raiseOptions } : {}),
  };
}

/** Stud high, 4th street, open pair showing, big bet not yet made: small or big bet. */
function openPairChoice(state: HandState): boolean {
  return !!state.openPairFourth && state.phase === GamePhase.BettingFourth && !state.bigBetInForce;
}

/**
 * Get the fixed-limit bet increment based on the current street.
 * Early streets use small bet, later streets use big bet.
 */
export function getFixedLimitIncrement(state: HandState): number {
  // For Hold'em: preflop/flop = small bet, turn/river = big bet
  // For Stud: 3rd/4th = small bet, 5th/6th/7th = big bet
  // For Draw: post-draw-1 = small bet, post-draw-2/3 = big bet
  const bigBetPhases = ['turn', 'river', 'fifth', 'sixth', 'seventh', 'post-draw-2', 'post-draw-3'];
  if (bigBetPhases.includes(state.phase)) {
    return state.bigBet;
  }
  // Stud high 4th street after an open-pair big bet: all raises are big bets
  if (state.phase === GamePhase.BettingFourth && state.bigBetInForce) {
    return state.bigBet;
  }
  return state.smallBet;
}

/**
 * Count how many bets/raises have occurred in the current betting round.
 * Only counts from phaseStartActionIndex onward (current street only).
 */
function countBetsThisRound(state: HandState): number {
  // Preflop (and the first round of draw games) the big blind is the opening bet.
  let count = state.phase === GamePhase.BettingPreflop && state.bigBlind > 0 ? 1 : 0;
  for (let i = state.phaseStartActionIndex; i < state.actionHistory.length; i++) {
    const action = state.actionHistory[i];
    // Short all-ins under half a bet are not raises for the cap.
    if ((action.type === 'bet' || action.type === 'raise') && action.fullRaise !== false) {
      count++;
    }
  }
  return count;
}

// ============================================================
// Pot Management
// ============================================================

import { type Pot } from './types.js';

/**
 * Collect bets from all players and create/update pots.
 * Handles side pot creation when players are all-in for different amounts.
 */
export function collectBets(
  players: PlayerState[],
  existingPots: Pot[],
  onUncalled?: (playerId: string, amount: number) => void,
): Pot[] {
  // An unmatched bet goes straight back to its bettor before any pot is built.
  // It was never called, so it is returned, not won (spec §3).
  const ordered = players.filter(p => p.bet > 0).sort((a, b) => b.bet - a.bet);
  if (ordered.length > 0) {
    const top = ordered[0];
    const uncalled = top.bet - (ordered[1]?.bet ?? 0);
    if (uncalled > 0) {
      top.bet -= uncalled;
      top.totalBet -= uncalled;
      top.chips += uncalled;
      if (top.allIn && top.chips > 0) top.allIn = false;
      onUncalled?.(top.id, uncalled);
    }
  }

  // Side pots are ONLY created by all-in differences, never by folds.
  // A folded player's money is dead in the pot — they just can't win it.
  // Eligibility here tracks who CAN win; folding is handled at showdown
  // (resolveShowdown filters by activePlayers).

  // Find all-in bet levels — these are the only levels that create side pots
  const allInLevels = players
    .filter(p => p.allIn && p.bet > 0)
    .map(p => p.bet);

  // Also need the max bet level to capture remaining money
  const maxBet = Math.max(...players.map(p => p.bet), 0);

  if (maxBet === 0) return existingPots;

  // Build unique sorted levels: each all-in amount + the max bet
  const levels = [...new Set([...allInLevels, maxBet])].sort((a, b) => a - b);

  const newPots: Pot[] = [...existingPots];
  let previousLevel = 0;

  for (const level of levels) {
    if (level <= previousLevel) continue;

    let potAmount = 0;
    const eligible: string[] = [];

    for (const player of players) {
      // Everyone contributes their share regardless of fold status
      const contribution = Math.min(player.bet, level) - Math.min(player.bet, previousLevel);
      if (contribution > 0) {
        potAmount += contribution;
      }
      // Eligible = not folded AND bet reaches this level (or all-in at exactly this level)
      if (!player.folded && !player.sittingOut && player.bet >= level) {
        eligible.push(player.id);
      } else if (!player.folded && !player.sittingOut && player.allIn && player.bet === level) {
        if (!eligible.includes(player.id)) {
          eligible.push(player.id);
        }
      }
    }

    if (potAmount <= 0) continue;

    // Merge into any existing pot with the same eligible set
    const matchingPot = newPots.find(p =>
      p.eligiblePlayerIds.length === eligible.length &&
      p.eligiblePlayerIds.every(id => eligible.includes(id))
    );
    if (matchingPot) {
      matchingPot.amount += potAmount;
    } else {
      newPots.push({ amount: potAmount, eligiblePlayerIds: eligible });
    }

    previousLevel = level;
  }

  // Reset player bets
  for (const player of players) {
    player.bet = 0;
  }

  // The uncalled excess was already returned above. A pot with a single
  // eligible player now only holds other players' dead money (folded chips
  // above an all-in); it stays a pot and is awarded at the end of the hand.
  return newPots.filter(p => p.amount > 0);
}

/**
 * Validate a player action and return the actual amounts.
 */
export function validateAction(
  state: HandState,
  playerId: string,
  actionType: string,
  amount?: number,
): { valid: boolean; error?: string; adjustedAmount?: number } {
  if (!BETTING_PHASES.has(state.phase)) {
    return { valid: false, error: 'Hand is not accepting betting actions' };
  }
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0)) {
    return { valid: false, error: 'Amount must be a finite nonnegative number' };
  }
  if (amount !== undefined && !Number.isInteger(amount / CHIP_UNIT)) {
    return { valid: false, error: `Amounts must be a multiple of ${CHIP_UNIT}` };
  }
  const player = state.players[state.activePlayerIndex];
  if (!player || player.id !== playerId) {
    return { valid: false, error: 'Not your turn' };
  }
  if (player.folded || player.allIn) {
    return { valid: false, error: 'Player cannot act (folded or all-in)' };
  }

  const available = getAvailableActions(state);

  switch (actionType) {
    case 'fold':
      if (!available.canFold) return { valid: false, error: 'Cannot fold (no bet to face)' };
      return { valid: true };

    case 'check':
      if (!available.canCheck) return { valid: false, error: 'Cannot check (facing a bet)' };
      return { valid: true };

    case 'call':
      if (!available.canCall) return { valid: false, error: 'Cannot call' };
      return { valid: true, adjustedAmount: available.callAmount };

    case 'bet':
      if (!available.canBet) return { valid: false, error: 'Cannot bet' };
      if (amount === undefined) return { valid: false, error: 'Bet amount required' };
      if (amount < available.minBet) return { valid: false, error: `Minimum bet is ${available.minBet}` };
      if (amount > available.maxBet) return { valid: false, error: `Maximum bet is ${available.maxBet}` };
      if (available.betOptions && !available.betOptions.includes(amount)) {
        return { valid: false, error: `Bet must be ${available.betOptions.join(' or ')}` };
      }
      return { valid: true, adjustedAmount: amount };

    case 'raise':
      if (!available.canRaise) return { valid: false, error: 'Cannot raise' };
      if (amount === undefined) return { valid: false, error: 'Raise amount required' };
      // amount is the "raise TO" amount
      if (amount < available.minRaise) return { valid: false, error: `Minimum raise is to ${available.minRaise}` };
      if (amount > available.maxRaise) return { valid: false, error: `Maximum raise is to ${available.maxRaise}` };
      if (available.raiseOptions && !available.raiseOptions.includes(amount)) {
        return { valid: false, error: `Raise must be to ${available.raiseOptions.join(' or ')}` };
      }
      return { valid: true, adjustedAmount: amount };

    default:
      return { valid: false, error: `Unknown action: ${actionType}` };
  }
}
