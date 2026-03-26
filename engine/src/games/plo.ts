// ============================================================
// Pot-Limit Omaha Game Engine
// ============================================================
// 4 hole cards, 5 community cards.
// MUST use exactly 2 hole cards + 3 board cards.
// Pot-limit betting structure.

import { BaseFlopGame } from './flop-base.js';
import {
  HandResult,
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
} from '../types.js';
import { bestPLOHighHand } from '../evaluator.js';

export class PLOGame extends BaseFlopGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const ploConfig: TableConfig = {
      ...config,
      variant: GameVariant.PLO,
      bettingStructure: BettingStructure.PotLimit,
    };
    super(ploConfig, players, buttonIndex);
  }

  protected getHoleCardCount(): number {
    return 4;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // PLO: MUST use exactly 2 hole cards + 3 board cards
    return bestPLOHighHand(player.holeCards, this.state.communityCards);
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    if (!player) return null;
    if (this.state.communityCards.length >= 3 && player.holeCards.length === 4) {
      const result = bestPLOHighHand(player.holeCards, this.state.communityCards);
      return { description: result.description, cards: result.cards };
    }
    return null;
  }
}
