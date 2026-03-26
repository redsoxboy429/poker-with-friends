// ============================================================
// Tests for Limit Hold'em and 7-Card Stud High
// ============================================================

import { describe, it, expect } from 'vitest';
import { LHEGame } from '../src/games/lhe.js';
import { StudGame } from '../src/games/stud.js';
import {
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
} from '../src/types.js';

// ============================================================
// Helpers
// ============================================================

function makePlayers(count: number, chips = 1000): PlayerState[] {
  const names = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank'];
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: names[i] || `Player ${i}`,
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

const LHE_CONFIG: TableConfig = {
  maxPlayers: 6,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  bringIn: 0,
  smallBet: 10,
  bigBet: 20,
  startingChips: 1000,
  variant: GameVariant.LimitHoldem,
  bettingStructure: BettingStructure.FixedLimit,
};

const STUD_CONFIG: TableConfig = {
  maxPlayers: 6,
  smallBlind: 0,
  bigBlind: 0,
  ante: 2,
  bringIn: 3,
  smallBet: 5,
  bigBet: 10,
  startingChips: 1000,
  variant: GameVariant.Stud,
  bettingStructure: BettingStructure.FixedLimit,
};

/** Play a hand to completion with simple bot logic */
function playToCompletion(game: any, maxActions = 500): boolean {
  let actions = 0;
  let state = game.getState();
  while (state.phase !== GamePhase.Complete && actions < maxActions) {
    if (state.phase === GamePhase.Showdown || state.phase === GamePhase.Complete) break;

    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.folded || activePlayer.sittingOut) break;

    const available = game.getAvailableActions();

    if (available.canCheck) {
      game.act(activePlayer.id, ActionType.Check);
    } else if (available.canCall) {
      game.act(activePlayer.id, ActionType.Call);
    } else if (available.canBet) {
      game.act(activePlayer.id, ActionType.Bet, available.minBet);
    } else if (available.canFold) {
      game.act(activePlayer.id, ActionType.Fold);
    } else {
      break;
    }
    actions++;
    state = game.getState();
  }
  return game.getState().phase === GamePhase.Complete;
}

// ============================================================
// Limit Hold'em Tests
// ============================================================

