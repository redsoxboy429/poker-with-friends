// ============================================================
// Base Stud Game Engine
// ============================================================
// Shared infrastructure for all 7-card stud variants:
// Razz, Stud High, Stud Hi-Lo, etc.
//
// Handles: up/down card tracking, card visibility, antes as dead
// money, bring-in posting, stud street dealing (3rd-7th), and
// the abstract hooks that differ per variant (bring-in selection,
// first-actor determination, hand evaluation).

import { BaseGame } from './base.js';
import {
  GamePhase,
  ActionType,
  type PlayerState,
  type TableConfig,
  type HandState,
  type Card,
  Rank,
  BettingStructure,
} from '../types.js';

/** Suit order for breaking bring-in ties: spades > hearts > diamonds > clubs */
const SUIT_ORDER: Record<string, number> = { 'c': 0, 'd': 1, 'h': 2, 's': 3 };

/**
 * Abstract base class for 7-card stud variants.
 * Subclasses only need to implement:
 * - getBringInPlayerIndex(): who posts the bring-in (lowest/highest door card)
 * - setFirstActorForStreet(): who acts first on later streets
 * - evaluateHand(): how to rank hands at showdown
 */
export abstract class BaseStudGame extends BaseGame {
  // Track up-cards per player for display and bring-in/first-actor determination
  protected upCards: Map<string, Card[]> = new Map();
  protected downCards: Map<string, Card[]> = new Map();

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    const studConfig: TableConfig = {
      ...config,
      bettingStructure: BettingStructure.FixedLimit,
      // Default bring-in: a quarter of the small bet in whole $0.25 chips (spec §2)
      bringIn: config.bringIn || Math.max(0.25, Math.floor((config.smallBet ?? config.smallBlind) / 4 / 0.25) * 0.25),
    };
    super(studConfig, players, buttonIndex);
  }

  /** Get a player's visible (up) cards */
  getUpCards(playerId: string): Card[] {
    return this.upCards.get(playerId) || [];
  }

  /** Override to include card visibility (up/down) for stud display */
  override getState(): Readonly<HandState> {
    const base = { ...this.state };
    base.players = base.players.map(p => {
      const up = this.upCards.get(p.id) || [];
      // Build visibility array parallel to holeCards
      const visibility: ('up' | 'down')[] = p.holeCards.map(card => {
        if (up.includes(card)) return 'up';
        return 'down';
      });
      return { ...p, cardVisibility: visibility };
    });
    return base;
  }

  // ============================================================
  // Shared stud logic
  // ============================================================

  protected postForcedBets(): void {
    // Everyone posts an ante — dead money straight into the pot
    let totalAntes = 0;
    const eligibleIds: string[] = [];

    for (const player of this.state.players) {
      if (player.sittingOut) continue;
      const anteAmount = Math.min(this.config.ante, player.chips);
      player.chips -= anteAmount;
      player.totalBet += anteAmount;
      totalAntes += anteAmount;
      eligibleIds.push(player.id);
      if (player.chips === 0) player.allIn = true;
      this.state.actionHistory.push({
        type: ActionType.PostAnte,
        playerId: player.id,
        amount: anteAmount,
      });
    }

    // Antes go directly into the pot — NOT into player.bet
    if (totalAntes > 0) {
      this.state.pots.push({ amount: totalAntes, eligiblePlayerIds: eligibleIds });
    }

    this.state.phase = GamePhase.Dealing;
  }

  protected dealInitialCards(): void {
    // Deal 3rd street: 2 down + 1 up to each player
    const activePlayers = this.state.players.filter(p => !p.sittingOut);

    // Initialize tracking
    for (const p of activePlayers) {
      this.upCards.set(p.id, []);
      this.downCards.set(p.id, []);
    }

    // First down card
    for (const p of activePlayers) {
      const card = this.deck.deal();
      p.holeCards.push(card);
      this.downCards.get(p.id)!.push(card);
    }

    // Second down card
    for (const p of activePlayers) {
      const card = this.deck.deal();
      p.holeCards.push(card);
      this.downCards.get(p.id)!.push(card);
    }

    // Door card (up card)
    for (const p of activePlayers) {
      const card = this.deck.deal();
      p.holeCards.push(card);
      this.upCards.get(p.id)!.push(card);
    }

    // Set phase BEFORE posting bring-in so the BringIn action is included
    // in this round's action history (needed for hasActedThisRound to see it)
    this.state.phase = GamePhase.BettingThird;
    this.phaseStartActionIndex = this.state.actionHistory.length;
    this.postBringIn();
  }

  /**
   * Determine which player posts the bring-in based on door cards.
   * Subclasses implement this to define which door card is "worst":
   * - Razz: highest door card (king is worst)
   * - Stud High: lowest door card (deuce is worst)
   */
  protected abstract getBringInPlayerIndex(): number;

  private postBringIn(): void {
    const worstIdx = this.getBringInPlayerIndex();

    if (worstIdx >= 0) {
      const bringInPlayer = this.state.players[worstIdx];
      if (bringInPlayer.chips > this.config.bringIn) {
        // The bring-in player chooses: bring in, or complete to the small bet
        // (docs/NINE-GAME-RULES.md §4). act() records the choice.
        this.state.pendingBringIn = true;
        this.state.activePlayerIndex = worstIdx;
        return;
      }
      // Too short to complete: the bring-in is posted automatically (all-in).
      const amount = Math.min(this.config.bringIn, bringInPlayer.chips);
      bringInPlayer.chips -= amount;
      bringInPlayer.bet += amount;
      bringInPlayer.totalBet += amount;
      this.state.currentBet = amount;
      if (bringInPlayer.chips === 0) bringInPlayer.allIn = true;
      this.state.actionHistory.push({
        type: ActionType.BringIn,
        playerId: bringInPlayer.id,
        amount,
      });

      // Action starts to the left of the bring-in
      this.state.activePlayerIndex = this.findNextActivePlayer(worstIdx);
    }
  }

  protected setFirstActor(): void {
    // Already set by postBringIn
  }

  /**
   * Stud high only: an open pair on 4th street lets players bet the big bet.
   * Stud/8 and Razz keep the small bet.
   */
  protected hasOpenPairOption(): boolean {
    return false;
  }

  /**
   * First actor from 4th street on: the best showing hand among players who
   * can still bet. Ties go to the tied player closest to the left of the
   * (fixed) button, so the scan starts there and keeps the first best found.
   */
  protected setFirstActorByShowing(isBetter: (a: number, b: number) => boolean, useLow: boolean): void {
    const n = this.state.players.length;
    let bestIdx = -1;
    let bestValue = 0;
    for (let k = 1; k <= n; k++) {
      const i = (this.state.buttonIndex + k) % n;
      const p = this.state.players[i];
      if (p.folded || p.sittingOut || p.allIn) continue;
      const value = this.getShowingHandValue(p.id, useLow);
      if (bestIdx < 0 || isBetter(value, bestValue)) {
        bestIdx = i;
        bestValue = value;
      }
    }
    if (bestIdx >= 0) this.state.activePlayerIndex = bestIdx;
  }

  // setFirstActorForStreet remains abstract — differs between Razz (lowest board)
  // and Stud High (highest board)

  protected getNextPhase(): GamePhase {
    switch (this.state.phase) {
      case GamePhase.BettingThird: return GamePhase.BettingFourth;
      case GamePhase.BettingFourth: return GamePhase.BettingFifth;
      case GamePhase.BettingFifth: return GamePhase.BettingSixth;
      case GamePhase.BettingSixth: return GamePhase.BettingSeventh;
      case GamePhase.BettingSeventh: return GamePhase.Showdown;
      default: return GamePhase.Showdown;
    }
  }

  protected dealPhaseCards(phase: GamePhase): void {
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);

    switch (phase) {
      case GamePhase.BettingFourth:
      case GamePhase.BettingFifth:
      case GamePhase.BettingSixth:
        // Deal one up card to each active player
        for (const p of activePlayers) {
          const card = this.deck.deal();
          p.holeCards.push(card);
          this.upCards.get(p.id)!.push(card);
        }
        if (phase === GamePhase.BettingFourth && this.hasOpenPairOption()) {
          this.state.openPairFourth = activePlayers.some(p => {
            const [a, b] = this.upCards.get(p.id) ?? [];
            return !!a && !!b && a.rank === b.rank;
          });
          this.state.bigBetInForce = false;
        }
        break;

      case GamePhase.BettingSeventh:
        // Deal one DOWN card to each active player (7th street is face down)
        for (const p of activePlayers) {
          const card = this.deck.deal();
          p.holeCards.push(card);
          this.downCards.get(p.id)!.push(card);
        }
        break;
    }
  }

  protected dealRemainingCards(): void {
    // Deal remaining streets to get all players to 7 cards
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);

    for (const p of activePlayers) {
      while (p.holeCards.length < 7) {
        const card = this.deck.deal();
        p.holeCards.push(card);

        // 4th/5th/6th streets are up cards, 7th is down
        if (p.holeCards.length <= 6) {
          this.upCards.get(p.id)!.push(card);
        } else {
          this.downCards.get(p.id)!.push(card);
        }
      }
    }
  }

  // ============================================================
  // Utility helpers for subclass bring-in / first-actor logic
  // ============================================================

  /**
   * Find the player with the highest (worst for Razz) door card.
   * Ties broken by suit: spades > hearts > diamonds > clubs.
   * Ace treated as LOW (rank 1) for Razz bring-in.
   */
  protected findHighestDoorCard(aceLow: boolean): number {
    let worstIdx = -1;
    let worstRank = -1;
    let worstSuitOrder = -1;

    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      // A player all-in from the ante cannot bring in; it passes to the next-worst door card.
      if (p.sittingOut || p.allIn) continue;

      const doorCard = this.upCards.get(p.id)?.[0];
      if (!doorCard) continue;

      const effectiveRank = (aceLow && doorCard.rank === Rank.Ace) ? 1 : doorCard.rank;
      const suitVal = SUIT_ORDER[doorCard.suit] || 0;

      if (effectiveRank > worstRank || (effectiveRank === worstRank && suitVal > worstSuitOrder)) {
        worstIdx = i;
        worstRank = effectiveRank;
        worstSuitOrder = suitVal;
      }
    }
    return worstIdx;
  }

  /**
   * Find the player with the lowest door card.
   * Ties broken by suit: clubs < diamonds < hearts < spades (clubs brings in).
   * Ace treated as HIGH (rank 14) for Stud High bring-in.
   */
  protected findLowestDoorCard(aceHigh: boolean): number {
    let worstIdx = -1;
    let worstRank = Infinity;
    let worstSuitOrder = Infinity;

    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i];
      // A player all-in from the ante cannot bring in; it passes to the next-worst door card.
      if (p.sittingOut || p.allIn) continue;

      const doorCard = this.upCards.get(p.id)?.[0];
      if (!doorCard) continue;

      const effectiveRank = (aceHigh && doorCard.rank === Rank.Ace) ? 14 : doorCard.rank;
      const suitVal = SUIT_ORDER[doorCard.suit] || 0;

      if (effectiveRank < worstRank || (effectiveRank === worstRank && suitVal < worstSuitOrder)) {
        worstIdx = i;
        worstRank = effectiveRank;
        worstSuitOrder = suitVal;
      }
    }
    return worstIdx;
  }

  /**
   * Evaluate up-cards for first-actor determination.
   * Returns a numeric value for the showing hand.
   * Lower = acts first for Razz; Higher = acts first for Stud High.
   */
  protected getShowingHandValue(playerId: string, useLow: boolean): number {
    const showing = this.upCards.get(playerId) || [];
    if (showing.length === 0) return useLow ? Infinity : -1;

    const counts = new Map<number, number>();
    for (const card of showing) {
      const rank = useLow && card.rank === Rank.Ace ? 1 : card.rank;
      counts.set(rank, (counts.get(rank) ?? 0) + 1);
    }
    const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const pattern = groups.map(g => g[1]).join(',');
    const tier = pattern.startsWith('4') ? 4 : pattern.startsWith('3') ? 3
      : pattern.startsWith('2,2') ? 2 : pattern.startsWith('2') ? 1 : 0;
    // Categories dominate kickers; high cards are compared highest-first in both games.
    const ranks = groups.map(g => g[0]);
    while (ranks.length < 4) ranks.push(0);
    return ranks.reduce((value, rank) => value * 15 + rank, tier);
  }
}
