// ============================================================
// Draw Game Engine Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { TwoSevenSDGame } from '../src/games/27sd.js';
import { TwoSevenTDGame } from '../src/games/27td.js';
import {
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
} from '../src/types.js';

function makePlayers(count: number, chips = 1000): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
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

const SD_CONFIG: TableConfig = {
  maxPlayers: 9,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  bringIn: 0,
  startingChips: 1000,
  variant: GameVariant.TwoSevenSD,
  bettingStructure: BettingStructure.NoLimit,
};

const TD_CONFIG: TableConfig = {
  maxPlayers: 9,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  bringIn: 0,
  smallBet: 5,
  bigBet: 10,
  startingChips: 1000,
  variant: GameVariant.TwoSevenTD,
  bettingStructure: BettingStructure.FixedLimit,
};

// ============================================================
// Helpers for draw betting/drawing rounds
// ============================================================

function playBettingRound(game: any): any {
  let state = game.getState();
  const startPhase = state.phase;
  while (state.phase === startPhase) {
    const actions = game.getAvailableActions();
    const player = state.players[state.activePlayerIndex];
    if (actions.canCheck) {
      const done = game.act(player.id, ActionType.Check);
      if (done) return game.getState();
    } else if (actions.canCall) {
      const done = game.act(player.id, ActionType.Call);
      if (done) return game.getState();
    } else if (actions.canFold) {
      const done = game.act(player.id, ActionType.Fold);
      if (done) return game.getState();
    }
    state = game.getState();
  }
  return state;
}

function playDrawRound(game: any, discardCounts: Record<string, number> = {}): any {
  let state = game.getState();
  const startPhase = state.phase;
  while (state.phase === startPhase) {
    const player = state.players[state.activePlayerIndex];
    const numDiscard = discardCounts[player.id] ?? 0;
    const indices = Array.from({ length: numDiscard }, (_, i) => i);
    game.discard(player.id, indices);
    state = game.getState();
  }
  return state;
}

// ============================================================
// TwoSevenSDGame Tests
// ============================================================

