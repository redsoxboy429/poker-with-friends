import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult, LowHandResult, Card } from '../types.js';
import { evaluateHighPips, evaluateLowPips } from '../evaluator.js';

/**
 * 10-30 Draw: 5-card triple draw, pip split.
 *
 * HIGH side: pip count ≥ 30 qualifies. Face cards = 0, Ace = 1, 2-10 = face value.
 * LOW side: pip count ≤ 10 qualifies.
 *
 * Split logic (handled by BaseGame.resolveQualifiedHiLoPot):
 *   - Both sides qualify → split pot 50/50
 *   - Only high qualifies → high scoops
 *   - Only low qualifies → low scoops
 *   - Neither qualifies → chop among all remaining players
 */
export class TenThirtyGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const ttConfig: TableConfig = {
      ...config,
      variant: GameVariant.TenThirtyDraw,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(ttConfig, players, buttonIndex, 3);
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateHighPips(player.holeCards, 30);
  }

  protected override evaluateLowHand(player: PlayerState): LowHandResult | null {
    return evaluateLowPips(player.holeCards, 10);
  }

  protected override isHiLoGame(): boolean {
    return true;
  }

  protected override hasHighQualifier(): boolean {
    return true;
  }

  /** Show both high pips and low pips evaluations */
  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) return null;
    try {
      const high = this.evaluateHand(player);
      const low = this.evaluateLowHand(player);
      const desc = `${high.description} / ${low?.description ?? 'no low'}`;
      return { description: desc, cards: high.cards };
    } catch {
      return null;
    }
  }
}
