// ============================================================
// 7-Card Stud Hi-Lo (8-or-Better) Game Engine
// ============================================================
// Extends BaseStudGame with Stud Hi-Lo rules:
// - Bring-in: lowest door card (same as Stud High)
// - First actor on streets: highest showing hand
// - Hand evaluation: high hand AND 8-or-better low hand
// - Split pot: best high wins half, best qualifying low wins half
// - If no qualifying low, high hand scoops

import { BaseStudGame } from './stud-base.js';
import {
  type HandResult,
  type LowHandResult,
  type PlayerState,
  type TableConfig,
  GameVariant,
} from '../types.js';
import { bestHighHand, bestEightOrBetterLow } from '../evaluator.js';

export class StudHiLoGame extends BaseStudGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const studConfig: TableConfig = {
      ...config,
      variant: GameVariant.StudHiLo,
    };
    super(studConfig, players, buttonIndex);
  }

  protected getBringInPlayerIndex(): number {
    // Same as Stud High: lowest door card brings in
    return this.findLowestDoorCard(true);
  }

  protected setFirstActorForStreet(): void {
    // Same as Stud High: highest showing hand acts first
    this.setFirstActorByShowing((a, b) => a > b, false);
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // High hand: best 5 of 7
    return bestHighHand(player.holeCards);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    // 8-or-better low from 7 cards
    return bestEightOrBetterLow(player.holeCards);
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  override getHandDescription(playerId: string): { description: string; cards: import('../types.js').Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    const high = bestHighHand(player.holeCards);
    const low = bestEightOrBetterLow(player.holeCards);
    if (low) {
      return {
        description: `${high.description} / ${low.description}`,
        cards: high.cards,
      };
    }
    return { description: `${high.description} / no low`, cards: high.cards };
  }
}
