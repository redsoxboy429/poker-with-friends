// ============================================================
// Drawmaha High Game
// ============================================================
// Draw side: 5-card high poker (higher hand wins)
// Omaha side: PLO high using exactly 2 hole + 3 board cards
// Split pot: 50% to best draw hand, 50% to best Omaha hand
//
// Betting structure determined by config (Limit, Pot-Limit, No-Limit)

import { BaseDrawmahaGame } from './drawmaha-base.js';
import {
  PlayerState,
  TableConfig,
  HandResult,
  Card,
} from '../types.js';
import {
  bestHighHand,
  combinations,
  evaluate5CardHigh,
} from '../evaluator.js';

/**
 * Drawmaha High: 5-card high draw + PLO high (2+3) split
 */
export class DrawmahaHighGame extends BaseDrawmahaGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const dmConfig: TableConfig = {
      ...config,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(dmConfig, players, buttonIndex);
  }

  protected evaluateDrawHand(player: PlayerState): HandResult {
    // 5-card high: just the best 5-card high poker hand
    return bestHighHand(player.holeCards);
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
