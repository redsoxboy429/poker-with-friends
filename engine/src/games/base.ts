// ============================================================
// Base Game Engine
// ============================================================
// Abstract base class for all poker variants.
// Implements the common game loop: deal → bet → deal → bet → showdown.
// Subclasses override dealing, hand evaluation, and phase transitions.

import { Deck } from '../deck.js';
import {
  HandState,
  PlayerState,
  GamePhase,
  PlayerAction,
  ActionType,
  TableConfig,
  Pot,
  PotResult,
  HandResult,
  LowHandResult,
  BettingStructure,
  AvailableActions,
} from '../types.js';
import { getAvailableActions, collectBets, validateAction } from '../betting.js';

/** Generate a simple unique ID */
function generateHandId(): string {
  return `hand_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * Abstract base class for poker game variants.
 * Manages the overall hand lifecycle and betting rounds.
 */
/** Winner info stored after showdown or fold-out */
export interface WinnerInfo {
  playerId: string;
  name: string;
  amount: number;         // Total pot won
  handDescription?: string; // e.g. "Full House, Kings full of Tens"
  side?: string;          // For split-pot display: 'draw', 'omaha', 'high', 'low', 'scoop'
  potLabel?: string;      // 'Main Pot', 'Side Pot 1', etc. — only set when multiple pots exist
}

export abstract class BaseGame {
  protected state: HandState;
  protected deck: Deck;
  protected config: TableConfig;
  protected _winners: WinnerInfo[] = [];

  /** Getter/setter that mirrors state.phaseStartActionIndex */
  protected get phaseStartActionIndex(): number {
    return this.state.phaseStartActionIndex;
  }
  protected set phaseStartActionIndex(value: number) {
    this.state.phaseStartActionIndex = value;
  }

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    this.config = config;
    this.deck = new Deck();

    // Apply bet cap: limit each player's effective chips for this hand
    const capAmount = config.capBB && config.bigBlind
      ? config.capBB * config.bigBlind
      : Infinity;

    this.state = {
      id: generateHandId(),
      variant: config.variant,
      bettingStructure: config.bettingStructure,
      phase: GamePhase.Waiting,
      players: players.map(p => ({
        ...p,
        holeCards: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        chips: Math.min(p.chips, capAmount),
      })),
      communityCards: [],
      pots: [],
      currentBet: 0,
      minRaise: config.smallBet ?? config.bigBlind,
      lastRaise: config.smallBet ?? config.bigBlind,
      activePlayerIndex: -1,
      buttonIndex,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      ante: config.ante,
      bringIn: config.bringIn,
      smallBet: config.smallBet ?? config.smallBlind,
      bigBet: config.bigBet ?? config.bigBlind,
      actionHistory: [],
      phaseStartActionIndex: 0,
      playersAtStreetStart: players.filter(p => !p.sittingOut).length,
    };
  }

  /** Get the current game state (read-only copy) */
  getState(): Readonly<HandState> {
    return { ...this.state };
  }

  /** Get available actions for the current player */
  getAvailableActions(): AvailableActions {
    return getAvailableActions(this.state);
  }

  /** Get winner info from the last completed hand */
  getWinners(): WinnerInfo[] {
    return [...this._winners];
  }

  /** Generate a pot label (only meaningful when multiple pots exist) */
  protected getPotLabel(potIndex: number, totalPots: number): string | undefined {
    if (totalPots <= 1) return undefined;
    if (potIndex === 0) return 'Main Pot';
    return totalPots === 2 ? 'Side Pot' : `Side Pot ${potIndex}`;
  }

  /**
   * Evaluate a player's current best hand (public, for UI display).
   * Returns null if the player doesn't have enough cards yet.
   */
  getHandDescription(playerId: string): { description: string; cards: import('../types.js').Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player || player.holeCards.length < 5) {
      // Not enough cards for a complete hand (e.g., pre-5th street in stud)
      return this.getPartialHandDescription(player);
    }
    try {
      const result = this.evaluateHand(player);
      return { description: result.description, cards: result.cards };
    } catch {
      return null;
    }
  }

  /**
   * Override in subclasses to provide partial hand info before 5 cards.
   * Default: null (no partial hand display).
   */
  protected getPartialHandDescription(player: PlayerState | undefined): { description: string; cards: import('../types.js').Card[] } | null {
    return null;
  }

  /** Start the hand: post blinds/antes, deal initial cards */
  start(): void {
    if (this.state.players.filter(p => !p.sittingOut).length < 2) {
      throw new Error('Need at least 2 active players to start a hand');
    }
    this.postForcedBets();
    this.dealInitialCards();
    this.setFirstActor();
  }

  /**
   * Process a player action. Returns true if the hand is complete.
   */
  act(playerId: string, actionType: ActionType, amount?: number): boolean {
    // Validate the action
    const validation = validateAction(this.state, playerId, actionType, amount);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const player = this.state.players[this.state.activePlayerIndex];
    const action: PlayerAction = { type: actionType, playerId, amount: validation.adjustedAmount };

    // Execute the action
    switch (actionType) {
      case ActionType.Fold:
        player.folded = true;
        break;

      case ActionType.Check:
        // Nothing to do
        break;

      case ActionType.Call: {
        const callAmt = validation.adjustedAmount!;
        player.chips -= callAmt;
        player.bet += callAmt;
        player.totalBet += callAmt;
        if (player.chips === 0) player.allIn = true;
        break;
      }

      case ActionType.Bet: {
        const betAmt = validation.adjustedAmount!;
        player.chips -= betAmt;
        player.bet += betAmt;
        player.totalBet += betAmt;
        this.state.currentBet = player.bet;
        this.state.lastRaise = betAmt;
        if (player.chips === 0) player.allIn = true;
        break;
      }

      case ActionType.Raise: {
        // amount is "raise TO" — how much the total bet becomes
        const raiseTo = validation.adjustedAmount!;
        const raiseAmount = raiseTo - player.bet;
        const raiseSize = raiseTo - this.state.currentBet;
        player.chips -= raiseAmount;
        player.bet = raiseTo;
        player.totalBet += raiseAmount;
        this.state.lastRaise = Math.max(raiseSize, this.state.lastRaise);
        this.state.currentBet = raiseTo;
        if (player.chips === 0) player.allIn = true;
        break;
      }
    }

    this.state.actionHistory.push(action);

    // Check if hand is over (only one player left)
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);
    if (activePlayers.length === 1) {
      this.awardPotToLastStanding(activePlayers[0]);
      return true;
    }

    // Advance to next actor or next phase
    if (this.isBettingRoundComplete()) {
      // Collect bets into pot(s)
      this.state.pots = collectBets(this.state.players, this.state.pots);
      this.state.currentBet = 0;
      this.state.lastRaise = this.config.smallBet ?? this.config.bigBlind;

      // Check if we should go to showdown (all but one all-in, or no more streets)
      const canAct = activePlayers.filter(p => !p.allIn);
      if (canAct.length <= 1 && activePlayers.some(p => p.allIn) && this.shouldRunoutOnAllIn()) {
        // Run out remaining board and go to showdown
        this.dealRemainingCards();
        return this.resolveShowdown();
      }

      // Advance to next phase
      const nextPhase = this.getNextPhase();
      if (nextPhase === GamePhase.Showdown) {
        return this.resolveShowdown();
      }

      this.state.phase = nextPhase;
      this.phaseStartActionIndex = this.state.actionHistory.length;
      // Track how many players are active at the start of this new street
      this.state.playersAtStreetStart = activePlayers.filter(p => !p.allIn).length;
      this.dealPhaseCards(nextPhase);
      this.setFirstActorForStreet();
    } else {
      this.advanceToNextActor();
    }

    return false;
  }

  // ============================================================
  // Abstract methods — subclasses must implement
  // ============================================================

  /** Post blinds, antes, or bring-in depending on the variant */
  protected abstract postForcedBets(): void;

  /** Deal the initial hole cards */
  protected abstract dealInitialCards(): void;

  /** Set who acts first (after initial deal) */
  protected abstract setFirstActor(): void;

  /** Set who acts first on subsequent streets */
  protected abstract setFirstActorForStreet(): void;

  /** Get the next phase after the current betting round */
  protected abstract getNextPhase(): GamePhase;

  /** Deal cards for a new phase (flop, turn, river, or stud streets) */
  protected abstract dealPhaseCards(phase: GamePhase): void;

  /** Deal remaining cards when going to showdown early (all-in) */
  protected abstract dealRemainingCards(): void;

  /**
   * Whether to skip directly to showdown when all players are all-in.
   * Returns true by default (correct for flop/stud games that deal community/board cards).
   * Draw games override this to return false — players still need their draw rounds,
   * even if some/all are all-in (all-in players simply stand pat).
   */
  protected shouldRunoutOnAllIn(): boolean {
    return true;
  }

  /** Evaluate a player's hand at showdown. Returns high hand result. */
  protected abstract evaluateHand(player: PlayerState): HandResult;

  /**
   * Optional: evaluate a player's low hand at showdown (for hi-lo games).
   * Returns null if the player doesn't qualify for low.
   * Subclasses override this to enable hi-lo split pot logic.
   * When this returns non-null for any player, resolveShowdown() will
   * automatically split each pot 50/50 between best high and best low.
   */
  protected evaluateLowHand(player: PlayerState): LowHandResult | null {
    return null; // Default: no low hand (high-only game)
  }

  // ============================================================
  // Common logic
  // ============================================================

  /**
   * Check if the current betting round is complete.
   * Complete when: action has come back to the last aggressor (or around the table).
   */
  protected isBettingRoundComplete(): boolean {
    const active = this.state.players.filter(p => !p.folded && !p.sittingOut && !p.allIn);

    // If no one can act, round is over
    if (active.length === 0) return true;

    // Everyone still in has either matched the current bet or is all-in
    const allMatched = active.every(p => p.bet === this.state.currentBet);
    if (!allMatched) return false;

    // Need at least one full orbit of checks, or action back to aggressor
    // Simple approach: everyone who can act has had a chance to act this round
    // We track this by checking if we've gone around the table
    const idx = this.state.activePlayerIndex;
    const nextActor = this.findNextActivePlayer(idx);
    if (nextActor === -1) return true;

    // The round is complete if the next actor has already matched the bet
    // and has already acted this round (their bet equals the current bet)
    const next = this.state.players[nextActor];
    return next.bet === this.state.currentBet && this.hasActedThisRound(next.id);
  }

  /** Check if a player has already acted in the current betting round */
  protected hasActedThisRound(playerId: string): boolean {
    // Only look at actions from the current phase (after phaseStartActionIndex)
    for (let i = this.state.actionHistory.length - 1; i >= this.phaseStartActionIndex; i--) {
      const action = this.state.actionHistory[i];
      if (action.playerId === playerId &&
          action.type !== ActionType.PostBlind &&
          action.type !== ActionType.PostAnte) {
        // BringIn counts as "acted" UNLESS someone completed/raised above it.
        // If currentBet is still at the bring-in amount, the bring-in player
        // does NOT get an option — the round ends. If someone completed,
        // currentBet > bringIn, so the BringIn doesn't count and they get to act.
        if (action.type === ActionType.BringIn) {
          return this.state.currentBet <= (this.config.bringIn || 0);
        }
        return true;
      }
    }
    return false;
  }

  /** Find the next player who can act */
  protected findNextActivePlayer(fromIndex: number): number {
    const n = this.state.players.length;
    for (let i = 1; i < n; i++) {
      const idx = (fromIndex + i) % n;
      const p = this.state.players[idx];
      if (!p.folded && !p.allIn && !p.sittingOut) {
        return idx;
      }
    }
    return -1;
  }

  /** Advance activePlayerIndex to the next player who can act */
  protected advanceToNextActor(): void {
    const next = this.findNextActivePlayer(this.state.activePlayerIndex);
    if (next === -1) {
      // No one can act — shouldn't happen if we check isBettingRoundComplete first
      return;
    }
    this.state.activePlayerIndex = next;
  }

  /** Award all pots to the last remaining player (everyone else folded) */
  protected awardPotToLastStanding(winner: PlayerState): void {
    // Calculate total pot BEFORE collectBets (which returns single-eligible pots to player)
    const outstandingBets = this.state.players.reduce((sum, p) => sum + p.bet, 0);
    const existingPots = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    const totalWon = outstandingBets + existingPots;

    // Collect bets (returns excess to winner since they're the only eligible player)
    this.state.pots = collectBets(this.state.players, this.state.pots);

    // Award any remaining pots
    const remainingPots = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
    winner.chips += remainingPots;

    // Record winner with the full pot amount (no hand description — won by fold)
    this._winners = [{ playerId: winner.id, name: winner.name, amount: totalWon }];

    // Keep pots for display (chips already distributed above).
    // For fold wins, collectBets may have returned all pots to the winner (single eligible),
    // so reconstruct a display pot with the full amount.
    if (this.state.pots.length === 0 && totalWon > 0) {
      this.state.pots = [{ amount: totalWon, eligiblePlayerIds: [winner.id] }];
    }
    this.state.phase = GamePhase.Complete;
  }

  // ============================================================
  // Showdown resolution — template method pattern
  // ============================================================

  /**
   * Merge pots where the set of active (non-folded) contenders is identical.
   * Called at showdown so that pots accumulated across betting rounds with
   * the same effective contenders collapse into one (no phantom side pots).
   */
  protected mergePotsForShowdown(activePlayers: PlayerState[]): void {
    const activeIds = new Set(activePlayers.map(p => p.id));
    const merged: Pot[] = [];

    for (const pot of this.state.pots) {
      // Effective contenders = eligible AND still active (not folded)
      const effectiveIds = pot.eligiblePlayerIds.filter(id => activeIds.has(id)).sort();
      const effectiveKey = effectiveIds.join(',');

      const match = merged.find(m => {
        const mIds = m.eligiblePlayerIds.filter(id => activeIds.has(id)).sort();
        return mIds.join(',') === effectiveKey;
      });

      if (match) {
        match.amount += pot.amount;
        // Keep the broader eligible set (preserves the original eligibility)
        for (const id of pot.eligiblePlayerIds) {
          if (!match.eligiblePlayerIds.includes(id)) {
            match.eligiblePlayerIds.push(id);
          }
        }
      } else {
        merged.push({ amount: pot.amount, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
      }
    }

    this.state.pots = merged;
  }

  /** Resolve showdown: evaluate hands and distribute pots */
  protected resolveShowdown(): boolean {
    // Collect any outstanding bets and merge pots with identical active contenders
    this.state.pots = collectBets(this.state.players, this.state.pots);
    this.state.phase = GamePhase.Showdown;

    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);
    this.mergePotsForShowdown(activePlayers);

    const isHiLo = this.isHiLoGame();
    const hasHighQualifier = this.hasHighQualifier();
    const totalPots = this.state.pots.length;

    // Unified win entries with side + potLabel
    const winEntries: Array<{ player: PlayerState; amount: number; description: string; side: string; potLabel?: string }> = [];

    for (let pi = 0; pi < this.state.pots.length; pi++) {
      const pot = this.state.pots[pi];
      const potLabel = this.getPotLabel(pi, totalPots);
      const contenders = activePlayers.filter(p => pot.eligiblePlayerIds.includes(p.id));
      if (contenders.length === 0) continue;

      // Single contender takes the whole pot
      if (contenders.length === 1) {
        contenders[0].chips += pot.amount;
        winEntries.push({ player: contenders[0], amount: pot.amount, description: '', side: 'scoop', potLabel });
        continue;
      }

      // Callback to add entries with pot label
      const addEntry = (player: PlayerState, amount: number, description: string, side: string) => {
        winEntries.push({ player, amount, description, side, potLabel });
      };

      if (isHiLo && hasHighQualifier) {
        this.resolveQualifiedHiLoPot(pot, contenders, addEntry);
      } else if (isHiLo) {
        this.resolveHiLoPot(pot, contenders, addEntry);
      } else {
        this.resolveHighOnlyPot(pot, contenders, addEntry);
      }
    }

    this._winners = winEntries.map(w => ({
      playerId: w.player.id,
      name: w.player.name,
      amount: w.amount,
      handDescription: w.description,
      side: w.side,
      potLabel: w.potLabel,
    }));

    // Keep pots for display (chips already distributed to winners above).
    // Pots reset on next startHand().
    this.state.phase = GamePhase.Complete;
    return true;
  }

  /**
   * Whether this game uses hi-lo split pots.
   * Subclasses override to return true to enable split pot showdowns.
   */
  protected isHiLoGame(): boolean {
    return false;
  }

  /**
   * Whether the high side has a qualifier (e.g., Archie requires pair of 9s+).
   * When true, evaluateHand returns value=0 for non-qualifying hands,
   * and the qualified hi-lo logic handles the four-way split:
   *   - Both qualify → split 50/50
   *   - Only high qualifies → high scoops
   *   - Only low qualifies → low scoops
   *   - Neither qualifies → chop among all contenders
   */
  protected hasHighQualifier(): boolean {
    return false;
  }

  /** Resolve a pot using high-hand-only logic */
  private resolveHighOnlyPot(
    pot: Pot,
    contenders: PlayerState[],
    addEntry: (player: PlayerState, amount: number, description: string, side: string) => void,
  ): void {
    const evaluated = contenders.map(p => ({
      player: p,
      hand: this.evaluateHand(p),
    }));

    const bestValue = Math.max(...evaluated.map(e => e.hand.value));
    const winners = evaluated.filter(e => e.hand.value === bestValue);

    const winnerPlayers = winners.map(e => e.player);
    const amounts = this.divideAmongWinners(pot.amount, winnerPlayers);

    for (let i = 0; i < winners.length; i++) {
      winners[i].player.chips += amounts[i];
      addEntry(winners[i].player, amounts[i], winners[i].hand.description, 'scoop');
    }
  }

  /**
   * Resolve a pot using standard hi-lo split logic (no high qualifier).
   * If no qualifying low, high scoops. Otherwise split 50/50.
   */
  private resolveHiLoPot(
    pot: Pot,
    contenders: PlayerState[],
    addEntry: (player: PlayerState, amount: number, description: string, side: string) => void,
  ): void {
    const highEval = contenders.map(p => ({ player: p, hand: this.evaluateHand(p) }));
    const bestHighValue = Math.max(...highEval.map(e => e.hand.value));
    const highWinners = highEval.filter(e => e.hand.value === bestHighValue);

    const lowEval = contenders
      .map(p => ({ player: p, hand: this.evaluateLowHand(p) }))
      .filter((e): e is { player: PlayerState; hand: LowHandResult } =>
        e.hand !== null && e.hand.qualified,
      );

    if (lowEval.length === 0) {
      // No qualifying low — high scoops
      const amounts = this.divideAmongWinners(pot.amount, highWinners.map(e => e.player));
      for (let i = 0; i < highWinners.length; i++) {
        highWinners[i].player.chips += amounts[i];
        addEntry(highWinners[i].player, amounts[i], highWinners[i].hand.description + ' (scoops)', 'scoop');
      }
      return;
    }

    // Split 50/50. Odd chip to high side.
    const [highHalf, lowHalf] = this.splitPotHalves(pot.amount);

    const highAmounts = this.divideAmongWinners(highHalf, highWinners.map(e => e.player));
    for (let i = 0; i < highWinners.length; i++) {
      highWinners[i].player.chips += highAmounts[i];
      addEntry(highWinners[i].player, highAmounts[i], highWinners[i].hand.description + ' (high)', 'high');
    }

    const bestLowValue = Math.min(...lowEval.map(e => e.hand.value));
    const lowWinners = lowEval.filter(e => e.hand.value === bestLowValue);
    const lowAmounts = this.divideAmongWinners(lowHalf, lowWinners.map(e => e.player));
    for (let i = 0; i < lowWinners.length; i++) {
      lowWinners[i].player.chips += lowAmounts[i];
      addEntry(lowWinners[i].player, lowAmounts[i], lowWinners[i].hand.description + ' (low)', 'low');
    }
  }

  /**
   * Resolve a pot using qualified hi-lo logic (both sides have qualifiers).
   * Four-branch: both qualify → split, high only → high scoops,
   * low only → low scoops, neither → chop among all contenders.
   * Used by Archie (pair-of-9s+ high qualifier) and 10-30 (pip qualifiers).
   */
  private resolveQualifiedHiLoPot(
    pot: Pot,
    contenders: PlayerState[],
    addEntry: (player: PlayerState, amount: number, description: string, side: string) => void,
  ): void {
    const highEval = contenders.map(p => ({ player: p, hand: this.evaluateHand(p) }));
    const highQualifiers = highEval.filter(e => e.hand.value > 0);

    const lowEval = contenders
      .map(p => ({ player: p, hand: this.evaluateLowHand(p) }))
      .filter((e): e is { player: PlayerState; hand: LowHandResult } => e.hand !== null);
    const lowQualifiers = lowEval.filter(e => e.hand.qualified);

    const hasHigh = highQualifiers.length > 0;
    const hasLow = lowQualifiers.length > 0;

    if (!hasHigh && !hasLow) {
      // Neither qualifies: chop among all contenders
      const amounts = this.divideAmongWinners(pot.amount, contenders);
      for (let i = 0; i < contenders.length; i++) {
        contenders[i].chips += amounts[i];
        addEntry(contenders[i], amounts[i], 'chop (no qualifier)', 'scoop');
      }
    } else if (hasHigh && !hasLow) {
      // High scoops
      const bestVal = Math.max(...highQualifiers.map(e => e.hand.value));
      const winners = highQualifiers.filter(e => e.hand.value === bestVal);
      const amounts = this.divideAmongWinners(pot.amount, winners.map(e => e.player));
      for (let i = 0; i < winners.length; i++) {
        winners[i].player.chips += amounts[i];
        addEntry(winners[i].player, amounts[i], winners[i].hand.description + ' (scoops)', 'scoop');
      }
    } else if (!hasHigh && hasLow) {
      // Low scoops
      const bestVal = Math.min(...lowQualifiers.map(e => e.hand.value));
      const winners = lowQualifiers.filter(e => e.hand.value === bestVal);
      const amounts = this.divideAmongWinners(pot.amount, winners.map(e => e.player));
      for (let i = 0; i < winners.length; i++) {
        winners[i].player.chips += amounts[i];
        addEntry(winners[i].player, amounts[i], winners[i].hand.description + ' (scoops)', 'scoop');
      }
    } else {
      // Both qualify: split 50/50
      const [highHalf, lowHalf] = this.splitPotHalves(pot.amount);

      const bestHighVal = Math.max(...highQualifiers.map(e => e.hand.value));
      const highWinners = highQualifiers.filter(e => e.hand.value === bestHighVal);
      const highAmounts = this.divideAmongWinners(highHalf, highWinners.map(e => e.player));
      for (let i = 0; i < highWinners.length; i++) {
        highWinners[i].player.chips += highAmounts[i];
        addEntry(highWinners[i].player, highAmounts[i], highWinners[i].hand.description + ' (high)', 'high');
      }

      const bestLowVal = Math.min(...lowQualifiers.map(e => e.hand.value));
      const lowWinners = lowQualifiers.filter(e => e.hand.value === bestLowVal);
      const lowAmounts = this.divideAmongWinners(lowHalf, lowWinners.map(e => e.player));
      for (let i = 0; i < lowWinners.length; i++) {
        lowWinners[i].player.chips += lowAmounts[i];
        addEntry(lowWinners[i].player, lowAmounts[i], lowWinners[i].hand.description + ' (low)', 'low');
      }
    }
  }

  // ============================================================
  // Helpers for position math
  // ============================================================

  /** Get seat index for small blind (1 left of button, or button in heads-up) */
  protected getSmallBlindIndex(): number {
    const active = this.state.players.filter(p => !p.sittingOut);
    if (active.length === 2) {
      // Heads-up: button IS the small blind
      return this.state.buttonIndex;
    }
    return this.findNextActiveFrom(this.state.buttonIndex);
  }

  /** Get seat index for big blind (2 left of button, or non-button in heads-up) */
  protected getBigBlindIndex(): number {
    const sb = this.getSmallBlindIndex();
    return this.findNextActiveFrom(sb);
  }

  /** Find the next non-sitting-out player from a given index */
  protected findNextActiveFrom(fromIndex: number): number {
    const n = this.state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIndex + i) % n;
      if (!this.state.players[idx].sittingOut) {
        return idx;
      }
    }
    return fromIndex;
  }

  // ============================================================
  // Split-pot helpers (used by hi-lo, Drawmaha, Archie, etc.)
  // ============================================================

  /**
   * Get the minimum chip denomination for splitting pots.
   * Uses smallBlind for big-bet games, or smallest non-zero forced bet.
   */
  protected getMinChipDenomination(): number {
    if (this.config.smallBlind > 0) return this.config.smallBlind;
    if (this.config.ante > 0) return this.config.ante;
    return 1; // fallback
  }

  /**
   * Split a pot amount into two halves, using minChip as the smallest denomination.
   * Returns [firstHalf, secondHalf] where firstHalf gets the odd chip.
   */
  protected splitPotHalves(amount: number): [number, number] {
    const minChip = this.getMinChipDenomination();
    // How many minimum chips in the pot
    const units = Math.round(amount / minChip);
    const firstUnits = Math.ceil(units / 2);
    const secondUnits = units - firstUnits;
    return [firstUnits * minChip, secondUnits * minChip];
  }

  /**
   * Given a list of winners (PlayerState[]), return them sorted by position
   * from most OOP (first left of button) to most IP (closest to button).
   * The first player in the returned array is the most out-of-position.
   */
  protected sortByOOP(players: PlayerState[]): PlayerState[] {
    const n = this.state.players.length;
    const btnIdx = this.state.buttonIndex;

    // Compute distance from button going clockwise (left of button = 1, etc.)
    const getDistance = (p: PlayerState): number => {
      const seatIdx = this.state.players.indexOf(p);
      return ((seatIdx - btnIdx + n) % n) || n; // button itself gets distance n (most IP)
    };

    return [...players].sort((a, b) => getDistance(a) - getDistance(b));
  }

  /**
   * Divide an amount among N winners using minChip denomination.
   * Odd chip(s) go to OOP players (sorted by position, most OOP first).
   * Returns array of amounts in the same order as the input winners array.
   */
  protected divideAmongWinners(amount: number, winners: PlayerState[]): number[] {
    if (winners.length === 1) return [amount];

    const minChip = this.getMinChipDenomination();
    const units = Math.round(amount / minChip);
    const baseUnits = Math.floor(units / winners.length);
    let remainderUnits = units - baseUnits * winners.length;

    // Sort winners by OOP to assign remainder chips
    const sorted = this.sortByOOP(winners);
    const amounts = new Map<PlayerState, number>();

    for (const w of sorted) {
      let chips = baseUnits;
      if (remainderUnits > 0) {
        chips += 1;
        remainderUnits--;
      }
      amounts.set(w, chips * minChip);
    }

    // Return in original order
    return winners.map(w => amounts.get(w)!);
  }
}
