import { describe, it, expect } from 'vitest';
import {
  GameSession,
  GameMode,
  HORSE_ROTATION,
  EIGHT_GAME_ROTATION,
  NINE_GAME_ROTATION,
  HANDS_PER_VARIANT,
  CAP_RULES,
  GameVariant,
} from '../src/index.js';

// ============================================================
// Rotation Modes (HORSE, 8-game, 9-game)
// ============================================================

describe('GameSession — Rotation Modes', () => {
  it('HORSE rotation has 5 games in correct order', () => {
    expect(HORSE_ROTATION).toEqual([
      GameVariant.LimitHoldem,
      GameVariant.OmahaHiLo,
      GameVariant.Razz,
      GameVariant.Stud,
      GameVariant.StudHiLo,
    ]);
  });

  it('8-game rotation has 8 games (HORSE + NLH, PLO, 27SD)', () => {
    expect(EIGHT_GAME_ROTATION).toHaveLength(8);
    expect(EIGHT_GAME_ROTATION.slice(0, 5)).toEqual(HORSE_ROTATION);
    expect(EIGHT_GAME_ROTATION.slice(5)).toEqual([
      GameVariant.NLH,
      GameVariant.PLO,
      GameVariant.TwoSevenSD,
    ]);
  });

  it('9-game rotation has 9 games (8-game + 27TD)', () => {
    expect(NINE_GAME_ROTATION).toHaveLength(9);
    expect(NINE_GAME_ROTATION.slice(0, 8)).toEqual(EIGHT_GAME_ROTATION);
    expect(NINE_GAME_ROTATION[8]).toBe(GameVariant.TwoSevenTD);
  });

  it('HORSE starts with first variant', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });
    expect(session.getCurrentVariant()).toBe(GameVariant.LimitHoldem);
  });

  it('HORSE advances to next variant after 8 hands', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });
    expect(session.getCurrentVariant()).toBe(GameVariant.LimitHoldem);

    // Play 8 hands of LHE
    for (let i = 0; i < HANDS_PER_VARIANT; i++) {
      session.advanceHand(i % 4);
    }
    expect(session.getCurrentVariant()).toBe(GameVariant.OmahaHiLo);
  });

  it('HORSE state shows correct hand/variant progress', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });

    const state0 = session.getState();
    expect(state0.handInVariant).toBe(1);
    expect(state0.handsPerVariant).toBe(8);
    expect(state0.rotationIndex).toBe(0);
    expect(state0.rotationLength).toBe(5);

    // After 3 hands
    session.advanceHand(0);
    session.advanceHand(1);
    session.advanceHand(2);
    const state3 = session.getState();
    expect(state3.handInVariant).toBe(4); // 1-based
    expect(state3.rotationIndex).toBe(0); // still LHE
  });

  it('HORSE loops back to first game after completing all 5', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });

    // Play through all 5 games × 8 hands = 40 hands
    for (let i = 0; i < 5 * HANDS_PER_VARIANT; i++) {
      session.advanceHand(i % 4);
    }
    // Should loop back to LHE
    expect(session.getCurrentVariant()).toBe(GameVariant.LimitHoldem);
    expect(session.getState().rotationIndex).toBe(0);
  });

  it('8-game cycles through all 8 variants', () => {
    const session = new GameSession({ mode: GameMode.EightGame, numPlayers: 4 });

    for (let g = 0; g < 8; g++) {
      expect(session.getCurrentVariant()).toBe(EIGHT_GAME_ROTATION[g]);
      for (let h = 0; h < HANDS_PER_VARIANT; h++) {
        session.advanceHand(h % 4);
      }
    }
    // Loops
    expect(session.getCurrentVariant()).toBe(EIGHT_GAME_ROTATION[0]);
  });

  it('9-game cycles through all 9 variants', () => {
    const session = new GameSession({ mode: GameMode.NineGame, numPlayers: 6 });

    for (let g = 0; g < 9; g++) {
      expect(session.getCurrentVariant()).toBe(NINE_GAME_ROTATION[g]);
      for (let h = 0; h < HANDS_PER_VARIANT; h++) {
        session.advanceHand(h % 6);
      }
    }
    expect(session.getCurrentVariant()).toBe(NINE_GAME_ROTATION[0]);
  });
});

// ============================================================
// Specific Game Mode
// ============================================================

