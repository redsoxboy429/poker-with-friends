import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, BettingStructure, HandResult, LowHandResult, HandCategory, Card } from '../types.js';
import { evaluate5CardHigh, bestEightOrBetterLow } from '../evaluator.js';

/**
 * PL Archie Double Draw: 5-card, pot-limit, 2 draws.
 * Hi-lo split with dual qualifiers: pair-of-9s+ high, 8-or-better low.
 */
export class PLArchieDDGame extends BaseDrawGame {
  private static readonly PAIR_OF_NINES_MIN = HandCategory.OnePair * 10_000_000_000 + 31322;

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({ ...config, bettingStructure: BettingStructure.PotLimit }, players, buttonIndex, 2);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    const high = evaluate5CardHigh(player.holeCards);
    if (high.value < PLArchieDDGame.PAIR_OF_NINES_MIN) {
      return { category: 0, value: 0, cards: high.cards, description: `${high.description} (no high)` };
    }
    return high;
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    const low = bestEightOrBetterLow(player.holeCards);
    if (!low) return { value: Infinity, cards: player.holeCards.slice(0, 5), description: 'no low', qualified: false };
    return low;
  }

  protected override isHiLoGame(): boolean { return true; }
  protected override hasHighQualifier(): boolean { return true; }

  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const high = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      const lowDesc = low?.qualified ? low.description : 'no low';
      return { description: `${high.description} / ${lowDesc}`, cards: high.cards };
    } catch { return null; }
  }
}
