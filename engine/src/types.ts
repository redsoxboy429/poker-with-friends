// ============================================================
// Core Types for Poker Engine
// ============================================================

/** Card suits */
export enum Suit {
  Clubs = 'c',
  Diamonds = 'd',
  Hearts = 'h',
  Spades = 's',
}

/** Card ranks (2-14, where 14 = Ace) */
export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
}

/** A single playing card */
export interface Card {
  rank: Rank;
  suit: Suit;
}

/** Hand ranking categories (high hands) */
export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

/**
 * Evaluated hand result.
 * `value` is a single numeric score that can be compared directly:
 * higher value = better hand (for high games), lower = better (for low games).
 * `cards` are the 5 cards that make up the best hand.
 */
export interface HandResult {
  category: HandCategory;
  value: number;
  cards: Card[];
  description: string;
}

/** Low hand result (for Razz, etc.) */
export interface LowHandResult {
  value: number;        // Lower = better
  cards: Card[];        // The 5 low cards
  description: string;
  qualified: boolean;   // For 8-or-better: does it qualify?
}

// ============================================================
// Game State Types
// ============================================================

/** Betting structure types */
export enum BettingStructure {
  NoLimit = 'no-limit',
  PotLimit = 'pot-limit',
  FixedLimit = 'fixed-limit',
}

/** Game variant identifier */
export enum GameVariant {
  NLH = 'nlh',           // No-Limit Hold'em
  PLO = 'plo',           // Pot-Limit Omaha
  Razz = 'razz',         // Razz (7-card stud lowball)
  LimitHoldem = 'lhe',   // Limit Hold'em
  OmahaHiLo = 'o8',      // Limit Omaha Hi-Lo (8-or-better)
  PLOHiLo = 'plo8',      // Pot-Limit Omaha Hi-Lo (8-or-better)
  Stud = 'stud',         // 7-Card Stud High
  StudHiLo = 'stud8',    // 7-Card Stud Hi-Lo
  TwoSevenSD = '27sd',   // 2-7 Single Draw (no-limit)
  TwoSevenTD = '27td',   // 2-7 Triple Draw (limit)
  Badugi = 'badugi',     // Badugi (limit triple draw, 4-card rainbow lowball)
  Badeucy = 'badeucy',   // Badeucy (limit triple draw, split: deuce-low badugi + 2-7 low)
  Badacey = 'badacey',   // Badacey (limit triple draw, split: ace-low badugi + A-5 low)
  Archie = 'archie',     // Archie (limit triple draw, A-5 lowball, 9-or-better qualifier)
  DrawmahaHigh = 'drawmaha-high',       // PL Drawmaha High (draw + Omaha, high split)
  Drawmaha27 = 'drawmaha-27',           // PL Drawmaha 2-7 (2-7 low draw + Omaha high)
  DrawmahaA5 = 'drawmaha-a5',           // PL Drawmaha A-5 (A-5 low draw + Omaha high)
  Drawmaha49 = 'drawmaha-49',           // PL Drawmaha 49 (closest to 49 pips + Omaha high)
  LimitDrawmahaHigh = 'limit-drawmaha-high', // Limit Drawmaha High
  LimitDrawmaha27 = 'limit-drawmaha-27',     // Limit Drawmaha 2-7
  LimitDrawmahaA5 = 'limit-drawmaha-a5',     // Limit Drawmaha A-5
  LimitDrawmaha49 = 'limit-drawmaha-49',     // Limit Drawmaha 49
  TenThirtyDraw = 'ten-thirty',          // 10-30 Draw (pip split, triple draw)
  PLBadugiDD = 'pl-badugi-dd',           // PL Badugi Double Draw
  PLBadeucyDD = 'pl-badeucy-dd',         // PL Badeucy Double Draw
  PLBadaceyDD = 'pl-badacey-dd',         // PL Badacey Double Draw
  PLArchieDD = 'pl-archie-dd',           // PL Archie Double Draw
  PLTenThirtyDD = 'pl-ten-thirty-dd',    // PL 10-30 Double Draw
  LimitOmahaHigh = 'limit-omaha-high',   // Limit Omaha High
}

/** Player action types */
export enum ActionType {
  Fold = 'fold',
  Check = 'check',
  Call = 'call',
  Bet = 'bet',
  Raise = 'raise',
  AllIn = 'all-in',
  BringIn = 'bring-in',  // Stud games
  PostAnte = 'post-ante',
  PostBlind = 'post-blind',
  Discard = 'discard',   // Draw games: discard cards
  StandPat = 'stand-pat', // Draw games: keep all cards
}

/** A player action */
export interface PlayerAction {
  type: ActionType;
  amount?: number;           // For bet/raise/call/all-in
  playerId: string;
  discardIndices?: number[]; // For discard actions: which hole card indices to replace
}

/** Player state within a hand */
export interface PlayerState {
  id: string;
  name: string;
  chips: number;          // Current stack
  holeCards: Card[];      // Cards only this player can see
  bet: number;            // Amount bet in current round
  totalBet: number;       // Total amount put in pot this hand
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  seatIndex: number;      // 0-8 for 9-max table
  /** Per-card visibility for stud games. Parallel to holeCards[]. */
  cardVisibility?: ('up' | 'down')[];
}

/** A pot (main or side) */
export interface Pot {
  amount: number;
  eligiblePlayerIds: string[];
}

