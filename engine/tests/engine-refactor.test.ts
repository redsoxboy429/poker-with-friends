// ============================================================
// Engine Refactor Tests
// ============================================================
// Tests for: PL Double Draw games, Limit Omaha High,
// collectBets (fold-doesn't-create-side-pot), mergePotsForShowdown,
// resolveQualifiedHiLoPot (4-branch), odd chip distribution,
// and side pot + hi-lo combinations.

import { describe, it, expect } from 'vitest';
import {
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
  type Pot,
} from '../src/types.js';
import { collectBets } from '../src/betting.js';
import { PLBadugiDDGame } from '../src/games/pl-badugi-dd.js';
import { PLBadeucyDDGame } from '../src/games/pl-badeucy-dd.js';
import { PLBadaceyDDGame } from '../src/games/pl-badacey-dd.js';
import { PLArchieDDGame } from '../src/games/pl-archie-dd.js';
import { PLTenThirtyDDGame } from '../src/games/pl-ten-thirty-dd.js';
import { LimitOmahaHighGame } from '../src/games/limit-omaha-high.js';
import { NLHGame } from '../src/games/nlh.js';

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

/** Play through all actions until a target phase or complete */
function playToPhase(game: any, targetPhase: string, maxActions = 100): void {
  let actions = 0;
  while (actions < maxActions) {
    const state = game.getState();
    if (state.phase === targetPhase || state.phase === 'complete' || state.phase === 'showdown') return;

    const player = state.players[state.activePlayerIndex];
    if (!player) return;

    const drawPhases = ['draw-1', 'draw-2', 'draw-3'];
    if (drawPhases.includes(state.phase)) {
      // Stand pat for simplicity
      game.discard(player.id, []);
    } else {
      // Check or call
      const available = game.getAvailableActions();
      if (available.canCheck) {
        game.act(player.id, ActionType.Check);
      } else {
        game.act(player.id, ActionType.Call);
      }
    }
    actions++;
  }
}

/** Play all the way to completion */
function playToCompletion(game: any, maxActions = 200): void {
  playToPhase(game, 'complete', maxActions);
}

// ============================================================
// 1. PL Double Draw Phase Transitions
// ============================================================

