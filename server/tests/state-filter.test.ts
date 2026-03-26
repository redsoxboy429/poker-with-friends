import { describe, it, expect } from 'vitest';
import { getPlayerView } from '../src/state-filter.js';
import {
  NLHGame, RazzGame, TwoSevenTDGame, DrawmahaHighGame,
  GameVariant, BettingStructure, GamePhase, ActionType,
  type PlayerState, type HandState,
} from 'poker-engine';

function makePlayers(count: number): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player${i}`,
    chips: 1000,
    holeCards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
    seatIndex: i,
  }));
}

const NLH_CONFIG = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  startingChips: 1000, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit,
};

const RAZZ_CONFIG = {
  maxPlayers: 6, smallBlind: 0, bigBlind: 0, ante: 2, bringIn: 3,
  smallBet: 5, bigBet: 10, startingChips: 1000,
  variant: GameVariant.Razz, bettingStructure: BettingStructure.FixedLimit,
};

const TD_CONFIG = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  smallBet: 10, bigBet: 20, startingChips: 1000,
  variant: GameVariant.TwoSevenTD, bettingStructure: BettingStructure.FixedLimit,
};

describe('getPlayerView', () => {
  describe('Flop games (NLH)', () => {
    it('shows own hole cards, hides opponents during play', () => {
      const game = new NLHGame(NLH_CONFIG, makePlayers(3), 0);
      game.start();
      const state = game.getState();

      const p0View = getPlayerView(state, 'p0');

      // Own cards visible
      expect(p0View.players[0].holeCards).toHaveLength(2);
      expect(p0View.players[0].holeCards.every(c => c !== null)).toBe(true);

      // Opponents' cards are null placeholders (know count, not values)
      expect(p0View.players[1].holeCards).toHaveLength(2);
      expect(p0View.players[1].holeCards.every(c => c === null)).toBe(true);
      expect(p0View.players[2].holeCards).toHaveLength(2);
      expect(p0View.players[2].holeCards.every(c => c === null)).toBe(true);
    });

    it('reveals all hands at showdown', () => {
      const game = new NLHGame(NLH_CONFIG, makePlayers(2), 0);
      game.start();

      // Play to showdown: both players call/check through
      let state = game.getState();
      while (state.phase !== GamePhase.Showdown && state.phase !== GamePhase.Complete) {
        const actions = game.getAvailableActions();
        const activeId = state.players[state.activePlayerIndex].id;
        if (actions.canCheck) {
          game.act(activeId, ActionType.Check);
        } else if (actions.canCall) {
          game.act(activeId, ActionType.Call);
        } else {
          break;
        }
        state = game.getState();
      }

      const p0View = getPlayerView(state, 'p0');
      // Both hands visible at showdown
      expect(p0View.players[0].holeCards.every(c => c !== null)).toBe(true);
      expect(p0View.players[1].holeCards.every(c => c !== null)).toBe(true);
    });

    it('hides folded player cards', () => {
      const game = new NLHGame(NLH_CONFIG, makePlayers(3), 0);
      game.start();
      const state = game.getState();
      const activeId = state.players[state.activePlayerIndex].id;
      game.act(activeId, ActionType.Fold);

      const newState = game.getState();
      const foldedId = activeId;
      const p1View = getPlayerView(newState, 'p1');

      // Find the folded player in the view
      const foldedInView = p1View.players.find(p => p.id === foldedId);
      expect(foldedInView?.holeCards).toHaveLength(0);
    });
  });

  describe('Stud games (Razz)', () => {
    it('shows up cards, hides down cards for opponents', () => {
      const game = new RazzGame(RAZZ_CONFIG, makePlayers(3), 0);
      game.start();
      const state = game.getState();

      // After deal, each player has 3 cards: 2 down + 1 up (3rd street)
      const p0View = getPlayerView(state, 'p0');

      // Own cards: all 3 visible
      expect(p0View.players[0].holeCards).toHaveLength(3);
      expect(p0View.players[0].holeCards.every(c => c !== null)).toBe(true);

      // Opponents: 3 cards total, 1 up (visible) + 2 down (null)
      for (let i = 1; i < 3; i++) {
        const opponent = p0View.players[i];
        expect(opponent.holeCards).toHaveLength(3);
        const visibleCount = opponent.holeCards.filter(c => c !== null).length;
        const nullCount = opponent.holeCards.filter(c => c === null).length;
        expect(visibleCount).toBe(1); // door card
        expect(nullCount).toBe(2); // two down cards
      }
    });
  });

  describe('Draw games (2-7 TD)', () => {
    it('hides opponent cards with null placeholders', () => {
      const game = new TwoSevenTDGame(TD_CONFIG, makePlayers(2), 0);
      game.start();
      const state = game.getState();

      const p0View = getPlayerView(state, 'p0');

      // Own: 5 cards visible
      expect(p0View.players[0].holeCards).toHaveLength(5);
      expect(p0View.players[0].holeCards.every(c => c !== null)).toBe(true);

      // Opponent: 5 null placeholders (know they have 5 cards, not what)
      expect(p0View.players[1].holeCards).toHaveLength(5);
      expect(p0View.players[1].holeCards.every(c => c === null)).toBe(true);
    });

    it('strips discard indices from opponent actions', () => {
      const game = new TwoSevenTDGame(TD_CONFIG, makePlayers(2), 0);
      game.start();

      // Play through preflop to get to draw
      let state = game.getState();
      while (state.phase === GamePhase.BettingPreflop) {
        const activeId = state.players[state.activePlayerIndex].id;
        const actions = game.getAvailableActions();
        if (actions.canCheck) game.act(activeId, ActionType.Check);
        else if (actions.canCall) game.act(activeId, ActionType.Call);
        state = game.getState();
      }

      // Now in draw phase — whoever is active discards
      if (state.phase === GamePhase.Drawing1) {
        const drawerId = state.players[state.activePlayerIndex].id;
        const opponentId = drawerId === 'p0' ? 'p1' : 'p0';
        (game as any).discard(drawerId, [0, 1]);
        state = game.getState();

        // Check from the OPPONENT's perspective — should NOT see drawer's discard indices
        const opponentView = getPlayerView(state, opponentId);
        const discardAction = opponentView.actionHistory.find(
          a => a.playerId === drawerId && a.type === ActionType.Discard
        );
        expect(discardAction).toBeDefined();
        expect(discardAction!.discardIndices).toBeUndefined();

        // But the drawer should see their own discard indices
        const drawerView = getPlayerView(state, drawerId);
        const ownAction = drawerView.actionHistory.find(
          a => a.playerId === drawerId && a.type === ActionType.Discard
        );
        expect(ownAction).toBeDefined();
        expect(ownAction!.discardIndices).toEqual([0, 1]);
      }
    });
  });

  describe('Symmetry', () => {
    it('each player gets a different view of the same state', () => {
      const game = new NLHGame(NLH_CONFIG, makePlayers(3), 0);
      game.start();
      const state = game.getState();

      const views = ['p0', 'p1', 'p2'].map(id => getPlayerView(state, id));

      // Each player sees their own cards
      for (let i = 0; i < 3; i++) {
        expect(views[i].players[i].holeCards.every(c => c !== null)).toBe(true);
      }

      // Each player sees opponents as null
      expect(views[0].players[1].holeCards.every(c => c === null)).toBe(true);
      expect(views[0].players[2].holeCards.every(c => c === null)).toBe(true);
      expect(views[1].players[0].holeCards.every(c => c === null)).toBe(true);
      expect(views[1].players[2].holeCards.every(c => c === null)).toBe(true);
    });
  });
});
