// ============================================================
// State Filtering — getPlayerView()
// ============================================================
// The engine's getState() returns ALL hole cards. For multiplayer,
// each client must only see their own cards + publicly visible info.

import { GamePhase } from 'poker-engine';
import type { HandState, Card } from 'poker-engine';
import type { PlayerView, PlayerStateView } from './types.js';

/** Stud game phases where card visibility matters */
const STUD_PHASES = new Set([
  GamePhase.BettingThird,
  GamePhase.BettingFourth,
  GamePhase.BettingFifth,
  GamePhase.BettingSixth,
  GamePhase.BettingSeventh,
]);

/** Viewer id that sees every hand (bot-table spectators only; no human is in those hands) */
export const REVEAL_ALL = '__reveal_all__';

/** Stud variants (have cardVisibility on players) */
const STUD_VARIANTS = new Set(['razz', 'stud', 'stud8']);

/** Check if game is at showdown (all non-folded hands visible) */
function isShowdown(phase: GamePhase): boolean {
  return phase === GamePhase.Showdown || phase === GamePhase.Complete;
}

/**
 * Filter the full game state for a specific player's view.
 * - Own cards: fully visible
 * - Opponent cards in flop/draw games: hidden during play, visible at showdown
 * - Opponent cards in stud games: 'up' cards visible, 'down' cards → null
 * - Folded players: always hidden
 */
export function getPlayerView(state: HandState, playerId: string): PlayerView {
  const isStud = STUD_VARIANTS.has(state.variant);
  const showAll = isShowdown(state.phase) && state.players.filter(p => !p.folded && !p.sittingOut).length > 1;

  const filteredPlayers: PlayerStateView[] = state.players.map(player => {
    // Own cards — always visible. A bot-table spectator sees everyone's.
    if (player.id === playerId || playerId === REVEAL_ALL) {
      return {
        ...player,
        holeCards: [...player.holeCards],
      };
    }

    // Folded players — always hidden
    if (player.folded) {
      return {
        ...player,
        holeCards: [],
      };
    }

    // Showdown — reveal all non-folded hands
    if (showAll) {
      return {
        ...player,
        holeCards: [...player.holeCards],
      };
    }

    // Stud games — show 'up' cards, hide 'down' cards with null placeholder
    if (isStud && player.cardVisibility) {
      const filteredCards: (Card | null)[] = player.cardVisibility.map((vis, i) =>
        vis === 'up' ? player.holeCards[i] : null
      );
      return {
        ...player,
        holeCards: filteredCards,
      };
    }

    // Flop/draw games during play — hide all opponent cards
    // But send null placeholders so client knows card count (for draw games)
    return {
      ...player,
      holeCards: player.holeCards.map(() => null),
    };
  });

  return {
    ...state,
    players: filteredPlayers,
    // Strip action history of discard indices (reveals what opponents discarded)
    actionHistory: state.actionHistory.map(action => {
      if (action.playerId === playerId) return action;
      // Hide which cards opponents discarded, but not how many (that is public at a real table)
      if (action.discardIndices) {
        return { ...action, discardIndices: undefined, discardCount: action.discardIndices.length };
      }
      return action;
    }),
  };
}
