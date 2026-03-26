// ============================================================
// Hand Evaluator
// ============================================================
// Evaluates poker hands for:
// - Standard high hands (NLH, PLO high, Stud)
// - Ace-to-five low hands (Razz)
// - PLO (must use exactly 2 hole cards + 3 board cards)
//
// Value encoding: hands get a single numeric score.
// For HIGH hands: higher = better.
//   Score = category * 10^10 + kicker encoding
// For LOW hands: lower = better.
//   Score encodes ranks highest-to-lowest; lower ranks = lower score.

import { Card, Rank, Suit, HandCategory, HandResult, LowHandResult, cardToString } from './types.js';

// ============================================================
// Utility: combinations
// ============================================================

/** Generate all C(n, k) combinations of items */
export function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const results: T[][] = [];

  function recurse(start: number, current: T[]) {
    if (current.length === k) {
      results.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]);
      recurse(i + 1, current);
      current.pop();
    }
  }

  recurse(0, []);
  return results;
}

// ============================================================
// High Hand Evaluation (5-card)
// ============================================================

/** Sort cards by rank descending */
function sortByRankDesc(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank);
}

/** Check if 5 sorted cards form a straight. Returns the high card rank, or 0 if not a straight. */
function getStraightHighCard(sorted: Card[]): number {
  // Check for ace-low straight (A-2-3-4-5): ace plays as 1
  if (
    sorted[0].rank === Rank.Ace &&
    sorted[1].rank === Rank.Five &&
    sorted[2].rank === Rank.Four &&
    sorted[3].rank === Rank.Three &&
    sorted[4].rank === Rank.Two
  ) {
    return Rank.Five; // 5-high straight (wheel)
  }

  // Normal straight check
  for (let i = 0; i < 4; i++) {
    if (sorted[i].rank - sorted[i + 1].rank !== 1) return 0;
  }
  return sorted[0].rank;
}

/** Check if all 5 cards share a suit */
function isFlush(cards: Card[]): boolean {
  return cards.every(c => c.suit === cards[0].suit);
}

/** Group cards by rank, return counts sorted descending (e.g. [3,1,1] for trips) */
function getRankGroups(cards: Card[]): { counts: number[]; ranks: Rank[][] } {
  const map = new Map<Rank, Card[]>();
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank)!.push(c);
  }

  // Sort groups: by count desc, then by rank desc within same count
  const entries = [...map.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return b[0] - a[0];
  });

  return {
    counts: entries.map(e => e[1].length),
    ranks: entries.map(e => e[1].map(c => c.rank)),
  };
}

/**
 * Encode kicker values into a single number for comparison.
 * Takes up to 5 rank values and packs them into a base-15 number.
 */
function encodeKickers(ranks: number[]): number {
  let value = 0;
  for (const r of ranks) {
    value = value * 15 + r;
  }
  return value;
}

/** Category descriptions */
const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.OnePair]: 'One Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

const RANK_DISPLAY: Record<Rank, string> = {
  [Rank.Two]: 'Twos',
  [Rank.Three]: 'Threes',
  [Rank.Four]: 'Fours',
  [Rank.Five]: 'Fives',
  [Rank.Six]: 'Sixes',
  [Rank.Seven]: 'Sevens',
  [Rank.Eight]: 'Eights',
  [Rank.Nine]: 'Nines',
  [Rank.Ten]: 'Tens',
  [Rank.Jack]: 'Jacks',
  [Rank.Queen]: 'Queens',
  [Rank.King]: 'Kings',
  [Rank.Ace]: 'Aces',
};

const RANK_SINGLE: Record<Rank, string> = {
  [Rank.Two]: '2',
  [Rank.Three]: '3',
  [Rank.Four]: '4',
  [Rank.Five]: '5',
  [Rank.Six]: '6',
  [Rank.Seven]: '7',
  [Rank.Eight]: '8',
  [Rank.Nine]: '9',
  [Rank.Ten]: 'Ten',
  [Rank.Jack]: 'Jack',
  [Rank.Queen]: 'Queen',
  [Rank.King]: 'King',
  [Rank.Ace]: 'Ace',
};

/**
 * Evaluate a single 5-card hand for high poker.
 */
