// ============================================================
// Deck Module — CSPRNG-based card shuffling
// ============================================================
// Uses CSPRNG for cryptographically secure randomness.
// Works in both Node.js and browser (Web Crypto API).
// No Math.random() anywhere in this codebase.

import { Card, Rank, Suit, cardToString } from './types.js';

/**
 * Get cryptographically secure random bytes.
 * Uses Web Crypto API (works in both browser and Node.js 15+).
 */
function getRandomBytes(count: number): Uint8Array {
  const buf = new Uint8Array(count);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
  } else {
    // Fallback for older Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require('crypto');
    const nodeBuf = randomBytes(count);
    buf.set(nodeBuf);
  }
  return buf;
}

/**
 * Generate a cryptographically secure random integer in [0, max).
 * Uses rejection sampling to avoid modulo bias.
 */
function secureRandomInt(max: number): number {
  if (max <= 0) throw new Error('max must be positive');
  if (max === 1) return 0;

  // Find the number of bytes needed
  const bytesNeeded = Math.ceil(Math.log2(max) / 8) || 1;
  const maxValid = Math.pow(256, bytesNeeded);
  const limit = maxValid - (maxValid % max); // Reject values >= limit to avoid bias

  let value: number;
  do {
    const buf = getRandomBytes(bytesNeeded);
    value = 0;
    for (let i = 0; i < bytesNeeded; i++) {
      value = value * 256 + buf[i];
    }
  } while (value >= limit);

  return value % max;
}

/**
 * Create a standard 52-card deck in order.
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  const suits = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];
  for (const suit of suits) {
    for (let rank = Rank.Two; rank <= Rank.Ace; rank++) {
      deck.push({ rank: rank as Rank, suit });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle using CSPRNG.
 * Shuffles in-place and returns the deck for chaining.
 */
export function shuffleDeck(deck: Card[]): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * A Deck instance that tracks dealt cards.
 * Create one per hand.
 */
export class Deck {
  private cards: Card[];
  private position: number;

  constructor() {
    this.cards = shuffleDeck(createDeck());
    this.position = 0;
  }

  /** Deal one card from the top */
  deal(): Card {
    if (this.position >= this.cards.length) {
      throw new Error('Deck exhausted — no cards remaining');
    }
    return this.cards[this.position++];
  }

  /** Deal n cards */
  dealMany(n: number): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < n; i++) {
      cards.push(this.deal());
    }
    return cards;
  }

  /** Burn one card (deal face-down, discard) */
  burn(): void {
    this.deal(); // Just advance the pointer
  }

  /** How many cards remain */
  remaining(): number {
    return this.cards.length - this.position;
  }

  /** String representation of remaining deck (for debugging) */
  toString(): string {
    return this.cards
      .slice(this.position)
      .map(cardToString)
      .join(' ');
  }
}
