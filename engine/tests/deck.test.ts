// ============================================================
// Deck Tests
// ============================================================
import { describe, it, expect } from 'vitest';
import { Deck, createDeck, shuffleDeck } from '../src/deck.js';
import { cardToString } from '../src/types.js';

describe('createDeck', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    const strs = new Set(deck.map(cardToString));
    expect(strs.size).toBe(52);
  });
});

describe('shuffleDeck', () => {
  it('returns all 52 cards after shuffle', () => {
    const deck = shuffleDeck(createDeck());
    expect(deck).toHaveLength(52);
    const strs = new Set(deck.map(cardToString));
    expect(strs.size).toBe(52);
  });

  it('produces different orderings (probabilistic)', () => {
    const d1 = shuffleDeck(createDeck()).map(cardToString).join(',');
    const d2 = shuffleDeck(createDeck()).map(cardToString).join(',');
    // Extremely unlikely to be the same
    expect(d1).not.toBe(d2);
  });
});

describe('Deck class', () => {
  it('deals 52 unique cards', () => {
    const deck = new Deck();
    const dealt = new Set<string>();
    for (let i = 0; i < 52; i++) {
      dealt.add(cardToString(deck.deal()));
    }
    expect(dealt.size).toBe(52);
  });

  it('throws when exhausted', () => {
    const deck = new Deck();
    for (let i = 0; i < 52; i++) deck.deal();
    expect(() => deck.deal()).toThrow('Deck exhausted');
  });

});
