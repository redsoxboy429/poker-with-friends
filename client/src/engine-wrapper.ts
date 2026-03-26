// ============================================================
// Engine Wrapper — bridges the game engine with React state
// ============================================================
// Runs the game engine locally, manages bot actions, and exposes
// a simple interface for the UI to interact with.

import { NLHGame } from '@engine/games/nlh.ts';
import { PLOGame } from '@engine/games/plo.ts';
import { RazzGame } from '@engine/games/razz.ts';
import { LHEGame } from '@engine/games/lhe.ts';
import { StudGame } from '@engine/games/stud.ts';
import { StudHiLoGame } from '@engine/games/stud-hilo.ts';
import { PLO8Game } from '@engine/games/plo8.ts';
import { O8Game } from '@engine/games/o8.ts';
import { TwoSevenSDGame } from '@engine/games/27sd.ts';
import { TwoSevenTDGame } from '@engine/games/27td.ts';
import { BadugiGame } from '@engine/games/badugi.ts';
import { BadeucyGame } from '@engine/games/badeucy.ts';
import { BadaceyGame } from '@engine/games/badacey.ts';
import { ArchieGame } from '@engine/games/archie.ts';
import { DrawmahaHighGame } from '@engine/games/drawmaha-high.ts';
import { Drawmaha27Game } from '@engine/games/drawmaha-27.ts';
import { DrawmahaA5Game } from '@engine/games/drawmaha-a5.ts';
import { Drawmaha49Game } from '@engine/games/drawmaha-49.ts';
import { TenThirtyGame } from '@engine/games/ten-thirty.ts';
import { PLBadugiDDGame } from '@engine/games/pl-badugi-dd.ts';
import { PLBadeucyDDGame } from '@engine/games/pl-badeucy-dd.ts';
import { PLBadaceyDDGame } from '@engine/games/pl-badacey-dd.ts';
import { PLArchieDDGame } from '@engine/games/pl-archie-dd.ts';
import { PLTenThirtyDDGame } from '@engine/games/pl-ten-thirty-dd.ts';
import { LimitOmahaHighGame } from '@engine/games/limit-omaha-high.ts';
import type { BaseGame } from '@engine/games/base.ts';
import { BaseDrawGame } from '@engine/games/draw-base.ts';
import { BaseDrawmahaGame } from '@engine/games/drawmaha-base.ts';
import {
  type PlayerState,
  type TableConfig,
  type HandState,
  type AvailableActions,
  GameVariant,
  BettingStructure,
  GamePhase,
  ActionType,
} from '@engine/types.ts';

import {
  GameSession,
  GameMode,
  HORSE_ROTATION,
  EIGHT_GAME_ROTATION,
  NINE_GAME_ROTATION,
  type GameSessionConfig,
  type GameSessionState,
} from '@engine/session.ts';

export type { HandState, AvailableActions, PlayerState, GameSessionConfig, GameSessionState };
export { GameVariant, GamePhase, ActionType, BettingStructure, GameSession, GameMode, HORSE_ROTATION, EIGHT_GAME_ROTATION, NINE_GAME_ROTATION };

/** Human-readable display names for each variant */
export const VARIANT_NAMES: Record<GameVariant, string> = {
  [GameVariant.NLH]: 'No-Limit Hold\'em',
  [GameVariant.PLO]: 'Pot-Limit Omaha',
  [GameVariant.Razz]: 'Razz',
  [GameVariant.LimitHoldem]: 'Limit Hold\'em',
  [GameVariant.Stud]: '7-Card Stud',
  [GameVariant.StudHiLo]: 'Stud Hi-Lo',
  [GameVariant.OmahaHiLo]: 'Omaha Hi-Lo (Limit)',
  [GameVariant.PLOHiLo]: 'PLO Hi-Lo',
  [GameVariant.TwoSevenSD]: '2-7 Single Draw',
  [GameVariant.TwoSevenTD]: '2-7 Triple Draw',
  [GameVariant.Badugi]: 'Badugi',
  [GameVariant.Badeucy]: 'Badeucy',
  [GameVariant.Badacey]: 'Badacey',
  [GameVariant.Archie]: 'Archie',
  [GameVariant.DrawmahaHigh]: 'PL Drawmaha High',
  [GameVariant.Drawmaha27]: 'PL Drawmaha 2-7',
  [GameVariant.DrawmahaA5]: 'PL Drawmaha A-5',
  [GameVariant.Drawmaha49]: 'PL Drawmaha 49',
  [GameVariant.LimitDrawmahaHigh]: 'Limit Drawmaha High',
  [GameVariant.LimitDrawmaha27]: 'Limit Drawmaha 2-7',
  [GameVariant.LimitDrawmahaA5]: 'Limit Drawmaha A-5',
  [GameVariant.LimitDrawmaha49]: 'Limit Drawmaha 49',
  [GameVariant.TenThirtyDraw]: '10-30 Draw',
  [GameVariant.PLBadugiDD]: 'PL Badugi DD',
  [GameVariant.PLBadeucyDD]: 'PL Badeucy DD',
  [GameVariant.PLBadaceyDD]: 'PL Badacey DD',
  [GameVariant.PLArchieDD]: 'PL Archie DD',
  [GameVariant.PLTenThirtyDD]: 'PL 10-30 DD',
  [GameVariant.LimitOmahaHigh]: 'Limit Omaha High',
};

