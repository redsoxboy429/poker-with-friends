// ============================================================
// Bot tables — watchable games that exercise side pots, hi/lo splits and caps
// ============================================================
// Bots are ordinary seats driven by the game controller. The strategies are
// deliberately loose (lots of all-ins and calls) so the interesting rules come
// up often, not to play well.

import { GameMode, GameVariant, type AvailableActions, type Card } from 'poker-engine';
import type { RoomSettings } from './types.js';

export interface BotStyle {
  /** Chance to move all-in / bet or raise the maximum when allowed */
  shove: number;
  /** Chance to make the minimum bet or raise */
  raise: number;
  /** Chance to call when facing a bet */
  call: number;
}

export interface BotScenario {
  id: string;
  label: string;
  description: string;
  settings: Partial<RoomSettings> & { gameMode: GameMode };
  /** Buy-ins in dollars, one bot per entry (bots rebuy to this when busted) */
  stacks: number[];
  style: BotStyle;
  /** Dealer's choice: the games bots pick from */
  picks?: GameVariant[];
}

export const BOT_NAMES = ['Ace', 'Blinky', 'Chip', 'Deuce', 'Echo', 'Fish'];

export const BOT_SCENARIOS: BotScenario[] = [
  {
    id: 'side-pots',
    label: 'Side pots',
    description: 'NLH, five bots with very different stacks ($10–$150) and lots of all-ins',
    settings: { gameMode: GameMode.SpecificGame, variant: GameVariant.NLH, smallBlind: 0.25, bigBlind: 0.5, buyInMin: 5, buyInMax: 300 },
    stacks: [10, 25, 50, 100, 150],
    style: { shove: 0.22, raise: 0.18, call: 0.5 },
  },
  {
    id: 'hi-lo',
    label: 'Hi/lo splits & quartering',
    description: 'Dealer\'s choice between O8 and Stud8, calling-station bots so many hands reach a split showdown',
    settings: { gameMode: GameMode.DealersChoice, smallBlind: 0.25, bigBlind: 0.5, smallBet: 2, bigBet: 4, buyInMin: 25, buyInMax: 300 },
    stacks: [60, 80, 100, 120, 150],
    style: { shove: 0.03, raise: 0.12, call: 0.85 },
    picks: [GameVariant.OmahaHiLo, GameVariant.StudHiLo],
  },
  {
    id: 'caps',
    label: 'Mixed-game caps',
    description: 'Dealer\'s choice between NLH, PLO and 2-7 Single Draw with deep stacks ($300 = 600 BB), so the 150 BB and 30 BB caps apply',
    settings: { gameMode: GameMode.DealersChoice, smallBlind: 0.25, bigBlind: 0.5, buyInMin: 25, buyInMax: 300 },
    stacks: [300, 300, 200, 120],
    style: { shove: 0.15, raise: 0.2, call: 0.5 },
    picks: [GameVariant.NLH, GameVariant.PLO, GameVariant.TwoSevenSD],
  },
  {
    id: 'ten-game',
    label: '10-Game soak',
    description: 'The full 10-Game rotation with five bots and mixed stacks',
    settings: { gameMode: GameMode.TenGame, smallBlind: 0.25, bigBlind: 0.5, smallBet: 2, bigBet: 4, buyInMin: 25, buyInMax: 300 },
    stacks: [40, 60, 100, 150, 200],
    style: { shove: 0.08, raise: 0.18, call: 0.6 },
  },
];

export function findScenario(id: unknown): BotScenario {
  const scenario = BOT_SCENARIOS.find(s => s.id === id);
  if (!scenario) throw new Error('Unknown bot scenario');
  return scenario;
}

export type BotDecision =
  | { type: 'fold' | 'check' | 'call' }
  | { type: 'bet' | 'raise'; amount: number };

/** Pick a legal betting action. `rand` returns [0, 1). */
export function decideBet(a: AvailableActions, style: BotStyle, rand: () => number = Math.random): BotDecision {
  // Choices of size (stud bring-in / complete, open pair on 4th): any listed amount is legal.
  if (a.canBet && a.betOptions) {
    const bringIn = !a.canCheck && !a.canFold;
    const i = bringIn ? (rand() < 0.7 ? 0 : a.betOptions.length - 1) : Math.floor(rand() * a.betOptions.length);
    return { type: 'bet', amount: a.betOptions[i] };
  }
  const r = rand();
  if (r < style.shove) {
    if (a.canRaise) return { type: 'raise', amount: a.raiseOptions ? a.raiseOptions[a.raiseOptions.length - 1] : a.maxRaise };
    if (a.canBet) return { type: 'bet', amount: a.maxBet };
  }
  if (r < style.shove + style.raise) {
    if (a.canRaise) return { type: 'raise', amount: a.raiseOptions ? a.raiseOptions[0] : a.minRaise };
    if (a.canBet) return { type: 'bet', amount: a.minBet };
  }
  if (a.canCall && r < style.shove + style.raise + style.call) return { type: 'call' };
  if (a.canCheck) return { type: 'check' };
  if (a.canFold) return { type: 'fold' };
  return a.canCall ? { type: 'call' } : { type: 'check' };
}

/**
 * Which cards to throw in a lowball draw: the highest cards first (aces are high
 * in 2-7, low in Badugi), 0–3 of them, fewer on later draws.
 */
export function decideDiscards(holeCards: Card[], variant: string, rand: () => number = Math.random): number[] {
  const aceLow = variant === GameVariant.Badugi;
  const rank = (c: Card) => (aceLow && c.rank === 14 ? 1 : c.rank);
  const byHighFirst = holeCards.map((c, i) => ({ i, r: rank(c) })).sort((x, y) => y.r - x.r);
  const maxThrow = variant === GameVariant.TwoSevenSD ? 2 : 3;
  const count = Math.min(maxThrow, byHighFirst.filter(x => x.r >= 9).length + (rand() < 0.3 ? 1 : 0));
  return byHighFirst.slice(0, count).map(x => x.i).sort((a, b) => a - b);
}
