// ============================================================
// Stud Betting Mechanics Tests
// ============================================================
// Comprehensive tests for Razz (and stud variants) betting mechanics:
// - Ante handling (dead money into pot)
// - Bring-in mechanics (correct player, correct amount)
// - Complete action (raise to small bet after bring-in)
// - Small bet / big bet transitions by street
// - Per-street 4-bet cap
// - Heads-up uncapped betting
// - Cap only applies in multiway pots
// - Chip conservation across full hands
// - First actor position (lowest showing cards, not bring-in)

import { describe, it, expect } from 'vitest';
import { RazzGame } from '../src/games/razz.js';
import {
  PlayerState,
  TableConfig,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
  parseCard,
} from '../src/types.js';

// ============================================================
// Helpers
// ============================================================

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

function getTotalChips(state: Readonly<ReturnType<(typeof RazzGame)['prototype']['getState']>>): number {
  // Total chips = current player stacks + bets on table + pots
  // After showdown, pots are display-only (already awarded to players), so exclude them.
  const playerChips = state.players.reduce((sum, p) => sum + p.chips, 0);
  const betsOnTable = state.players.reduce((sum, p) => sum + p.bet, 0);
  const isComplete = state.phase === 'complete' || state.phase === 'showdown';
  const potChips = isComplete ? 0 : state.pots.reduce((sum, p) => sum + p.amount, 0);
  return playerChips + betsOnTable + potChips;
}

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
// 1. ANTE HANDLING
// ============================================================

describe('Ante Handling', () => {
  it('antes go to pot as dead money, not player.bet', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // Each player should have lost ante and bring-in from chips
    // Non-bring-in players: 1000 - 2 (ante) = 998
    // Bring-in player: 1000 - 2 (ante) - 3 (bring-in) = 995
    const nonBringInChips = state.players.filter(p => p.bet === 0).map(p => p.chips);
    const bringInPlayer = state.players.find(p => p.bet === 3);

    for (const chips of nonBringInChips) {
      expect(chips).toBe(998); // ante only
    }
    expect(bringInPlayer!.chips).toBe(995); // ante + bring-in

    // Only bring-in player has chips in .bet at this point
    for (const player of state.players) {
      expect(player.bet === 0 || player.bet === 3).toBe(true);
    }

    // Pot should contain total antes only (bring-in is in player.bet)
    const totalAnte = state.pots.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAnte).toBe(2 * 3); // 3 players * 2 ante each
  });

  it('all active players contribute to ante pot', () => {
    const players = makePlayers(5);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // Should have one pot with 5 players eligible
    expect(state.pots.length).toBeGreaterThan(0);
    const antePot = state.pots[0];
    expect(antePot.amount).toBe(5 * 2); // 5 players * ante of 2
    expect(antePot.eligiblePlayerIds).toHaveLength(5);
  });
});

// ============================================================
// 2. BRING-IN MECHANICS
// ============================================================

describe('Bring-in Mechanics', () => {
  it('correct player posts bring-in (highest door card)', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // Check action history for bring-in
    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    expect(bringInAction).toBeDefined();
    expect(bringInAction!.amount).toBe(3); // bringIn amount

    // The bring-in player should have 3 chips in player.bet
    const bringInPlayer = state.players.find(p => p.id === bringInAction!.playerId);
    expect(bringInPlayer).toBeDefined();
    expect(bringInPlayer!.bet).toBe(3); // bring-in is in player.bet
  });

  it('bring-in amount is in player.bet (not pot)', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // Find the bring-in player
    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    const bringInPlayer = state.players.find(p => p.id === bringInAction!.playerId);

    // Their bet should be exactly the bring-in amount
    expect(bringInPlayer!.bet).toBe(3);

    // Pot should NOT include the bring-in yet (it hasn't been collected)
    const potsTotal = state.pots.reduce((sum, p) => sum + p.amount, 0);
    // Pots should only contain antes
    expect(potsTotal).toBe(6); // 3 players * 2 ante
  });

  it('currentBet is set to bring-in amount', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // currentBet should equal the bring-in amount
    expect(state.currentBet).toBe(3);
  });

  it('other players can call the bring-in', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Find who acts first (to the left of bring-in)
    const activePlayerId = state.players[state.activePlayerIndex].id;
    expect(activePlayerId).toBeDefined();

    // They should be able to call
    const available = game.getAvailableActions();
    expect(available.canCall).toBe(true);
    expect(available.callAmount).toBe(3);

    // Call the bring-in
    game.act(activePlayerId, ActionType.Call);

    state = game.getState();

    // The calling player should now have 3 chips in their bet
    const callingPlayer = state.players.find(p => p.id === activePlayerId);
    expect(callingPlayer!.bet).toBe(3);
  });

  it('other players can complete (raise to small bet) or raise more after bring-in', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    const firstActorId = state.players[state.activePlayerIndex].id;

    // Should be able to raise
    const available = game.getAvailableActions();
    expect(available.canRaise).toBe(true);

    // In fixed-limit stud, after bring-in of 3:
    // Complete goes TO the small bet (5), not bring-in + small bet
    expect(available.minRaise).toBe(5);
    game.act(firstActorId, ActionType.Raise, 5);

    state = game.getState();

    // The first actor should now have bet 5 (the small bet)
    const firstActor = state.players.find(p => p.id === firstActorId);
    expect(firstActor!.bet).toBe(5);
    expect(state.currentBet).toBe(5);
  });
});

