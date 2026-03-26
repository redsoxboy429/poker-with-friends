import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateBadugi, bestLowHand } from '../evaluator.js';

export class BadaceyGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const badaceyConfig: TableConfig = {
      ...config,
      variant: GameVariant.Badacey,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(badaceyConfig, players, buttonIndex, 3);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    // Ace-low badugi (ace is low/best, nut = A-2-3-4 rainbow)
    return evaluateBadugi(player.holeCards, true);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    // A-5 lowball (always qualifies)
    return bestLowHand(player.holeCards);
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  /** Show both badugi and A-5 low evaluations */
  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const badugi = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      const desc = `${badugi.description} (badugi) / ${low?.description ?? 'no low'} (low)`;
      return { description: desc, cards: badugi.cards };
    } catch {
      return null;
    }
  }
}
