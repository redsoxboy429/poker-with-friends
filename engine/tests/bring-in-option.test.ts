// ============================================================
// Bring-In Option Tests — Stud Poker
// ============================================================
// These tests verify that the bring-in option logic works correctly.
// In stud, the bring-in is a forced partial bet. If nobody raises
// (completes) above the bring-in, the bring-in player does NOT get
// an option — the betting round ends. If someone completes/raises,
// the bring-in player DOES get to act.
//
// Scenarios tested:
// A. Limp around: bring-in posts, all call bring-in amount → round ends
// B. Someone completes: bring-in posts, next player raises → bring-in gets option
// C. Everyone folds to bring-in: bring-in posts, all fold → bring-in wins
// D. One call, one fold: bring-in posts, call, fold, call → round ends

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

describe('Bring-In Option Logic', () => {
  describe('Scenario A: Limp Around (no completion)', () => {
    it('should end betting round when all players call bring-in', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // At this point: bring-in has posted, currentBet = 3
      // Find who the bring-in is and who acts first
      let bringingInPlayer: PlayerState | null = null;
      let bringInIndex = -1;
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].bet === 3) {
          bringingInPlayer = state.players[i];
          bringInIndex = i;
          break;
        }
      }
      expect(bringingInPlayer).not.toBeNull();
      expect(state.currentBet).toBe(3);

      // Action is to the left of bring-in
      const firstActorId = state.players[state.activePlayerIndex].id;
      expect(firstActorId).not.toBe(bringingInPlayer!.id);

      // Player 2 calls
      game.act(firstActorId, ActionType.Call);
      state = game.getState();
      expect(state.currentBet).toBe(3);

      // Player 3 calls
      const player3Id = state.players[state.activePlayerIndex].id;
      expect(player3Id).not.toBe(firstActorId);
      expect(player3Id).not.toBe(bringingInPlayer!.id);
      game.act(player3Id, ActionType.Call);
      state = game.getState();

      // Player 4 calls
      const player4Id = state.players[state.activePlayerIndex].id;
      expect(player4Id).not.toBe(bringingInPlayer!.id);
      game.act(player4Id, ActionType.Call);
      state = game.getState();

      // Now the round should be complete. No more action, we move to next street.
      // The bring-in player should NOT be the active player.
      expect(state.phase).toBe(GamePhase.BettingFourth);
    });
  });

  describe('Scenario B: Someone Completes', () => {
    it('should give bring-in an option when someone raises to small bet', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Find bring-in player
      let bringingInPlayer: PlayerState | null = null;
      let bringInIndex = -1;
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].bet === 3) {
          bringingInPlayer = state.players[i];
          bringInIndex = i;
          break;
        }
      }
      expect(bringingInPlayer).not.toBeNull();

      // Player to left of bring-in completes to 5 (the small bet)
      const completerIdInitial = state.players[state.activePlayerIndex].id;
      game.act(completerIdInitial, ActionType.Raise, 5);
      state = game.getState();
      expect(state.currentBet).toBe(5);

      // Next player calls 5
      const player3Id = state.players[state.activePlayerIndex].id;
      game.act(player3Id, ActionType.Call);
      state = game.getState();

      // Next player calls 8
      const player4Id = state.players[state.activePlayerIndex].id;
      game.act(player4Id, ActionType.Call);
      state = game.getState();

      // Now bring-in player should be active
      const nowActiveId = state.players[state.activePlayerIndex].id;
      expect(nowActiveId).toBe(bringingInPlayer!.id);
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Bring-in can now call the raise
      game.act(bringingInPlayer!.id, ActionType.Call);
      state = game.getState();

      // Now round should be complete and move to next street
      expect(state.phase).toBe(GamePhase.BettingFourth);
    });
  });

  describe('Scenario C: Everyone Folds to Bring-In', () => {
    it('should award pot when all players fold to bring-in', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Find bring-in player
      let bringingInPlayer: PlayerState | null = null;
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].bet === 3) {
          bringingInPlayer = state.players[i];
          break;
        }
      }
      expect(bringingInPlayer).not.toBeNull();

      // All other players fold
      let foldCount = 0;
      while (
        state.phase === GamePhase.BettingThird &&
        state.players[state.activePlayerIndex].id !== bringingInPlayer!.id
      ) {
        const activeId = state.players[state.activePlayerIndex].id;
        game.act(activeId, ActionType.Fold);
        foldCount++;
        state = game.getState();
      }

      // Hand should be complete (3 players folded)
      expect(foldCount).toBe(3);
      expect(state.phase).toBe(GamePhase.Complete);

      // Bring-in should have won the antes
      const winners = game.getWinners();
      expect(winners.length).toBe(1);
      expect(winners[0].playerId).toBe(bringingInPlayer!.id);
    });
  });

  describe('Scenario D: One Call, One Fold, One Call', () => {
    it('should end round when bring-in and remainders all matched', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Find bring-in player
      let bringingInPlayer: PlayerState | null = null;
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].bet === 3) {
          bringingInPlayer = state.players[i];
          break;
        }
      }
      expect(bringingInPlayer).not.toBeNull();

      // Sequence: call, fold, call
      // Player to left of bring-in calls
      const player2Id = state.players[state.activePlayerIndex].id;
      game.act(player2Id, ActionType.Call);
      state = game.getState();
      expect(state.currentBet).toBe(3);

      // Next player folds
      const player3Id = state.players[state.activePlayerIndex].id;
      game.act(player3Id, ActionType.Fold);
      state = game.getState();

      // Next player calls
      const player4Id = state.players[state.activePlayerIndex].id;
      game.act(player4Id, ActionType.Call);
      state = game.getState();

      // Round should now be complete
      // All remaining players have matched the bet and acted
      expect(state.phase).toBe(GamePhase.BettingFourth);
    });
  });

  describe('Edge Cases', () => {
    it('should allow bring-in to check (not fold) when no one has acted yet', () => {
      // This verifies basic bring-in setup
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      let bringingInPlayer: PlayerState | null = null;
      for (let i = 0; i < state.players.length; i++) {
        if (state.players[i].bet === 3) {
          bringingInPlayer = state.players[i];
          break;
        }
      }

      // Everyone else should be able to act (not the bring-in yet)
      const firstActor = state.players[state.activePlayerIndex];
      expect(firstActor.id).not.toBe(bringingInPlayer!.id);
    });

    it('should track action history correctly with BringIn action included', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();

      // BringIn should be in action history
      const bringInActions = state.actionHistory.filter(
        a => a.type === ActionType.BringIn
      );
      expect(bringInActions.length).toBe(1);
      expect(bringInActions[0].amount).toBe(3);

      // Post-ante actions should all be there
      expect(state.actionHistory.length).toBeGreaterThan(4); // 4 antes + 1 bring-in
    });

    it('should handle bring-in with all-in correctly', () => {
      const players = makePlayers(4, 1); // Very short stacks
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();

      // Some players may be all-in from ante alone
      const allInPlayers = state.players.filter(p => p.allIn);
      expect(allInPlayers.length).toBeGreaterThan(0);
    });
  });

  describe('Betting Round Complete Logic', () => {
    it('should correctly identify when betting round is complete (no completion)', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Record initial action index
      const actionIndexBefore = state.actionHistory.length;

      // Get bring-in player
      let bringingInPlayer: string | null = null;
      for (const p of state.players) {
        if (p.bet === 3) {
          bringingInPlayer = p.id;
          break;
        }
      }

      // All players call the bring-in
      for (let callIdx = 0; callIdx < 3; callIdx++) {
        state = game.getState();
        if (state.phase !== GamePhase.BettingThird) break;

        const activeId = state.players[state.activePlayerIndex].id;
        const available = game.getAvailableActions();

        // Should be able to call
        expect(available.canCall || available.canCheck).toBe(true);

        if (available.canCall) {
          game.act(activeId, ActionType.Call);
        } else {
          game.act(activeId, ActionType.Check);
        }
      }

      state = game.getState();
      // Round should have ended
      expect(state.phase).toBe(GamePhase.BettingFourth);
    });

    it('should keep betting round open when someone completes', () => {
      const players = makePlayers(4, 1000);
      const game = new RazzGame(RAZZ_CONFIG, players, 0);
      game.start();

      let state = game.getState();
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Get bring-in player
      let bringingInPlayer: string | null = null;
      for (const p of state.players) {
        if (p.bet === 3) {
          bringingInPlayer = p.id;
          break;
        }
      }

      // First player completes to 5 (the small bet)
      const firstActorId = state.players[state.activePlayerIndex].id;
      game.act(firstActorId, ActionType.Raise, 5);
      state = game.getState();
      expect(state.currentBet).toBe(5);
      expect(state.phase).toBe(GamePhase.BettingThird);

      // We should still be in betting round, and it should not be bring-in's turn yet
      // (there are 2 other players to act)
      const nextActorId = state.players[state.activePlayerIndex].id;
      expect(nextActorId).not.toBe(bringingInPlayer);

      // Call with player 3 (call 8)
      game.act(nextActorId, ActionType.Call);
      state = game.getState();

      // Call with player 4 (call 8)
      const player4Id = state.players[state.activePlayerIndex].id;
      expect(player4Id).not.toBe(bringingInPlayer);
      game.act(player4Id, ActionType.Call);
      state = game.getState();

      // Now bring-in should be active
      expect(state.players[state.activePlayerIndex].id).toBe(bringingInPlayer);
      expect(state.phase).toBe(GamePhase.BettingThird);

      // Bring-in can call or fold
      const bringInAvailable = game.getAvailableActions();
      expect(bringInAvailable.canCall || bringInAvailable.canFold).toBe(true);
    });
  });
});
