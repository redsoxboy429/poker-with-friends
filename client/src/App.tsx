import { useState, useCallback, useRef, useEffect } from 'react';
import {
  createPlayers,
  createGame,
  getBotAction,
  isDrawGame,
  isDrawmahaGame,
  getBotDiscardIndices,
  GameVariant,
  GamePhase,
  ActionType,
  type HandState,
  type AvailableActions,
  type PlayerState,
  BettingStructure,
  GameSession,
  GameMode,
  type GameSessionState,
} from './engine-wrapper';
import type { BaseGame } from '@engine/games/base.ts';
import type { BaseDrawGame } from '@engine/games/draw-base.ts';
import { type Card, RANK_NAMES, SUIT_SYMBOLS, type TableConfig } from '@engine/types.ts';

// ============================================================
// Constants
// ============================================================

const HUMAN_ID = 'p0';
const NUM_PLAYERS = 4;
const STARTING_CHIPS = 1000;

// Timing constants (ms)
const BOT_ACTION_DELAY = 600;       // Pause before each bot action
const STREET_TRANSITION_DELAY = 1200; // Extra pause when a new street begins
const CARD_DEAL_INTERVAL = 180;      // Stagger between each card appearing
const SHOWDOWN_DELAY = 800;          // Pause before showing results
const ALLIN_STREET_PAUSE = 2000;     // Longer pause between streets during all-in runout (sweating)

/**
 * Format an action type for display in the action log.
 * Preflop, the BB's "bet" is really a "raise" (over the blind).
 */
function formatActionType(type: string, phase: string): string {
  if (phase === GamePhase.BettingPreflop && type === ActionType.Bet) {
    return 'raise';
  }
  return type;
}

// Phases that represent new streets (community card reveals or stud streets)
const BETTING_PHASES = new Set([
  GamePhase.BettingPreflop, GamePhase.BettingFlop, GamePhase.BettingTurn,
  GamePhase.BettingRiver, GamePhase.BettingThird, GamePhase.BettingFourth,
  GamePhase.BettingFifth, GamePhase.BettingSixth, GamePhase.BettingSeventh,
  GamePhase.BettingPostDraw1, GamePhase.BettingPostDraw2, GamePhase.BettingPostDraw3,
]);

const VARIANT_LABELS: Record<string, string> = {
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

const VARIANT_SHORT: Record<string, string> = {
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

// Game mode labels
const GAME_MODE_LABELS: Record<string, string> = {
  [GameMode.Horse]: 'HORSE',
  [GameMode.EightGame]: '8-Game',
  [GameMode.NineGame]: '9-Game',
  [GameMode.DealersChoice]: "Dealer's Choice",
  [GameMode.SpecificGame]: 'Specific Game',
};

const GAME_MODE_DESC: Record<string, string> = {
  [GameMode.Horse]: 'LHE → O8 → Razz → Stud → Stud8',
  [GameMode.EightGame]: 'HORSE + NLH, PLO, 27SD',
  [GameMode.NineGame]: '8-Game + 27TD',
  [GameMode.DealersChoice]: 'Button picks the game',
  [GameMode.SpecificGame]: 'Choose one game',
};

const GAME_MODES: GameMode[] = [
  GameMode.Horse,
  GameMode.EightGame,
  GameMode.NineGame,
  GameMode.DealersChoice,
  GameMode.SpecificGame,
];

// Two-step game category selector
// 3-level game selector: Category → Betting Structure → Game
const GAME_CATEGORIES = [
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

// Player positions around the table (for 2-6 players)
// Positions as percentage offsets from center of table container
// [left%, top%] — you (seat 0) is always bottom center
const SEAT_POSITIONS: Record<number, Array<[number, number]>> = {
  2: [
    [50, 95],  // You - bottom
    [50, -2],  // Opponent - top
  ],
  3: [
    [50, 95],  // You - bottom
    [4, 24],   // Top-left
    [96, 24],  // Top-right
  ],
  4: [
    [50, 95],  // You - bottom center
    [-2, 50],  // Left
    [50, -2],  // Top center
    [102, 50], // Right
  ],
  5: [
    [50, 95],  // You - bottom center
    [0, 65],   // Left
    [14, 2],   // Top-left
    [86, 2],   // Top-right
    [100, 65], // Right
  ],
  6: [
    [50, 95],  // You - bottom center
    [-1, 65],  // Bottom-left
    [4, 10],   // Top-left
    [50, -2],  // Top center
    [96, 10],  // Top-right
    [101, 65], // Bottom-right
  ],
};

// Bet chip positions — offset from player toward center
const BET_OFFSETS: Record<number, Array<[number, number]>> = {
  2: [
    [50, 70], [50, 26],
  ],
  3: [
    [50, 70], [28, 38], [72, 38],
  ],
  4: [
    [50, 70], [24, 50], [50, 24], [76, 50],
  ],
  5: [
    [50, 70], [22, 56], [32, 24], [68, 24], [78, 56],
  ],
  6: [
    [50, 70], [22, 56], [24, 28], [50, 22], [76, 28], [78, 56],
  ],
};

// ============================================================
// Card Component — realistic playing card
// ============================================================

const CARD_W = 58;
const CARD_H = 82;

function CardFace({ card }: { card: Card }) {
  const isRed = card.suit === 'h' || card.suit === 'd';
  const rankStr = RANK_NAMES[card.rank];
  const suitStr = SUIT_SYMBOLS[card.suit];
  const color = isRed ? '#dc2626' : '#1a1a2e';

  return (
    <div
      className="relative rounded-md shadow-lg select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f8f8 100%)',
        border: '1px solid #d1d5db',
      }}
    >
      {/* Top-left pip */}
      <div className="absolute top-0.5 left-1.5 leading-none" style={{ color }}>
        <div className="text-[13px] font-bold">{rankStr}</div>
        <div className="text-[12px] -mt-0.5">{suitStr}</div>
      </div>
      {/* Center suit */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ color }}
      >
        <span className="text-2xl">{suitStr}</span>
      </div>
      {/* Bottom-right pip (inverted) */}
      <div
        className="absolute bottom-0.5 right-1.5 leading-none rotate-180"
        style={{ color }}
      >
        <div className="text-[13px] font-bold">{rankStr}</div>
        <div className="text-[12px] -mt-0.5">{suitStr}</div>
      </div>
    </div>
  );
}

function CardBack() {
  return (
    <div
      className="relative rounded-md shadow-lg overflow-hidden select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2744 100%)',
        border: '1px solid #2d4a6f',
      }}
    >
      {/* Diamond pattern */}
      <div className="absolute inset-1 rounded-sm opacity-20"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 4px,
            rgba(255,255,255,0.3) 4px,
            rgba(255,255,255,0.3) 5px
          ), repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            rgba(255,255,255,0.3) 4px,
            rgba(255,255,255,0.3) 5px
          )`,
        }}
      />
      {/* Inner border */}
      <div className="absolute inset-1.5 rounded-sm border border-blue-400/20" />
    </div>
  );
}

function CardDisplay({ card, faceDown = false }: { card?: Card; faceDown?: boolean }) {
  if (!card || faceDown) return <CardBack />;
  return <CardFace card={card} />;
}

// ============================================================
// Player Seat — positioned around the table
// ============================================================

// Action label styling
const ACTION_STYLES: Record<string, { text: string; color: string }> = {
  fold:      { text: 'FOLD',     color: 'text-red-400' },
  check:     { text: 'CHECK',    color: 'text-slate-300' },
  call:      { text: 'CALL',     color: 'text-green-400' },
  bet:       { text: 'BET',      color: 'text-blue-400' },
  raise:     { text: 'RAISE',    color: 'text-purple-400' },
  'all-in':  { text: 'ALL IN',   color: 'text-amber-400' },
  'bring-in':{ text: 'BRING-IN', color: 'text-slate-400' },
};

function PlayerSeat({
  player,
  isActive,
  isDealer,
  isHuman,
  showCards,
  position,
  isTop,
  lastAction,
  lastDrawAction,
  dealtCardCount = 99,
  onCardClick,
  selectedDiscardIndices,
  isDrawing,
  chipsBehind,
  forceAllDown,
  handDescription,
}: {
  player: PlayerState;
  isActive: boolean;
  isDealer: boolean;
  isHuman: boolean;
  showCards: boolean;
  position: [number, number];
  isTop: boolean; // Cards above or below name
  lastAction?: string;
  lastDrawAction?: string; // "Drew X" or "Stand Pat" — persists through post-draw betting
  dealtCardCount?: number; // How many of this player's cards have been "dealt" (for animation)
  onCardClick?: (idx: number) => void;
  selectedDiscardIndices?: Set<number>;
  isDrawing?: boolean;
  chipsBehind?: number; // Extra chips behind the cap (shown grayed out)
  forceAllDown?: boolean; // Stud: force all cards face-down during initial deal
  handDescription?: string; // Hand strength to display at showdown
}) {
  const hasVisibility =
    player.cardVisibility && player.cardVisibility.length > 0;

  // Hide cards entirely for folded players
  const hideCards = player.folded || player.holeCards.length === 0;

  const cards = hideCards
    ? null
    : player.holeCards.map((card, i) => {
        const isDealtYet = i < dealtCardCount;
        let faceDown = false;
        if (forceAllDown) {
          // Stud initial deal: all cards face-down until reveal
          faceDown = !isHuman; // Human can still see their own
        } else if (isHuman || showCards) {
          faceDown = false;
        } else if (hasVisibility) {
          faceDown = player.cardVisibility![i] === 'down';
        } else {
          faceDown = true;
        }
        // Stud: bump up-cards higher to visually differentiate (not during forceDown)
        const isUpCard = !forceAllDown && hasVisibility && player.cardVisibility![i] === 'up';
        const isSelected = isDrawing && selectedDiscardIndices?.has(i);
        return (
          <div
            key={i}
            className={`transition-all duration-200 ${isDrawing && isHuman ? 'cursor-pointer' : ''}`}
            onClick={() => isDrawing && isHuman && onCardClick?.(i)}
            style={{
              opacity: isDealtYet ? 1 : 0,
              transform: isDealtYet
                ? `scale(1)${isUpCard ? ' translateY(-6px)' : ''}${isSelected ? ' translateY(-12px)' : ''}`
                : 'scale(0.7)',
              outline: isSelected ? '2px solid #f59e0b' : 'none',
              outlineOffset: '2px',
              borderRadius: '6px',
            }}
          >
            <CardDisplay card={card} faceDown={faceDown} />
          </div>
        );
      });

  const nameChips = (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-all ${
        isActive
          ? 'bg-yellow-500/90 text-black shadow-lg shadow-yellow-500/30'
          : player.folded
            ? 'bg-slate-800/60 text-slate-600'
            : isHuman
              ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/30'
              : 'bg-slate-800/80 text-slate-200 border border-slate-600/30'
      }`}
    >
      {isDealer && (
        <span className="w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold flex items-center justify-center flex-shrink-0">
          D
        </span>
      )}
      <span className="text-xs font-semibold truncate max-w-[60px]">
        {player.name}
      </span>
      <span className="text-[10px] font-mono opacity-70">
        {player.chips}
        {chipsBehind && chipsBehind > 0 ? (
          <span className="text-slate-500 ml-0.5">({player.chips + chipsBehind})</span>
        ) : null}
      </span>
    </div>
  );

  const handBadge = handDescription && !player.folded ? (
    <span className="text-[10px] font-semibold text-amber-300 bg-black/60 px-2 py-0.5 rounded max-w-[280px] text-center whitespace-nowrap overflow-hidden text-ellipsis">
      {handDescription}
    </span>
  ) : null;

  const actionStyle = lastAction ? ACTION_STYLES[lastAction] : null;

  const drawBadge = lastDrawAction ? (
    <span className="text-[10px] font-bold text-cyan-400">
      {lastDrawAction.toUpperCase()}
    </span>
  ) : null;

  const statusBadge = player.folded ? (
    <span className="text-[10px] text-red-400 font-semibold">FOLD</span>
  ) : player.allIn ? (
    <div className="flex items-center gap-1.5">
      {drawBadge}
      <span className="text-[10px] text-amber-400 font-bold animate-pulse">
        ALL IN
      </span>
    </div>
  ) : actionStyle ? (
    <div className="flex items-center gap-1.5">
      {drawBadge}
      <span className={`text-[10px] font-bold ${actionStyle.color}`}>
        {actionStyle.text}
      </span>
    </div>
  ) : drawBadge ? drawBadge : null;

  return (
    <div
      className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2 z-10"
      style={{
        left: `${position[0]}%`,
        top: `${position[1]}%`,
      }}
    >
      {isTop ? (
        <>
          {nameChips}
          {statusBadge}
          {cards && <div className="flex gap-0.5">{cards}</div>}
          {handBadge}
        </>
      ) : (
        <>
          {handBadge}
          {cards && <div className="flex gap-0.5">{cards}</div>}
          {statusBadge}
          {nameChips}
        </>
      )}
    </div>
  );
}

