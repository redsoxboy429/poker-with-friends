// ============================================================
// Variant Registry Consistency Tests
// ============================================================
// These tests catch the exact bug class we hit: adding a GameVariant
// enum value but forgetting to register it in one or more downstream
// maps (display names, table configs, game creation, session rotation,
// index exports, etc.).
//
// If you add a new GameVariant, these tests WILL fail until you wire
// it into every required location. That's the point.

import { describe, it, expect } from 'vitest';
import { GameVariant, BettingStructure, type PlayerState, type TableConfig } from '../src/types.js';
import {
  GameSession,
  GameMode,
  HORSE_ROTATION,
  EIGHT_GAME_ROTATION,
  NINE_GAME_ROTATION,
  CAP_RULES,
} from '../src/session.js';

// Import every game class to verify they exist and construct
import { NLHGame } from '../src/games/nlh.js';
import { PLOGame } from '../src/games/plo.js';
import { RazzGame } from '../src/games/razz.js';
import { LHEGame } from '../src/games/lhe.js';
import { StudGame } from '../src/games/stud.js';
import { StudHiLoGame } from '../src/games/stud-hilo.js';
import { PLO8Game } from '../src/games/plo8.js';
import { O8Game } from '../src/games/o8.js';
import { TwoSevenSDGame } from '../src/games/27sd.js';
import { TwoSevenTDGame } from '../src/games/27td.js';
import { BadugiGame } from '../src/games/badugi.js';
import { BadeucyGame } from '../src/games/badeucy.js';
import { BadaceyGame } from '../src/games/badacey.js';
import { ArchieGame } from '../src/games/archie.js';
import { TenThirtyGame } from '../src/games/ten-thirty.js';
import { DrawmahaHighGame } from '../src/games/drawmaha-high.js';
import { Drawmaha27Game } from '../src/games/drawmaha-27.js';
import { DrawmahaA5Game } from '../src/games/drawmaha-a5.js';
import { Drawmaha49Game } from '../src/games/drawmaha-49.js';
import { PLBadugiDDGame } from '../src/games/pl-badugi-dd.js';
import { PLBadeucyDDGame } from '../src/games/pl-badeucy-dd.js';
import { PLBadaceyDDGame } from '../src/games/pl-badacey-dd.js';
import { PLArchieDDGame } from '../src/games/pl-archie-dd.js';
import { PLTenThirtyDDGame } from '../src/games/pl-ten-thirty-dd.js';
import { LimitOmahaHighGame } from '../src/games/limit-omaha-high.js';

// ============================================================
// Master registry: every GameVariant must have an entry here.
// When you add a new variant, add it here FIRST — the tests
// below will tell you everywhere else it needs to go.
// ============================================================

/** Map of every GameVariant to its game class constructor */
const VARIANT_GAME_CLASS: Record<string, new (config: TableConfig, players: PlayerState[], buttonIndex: number) => any> = {
  [GameVariant.NLH]: NLHGame,
  [GameVariant.PLO]: PLOGame,
  [GameVariant.Razz]: RazzGame,
  [GameVariant.LimitHoldem]: LHEGame,
  [GameVariant.Stud]: StudGame,
  [GameVariant.StudHiLo]: StudHiLoGame,
  [GameVariant.OmahaHiLo]: O8Game,
  [GameVariant.PLOHiLo]: PLO8Game,
  [GameVariant.TwoSevenSD]: TwoSevenSDGame,
  [GameVariant.TwoSevenTD]: TwoSevenTDGame,
  [GameVariant.Badugi]: BadugiGame,
  [GameVariant.Badeucy]: BadeucyGame,
  [GameVariant.Badacey]: BadaceyGame,
  [GameVariant.Archie]: ArchieGame,
  [GameVariant.TenThirtyDraw]: TenThirtyGame,
  [GameVariant.DrawmahaHigh]: DrawmahaHighGame,
  [GameVariant.Drawmaha27]: Drawmaha27Game,
  [GameVariant.DrawmahaA5]: DrawmahaA5Game,
  [GameVariant.Drawmaha49]: Drawmaha49Game,
  [GameVariant.LimitDrawmahaHigh]: DrawmahaHighGame,
  [GameVariant.LimitDrawmaha27]: Drawmaha27Game,
  [GameVariant.LimitDrawmahaA5]: DrawmahaA5Game,
  [GameVariant.LimitDrawmaha49]: Drawmaha49Game,
  [GameVariant.PLBadugiDD]: PLBadugiDDGame,
  [GameVariant.PLBadeucyDD]: PLBadeucyDDGame,
  [GameVariant.PLBadaceyDD]: PLBadaceyDDGame,
  [GameVariant.PLArchieDD]: PLArchieDDGame,
  [GameVariant.PLTenThirtyDD]: PLTenThirtyDDGame,
  [GameVariant.LimitOmahaHigh]: LimitOmahaHighGame,
};

/** Get all GameVariant enum values */
function getAllVariants(): string[] {
  return Object.values(GameVariant);
}

function createTestPlayers(count: number = 3): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    chips: 1000,
    holeCards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
    seatIndex: i,
  }));
}

// ============================================================
// Tests
// ============================================================

