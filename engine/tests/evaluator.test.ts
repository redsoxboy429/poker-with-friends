// ============================================================
// Hand Evaluator Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  evaluate5CardHigh,
  bestHighHand,
  bestPLOHighHand,
  evaluate5CardLow,
  bestLowHand,
  bestEightOrBetterLow,
  combinations,
} from '../src/evaluator.js';
import { parseCards, parseCard, HandCategory, Rank, Suit } from '../src/types.js';

// ============================================================
// 5-Card High Hand Evaluation
// ============================================================
describe('evaluate5CardHigh', () => {
  it('detects royal flush', () => {
    const hand = parseCards('As Ks Qs Js Ts');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.description).toBe('Royal Flush');
  });

  it('detects straight flush', () => {
    const hand = parseCards('9h 8h 7h 6h 5h');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.description).toContain('Straight Flush');
  });

  it('detects wheel straight flush (A-5)', () => {
    const hand = parseCards('5d 4d 3d 2d Ad');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.StraightFlush);
  });

  it('detects four of a kind', () => {
    const hand = parseCards('Ks Kh Kd Kc 3s');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.FourOfAKind);
  });

  it('detects full house', () => {
    const hand = parseCards('Qs Qh Qd 7s 7h');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.FullHouse);
    expect(result.description).toContain('Queens');
    expect(result.description).toContain('Sevens');
  });

  it('detects flush', () => {
    const hand = parseCards('Ah Th 8h 5h 2h');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.Flush);
  });

  it('detects straight', () => {
    const hand = parseCards('9s 8h 7d 6c 5s');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.Straight);
  });

  it('detects wheel (A-5 straight)', () => {
    const hand = parseCards('5s 4h 3d 2c As');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.Straight);
  });

  it('detects three of a kind', () => {
    const hand = parseCards('8s 8h 8d Kc 2s');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.ThreeOfAKind);
  });

  it('detects two pair', () => {
    const hand = parseCards('Js Jh 5d 5c Ks');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.TwoPair);
  });

  it('detects one pair', () => {
    const hand = parseCards('As Ah Kd Qs 2c');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.OnePair);
  });

  it('detects high card', () => {
    const hand = parseCards('As Kh Td 7c 3s');
    const result = evaluate5CardHigh(hand);
    expect(result.category).toBe(HandCategory.HighCard);
  });

  // Ordering tests
  it('ranks royal flush > four of a kind', () => {
    const rf = evaluate5CardHigh(parseCards('As Ks Qs Js Ts'));
    const quads = evaluate5CardHigh(parseCards('Ks Kh Kd Kc As'));
    expect(rf.value).toBeGreaterThan(quads.value);
  });

  it('ranks higher pair above lower pair', () => {
    const aces = evaluate5CardHigh(parseCards('As Ah Kd Qs 2c'));
    const kings = evaluate5CardHigh(parseCards('Ks Kh Ad Qs 2c'));
    expect(aces.value).toBeGreaterThan(kings.value);
  });

  it('ranks pair with better kicker higher', () => {
    const pairAK = evaluate5CardHigh(parseCards('As Ah Kd 5s 2c'));
    const pairAQ = evaluate5CardHigh(parseCards('Ad Ac Qs 5h 2d'));
    expect(pairAK.value).toBeGreaterThan(pairAQ.value);
  });

  it('ranks higher straight above lower straight', () => {
    const high = evaluate5CardHigh(parseCards('Ts 9h 8d 7c 6s'));
    const low = evaluate5CardHigh(parseCards('9s 8h 7d 6c 5s'));
    expect(high.value).toBeGreaterThan(low.value);
  });

  it('ace-high straight beats wheel', () => {
    const aceHigh = evaluate5CardHigh(parseCards('As Kh Qd Jc Ts'));
    const wheel = evaluate5CardHigh(parseCards('5s 4h 3d 2c As'));
    // Ace-high straight should NOT be a straight flush (different suits)
    expect(aceHigh.category).toBe(HandCategory.Straight);
    expect(aceHigh.value).toBeGreaterThan(wheel.value);
  });
});

// ============================================================
// Best High Hand (7 cards → best 5)
// ============================================================
describe('bestHighHand', () => {
  it('finds the best hand from 7 cards', () => {
    // Hole: As Ks, Board: Qs Js Ts 3h 2d → Royal flush
    const cards = parseCards('As Ks Qs Js Ts 3h 2d');
    const result = bestHighHand(cards);
    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.description).toBe('Royal Flush');
  });

  it('ignores worse cards in 7-card hand', () => {
    // Has a flush and a pair, but flush is better
    const cards = parseCards('Ah Kh Qh Jh 9h 9s 2d');
    const result = bestHighHand(cards);
    expect(result.category).toBe(HandCategory.Flush);
  });
});