export function evaluate5CardHigh(cards: Card[]): HandResult {
  if (cards.length !== 5) throw new Error(`Expected 5 cards, got ${cards.length}`);

  const sorted = sortByRankDesc(cards);
  const flush = isFlush(sorted);
  const straightHigh = getStraightHighCard(sorted);
  const groups = getRankGroups(sorted);
  const pattern = groups.counts.join(',');

  let category: HandCategory;
  let kickers: number[];
  let description: string;

  if (flush && straightHigh > 0) {
    category = HandCategory.StraightFlush;
    kickers = [straightHigh];
    description = straightHigh === Rank.Ace
      ? 'Royal Flush'
      : `Straight Flush, ${RANK_SINGLE[straightHigh as Rank]}-high`;
  } else if (pattern === '4,1') {
    category = HandCategory.FourOfAKind;
    kickers = [groups.ranks[0][0], groups.ranks[1][0]];
    description = `Four ${RANK_DISPLAY[groups.ranks[0][0]]}`;
  } else if (pattern === '3,2') {
    category = HandCategory.FullHouse;
    kickers = [groups.ranks[0][0], groups.ranks[1][0]];
    description = `Full House, ${RANK_DISPLAY[groups.ranks[0][0]]} full of ${RANK_DISPLAY[groups.ranks[1][0]]}`;
  } else if (flush) {
    category = HandCategory.Flush;
    kickers = sorted.map(c => c.rank);
    description = `Flush, ${RANK_SINGLE[sorted[0].rank as Rank]}-high`;
  } else if (straightHigh > 0) {
    category = HandCategory.Straight;
    kickers = [straightHigh];
    description = `Straight, ${RANK_SINGLE[straightHigh as Rank]}-high`;
  } else if (pattern === '3,1,1') {
    category = HandCategory.ThreeOfAKind;
    kickers = [groups.ranks[0][0], groups.ranks[1][0], groups.ranks[2][0]];
    description = `Three ${RANK_DISPLAY[groups.ranks[0][0]]}`;
  } else if (pattern === '2,2,1') {
    category = HandCategory.TwoPair;
    kickers = [groups.ranks[0][0], groups.ranks[1][0], groups.ranks[2][0]];
    description = `Two Pair, ${RANK_DISPLAY[groups.ranks[0][0]]} and ${RANK_DISPLAY[groups.ranks[1][0]]}`;
  } else if (pattern === '2,1,1,1') {
    category = HandCategory.OnePair;
    kickers = [groups.ranks[0][0], groups.ranks[1][0], groups.ranks[2][0], groups.ranks[3][0]];
    description = `Pair of ${RANK_DISPLAY[groups.ranks[0][0]]}`;
  } else {
    category = HandCategory.HighCard;
    kickers = sorted.map(c => c.rank);
    description = `${RANK_SINGLE[sorted[0].rank as Rank]}-high`;
  }

  const CATEGORY_MULTIPLIER = 10_000_000_000;
  const value = category * CATEGORY_MULTIPLIER + encodeKickers(kickers);

  return { category, value, cards: sorted, description };
}

// ============================================================
// Best Hand from N cards (Hold'em style: best 5 of 7)
// ============================================================

/**
 * Find the best high hand from any number of cards (pick best 5).
 * Used for NLH (7 cards = 2 hole + 5 board).
 */
export function bestHighHand(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let best: HandResult | null = null;

  for (const combo of combos) {
    const result = evaluate5CardHigh(combo);
    if (!best || result.value > best.value) {
      best = result;
    }
  }

  return best!;
}

// ============================================================
// PLO Hand Evaluation (must use exactly 2 hole cards + 3 board)
// ============================================================

/**
 * Find the best PLO high hand.
 * Must use exactly 2 of 4 hole cards and exactly 3 of 5 board cards.
 */
export function bestPLOHighHand(holeCards: Card[], boardCards: Card[]): HandResult {
  if (holeCards.length !== 4) throw new Error(`PLO requires 4 hole cards, got ${holeCards.length}`);
  if (boardCards.length < 3) throw new Error(`PLO requires at least 3 board cards, got ${boardCards.length}`);

  const holeCombos = combinations(holeCards, 2);
  const boardCombos = combinations(boardCards, 3);

  let best: HandResult | null = null;

  for (const hole of holeCombos) {
    for (const board of boardCombos) {
      const result = evaluate5CardHigh([...hole, ...board]);
      if (!best || result.value > best.value) {
        best = result;
      }
    }
  }

  return best!;
}

