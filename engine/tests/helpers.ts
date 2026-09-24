import { ActionType, type BaseGame } from '../src/index.js';

/**
 * Start a stud hand and have the bring-in player post the bring-in (the most
 * common choice). Tests about the bring-in decision itself call start() directly.
 */
export function startStud(game: BaseGame): void {
  game.start();
  const state = game.getState();
  if (state.pendingBringIn) {
    game.act(state.players[state.activePlayerIndex].id, ActionType.Bet, state.bringIn);
  }
}
