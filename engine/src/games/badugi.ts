import { BaseDrawGame } from './draw-base.js';
import { PlayerState, TableConfig, GameVariant, BettingStructure, HandResult, Card } from '../types.js';
import { evaluateBadugi } from '../evaluator.js';

export class BadugiGame extends BaseDrawGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const badugiConfig: TableConfig = {
      ...config,
      variant: GameVariant.Badugi,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    };
    super(badugiConfig, players, buttonIndex, 3);
  }

  protected override getInitialCardCount(): number {
    return 4;
  }

  protected override evaluateHand(player: PlayerState): HandResult {
    return evaluateBadugi(player.holeCards, true); // ace-low
  }

  /** Override: Badugi only has 4 cards, so base class's 5-card check fails */
  override getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 4) return null;
    try {
      const result = this.evaluateHand(player);
      return { description: result.description, cards: result.cards };
    } catch {
      return null;
    }
  }
}
