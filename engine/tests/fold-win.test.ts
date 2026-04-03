// ============================================================
// Fold-Win Tests — systematic coverage across game families
// ============================================================
// Verifies that when all but one player fold, the hand completes
// correctly: phase=Complete, correct winner, chips awarded, pots clear.

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

function makePlayers(count: number, chips = 1000): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    chips,
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

const NLH_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  startingChips: 1000, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit,
};

const RAZZ_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 0, bigBlind: 0, ante: 2, bringIn: 3,
  smallBet: 5, bigBet: 10, startingChips: 1000, variant: GameVariant.Razz,
  bettingStructure: BettingStructure.FixedLimit,
};

const DRAW_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  startingChips: 1000, variant: GameVariant.TwoSevenSD, bettingStructure: BettingStructure.NoLimit,
};

const BADUGI_CONFIG: TableConfig = {
  maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
  smallBet: 10, bigBet: 20, startingChips: 1000, variant: GameVariant.Badugi,
  bettingStructure: BettingStructure.FixedLimit,
};

// ============================================================
// Heads-up fold-wins (2 players)
// ============================================================
describe('Fold-Win: Heads-up', () => {
  it('NLH: SB folds preflop → BB wins blinds', () => {
    const players = makePlayers(2);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const done = game.act(activeId, ActionType.Fold);

    expect(done).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('Razz: bring-in player folds → other player wins antes + bring-in', () => {
    const players = makePlayers(2);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.Razz, players, 0, RAZZ_CONFIG);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const done = game.act(activeId, ActionType.Fold);

    expect(done).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('2-7 SD: SB folds pre-draw → BB wins blinds', () => {
    const players = makePlayers(2);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.TwoSevenSD, players, 0, DRAW_CONFIG);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const done = game.act(activeId, ActionType.Fold);

    expect(done).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });
});

// ============================================================
// Multi-way fold-wins (3+ players)
// ============================================================
describe('Fold-Win: Multi-way', () => {
  it('NLH 3-way: two players fold → last player wins', () => {
    const players = makePlayers(3);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    // Fold first two active players
    let state = game.getState();
    let activeId = state.players[state.activePlayerIndex].id;
    let done = game.act(activeId, ActionType.Fold);
    expect(done).toBe(false); // Still one more player to act

    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;
    done = game.act(activeId, ActionType.Fold);
    expect(done).toBe(true);

    expect(game.getState().phase).toBe(GamePhase.Complete);
    const winners = game.getWinners();
    expect(winners.length).toBe(1);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('NLH 4-way: fold after flop bet → correct winner', () => {
    const players = makePlayers(4);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    // Preflop: everyone calls
    let state = game.getState();
    while (state.phase === GamePhase.BettingPreflop) {
      const activeId = state.players[state.activePlayerIndex].id;
      const actions = game.getAvailableActions();
      if (actions.canCall) {
        game.act(activeId, ActionType.Call);
      } else if (actions.canCheck) {
        game.act(activeId, ActionType.Check);
      }
      state = game.getState();
    }

    // Flop: first player bets, rest fold
    expect(state.phase).toBe(GamePhase.BettingFlop);
    let activeId = state.players[state.activePlayerIndex].id;
    const bettorId = activeId;
    game.act(activeId, ActionType.Bet, 20);

    state = game.getState();
    // Remaining players fold
    while (state.phase === GamePhase.BettingFlop) {
      activeId = state.players[state.activePlayerIndex].id;
      game.act(activeId, ActionType.Fold);
      state = game.getState();
    }

    expect(state.phase).toBe(GamePhase.Complete);
    const winners = game.getWinners();
    expect(winners.length).toBe(1);
    expect(winners[0].playerId).toBe(bettorId);
    expect(totalChips(game.getState().players)).toBe(startTotal);
  });

  it('Badugi 3-way: fold during post-draw betting → winner', () => {
    const players = makePlayers(3);
    const startTotal = totalChips(players);
    const game = createGame(GameVariant.Badugi, players, 0, BADUGI_CONFIG);
    game.start();

    let state = game.getState();
    // Pre-draw betting: everyone calls/checks through
    while (state.phase === GamePhase.BettingPreflop) {
      const activeId = state.players[state.activePlayerIndex].id;
      const actions = game.getAvailableActions();
      if (actions.canCall) game.act(activeId, ActionType.Call);
      else if (actions.canCheck) game.act(activeId, ActionType.Check);
      state = game.getState();
    }

    // Draw phase: everyone stands pat
    while (state.phase.startsWith('draw')) {
      const activeId = state.players[state.activePlayerIndex].id;
      (game as any).discard(activeId, []);
      state = game.getState();
    }

    // Post-draw: first player bets, rest fold
    if (state.phase.startsWith('betting')) {
      const activeId = state.players[state.activePlayerIndex].id;
      const bettorId = activeId;
      const actions = game.getAvailableActions();
      if (actions.canBet) {
        game.act(activeId, ActionType.Bet, actions.minBet);
      }
      state = game.getState();

      while (!state.phase.startsWith('complete') && state.phase.startsWith('betting')) {
        const nextId = state.players[state.activePlayerIndex].id;
        game.act(nextId, ActionType.Fold);
        state = game.getState();
      }

      expect(state.phase).toBe(GamePhase.Complete);
      expect(totalChips(game.getState().players)).toBe(startTotal);
    }
  });
});

// ============================================================
// Fold-win: winner properties
// ============================================================
describe('Fold-Win: Winner properties', () => {
  it('winner receives entire pot', () => {
    const players = makePlayers(2, 500);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    const state = game.getState();
    const folderId = state.players[state.activePlayerIndex].id;
    const winnerId = state.players.find(p => p.id !== folderId)!.id;

    game.act(folderId, ActionType.Fold);

    const finalState = game.getState();
    const winner = finalState.players.find(p => p.id === winnerId)!;
    const loser = finalState.players.find(p => p.id === folderId)!;

    // Winner got SB posted by folder
    expect(winner.chips).toBeGreaterThan(500);
    expect(loser.chips).toBeLessThan(500);
    expect(winner.chips + loser.chips).toBe(1000);
  });

  it('getWinners returns correct name and amount', () => {
    const players = makePlayers(2, 500);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    const state = game.getState();
    const folderId = state.players[state.activePlayerIndex].id;
    game.act(folderId, ActionType.Fold);

    const winners = game.getWinners();
    expect(winners.length).toBe(1);
    expect(winners[0].amount).toBeGreaterThan(0);
    expect(winners[0].name).toBeDefined();
  });

  it('pots are preserved after fold-win (for display)', () => {
    const players = makePlayers(2, 500);
    const game = createGame(GameVariant.NLH, players, 0, NLH_CONFIG);
    game.start();

    const state = game.getState();
    const folderId = state.players[state.activePlayerIndex].id;
    game.act(folderId, ActionType.Fold);

    const finalState = game.getState();
    // Pots should be preserved for display (chips already awarded)
    expect(finalState.pots).toBeDefined();
  });
});
