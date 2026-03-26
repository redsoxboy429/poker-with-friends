import { BaseFlopGame } from './flop-base.js';
import { HandResult, PlayerState, TableConfig, BettingStructure, Card } from '../types.js';
import { bestPLOHighHand } from '../evaluator.js';

/**
 * Limit Omaha High: 4 hole cards, must use exactly 2, fixed-limit betting.
 * Same hand evaluation as PLO — just different betting structure.
 */
export class LimitOmahaHighGame extends BaseFlopGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super({
      ...config,
      bettingStructure: BettingStructure.FixedLimit,
      smallBet: config.smallBet ?? config.bigBlind,
      bigBet: config.bigBet ?? config.bigBlind * 2,
    }, players, buttonIndex);
  }

  protected getHoleCardCount(): number {
    return 4;
  }

  protected evaluateHand(player: PlayerState): HandResult {
    return bestPLOHighHand(player.holeCards, this.state.communityCards);
  }

  protected override getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: Card[] } | null {
    if (!player) return null;
    if (this.state.communityCards.length >= 3 && player.holeCards.length === 4) {
      const result = bestPLOHighHand(player.holeCards, this.state.communityCards);
      return { description: result.description, cards: result.cards };
    }
    return null;
  }
}
