import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, BettingStructure, HandResult, Card } from '../types.js';
import { evaluateBadugi } from '../evaluator.js';

/**
 * PL Badugi Double Draw: 4-card, pot-limit, 2 draws.
 * Same hand evaluation as limit Badugi (ace-low rainbow).
 */
export class PLBadugiDDGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({ ...config, bettingStructure: BettingStructure.PotLimit }, players, buttonIndex, 2);
  }

  protected override getInitialCardCount(): number {
    return 4;
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateBadugi(player.holeCards, true); // ace-low
  }

  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 4) return null;
    try {
      const result = this.evaluateHand(player);
      return { description: result.description, cards: result.cards };
    } catch { return null; }
  }
}
