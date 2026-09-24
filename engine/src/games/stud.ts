// ============================================================
// 7-Card Stud (High) Game Engine
// ============================================================
// Extends BaseStudGame with Stud High-specific rules:
// - Bring-in: lowest door card (deuce of clubs is worst)
// - First actor on streets: highest showing hand
// - Hand evaluation: standard high hand (best 5 of 7)

import { BaseStudGame } from './stud-base.js';
import {
  type HandResult,
  type PlayerState,
  type TableConfig,
  GameVariant,
} from '../types.js';
import { bestHighHand } from '../evaluator.js';

export class StudGame extends BaseStudGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const studConfig: TableConfig = {
      ...config,
      variant: GameVariant.Stud,
    };
    super(studConfig, players, buttonIndex);
  }

  protected getBringInPlayerIndex(): number {
    // Stud High: lowest door card brings in (aces are high = good)
    return this.findLowestDoorCard(true);
  }

  protected setFirstActorForStreet(): void {
    // In Stud High: highest showing hand acts first
    this.setFirstActorByShowing((a, b) => a > b, false);
  }

  protected override hasOpenPairOption(): boolean {
    return true;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    // Standard high hand: best 5 of 7
    return bestHighHand(player.holeCards);
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    if (!player || player.holeCards.length < 5) return null;
    const result = bestHighHand(player.holeCards);
    return { description: result.description, cards: result.cards };
  }
}
