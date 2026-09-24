// ============================================================
// Room settings — validation and defaults (docs/NINE-GAME-RULES.md §2)
// ============================================================

import { GameMode, GameVariant, NINE_GAME_ROTATION } from 'poker-engine';
import type { RoomSettings } from './types.js';

/** Smallest chip. Every stake, bet, buy-in, top-up and payout is a multiple of it. */
export const CHIP_UNIT = 0.25;

/** True when `x` is a finite, non-negative whole number of chips. */
export function isChipAmount(x: unknown): x is number {
  // CHIP_UNIT is a power of two, so multiples of it divide exactly.
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && Number.isInteger(x / CHIP_UNIT);
}

/** Round down to the chip unit (for derived defaults only, never for player input). */
function floorToChip(x: number): number {
  return Math.floor(x / CHIP_UNIT + 1e-9) * CHIP_UNIT;
}

/** Stud ante / bring-in default: a quarter of the small bet, at least one chip. */
export function defaultStudForcedBet(smallBet: number): number {
  return Math.max(CHIP_UNIT, floorToChip(smallBet / 4));
}

const MODES = new Set<string>(Object.values(GameMode));

/**
 * Validate a full or partial settings object and return complete, normalized
 * settings. `base` supplies values for fields the update leaves out. Throws a
 * readable error on anything invalid; never mutates its inputs.
 */
export function normalizeSettings(input: unknown, base?: RoomSettings): RoomSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
  const u = input as Partial<Record<keyof RoomSettings, unknown>>;
  const pick = <K extends keyof RoomSettings>(k: K) => (u[k] !== undefined ? u[k] : base?.[k]);

  const gameMode = pick('gameMode') ?? GameMode.DealersChoice;
  if (typeof gameMode !== 'string' || !MODES.has(gameMode)) throw new Error('Unknown game mode');

  let variant = pick('variant');
  if (gameMode === GameMode.SpecificGame) {
    if (typeof variant !== 'string' || !NINE_GAME_ROTATION.includes(variant as GameVariant)) {
      throw new Error('Select a nine-game variant');
    }
  } else if (variant !== undefined && (typeof variant !== 'string' || !NINE_GAME_ROTATION.includes(variant as GameVariant))) {
    throw new Error('Select a nine-game variant');
  }

  const num = (k: keyof RoomSettings, fallback: number): number => {
    const v = pick(k) ?? fallback;
    if (!isChipAmount(v)) throw new Error(`${k} must be a multiple of $${CHIP_UNIT.toFixed(2)}`);
    return v;
  };

  const smallBlind = num('smallBlind', 0.25);
  const bigBlind = num('bigBlind', 0.5);
  const smallBet = num('smallBet', 2);
  // A changed small bet re-derives the dependent defaults unless they were also sent.
  const smallBetChanged = u.smallBet !== undefined;
  const bigBet = num('bigBet', smallBet * 2);
  const ante = u.ante !== undefined ? num('ante', 0) : smallBetChanged || base?.ante === undefined ? defaultStudForcedBet(smallBet) : base.ante;
  const bringIn = u.bringIn !== undefined ? num('bringIn', 0) : smallBetChanged || base?.bringIn === undefined ? defaultStudForcedBet(smallBet) : base.bringIn;
  const bigBlindChanged = u.bigBlind !== undefined;
  const buyInMin = u.buyInMin !== undefined ? num('buyInMin', 0) : bigBlindChanged || base?.buyInMin === undefined ? 50 * bigBlind : base.buyInMin;
  const buyInMax = u.buyInMax !== undefined ? num('buyInMax', 0) : bigBlindChanged || base?.buyInMax === undefined ? 300 * bigBlind : base.buyInMax;

  if (smallBlind <= 0 || bigBlind <= 0) throw new Error('Blinds must be positive');
  if (smallBlind > bigBlind) throw new Error('Small blind cannot exceed the big blind');
  if (smallBet <= 0) throw new Error('Small bet must be positive');
  if (!isChipAmount(smallBet / 2)) throw new Error(`Small bet must be a multiple of $${(CHIP_UNIT * 2).toFixed(2)} so the limit small blind is whole chips`);
  if (bigBet !== smallBet * 2) throw new Error('Big bet must be twice the small bet');
  if (ante <= 0 || bringIn <= 0) throw new Error('Ante and bring-in must be positive');
  if (ante > bringIn) throw new Error('Ante cannot exceed the bring-in');
  if (bringIn >= smallBet) throw new Error('Bring-in must be less than the small bet');
  if (buyInMin <= 0) throw new Error('Minimum buy-in must be positive');
  if (buyInMin > buyInMax) throw new Error('Minimum buy-in cannot exceed the maximum');
  const MAX_STAKE = 100_000; // play money; keeps amounts far inside exact float range
  if ([smallBlind, bigBlind, smallBet, bigBet, ante, bringIn, buyInMin, buyInMax].some(v => v > MAX_STAKE)) {
    throw new Error(`Amounts are limited to $${MAX_STAKE.toLocaleString('en-US')}`);
  }

  return {
    gameMode: gameMode as GameMode,
    ...(variant !== undefined ? { variant: variant as GameVariant } : {}),
    smallBlind, bigBlind, smallBet, bigBet, ante, bringIn, buyInMin, buyInMax,
    startingChips: buyInMin,
  };
}
