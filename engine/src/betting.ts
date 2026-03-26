// ============================================================
// Betting Logic
// ============================================================
// Handles bet validation and available actions for all three
// betting structures: no-limit, pot-limit, and fixed-limit.

import {
  BettingStructure,
  PlayerState,
  AvailableActions,
  HandState,
} from './types.js';

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
  if (!player) {
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
  const canFold = facingBet;

  // Can check if not facing a bet
  const canCheck = !facingBet;

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
      // Heads-up (2 players at street start) = uncapped.
      const betsThisRound = countBetsThisRound(state);
      const isHeadsUp = state.playersAtStreetStart <= 2;
      const atCap = !isHeadsUp && betsThisRound >= 4;

      if (!facingBet) {
        canBet = effectiveStack > 0 && !atCap;
        minBet = Math.min(increment, effectiveStack);
        maxBet = minBet; // Fixed: only one size
      } else if (!atCap) {
        // If currentBet is below the increment (bring-in), the first "raise"
        // is a completion TO the small bet, not currentBet + increment.
        const raiseTo = state.currentBet < increment
          ? increment                        // Complete to the small bet
          : state.currentBet + increment;     // Normal raise by one increment
        canRaise = effectiveStack > toCall;
        minRaise = Math.min(raiseTo, player.bet + effectiveStack);
        maxRaise = minRaise; // Fixed: only one size
      }
      break;
    }
  }

  return {
    canFold, canCheck, canCall, callAmount,
    canBet, minBet, maxBet,
    canRaise, minRaise, maxRaise,
  };
}

/**
 * Get the fixed-limit bet increment based on the current street.
 * Early streets use small bet, later streets use big bet.
 */
function getFixedLimitIncrement(state: HandState): number {
  // For Hold'em: preflop/flop = small bet, turn/river = big bet
  // For Stud: 3rd/4th = small bet, 5th/6th/7th = big bet
  // For Draw: post-draw-1 = small bet, post-draw-2/3 = big bet
  const bigBetPhases = ['turn', 'river', 'fifth', 'sixth', 'seventh', 'post-draw-2', 'post-draw-3'];
  if (bigBetPhases.includes(state.phase)) {
    return state.bigBet;
  }
  return state.smallBet;
}

/**
 * Count how many bets/raises have occurred in the current betting round.
 * Only counts from phaseStartActionIndex onward (current street only).
 */
function countBetsThisRound(state: HandState): number {
  let count = 0;
  for (let i = state.phaseStartActionIndex; i < state.actionHistory.length; i++) {
    const action = state.actionHistory[i];
    if (action.type === 'bet' || action.type === 'raise') {
      count++;
    }
  }
  return count;
}

// ============================================================
// Pot Management
// ============================================================

import { Pot } from './types.js';

/**
 * Collect bets from all players and create/update pots.
 * Handles side pot creation when players are all-in for different amounts.
 */
export function collectBets(players: PlayerState[], existingPots: Pot[]): Pot[] {
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

  // Filter out any pots with 0 or near-zero amount (floating point cleanup)
  return newPots.filter(p => p.amount > 0.001);
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
      return { valid: true, adjustedAmount: amount };

    case 'raise':
      if (!available.canRaise) return { valid: false, error: 'Cannot raise' };
      if (amount === undefined) return { valid: false, error: 'Raise amount required' };
      // amount is the "raise TO" amount
      if (amount < available.minRaise) return { valid: false, error: `Minimum raise is to ${available.minRaise}` };
      if (amount > available.maxRaise) return { valid: false, error: `Maximum raise is to ${available.maxRaise}` };
      return { valid: true, adjustedAmount: amount };

    default:
      return { valid: false, error: `Unknown action: ${actionType}` };
  }
}
