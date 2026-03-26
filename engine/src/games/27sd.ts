// ============================================================
// 2-7 No-Limit Single Draw
// ============================================================
// Rules:
// - 5 hole cards, 1 draw opportunity
// - No-limit betting (2 rounds: pre-draw and post-draw)
// - 2-7 lowball hand evaluation (aces high, straights/flushes bad)
// - Best hand: 2-3-4-5-7 unsuited
//
// Strategy: A wheel (A-2-3-4-5) in 2-7 is actually one of the worst hands
// because the ace plays high.

import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult } from '../types.js';
import { best27LowHand } from '../evaluator.js';

/**
 * 2-7 No-Limit Single Draw
 */
export class TwoSevenSDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const sdConfig: TableConfig = {
      ...config,
      variant: GameVariant.TwoSevenSD,
      bettingStructure: BettingStructure.NoLimit,
    };
    super(sdConfig, players, buttonIndex, 1); // 1 draw
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // 2-7 lowball: lower value = better hand
    // We need to invert for the base engine (which expects higher value = better)
    const low = best27LowHand(player.holeCards);
    return {
      category: 0, // Not meaningful for lowball
      value: 1_000_000_000 - low.value, // Invert: lower raw value → higher engine value = wins
      cards: low.cards,
      description: low.description,
    };
  }
}
