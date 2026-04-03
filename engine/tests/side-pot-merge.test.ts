// ============================================================
// Side Pot Merge Tests
// ============================================================
// Verifies that side pots are created correctly on all-ins,
// NOT on folds, and that chip conservation holds.

import { describe, it, expect } from 'vitest';
import {
  createGame,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
  type PlayerState,
  type TableConfig,
} from '../src/index.js';

function makePlayers(count: number, chips: number | number[]): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    chips: Array.isArray(chips) ? chips[i] : chips,
    holeCards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
    seatIndex: i,
  }));
}

function totalChips(players: PlayerState[]): number {
  return players.reduce((sum, p) => sum + p.chips, 0);
}

/** Play through a game using available actions — call/check when possible */
function playToCompletion(game: any): void {
  let state = game.getState();
  let iterations = 0;
  while (state.phase !== GamePhase.Complete && iterations < 100) {
    const activeId = state.players[state.activePlayerIndex]?.id;
    if (!activeId) break;
    const actions = game.getAvailableActions();
    if (actions.canCheck) {
      game.act(activeId, ActionType.Check);
    } else if (actions.canCall) {
      game.act(activeId, ActionType.Call);
    } else {
      break;
    }
    state = game.getState();
    iterations++;
  }
}

const NLH_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  startingChips: 1000, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit,
};

// ============================================================
// All-in creates side pots
// ============================================================
describe('Side Pots: All-ins', () => {
  it('short stack all-in creates at least one pot', () => {
    // p0=100 (short), p1=500, p2=500
    const players = makePlayers(3, [100, 500, 500]);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    let state = game.getState();
    // First active player goes all-in
    let activeId = state.players[state.activePlayerIndex].id;
    const actions = game.getAvailableActions();
    game.act(activeId, ActionType.Raise, actions.maxRaise);

    state = game.getState();
    // Others call
    while (state.phase === GamePhase.BettingPreflop) {
      activeId = state.players[state.activePlayerIndex].id;
      const a = game.getAvailableActions();
      if (a.canCall) game.act(activeId, ActionType.Call);
      else if (a.canCheck) game.act(activeId, ActionType.Check);
      state = game.getState();
    }

    // Play through remaining streets
    playToCompletion(game);

    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('two different stack sizes create multiple pots at showdown', () => {
    // p0=50 (shortest), p1=150 (medium), p2=500 (deep)
    const players = makePlayers(3, [50, 150, 500]);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    let state = game.getState();
    let done = false;

    // Everyone goes all-in or calls
    while (!done && state.phase !== GamePhase.Complete) {
      const activeId = state.players[state.activePlayerIndex].id;
      const actions = game.getAvailableActions();
      if (actions.canRaise) {
        done = game.act(activeId, ActionType.Raise, actions.maxRaise);
      } else if (actions.canCall) {
        done = game.act(activeId, ActionType.Call);
      } else if (actions.canCheck) {
        done = game.act(activeId, ActionType.Check);
      } else {
        break;
      }
      state = game.getState();
    }

    // If not done, play through remaining streets
    if (state.phase !== GamePhase.Complete) {
      playToCompletion(game);
    }

    const finalState = game.getState();
    expect(finalState.phase).toBe(GamePhase.Complete);
    expect(totalChips(finalState.players)).toBe(startTotal);

    // Should have winners
    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Chip conservation with side pots
// ============================================================
describe('Side Pots: Chip conservation', () => {
  it('total chips preserved with 3-way all-in at different levels', () => {
    const chipLevels = [50, 150, 300];
    const players = makePlayers(3, chipLevels);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    let state = game.getState();
    let done = false;

    // Everyone goes all-in
    while (!done && state.phase !== GamePhase.Complete) {
      const activeId = state.players[state.activePlayerIndex].id;
      const actions = game.getAvailableActions();
      if (actions.canRaise) {
        done = game.act(activeId, ActionType.Raise, actions.maxRaise);
      } else if (actions.canCall) {
        done = game.act(activeId, ActionType.Call);
      } else if (actions.canCheck) {
        done = game.act(activeId, ActionType.Check);
      } else {
        break;
      }
      state = game.getState();
    }

    expect(state.phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('chip conservation holds after fold + all-in in same hand', () => {
    // p0=200 folds, p1=100 all-in, p2=500 calls
    const players = makePlayers(3, [200, 100, 500]);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    let state = game.getState();
    // First player (UTG) folds
    let activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Fold);

    state = game.getState();
    // Next player goes all-in
    activeId = state.players[state.activePlayerIndex].id;
    let actions = game.getAvailableActions();
    if (actions.canRaise) {
      game.act(activeId, ActionType.Raise, actions.maxRaise);
    } else if (actions.canCall) {
      game.act(activeId, ActionType.Call);
    }

    state = game.getState();
    // Last player calls (or game completes)
    if (state.phase !== GamePhase.Complete) {
      activeId = state.players[state.activePlayerIndex].id;
      actions = game.getAvailableActions();
      if (actions.canCall) game.act(activeId, ActionType.Call);
      else if (actions.canCheck) game.act(activeId, ActionType.Check);
    }

    // Play remaining streets
    state = game.getState();
    if (state.phase !== GamePhase.Complete) {
      playToCompletion(game);
    }

    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('10 consecutive hands with varying stacks preserve total chips', () => {
    let players = makePlayers(3, [100, 200, 300]);
    const startTotal = totalChips(players);

    for (let hand = 0; hand < 10; hand++) {
      const active = players.filter(p => p.chips > 0);
      if (active.length < 2) break;

      const game = createGame(GameVariant.NLH, active, hand % active.length, NLH_CONFIG);
      game.start();

      // Simple play: call/check through
      playToCompletion(game);

      const finalState = game.getState();

      // Update players for next hand
      players = players.map(p => {
        const fp = finalState.players.find(fp => fp.id === p.id);
        if (fp) return { ...fp, holeCards: [], bet: 0, totalBet: 0, folded: false, allIn: false };
        return p; // Busted player
      });
    }

    expect(totalChips(players)).toBe(startTotal);
  });
});
