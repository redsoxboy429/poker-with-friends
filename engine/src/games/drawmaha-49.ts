// ============================================================
// Drawmaha 49 Game
// ============================================================
// Draw side: 49 pip count (closest to 49 pips wins)
// - Pip counting: Face cards = 0, Ace = 1, 2-10 = face value
// - Best draw hand = 10-10-10-10-9 = 49 pips
// Omaha side: PLO high using exactly 2 hole + 3 board cards
// Split pot: 50% to closest-to-49, 50% to best Omaha hand
//
// Betting structure determined by config (usually Limit)

import { BaseDrawmahaGame } from './drawmaha-base.js';
import {
  PlayerState,
  TableConfig,
  HandResult,
  Card,
} from '../types.js';
import {
  bestPipCountHand,
  combinations,
  evaluate5CardHigh,
} from '../evaluator.js';

/**
 * Drawmaha 49: Closest-to-49-pips draw + PLO high (2+3) split
 */
export class Drawmaha49Game extends BaseDrawmahaGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const dmConfig: TableConfig = {
      ...config,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(dmConfig, players, buttonIndex);
  }

  protected evaluateDrawHand(player: PlayerState): HandResult {
    // Closest to 49 pips: returns a HandResult where value represents
    // "distance from 49" (lower distance = better, but evaluator expects higher=better)
    // bestPipCountHand already inverts this for us
    return bestPipCountHand(player.holeCards, 49);
  }

  protected evaluateOmahaHand(player: PlayerState, boardCards: Card[]): HandResult {
    if (boardCards.length < 3) {
      return { category: 0, value: 0, cards: [], description: 'No board' };
    }
    // PLO-style with 5 hole cards: best 2 hole + 3 board
    return bestPLOStyleHand(player.holeCards, boardCards);
  }
}

/**
 * Helper: evaluate best hand using exactly 2 hole cards + 3 board cards.
 * Works with any number of hole cards (Drawmaha uses 5).
 */
function bestPLOStyleHand(holeCards: Card[], boardCards: Card[]): HandResult {
  const holeCombos = combinations(holeCards, 2);
  const boardCombos = combinations(boardCards.slice(0, 5), 3); // Use up to 5 board cards
  let best: HandResult | null = null;

  for (const hole of holeCombos) {
    for (const board of boardCombos) {
      const result = evaluate5CardHigh([...hole, ...board]);
      if (!best || result.value > best.value) {
        best = result;
      }
    }
  }

  return best ?? { category: 0, value: 0, cards: [], description: 'No hand' };
}
