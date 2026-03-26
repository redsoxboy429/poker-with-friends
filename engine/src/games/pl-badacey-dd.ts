import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateBadugi, bestLowHand } from '../evaluator.js';

/**
 * PL Badacey Double Draw: 5-card, pot-limit, 2 draws.
 * Hi-lo split: ace-low badugi (high) + A-5 lowball (low).
 */
export class PLBadaceyDDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({ ...config, bettingStructure: BettingStructure.PotLimit }, players, buttonIndex, 2);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateBadugi(player.holeCards, true); // ace-low
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    return bestLowHand(player.holeCards);
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
