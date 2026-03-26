// ============================================================
// Drawmaha A-5 Game
// ============================================================
// Draw side: A-5 lowball (lower hand wins, aces low)
// Omaha side: PLO high using exactly 2 hole + 3 board cards
// Split pot: 50% to best A-5 draw hand, 50% to best Omaha hand
//
// Betting structure determined by config

import { BaseDrawmahaGame } from './drawmaha-base.js';
import {
  PlayerState,
  TableConfig,
  HandResult,
  Card,
} from '../types.js';
import {
  bestLowHand,
  combinations,
  evaluate5CardHigh,
} from '../evaluator.js';

/**
 * Drawmaha A-5: A-5 lowball draw + PLO high (2+3) split
 */
export class DrawmahaA5Game extends BaseDrawmahaGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const dmConfig: TableConfig = {
      ...config,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(dmConfig, players, buttonIndex);
  }

  protected evaluateDrawHand(player: PlayerState): HandResult {
    // A-5 lowball: lower value is better
    // Invert so higher value = better (for engine comparison)
    const low = bestLowHand(player.holeCards);
    return {
      category: 0,
      value: 1_000_000_000 - low.value,
      cards: low.cards,
      description: low.description,
    };
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