describe('GameSession — Specific Game', () => {
  it('always returns the configured variant', () => {
    const session = new GameSession({
      mode: GameMode.SpecificGame,
      variant: GameVariant.NLH,
      numPlayers: 4,
    });
    expect(session.getCurrentVariant()).toBe(GameVariant.NLH);

    // Advance many hands — still NLH
    for (let i = 0; i < 100; i++) {
      session.advanceHand(i % 4);
    }
    expect(session.getCurrentVariant()).toBe(GameVariant.NLH);
  });

  it('throws if no variant provided', () => {
    expect(() => {
      new GameSession({ mode: GameMode.SpecificGame, numPlayers: 4 });
    }).toThrow('SpecificGame mode requires a variant');
  });

  it('has no cap', () => {
    const session = new GameSession({
      mode: GameMode.SpecificGame,
      variant: GameVariant.NLH,
      numPlayers: 4,
    });
    expect(session.getCapBB()).toBeNull();
  });

  it('state reflects specific mode', () => {
    const session = new GameSession({
      mode: GameMode.SpecificGame,
      variant: GameVariant.PLO,
      numPlayers: 4,
    });
    const state = session.getState();
    expect(state.mode).toBe(GameMode.SpecificGame);
    expect(state.currentVariant).toBe(GameVariant.PLO);
    expect(state.needsChoice).toBe(false);
    expect(state.capBB).toBeNull();
  });
});

// ============================================================
// Bet Caps
// ============================================================

describe('GameSession — Bet Caps', () => {
  it('NLH gets 80 BB cap in 8-game', () => {
    const session = new GameSession({ mode: GameMode.EightGame, numPlayers: 4 });

    // Advance to NLH (game index 5, after 5*8=40 hands)
    for (let i = 0; i < 5 * HANDS_PER_VARIANT; i++) {
      session.advanceHand(i % 4);
    }
    expect(session.getCurrentVariant()).toBe(GameVariant.NLH);
    expect(session.getCapBB()).toBe(80);
  });

  it('PLO gets 80 BB cap in 8-game', () => {
    const session = new GameSession({ mode: GameMode.EightGame, numPlayers: 4 });

    // Advance to PLO (game index 6, after 6*8=48 hands)
    for (let i = 0; i < 6 * HANDS_PER_VARIANT; i++) {
      session.advanceHand(i % 4);
    }
    expect(session.getCurrentVariant()).toBe(GameVariant.PLO);
    expect(session.getCapBB()).toBe(80);
  });

  it('27SD gets 30 BB cap in 8-game', () => {
    const session = new GameSession({ mode: GameMode.EightGame, numPlayers: 4 });

    // Advance to 27SD (game index 7, after 7*8=56 hands)
    for (let i = 0; i < 7 * HANDS_PER_VARIANT; i++) {
      session.advanceHand(i % 4);
    }
    expect(session.getCurrentVariant()).toBe(GameVariant.TwoSevenSD);
    expect(session.getCapBB()).toBe(30);
  });

  it('limit games have no cap', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });
    // LHE — no cap
    expect(session.getCurrentVariant()).toBe(GameVariant.LimitHoldem);
    expect(session.getCapBB()).toBeNull();

    // O8 — no cap
    for (let i = 0; i < HANDS_PER_VARIANT; i++) session.advanceHand(i % 4);
    expect(session.getCurrentVariant()).toBe(GameVariant.OmahaHiLo);
    expect(session.getCapBB()).toBeNull();
  });

  it('PLO8 gets 80 BB cap in dealers choice', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.PLOHiLo, 0);
    expect(session.getCapBB()).toBe(80);
  });

  it('caps reported correctly in state', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.NLH, 0);
    expect(session.getState().capBB).toBe(80);
  });
});

// ============================================================
// Dealer's Choice
// ============================================================

