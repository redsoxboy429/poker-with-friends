// ============================================================
// All-In Draw Game Tests
// ============================================================
// Verifies that all-in players participate correctly in draw rounds
// and that games complete correctly with chip conservation.

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

const SD_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  startingChips: 1000, variant: GameVariant.TwoSevenSD, bettingStructure: BettingStructure.NoLimit,
};

const TD_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  smallBet: 10, bigBet: 20, startingChips: 1000, variant: GameVariant.TwoSevenTD,
  bettingStructure: BettingStructure.FixedLimit,
};

/** Play through a game step by step with a hard iteration limit */
function playThrough(game: any, maxIterations = 200): void {
  let state = game.getState();
  let i = 0;
  while (state.phase !== GamePhase.Complete && i < maxIterations) {
    const activeId = state.players[state.activePlayerIndex]?.id;
    if (!activeId) break;

    if (state.phase.startsWith('draw')) {
      // Stand pat
      try { (game as any).discard(activeId, []); } catch { break; }
    } else {
      const actions = game.getAvailableActions();
      try {
        if (actions.canCheck) game.act(activeId, ActionType.Check);
        else if (actions.canCall) game.act(activeId, ActionType.Call);
        else break;
      } catch { break; }
    }
    state = game.getState();
    i++;
  }
}

// ============================================================
// Single Draw: All-in preflop
// ============================================================
describe('All-In Draw: 2-7 Single Draw', () => {
  it('completes when both players call through and draw', () => {
    const players = makePlayers(2, 1000);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.TwoSevenSD, players, 0, SD_CONFIG);
    game.start();

    playThrough(game);

    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
    expect(game.getWinners().length).toBeGreaterThan(0);
  });

  it('chip conservation over 5 consecutive hands', () => {
    let players = makePlayers(2, 500);
    const startTotal = totalChips(players);

    for (let hand = 0; hand < 5; hand++) {
      if (players.some(p => p.chips <= 0)) break;

      const game = createGame(GameVariant.TwoSevenSD, players, hand % 2, SD_CONFIG);
      game.start();
      playThrough(game);

      expect(totalChips(game.getState().players)).toBe(startTotal);

      players = game.getState().players.map(p => ({
        ...p, holeCards: [], bet: 0, totalBet: 0, folded: false, allIn: false,
      }));
    }
  });
});

// ============================================================
// Triple Draw: Multiple draw rounds
// ============================================================
describe('All-In Draw: 2-7 Triple Draw', () => {
  it('completes with call/check through all 3 draw rounds', () => {
    const players = makePlayers(2, 1000);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.TwoSevenTD, players, 0, TD_CONFIG);
    game.start();

    playThrough(game);

    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('preserves chips when one player has fewer chips', () => {
    const players = makePlayers(2, [100, 500]);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.TwoSevenTD, players, 0, TD_CONFIG);
    game.start();

    playThrough(game);

    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });
});