describe('Variant Registry Consistency', () => {

  it('every GameVariant enum value has a game class in VARIANT_GAME_CLASS', () => {
    const allVariants = getAllVariants();
    const missing = allVariants.filter(v => !VARIANT_GAME_CLASS[v]);
    expect(missing, `Missing game class for variants: ${missing.join(', ')}`).toEqual([]);
  });

  it('every GameVariant enum value can construct a game and start a hand', () => {
    const allVariants = getAllVariants();
    const players = createTestPlayers(3);

    for (const variant of allVariants) {
      const GameClass = VARIANT_GAME_CLASS[variant];
      expect(GameClass, `No game class for ${variant}`).toBeDefined();

      // Build a config that works for any variant
      const config: TableConfig = {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: variant === GameVariant.Stud || variant === GameVariant.StudHiLo || variant === GameVariant.Razz ? 1 : 0,
        bringIn: variant === GameVariant.Stud || variant === GameVariant.StudHiLo || variant === GameVariant.Razz ? 1 : 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: variant as GameVariant,
        bettingStructure: BettingStructure.FixedLimit,
      };

      const freshPlayers = createTestPlayers(3);

      try {
        const game = new GameClass(config, freshPlayers, 0);
        game.start();
        const state = game.getState();
        expect(state.players.length, `${variant}: wrong player count`).toBe(3);
        expect(state.phase, `${variant}: should be in a betting/drawing phase after start`).not.toBe('waiting');
      } catch (e: any) {
        // Fail with a clear message about which variant broke
        expect.unreachable(`${variant} failed to construct or start: ${e.message}`);
      }
    }
  });

  it('VARIANT_GAME_CLASS has no extra entries beyond GameVariant enum', () => {
    const allVariants = new Set(getAllVariants());
    const registeredVariants = Object.keys(VARIANT_GAME_CLASS);
    const extras = registeredVariants.filter(v => !allVariants.has(v));
    expect(extras, `Extra entries in VARIANT_GAME_CLASS not in GameVariant enum: ${extras.join(', ')}`).toEqual([]);
  });
});

describe('Session Rotation Coverage', () => {

  it('rotation arrays only contain valid GameVariant values', () => {
    const allVariants = new Set(getAllVariants());

    for (const v of HORSE_ROTATION) {
      expect(allVariants.has(v), `HORSE_ROTATION contains invalid variant: ${v}`).toBe(true);
    }
    for (const v of EIGHT_GAME_ROTATION) {
      expect(allVariants.has(v), `EIGHT_GAME_ROTATION contains invalid variant: ${v}`).toBe(true);
    }
    for (const v of NINE_GAME_ROTATION) {
      expect(allVariants.has(v), `NINE_GAME_ROTATION contains invalid variant: ${v}`).toBe(true);
    }
  });

  it('CAP_RULES only references valid GameVariant values', () => {
    const allVariants = new Set(getAllVariants());
    for (const v of Object.keys(CAP_RULES)) {
      expect(allVariants.has(v), `CAP_RULES contains invalid variant: ${v}`).toBe(true);
    }
  });

  it('every capped variant has a positive BB cap', () => {
    for (const [variant, cap] of Object.entries(CAP_RULES)) {
      expect(cap, `${variant} has invalid cap: ${cap}`).toBeGreaterThan(0);
    }
  });

  it('SpecificGame mode works for every variant', () => {
    const allVariants = getAllVariants();
    for (const variant of allVariants) {
      const session = new GameSession({
        mode: GameMode.SpecificGame,
        variant: variant as GameVariant,
        numPlayers: 3,
      });
      expect(session.getCurrentVariant(), `SpecificGame for ${variant}`).toBe(variant);
    }
  });
});

describe('Engine Index Exports', () => {

  it('all game classes are exported from the engine index', async () => {
    // Dynamic import to check what's actually exported
    const engineExports = await import('../src/index.js');

    const expectedClasses = [
      'NLHGame', 'PLOGame', 'RazzGame', 'LHEGame',
      'StudGame', 'StudHiLoGame', 'PLO8Game', 'O8Game',
      'TwoSevenSDGame', 'TwoSevenTDGame',
      'BadugiGame', 'BadeucyGame', 'BadaceyGame', 'ArchieGame',
      'TenThirtyGame',
      'DrawmahaHighGame', 'Drawmaha27Game', 'DrawmahaA5Game', 'Drawmaha49Game',
      'BaseDrawmahaGame',
    ];

    const missing = expectedClasses.filter(name => !(name in engineExports));
    expect(missing, `Missing exports from engine index: ${missing.join(', ')}`).toEqual([]);
  });

  it('all evaluator functions are exported from the engine index', async () => {
    const engineExports = await import('../src/index.js');

    const expectedFunctions = [
      'evaluate5CardHigh', 'bestHighHand', 'bestPLOHighHand',
      'evaluate5CardLow', 'bestLowHand', 'bestEightOrBetterLow',
      'bestPLOEightOrBetterLow', 'evaluate5Card27Low', 'best27LowHand',
      'evaluateBadugi', 'calculatePipCount', 'bestPipCountHand',
      'evaluateHighPips', 'evaluateLowPips',
    ];

    const missing = expectedFunctions.filter(name => !(name in engineExports));
    expect(missing, `Missing evaluator exports from engine index: ${missing.join(', ')}`).toEqual([]);
  });
});