describe('TwoSevenSDGame', () => {
  it('deals 5 cards to each player', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(5);
    }
  });

  it('posts correct blinds (SB and BB)', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    // Heads-up: button = 0 = SB, BB = 1
    expect(state.players[0].bet).toBe(5);   // Button/SB posts small blind
    expect(state.players[1].bet).toBe(10);  // BB posts big blind
    expect(state.players[0].chips).toBe(995);
    expect(state.players[1].chips).toBe(990);
  });

  it('handles pre-draw betting round', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingPreflop);

    // First to act is player at activePlayerIndex
    let activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Call);

    state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingPreflop);

    // Next player to act
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);

    state = game.getState();
    expect(state.phase).toBe(GamePhase.Drawing1);
  });

  it('player can discard and receive replacements', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    // Skip pre-draw betting
    const state1 = playBettingRound(game);
    expect(state1.phase).toBe(GamePhase.Drawing1);

    const state2 = game.getState();
    const activePlayerId = state2.players[state2.activePlayerIndex].id;
    const activePlayer = state2.players[state2.activePlayerIndex];
    const originalCards = [...activePlayer.holeCards];

    // Active player discards cards at indices 0 and 1
    game.discard(activePlayerId, [0, 1]);

    const state3 = game.getState();
    const updatedPlayer = state3.players.find(p => p.id === activePlayerId)!;

    // Should still have 5 cards
    expect(updatedPlayer.holeCards).toHaveLength(5);

    // Original cards at indices 0 and 1 should be gone
    const originalCardsRemaining = updatedPlayer.holeCards.filter(
      c => originalCards[0] === c || originalCards[1] === c
    );
    expect(originalCardsRemaining).toHaveLength(0);
  });

  it('stand pat (discard 0 cards) works', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    const state1 = playBettingRound(game);
    expect(state1.phase).toBe(GamePhase.Drawing1);

    const state2 = game.getState();
    const activePlayerId = state2.players[state2.activePlayerIndex].id;
    const activePlayer = state2.players[state2.activePlayerIndex];
    const originalCards = [...activePlayer.holeCards];

    // Active player stands pat
    game.discard(activePlayerId, []);

    const state3 = game.getState();
    const updatedPlayer = state3.players.find(p => p.id === activePlayerId)!;

    // Same 5 cards
    expect(updatedPlayer.holeCards).toHaveLength(5);
    expect(updatedPlayer.holeCards).toEqual(originalCards);
  });

  it('completes drawing round and moves to post-draw betting', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    const state1 = playBettingRound(game);
    expect(state1.phase).toBe(GamePhase.Drawing1);

    const state2 = playDrawRound(game);
    expect(state2.phase).toBe(GamePhase.BettingPostDraw1);
  });

  it('completes post-draw betting and goes to showdown', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    playDrawRound(game);

    const state = playBettingRound(game);
    // After final betting round, game is complete (Showdown is automatic)
    expect([GamePhase.Showdown, GamePhase.Complete]).toContain(state.phase);
  });

  it('determines winner by best 2-7 low hand', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);

    const state = game.getState();
    // Game should be complete after final betting round
    expect([GamePhase.Showdown, GamePhase.Complete]).toContain(state.phase);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
    expect(winners[0].playerId).toBeTruthy();
    expect(winners[0].amount).toBeGreaterThan(0);
  });

  it('handles fold during pre-draw betting', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const otherId = state.players[1 - state.activePlayerIndex].id;

    // Active player folds
    const complete = game.act(activeId, ActionType.Fold);
    expect(complete).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);

    const winners = game.getWinners();
    expect(winners.length).toBe(1);
    expect(winners[0].playerId).toBe(otherId);
  });

  it('preserves total chips after hand', () => {
    const players = makePlayers(2);
    const initialChips = players.reduce((sum, p) => sum + p.chips, 0);

    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);

    const state = game.getState();
    const finalChips = state.players.reduce((sum, p) => sum + p.chips, 0);

    expect(finalChips).toBe(initialChips);
  });

  it('rejects discard with invalid card indices', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    const state = game.getState();
    expect(state.phase).toBe(GamePhase.Drawing1);

    const activePlayerId = state.players[state.activePlayerIndex].id;

    // Try to discard index 10 (out of range)
    expect(() => {
      game.discard(activePlayerId, [10]);
    }).toThrow('Invalid card index');
  });

  it('rejects discard during betting phase', () => {
    const players = makePlayers(2);
    const game = new TwoSevenSDGame(SD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingPreflop);

    const player0 = state.players[0];

    // Try to discard during preflop betting
    expect(() => {
      game.discard(player0.id, [0]);
    }).toThrow('Cannot discard during phase');
  });
});

// ============================================================
// TwoSevenTDGame Tests (Triple Draw)
// ============================================================

