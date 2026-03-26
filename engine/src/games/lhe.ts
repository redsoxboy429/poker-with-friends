// ============================================================
// Limit Hold'em Game Engine
// ============================================================
// 2 hole cards, 5 community cards (flop/turn/river).
// Fixed-limit betting structure: small bet on preflop/flop,
// big bet on turn/river.

import { BaseFlopGame } from './flop-base.js';
import {
  HandResult,
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
} from '../types.js';
import { bestHighHand } from '../evaluator.js';

export class LHEGame extends BaseFlopGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const lheConfig: TableConfig = {
      ...config,
      variant: GameVariant.LimitHoldem,
      bettingStructure: BettingStructure.FixedLimit,
      // Default small/big bet to blind values if not explicitly set
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? (config.bigBlind * 2),
    };
    super(lheConfig, players, buttonIndex);
  }

  protected getHoleCardCount(): number {
    return 2;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // Best 5 of 7 (2 hole + 5 board) — identical to NLH
    const allCards = [...player.holeCards, ...this.state.communityCards];
    return bestHighHand(allCards);
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    if (!player) return null;
    const allCards = [...player.holeCards, ...this.state.communityCards];
    if (allCards.length >= 5) {
      const result = bestHighHand(allCards);
      return { description: result.description, cards: result.cards };
    }
    return null;
  }
}
