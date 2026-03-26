import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateBadugi, best27LowHand } from '../evaluator.js';

export class BadeucyGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const badeucyConfig: TableConfig = {
      ...config,
      variant: GameVariant.Badeucy,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(badeucyConfig, players, buttonIndex, 3);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    // Deuce-low badugi (ace is high/worst, nut = 2-3-4-5 rainbow)
    return evaluateBadugi(player.holeCards, false);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    // 2-7 lowball (always qualifies)
    return best27LowHand(player.holeCards);
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  /** Show both badugi and 2-7 low evaluations */
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
