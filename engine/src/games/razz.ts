// ============================================================
// Razz Game Engine (7-Card Stud Lowball, Ace-to-Five)
// ============================================================
// Extends BaseStudGame with Razz-specific rules:
// - Bring-in: highest door card (king is worst; aces are low)
// - First actor on streets: lowest showing hand
// - Hand evaluation: ace-to-five low (best hand = A-2-3-4-5)

import { BaseStudGame } from './stud-base.js';
import {
  HandResult,
  HandCategory,
  LowHandResult,
  PlayerState,
  TableConfig,
  GameVariant,
  Rank,
} from '../types.js';
import { bestLowHand } from '../evaluator.js';

/**
 * In Razz, the "hand value" for showdown comparison needs to use the low
 * evaluator. Since our base class expects HandResult, we wrap the low
 * result — lower low value maps to HIGHER HandResult value so the
 * base class's "highest value wins" logic works correctly.
 */
function lowToHighResult(low: LowHandResult): HandResult {
  return {
    category: HandCategory.HighCard, // Not meaningful for low
    value: 1_000_000_000 - low.value, // Invert: lower low = higher value
    cards: low.cards,
    description: low.description,
  };
}

export class RazzGame extends BaseStudGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const razzConfig: TableConfig = {
      ...config,
      variant: GameVariant.Razz,
    };
    super(razzConfig, players, buttonIndex);
  }

  protected getBringInPlayerIndex(): number {
    // Razz: highest door card brings in (aces are low)
    return this.findHighestDoorCard(true);
  }

  protected setFirstActorForStreet(): void {
    // In Razz: lowest showing hand acts first
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);

    let bestIdx = -1;
    let bestLowValue = Infinity;

    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      if (p.folded || p.sittingOut) continue;

      const value = this.getShowingHandValue(p.id, true);
      if (value < bestLowValue) {
        bestLowValue = value;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      this.state.activePlayerIndex = bestIdx;
    }
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // Razz: best ace-to-five low from 7 cards
    const low = bestLowHand(player.holeCards);
    return lowToHighResult(low);
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    if (!player || player.holeCards.length < 5) return null;
    // 5+ cards: can evaluate a low hand
    const low = bestLowHand(player.holeCards);
    return { description: low.description, cards: low.cards };
  }
}