// ============================================================
// Ace-to-Five Low Evaluation (Razz)
// ============================================================
// Rules:
// - Aces are ALWAYS low (rank 1, not 14)
// - Straights and flushes do NOT count against you
// - Best hand: A-2-3-4-5 (the wheel)
// - Pairs are bad (a pair loses to any non-pair hand)
// - Compare highest card first, then next highest, etc.

/**
 * Evaluate a 5-card hand for ace-to-five low.
 * Lower value = better hand.
 */
export function evaluate5CardLow(cards: Card[]): LowHandResult {
  if (cards.length !== 5) throw new Error(`Expected 5 cards, got ${cards.length}`);

  // Convert ranks: Ace becomes 1
  const lowRanks = cards.map(c => c.rank === Rank.Ace ? 1 : c.rank);

  // Sort ascending (best low cards first)
  const sorted = [...lowRanks].sort((a, b) => a - b);
  const sortedCards = [...cards].sort((a, b) => {
    const ra = a.rank === Rank.Ace ? 1 : a.rank;
    const rb = b.rank === Rank.Ace ? 1 : b.rank;
    return ra - rb;
  });

  // Check for pairs (bad in low)
  const hasPair = new Set(sorted).size < 5;

  // Encode value: compare from highest card down
  // For comparison: lower value = better hand
  // Encode highest-to-lowest so that [5,4,3,2,1] < [6,4,3,2,1]
  const descending = [...sorted].reverse();

  let value: number;
  if (hasPair) {
    // Hands with pairs are worse than all non-pair hands
    // Add a large penalty, then encode normally
    value = 100_000_000 + encodeKickers(descending);
  } else {
    value = encodeKickers(descending);
  }

  const description = sortedCards
    .map(c => c.rank === Rank.Ace ? 'A' : (c.rank <= 10 ? String(c.rank) : { 11: 'J', 12: 'Q', 13: 'K' }[c.rank]))
    .reverse()
    .join('-');

  return {
    value,
    cards: sortedCards,
    description: hasPair ? `${description} (paired)` : description,
    qualified: true, // A-5 low always qualifies (8-or-better check is separate)
  };
}

/**
 * Find the best ace-to-five low hand from N cards (pick best 5).
 * Used for Razz (7 cards).
 */
export function bestLowHand(cards: Card[]): LowHandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let best: LowHandResult | null = null;

  for (const combo of combos) {
    const result = evaluate5CardLow(combo);
    if (!best || result.value < best.value) {
      best = result;
    }
  }

  return best!;
}

// ============================================================
// 8-or-Better Low Evaluation (future: Omaha Hi-Lo, Stud Hi-Lo)
// ============================================================

/**
 * Find the best 8-or-better low hand from N cards.
 * Returns null if no qualifying low exists.
 */
export function bestEightOrBetterLow(cards: Card[]): LowHandResult | null {
  if (cards.length < 5) return null;

  const combos = combinations(cards, 5);
  let best: LowHandResult | null = null;

  for (const combo of combos) {
    const result = evaluate5CardLow(combo);
    // Check qualification: all 5 cards must be 8 or lower (aces count as 1)
    const ranks = combo.map(c => c.rank === Rank.Ace ? 1 : c.rank);
    const qualifies = ranks.every(r => r <= 8) && new Set(ranks).size === 5;

    if (qualifies) {
      const qualified = { ...result, qualified: true };
      if (!best || qualified.value < best.value) {
        best = qualified;
      }
    }
  }

  return best;
}

/**
 * PLO 8-or-better low hand.
 * Must use exactly 2 hole cards + 3 board cards, all 8 or lower, no pairs.
 */
export function bestPLOEightOrBetterLow(holeCards: Card[], boardCards: Card[]): LowHandResult | null {
  if (holeCards.length !== 4 || boardCards.length < 3) return null;

  const holeCombos = combinations(holeCards, 2);
  const boardCombos = combinations(boardCards, 3);

  let best: LowHandResult | null = null;

  for (const hole of holeCombos) {
    for (const board of boardCombos) {
      const fiveCards = [...hole, ...board];
      const ranks = fiveCards.map(c => c.rank === Rank.Ace ? 1 : c.rank);
      const qualifies = ranks.every(r => r <= 8) && new Set(ranks).size === 5;

      if (qualifies) {
        const result = evaluate5CardLow(fiveCards);
        const qualified = { ...result, qualified: true };
        if (!best || qualified.value < best.value) {
          best = qualified;
        }
      }
    }
  }

  return best;
}