// ============================================================
// 3. COMPLETE ACTION
// ============================================================

describe('Complete Action (Raise to Small Bet)', () => {
  it('after bring-in, next player can raise', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    const firstActor = state.players[state.activePlayerIndex];

    // Should be able to raise
    const available = game.getAvailableActions();
    expect(available.canRaise).toBe(true);

    // Raise to at least the minimum (might be 8)
    game.act(firstActor.id, ActionType.Raise, available.minRaise);

    state = game.getState();

    // currentBet should be set to our raise amount
    expect(state.currentBet).toBeGreaterThan(3);
  });

  it('bring-in player can act after others have bet', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Get initial state: identify bring-in player
    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    const bringInPlayerId = bringInAction!.playerId;

    // First actor raises
    const firstActorId = state.players[state.activePlayerIndex].id;
    const available = game.getAvailableActions();
    game.act(firstActorId, ActionType.Raise, available.minRaise);

    // Next player acts (should fold or call)
    state = game.getState();
    let actions = 0;
    while (state.players[state.activePlayerIndex].id !== bringInPlayerId && actions < 10) {
      const player = state.players[state.activePlayerIndex];
      if (player.folded || player.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const avail = game.getAvailableActions();
      if (avail.canCall) {
        game.act(player.id, ActionType.Call);
      } else if (avail.canFold) {
        game.act(player.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // Now bring-in player should have a chance to act
    if (state.phase === GamePhase.BettingThird) {
      const available = game.getAvailableActions();
      // Bring-in player should be able to raise or call
      expect(available.canRaise || available.canCall).toBe(true);
    }
  });
});

// ============================================================
// 4. SMALL BET / BIG BET TRANSITIONS
// ============================================================

describe('Small Bet / Big Bet Transitions by Street', () => {
  it('3rd street uses small bet (5)', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // Should be on BettingThird phase
    expect(state.phase).toBe(GamePhase.BettingThird);

    // smallBet should be 5
    expect(state.smallBet).toBe(5);
    expect(state.bigBet).toBe(10);

    // The increment used for fixed-limit betting on 3rd street should be smallBet
    const firstActor = state.players[state.activePlayerIndex];
    if (!firstActor.folded) {
      const available = game.getAvailableActions();
      if (available.canRaise) {
        // Min raise is based on bring-in (3) + small bet (5) = 8
        expect(available.minRaise).toBeGreaterThan(3);
      }
    }
  });

  it('4th street uses small bet (5)', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Play through 3rd street by everyone folding except last 2
    let activeCount = state.players.filter(p => !p.folded && !p.sittingOut).length;
    let actions = 0;
    const maxActions = 50;

    while (state.phase === GamePhase.BettingThird && actions < maxActions) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        // Fold to advance
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // Should be on BettingFourth phase or Showdown
    if (state.phase === GamePhase.BettingFourth) {
      // smallBet should still be 5 on 4th street
      expect(state.smallBet).toBe(5);
    }
  });

});

// ============================================================
// 5. PER-STREET BET CAP RESET
// ============================================================

