// ============================================================
// Shared constants — labels, positions, timing, categories
// ============================================================

import {
  GameVariant,
  GamePhase,
  ActionType,
  BettingStructure,
  GameMode,
} from './engine-wrapper';

// Timing constants (ms)
export const BOT_ACTION_DELAY = 600;
export const STREET_TRANSITION_DELAY = 1200;
export const CARD_DEAL_INTERVAL = 180;
export const SHOWDOWN_DELAY = 800;
export const ALLIN_STREET_PAUSE = 2000;

export const HUMAN_ID = 'p0';

export const VARIANT_LABELS: Record<string, string> = {
  [GameVariant.NLH]: "No-Limit Hold'em",
  [GameVariant.PLO]: 'Pot-Limit Omaha',
  [GameVariant.Razz]: 'Razz',
  [GameVariant.LimitHoldem]: "Limit Hold'em",
  [GameVariant.Stud]: '7-Card Stud',
  [GameVariant.StudHiLo]: 'Stud Hi-Lo',
  [GameVariant.OmahaHiLo]: 'Omaha Hi-Lo (Limit)',
  [GameVariant.PLOHiLo]: 'PLO Hi-Lo',
  [GameVariant.TwoSevenSD]: '2-7 NL Single Draw',
  [GameVariant.TwoSevenTD]: '2-7 Limit Triple Draw',
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

export const VARIANT_SHORT: Record<string, string> = {
  [GameVariant.NLH]: 'NLH',
  [GameVariant.PLO]: 'PLO',
  [GameVariant.Razz]: 'Razz',
  [GameVariant.LimitHoldem]: 'LHE',
  [GameVariant.Stud]: 'Stud',
  [GameVariant.StudHiLo]: 'Stud8',
  [GameVariant.OmahaHiLo]: 'O8',
  [GameVariant.PLOHiLo]: 'PLO8',
  [GameVariant.TwoSevenSD]: '27SD',
  [GameVariant.TwoSevenTD]: '27TD',
  [GameVariant.Badugi]: 'Badugi',
  [GameVariant.Badeucy]: 'Bducy',
  [GameVariant.Badacey]: 'Bdacy',
  [GameVariant.Archie]: 'Archie',
  [GameVariant.DrawmahaHigh]: 'DMH',
  [GameVariant.Drawmaha27]: 'DM27',
  [GameVariant.DrawmahaA5]: 'DMA5',
  [GameVariant.Drawmaha49]: 'DM49',
  [GameVariant.LimitDrawmahaHigh]: 'LDMH',
  [GameVariant.LimitDrawmaha27]: 'LDM27',
  [GameVariant.LimitDrawmahaA5]: 'LDMA5',
  [GameVariant.LimitDrawmaha49]: 'LDM49',
  [GameVariant.TenThirtyDraw]: '1030',
  [GameVariant.PLBadugiDD]: 'PLBad',
  [GameVariant.PLBadeucyDD]: 'PLBdcy',
  [GameVariant.PLBadaceyDD]: 'PLBdacy',
  [GameVariant.PLArchieDD]: 'PLArch',
  [GameVariant.PLTenThirtyDD]: 'PL1030',
  [GameVariant.LimitOmahaHigh]: 'LOH',
};

export const GAME_MODE_LABELS: Record<string, string> = {
  [GameMode.Horse]: 'HORSE',
  [GameMode.EightGame]: '8-Game',
  [GameMode.NineGame]: '9-Game',
  [GameMode.DealersChoice]: "Dealer's Choice",
  [GameMode.SpecificGame]: 'Specific Game',
};

export const GAME_MODE_DESC: Record<string, string> = {
  [GameMode.Horse]: 'LHE → O8 → Razz → Stud → Stud8',
  [GameMode.EightGame]: 'HORSE + NLH, PLO, 27SD',
  [GameMode.NineGame]: '8-Game + 27TD',
  [GameMode.DealersChoice]: 'Button picks the game',
  [GameMode.SpecificGame]: 'Choose one game',
};

export const GAME_MODES: GameMode[] = [
  GameMode.Horse,
  GameMode.EightGame,
  GameMode.NineGame,
  GameMode.DealersChoice,
  GameMode.SpecificGame,
];

export const GAME_CATEGORIES = [
  { name: "Hold'em", structures: [
    { name: "No-Limit", variants: [GameVariant.NLH] },
    { name: "Fixed Limit", variants: [GameVariant.LimitHoldem] },
  ]},
  { name: "Omaha", structures: [
    { name: "Pot-Limit", variants: [GameVariant.PLO, GameVariant.PLOHiLo] },
    { name: "Fixed Limit", variants: [GameVariant.LimitOmahaHigh, GameVariant.OmahaHiLo] },
  ]},
  { name: "Stud", structures: [
    { name: "Fixed Limit", variants: [GameVariant.Stud, GameVariant.StudHiLo, GameVariant.Razz] },
  ]},
  { name: "Draw", structures: [
    { name: "No-Limit", variants: [GameVariant.TwoSevenSD] },
    { name: "Pot-Limit", variants: [GameVariant.PLBadugiDD, GameVariant.PLBadeucyDD, GameVariant.PLBadaceyDD, GameVariant.PLArchieDD, GameVariant.PLTenThirtyDD] },
    { name: "Fixed Limit", variants: [GameVariant.TwoSevenTD, GameVariant.Badugi, GameVariant.Badeucy, GameVariant.Badacey, GameVariant.Archie, GameVariant.TenThirtyDraw] },
  ]},
  { name: "Drawmaha", structures: [
    { name: "Pot-Limit", variants: [GameVariant.DrawmahaHigh, GameVariant.Drawmaha27, GameVariant.DrawmahaA5, GameVariant.Drawmaha49] },
    { name: "Fixed Limit", variants: [GameVariant.LimitDrawmahaHigh, GameVariant.LimitDrawmaha27, GameVariant.LimitDrawmahaA5, GameVariant.LimitDrawmaha49] },
  ]},
];

// Variants that use fixed-limit betting (need small bet / big bet fields)
export const LIMIT_VARIANTS = new Set<string>([
  GameVariant.LimitHoldem, GameVariant.OmahaHiLo, GameVariant.LimitOmahaHigh,
  GameVariant.Stud, GameVariant.StudHiLo, GameVariant.Razz,
  GameVariant.TwoSevenTD, GameVariant.Badugi, GameVariant.Badeucy,
  GameVariant.Badacey, GameVariant.Archie, GameVariant.TenThirtyDraw,
  GameVariant.LimitDrawmahaHigh, GameVariant.LimitDrawmaha27,
  GameVariant.LimitDrawmahaA5, GameVariant.LimitDrawmaha49,
]);

// Flat list of all variants for simple pickers
export const ALL_VARIANTS: string[] = GAME_CATEGORIES.flatMap(
  cat => cat.structures.flatMap(s => s.variants)
);

// Phases that represent new streets
export const BETTING_PHASES = new Set([
  GamePhase.BettingPreflop, GamePhase.BettingFlop, GamePhase.BettingTurn,
  GamePhase.BettingRiver, GamePhase.BettingThird, GamePhase.BettingFourth,
  GamePhase.BettingFifth, GamePhase.BettingSixth, GamePhase.BettingSeventh,
  GamePhase.BettingPostDraw1, GamePhase.BettingPostDraw2, GamePhase.BettingPostDraw3,
]);

export const DRAW_PHASES = ['draw-1', 'draw-2', 'draw-3'];

// Player positions around the table (for 2-6 players)
export const SEAT_POSITIONS: Record<number, Array<[number, number]>> = {
  2: [[50, 95], [50, -2]],
  3: [[50, 95], [4, 24], [96, 24]],
  4: [[50, 95], [-2, 50], [50, -2], [102, 50]],
  5: [[50, 95], [0, 65], [14, 2], [86, 2], [100, 65]],
  6: [[50, 95], [-1, 65], [4, 10], [50, -2], [96, 10], [101, 65]],
};

export const BET_OFFSETS: Record<number, Array<[number, number]>> = {
  2: [[50, 76], [50, 26]],
  3: [[50, 76], [28, 38], [72, 38]],
  4: [[50, 76], [24, 50], [50, 24], [76, 50]],
  5: [[50, 76], [22, 56], [32, 24], [68, 24], [78, 56]],
  6: [[50, 76], [22, 56], [24, 28], [50, 22], [76, 28], [78, 56]],
};

export const ACTION_STYLES: Record<string, { text: string; color: string }> = {
  fold:       { text: 'FOLD',     color: 'text-red-400' },
  check:      { text: 'CHECK',    color: 'text-slate-300' },
  call:       { text: 'CALL',     color: 'text-green-400' },
  bet:        { text: 'BET',      color: 'text-blue-400' },
  raise:      { text: 'RAISE',    color: 'text-purple-400' },
  'all-in':   { text: 'ALL IN',   color: 'text-amber-400' },
  'bring-in': { text: 'BRING-IN', color: 'text-slate-400' },
};

export function formatActionType(type: string, phase: string): string {
  if (phase === GamePhase.BettingPreflop && type === ActionType.Bet) {
    return 'raise';
  }
  return type;
}