// ============================================================
// Deuce-to-Seven Low Evaluation (2-7 Single Draw, 2-7 Triple Draw)
// ============================================================
// Rules:
// - Aces are ALWAYS HIGH (rank 14) — worst low card
// - Straights and flushes COUNT AGAINST you (they're bad)
// - Best hand: 2-3-4-5-7 (not suited, no straight)
// - A-2-3-4-5 is a straight (ace-high) — very bad
//
// Hand ranking tiers from BEST to WORST (exact reverse of high poker):
//   Tier 0: High card (no pair, no straight, no flush) — BEST
//   Tier 1: One pair
//   Tier 2: Two pair
//   Tier 3: Three of a kind
//   Tier 4: Straight
//   Tier 5: Flush
//   Tier 6: Full house
//   Tier 7: Four of a kind
//   Tier 8: Straight flush — WORST

/**
 * 2-7 low tier constants. Lower tier = better hand.
 * These are the exact reverse of standard high poker hand categories.
 */
const LOW27_TIER = {
  HIGH_CARD:       0,
  ONE_PAIR:        1,
  TWO_PAIR:        2,
  THREE_OF_A_KIND: 3,
  STRAIGHT:        4,
  FLUSH:           5,
  FULL_HOUSE:      6,
  FOUR_OF_A_KIND:  7,
  STRAIGHT_FLUSH:  8,
} as const;

const LOW27_TIER_MULTIPLIER = 100_000_000;

/** Tier descriptions for 2-7 low */
const LOW27_TIER_SUFFIX: Record<number, string> = {
  [LOW27_TIER.HIGH_CARD]: '',
  [LOW27_TIER.ONE_PAIR]: ' (one pair)',
  [LOW27_TIER.TWO_PAIR]: ' (two pair)',
  [LOW27_TIER.THREE_OF_A_KIND]: ' (three of a kind)',
  [LOW27_TIER.STRAIGHT]: ' (straight)',
  [LOW27_TIER.FLUSH]: ' (flush)',
  [LOW27_TIER.FULL_HOUSE]: ' (full house)',
  [LOW27_TIER.FOUR_OF_A_KIND]: ' (four of a kind)',
  [LOW27_TIER.STRAIGHT_FLUSH]: ' (straight flush)',
};

/**
 * Evaluate a 5-card hand for deuce-to-seven low.
 * Lower value = better hand.
 *
 * Uses exact reverse of standard high poker rankings:
 * high card < one pair < two pair < trips < straight < flush < full house < quads < straight flush
 */
export function evaluate5Card27Low(cards: Card[]): LowHandResult {
  if (cards.length !== 5) throw new Error(`Expected 5 cards, got ${cards.length}`);

  // In 2-7, aces are always 14 (high). No rank conversion.
  const ranks = cards.map(c => c.rank);
  const sorted = [...ranks].sort((a, b) => a - b);
  const sortedCards = [...cards].sort((a, b) => a.rank - b.rank);

  // Determine the hand category using standard poker logic
  const flush = cards.every(c => c.suit === cards[0].suit);

  // Group by rank to detect pairs/trips/quads
  const rankCounts = new Map<number, number>();
  for (const r of sorted) {
    rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  }
  const counts = [...rankCounts.values()].sort((a, b) => b - a);
  const pattern = counts.join(',');

  // Check for straight (aces are high only in 2-7)
  let isStraight = false;
  const uniqueCount = rankCounts.size;
  if (uniqueCount === 5) {
    // Normal consecutive check
    if (sorted[4] - sorted[0] === 4) {
      isStraight = true;
    }
    // Ace-high wrap: A-2-3-4-5 is a straight in 2-7 (sorted = [2,3,4,5,14])
    if (!isStraight && sorted[4] === Rank.Ace &&
        sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5) {
      isStraight = true;
    }
  }

  // Determine tier (reverse of high poker)
  let tier: number;
  if (flush && isStraight) {
    tier = LOW27_TIER.STRAIGHT_FLUSH;
  } else if (pattern === '4,1') {
    tier = LOW27_TIER.FOUR_OF_A_KIND;
  } else if (pattern === '3,2') {
    tier = LOW27_TIER.FULL_HOUSE;
  } else if (flush) {
    tier = LOW27_TIER.FLUSH;
  } else if (isStraight) {
    tier = LOW27_TIER.STRAIGHT;
  } else if (pattern === '3,1,1') {
    tier = LOW27_TIER.THREE_OF_A_KIND;
  } else if (pattern === '2,2,1') {
    tier = LOW27_TIER.TWO_PAIR;
  } else if (pattern === '2,1,1,1') {
    tier = LOW27_TIER.ONE_PAIR;
  } else {
    tier = LOW27_TIER.HIGH_CARD;
  }

  // Within each tier, rank by card values (lower = better for low).
  // For paired hands, sort groups by count desc then rank desc (same as high eval)
  // so that the kicker encoding correctly differentiates within a tier.
  const groups = [...rankCounts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]; // by count desc
      return b[0] - a[0]; // by rank desc (higher rank = worse in low)
    });
  const kickerRanks = groups.map(([rank]) => rank);

  const value = tier * LOW27_TIER_MULTIPLIER + encodeKickers(kickerRanks);

  // Build description
  const description = sortedCards
    .map(c => c.rank <= 10 ? String(c.rank) : { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[c.rank])
    .reverse()
    .join('-');

  return {
    value,
    cards: sortedCards,
    description: description + (LOW27_TIER_SUFFIX[tier] || ''),
    qualified: true,
  };
}