/** All currently playable variants (in 8-game rotation order + new games) */
export const PLAYABLE_VARIANTS: GameVariant[] = [
  GameVariant.LimitHoldem,
  GameVariant.OmahaHiLo,
  GameVariant.Razz,
  GameVariant.Stud,
  GameVariant.StudHiLo,
  GameVariant.NLH,
  GameVariant.PLO,
  GameVariant.PLOHiLo,
  GameVariant.TwoSevenSD,
  GameVariant.TwoSevenTD,
  GameVariant.Badugi,
  GameVariant.Badeucy,
  GameVariant.Badacey,
  GameVariant.Archie,
  GameVariant.DrawmahaHigh,
  GameVariant.Drawmaha27,
  GameVariant.DrawmahaA5,
  GameVariant.Drawmaha49,
  GameVariant.LimitDrawmahaHigh,
  GameVariant.LimitDrawmaha27,
  GameVariant.LimitDrawmahaA5,
  GameVariant.LimitDrawmaha49,
  GameVariant.TenThirtyDraw,
  GameVariant.PLBadugiDD,
  GameVariant.PLBadeucyDD,
  GameVariant.PLBadaceyDD,
  GameVariant.PLArchieDD,
  GameVariant.PLTenThirtyDD,
  GameVariant.LimitOmahaHigh,
];

/** Create default players for local play.
 * Last bot gets a short stack (20% of starting chips) for side pot testing. */
export function createPlayers(count: number, startingChips: number): PlayerState[] {
  const names = ['You', 'Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank', 'Grace'];
  const shortStackChips = Math.max(Math.round(startingChips * 0.2 * 100) / 100, 1);
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: names[i] || `Player ${i + 1}`,
    chips: i === count - 1 && count > 2 ? shortStackChips : startingChips,
    holeCards: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
    seatIndex: i,
  }));
}

/** Table configs for each variant */
export function getTableConfig(variant: GameVariant): TableConfig {
  switch (variant) {
    case GameVariant.NLH:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.NLH,
        bettingStructure: BettingStructure.NoLimit,
      };
    case GameVariant.PLO:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.PLO,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.LimitHoldem:
      return {
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
    case GameVariant.OmahaHiLo:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.OmahaHiLo,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.PLOHiLo:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.PLOHiLo,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.Razz:
      return {
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
    case GameVariant.Stud:
      return {
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
    case GameVariant.StudHiLo:
      return {
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
    case GameVariant.TwoSevenSD:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.TwoSevenSD,
        bettingStructure: BettingStructure.NoLimit,
      };
    case GameVariant.TwoSevenTD:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.TwoSevenTD,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.Badugi:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.Badugi,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.Badeucy:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.Badeucy,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.Badacey:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.Badacey,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.Archie:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.Archie,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.TenThirtyDraw:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant: GameVariant.TenThirtyDraw,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.DrawmahaHigh:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.DrawmahaHigh,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.Drawmaha27:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.Drawmaha27,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.DrawmahaA5:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.DrawmahaA5,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.Drawmaha49:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant: GameVariant.Drawmaha49,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.LimitDrawmahaHigh:
    case GameVariant.LimitDrawmaha27:
    case GameVariant.LimitDrawmahaA5:
    case GameVariant.LimitDrawmaha49:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant,
        bettingStructure: BettingStructure.FixedLimit,
      };
    case GameVariant.PLBadugiDD:
    case GameVariant.PLBadeucyDD:
    case GameVariant.PLBadaceyDD:
    case GameVariant.PLArchieDD:
    case GameVariant.PLTenThirtyDD:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        startingChips: 1000,
        variant,
        bettingStructure: BettingStructure.PotLimit,
      };
    case GameVariant.LimitOmahaHigh:
      return {
        maxPlayers: 6,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        bringIn: 0,
        smallBet: 10,
        bigBet: 20,
        startingChips: 1000,
        variant,
        bettingStructure: BettingStructure.FixedLimit,
      };
    default:
      return getTableConfig(GameVariant.NLH);
  }
}

