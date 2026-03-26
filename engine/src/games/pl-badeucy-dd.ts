import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateBadugi, best27LowHand } from '../evaluator.js';

/**
 * PL Badeucy Double Draw: 5-card, pot-limit, 2 draws.
 * Hi-lo split: deuce-low badugi (high) + 2-7 lowball (low).
 */
export class PLBadeucyDDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({ ...config, bettingStructure: BettingStructure.PotLimit }, players, buttonIndex, 2);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateBadugi(player.holeCards, false); // deuce-low
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    return best27LowHand(player.holeCards);
  }

  protected override isHiLoGame(): boolean { return true; }

  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const badugi = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      return { description: `${badugi.description} (badugi) / ${low?.description ?? '—'} (low)`, cards: badugi.cards };
    } catch { return null; }
  }
}