describe("GameSession — Dealer's Choice", () => {
  it('starts with needsChoice = true', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    const state = session.getState();
    expect(state.needsChoice).toBe(true);
    expect(state.currentVariant).toBeNull();
    expect(state.chooserSeatIndex).toBe(0);
  });

  it('setDealersChoice sets the variant', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.NLH, 0);

    const state = session.getState();
    expect(state.currentVariant).toBe(GameVariant.NLH);
    expect(state.needsChoice).toBe(false);
    expect(state.chooserSeatIndex).toBe(0);
  });

  it('plays N+1 hands then passes choice (4 players = 5 hands)', () => {
    const numPlayers = 4;
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers });
    session.initDealersChoice(0); // Seat 0 is first chooser
    session.setDealersChoice(GameVariant.Stud, 0);

    // Play 5 hands (4 players + 1)
    for (let i = 0; i < numPlayers + 1; i++) {
      expect(session.getState().needsChoice).toBe(false);
      session.advanceHand(i % numPlayers);
    }

    // Should now need a new choice, from seat 1 (left of seat 0)
    const state = session.getState();
    expect(state.needsChoice).toBe(true);
    expect(state.chooserSeatIndex).toBe(1);
  });

  it('choice passes around the table correctly', () => {
    const numPlayers = 3;
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers });
    session.initDealersChoice(0);

    // Seat 0 chooses, plays 4 hands (3+1)
    session.setDealersChoice(GameVariant.NLH, 0);
    for (let i = 0; i < numPlayers + 1; i++) session.advanceHand(i % numPlayers);
    expect(session.getState().chooserSeatIndex).toBe(1);

    // Seat 1 chooses, plays 4 hands
    session.setDealersChoice(GameVariant.PLO, 1);
    for (let i = 0; i < numPlayers + 1; i++) session.advanceHand(i % numPlayers);
    expect(session.getState().chooserSeatIndex).toBe(2);

    // Seat 2 chooses, plays 4 hands
    session.setDealersChoice(GameVariant.Razz, 2);
    for (let i = 0; i < numPlayers + 1; i++) session.advanceHand(i % numPlayers);
    // Wraps back to seat 0
    expect(session.getState().chooserSeatIndex).toBe(0);
  });

  it('shows correct hand progress during orbit', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.NLH, 0);

    expect(session.getState().handInVariant).toBe(1); // Hand 1 of 5
    session.advanceHand(0);
    expect(session.getState().handInVariant).toBe(2); // Hand 2 of 5
    session.advanceHand(1);
    expect(session.getState().handInVariant).toBe(3); // Hand 3 of 5
  });

  it('handles player count change mid-orbit', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.NLH, 0);

    // Play 2 hands
    session.advanceHand(0);
    session.advanceHand(1);

    // Player leaves — now 3 players. Orbit should be 4 hands total (3+1)
    session.updatePlayerCount(3);

    // Play 2 more hands (total 4, which hits the new total)
    session.advanceHand(2);
    session.advanceHand(0);

    // Should need new choice now
    expect(session.getState().needsChoice).toBe(true);
    expect(session.getState().chooserSeatIndex).toBe(1); // left of seat 0, mod 3
  });

  it('handles player count increase mid-orbit', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 3 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.Razz, 0);

    // Play 2 hands
    session.advanceHand(0);
    session.advanceHand(1);

    // Player joins — now 4 players. Orbit extends to 5 hands (4+1)
    session.updatePlayerCount(4);

    // Play 2 more (total 4)
    session.advanceHand(2);
    expect(session.getState().needsChoice).toBe(false); // Not done yet (need 5)
    session.advanceHand(3);

    // Now at 5 hands total
    expect(session.getState().needsChoice).toBe(false); // 4 advanced, but hand 5 hasn't finished
    session.advanceHand(0);

    expect(session.getState().needsChoice).toBe(true);
  });

  it('player count decrease can immediately end orbit', () => {
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 6 });
    session.initDealersChoice(0);
    session.setDealersChoice(GameVariant.NLH, 0);

    // Play 4 hands
    for (let i = 0; i < 4; i++) session.advanceHand(i);

    // 3 players leave — now 3 players, total should be 4 (3+1)
    // We've already played 4, which meets the new total
    session.updatePlayerCount(3);
    expect(session.getState().needsChoice).toBe(true);
  });

  it('throws if setDealersChoice called in wrong mode', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });
    expect(() => session.setDealersChoice(GameVariant.NLH, 0)).toThrow();
  });

  it('any of the 10 variants can be chosen', () => {
    const allVariants = Object.values(GameVariant);
    const session = new GameSession({ mode: GameMode.DealersChoice, numPlayers: 2 });

    for (const variant of allVariants) {
      session.initDealersChoice(0);
      session.setDealersChoice(variant, 0);
      expect(session.getCurrentVariant()).toBe(variant);
      // Reset by playing out the orbit (2+1 = 3 hands)
      for (let i = 0; i < 3; i++) session.advanceHand(i % 2);
    }
  });
});

// ============================================================
// Misc
// ============================================================

describe('GameSession — Misc', () => {
  it('getRotation returns copy of rotation array', () => {
    const session = new GameSession({ mode: GameMode.Horse, numPlayers: 4 });
    const rot = session.getRotation();
    expect(rot).toEqual(HORSE_ROTATION);
    // Mutating the returned array doesn't affect the session
    rot.push(GameVariant.NLH);
    expect(session.getRotation()).toEqual(HORSE_ROTATION);
  });

  it('getMode returns the mode', () => {
    expect(new GameSession({ mode: GameMode.Horse, numPlayers: 4 }).getMode()).toBe(GameMode.Horse);
    expect(new GameSession({ mode: GameMode.EightGame, numPlayers: 4 }).getMode()).toBe(GameMode.EightGame);
    expect(new GameSession({ mode: GameMode.DealersChoice, numPlayers: 4 }).getMode()).toBe(GameMode.DealersChoice);
  });

});