// ============================================================
// Bet Chip — shows bet amount between player and center
// ============================================================

function BetChip({
  amount,
  position,
}: {
  amount: number;
  position: [number, number];
}) {
  if (amount <= 0) return null;
  const chipGroups = decomposeChips(amount);
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
      style={{
        left: `${position[0]}%`,
        top: `${position[1]}%`,
      }}
    >
      <div className="flex flex-col items-center gap-0">
        <div className="flex items-end gap-0.5">
          {chipGroups.slice(0, 3).map((group, gi) => (
            <div key={gi} className="flex flex-col-reverse items-center">
              {Array.from({ length: Math.min(group.count, 2) }, (_, i) => (
                <div key={i} style={{ marginTop: i > 0 ? -10 : 0 }}>
                  <CasinoChip value={group.value} size={16} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <span className="text-[9px] font-mono font-bold text-amber-400 mt-0.5">
          {amount}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Casino Chip — renders a single chip with denomination styling
// ============================================================

const CHIP_DENOM = [
  { value: 100, bg: 'from-gray-800 to-black', border: 'border-gray-500/60', edge: 'bg-gray-600' },
  { value: 25, bg: 'from-green-500 to-green-700', border: 'border-green-300/60', edge: 'bg-green-400' },
  { value: 5, bg: 'from-red-500 to-red-700', border: 'border-red-300/60', edge: 'bg-red-400' },
  { value: 1, bg: 'from-gray-100 to-gray-300', border: 'border-gray-400/60', edge: 'bg-white' },
  { value: 0.25, bg: 'from-blue-400 to-blue-600', border: 'border-blue-300/60', edge: 'bg-blue-300' },
] as const;

/** Break an amount into casino chip denominations */
function decomposeChips(amount: number): Array<{ value: number; count: number }> {
  const result: Array<{ value: number; count: number }> = [];
  let remaining = amount;
  for (const denom of CHIP_DENOM) {
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      result.push({ value: denom.value, count });
      remaining -= count * denom.value;
    }
  }
  return result;
}

function CasinoChip({ value, size = 20 }: { value: number; size?: number }) {
  const denom = CHIP_DENOM.find(d => d.value === value) || CHIP_DENOM[CHIP_DENOM.length - 1];
  const isWhite = value === 1;
  return (
    <div
      className={`rounded-full bg-gradient-to-br ${denom.bg} border-2 ${denom.border} flex items-center justify-center relative overflow-hidden`}
      style={{ width: size, height: size }}
    >
      {/* Edge stripes */}
      <div className={`absolute top-[2px] left-1/2 -translate-x-1/2 w-[60%] h-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute bottom-[2px] left-1/2 -translate-x-1/2 w-[60%] h-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute left-[2px] top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute right-[2px] top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-full ${denom.edge} opacity-60`} />
    </div>
  );
}

// ============================================================
// Win Display — handles split-pot 2-column layout
// ============================================================

type WinEntry = { playerId: string; name: string; amount: number; handDescription?: string; side?: string; potLabel?: string };

/** Consolidate multiple win entries for the same player+side into one (summing amounts) */
function consolidateEntries(entries: WinEntry[]): WinEntry[] {
  const map = new Map<string, WinEntry>();
  for (const e of entries) {
    // Keep entries separate when pot labels differ (main pot vs side pot)
    const key = `${e.playerId}-${e.side ?? 'none'}-${e.potLabel ?? 'single'}`;
    const prev = map.get(key);
    if (prev) {
      // Round to avoid floating point drift
      prev.amount = Math.round((prev.amount + e.amount) * 100) / 100;
    } else {
      map.set(key, { ...e });
    }
  }
  return [...map.values()];
}

function SplitColumn({ label, entries, borderColor, labelColor, textColor, descColor, suffix }: {
  label: string; entries: WinEntry[]; borderColor: string; labelColor: string;
  textColor: string; descColor: string; suffix: string;
}) {
  const consolidated = consolidateEntries(entries);
  return (
    <div className={`flex flex-col items-center gap-1 bg-black/60 border ${borderColor} rounded-lg px-3 py-2 min-w-[120px]`}>
      <span className={`text-[10px] uppercase tracking-wider ${labelColor} font-semibold`}>{label}</span>
      {consolidated.map((w, idx) => (
        <div key={`${w.playerId}-${w.side ?? 'none'}-${w.potLabel ?? 'single'}-${idx}`} className="flex flex-col items-center">
          {w.potLabel && (
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide">
              {w.potLabel}
            </span>
          )}
          <span className={`text-xs font-bold ${textColor}`}>
            {w.name} {w.amount}
          </span>
          {w.handDescription && (
            <span className={`text-[10px] ${descColor}`}>
              {w.handDescription.replace(suffix, '')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function WinDisplay({ winInfo, variant }: { winInfo: WinEntry[]; variant?: string }) {
  const totalPot = Math.round(winInfo.reduce((sum, w) => sum + w.amount, 0) * 100) / 100;

  // Detect split-pot type using side field
  const hasDrawmahaSides = winInfo.some(w => w.side === 'draw' || w.side === 'omaha');
  const hasHiLoSides = winInfo.some(w => w.side === 'high' || w.side === 'low');
  const hasScoopOnly = winInfo.every(w => !w.side || w.side === 'scoop');

  // Badeucy/Badacey: "high" side is actually badugi, not a traditional high hand
  const isBadugiSplit = variant && [
    GameVariant.Badeucy, GameVariant.Badacey,
    GameVariant.PLBadeucyDD, GameVariant.PLBadaceyDD,
  ].includes(variant as GameVariant);
  const highLabel = isBadugiSplit ? 'Badugi' : 'High';

  // Scoop or simple win — no split display
  if (hasScoopOnly) {
    return <SimpleWinDisplay winInfo={consolidateEntries(winInfo)} totalPot={totalPot} />;
  }

  // Drawmaha: draw + omaha columns, plus any scoop entries (from side pots)
  if (hasDrawmahaSides) {
    const drawEntries = winInfo.filter(w => w.side === 'draw');
    const omahaEntries = winInfo.filter(w => w.side === 'omaha');
    const scoopEntries = winInfo.filter(w => w.side === 'scoop');

    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
        <div className="flex items-start gap-3 justify-center">
          <SplitColumn label="Draw" entries={drawEntries}
            borderColor="border-blue-400/40" labelColor="text-blue-300/80"
            textColor="text-blue-200" descColor="text-blue-300/60" suffix=" (draw)" />
          <SplitColumn label="Omaha" entries={omahaEntries}
            borderColor="border-amber-400/40" labelColor="text-amber-300/80"
            textColor="text-amber-200" descColor="text-amber-300/60" suffix=" (omaha)" />
        </div>
        {scoopEntries.length > 0 && (
          <SimpleWinDisplay winInfo={consolidateEntries(scoopEntries)} />
        )}
      </div>
    );
  }

  // Hi-lo: high + low columns, plus any scoop entries (from side pots where one side scoops)
  if (hasHiLoSides) {
    const highEntries = winInfo.filter(w => w.side === 'high');
    const lowEntries = winInfo.filter(w => w.side === 'low');
    const scoopEntries = winInfo.filter(w => w.side === 'scoop');

    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
        <div className="flex items-start gap-3 justify-center">
          {highEntries.length > 0 && (
            <SplitColumn label={highLabel} entries={highEntries}
              borderColor="border-emerald-400/40" labelColor="text-emerald-300/80"
              textColor="text-emerald-200" descColor="text-emerald-300/60" suffix=" (high)" />
          )}
          {lowEntries.length > 0 && (
            <SplitColumn label="Low" entries={lowEntries}
              borderColor="border-purple-400/40" labelColor="text-purple-300/80"
              textColor="text-purple-200" descColor="text-purple-300/60" suffix=" (low)" />
          )}
        </div>
        {scoopEntries.length > 0 && (
          <SimpleWinDisplay winInfo={consolidateEntries(scoopEntries)} />
        )}
      </div>
    );
  }

  return <SimpleWinDisplay winInfo={consolidateEntries(winInfo)} totalPot={totalPot} />;
}

function SimpleWinDisplay({ winInfo, totalPot }: { winInfo: WinEntry[]; totalPot?: number }) {
  // Group by pot label for organized display
  const potGroups = new Map<string, WinEntry[]>();
  for (const w of winInfo) {
    const key = w.potLabel ?? '';
    if (!potGroups.has(key)) potGroups.set(key, []);
    potGroups.get(key)!.push(w);
  }
  const groups = [...potGroups.entries()];

  return (
    <div className="flex flex-col items-center gap-1.5">
      {totalPot !== undefined && (
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
      )}
      {groups.map(([label, entries]) => (
        <div key={label || 'main'} className="flex flex-col items-center gap-1">
          {label && (
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
              {label}
            </span>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {entries.map((w, idx) => (
              <div
                key={`${w.playerId}-${idx}`}
                className="flex flex-col items-center bg-black/60 border border-emerald-400/40 rounded-lg px-3 py-1.5"
              >
                <span className="text-xs font-bold text-emerald-300">
                  {w.name} {w.name === 'You' ? 'win' : 'wins'} {w.amount}
                </span>
                {w.handDescription && (
                  <span className="text-[10px] text-emerald-400/70 font-medium">
                    {w.handDescription}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Pot Display — center of table with casino chips
// ============================================================

function PotChipStack({ amount, label }: { amount: number; label?: string }) {
  if (amount <= 0) return null;
  const chipGroups = decomposeChips(amount);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-end gap-1">
        {chipGroups.map((group, gi) => (
          <div key={gi} className="flex flex-col-reverse items-center">
            {Array.from({ length: Math.min(group.count, 4) }, (_, i) => (
              <div key={i} style={{ marginTop: i > 0 ? -14 : 0 }}>
                <CasinoChip value={group.value} size={label ? 16 : 22} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className={`font-mono font-bold text-amber-300 bg-black/50 rounded-full px-2 py-0.5 ${label ? 'text-[10px]' : 'text-sm'}`}>
        {label && <span className="text-amber-400/70 mr-1">{label}:</span>}
        {amount}
      </span>
    </div>
  );
}

function PotDisplay({ collectedAmount, totalAmount, pots }: { collectedAmount: number; totalAmount?: number; pots?: Array<{ amount: number; eligiblePlayerIds: string[] }> }) {
  if (collectedAmount <= 0 && !totalAmount) return null;

  const showTotal = totalAmount && totalAmount > collectedAmount;
  const hasSidePots = pots && pots.length > 1;

  return (
    <div className="flex flex-col items-center gap-1">
      {hasSidePots ? (
        <div className="flex items-end gap-3">
          {pots.map((pot, i) => (
            <PotChipStack
              key={i}
              amount={pot.amount}
              label={i === 0 ? 'Main' : pots.length === 2 ? 'Side' : `Side ${i}`}
            />
          ))}
        </div>
      ) : (
        <PotChipStack amount={collectedAmount} />
      )}
      {showTotal && (
        <span className="text-xs font-mono text-amber-400/70 bg-black/50 rounded-full px-2">
          Total: {totalAmount}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Setup Panel — pre-deal configuration
// ============================================================

function SetupPanel({
  gameMode, onGameModeChange,
  bbSB, onBbSBChange,
  bbBB, onBbBBChange,
  limSmallBet, onLimSmallBetChange,
  limBigBet, onLimBigBetChange,
  stackBB, onStackBBChange,
  numPlayers, onNumPlayersChange,
  variant, onVariantChange,
  selectorStep, onSelectorStepChange,
  selectedCategoryIdx, onSelectedCategoryIdxChange,
  selectedStructureIdx, onSelectedStructureIdxChange,
  onDeal,
}: {
  gameMode: GameMode; onGameModeChange: (m: GameMode) => void;
  bbSB: number; onBbSBChange: (v: number) => void;
  bbBB: number; onBbBBChange: (v: number) => void;
  limSmallBet: number; onLimSmallBetChange: (v: number) => void;
  limBigBet: number; onLimBigBetChange: (v: number) => void;
  stackBB: number; onStackBBChange: (v: number) => void;
  numPlayers: number; onNumPlayersChange: (v: number) => void;
  variant: GameVariant; onVariantChange: (v: GameVariant) => void;
  selectorStep: 'category' | 'structure' | 'variant'; onSelectorStepChange: (s: 'category' | 'structure' | 'variant') => void;
  selectedCategoryIdx: number; onSelectedCategoryIdxChange: (i: number) => void;
  selectedStructureIdx: number; onSelectedStructureIdxChange: (i: number) => void;
  onDeal: () => void;
}) {
  const startingChips = stackBB * bbBB;
  const inputClass = "w-full px-2 py-1 rounded bg-slate-800 text-white text-sm border border-slate-600 focus:border-emerald-400 focus:outline-none";

  return (
    <div className="flex flex-col items-center gap-3 bg-slate-900/80 border border-slate-700 rounded-lg p-5 max-w-sm pointer-events-auto">
      <h2 className="text-sm font-bold text-white">Setup Game</h2>

      {/* Game Mode */}
      <div className="w-full">
        <label className="text-xs font-semibold text-slate-300 block mb-1">Game Mode</label>
        <div className="flex flex-wrap gap-1">
          {GAME_MODES.map((m) => (
            <button key={m} onClick={() => onGameModeChange(m)}
              className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors min-w-[60px] ${
                gameMode === m ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >{GAME_MODE_LABELS[m]}</button>
          ))}
        </div>
        <div className="text-[11px] text-slate-400 text-center mt-1">{GAME_MODE_DESC[gameMode]}</div>
      </div>

      {/* Specific Game variant picker (only for Specific Game mode) */}
      {gameMode === GameMode.SpecificGame && (
        <div className="w-full">
          <label className="text-xs font-semibold text-slate-300 block mb-1">Game</label>
          <div className="flex flex-wrap gap-1">
            {selectorStep === 'category' ? (
              GAME_CATEGORIES.map((cat, idx) => {
                const allVariants = cat.structures.flatMap(s => s.variants);
                const containsCurrent = allVariants.includes(variant);
                return (
                  <button key={cat.name}
                    onClick={() => {
                      onSelectedCategoryIdxChange(idx);
                      // Skip structure step if only 1 structure
                      if (cat.structures.length === 1) {
                        onSelectedStructureIdxChange(0);
                        onSelectorStepChange('variant');
                      } else {
                        onSelectorStepChange('structure');
                      }
                    }}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      containsCurrent ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >{cat.name}</button>
                );
              })
            ) : selectorStep === 'structure' ? (
              <>
                <button onClick={() => onSelectorStepChange('category')}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors" title="Back">←</button>
                {GAME_CATEGORIES[selectedCategoryIdx].structures.map((struct, idx) => {
                  const containsCurrent = struct.variants.includes(variant);
                  return (
                    <button key={struct.name}
                      onClick={() => {
                        onSelectedStructureIdxChange(idx);
                        // If only 1 variant in this structure, select it directly
                        if (struct.variants.length === 1) {
                          onVariantChange(struct.variants[0]);
                          onSelectorStepChange('category');
                        } else {
                          onSelectorStepChange('variant');
                        }
                      }}
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                        containsCurrent ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >{struct.name}</button>
                  );
                })}
              </>
            ) : (
              <>
                <button onClick={() => {
                  // Go back to structure if multiple structures, else category
                  const cat = GAME_CATEGORIES[selectedCategoryIdx];
                  onSelectorStepChange(cat.structures.length > 1 ? 'structure' : 'category');
                }}
                  className="px-2 py-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors" title="Back">←</button>
                {GAME_CATEGORIES[selectedCategoryIdx].structures[selectedStructureIdx].variants.map((v) => (
                  <button key={v}
                    onClick={() => { onVariantChange(v); onSelectorStepChange('category'); }}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      variant === v ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >{VARIANT_SHORT[v]}</button>
                ))}
              </>
            )}
          </div>
          <div className="text-[11px] text-emerald-400/70 text-center mt-1">{VARIANT_LABELS[variant]}</div>
        </div>
      )}

      {/* Big-Bet Stakes (NL/PL blinds) */}
      <div className="w-full">
        <label className="text-xs font-semibold text-slate-300 block mb-1">Big-Bet Blinds</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-slate-400">SB</label>
            <input type="number" value={bbSB} onChange={(e) => onBbSBChange(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-slate-400">BB</label>
            <input type="number" value={bbBB} onChange={(e) => onBbBBChange(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Limit Stakes */}
      <div className="w-full">
        <label className="text-xs font-semibold text-slate-300 block mb-1">Limit Stakes</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[11px] text-slate-400">Small Bet</label>
            <input type="number" value={limSmallBet} onChange={(e) => onLimSmallBetChange(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className="text-[11px] text-slate-400">Big Bet</label>
            <input type="number" value={limBigBet} onChange={(e) => onLimBigBetChange(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
          </div>
        </div>
      </div>

      {/* Buy-in (always in big-bet BBs) */}
      <div className="w-full">
        <label className="text-xs font-semibold text-slate-300 block mb-1">
          Buy-in: {stackBB} BB (${startingChips.toFixed(2)})
        </label>
        <input type="range" min="50" max="300" value={stackBB} onChange={(e) => onStackBBChange(Number(e.target.value))} className="w-full accent-emerald-500" />
      </div>

      {/* Players */}
      <div className="w-full">
        <label className="text-xs font-semibold text-slate-300 block mb-1">Players: {numPlayers}</label>
        <div className="flex gap-1">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} onClick={() => onNumPlayersChange(n)}
              className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${numPlayers === n ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}`}
            >{n}</button>
          ))}
        </div>
      </div>

      {/* Deal */}
      <button onClick={onDeal}
        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-colors active:scale-95 shadow-lg shadow-emerald-900/30">
        Deal
      </button>
    </div>
  );
}

// ============================================================
// Action Panel — anchored at bottom
// ============================================================

function ActionPanel({
  actions,
  onAction,
  bettingStructure,
  phase,
  minChip,
}: {
  actions: AvailableActions;
  onAction: (type: ActionType, amount?: number) => void;
  bettingStructure: string;
  phase?: string;
  minChip: number;
}) {
  // Preflop, BB's "bet" is really a "raise" over the blind
  const betLabel = phase === GamePhase.BettingPreflop ? 'Raise' : 'Bet';
  const isPotLimit = bettingStructure === BettingStructure.PotLimit;
  const isNoLimit = bettingStructure === BettingStructure.NoLimit;
  const maxLabel = isPotLimit ? 'Pot' : isNoLimit ? 'All In' : null;
  const isFixedLimit = bettingStructure === 'fixed-limit';

  // Determine the active sizing range (bet or raise — only one is active at a time)
  const isBetting = actions.canBet && !isFixedLimit && actions.minBet < actions.maxBet;
  const isRaising = actions.canRaise && !isFixedLimit && actions.minRaise < actions.maxRaise;
  const showSizing = isBetting || isRaising;
  const sizeMin = isBetting ? actions.minBet : (isRaising ? actions.minRaise : 0);
  const sizeMax = isBetting ? actions.maxBet : (isRaising ? actions.maxRaise : 0);

  const [raiseAmount, setRaiseAmount] = useState(sizeMin);
  const [inputText, setInputText] = useState(String(sizeMin));

  // Sync when available actions change (new hand, new street, etc.)
  useEffect(() => {
    setRaiseAmount(sizeMin);
    setInputText(String(sizeMin));
  }, [sizeMin]);

  // Keep text in sync when slider moves — snap to minChip increments
  const handleSlider = (val: number) => {
    const snapped = Math.round(val / minChip) * minChip;
    // Round to avoid floating point noise (e.g., 0.25 * 3 = 0.75 not 0.7500000001)
    const clean = Math.round(snapped * 100) / 100;
    setRaiseAmount(clean);
    setInputText(String(clean));
  };

  // Clamp typed input: if too big, snap to max immediately
  const handleInputChange = (raw: string) => {
    // Allow empty string or partial decimal while typing
    if (raw === '' || raw === '.') {
      setInputText(raw);
      return;
    }
    const num = parseFloat(raw);
    if (isNaN(num)) return; // ignore non-numeric
    // Snap to minChip increments
    const snapped = Math.round(num / minChip) * minChip;
    const clean = Math.round(Math.min(snapped, sizeMax) * 100) / 100;
    setRaiseAmount(Math.max(clean, sizeMin));
    setInputText(raw); // keep raw text while typing for UX
  };

  // On blur, enforce minimum and snap to increment
  const handleInputBlur = () => {
    const num = parseFloat(inputText);
    const snapped = isNaN(num) ? sizeMin : Math.round(num / minChip) * minChip;
    const final = Math.round(Math.max(Math.min(snapped, sizeMax), sizeMin) * 100) / 100;
    setRaiseAmount(final);
    setInputText(String(final));
  };

  // Prevent Enter key from submitting — must click the button
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const btnBase =
    'px-6 py-3 rounded-lg font-bold text-base transition-all active:scale-95 shadow-md text-center';

  return (
    <div className="flex flex-wrap items-center gap-2 justify-center">
      {actions.canFold && (
        <button
          onClick={() => onAction(ActionType.Fold)}
          className={`${btnBase} bg-red-700 hover:bg-red-600 text-white shadow-red-900/30`}
        >
          Fold
        </button>
      )}
      {actions.canCheck && (
        <button
          onClick={() => onAction(ActionType.Check)}
          className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}
        >
          Check
        </button>
      )}
      {actions.canCall && (
        <button
          onClick={() => onAction(ActionType.Call)}
          className={`${btnBase} bg-green-700 hover:bg-green-600 text-white shadow-green-900/30`}
        >
          Call {actions.callAmount}
        </button>
      )}
      {actions.canBet && (
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              onAction(
                ActionType.Bet,
                isFixedLimit ? actions.minBet : raiseAmount,
              )
            }
            className={`${btnBase} bg-blue-700 hover:bg-blue-600 text-white shadow-blue-900/30 w-[140px]`}
          >
            {betLabel} {isFixedLimit ? actions.minBet : raiseAmount}
          </button>
          {isBetting && (
            <>
              <input
                type="range"
                min={actions.minBet}
                max={actions.maxBet}
                step={minChip}
                value={raiseAmount}
                onChange={(e) => handleSlider(Number(e.target.value))}
                className="w-36 h-3 accent-blue-500"
              />
              <input
                type="text"
                inputMode="numeric"
                value={inputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-20 px-3 py-2 rounded bg-slate-700 text-white text-base text-center font-semibold
                           border border-slate-500 focus:border-blue-400 focus:outline-none"
              />
              {maxLabel && (
                <button
                  onClick={() => handleSlider(actions.maxBet)}
                  className="px-3 py-2 rounded-lg font-bold text-sm bg-amber-700 hover:bg-amber-600 text-white active:scale-95 transition-all"
                >
                  {maxLabel}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {actions.canRaise && (
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              onAction(
                ActionType.Raise,
                isFixedLimit ? actions.minRaise : raiseAmount,
              )
            }
            className={`${btnBase} bg-purple-700 hover:bg-purple-600 text-white shadow-purple-900/30 w-[140px]`}
          >
            Raise {isFixedLimit ? actions.minRaise : raiseAmount}
          </button>
          {isRaising && (
            <>
              <input
                type="range"
                min={actions.minRaise}
                max={actions.maxRaise}
                step={minChip}
                value={raiseAmount}
                onChange={(e) => handleSlider(Number(e.target.value))}
                className="w-36 h-3 accent-purple-500"
              />
              <input
                type="text"
                inputMode="numeric"
                value={inputText}
                onChange={(e) => handleInputChange(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                className="w-20 px-3 py-2 rounded bg-slate-700 text-white text-base text-center font-semibold
                           border border-slate-500 focus:border-blue-400 focus:outline-none"
              />
              {maxLabel && (
                <button
                  onClick={() => handleSlider(actions.maxRaise)}
                  className="px-3 py-2 rounded-lg font-bold text-sm bg-amber-700 hover:bg-amber-600 text-white active:scale-95 transition-all"
                >
                  {maxLabel}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Game Log — slide-out panel
// ============================================================

function GameLog({
  entries,
  visible,
  onToggle,
}: {
  entries: string[];
  visible: boolean;
  onToggle: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-slate-800/80 border border-slate-600/50 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center text-xs transition-colors"
        title="Toggle log"
      >
        {visible ? '\u2715' : '\u2630'}
      </button>

      {/* Log panel */}
      {visible && (
        <div className="absolute top-12 right-3 z-30 w-72 max-h-64 overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 text-[11px] font-mono text-slate-500 space-y-0.5 shadow-xl">
          {entries.map((e, i) => (
            <div key={i} className={e.startsWith('---') ? 'text-slate-400 font-semibold' : ''}>
              {e}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </>
  );
}

// ============================================================
// Helper: Build table config from setup panel inputs
// ============================================================

function buildTableConfig(
  variant: GameVariant,
  bbSB: number,
  bbBB: number,
  limSmallBet: number,
  limBigBet: number,
  stackBB: number,
  capBB?: number | null,
): TableConfig {
  const startingChips = stackBB * bbBB; // Buy-in always in big-bet BBs
  const isPLDrawmaha = [GameVariant.DrawmahaHigh, GameVariant.Drawmaha27, GameVariant.DrawmahaA5, GameVariant.Drawmaha49].includes(variant);
  const isPLDD = [GameVariant.PLBadugiDD, GameVariant.PLBadeucyDD, GameVariant.PLBadaceyDD, GameVariant.PLArchieDD, GameVariant.PLTenThirtyDD].includes(variant);
  const isBigBet = [GameVariant.NLH, GameVariant.PLO, GameVariant.PLOHiLo, GameVariant.TwoSevenSD].includes(variant) || isPLDrawmaha || isPLDD;
  const isStud = [GameVariant.Stud, GameVariant.StudHiLo, GameVariant.Razz].includes(variant);
  const cap = capBB ? capBB : undefined;

  if (isBigBet) {
    return {
      maxPlayers: 6,
      smallBlind: bbSB,
      bigBlind: bbBB,
      ante: 0,
      bringIn: 0,
      startingChips,
      variant,
      bettingStructure: [GameVariant.PLO, GameVariant.PLOHiLo].includes(variant) || isPLDrawmaha || isPLDD
        ? BettingStructure.PotLimit
        : BettingStructure.NoLimit,
      capBB: cap,
    };
  } else if (isStud) {
    // Standard stud sizing: ante = 1/8 of small bet, bring-in = same as ante
    // e.g. $2/$4 stud → ante $0.25, bring-in $0.25
    const ante = Math.max(Math.round(limSmallBet * 100 / 8) / 100, 0.05);
    const bringIn = ante;
    return {
      maxPlayers: 6,
      smallBlind: 0,
      bigBlind: 0,
      ante,
      bringIn,
      smallBet: limSmallBet,
      bigBet: limBigBet,
      startingChips,
      variant,
      bettingStructure: BettingStructure.FixedLimit,
      capBB: cap,
    };
  } else {
    // Limit flop games (LHE, O8) and limit draw games (27TD)
    return {
      maxPlayers: 6,
      smallBlind: limSmallBet / 2,
      bigBlind: limSmallBet,
      ante: 0,
      bringIn: 0,
      smallBet: limSmallBet,
      bigBet: limBigBet,
      startingChips,
      variant,
      bettingStructure: BettingStructure.FixedLimit,
      capBB: cap,
    };
  }
}

// ============================================================
// Main App
// ============================================================

export default function App() {
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SpecificGame);
  const [variant, setVariant] = useState<GameVariant>(GameVariant.NLH);
  const [gameState, setGameState] = useState<HandState | null>(null);
  // Dealer's choice: waiting for player to pick a variant
  const [dcPicking, setDcPicking] = useState(false);
  const [availableActions, setAvailableActions] =
    useState<AvailableActions | null>(null);
  const [isHumanTurn, setIsHumanTurn] = useState(false);
  const [log, setLog] = useState<string[]>([
    'Welcome to Mixed Game Poker!',
    'Choose a variant and click Deal.',
  ]);
  const [showdown, setShowdown] = useState(false);
  const [isRealShowdown, setIsRealShowdown] = useState(false); // true = showdown, false = won by fold
  const [handNumber, setHandNumber] = useState(0);
  const [buttonIndex, setButtonIndex] = useState(0);
  const [logVisible, setLogVisible] = useState(false);
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [lastDrawActions, setLastDrawActions] = useState<Record<string, string>>({});
  // Animated card counts — how many cards are currently "revealed"
  const [visibleCommunityCount, setVisibleCommunityCount] = useState(0);
  const [dealtCardCounts, setDealtCardCounts] = useState<Record<string, number>>({});
  const [isAnimating, setIsAnimating] = useState(false);
  const [isAllInRunout, setIsAllInRunout] = useState(false);
  // Stud: force all cards face-down during initial deal, then reveal door cards
  const [studForceDown, setStudForceDown] = useState(false);
  // Win display — shown briefly after hand ends
  const [winInfo, setWinInfo] = useState<Array<{ playerId: string; name: string; amount: number; handDescription?: string; side?: string }>>([]);
  // Hand description for human player (updated each state change)
  const [humanHandDesc, setHumanHandDesc] = useState<string | null>(null);
  // Auto-deal countdown
  const [countdown, setCountdown] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Two-step variant selector state
  const [selectorStep, setSelectorStep] = useState<'category' | 'structure' | 'variant'>('category');
  const [selectedCategoryIdx, setSelectedCategoryIdx] = useState(0);
  const [selectedStructureIdx, setSelectedStructureIdx] = useState(0);

  // Draw game state
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<Set<number>>(new Set());

  // Setup panel state — both stake types are always configured
  const [numPlayers, setNumPlayers] = useState(4);
  const [bbSB, setBbSB] = useState(0.25);          // Big-bet SB
  const [bbBB, setBbBB] = useState(0.50);          // Big-bet BB
  const [limSmallBet, setLimSmallBet] = useState(2); // Limit small bet
  const [limBigBet, setLimBigBet] = useState(4);    // Limit big bet
  const [stackBB, setStackBB] = useState(100);      // Buy-in in big-bet BBs

  const gameRef = useRef<BaseGame | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const dcJustPickedRef = useRef(false);
  const chipsBehindRef = useRef<Record<string, number>>({});
  /** Ledger tracking total buy-ins and buy-outs per player */
  const ledgerRef = useRef<Record<string, { totalBuyIn: number; totalBuyOut: number }>>({});
  const [showTracker, setShowTracker] = useState(false);
  const [showAddOn, setShowAddOn] = useState(false);
  const [addOnAmount, setAddOnAmount] = useState(0);
  const playersRef = useRef<PlayerState[]>(
    createPlayers(NUM_PLAYERS, STARTING_CHIPS),
  );
  const prevPhaseRef = useRef<string | null>(null);
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const visibleCommunityCountRef = useRef(0);
  const dealtCardCountsRef = useRef<Record<string, number>>({});

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, msg]);
  }, []);

  // Keep refs in sync with animated card counts
  const updateVisibleCommunity = useCallback((count: number) => {
    visibleCommunityCountRef.current = count;
    setVisibleCommunityCount(count);
  }, []);

  const updateDealtCardCounts = useCallback((counts: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    setDealtCardCounts((prev) => {
      const next = typeof counts === 'function' ? counts(prev) : counts;
      dealtCardCountsRef.current = next;
      return next;
    });
  }, []);

  // Auto-update human player's hand description when game state changes
  useEffect(() => {
    const game = gameRef.current;
    if (!game || !gameState || showdown) {
      if (!gameState) setHumanHandDesc(null);
      return;
    }
    const desc = game.getHandDescription(HUMAN_ID);
    setHumanHandDesc(desc?.description ?? null);
  }, [gameState, showdown]);

  // When variant changes, find the matching category + structure for selector highlighting
  useEffect(() => {
    for (let i = 0; i < GAME_CATEGORIES.length; i++) {
      for (let j = 0; j < GAME_CATEGORIES[i].structures.length; j++) {
        if (GAME_CATEGORIES[i].structures[j].variants.includes(variant)) {
          setSelectedCategoryIdx(i);
          setSelectedStructureIdx(j);
          return;
        }
      }
    }
  }, [variant]);

  // Clear any pending animation timers
  const clearAnimTimers = useCallback(() => {
    animTimersRef.current.forEach(clearTimeout);
    animTimersRef.current = [];
  }, []);

  // Animate community cards appearing one by one (flop = 3, turn/river = 1)
  const animateCommunityCards = useCallback(
    (fromCount: number, toCount: number, onDone: () => void) => {
      if (toCount <= fromCount) {
        onDone();
        return;
      }
      setIsAnimating(true);
      const cardsToReveal = toCount - fromCount;
      for (let i = 0; i < cardsToReveal; i++) {
        const t = setTimeout(() => {
          updateVisibleCommunity(fromCount + i + 1);
          if (i === cardsToReveal - 1) {
            setIsAnimating(false);
            onDone();
          }
        }, CARD_DEAL_INTERVAL * (i + 1));
        animTimersRef.current.push(t);
      }
    },
    [updateVisibleCommunity],
  );

  // Animate hole cards dealt to players (left of button, around).
  // Works for initial deal (multiple cards per player) and stud streets (one new card each).
  // prevCounts = how many cards each player had before this deal.
  const animateHoleCards = useCallback(
    (state: HandState, prevCounts: Record<string, number>, onDone: () => void) => {
      const n = state.players.length;
      const btn = state.buttonIndex;

      // Build a flat list of { playerId, cardIndex } in deal order
      // For initial deal: card 0 to each player, then card 1 to each, etc.
      // For stud streets: just one new card per player
      const maxCards = Math.max(...state.players.map((p) => p.holeCards.length), 0);
      const dealSteps: Array<{ playerId: string; cardIdx: number }> = [];

      for (let cardRound = 0; cardRound < maxCards; cardRound++) {
        for (let offset = 1; offset <= n; offset++) {
          const idx = (btn + offset) % n;
          const p = state.players[idx];
          const prev = prevCounts[p.id] ?? 0;
          // Only animate cards that are new (index >= prev count) and exist
          if (!p.sittingOut && p.holeCards.length > cardRound && cardRound >= prev) {
            dealSteps.push({ playerId: p.id, cardIdx: cardRound + 1 }); // cardIdx = count to show
          }
        }
      }

      if (dealSteps.length === 0) {
        onDone();
        return;
      }

      // Stud initial deal: force all cards face-down, then reveal door cards after a pause
      const isStudInitialDeal = state.players.some(
        p => p.cardVisibility && p.cardVisibility.length > 0
      ) && Object.values(prevCounts).every(c => c === 0);

      if (isStudInitialDeal) {
        setStudForceDown(true);
      }

      setIsAnimating(true);
      for (let i = 0; i < dealSteps.length; i++) {
        const step = dealSteps[i];
        const t = setTimeout(() => {
          updateDealtCardCounts((prev) => ({
            ...prev,
            [step.playerId]: step.cardIdx,
          }));
          if (i === dealSteps.length - 1) {
            if (isStudInitialDeal) {
              // All cards dealt face-down — pause, then reveal door cards
              const flipTimer = setTimeout(() => {
                setStudForceDown(false);
                setIsAnimating(false);
                onDone();
              }, 600); // Brief pause before flipping door cards
              animTimersRef.current.push(flipTimer);
            } else {
              setIsAnimating(false);
              onDone();
            }
          }
        }, CARD_DEAL_INTERVAL * (i + 1));
        animTimersRef.current.push(t);
      }
    },
    [updateDealtCardCounts],
  );

  const processState = useCallback(
    (game: BaseGame, state: HandState) => {
      const prevPhase = prevPhaseRef.current;
      const currentPhase = state.phase;
      prevPhaseRef.current = currentPhase;

      // Detect street transition (new betting round or draw→betting)
      const drawPhases = new Set(['draw-1', 'draw-2', 'draw-3']);
      const isStreetChange =
        prevPhase !== null &&
        prevPhase !== currentPhase &&
        BETTING_PHASES.has(currentPhase as GamePhase) &&
        (BETTING_PHASES.has(prevPhase as GamePhase) || drawPhases.has(prevPhase));

      // Is this a stud game? (no community cards — cards dealt to players each street)
      const isStud = state.communityCards.length === 0 &&
        state.players.some((p) => p.holeCards.length > 2);

      // ---- Hand complete ----
      if (
        currentPhase === GamePhase.Complete ||
        currentPhase === GamePhase.Showdown
      ) {
        const finalState = game.getState() as HandState;
        const nonFolded = finalState.players.filter(p => !p.folded && !p.sittingOut);
        const isReal = nonFolded.length > 1;

        // Check if there are unshown community cards (all-in runout)
        const currentVisible = visibleCommunityCountRef.current;
        const totalCommunity = finalState.communityCards.length;
        const hasRunout = totalCommunity > currentVisible && isReal;

        // Show final state immediately (cards face down until animated)
        setGameState(finalState);
        setIsHumanTurn(false);
        setAvailableActions(null);

        // Reveal hole cards for all-in players immediately (they're tabled)
        if (isReal) {
          const allDealt: Record<string, number> = {};
          for (const p of finalState.players) {
            allDealt[p.id] = !p.folded ? p.holeCards.length : 0;
          }
          updateDealtCardCounts(allDealt);
        }

        const finishShowdown = () => {
          setShowdown(true);
          setIsRealShowdown(isReal);

          const engineWinners = game.getWinners();
          setWinInfo(engineWinners.map(w => ({
            playerId: w.playerId,
            name: w.name,
            amount: w.amount,
            handDescription: w.handDescription,
            side: w.side,
            potLabel: w.potLabel,
          })));

          playersRef.current = finalState.players.map((p) => ({
            ...p,
            chips: p.chips + (chipsBehindRef.current[p.id] ?? 0),
            holeCards: [],
            bet: 0,
            totalBet: 0,
            folded: false,
            allIn: false,
          }));
          chipsBehindRef.current = {};

          // Update gameState: keep holeCards for showdown display, but clear allIn labels
          setGameState(prev => prev ? {
            ...prev,
            players: finalState.players.map(p => ({ ...p, allIn: false })),
          } : prev);

          updateVisibleCommunity(totalCommunity);
          addLog('--- Hand complete ---');
        };

        if (hasRunout) {
          // All-in runout: animate each street with pauses
          // Build street reveals: flop (3), turn (1), river (1)
          const streets: Array<[number, number]> = [];
          let from = currentVisible;
          if (from === 0 && totalCommunity >= 3) {
            streets.push([0, 3]); // Flop
            from = 3;
          }
          if (from < totalCommunity) {
            for (let i = from; i < totalCommunity; i++) {
              streets.push([i, i + 1]); // Turn, River (one card each)
            }
          }

          let totalDelay = ALLIN_STREET_PAUSE; // Initial pause before first street
          setIsAnimating(true);
          setIsAllInRunout(true);

          for (let s = 0; s < streets.length; s++) {
            const [streetFrom, streetTo] = streets[s];
            const isLast = s === streets.length - 1;

            // Animate cards for this street
            const streetDelay = totalDelay;
            for (let c = streetFrom; c < streetTo; c++) {
              const cardDelay = streetDelay + (c - streetFrom) * CARD_DEAL_INTERVAL;
              const t = setTimeout(() => {
                updateVisibleCommunity(c + 1);
              }, cardDelay);
              animTimersRef.current.push(t);
            }

            // After this street's cards are dealt, pause for sweating
            const streetDoneDelay = streetDelay + (streetTo - streetFrom) * CARD_DEAL_INTERVAL;

            if (isLast) {
              // After last street, show results
              const t = setTimeout(() => {
                setIsAnimating(false);
                setIsAllInRunout(false);
                finishShowdown();
              }, streetDoneDelay + SHOWDOWN_DELAY);
              animTimersRef.current.push(t);
            }

            totalDelay = streetDoneDelay + ALLIN_STREET_PAUSE;
          }
        } else {
          // Normal showdown (no runout needed) or fold-win
          const delay = isStreetChange ? STREET_TRANSITION_DELAY : SHOWDOWN_DELAY;
          const t = setTimeout(() => {
            finishShowdown();
          }, delay);
          animTimersRef.current.push(t);
        }
        return;
      }

      // ---- Animate new cards if street changed ----
      const newCommunityCount = state.communityCards.length;

      const continueAfterAnimation = () => {
        const activePlayer = state.players[state.activePlayerIndex];
        if (!activePlayer) return;

        // Clear last-action labels on street change so it's fresh
        if (isStreetChange) {
          setLastActions({});
        }

        // Check if we're in a drawing phase
        const drawPhases = ['draw-1', 'draw-2', 'draw-3'];

        // Reset card preselection and draw labels when entering a new draw phase
        if (isStreetChange && drawPhases.includes(state.phase)) {
          setSelectedDiscardIndices(new Set());
          setLastDrawActions({});
        }
        const isDrawPhase = drawPhases.includes(state.phase);

        if (activePlayer.id === HUMAN_ID) {
          setIsHumanTurn(true);
          if (isDrawPhase) {
            // Don't reset selectedDiscardIndices — player may have preselected
            setAvailableActions(null); // No betting actions during draw
          } else {
            setAvailableActions(game.getAvailableActions());
          }
          setGameState({ ...state });
        } else {
          setIsHumanTurn(false);
          setAvailableActions(null);
          setGameState({ ...state });

          const baseDelay = isStreetChange
            ? STREET_TRANSITION_DELAY
            : BOT_ACTION_DELAY;

          const t = setTimeout(() => {
            try {
              if (isDrawPhase && (isDrawGame(game) || isDrawmahaGame(game))) {
                // Bot draw: use AI to pick discards
                const discardIndices = getBotDiscardIndices(activePlayer.holeCards);
                const done = game.discard(activePlayer.id, discardIndices);
                const drawLabel = discardIndices.length === 0 ? 'Stand Pat' : `Drew ${discardIndices.length}`;
                addLog(`${activePlayer.name}: ${drawLabel}`);
                setLastDrawActions((prev) => ({
                  ...prev,
                  [activePlayer.id]: drawLabel,
                }));

                const newState = game.getState() as HandState;
                setGameState(newState);
                processState(game, newState);
              } else {
                // Normal betting
                const actions = game.getAvailableActions();
                const botAction = getBotAction(state, actions, activePlayer.name);

                game.act(activePlayer.id, botAction.type, botAction.amount);
                const displayType = formatActionType(botAction.type, state.phase);
                const actionStr = botAction.amount
                  ? `${displayType} ${botAction.amount}`
                  : displayType;
                addLog(`${activePlayer.name}: ${actionStr}`);
                setLastActions((prev) => ({
                  ...prev,
                  [activePlayer.id]: displayType,
                }));

                const newState = game.getState() as HandState;
                setGameState(newState);
                processState(game, newState);
              }
            } catch (e: unknown) {
              addLog(
                `Bot error (${activePlayer.name}): ${(e as Error).message}`,
              );
            }
          }, baseDelay);
          animTimersRef.current.push(t);
        }
      };

      // Animate new community cards (flop/turn/river) or stud hole cards
      const currentVisible = visibleCommunityCountRef.current;
      const hasNewCommunityCards = newCommunityCount > currentVisible;
      if (hasNewCommunityCards) {
        // Community card game (HE/PLO/Drawmaha) — peel board cards
        // This also handles PL Drawmaha where flop is dealt when entering draw phase
        setGameState({ ...state });
        animateCommunityCards(
          currentVisible,
          newCommunityCount,
          continueAfterAnimation,
        );
      } else if (isStreetChange && isStud) {
        // Stud game — animate new hole cards dealt to each player
        setGameState({ ...state });
        const prevCounts: Record<string, number> = {};
        for (const p of state.players) {
          // Current dealtCardCounts is the "previously visible" count
          prevCounts[p.id] = dealtCardCountsRef.current[p.id] ?? 0;
        }
        animateHoleCards(state, prevCounts, continueAfterAnimation);
      } else {
        continueAfterAnimation();
      }
    },
    [addLog, animateCommunityCards, animateHoleCards],
  );

  const dealNewHand = useCallback(() => {
    // Create or get the session
    let session = sessionRef.current;
    if (!session) {
      // First deal — create session from setup panel config
      session = new GameSession({
        mode: gameMode,
        variant: gameMode === GameMode.SpecificGame ? variant : undefined,
        numPlayers,
      });
      sessionRef.current = session;

      // For dealer's choice, initialize and check if we need a pick
      if (gameMode === GameMode.DealersChoice) {
        const btn = buttonIndex % numPlayers;
        session.initDealersChoice(btn);
        const sessionState = session.getState();
        if (sessionState.needsChoice) {
          // In offline mode, bots auto-pick. Only human (seat 0) gets a UI prompt.
          if (sessionState.chooserSeatIndex === 0) {
            setDcPicking(true);
            addLog("--- Your pick! Choose the game. ---");
            return;
          } else {
            // Bot picks randomly
            const allVariants = Object.values(GameVariant);
            const pick = allVariants[Math.floor(Math.random() * allVariants.length)];
            session.setDealersChoice(pick, buttonIndex % numPlayers);
            addLog(`--- ${playersRef.current[sessionState.chooserSeatIndex]?.name ?? 'Bot'} picks ${VARIANT_LABELS[pick]} ---`);
          }
        }
      }
    } else if (dcJustPickedRef.current) {
      // Coming from a DC pick — don't advance, just deal
      dcJustPickedRef.current = false;
    } else {
      // Continuing session — advance from previous hand
      session.advanceHand((buttonIndex - 1) % numPlayers); // buttonIndex was already incremented

      // Check if dealer's choice needs a new pick
      if (gameMode === GameMode.DealersChoice) {
        const sessionState = session.getState();
        if (sessionState.needsChoice) {
          if (sessionState.chooserSeatIndex === 0) {
            setDcPicking(true);
            addLog("--- Your pick! Choose the game. ---");
            return;
          } else {
            const allVariants = Object.values(GameVariant);
            const pick = allVariants[Math.floor(Math.random() * allVariants.length)];
            session.setDealersChoice(pick, buttonIndex % numPlayers);
            addLog(`--- ${playersRef.current[sessionState.chooserSeatIndex]?.name ?? 'Bot'} picks ${VARIANT_LABELS[pick]} ---`);
          }
        }
      }
    }

    // Get the variant from session
    const handVariant = session.getCurrentVariant();
    if (!handVariant) {
      addLog('Error: no variant selected');
      return;
    }
    setVariant(handVariant);

    // If this is a fresh game (from setup panel), create new players with correct chips
    const startingChips = stackBB * bbBB;
    if (!gameRef.current) {
      playersRef.current = createPlayers(numPlayers, startingChips);
      // Initialize ledger using actual chip amounts (short-stack bot may differ)
      const newLedger: Record<string, { totalBuyIn: number; totalBuyOut: number }> = {};
      for (const p of playersRef.current) {
        newLedger[p.id] = { totalBuyIn: p.chips, totalBuyOut: 0 };
      }
      ledgerRef.current = newLedger;
    } else if (playersRef.current.length !== numPlayers) {
      playersRef.current = createPlayers(numPlayers, startingChips);
      const newLedger: Record<string, { totalBuyIn: number; totalBuyOut: number }> = {};
      for (const p of playersRef.current) {
        newLedger[p.id] = { totalBuyIn: p.chips, totalBuyOut: 0 };
      }
      ledgerRef.current = newLedger;
    }

    const players = playersRef.current.map((p) => ({
      ...p,
      holeCards: [],
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
    }));

    players.forEach((p) => {
      if (p.chips <= 0) p.sittingOut = true;
    });
    const activeCount = players.filter((p) => !p.sittingOut).length;
    if (activeCount < 2) {
      addLog('--- Not enough players with chips! Reset. ---');
      return;
    }

    // Skip button past sitting-out players (busted blinds)
    let btn = buttonIndex % players.length;
    if (players[btn].sittingOut) {
      for (let i = 1; i <= players.length; i++) {
        const next = (btn + i) % players.length;
        if (!players[next].sittingOut) {
          btn = next;
          break;
        }
      }
    }
    const capBB = session.getCapBB();

    // Track chips behind the cap — these get restored after the hand
    chipsBehindRef.current = {};
    if (capBB) {
      const capAmount = capBB * bbBB;
      for (const p of players) {
        if (p.chips > capAmount) {
          chipsBehindRef.current[p.id] = p.chips - capAmount;
        }
      }
    }

    const customConfig = buildTableConfig(
      handVariant,
      bbSB,
      bbBB,
      limSmallBet,
      limBigBet,
      stackBB,
      capBB,
    );
    const game = createGame(handVariant, players, btn, customConfig);
    gameRef.current = game;

    try {
      game.start();
    } catch (e: unknown) {
      addLog(`Error: ${(e as Error).message}`);
      return;
    }

    const state = game.getState() as HandState;
    setShowdown(false);
    setIsRealShowdown(false);
    setCountdown(null);
    setPaused(false);
    setLastActions({});
    setLastDrawActions({});
    setWinInfo([]);
    updateVisibleCommunity(0);
    updateDealtCardCounts({});
    clearAnimTimers();
    prevPhaseRef.current = state.phase;

    // Build rotation info for the log
    const sessionState = session.getState();
    const rotInfo = sessionState.handsPerVariant > 0
      ? ` (${sessionState.handInVariant}/${sessionState.handsPerVariant})`
      : '';

    setHandNumber((prev) => prev + 1);
    setButtonIndex((prev) => prev + 1);
    addLog(`--- Hand #${handNumber + 1}: ${VARIANT_LABELS[handVariant]}${rotInfo} ---`);

    // Show the game state but animate hole cards dealing out
    setGameState(state);
    const noPrevCards: Record<string, number> = {};
    for (const p of state.players) {
      noPrevCards[p.id] = 0;
    }
    animateHoleCards(state, noPrevCards, () => {
      processState(game, state);
    });
  }, [variant, gameMode, buttonIndex, handNumber, addLog, processState, animateHoleCards, clearAnimTimers, updateDealtCardCounts, numPlayers, bbSB, bbBB, limSmallBet, limBigBet, stackBB]);

  // Auto-deal: start/resume countdown when showdown is active and not paused
  useEffect(() => {
    if (showdown && !paused) {
      setCountdown(prev => (prev === null ? 12 : prev));
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev === null || prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      };
    }
  }, [showdown, paused]);

  // When countdown hits 0, auto-deal
  useEffect(() => {
    if (countdown === 0 && showdown) {
      setCountdown(null);
      dealNewHand();
    }
  }, [countdown, showdown, dealNewHand]);

  const toggleDiscard = (idx: number) => {
    setSelectedDiscardIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Dealer's choice: human picks a variant
  const handleDcPick = useCallback((pickedVariant: GameVariant) => {
    const session = sessionRef.current;
    if (!session) return;
    session.setDealersChoice(pickedVariant, buttonIndex % numPlayers);
    addLog(`--- You pick ${VARIANT_LABELS[pickedVariant]} ---`);
    setDcPicking(false);
    dcJustPickedRef.current = true;
    // Now deal the hand — dealNewHand will skip advanceHand because dcJustPickedRef is set
    dealNewHand();
  }, [buttonIndex, numPlayers, addLog, dealNewHand]);

  // Add-on: top up chips up to the max buy-in (300 BB, same as setup slider max)
  const MAX_BUYIN_BB = 300;
  const getAddOnMax = useCallback(() => {
    return MAX_BUYIN_BB * bbBB;
  }, [bbBB]);

  const handleAddOnOpen = useCallback(() => {
    const maxBuyin = getAddOnMax();
    const player = playersRef.current.find(p => p.id === HUMAN_ID);
    if (!player) return;
    if (player.chips >= maxBuyin && !player.sittingOut) {
      addLog(`${player.name}: Already at max buy-in ($${maxBuyin.toFixed(2)})`);
      return;
    }
    // Start slider at current stack (or min buy-in if sitting out)
    const minBuyin = Math.max(bbBB * 50, bbBB); // 50 BB minimum
    setAddOnAmount(player.sittingOut ? minBuyin : player.chips);
    setShowAddOn(true);
    setPaused(true); // Pause countdown while choosing
  }, [getAddOnMax, bbBB, addLog]);

  const handleAddOnConfirm = useCallback(() => {
    const player = playersRef.current.find(p => p.id === HUMAN_ID);
    if (!player) return;
    const addAmount = addOnAmount - player.chips;
    if (addAmount <= 0) {
      setShowAddOn(false);
      setPaused(false);
      return;
    }
    player.chips = addOnAmount;
    player.sittingOut = false; // Re-enter if previously bought out
    if (ledgerRef.current[HUMAN_ID]) {
      ledgerRef.current[HUMAN_ID].totalBuyIn += addAmount;
    }
    addLog(`${player.name}: Added on $${addAmount.toFixed(2)} (stack: $${addOnAmount.toFixed(2)})`);
    setGameState(prev => prev ? { ...prev, players: playersRef.current.map(p => ({ ...p })) } : prev);
    setShowAddOn(false);
    setPaused(false);
  }, [addOnAmount, addLog]);

  // Buy-out state
  const [showBuyOut, setShowBuyOut] = useState(false);

  const handleBuyOutOpen = useCallback(() => {
    setShowBuyOut(true);
    setPaused(true);
  }, []);

  const handleBuyOutConfirm = useCallback(() => {
    const player = playersRef.current.find(p => p.id === HUMAN_ID);
    if (!player) return;
    const cashOut = player.chips;
    if (ledgerRef.current[HUMAN_ID]) {
      ledgerRef.current[HUMAN_ID].totalBuyOut += cashOut;
    }
    player.chips = 0;
    player.sittingOut = true;
    addLog(`${player.name}: Bought out for $${cashOut.toFixed(2)}`);
    setGameState(prev => prev ? { ...prev, players: playersRef.current.map(p => ({ ...p })) } : prev);
    setShowBuyOut(false);
    setPaused(false);
  }, [addLog]);

  const handleDiscard = useCallback(() => {
    const game = gameRef.current;
    if (!game || (!isDrawGame(game) && !isDrawmahaGame(game))) return;
    const indices = [...selectedDiscardIndices].sort((a, b) => a - b);
    try {
      const done = game.discard(HUMAN_ID, indices);
      const drawLabel = indices.length === 0 ? 'Stand Pat' : `Drew ${indices.length}`;
      addLog(`You: ${drawLabel}`);
      setLastDrawActions((prev) => ({
        ...prev,
        [HUMAN_ID]: drawLabel,
      }));
      setSelectedDiscardIndices(new Set());

      const newState = game.getState() as HandState;
      setGameState(newState);
      setIsHumanTurn(false);

      if (done) {
        processState(game, newState);
      } else {
        processState(game, newState);
      }
    } catch (e: unknown) {
      addLog(`Error: ${(e as Error).message}`);
    }
  }, [selectedDiscardIndices, addLog, processState]);

  const handleAction = useCallback(
    (type: ActionType, amount?: number) => {
      const game = gameRef.current;
      if (!game) return;

      try {
        const currentPhase = game.getState().phase;
        game.act(HUMAN_ID, type, amount);
        const displayType = formatActionType(type, currentPhase);
        const actionStr = amount ? `${displayType} ${amount}` : displayType;
        addLog(`You: ${actionStr}`);
        setLastActions(prev => ({ ...prev, [HUMAN_ID]: displayType }));

        const newState = game.getState() as HandState;
        setGameState(newState);
        setIsHumanTurn(false);
        setAvailableActions(null);

        processState(game, newState);
      } catch (e: unknown) {
        addLog(`Error: ${(e as Error).message}`);
      }
    },
    [addLog, processState],
  );

  const resetTable = useCallback(() => {
    clearAnimTimers();
    gameRef.current = null;
    sessionRef.current = null;
    chipsBehindRef.current = {};
    ledgerRef.current = {};
    setShowTracker(false);
    setGameState(null);
    setAvailableActions(null);
    setIsHumanTurn(false);
    setShowdown(false);
    setIsRealShowdown(false);
    setCountdown(null);
    setPaused(false);
    setLastActions({});
    setLastDrawActions({});
    setWinInfo([]);
    updateVisibleCommunity(0);
    updateDealtCardCounts({});
    setIsAnimating(false);
    setIsAllInRunout(false);
    setStudForceDown(false);
    prevPhaseRef.current = null;
    setHumanHandDesc(null);
    setHandNumber(0);
    setButtonIndex(0);
    setSelectorStep('category');
    setDcPicking(false);
    setLog(['Table reset. Choose game mode and Deal.']);
  }, [clearAnimTimers, updateDealtCardCounts]);

  // Collected pots only (from completed streets)
  const collectedPot = gameState
    ? gameState.pots.reduce((s, p) => s + p.amount, 0)
    : 0;

  // Current street bets in front of players
  const currentStreetBets = gameState
    ? gameState.players.reduce((s, p) => s + p.bet, 0)
    : 0;

  // Total for display: collected pot + current street bets
  const potTotal = collectedPot + currentStreetBets;

  // Use numPlayers state when no game active, or player count from game state
  const activeNumPlayers = gameState?.players.length ?? numPlayers;
  const positions = SEAT_POSITIONS[activeNumPlayers] || SEAT_POSITIONS[4];
  const betPositions = BET_OFFSETS[activeNumPlayers] || BET_OFFSETS[4];

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* ======== Header ======== */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-white tracking-tight">
            Mixed Game Poker
          </h1>
          {(gameState || dcPicking) && (() => {
            const ss = sessionRef.current?.getState();
            const rotLabel = ss && ss.handsPerVariant > 0
              ? ` (${ss.handInVariant}/${ss.handsPerVariant})`
              : '';
            const modeLabel = ss && ss.mode !== GameMode.SpecificGame
              ? `${GAME_MODE_LABELS[ss.mode]} · `
              : '';
            return (
              <>
                <span className="text-[11px] text-slate-500 font-mono">
                  Hand #{handNumber + (dcPicking && !gameState ? 1 : 0)}
                </span>
                <span className="text-xs text-emerald-400 font-medium">
                  {modeLabel}{VARIANT_LABELS[variant] || variant}{rotLabel}
                </span>
              </>
            );
          })()}
        </div>

        {!gameState && !dcPicking && (
          <span className="text-xs text-slate-500">Select game mode and stakes</span>
        )}

        <div className="flex gap-1.5">
          {gameState && (
            <button
              onClick={() => setShowTracker(t => !t)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                showTracker
                  ? 'bg-amber-700 hover:bg-amber-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              Tracker
            </button>
          )}
          {showdown && (
            <button
              onClick={handleAddOnOpen}
              className="px-3 py-1 bg-emerald-800 hover:bg-emerald-700 text-emerald-200 rounded text-xs font-semibold transition-colors"
            >
              Add On
            </button>
          )}
          {showdown && (
            <button
              onClick={handleBuyOutOpen}
              className="px-3 py-1 bg-red-800 hover:bg-red-700 text-red-200 rounded text-xs font-semibold transition-colors"
            >
              Buy Out
            </button>
          )}
          <button
            onClick={resetTable}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      {/* ======== Tracker Popup ======== */}
      {showTracker && (
        <div className="absolute top-12 right-4 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 min-w-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Player Tracker</h3>
            <button onClick={() => setShowTracker(false)} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="text-left py-1 pr-3">Player</th>
                <th className="text-right py-1 px-2">Buy-ins</th>
                <th className="text-right py-1 px-2">Buy-outs</th>
                <th className="text-right py-1 px-2">Stack</th>
                <th className="text-right py-1 pl-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {playersRef.current.map(p => {
                const ledger = ledgerRef.current[p.id] ?? { totalBuyIn: 0, totalBuyOut: 0 };
                const currentStack = p.sittingOut ? 0 : p.chips;
                const net = currentStack + ledger.totalBuyOut - ledger.totalBuyIn;
                return (
                  <tr key={p.id} className="border-b border-slate-800">
                    <td className="py-1.5 pr-3 text-white font-medium">{p.name}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${ledger.totalBuyIn.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${ledger.totalBuyOut.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300">${currentStack.toFixed(2)}</td>
                    <td className={`py-1.5 pl-2 text-right font-semibold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {net >= 0 ? '+' : ''}{net.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ======== Add On Modal ======== */}
      {showAddOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[400px]">
            <h3 className="text-lg font-bold text-white mb-4">Add On</h3>
            <p className="text-sm text-slate-400 mb-3">
              Set chips to:
            </p>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="range"
                min={playersRef.current.find(p => p.id === HUMAN_ID)?.chips ?? 0}
                max={getAddOnMax()}
                step={bbSB}
                value={addOnAmount}
                onChange={e => setAddOnAmount(parseFloat(e.target.value))}
                className="flex-1 accent-emerald-500"
              />
              <span className="text-lg font-bold text-emerald-300 w-20 text-right">
                ${addOnAmount.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Adding ${Math.max(0, addOnAmount - (playersRef.current.find(p => p.id === HUMAN_ID)?.chips ?? 0)).toFixed(2)}
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleAddOnConfirm}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => { setShowAddOn(false); setPaused(false); }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Buy Out Confirm ======== */}
      {showBuyOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[300px]">
            <h3 className="text-lg font-bold text-white mb-3">Buy Out</h3>
            <p className="text-sm text-slate-400 mb-4">
              Cash out ${(playersRef.current.find(p => p.id === HUMAN_ID)?.chips ?? 0).toFixed(2)} and leave the table?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleBuyOutConfirm}
                className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors"
              >
                Confirm Buy Out
              </button>
              <button
                onClick={() => { setShowBuyOut(false); setPaused(false); }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Table Area ======== */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        {/* The felt table */}
        <div
          className="relative w-full max-w-4xl"
          style={{ aspectRatio: '16 / 9' }}
        >
          {/* Table surface — oval */}
          <div
            className="absolute inset-0 rounded-[50%] shadow-2xl"
            style={{
              background:
                'radial-gradient(ellipse at 40% 40%, #1a5c2a 0%, #145222 40%, #0d3d18 100%)',
              border: '8px solid #2a1a0a',
              boxShadow:
                'inset 0 0 60px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.5), 0 0 0 12px #1a0f05',
            }}
          >
            {/* Rail shadow */}
            <div
              className="absolute inset-0 rounded-[50%]"
              style={{
                boxShadow: 'inset 0 0 20px rgba(0,0,0,0.3)',
              }}
            />

            {/* Subtle felt texture lines */}
            <div
              className="absolute inset-0 rounded-[50%] opacity-[0.03]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)',
              }}
            />
          </div>

          {/* Center content — pot + community cards + phase */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
            {gameState && (
              <>
                {/* Game mode + variant label on the felt */}
                {(() => {
                  const ss = sessionRef.current?.getState();
                  const rotLabel = ss && ss.handsPerVariant > 0
                    ? ` (${ss.handInVariant}/${ss.handsPerVariant})`
                    : '';
                  const modePrefix = ss && ss.mode !== GameMode.SpecificGame
                    ? `${GAME_MODE_LABELS[ss.mode]} \u2014 `
                    : '';
                  return (
                    <div className="text-xs font-semibold text-amber-300/80 tracking-wide mb-1">
                      {modePrefix}{VARIANT_LABELS[variant]}{rotLabel}
                    </div>
                  );
                })()}

                {/* Phase indicator */}
                <div className="text-[10px] text-green-300/50 font-mono uppercase tracking-widest mb-2">
                  {gameState.phase === 'complete'
                    ? 'Showdown'
                    : gameState.phase}
                </div>

                {/* Community Cards — animated reveal */}
                {gameState.communityCards.length > 0 && (
                  <div className="flex gap-1 mb-2">
                    {gameState.communityCards.map((card, i) => (
                      <div
                        key={i}
                        className="transition-all duration-200"
                        style={{
                          opacity: i < visibleCommunityCount ? 1 : 0,
                          transform: i < visibleCommunityCount
                            ? 'translateY(0) scale(1)'
                            : 'translateY(-8px) scale(0.9)',
                        }}
                      >
                        <CardDisplay card={card} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Pot or Win Display */}
                {showdown && winInfo.length > 0 ? (
                  <WinDisplay winInfo={winInfo} variant={gameState.variant} />
                ) : (
                  <PotDisplay collectedAmount={collectedPot} totalAmount={potTotal} pots={(() => {
                    // Merge pots where the active (non-folded) contenders are the same.
                    // Folding does NOT create side pots — only all-ins do.
                    if (gameState.pots.length <= 1) return undefined;
                    const activePlayers = new Set(
                      gameState.players.filter(p => !p.folded && !p.sittingOut).map(p => p.id)
                    );
                    const merged: typeof gameState.pots = [];
                    for (const pot of gameState.pots) {
                      // Effective contenders = eligible AND still active
                      const effectiveIds = pot.eligiblePlayerIds
                        .filter(id => activePlayers.has(id))
                        .sort()
                        .join(',');
                      const match = merged.find(m => {
                        const mIds = m.eligiblePlayerIds
                          .filter(id => activePlayers.has(id))
                          .sort()
                          .join(',');
                        return mIds === effectiveIds;
                      });
                      if (match) {
                        match.amount += pot.amount;
                      } else {
                        merged.push({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
                      }
                    }
                    return merged.length > 1 ? merged : undefined;
                  })()} />
                )}
              </>
            )}

            {!gameState && !dcPicking && (
              <SetupPanel
                gameMode={gameMode} onGameModeChange={setGameMode}
                bbSB={bbSB} onBbSBChange={setBbSB}
                bbBB={bbBB} onBbBBChange={setBbBB}
                limSmallBet={limSmallBet} onLimSmallBetChange={setLimSmallBet}
                limBigBet={limBigBet} onLimBigBetChange={setLimBigBet}
                stackBB={stackBB} onStackBBChange={setStackBB}
                numPlayers={numPlayers} onNumPlayersChange={setNumPlayers}
                variant={variant} onVariantChange={setVariant}
                selectorStep={selectorStep} onSelectorStepChange={setSelectorStep}
                selectedCategoryIdx={selectedCategoryIdx} onSelectedCategoryIdxChange={setSelectedCategoryIdx}
                selectedStructureIdx={selectedStructureIdx} onSelectedStructureIdxChange={setSelectedStructureIdx}
                onDeal={dealNewHand}
              />
            )}

            {/* Dealer's Choice picker — shown when human needs to choose the game */}
            {dcPicking && (
              <div className="flex flex-col items-center gap-3 bg-slate-900/80 border border-amber-500/40 rounded-lg p-5 max-w-sm pointer-events-auto">
                <h2 className="text-sm font-bold text-amber-400">Your Pick — Choose the Game</h2>
                <div className="grid grid-cols-2 gap-1.5 w-full">
                  {Object.values(GameVariant).map((v) => (
                    <button key={v} onClick={() => handleDcPick(v)}
                      className="py-2 px-3 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white transition-colors"
                    >{VARIANT_LABELS[v]}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Player seats */}
          {gameState && (() => {
            const drawPhases = ['draw-1', 'draw-2', 'draw-3'];
            const isDrawPhase = drawPhases.includes(gameState.phase);
            return gameState.players.map((player, i) => (
              <PlayerSeat
                key={player.id}
                player={player}
                isActive={
                  i === gameState.activePlayerIndex && !showdown
                }
                isDealer={i === gameState.buttonIndex}
                isHuman={player.id === HUMAN_ID}
                showCards={(isRealShowdown && !player.folded && showdown) || player.id === HUMAN_ID || (isAllInRunout && !player.folded)}
                position={positions[i]}
                isTop={positions[i][1] < 50}
                lastAction={lastActions[player.id]}
                lastDrawAction={lastDrawActions[player.id]}
                dealtCardCount={
                  showdown
                    ? (player.folded ? 0 : player.holeCards.length)
                    : (dealtCardCounts[player.id] ?? 0)
                }
                onCardClick={toggleDiscard}
                selectedDiscardIndices={selectedDiscardIndices}
                isDrawing={isDrawPhase && player.id === HUMAN_ID}
                chipsBehind={chipsBehindRef.current[player.id]}
                forceAllDown={studForceDown}
                handDescription={
                  showdown && isRealShowdown && !player.folded && gameRef.current
                    ? gameRef.current.getHandDescription(player.id)?.description
                    : undefined
                }
              />
            ));
          })()}

          {/* Bet chips */}
          {gameState &&
            !showdown &&
            gameState.players.map((player, i) =>
              player.bet > 0 ? (
                <BetChip
                  key={`bet-${player.id}`}
                  amount={player.bet}
                  position={betPositions[i]}
                />
              ) : null,
            )}

          {/* Win chips — animate from center toward winner's seat */}
          {gameState &&
            showdown &&
            winInfo.map((w, idx) => {
              const playerIdx = gameState.players.findIndex(p => p.id === w.playerId);
              if (playerIdx === -1) return null;
              const seatPos = positions[playerIdx];
              // Position chips between center and the winner's seat
              const chipX = 50 + (seatPos[0] - 50) * 0.45;
              const chipY = 50 + (seatPos[1] - 50) * 0.45;
              const chipGroups = decomposeChips(w.amount);
              return (
                <div
                  key={`win-chips-${w.playerId}-${idx}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-[5] transition-all duration-700 ease-out"
                  style={{
                    left: `${chipX}%`,
                    top: `${chipY}%`,
                  }}
                >
                  <div className="flex items-end gap-0.5">
                    {chipGroups.map((group, gi) => (
                      <div key={gi} className="flex flex-col-reverse items-center">
                        {Array.from({ length: Math.min(group.count, 3) }, (_, i) => (
                          <div key={i} style={{ marginTop: i > 0 ? -12 : 0 }}>
                            <CasinoChip value={group.value} size={18} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

          {/* Game log overlay */}
          <GameLog
            entries={log}
            visible={logVisible}
            onToggle={() => setLogVisible((v) => !v)}
          />
        </div>
      </div>

      {/* ======== Hand Ranking ======== */}
      {humanHandDesc && gameState && !showdown && (
        <div className="flex-shrink-0 flex justify-center px-4 py-0.5">
          <span className="text-[11px] font-semibold text-amber-400/80 tracking-wide">
            {humanHandDesc}
          </span>
        </div>
      )}

      {/* ======== Bottom Bar — Actions ======== */}
      <div className="flex-shrink-0 px-4 pb-3 pt-1">
        {(() => {
          const drawPhases = ['draw-1', 'draw-2', 'draw-3'];
          const isDrawPhase = gameState && drawPhases.includes(gameState.phase);
          return (
            <>
              {isDrawPhase && isHumanTurn && gameState ? (
                <div className="flex flex-wrap items-center gap-2 justify-center">
                  <span className="text-xs text-slate-400">
                    Click cards to select for discard, then:
                  </span>
                  <button
                    onClick={handleDiscard}
                    className="px-5 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-md bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30"
                  >
                    {selectedDiscardIndices.size === 0 ? 'Stand Pat' : `Draw ${selectedDiscardIndices.size}`}
                  </button>
                </div>
              ) : isHumanTurn && availableActions && gameState ? (
                <ActionPanel
                  actions={availableActions}
                  onAction={handleAction}
                  bettingStructure={gameState.bettingStructure}
                  phase={gameState.phase}
                  minChip={gameState.bettingStructure === 'fixed-limit' ? limSmallBet / 2 : bbSB}
                />
              ) : showdown ? (
          <div className="flex flex-col items-center gap-2">
            <div className="text-sm font-mono text-slate-400">
              {paused ? (
                <span className="text-amber-400">Paused</span>
              ) : countdown !== null && countdown > 0 ? (
                <span>Next hand in <span className="text-white font-bold">{countdown}</span>…</span>
              ) : null}
            </div>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => {
                  setCountdown(null);
                  setPaused(false);
                  dealNewHand();
                }}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-lg shadow-emerald-900/30"
              >
                Deal Now
              </button>
              <button
                onClick={() => setPaused(p => !p)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-lg ${
                  paused
                    ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30'
                    : 'bg-slate-700 hover:bg-slate-600 text-slate-300 shadow-slate-900/30'
                }`}
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={resetTable}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-lg shadow-slate-900/30"
              >
                New Setup
              </button>
            </div>
          </div>
              ) : gameState ? (
                <div className="text-center text-slate-600 text-xs py-2">
                  Waiting for{' '}
                  {gameState.players[gameState.activePlayerIndex]?.name ??
                    '...'}
                </div>
              ) : null}
            </>
          );
        })()}
      </div>
    </div>
  );
}