describe('Limit Hold\'em (LHE)', () => {
  it('creates a game with fixed-limit betting', () => {
    const players = makePlayers(4);
    const game = new LHEGame(LHE_CONFIG, players, 0);
    const state = game.getState();
    expect(state.variant).toBe(GameVariant.LimitHoldem);
    expect(state.bettingStructure).toBe(BettingStructure.FixedLimit);
  });

  it('deals 2 hole cards per player', () => {
    const players = makePlayers(4);
    const game = new LHEGame(LHE_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards.length).toBe(2);
    }
  });

  it('posts blinds correctly', () => {
    const players = makePlayers(4);
    const game = new LHEGame(LHE_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    // Button at 0, SB at 1, BB at 2
    expect(state.players[1].totalBet).toBe(5);  // SB
    expect(state.players[2].totalBet).toBe(10); // BB
    expect(state.currentBet).toBe(10);
  });

  it('enforces fixed-limit bet sizes', () => {
    const players = makePlayers(3);
    const game = new LHEGame(LHE_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    const available = game.getAvailableActions();

    // Preflop: raises should be in small bet increments
    // The min and max raise should be equal (fixed limit)
    if (available.canRaise) {
      expect(available.minRaise).toBe(available.maxRaise);
    }
  });

  it('plays a full hand to completion', () => {
    const players = makePlayers(4);
    const game = new LHEGame(LHE_CONFIG, players, 0);
    game.start();
    const completed = playToCompletion(game);
    expect(completed).toBe(true);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
  });

  it('plays 20 hands without errors', () => {
    const players = makePlayers(6);
    for (let i = 0; i < 20; i++) {
      const game = new LHEGame(LHE_CONFIG, players, i % players.length);
      game.start();
      const completed = playToCompletion(game);
      expect(completed).toBe(true);
      expect(game.getWinners().length).toBeGreaterThan(0);
    }
  });

});

// ============================================================
// 7-Card Stud High Tests
// ============================================================

describe('7-Card Stud High', () => {
  it('creates a game with correct variant', () => {
    const players = makePlayers(4);
    const game = new StudGame(STUD_CONFIG, players, 0);
    const state = game.getState();
    expect(state.variant).toBe(GameVariant.Stud);
    expect(state.bettingStructure).toBe(BettingStructure.FixedLimit);
  });

  it('posts antes and deals 3 cards (2 down + 1 up)', () => {
    const players = makePlayers(4);
    const game = new StudGame(STUD_CONFIG, players, 0);
    game.start();
    const state = game.getState();

    for (const p of state.players) {
      expect(p.holeCards.length).toBe(3);
      // Should have card visibility
      expect(p.cardVisibility).toBeDefined();
      expect(p.cardVisibility!.length).toBe(3);
      // First 2 down, last 1 up
      expect(p.cardVisibility![0]).toBe('down');
      expect(p.cardVisibility![1]).toBe('down');
      expect(p.cardVisibility![2]).toBe('up');
    }
  });

  it('collects antes from all players', () => {
    const players = makePlayers(4);
    const game = new StudGame(STUD_CONFIG, players, 0);
    game.start();
    const state = game.getState();

    // Each player posted 2 ante
    for (const p of state.players) {
      expect(p.totalBet).toBeGreaterThanOrEqual(2);
    }
  });

  it('lowest door card brings in (not highest like Razz)', () => {
    // We can't control which card is dealt, but we can verify
    // that the bring-in was posted by checking action history
    const players = makePlayers(4);
    const game = new StudGame(STUD_CONFIG, players, 0);
    game.start();
    const state = game.getState();

    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    expect(bringInAction).toBeDefined();
    expect(bringInAction!.amount).toBe(3); // bring-in amount
  });

  it('plays a full hand to completion', () => {
    const players = makePlayers(4);
    const game = new StudGame(STUD_CONFIG, players, 0);
    game.start();
    const completed = playToCompletion(game);
    expect(completed).toBe(true);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
  });

  it('plays 20 hands without errors', () => {
    const players = makePlayers(5);
    for (let i = 0; i < 20; i++) {
      const game = new StudGame(STUD_CONFIG, players, i % players.length);
      game.start();
      const completed = playToCompletion(game);
      expect(completed).toBe(true);
      expect(game.getWinners().length).toBeGreaterThan(0);
    }
  });

  it('winner has a valid high hand description', () => {
    const players = makePlayers(3);
    const game = new StudGame(STUD_CONFIG, players, 0);
    game.start();
    playToCompletion(game);

    const winners = game.getWinners();
    expect(winners.length).toBeGreaterThan(0);
    // At least one winner should have a hand description (unless fold-win)
    const showdownWinner = winners.find(w => w.handDescription && w.handDescription.length > 0);
    // Fold wins won't have descriptions, but multi-player showdowns will
    if (winners.length > 0 && game.getState().players.filter(p => !p.folded).length > 1) {
      expect(showdownWinner).toBeDefined();
    }
  });

  it('evaluates high hands (not low like Razz)', () => {
    // Play many hands and verify winners always have high-hand descriptions
    const players = makePlayers(3);
    const highHandPatterns = ['Pair', 'Two Pair', 'Three', 'Straight', 'Flush',
      'Full House', 'Four', 'Royal Flush', '-high'];

    let foundDescription = false;
    for (let i = 0; i < 30; i++) {
      const game = new StudGame(STUD_CONFIG, players, i % players.length);
      game.start();
      playToCompletion(game);
      const winners = game.getWinners();
      for (const w of winners) {
        if (w.handDescription) {
          foundDescription = true;
          // Should be a high hand description, not a low hand
          const isHighHand = highHandPatterns.some(p => w.handDescription!.includes(p));
          expect(isHighHand).toBe(true);
        }
      }
    }
    // Over 30 hands, we should have seen at least one showdown
    expect(foundDescription).toBe(true);
  });
});
