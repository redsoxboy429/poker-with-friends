// ============================================================
// 2-7 Limit Triple Draw
// ============================================================
// Rules:
// - 5 hole cards, 3 draw opportunities
// - Fixed-limit betting (4 betting rounds: pre-draw + 3 post-draw)
// - Bet sizes: small bet for first two rounds, big bet for last two
// - 2-7 lowball hand evaluation
// - Best hand: 2-3-4-5-7 unsuited

import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult } from '../types.js';
import { best27LowHand } from '../evaluator.js';

/**
 * 2-7 Limit Triple Draw
 */
export class TwoSevenTDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const tdConfig: TableConfig = {
      ...config,
      variant: GameVariant.TwoSevenTD,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(tdConfig, players, buttonIndex, 3); // 3 draws
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // 2-7 lowball: lower value = better hand
    // Invert for the base engine (higher value = better)
    const low = best27LowHand(player.holeCards);
    return {
      category: 0,
      value: 1_000_000_000 - low.value,
      cards: low.cards,
      description: low.description,
    };
  }
}