/** Game phase */
export enum GamePhase {
  Waiting = 'waiting',         // Not enough players / between hands
  Posting = 'posting',         // Collecting antes/blinds
  Dealing = 'dealing',         // Dealing cards
  BettingPreflop = 'preflop',  // First betting round (HE/Omaha)
  BettingFlop = 'flop',        // Second betting round
  BettingTurn = 'turn',        // Third betting round
  BettingRiver = 'river',      // Fourth betting round
  // Stud-specific streets
  BettingThird = 'third',      // After 3rd street deal
  BettingFourth = 'fourth',
  BettingFifth = 'fifth',
  BettingSixth = 'sixth',
  BettingSeventh = 'seventh',
  // Draw-specific (multi-draw support)
  Drawing1 = 'draw-1',
  BettingPostDraw1 = 'post-draw-1',
  Drawing2 = 'draw-2',
  BettingPostDraw2 = 'post-draw-2',
  Drawing3 = 'draw-3',
  BettingPostDraw3 = 'post-draw-3',
  // Legacy draw phases (kept for backwards compat, not used in new draw games)
  Drawing = 'drawing',
  BettingAfterDraw = 'after-draw',
  Showdown = 'showdown',
  Complete = 'complete',
}

/** The full state of a hand in progress */
export interface HandState {
  id: string;                     // Unique hand ID
  variant: GameVariant;
  bettingStructure: BettingStructure;
  phase: GamePhase;
  players: PlayerState[];         // All players in the hand
  communityCards: Card[];         // Board cards (HE/Omaha)
  pots: Pot[];                    // Main pot + side pots
  currentBet: number;             // Current bet to call
  minRaise: number;               // Minimum raise amount
  lastRaise: number;              // Size of last raise (for min-raise calc)
  activePlayerIndex: number;      // Index into players[] for whose turn it is
  buttonIndex: number;            // Dealer button position
  smallBlind: number;
  bigBlind: number;
  ante: number;
  bringIn: number;                // For stud games
  /** Fixed-limit small bet (early streets) */
  smallBet: number;
  /** Fixed-limit big bet (later streets) */
  bigBet: number;
  actionHistory: PlayerAction[];  // Full action log
  /** Index into actionHistory where the current betting round started */
  phaseStartActionIndex: number;
  /** Number of non-folded, non-sitting-out players when this street began */
  playersAtStreetStart: number;
  /** For draw games: how many draws are remaining */
  drawsRemaining?: number;
}

/** Table configuration */
export interface TableConfig {
  maxPlayers: number;       // 2-9
  smallBlind: number;       // Hold'em/Omaha small blind
  bigBlind: number;         // Hold'em/Omaha big blind
  ante: number;             // 0 if no ante
  bringIn: number;          // 0 if not a stud game
  /** Fixed-limit small bet (early streets). Defaults to smallBlind if unset. */
  smallBet?: number;
  /** Fixed-limit big bet (later streets). Defaults to bigBlind if unset. */
  bigBet?: number;
  startingChips: number;
  variant: GameVariant;
  bettingStructure: BettingStructure;
  /** Optional cap in big blinds. Players can't put more than capBB * bigBlind into a hand. */
  capBB?: number;
}

/** What actions are available to the current player */
export interface AvailableActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  maxBet: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
}

/** Result of a showdown for one pot */
export interface PotResult {
  pot: Pot;
  winners: Array<{
    playerId: string;
    hand: HandResult | LowHandResult;
    amount: number;
  }>;
}

/** Complete result of a hand */
export interface HandComplete {
  handId: string;
  potResults: PotResult[];
  playerChipChanges: Map<string, number>;  // playerId -> net change
}

// ============================================================
// Utility types
// ============================================================

/** Short string notation for a card, e.g. "As", "Td", "2c" */
export type CardNotation = string;

/** Rank display names */
export const RANK_NAMES: Record<Rank, string> = {
  [Rank.Two]: '2',
  [Rank.Three]: '3',
  [Rank.Four]: '4',
  [Rank.Five]: '5',
  [Rank.Six]: '6',
  [Rank.Seven]: '7',
  [Rank.Eight]: '8',
  [Rank.Nine]: '9',
  [Rank.Ten]: 'T',
  [Rank.Jack]: 'J',
  [Rank.Queen]: 'Q',
  [Rank.King]: 'K',
  [Rank.Ace]: 'A',
};

/** Suit display symbols */
export const SUIT_SYMBOLS: Record<Suit, string> = {
  [Suit.Clubs]: '♣',
  [Suit.Diamonds]: '♦',
  [Suit.Hearts]: '♥',
  [Suit.Spades]: '♠',
};

/** Convert a Card to short notation like "As" */
export function cardToString(card: Card): string {
  return `${RANK_NAMES[card.rank]}${card.suit}`;
}

/** Parse short notation like "As" to a Card */
export function parseCard(notation: string): Card {
  if (notation.length !== 2) throw new Error(`Invalid card notation: ${notation}`);
  const rankChar = notation[0].toUpperCase();
  const suitChar = notation[1].toLowerCase();

  const rankEntry = Object.entries(RANK_NAMES).find(([, v]) => v === rankChar);
  if (!rankEntry) throw new Error(`Invalid rank: ${rankChar}`);

  const suitEntry = Object.values(Suit).find(s => s === suitChar);
  if (!suitEntry) throw new Error(`Invalid suit: ${suitChar}`);

  return { rank: Number(rankEntry[0]) as Rank, suit: suitEntry };
}

/** Parse multiple cards from space-separated notation */
export function parseCards(notation: string): Card[] {
  return notation.trim().split(/\s+/).map(parseCard);
}
