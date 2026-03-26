// ============================================================
// Stud Complete Raise Audit Tests
// ============================================================
// Specifically audits the "complete" mechanic: after bring-in,
// the first raise goes TO the small bet, not BY the small bet.
//
// Sequence with smallBet=5, bringIn=3:
// 1. Bring-in posts $3
// 2. First player completes TO $5 (not $8)
// 3. Next raise is TO $10 (5 + 5)
// 4. Next raise is TO $15 (10 + 5)
// 5. On 5th street (big bet=$10): raise is TO $20 (10 + 10)

import { describe, it, expect } from 'vitest';
import { RazzGame } from '../src/games/razz.js';
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

const RAZZ_CONFIG: TableConfig = {
  maxPlayers: 6,
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
// AUDIT TESTS
// ============================================================

describe('Stud Complete Raise Audit', () => {
  it('after bring-in of $3: minRaise (complete) is exactly $5, NOT $8', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Verify bring-in is set and currentBet is $3
    expect(state.currentBet).toBe(3);
    expect(state.bringIn).toBe(3);
    expect(state.smallBet).toBe(5);

    // First actor should have minRaise = $5 (the complete amount)
    const firstActor = state.players[state.activePlayerIndex];
    const available = game.getAvailableActions();

    expect(available.canRaise).toBe(true);
    expect(available.minRaise).toBe(5);
    expect(available.maxRaise).toBe(5); // Fixed limit: only one size

    // NOT $8 (bring-in $3 + small bet $5)
    expect(available.minRaise).not.toBe(8);
  });

  it('after completion to $5: next raise is to $10 (5 + 5)', () => {
    const players = makePlayers(3, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // First actor completes to $5
    const firstActorId = state.players[state.activePlayerIndex].id;
    game.act(firstActorId, ActionType.Raise, 5);

    state = game.getState();

    // Verify currentBet is now $5
    expect(state.currentBet).toBe(5);

    // Next player should have minRaise = $10 (5 + 5)
    const available = game.getAvailableActions();
    expect(available.canRaise).toBe(true);
    expect(available.minRaise).toBe(10);
    expect(available.maxRaise).toBe(10);

    // NOT $13 (bring-in $3 + two increments of $5)
    expect(available.minRaise).not.toBe(8);
    expect(available.minRaise).not.toBe(13);
  });

  it('after raise to $10: next raise is to $15 (10 + 5) on 3rd street', () => {
    const players = makePlayers(3, 1000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // First actor completes to $5
    const firstActorId = state.players[state.activePlayerIndex].id;
    game.act(firstActorId, ActionType.Raise, 5);

    state = game.getState();

    // Next player raises to $10
    const secondActorId = state.players[state.activePlayerIndex].id;
    game.act(secondActorId, ActionType.Raise, 10);

    state = game.getState();

    // Verify currentBet is now $10
    expect(state.currentBet).toBe(10);

    // Next player (who may be back to first actor) should have minRaise = $15
    const available = game.getAvailableActions();
    if (available.canRaise) {
      expect(available.minRaise).toBe(15);
      expect(available.maxRaise).toBe(15);
    }
  });

  it('on 5th street (big bet=$10): after a $10 bet, raise is to $20', () => {
    const players = makePlayers(3, 5000); // More chips for a longer hand
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // Play through 3rd and 4th streets to reach 5th
    let actions = 0;
    const maxActions = 100;

    while (state.phase !== GamePhase.BettingFifth && actions < maxActions) {
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
      } else {
        state = game.getState();
        actions++;
        continue;
      }

      state = game.getState();
      actions++;
    }

    // Should be on 5th street now
    expect(state.phase).toBe(GamePhase.BettingFifth);
    expect(state.bigBet).toBe(10); // Big bet in use on 5th street

    // Have someone bet $10 (the big bet)
    const active = state.players[state.activePlayerIndex];
    if (!active.folded && !active.allIn) {
      const available = game.getAvailableActions();

      if (available.canBet) {
        // Bet the big bet amount
        game.act(active.id, ActionType.Bet, 10);

        state = game.getState();

        // Next player's minRaise should be $20 (10 + 10)
        const nextAvailable = game.getAvailableActions();
        if (nextAvailable.canRaise) {
          expect(nextAvailable.minRaise).toBe(20);
          expect(nextAvailable.maxRaise).toBe(20);
        }
      }
    }
  });

  it('scenario: bring-in -> complete -> raise -> raise sequence validates correct amounts', () => {
    const players = makePlayers(3, 2000);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // PHASE 1: Bring-in is $3, currentBet = $3
    expect(state.currentBet).toBe(3);

    const firstActorId = state.players[state.activePlayerIndex].id;

    // PHASE 2: First actor completes to $5
    const available1 = game.getAvailableActions();
    expect(available1.minRaise).toBe(5);
    game.act(firstActorId, ActionType.Raise, 5);

    state = game.getState();
    expect(state.currentBet).toBe(5);

    // Next player is in the action
    const secondActorId = state.players[state.activePlayerIndex].id;

    // PHASE 3: Second actor raises to $10
    const available2 = game.getAvailableActions();
    expect(available2.minRaise).toBe(10);
    game.act(secondActorId, ActionType.Raise, 10);

    state = game.getState();
    expect(state.currentBet).toBe(10);

    // PHASE 4: Third player (if in hand) should have minRaise = $15
    const thirdActorId = state.players[state.activePlayerIndex].id;
    const available3 = game.getAvailableActions();

    if (available3.canRaise) {
      expect(available3.minRaise).toBe(15);
    }
  });

  it('complete does NOT stack: bring-in $3 -> complete $5, NOT bring-in + complete = $8', () => {
    const players = makePlayers(3);
    const game = new RazzGame(RAZZ_CONFIG, players, 0);
    game.start();

    let state = game.getState();

    // After bring-in ($3), complete should be TO $5
    const available = game.getAvailableActions();
    expect(available.minRaise).toBe(5);

    // The key check: minRaise should NOT be $8 (which would be 3 + 5)
    expect(available.minRaise).not.toBe(8);

    // Verify the logic: if currentBet (3) < increment (5), then minRaise = increment
    // NOT minRaise = currentBet + increment
    expect(state.currentBet).toBe(3);
    expect(state.smallBet).toBe(5);
    expect(available.minRaise).toBe(state.smallBet);
  });
});