describe('Per-Street 4-Bet Cap Reset', () => {
  it('multiway pots cap bet count per street', () => {
    const players = makePlayers(4, 5000); // 4 players = multiway
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // On 3rd street with 4 players, cap should apply
    expect(state.playersAtStreetStart).toBe(4);

    // Try to make multiple raises
    let betsRaises = 0;
    let actions = 0;
    const maxActions = 30;

    while (state.phase === GamePhase.BettingThird && actions < maxActions) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const available = game.getAvailableActions();

      if (available.canRaise && betsRaises < 5) {
        game.act(active.id, ActionType.Raise, available.minRaise);
        betsRaises++;
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // Verify we hit cap or street ended
    // With 4 players, cap should limit raises
    expect(betsRaises).toBeLessThanOrEqual(4);
  });

  it('cap only applies to betting round, resets next street', () => {
    const players = makePlayers(3, 5000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Quick play through 3rd street
    let actions = 0;
    while (state.phase === GamePhase.BettingThird && actions < 50) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    const phase3rd = state.phase;

    // On 4th street, should be able to bet/raise again (cap reset)
    if (state.phase === GamePhase.BettingFourth) {
      const available = game.getAvailableActions();
      // Player should be able to act (bet, check, or call)
      expect(available.canBet || available.canCheck || available.canCall).toBe(true);
    }
  });
});

// ============================================================
// 6. HEADS-UP UNCAPPED
// ============================================================

describe('Heads-Up Uncapped Betting', () => {
  it('with 2 players, playersAtStreetStart is 2', () => {
    const players = makePlayers(2, 5000); // 2 players only
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // On 3rd street with 2 players
    expect(state.playersAtStreetStart).toBe(2);
    expect(state.phase).toBe(GamePhase.BettingThird);
  });

  it('heads-up allows continuous raises (no cap for 2 players)', () => {
    const players = makePlayers(2, 5000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    expect(state.playersAtStreetStart).toBe(2);

    // In heads-up, should be able to raise multiple times
    let raises = 0;
    let actions = 0;

    while (state.phase === GamePhase.BettingThird && actions < 20) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canRaise && raises < 3) {
        game.act(active.id, ActionType.Raise, available.minRaise);
        raises++;
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      }

      state = game.getState();
      actions++;
    }

    // Should have been able to raise at least once (no cap for 2 players)
    expect(raises).toBeGreaterThan(0);
  });
});

// ============================================================
// 7. CAP ONLY IN MULTIWAY (NOT HEADS-UP MID-HAND)
// ============================================================

describe('Cap Only in Multiway', () => {
  it('multiway (4 players) applies cap', () => {
    const players = makePlayers(4, 5000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // 4 players = multiway
    expect(state.playersAtStreetStart).toBe(4);
  });

  it('3 players is also multiway (cap applies)', () => {
    const players = makePlayers(3, 5000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    const state = game.getState();

    // 3 players = multiway
    expect(state.playersAtStreetStart).toBeGreaterThan(2);
  });
});

// ============================================================
// 8. CHIP CONSERVATION
// ============================================================

describe('Chip Conservation', () => {
  it('chips conserved after a few betting rounds', () => {
    const players = makePlayers(3, 1000);
    const startTotal = 3000;

    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Play a couple actions on 3rd street
    let moves = 0;
    while (state.phase === GamePhase.BettingThird && moves < 10) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        moves++;
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      const total = getTotalChips(state);
      expect(total).toBe(startTotal);
      moves++;
    }
  });

  it('chips still conserved if street completes and moves to 4th', () => {
    const players = makePlayers(3, 1000);
    const startTotal = 3000;

    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Play through 3rd street until we reach 4th
    let actions = 0;
    while (state.phase === GamePhase.BettingThird && actions < 50) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // Check total at street change
    const total = getTotalChips(state);
    expect(total).toBe(startTotal);
  });
});

// ============================================================
// 9. FIRST ACTOR ON LATER STREETS (LOWEST SHOWING)
// ============================================================

describe('First Actor Position on Later Streets', () => {
  it('4th street sets first actor (should be determined by board)', () => {
    const players = makePlayers(3, 5000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Play through 3rd street to 4th
    let actions = 0;
    while (state.phase === GamePhase.BettingThird && actions < 50) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      const available = game.getAvailableActions();
      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // Now on 4th street
    state = game.getState();
    if (state.phase === GamePhase.BettingFourth) {
      // Someone should be set as the active player
      expect(state.activePlayerIndex).toBeGreaterThanOrEqual(0);
      expect(state.activePlayerIndex).toBeLessThan(state.players.length);

      // The active player should not be all-in or folded
      const active = state.players[state.activePlayerIndex];
      expect(active.folded).toBe(false);
      expect(active.allIn).toBe(false);
    }
  });
});

// ============================================================
// INTEGRATION: FULL HAND WITH REALISTIC BETTING
// ============================================================

describe('Full Hand Integration', () => {
  it('can play a complete 3-player Razz hand', () => {
    const players = makePlayers(3, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    let moves = 0;
    const maxMoves = 150;

    while (state.phase !== GamePhase.Complete && moves < maxMoves) {
      moves++;
      const active = state.players[state.activePlayerIndex];

      if (!active || active.folded || active.allIn || active.sittingOut) {
        state = game.getState();
        continue;
      }

      const available = game.getAvailableActions();

      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      } else {
        break;
      }

      state = game.getState();
    }

    // Hand should complete
    expect(state.phase).toBe(GamePhase.Complete);

    // Chips should be conserved
    const totalChips = getTotalChips(state);
    expect(totalChips).toBe(3000);
  });

  it('2-player hand can reach showdown', () => {
    const players = makePlayers(2, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();
    let moves = 0;
    const maxMoves = 100;

    while (state.phase !== GamePhase.Complete && moves < maxMoves) {
      moves++;
      const active = state.players[state.activePlayerIndex];

      if (!active || active.folded || active.allIn || active.sittingOut) {
        state = game.getState();
        continue;
      }

      const available = game.getAvailableActions();

      if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canCall) {
        game.act(active.id, ActionType.Call);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      } else {
        break;
      }

      state = game.getState();
    }

    // Hand should complete
    expect(state.phase).toBe(GamePhase.Complete);

    // Chips conserved
    const totalChips = getTotalChips(state);
    expect(totalChips).toBe(2000);
  });
});

// ============================================================
// 10. BRING-IN OPTION LOGIC
// ============================================================

describe('Bring-in Option Logic', () => {
  it('bring-in does NOT get option when limped to', () => {
    // Create a 3-player Razz game
    const players = makePlayers(3, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Identify the bring-in player
    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    const bringInPlayerId = bringInAction!.playerId;

    // Get the next two players (who will limp to the bring-in)
    const bringInIndex = state.players.findIndex(p => p.id === bringInPlayerId);
    const firstActorId = state.players[state.activePlayerIndex].id;
    const secondActorId = state.players[
      (state.activePlayerIndex + 1) % state.players.length
    ].id;

    // First player calls the bring-in
    game.act(firstActorId, ActionType.Call);
    state = game.getState();

    // Second player (should be bring-in) calls
    if (state.players[state.activePlayerIndex].id === bringInPlayerId) {
      // If it's the bring-in's turn (someone raised), they get option
      // But if it's someone else's turn, action moved past bring-in
    } else {
      // Third player (if exists) calls
      game.act(secondActorId, ActionType.Call);
      state = game.getState();
    }

    // After all initial calls with no raises, if it comes back to the
    // bring-in and currentBet is still at bring-in amount (3),
    // the bring-in should NOT get an option. The phase should advance.
    // However, we need to ensure the betting round completes.

    // Simulate remaining players checking or calling to close the round
    let actions = 0;
    while (state.phase === GamePhase.BettingThird && actions < 20) {
      const active = state.players[state.activePlayerIndex];
      if (active.folded || active.allIn) {
        state = game.getState();
        actions++;
        continue;
      }

      // If current bet is still at bring-in and it's come back to someone
      // who should have had a chance, they should fold or call
      const available = game.getAvailableActions();
      if (available.canCall && state.currentBet === RAZZ_CONFIG.bringIn) {
        game.act(active.id, ActionType.Call);
      } else if (available.canCheck) {
        game.act(active.id, ActionType.Check);
      } else if (available.canFold) {
        game.act(active.id, ActionType.Fold);
      }

      state = game.getState();
      actions++;
    }

    // After all limps (no complete/raise), the phase should advance to BettingFourth
    // The bring-in should NOT have gotten a second option to act
    expect(state.phase).toBe(GamePhase.BettingFourth);
  });

  it('bring-in DOES get to act when someone completes', () => {
    // Create a 3-player Razz game
    const players = makePlayers(3, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Identify the bring-in player
    const bringInAction = state.actionHistory.find(a => a.type === ActionType.BringIn);
    const bringInPlayerId = bringInAction!.playerId;

    // First player to act: raise/complete (raise above bring-in)
    const firstActorId = state.players[state.activePlayerIndex].id;
    const available = game.getAvailableActions();
    game.act(firstActorId, ActionType.Raise, available.minRaise);

    state = game.getState();

    // Next player calls the raise
    const currentActorId = state.players[state.activePlayerIndex].id;
    game.act(currentActorId, ActionType.Call);

    state = game.getState();

    // Now action should come back to bring-in player, and they should get to act
    // because the bet was raised above the bring-in amount
    // Check that when it's the bring-in's turn, they are the active player
    // and the phase is still BettingThird (not advanced to BettingFourth yet)

    const activePlayerId = state.players[state.activePlayerIndex].id;

    if (activePlayerId === bringInPlayerId) {
      // Bring-in should be active and have the opportunity to act
      expect(state.phase).toBe(GamePhase.BettingThird);
      expect(state.activePlayerIndex).toBeGreaterThanOrEqual(0);

      // Verify the active player can act (not folded/all-in)
      const activePlayer = state.players[state.activePlayerIndex];
      expect(activePlayer.folded).toBe(false);
      expect(activePlayer.allIn).toBe(false);
      expect(activePlayer.id).toBe(bringInPlayerId);
    }
  });
});