// ============================================================
// PLO Hand Evaluation (must use exactly 2 hole + 3 board)
// ============================================================
describe('bestPLOHighHand', () => {
  it('uses exactly 2 hole cards', () => {
    // Hole: As Ks Qs Js (4 spades!)
    // Board: Ts 3h 2d 7c 8c
    // In NLH this would be a flush, but PLO must use exactly 2 hole + 3 board
    // Best: As Ks + Ts 3h 2d? No flush possible with only 2 spades from hole + 1 from board
    const hole = parseCards('As Ks Qs Js');
    const board = parseCards('Ts 3h 2d 7c 8c');
    const result = bestPLOHighHand(hole, board);
    // Can't make a flush (need 3 board spades, only have 1)
    expect(result.category).not.toBe(HandCategory.Flush);
  });

  it('finds correct PLO hand with 2+3 constraint', () => {
    // Hole: Ah Ad Kh Kd
    // Board: As Ac 2s 3s 4s
    // Best: use Ah Ad + As Ac 2s = Four aces
    const hole = parseCards('Ah Ad Kh Kd');
    const board = parseCards('As Ac 2s 3s 4s');
    const result = bestPLOHighHand(hole, board);
    expect(result.category).toBe(HandCategory.FourOfAKind);
  });

  it('correctly evaluates PLO straight', () => {
    // Hole: 9h 8h 2d 3c
    // Board: Ts 7s 6d Kh Ac
    // Best: 9h 8h + Ts 7s 6d = T-high straight
    const hole = parseCards('9h 8h 2d 3c');
    const board = parseCards('Ts 7s 6d Kh Ac');
    const result = bestPLOHighHand(hole, board);
    expect(result.category).toBe(HandCategory.Straight);
  });
});

// ============================================================
// Ace-to-Five Low Evaluation (Razz)
// ============================================================
describe('evaluate5CardLow', () => {
  it('A-2-3-4-5 is the best low (wheel)', () => {
    const wheel = evaluate5CardLow(parseCards('As 2h 3d 4c 5s'));
    const sixLow = evaluate5CardLow(parseCards('6s 2h 3d 4c As'));
    expect(wheel.value).toBeLessThan(sixLow.value);
  });

  it('lower high card wins', () => {
    const sevenLow = evaluate5CardLow(parseCards('7s 5h 4d 3c 2s'));
    const eightLow = evaluate5CardLow(parseCards('8s 5h 4d 3c 2s'));
    expect(sevenLow.value).toBeLessThan(eightLow.value);
  });

  it('compares second card when highest matches', () => {
    const a = evaluate5CardLow(parseCards('8s 6h 4d 3c 2s'));
    const b = evaluate5CardLow(parseCards('8s 7h 4d 3c 2s'));
    expect(a.value).toBeLessThan(b.value); // 8-6 beats 8-7
  });

  it('pairs are worse than any non-pair hand', () => {
    const paired = evaluate5CardLow(parseCards('2s 2h 3d 4c 5s'));
    const kingHigh = evaluate5CardLow(parseCards('Ks Qh Jd Tc 9s'));
    expect(paired.value).toBeGreaterThan(kingHigh.value); // Pair is worse
  });

  it('straights and flushes do not count against you', () => {
    // A-2-3-4-5 all hearts is still the best low hand
    const straightFlush = evaluate5CardLow(parseCards('Ah 2h 3h 4h 5h'));
    const wheel = evaluate5CardLow(parseCards('As 2d 3h 4c 5s'));
    expect(straightFlush.value).toBe(wheel.value);
  });
});

// ============================================================
// Best Low Hand from 7 cards (Razz)
// ============================================================
describe('bestLowHand', () => {
  it('picks the best 5 low cards from 7', () => {
    // Has A-2-3-4-5 buried in 7 cards with a king and queen
    const cards = parseCards('As 2h 3d 4c 5s Kh Qd');
    const result = bestLowHand(cards);
    // Should find the wheel
    expect(result.value).toBe(evaluate5CardLow(parseCards('As 2h 3d 4c 5s')).value);
  });

  it('avoids pairs when possible', () => {
    const cards = parseCards('As 2h 3d 4c 4s 7h 8d');
    const result = bestLowHand(cards);
    // Should pick A-2-3-4-7 or A-2-3-4-8, avoiding the pair of 4s
    expect(result.description).not.toContain('paired');
  });
});

// ============================================================
// 8-or-Better Low (future: Omaha Hi-Lo, Stud Hi-Lo)
// ============================================================
describe('bestEightOrBetterLow', () => {
  it('qualifies with 8-high low', () => {
    const cards = parseCards('As 2h 3d 5c 8s Kh Qd');
    const result = bestEightOrBetterLow(cards);
    expect(result).not.toBeNull();
    expect(result!.qualified).toBe(true);
  });

  it('does not qualify with 9-high low', () => {
    const cards = parseCards('9s Th Jd Qc Ks 2h 3d');
    const result = bestEightOrBetterLow(cards);
    // No 5 unpaired cards all 8 or lower
    expect(result).toBeNull();
  });

  it('does not qualify with paired low cards', () => {
    const cards = parseCards('As 2h 3d 5c 5s Kh Qd');
    // Has A-2-3-5 but 5 is paired, and no other low card to replace
    // Available low cards: A, 2, 3, 5, 5 — only 4 unique, need 5
    const result = bestEightOrBetterLow(cards);
    expect(result).toBeNull();
  });
});