describe('TwoSevenTDGame', () => {
  it('can be created and started', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingPreflop);
    expect(state.variant).toBe(GameVariant.TwoSevenTD);
  });

  it('deals 5 cards to each player', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(5);
    }
  });

  it('completes all 3 draw rounds with betting in between', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    // Pre-draw betting
    let state = playBettingRound(game);
    expect(state.phase).toBe(GamePhase.Drawing1);

    // Draw 1
    state = playDrawRound(game);
    expect(state.phase).toBe(GamePhase.BettingPostDraw1);

    // Post-draw-1 betting
    state = playBettingRound(game);
    expect(state.phase).toBe(GamePhase.Drawing2);

    // Draw 2
    state = playDrawRound(game);
    expect(state.phase).toBe(GamePhase.BettingPostDraw2);

    // Post-draw-2 betting
    state = playBettingRound(game);
    expect(state.phase).toBe(GamePhase.Drawing3);

    // Draw 3
    state = playDrawRound(game);
    expect(state.phase).toBe(GamePhase.BettingPostDraw3);

    // Post-draw-3 betting (final) - should go to Showdown/Complete
    state = playBettingRound(game);
    expect([GamePhase.Showdown, GamePhase.Complete]).toContain(state.phase);
  });

  it('tracks drawsRemaining correctly', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    expect(state.drawsRemaining).toBe(3);

    playBettingRound(game);
    state = game.getState();
    expect(state.phase).toBe(GamePhase.Drawing1);

    playDrawRound(game);
    state = game.getState();
    expect(state.drawsRemaining).toBe(2);

    playBettingRound(game);
    playDrawRound(game);
    state = game.getState();
    expect(state.drawsRemaining).toBe(1);
  });

  it('handles all-in during drawing (skips remaining draws)', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    // Pre-draw betting: go all-in via multiple raises in fixed-limit
    let state = game.getState();
    let activeId = state.players[state.activePlayerIndex].id;
    const otherId = state.players[1 - state.activePlayerIndex].id;

    // Keep raising to go all-in (fixed-limit betting)
    while (state.players.find(p => !p.allIn && !p.folded && p.chips > 0)) {
      state = game.getState();
      activeId = state.players[state.activePlayerIndex].id;
      const actions = game.getAvailableActions();

      if (actions.canRaise && state.phase === GamePhase.BettingPreflop) {
        game.act(activeId, ActionType.Raise, actions.maxRaise);
      } else if (actions.canCall) {
        game.act(activeId, ActionType.Call);
      } else {
        break;
      }
    }

    state = game.getState();
    // Should move to showdown when all-in during preflop
    expect([GamePhase.Showdown, GamePhase.Complete]).toContain(state.phase);
  });

  it('determines winner by best 2-7 low hand', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);

    const state = game.getState();
    // Game should be complete after final betting round
    expect([GamePhase.Showdown, GamePhase.Complete]).toContain(state.phase);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
  });

  it('preserves total chips after hand', () => {
    const players = makePlayers(2);
    const initialChips = players.reduce((sum, p) => sum + p.chips, 0);

    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);
    playDrawRound(game);
    playBettingRound(game);

    const state = game.getState();
    const finalChips = state.players.reduce((sum, p) => sum + p.chips, 0);

    expect(finalChips).toBe(initialChips);
  });

  it('handles fold during pre-draw betting', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;

    // Active player folds
    const complete = game.act(activeId, ActionType.Fold);
    expect(complete).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);

    const winners = game.getWinners();
    expect(winners.length).toBe(1);
  });

  it('action history includes discard records', () => {
    const players = makePlayers(2);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);

    // Manually record starting action count
    const state1 = game.getState();
    const actionsBefore = state1.actionHistory.length;

    playDrawRound(game);

    const state2 = game.getState();
    const actionsAfter = state2.actionHistory.length;

    // Should have at least 2 discard/stand-pat actions (one per player)
    expect(actionsAfter).toBeGreaterThan(actionsBefore);

    // Check that actions include Discard or StandPat
    const drawActions = state2.actionHistory.slice(actionsBefore);
    const hasDiscardOrStandPat = drawActions.some(
      a => a.type === ActionType.Discard || a.type === ActionType.StandPat
    );
    expect(hasDiscardOrStandPat).toBe(true);
  });

  it('handles multiple players drawing in correct order', () => {
    const players = makePlayers(3);
    const game = new TwoSevenTDGame(TD_CONFIG, players, 0);
    game.start();

    playBettingRound(game);

    // In drawing phase, should cycle through all active players
    let state = game.getState();
    expect(state.phase).toBe(GamePhase.Drawing1);

    // Track the draw order by checking action history
    const originalActions = state.actionHistory.length;

    // First player to draw
    let activePlayerId = state.players[state.activePlayerIndex].id;
    game.discard(activePlayerId, []);

    state = game.getState();
    const afterFirst = state.actionHistory.length;
    expect(afterFirst).toBeGreaterThan(originalActions);

    // Should still be in Drawing1
    expect(state.phase).toBe(GamePhase.Drawing1);

    // Next player should be ready (different from the one who just drew)
    const nextPlayerId = state.players[state.activePlayerIndex].id;
    expect(nextPlayerId).not.toBe(activePlayerId);

    // Continue draws
    game.discard(nextPlayerId, []);
    state = game.getState();
    expect(state.phase).toBe(GamePhase.Drawing1);

    // Third player
    const thirdPlayerId = state.players[state.activePlayerIndex].id;
    expect(thirdPlayerId).not.toBe(activePlayerId);
    expect(thirdPlayerId).not.toBe(nextPlayerId);
  });
});