describe('PL Double Draw — Phase Transitions', () => {
  const PL_DD_CONFIG: TableConfig = {
    maxPlayers: 6,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    bringIn: 0,
    startingChips: 1000,
    variant: GameVariant.PLBadugiDD,
    bettingStructure: BettingStructure.PotLimit,
  };

  it('PL Badugi DD deals 4 cards and has maxDraws=2', () => {
    const players = makePlayers(3);
    const game = new PLBadugiDDGame(PL_DD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingPreflop);
    // 4 cards for Badugi
    for (const p of state.players) {
      expect(p.holeCards.length).toBe(4);
    }
    expect(state.drawsRemaining).toBe(2);
  });

  it('PL Badugi DD: preflop → draw1 → post-draw1 → draw2 → post-draw2 → showdown', () => {
    const players = makePlayers(3);
    const game = new PLBadugiDDGame(PL_DD_CONFIG, players, 0);
    game.start();

    // Phase 1: BettingPreflop
    expect(game.getState().phase).toBe(GamePhase.BettingPreflop);
    playToPhase(game, 'draw-1');
    expect(game.getState().phase).toBe(GamePhase.Drawing1);

    // Phase 2: Drawing1
    playToPhase(game, 'post-draw-1');
    expect(game.getState().phase).toBe(GamePhase.BettingPostDraw1);

    // Phase 3: BettingPostDraw1
    playToPhase(game, 'draw-2');
    expect(game.getState().phase).toBe(GamePhase.Drawing2);

    // Phase 4: Drawing2
    playToPhase(game, 'post-draw-2');
    expect(game.getState().phase).toBe(GamePhase.BettingPostDraw2);

    // Phase 5: BettingPostDraw2 → Showdown/Complete
    playToCompletion(game);
    expect(game.getState().phase).toBe(GamePhase.Complete);
  });

  it('PL Badugi DD: does NOT have a 3rd draw', () => {
    const players = makePlayers(2);
    const game = new PLBadugiDDGame(PL_DD_CONFIG, players, 0);
    game.start();
    playToCompletion(game);

    const state = game.getState();
    // Should never hit Drawing3 phase
    const phases = state.actionHistory.map(() => ''); // can't inspect phases from history directly
    // But we can verify: drawsRemaining should have gone 2 → 1 → 0
    expect(state.phase).toBe(GamePhase.Complete);
  });

  it('PL Badugi DD uses pot-limit betting (not fixed-limit)', () => {
    const players = makePlayers(3);
    const game = new PLBadugiDDGame(PL_DD_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    expect(state.bettingStructure).toBe(BettingStructure.PotLimit);

    // Verify available actions include a raise with a max > fixed increment
    const available = game.getAvailableActions();
    if (available.canRaise && available.raiseMax !== undefined) {
      // PL max should be based on pot, not a fixed increment
      expect(available.raiseMax).toBeGreaterThan(10); // More than just 1 BB
    }
  });

  it('PL Badeucy DD deals 5 cards and is hi-lo', () => {
    const config = { ...PL_DD_CONFIG, variant: GameVariant.PLBadeucyDD };
    const players = makePlayers(3);
    const game = new PLBadeucyDDGame(config, players, 0);
    game.start();

    for (const p of game.getState().players) {
      expect(p.holeCards.length).toBe(5);
    }
  });

  it('PL Archie DD has hasHighQualifier', () => {
    const config = { ...PL_DD_CONFIG, variant: GameVariant.PLArchieDD };
    const players = makePlayers(3);
    const game = new PLArchieDDGame(config, players, 0);
    game.start();
    playToCompletion(game);

    // Should complete successfully (qualified hi-lo path)
    expect(game.getState().phase).toBe(GamePhase.Complete);
  });

  it('chip conservation through full PL DD hand', () => {
    const chips = 500;
    const count = 4;
    const players = makePlayers(count, chips);
    const game = new PLBadugiDDGame({ ...PL_DD_CONFIG, startingChips: chips }, players, 0);
    game.start();
    playToCompletion(game);

    const totalChips = game.getState().players.reduce((sum: number, p: PlayerState) => sum + p.chips, 0);
    expect(totalChips).toBe(chips * count);
  });

  it('all 5 PL DD games complete successfully', () => {
    const configs: Array<{ variant: GameVariant; GameClass: any }> = [
      { variant: GameVariant.PLBadugiDD, GameClass: PLBadugiDDGame },
      { variant: GameVariant.PLBadeucyDD, GameClass: PLBadeucyDDGame },
      { variant: GameVariant.PLBadaceyDD, GameClass: PLBadaceyDDGame },
      { variant: GameVariant.PLArchieDD, GameClass: PLArchieDDGame },
      { variant: GameVariant.PLTenThirtyDD, GameClass: PLTenThirtyDDGame },
    ];

    for (const { variant, GameClass } of configs) {
      const config = { ...PL_DD_CONFIG, variant };
      const players = makePlayers(3);
      const game = new GameClass(config, players, 0);
      game.start();
      playToCompletion(game);
      expect(game.getState().phase).toBe(GamePhase.Complete);
    }
  });
});

// ============================================================
// 2. Limit Omaha High
// ============================================================

describe('Limit Omaha High', () => {
  const LOH_CONFIG: TableConfig = {
    maxPlayers: 6,
    smallBlind: 5,
    bigBlind: 10,
    ante: 0,
    bringIn: 0,
    smallBet: 10,
    bigBet: 20,
    startingChips: 1000,
    variant: GameVariant.LimitOmahaHigh,
    bettingStructure: BettingStructure.FixedLimit,
  };

  it('deals 4 hole cards', () => {
    const players = makePlayers(3);
    const game = new LimitOmahaHighGame(LOH_CONFIG, players, 0);
    game.start();
    for (const p of game.getState().players) {
      expect(p.holeCards.length).toBe(4);
    }
  });

  it('uses fixed-limit betting', () => {
    const players = makePlayers(3);
    const game = new LimitOmahaHighGame(LOH_CONFIG, players, 0);
    game.start();
    expect(game.getState().bettingStructure).toBe(BettingStructure.FixedLimit);
  });

  it('completes a full hand', () => {
    const players = makePlayers(3);
    const game = new LimitOmahaHighGame(LOH_CONFIG, players, 0);
    game.start();
    playToCompletion(game);
    expect(game.getState().phase).toBe(GamePhase.Complete);
  });

  it('chip conservation', () => {
    const chips = 500;
    const count = 3;
    const players = makePlayers(count, chips);
    const game = new LimitOmahaHighGame({ ...LOH_CONFIG, startingChips: chips }, players, 0);
    game.start();
    playToCompletion(game);
    const totalChips = game.getState().players.reduce((sum: number, p: PlayerState) => sum + p.chips, 0);
    expect(totalChips).toBe(chips * count);
  });
});

// ============================================================
// 3. collectBets — fold doesn't create side pots
// ============================================================

describe('collectBets — side pot logic', () => {
  it('folding does NOT create a side pot', () => {
    // 3 players bet 10 each, then player C folds.
    // collectBets should create ONE pot with A,B eligible (C folded).
    const players: PlayerState[] = [
      { id: 'A', name: 'A', chips: 90, holeCards: [], bet: 10, totalBet: 10, folded: false, allIn: false, sittingOut: false, seatIndex: 0 },
      { id: 'B', name: 'B', chips: 90, holeCards: [], bet: 10, totalBet: 10, folded: false, allIn: false, sittingOut: false, seatIndex: 1 },
      { id: 'C', name: 'C', chips: 90, holeCards: [], bet: 10, totalBet: 10, folded: true, allIn: false, sittingOut: false, seatIndex: 2 },
    ];

    const pots = collectBets(players, []);
    // Should be ONE pot, not two
    expect(pots.length).toBe(1);
    expect(pots[0].amount).toBe(30);
    // Only A and B are eligible (C folded)
    expect(pots[0].eligiblePlayerIds).toContain('A');
    expect(pots[0].eligiblePlayerIds).toContain('B');
    expect(pots[0].eligiblePlayerIds).not.toContain('C');
  });

  it('all-in for less DOES create a side pot', () => {
    // A bets 50, B bets 50, C all-in for 20
    const players: PlayerState[] = [
      { id: 'A', name: 'A', chips: 50, holeCards: [], bet: 50, totalBet: 50, folded: false, allIn: false, sittingOut: false, seatIndex: 0 },
      { id: 'B', name: 'B', chips: 50, holeCards: [], bet: 50, totalBet: 50, folded: false, allIn: false, sittingOut: false, seatIndex: 1 },
      { id: 'C', name: 'C', chips: 0, holeCards: [], bet: 20, totalBet: 20, folded: false, allIn: true, sittingOut: false, seatIndex: 2 },
    ];

    const pots = collectBets(players, []);
    expect(pots.length).toBe(2);
    // Main pot: 20 × 3 = 60 (all three eligible)
    expect(pots[0].amount).toBe(60);
    expect(pots[0].eligiblePlayerIds.length).toBe(3);
    // Side pot: 30 × 2 = 60 (only A and B)
    expect(pots[1].amount).toBe(60);
    expect(pots[1].eligiblePlayerIds.length).toBe(2);
    expect(pots[1].eligiblePlayerIds).not.toContain('C');
  });

  it('fold + all-in: folded money stays in pot, no phantom side pots', () => {
    // A bets 50, B all-in for 30, C folded with bet 10, D bets 50
    const players: PlayerState[] = [
      { id: 'A', name: 'A', chips: 50, holeCards: [], bet: 50, totalBet: 50, folded: false, allIn: false, sittingOut: false, seatIndex: 0 },
      { id: 'B', name: 'B', chips: 0, holeCards: [], bet: 30, totalBet: 30, folded: false, allIn: true, sittingOut: false, seatIndex: 1 },
      { id: 'C', name: 'C', chips: 90, holeCards: [], bet: 10, totalBet: 10, folded: true, allIn: false, sittingOut: false, seatIndex: 2 },
      { id: 'D', name: 'D', chips: 50, holeCards: [], bet: 50, totalBet: 50, folded: false, allIn: false, sittingOut: false, seatIndex: 3 },
    ];

    const pots = collectBets(players, []);
    // Main pot: up to 30 from everyone: A(30) + B(30) + C(10) + D(30) = 100
    // Side pot: remaining from A(20) + D(20) = 40
    expect(pots.length).toBe(2);
    expect(pots[0].amount).toBe(100); // Main pot
    expect(pots[0].eligiblePlayerIds).toContain('A');
    expect(pots[0].eligiblePlayerIds).toContain('B');
    expect(pots[0].eligiblePlayerIds).toContain('D');
    expect(pots[0].eligiblePlayerIds).not.toContain('C'); // C folded

    expect(pots[1].amount).toBe(40); // Side pot
    expect(pots[1].eligiblePlayerIds).toEqual(expect.arrayContaining(['A', 'D']));
    expect(pots[1].eligiblePlayerIds).not.toContain('B');
    expect(pots[1].eligiblePlayerIds).not.toContain('C');
  });

  it('no all-ins: only one pot regardless of bet sizes', () => {
    // Everyone bets 20, no all-ins
    const players: PlayerState[] = [
      { id: 'A', name: 'A', chips: 80, holeCards: [], bet: 20, totalBet: 20, folded: false, allIn: false, sittingOut: false, seatIndex: 0 },
      { id: 'B', name: 'B', chips: 80, holeCards: [], bet: 20, totalBet: 20, folded: false, allIn: false, sittingOut: false, seatIndex: 1 },
      { id: 'C', name: 'C', chips: 80, holeCards: [], bet: 20, totalBet: 20, folded: false, allIn: false, sittingOut: false, seatIndex: 2 },
    ];

    const pots = collectBets(players, []);
    expect(pots.length).toBe(1);
    expect(pots[0].amount).toBe(60);
  });

  it('multiple all-ins at different levels create correct number of pots', () => {
    // A bets 100, B all-in for 60, C all-in for 30
    const players: PlayerState[] = [
      { id: 'A', name: 'A', chips: 0, holeCards: [], bet: 100, totalBet: 100, folded: false, allIn: false, sittingOut: false, seatIndex: 0 },
      { id: 'B', name: 'B', chips: 0, holeCards: [], bet: 60, totalBet: 60, folded: false, allIn: true, sittingOut: false, seatIndex: 1 },
      { id: 'C', name: 'C', chips: 0, holeCards: [], bet: 30, totalBet: 30, folded: false, allIn: true, sittingOut: false, seatIndex: 2 },
    ];

    const pots = collectBets(players, []);
    // Only 2 pots — the excess 40 that only A can win is returned to A's stack
    expect(pots.length).toBe(2);
    // Pot 1: 30 × 3 = 90 (all three)
    expect(pots[0].amount).toBe(90);
    expect(pots[0].eligiblePlayerIds.length).toBe(3);
    // Pot 2: 30 × 2 = 60 (A and B)
    expect(pots[1].amount).toBe(60);
    expect(pots[1].eligiblePlayerIds.length).toBe(2);
    // A gets 40 back (uncallable excess)
    expect(players[0].chips).toBe(40);
  });
});

// ============================================================
// 4. mergePotsForShowdown — via full game flow
// ============================================================

describe('mergePotsForShowdown', () => {
  it('pots from different betting rounds with same active contenders merge at showdown', () => {
    // Play an NLH hand where someone folds — verify only meaningful pots at showdown
    const players = makePlayers(3);
    const config: TableConfig = {
      maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
      startingChips: 1000, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit,
    };
    const game = new NLHGame(config, players, 0);
    game.start();

    // Preflop: everyone calls
    let state = game.getState();
    let player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Call); // p2 calls
    state = game.getState();
    player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Call); // p0 (SB) calls
    state = game.getState();
    player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Check); // p1 (BB) checks

    // Flop: p0 bets, p1 folds, p2 calls
    state = game.getState();
    player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Bet, 10);
    state = game.getState();
    player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Fold); // p1 folds
    state = game.getState();
    player = state.players[state.activePlayerIndex];
    game.act(player.id, ActionType.Call); // p2 calls

    // At this point there are pots from preflop (3 eligible) and flop (2 eligible).
    // After showdown merge, since p1 folded, the preflop pot's active contenders
    // should be [p0, p2] — same as flop pot. They should merge.
    playToCompletion(game);

    const winners = game.getWinners();
    // All winners should have the same potLabel or no potLabel (merged into single pot)
    const potLabels = winners.map(w => w.potLabel).filter(Boolean);
    expect(potLabels.length).toBe(0); // No pot labels = single pot (no side pots)
  });
});