/**
 * Find the best 2-7 low hand from N cards (pick best 5).
 */
export function best27LowHand(cards: Card[]): LowHandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let best: LowHandResult | null = null;

  for (const combo of combos) {
    const result = evaluate5Card27Low(combo);
    if (!best || result.value < best.value) {
      best = result;
    }
  }

  return best!;
}

// ============================================================
// Badugi Hand Evaluation
// ============================================================
// Rules:
// - Goal: make the best 4-card hand with ALL DIFFERENT SUITS
// - A 4-card badugi beats any 3-card badugi, beats any 2-card, etc.
// - Within same card count, lower ranks win (it's a lowball game)
// - Ace-low Badugi: A is rank 1 (best). Nut = A-2-3-4 rainbow.
// - Deuce-low Badugi (Badeucy): A is rank 14 (worst). Nut = 2-3-4-5 rainbow.
// - When cards share suits, keep the lowest-ranked card of each suit.

/**
 * Evaluate a Badugi hand from any number of cards.
 * Finds the best subset of up to 4 cards with all different suits.
 * Returns a HandResult where higher value = better hand.
 *
 * @param cards - The player's hole cards (typically 4 or 5)
 * @param aceLow - If true, ace = 1 (standard Badugi/Badacey). If false, ace = 14 (Badeucy).
 */
export function evaluateBadugi(cards: Card[], aceLow: boolean): HandResult {
  const getEffectiveRank = (c: Card): number => {
    if (aceLow && c.rank === Rank.Ace) return 1;
    if (!aceLow && c.rank === Rank.Ace) return 14;
    return c.rank;
  };

  let bestValue = -1;
  let bestCards: Card[] = [];
  let bestSize = 0;
  let bestRanks: number[] = [];

  // Try sizes from 4 down to 1 — stop at the first size we find a valid hand
  for (let size = Math.min(4, cards.length); size >= 1; size--) {
    if (size < bestSize) break; // Already found a bigger badugi

    const combos = combinations(cards, size);
    for (const combo of combos) {
      // Check: all different suits
      const suits = new Set(combo.map(c => c.suit));
      if (suits.size !== size) continue;

      // Also check: all different effective ranks (no pairs in badugi)
      const ranks = combo.map(c => getEffectiveRank(c));
      if (new Set(ranks).size !== size) continue;

      // Valid badugi of this size — encode value
      const sortedRanks = [...ranks].sort((a, b) => a - b);
      // Lower ranks are better. Encode: higher value = better hand.
      // value = size * 1_000_000_000 - rankEncoding
      // rankEncoding: sort descending, encode base-15 (higher encoded = worse hand)
      const descRanks = [...sortedRanks].reverse();
      let rankEncoding = 0;
      for (const r of descRanks) {
        rankEncoding = rankEncoding * 15 + r;
      }
      const value = size * 1_000_000_000 - rankEncoding;

      if (value > bestValue) {
        bestValue = value;
        bestCards = combo;
        bestSize = size;
        bestRanks = sortedRanks;
      }
    }
  }

  // Build description — display ranks high to low (like lowball convention)
  const descRanksForDisplay = [...bestRanks].reverse();
  const rankNames = descRanksForDisplay.map(r => {
    if (r === 1) return 'A';
    if (r <= 10) return String(r);
    return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || '?';
  });
  const desc = bestSize === 4
    ? `Badugi: ${rankNames.join('-')}`
    : `${bestSize}-card: ${rankNames.join('-')}`;

  return {
    category: HandCategory.HighCard, // Not meaningful for Badugi
    value: bestValue,
    cards: bestCards,
    description: desc,
  };
}

