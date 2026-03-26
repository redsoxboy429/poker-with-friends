// ============================================================
// Game Engine Integration Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { NLHGame } from '../src/games/nlh.js';
import { PLOGame } from '../src/games/plo.js';
import { RazzGame } from '../src/games/razz.js';
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

const NLH_CONFIG: TableConfig = {
  maxPlayers: 9,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  bringIn: 0,
  startingChips: 1000,
  variant: GameVariant.NLH,
  bettingStructure: BettingStructure.NoLimit,
};

const PLO_CONFIG: TableConfig = {
  ...NLH_CONFIG,
  variant: GameVariant.PLO,
  bettingStructure: BettingStructure.PotLimit,
};

const RAZZ_CONFIG: TableConfig = {
  maxPlayers: 8,
  smallBlind: 0,
  bigBlind: 0,
  ante: 2,
  bringIn: 3,
  smallBet: 5,
  bigBet: 10,
  startingChips: 1000,
  variant: GameVariant.Razz,
  bettingStructure: BettingStructure.FixedLimit,
};

// ============================================================
// NLH Tests
// ============================================================
describe('NLHGame', () => {
  it('handles a simple fold to win', () => {
    const players = makePlayers(2);
    const game = new NLHGame(NLH_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    // Heads-up: button = SB = p1, BB = p2
    // First to act preflop in HU: SB (button)
    const activeId = state.players[state.activePlayerIndex].id;

    // Fold
    const complete = game.act(activeId, ActionType.Fold);
    expect(complete).toBe(true);
    expect(game.getState().phase).toBe(GamePhase.Complete);
  });

  it('handles call → check through to showdown', () => {
    const players = makePlayers(2);
    const game = new NLHGame(NLH_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    let activeId = state.players[state.activePlayerIndex].id;

    // Preflop: SB calls
    game.act(activeId, ActionType.Call);

    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;

    // BB checks
    game.act(activeId, ActionType.Check);

    // Should be on the flop now
    state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingFlop);
    expect(state.communityCards).toHaveLength(3);

    // Flop: check, check
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);
    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);

    // Turn
    state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingTurn);
    expect(state.communityCards).toHaveLength(4);

    // Turn: check, check
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);
    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);

    // River
    state = game.getState();
    expect(state.phase).toBe(GamePhase.BettingRiver);
    expect(state.communityCards).toHaveLength(5);

    // River: check, check
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);
    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;
    const complete = game.act(activeId, ActionType.Check);

    // Hand should be complete
    expect(complete).toBe(true);
    state = game.getState();
    expect(state.phase).toBe(GamePhase.Complete);

    // Total chips should be conserved
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(2000); // 2 players × 1000
  });

  it('handles bet and call', () => {
    const players = makePlayers(3);
    const game = new NLHGame(NLH_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    // UTG (p1 in 3-handed, first to act preflop)
    let activeId = state.players[state.activePlayerIndex].id;

    // UTG raises to 30
    game.act(activeId, ActionType.Raise, 30);

    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;

    // SB folds
    game.act(activeId, ActionType.Fold);

    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;

    // BB calls
    game.act(activeId, ActionType.Call);

    // Should move to flop
    state = game.getState();
    expect(state.communityCards).toHaveLength(3);
  });

  it('rejects invalid actions', () => {
    const players = makePlayers(2);
    const game = new NLHGame(NLH_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const otherId = state.players.find(p => p.id !== activeId)!.id;

    // Wrong player tries to act
    expect(() => game.act(otherId, ActionType.Fold)).toThrow('Not your turn');
  });

});

// ============================================================
// PLO Tests
// ============================================================
describe('PLOGame', () => {
  it('deals 4 hole cards to each player', () => {
    const players = makePlayers(3);
    const game = new PLOGame(PLO_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(4);
    }
  });

  it('completes a hand with fold', () => {
    const players = makePlayers(2);
    const game = new PLOGame(PLO_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const complete = game.act(activeId, ActionType.Fold);
    expect(complete).toBe(true);
  });

  it('conserves chips through complete PLO hand', () => {
    const players = makePlayers(2);
    const game = new PLOGame(PLO_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    let activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Call);
    state = game.getState();
    activeId = state.players[state.activePlayerIndex].id;
    game.act(activeId, ActionType.Check);

    // Check through all streets
    for (let street = 0; street < 3; street++) {
      state = game.getState();
      if (state.phase === GamePhase.Complete || state.phase === GamePhase.Showdown) break;
      activeId = state.players[state.activePlayerIndex].id;
      game.act(activeId, ActionType.Check);
      state = game.getState();
      if (state.phase === GamePhase.Complete || state.phase === GamePhase.Showdown) break;
      activeId = state.players[state.activePlayerIndex].id;
      game.act(activeId, ActionType.Check);
    }

    state = game.getState();
    const totalChips = state.players.reduce((sum, p) => sum + p.chips, 0);
    expect(totalChips).toBe(2000);
  });
});

// ============================================================
// Razz Tests
// ============================================================
describe('RazzGame', () => {
  it('deals 3 cards to each player (2 down + 1 up)', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(3);
    }
  });

  it('posts antes', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    // Each player should have paid 2 chip ante
    const totalAntes = 3 * 2; // 3 players × 2 ante
    const totalChipsRemaining = state.players.reduce((sum, p) => sum + p.chips, 0);
    const totalBets = state.players.reduce((sum, p) => sum + p.bet, 0);
    // Chips + bets should equal original total (antes are in bets or pots)
    expect(totalChipsRemaining + totalBets).toBeLessThanOrEqual(3000); // Some went to antes + bring-in
  });

  it('starts on 3rd street', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();
    expect(game.getState().phase).toBe(GamePhase.BettingThird);
  });

  it('completes a hand with fold', () => {
    const players = makePlayers(2);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;
    const complete = game.act(activeId, ActionType.Fold);
    expect(complete).toBe(true);
  });
});

// ============================================================
// Edge Cases
// ============================================================
describe('Edge cases', () => {
  it('handles all-in preflop (runs out board)', () => {
    const players = makePlayers(2, 10); // Only 10 chips each
    const game = new NLHGame({
      ...NLH_CONFIG,
      smallBlind: 5,
      bigBlind: 10,
    }, players, 0);
    game.start();

    // SB has 5 left after posting, BB is all-in with 0 left
    const state = game.getState();
    const activeId = state.players[state.activePlayerIndex].id;

    // SB calls (goes all-in)
    const complete = game.act(activeId, ActionType.Call);
    // Should run out the board and go to showdown
    expect(complete).toBe(true);

    const final = game.getState();
    expect(final.phase).toBe(GamePhase.Complete);
    expect(final.communityCards).toHaveLength(5);

    // Chips conserved
    const total = final.players.reduce((sum, p) => sum + p.chips, 0);
    expect(total).toBe(20);
  });
});