// ============================================================
// Engine-Level Cap Enforcement (BaseGame constructor)
// ============================================================

import { NLHGame } from '../src/games/nlh.js';
import { PLOGame } from '../src/games/plo.js';
import type { PlayerState, TableConfig } from '../src/types.js';
import { BettingStructure } from '../src/types.js';

function makePlayers(count: number, chips: number): PlayerState[] {
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

describe('Cap enforcement in BaseGame constructor', () => {
  it('NLH with 80 BB cap limits player chips to cap amount', () => {
    const bb = 10;
    const capBB = 80;
    const config: TableConfig = {
      maxPlayers: 4,
      smallBlind: 5,
      bigBlind: bb,
      ante: 0,
      bringIn: 0,
      startingChips: 2000,
      variant: GameVariant.NLH,
      bettingStructure: BettingStructure.NoLimit,
      capBB,
    };
    const players = makePlayers(4, 2000); // 200 BB each, should be capped to 80 BB = 800
    const game = new NLHGame(config, players, 0);
    const state = game.getState();
    for (const p of state.players) {
      expect(p.chips).toBeLessThanOrEqual(capBB * bb); // max 800
    }
  });

  it('players already under cap keep their chips', () => {
    const bb = 10;
    const capBB = 80;
    const config: TableConfig = {
      maxPlayers: 4,
      smallBlind: 5,
      bigBlind: bb,
      ante: 0,
      bringIn: 0,
      startingChips: 500,
      variant: GameVariant.NLH,
      bettingStructure: BettingStructure.NoLimit,
      capBB,
    };
    const players = makePlayers(4, 500); // 50 BB each, under cap
    const game = new NLHGame(config, players, 0);
    const state = game.getState();
    // Chips should be exactly 500 minus any posted blinds
    // Before start(), chips are still at 500
    for (const p of state.players) {
      expect(p.chips).toBe(500);
    }
  });

  it('no cap means no chip reduction', () => {
    const config: TableConfig = {
      maxPlayers: 4,
      smallBlind: 5,
      bigBlind: 10,
      ante: 0,
      bringIn: 0,
      startingChips: 5000,
      variant: GameVariant.NLH,
      bettingStructure: BettingStructure.NoLimit,
      // no capBB
    };
    const players = makePlayers(4, 5000);
    const game = new NLHGame(config, players, 0);
    const state = game.getState();
    for (const p of state.players) {
      expect(p.chips).toBe(5000);
    }
  });

  it('PLO with 80 BB cap works correctly', () => {
    const bb = 5;
    const capBB = 80;
    const config: TableConfig = {
      maxPlayers: 4,
      smallBlind: 2,
      bigBlind: bb,
      ante: 0,
      bringIn: 0,
      startingChips: 1000,
      variant: GameVariant.PLO,
      bettingStructure: BettingStructure.PotLimit,
      capBB,
    };
    const players = makePlayers(4, 1000); // 200 BB, capped to 80 BB = 400
    const game = new PLOGame(config, players, 0);
    const state = game.getState();
    for (const p of state.players) {
      expect(p.chips).toBeLessThanOrEqual(capBB * bb);
      expect(p.chips).toBe(400);
    }
  });

  it('mixed stacks: only over-cap players get reduced', () => {
    const bb = 10;
    const capBB = 80;
    const config: TableConfig = {
      maxPlayers: 4,
      smallBlind: 5,
      bigBlind: bb,
      ante: 0,
      bringIn: 0,
      startingChips: 2000,
      variant: GameVariant.NLH,
      bettingStructure: BettingStructure.NoLimit,
      capBB,
    };
    // Give different stacks
    const players = makePlayers(4, 500);
    players[0].chips = 2000; // Over cap (200 BB)
    players[1].chips = 800;  // Exactly at cap (80 BB)
    players[2].chips = 300;  // Under cap (30 BB)
    players[3].chips = 1500; // Over cap (150 BB)

    const game = new NLHGame(config, players, 0);
    const state = game.getState();
    expect(state.players[0].chips).toBe(800);  // Capped
    expect(state.players[1].chips).toBe(800);  // Unchanged
    expect(state.players[2].chips).toBe(300);  // Unchanged
    expect(state.players[3].chips).toBe(800);  // Capped
  });
});