// ============================================================
// Pip Count Evaluation (for Drawmaha 49, 10-30 Draw, Archie)
// ============================================================
// Pip counting: Face cards (J, Q, K) = 0, Ace = 1, 2-10 = face value.
// Sum of all 5 cards.

/**
 * Calculate the pip count for a set of cards.
 * Face cards = 0, Ace = 1, 2-10 = face value.
 */
export function calculatePipCount(cards: Card[]): number {
  let total = 0;
  for (const c of cards) {
    if (c.rank === Rank.Ace) {
      total += 1;
    } else if (c.rank >= Rank.Jack) {
      total += 0; // Face cards = 0
    } else {
      total += c.rank; // 2-10 = face value
    }
  }
  return total;
}

/**
 * Evaluate the best 5-card hand for pip count closest to a target value.
 * Returns a HandResult where higher value = closer to the target.
 * Used for Drawmaha 49 (target = 49).
 */
export function bestPipCountHand(cards: Card[], target: number): HandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let bestCombo: Card[] | null = null;
  let bestDistance = Infinity;
  let bestPips = 0;

  for (const combo of combos) {
    const pips = calculatePipCount(combo);
    const distance = Math.abs(pips - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestCombo = combo;
      bestPips = pips;
    }
  }

  // Value: higher = better. Max distance is ~49, so 100 - distance works.
  // Use a large base to ensure distinctness.
  const value = 1_000_000 - bestDistance * 1000 + bestPips; // tiebreak: closer to target, then higher pips

  return {
    category: HandCategory.HighCard,
    value,
    cards: bestCombo!,
    description: `${bestPips} pips`,
  };
}

/**
 * Evaluate a 5-card hand for highest pip count (for 10-30 high side).
 * Higher pip count = better. Returns HandResult with higher value = better.
 * Non-qualifying hands (< threshold) get value 0.
 */
export function evaluateHighPips(cards: Card[], minQualifier: number): HandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let bestPips = -1;
  let bestCombo: Card[] = cards.slice(0, 5);

  for (const combo of combos) {
    const pips = calculatePipCount(combo);
    if (pips > bestPips) {
      bestPips = pips;
      bestCombo = combo;
    }
  }

  const qualifies = bestPips >= minQualifier;
  return {
    category: HandCategory.HighCard,
    value: qualifies ? bestPips * 1000 : 0,
    cards: bestCombo,
    description: qualifies ? `${bestPips} pips (high)` : `${bestPips} pips (no qualifier)`,
  };
}

/**
 * Evaluate a 5-card hand for lowest pip count (for 10-30 low side).
 * Lower pip count = better. Returns LowHandResult with lower value = better.
 * Non-qualifying hands (> threshold) get qualified: false.
 */
export function evaluateLowPips(cards: Card[], maxQualifier: number): LowHandResult {
  if (cards.length < 5) throw new Error(`Need at least 5 cards, got ${cards.length}`);

  const combos = combinations(cards, 5);
  let bestPips = Infinity;
  let bestCombo: Card[] = cards.slice(0, 5);

  for (const combo of combos) {
    const pips = calculatePipCount(combo);
    if (pips < bestPips) {
      bestPips = pips;
      bestCombo = combo;
    }
  }

  const qualifies = bestPips <= maxQualifier;
  return {
    value: bestPips,
    cards: bestCombo,
    description: qualifies ? `${bestPips} pips (low)` : `${bestPips} pips (no qualifier)`,
    qualified: qualifies,
  };
}
