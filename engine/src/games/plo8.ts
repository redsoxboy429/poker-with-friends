// ============================================================
// Pot-Limit Omaha Hi-Lo (8-or-Better) Game Engine — "PLO8"
// ============================================================
// 4 hole cards, 5 community cards. Must use exactly 2 hole + 3 board.
// Pot-limit betting. Split pot: best high and best qualifying low.
// If no qualifying low, high hand scoops.

import { BaseFlopGame } from './flop-base.js';
import {
  HandResult,
  LowHandResult,
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
} from '../types.js';
import { bestPLOHighHand, bestPLOEightOrBetterLow } from '../evaluator.js';

export class PLO8Game extends BaseFlopGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const plo8Config: TableConfig = {
      ...config,
      variant: GameVariant.PLOHiLo,
      bettingStructure: BettingStructure.PotLimit,
    };
    super(plo8Config, players, buttonIndex);
  }

  protected getHoleCardCount(): number {
    return 4;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // PLO: must use exactly 2 hole cards + 3 board cards (high hand)
    return bestPLOHighHand(player.holeCards, this.state.communityCards);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    // PLO 8-or-better low: must use exactly 2 hole + 3 board
    return bestPLOEightOrBetterLow(player.holeCards, this.state.communityCards);
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    if (!player) return null;
    if (this.state.communityCards.length >= 3 && player.holeCards.length === 4) {
      const high = bestPLOHighHand(player.holeCards, this.state.communityCards);
      const low = bestPLOEightOrBetterLow(player.holeCards, this.state.communityCards);
      if (low) {
        return {
          description: `${high.description} / ${low.description}`,
          cards: high.cards,
        };
      }
      return { description: `${high.description} / no low`, cards: high.cards };
    }
    return null;
  }
}