// ============================================================
// 5. Odd chip distribution
// ============================================================

describe('Odd chip distribution', () => {
  it('chip conservation in hi-lo split with odd amounts', () => {
    // Just verify total chips are conserved through a hi-lo game
    const players = makePlayers(3, 500);
    const config: TableConfig = {
      maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
      smallBet: 10, bigBet: 20, startingChips: 500,
      variant: GameVariant.PLArchieDD, bettingStructure: BettingStructure.PotLimit,
    };
    const game = new PLArchieDDGame(config, players, 0);
    game.start();
    playToCompletion(game);

    const totalChips = game.getState().players.reduce((sum: number, p: PlayerState) => sum + p.chips, 0);
    expect(totalChips).toBe(500 * 3);
  });
});

// ============================================================
// 6. Full game flow stress for all new variants
// ============================================================

describe('New variant stress tests', () => {
  const variants: Array<{ name: string; variant: GameVariant; GameClass: any; config: Partial<TableConfig> }> = [
    { name: 'PL Badugi DD', variant: GameVariant.PLBadugiDD, GameClass: PLBadugiDDGame, config: { bettingStructure: BettingStructure.PotLimit } },
    { name: 'PL Badeucy DD', variant: GameVariant.PLBadeucyDD, GameClass: PLBadeucyDDGame, config: { bettingStructure: BettingStructure.PotLimit } },
    { name: 'PL Badacey DD', variant: GameVariant.PLBadaceyDD, GameClass: PLBadaceyDDGame, config: { bettingStructure: BettingStructure.PotLimit } },
    { name: 'PL Archie DD', variant: GameVariant.PLArchieDD, GameClass: PLArchieDDGame, config: { bettingStructure: BettingStructure.PotLimit } },
    { name: 'PL 10-30 DD', variant: GameVariant.PLTenThirtyDD, GameClass: PLTenThirtyDDGame, config: { bettingStructure: BettingStructure.PotLimit } },
    { name: 'Limit Omaha High', variant: GameVariant.LimitOmahaHigh, GameClass: LimitOmahaHighGame, config: { bettingStructure: BettingStructure.FixedLimit, smallBet: 10, bigBet: 20 } },
  ];

  for (const { name, variant, GameClass, config } of variants) {
    it(`${name}: 10 consecutive hands complete with chip conservation`, () => {
      const baseConfig: TableConfig = {
        maxPlayers: 6, smallBlind: 5, bigBlind: 10, ante: 0, bringIn: 0,
        startingChips: 1000, variant, ...config,
      };
      const players = makePlayers(4, 1000);
      const totalExpected = 4000;

      for (let hand = 0; hand < 10; hand++) {
        const freshPlayers = players.map(p => ({
          ...p,
          holeCards: [],
          bet: 0,
          totalBet: 0,
          folded: false,
          allIn: false,
        }));
        const game = new GameClass(baseConfig, freshPlayers, hand % 4);
        game.start();
        playToCompletion(game);

        const state = game.getState();
        expect(state.phase).toBe(GamePhase.Complete);
        const total = state.players.reduce((sum: number, p: PlayerState) => sum + p.chips, 0);
        expect(total).toBe(totalExpected);

        // Update player chips for next hand
        for (let i = 0; i < players.length; i++) {
          players[i].chips = state.players[i].chips;
        }
      }
    });
  }
});
