// ============================================================
// 7-Card Stud (High) Game Engine
// ============================================================
// Extends BaseStudGame with Stud High-specific rules:
// - Bring-in: lowest door card (deuce of clubs is worst)
// - First actor on streets: highest showing hand
// - Hand evaluation: standard high hand (best 5 of 7)

import { BaseStudGame } from './stud-base.js';
import {
  HandResult,
  PlayerState,
  TableConfig,
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
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);

    let bestIdx = -1;
    let bestHighValue = -1;

    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      if (p.folded || p.sittingOut) continue;

      const value = this.getShowingHandValue(p.id, false);
      if (value > bestHighValue) {
        bestHighValue = value;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      this.state.activePlayerIndex = bestIdx;
    }
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