/** Create a new game instance */
export function createGame(
  variant: GameVariant,
  players: PlayerState[],
  buttonIndex: number,
  customConfig?: TableConfig,
): BaseGame {
  const config = customConfig || getTableConfig(variant);
  switch (variant) {
    case GameVariant.NLH:
      return new NLHGame(config, players, buttonIndex);
    case GameVariant.PLO:
      return new PLOGame(config, players, buttonIndex);
    case GameVariant.LimitHoldem:
      return new LHEGame(config, players, buttonIndex);
    case GameVariant.OmahaHiLo:
      return new O8Game(config, players, buttonIndex);
    case GameVariant.PLOHiLo:
      return new PLO8Game(config, players, buttonIndex);
    case GameVariant.Razz:
      return new RazzGame(config, players, buttonIndex);
    case GameVariant.Stud:
      return new StudGame(config, players, buttonIndex);
    case GameVariant.StudHiLo:
      return new StudHiLoGame(config, players, buttonIndex);
    case GameVariant.TwoSevenSD:
      return new TwoSevenSDGame(config, players, buttonIndex);
    case GameVariant.TwoSevenTD:
      return new TwoSevenTDGame(config, players, buttonIndex);
    case GameVariant.Badugi:
      return new BadugiGame(config, players, buttonIndex);
    case GameVariant.Badeucy:
      return new BadeucyGame(config, players, buttonIndex);
    case GameVariant.Badacey:
      return new BadaceyGame(config, players, buttonIndex);
    case GameVariant.Archie:
      return new ArchieGame(config, players, buttonIndex);
    case GameVariant.DrawmahaHigh:
      return new DrawmahaHighGame(config, players, buttonIndex);
    case GameVariant.Drawmaha27:
      return new Drawmaha27Game(config, players, buttonIndex);
    case GameVariant.DrawmahaA5:
      return new DrawmahaA5Game(config, players, buttonIndex);
    case GameVariant.Drawmaha49:
      return new Drawmaha49Game(config, players, buttonIndex);
    case GameVariant.LimitDrawmahaHigh:
      return new DrawmahaHighGame(config, players, buttonIndex);
    case GameVariant.LimitDrawmaha27:
      return new Drawmaha27Game(config, players, buttonIndex);
    case GameVariant.LimitDrawmahaA5:
      return new DrawmahaA5Game(config, players, buttonIndex);
    case GameVariant.LimitDrawmaha49:
      return new Drawmaha49Game(config, players, buttonIndex);
    case GameVariant.TenThirtyDraw:
      return new TenThirtyGame(config, players, buttonIndex);
    case GameVariant.PLBadugiDD:
      return new PLBadugiDDGame(config, players, buttonIndex);
    case GameVariant.PLBadeucyDD:
      return new PLBadeucyDDGame(config, players, buttonIndex);
    case GameVariant.PLBadaceyDD:
      return new PLBadaceyDDGame(config, players, buttonIndex);
    case GameVariant.PLArchieDD:
      return new PLArchieDDGame(config, players, buttonIndex);
    case GameVariant.PLTenThirtyDD:
      return new PLTenThirtyDDGame(config, players, buttonIndex);
    case GameVariant.LimitOmahaHigh:
      return new LimitOmahaHighGame(config, players, buttonIndex);
    default:
      return new NLHGame(config, players, buttonIndex);
  }
}

/**
 * Simple bot AI — makes reasonable but not optimal decisions.
 * Enough to test the game flow.
 */
export function getBotAction(
  state: HandState,
  actions: AvailableActions,
  playerName?: string,
): { type: ActionType; amount?: number } {
  const rand = Math.random();
  // Charlie never folds — always calls or raises (for testing side pots)
  const neverFold = playerName === 'Charlie';

  // If can check, usually check (70%), sometimes bet (30%)
  if (actions.canCheck) {
    if (rand < 0.7 || !actions.canBet) {
      return { type: ActionType.Check };
    }
    // Bet small
    return { type: ActionType.Bet, amount: actions.minBet };
  }

  // Facing a bet: fold 25%, call 55%, raise 20%
  if (rand < 0.25 && actions.canFold && !neverFold) {
    return { type: ActionType.Fold };
  }
  if (rand < 0.80 || !actions.canRaise) {
    if (actions.canCall) {
      return { type: ActionType.Call };
    }
    if (neverFold && actions.canCall) return { type: ActionType.Call };
    return { type: ActionType.Fold };
  }
  // Raise min
  if (actions.canRaise) {
    return { type: ActionType.Raise, amount: actions.minRaise };
  }
  return { type: ActionType.Call };
}

/**
 * Type guard: check if a game is a draw game
 */
export function isDrawGame(game: BaseGame): game is BaseDrawGame {
  return game instanceof BaseDrawGame;
}

/**
 * Type guard: check if a game is a Drawmaha game (hybrid draw+flop)
 */
export function isDrawmahaGame(game: BaseGame): game is BaseDrawmahaGame {
  return game instanceof BaseDrawmahaGame;
}

/** Simple bot discard AI for draw games — discard worst cards based on random strategy */
export function getBotDiscardIndices(holeCards: import('@engine/types.ts').Card[]): number[] {
  // Simple strategy: randomly discard 0-3 cards
  // A more sophisticated bot would evaluate hand strength
  const numDiscard = Math.floor(Math.random() * 4); // 0-3 cards
  if (numDiscard === 0) return [];

  // Discard random indices
  const indices: number[] = [];
  const available = Array.from({ length: holeCards.length }, (_, i) => i);
  for (let i = 0; i < numDiscard && available.length > 0; i++) {
    const pick = Math.floor(Math.random() * available.length);
    indices.push(available[pick]);
    available.splice(pick, 1);
  }
  return indices.sort((a, b) => a - b);
}
