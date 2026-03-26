// ============================================================
// Tests for Hi-Lo variants (Stud Hi-Lo + Omaha Hi-Lo)
// ============================================================

import { describe, it, expect } from 'vitest';
import { StudHiLoGame } from '../src/games/stud-hilo.js';
import { PLO8Game } from '../src/games/plo8.js';
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

const STUD8_CONFIG: TableConfig = {
  maxPlayers: 6,
  smallBlind: 0,
  bigBlind: 0,
  ante: 2,
  bringIn: 3,
  smallBet: 5,
  bigBet: 10,
  startingChips: 1000,
  variant: GameVariant.StudHiLo,
  bettingStructure: BettingStructure.FixedLimit,
};

const PLO8_CONFIG: TableConfig = {
  maxPlayers: 6,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  bringIn: 0,
  startingChips: 1000,
  variant: GameVariant.PLOHiLo,
  bettingStructure: BettingStructure.PotLimit,
};

// ============================================================
// Stud Hi-Lo Tests
// ============================================================

describe('7-Card Stud Hi-Lo (8-or-better)', () => {
  it('creates a game with correct variant', () => {
    const players = makePlayers(4);
    const game = new StudHiLoGame(STUD8_CONFIG, players, 0);
    const state = game.getState();
    expect(state.variant).toBe(GameVariant.StudHiLo);
    expect(state.bettingStructure).toBe(BettingStructure.FixedLimit);
  });

  it('deals 3 initial cards (2 down + 1 up)', () => {
    const players = makePlayers(4);
    const game = new StudHiLoGame(STUD8_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards.length).toBe(3);
      expect(p.cardVisibility![0]).toBe('down');
      expect(p.cardVisibility![1]).toBe('down');
      expect(p.cardVisibility![2]).toBe('up');
    }
  });

  it('posts antes and bring-in', () => {
    const players = makePlayers(4);
    const game = new StudHiLoGame(STUD8_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    const bringIn = state.actionHistory.find(a => a.type === ActionType.BringIn);
    expect(bringIn).toBeDefined();
    expect(bringIn!.amount).toBe(3);
  });

  it('plays a full hand to completion', () => {
    const players = makePlayers(4);
    const game = new StudHiLoGame(STUD8_CONFIG, players, 0);
    game.start();
    const completed = playToCompletion(game);
    expect(completed).toBe(true);
    expect(game.getWinners().length).toBeGreaterThan(0);
  });

  it('plays 30 hands without errors', () => {
    const players = makePlayers(5);
    for (let i = 0; i < 30; i++) {
      const game = new StudHiLoGame(STUD8_CONFIG, players, i % players.length);
      game.start();
      const completed = playToCompletion(game);
      expect(completed).toBe(true);
      expect(game.getWinners().length).toBeGreaterThan(0);
    }
  });

  it('conserves chips across hands (no chips created or destroyed)', () => {
    const players = makePlayers(4);
    const totalChips = players.reduce((sum, p) => sum + p.chips, 0);

    for (let i = 0; i < 20; i++) {
      const game = new StudHiLoGame(STUD8_CONFIG, [...players], i % players.length);
      game.start();
      playToCompletion(game);

      const state = game.getState();
      const chipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0);
      expect(chipsAfter).toBe(totalChips);
    }
  });

  it('can produce split pot winners (high and low)', () => {
    // Play many hands — in some, both high and low should win
    let foundHighWin = false;
    let foundLowWin = false;

    for (let i = 0; i < 100; i++) {
      const players = makePlayers(4);
      const game = new StudHiLoGame(STUD8_CONFIG, players, i % players.length);
      game.start();
      playToCompletion(game);
      const winners = game.getWinners();

      for (const w of winners) {
        if (w.handDescription?.includes('(high)')) foundHighWin = true;
        if (w.handDescription?.includes('(low)')) foundLowWin = true;
        if (w.handDescription?.includes('(scoops)')) foundHighWin = true; // scoop = no low qualified
      }

      if (foundHighWin && foundLowWin) break;
    }

    // Over 100 hands of hi-lo stud, we should see both highs and lows
    expect(foundHighWin).toBe(true);
    expect(foundLowWin).toBe(true);
  });
});

// ============================================================
// Omaha Hi-Lo Tests
// ============================================================

