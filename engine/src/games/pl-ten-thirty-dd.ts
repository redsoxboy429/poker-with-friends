import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateHighPips, evaluateLowPips } from '../evaluator.js';

/**
 * PL 10-30 Double Draw: 5-card, pot-limit, 2 draws.
 * Pip split: high ≥30 / low ≤10 qualifiers.
 */
export class PLTenThirtyDDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({ ...config, bettingStructure: BettingStructure.PotLimit }, players, buttonIndex, 2);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateHighPips(player.holeCards, 30);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    return evaluateLowPips(player.holeCards, 10);
  }

  protected override isHiLoGame(): boolean { return true; }
  protected override hasHighQualifier(): boolean { return true; }

  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const high = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      return { description: `${high.description} / ${low?.description ?? 'no low'}`, cards: high.cards };
    } catch { return null; }
  }
}
