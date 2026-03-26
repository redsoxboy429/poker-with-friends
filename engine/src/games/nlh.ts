// ============================================================
// No-Limit Hold'em Game Engine
// ============================================================
// 2 hole cards, 5 community cards (flop/turn/river).
// No-limit betting structure. Blinds, optional ante.

import { BaseFlopGame } from './flop-base.js';
import {
  HandResult,
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
} from '../types.js';
import { bestHighHand } from '../evaluator.js';

export class NLHGame extends BaseFlopGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const nlhConfig: TableConfig = {
      ...config,
      variant: GameVariant.NLH,
      bettingStructure: BettingStructure.NoLimit,
    };
    super(nlhConfig, players, buttonIndex);
  }

  protected getHoleCardCount(): number {
    return 2;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // Best 5 of 7 (2 hole + 5 board)
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
    return null; // Pre-flop: no meaningful hand to show
  }
}