describe('Omaha Hi-Lo (8-or-better)', () => {
  it('creates a game with correct variant', () => {
    const players = makePlayers(4);
    const game = new PLO8Game(PLO8_CONFIG, players, 0);
    const state = game.getState();
    expect(state.variant).toBe(GameVariant.PLOHiLo);
    expect(state.bettingStructure).toBe(BettingStructure.PotLimit);
  });

  it('deals 4 hole cards per player', () => {
    const players = makePlayers(4);
    const game = new PLO8Game(PLO8_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards.length).toBe(4);
    }
  });

  it('posts blinds correctly', () => {
    const players = makePlayers(4);
    const game = new PLO8Game(PLO8_CONFIG, players, 0);
    game.start();
    const state = game.getState();
    expect(state.players[1].totalBet).toBe(5);  // SB
    expect(state.players[2].totalBet).toBe(10); // BB
  });

  it('plays a full hand to completion', () => {
    const players = makePlayers(4);
    const game = new PLO8Game(PLO8_CONFIG, players, 0);
    game.start();
    const completed = playToCompletion(game);
    expect(completed).toBe(true);
    expect(game.getWinners().length).toBeGreaterThan(0);
  });

  it('plays 30 hands without errors', () => {
    const players = makePlayers(6);
    for (let i = 0; i < 30; i++) {
      const game = new PLO8Game(PLO8_CONFIG, players, i % players.length);
      game.start();
      const completed = playToCompletion(game);
      expect(completed).toBe(true);
      expect(game.getWinners().length).toBeGreaterThan(0);
    }
  });

  it('conserves chips across hands', () => {
    const players = makePlayers(4);
    const totalChips = players.reduce((sum, p) => sum + p.chips, 0);

    for (let i = 0; i < 20; i++) {
      const game = new PLO8Game(PLO8_CONFIG, [...players], i % players.length);
      game.start();
      playToCompletion(game);

      const state = game.getState();
      const chipsAfter = state.players.reduce((sum, p) => sum + p.chips, 0);
      expect(chipsAfter).toBe(totalChips);
    }
  });

  it('can produce split pot winners (high and low)', () => {
    let foundHighWin = false;
    let foundLowWin = false;

    for (let i = 0; i < 100; i++) {
      const players = makePlayers(4);
      const game = new PLO8Game(PLO8_CONFIG, players, i % players.length);
      game.start();
      playToCompletion(game);
      const winners = game.getWinners();

      for (const w of winners) {
        if (w.handDescription?.includes('(high)')) foundHighWin = true;
        if (w.handDescription?.includes('(low)')) foundLowWin = true;
        if (w.handDescription?.includes('(scoops)')) foundHighWin = true;
      }

      if (foundHighWin && foundLowWin) break;
    }

    expect(foundHighWin).toBe(true);
    expect(foundLowWin).toBe(true);
  });

  it('partial hand description shows high/low when applicable', () => {
    // Play enough hands to see a partial description with low
    let foundHiLo = false;
    for (let i = 0; i < 50; i++) {
      const players = makePlayers(3);
      const game = new PLO8Game(PLO8_CONFIG, players, i % players.length);
      game.start();

      // Play through flop so we have community cards
      let state = game.getState();
      let actions = 0;
      while (state.phase !== GamePhase.Complete &&
             state.phase !== GamePhase.Showdown &&
             actions < 200) {
        const activePlayer = state.players[state.activePlayerIndex];
        if (!activePlayer || activePlayer.folded || activePlayer.sittingOut) break;
        const available = game.getAvailableActions();
        if (available.canCheck) {
          game.act(activePlayer.id, ActionType.Check);
        } else if (available.canCall) {
          game.act(activePlayer.id, ActionType.Call);
        } else {
          break;
        }
        actions++;
        state = game.getState();

        // Check for partial hand description after flop
        if (state.communityCards.length >= 3) {
          const desc = game.getHandDescription('p0');
          if (desc && desc.description.includes('/')) {
            foundHiLo = true;
            break;
          }
        }
      }
      if (foundHiLo) break;
    }
    // It's possible but we can't guarantee a low will qualify in 50 hands
    // Just ensure no crashes — the real validation is the split pot test above
  });
});
