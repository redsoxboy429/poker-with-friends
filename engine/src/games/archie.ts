import { BaseDrawGame } from './draw-base.js';
import {
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
  HandResult,
  LowHandResult,
  HandCategory,
  Card,
} from '../types.js';
import { evaluate5CardHigh, bestEightOrBetterLow } from '../evaluator.js';

/**
 * Archie: 5-card triple draw, hi-lo split with two qualifiers.
 *
 * HIGH side: standard poker hand ranking, must be pair of 9s or better.
 * LOW side: A-5 lowball, must be 8-or-better.
 *
 * Split logic (handled by BaseGame.resolveQualifiedHiLoPot):
 *   - Both sides qualify → split pot 50/50
 *   - Only high qualifies → high scoops
 *   - Only low qualifies → low scoops
 *   - Neither qualifies → chop among all remaining players
 */
export class ArchieGame extends BaseDrawGame {
  // Minimum high value for pair of 9s (category=1, pair rank=9, worst kickers)
  private static readonly PAIR_OF_NINES_MIN = HandCategory.OnePair * 10_000_000_000 + 31322;

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const archieConfig: TableConfig = {
      ...config,
      variant: GameVariant.Archie,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(archieConfig, players, buttonIndex, 3);
  }

  /** High hand evaluation — standard poker, but value=0 if below pair of 9s */
  protected override evaluateHand(player: PlayerState): HandResult {
    const high = evaluate5CardHigh(player.holeCards);
    if (high.value < ArchieGame.PAIR_OF_NINES_MIN) {
      return {
        category: 0,
        value: 0,
        cards: high.cards,
        description: `${high.description} (no high)`,
      };
    }
    return high;
  }

  /** Low hand evaluation — A-5 lowball, 8-or-better qualifier */
  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    const low = bestEightOrBetterLow(player.holeCards);
    if (!low) {
      return { value: Infinity, cards: player.holeCards.slice(0, 5), description: 'no low', qualified: false };
    }
    return low;
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  protected override hasHighQualifier(): boolean {
    return true;
  }

  /** Show both high and low evaluations */
  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const high = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      const lowDesc = low?.qualified ? low.description : 'no low';
      return {
        description: `${high.description} / ${lowDesc}`,
        cards: high.cards,
      };
    } catch {
      return null;
    }
  }
}
