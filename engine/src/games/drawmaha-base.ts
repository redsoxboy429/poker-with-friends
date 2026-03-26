// ============================================================
// Base Drawmaha Game Engine
// ============================================================
// Hybrid game combining draw and community-card poker:
// - 5 hole cards per player
// - Community board (flop/turn/river with burns, like Omaha)
// - Single draw phase
// - Draw timing differs by betting structure:
//   - Pot-limit: preflop → flop → draw → betting → turn → river → showdown
//   - Limit: preflop → flop → betting → draw → turn → river → showdown
// - Split pot: best draw-hand + best Omaha-hand (2+3 rule)
//
// Subclasses implement:
// - evaluateDrawHand(): hand evaluation for the draw side
// - evaluateOmahaHand(): hand evaluation for the Omaha side (2+3 rule)

import { BaseGame } from './base.js';
import {
  GamePhase,
  ActionType,
  PlayerState,
  TableConfig,
  BettingStructure,
  HandResult,
  Card,
} from '../types.js';
import { collectBets } from '../betting.js';

/**
 * Abstract base class for Drawmaha (draw + Omaha community card hybrid) variants.
 * Manages hybrid dealing, draw timing (varies by betting structure),
 * and split-pot showdown logic (draw side vs Omaha side).
 */
export abstract class BaseDrawmahaGame extends BaseGame {
  private isPotLimit: boolean;
  private drawCompleted: boolean = false;

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super(config, players, buttonIndex);
    this.isPotLimit = config.bettingStructure === BettingStructure.PotLimit;
  }

  // ============================================================
  // Abstract methods for variant-specific evaluation
  // ============================================================

  /**
   * Evaluate the draw-side hand (5 cards, variant-specific rules).
   * Examples: 5-card high, 2-7 low, A-5 low, 49 pips, etc.
   */
  protected abstract evaluateDrawHand(player: PlayerState): HandResult;

  /**
   * Evaluate the Omaha-side hand (must use exactly 2 hole + 3 board, high only).
   * boardCards are the community cards available.
   */
  protected abstract evaluateOmahaHand(player: PlayerState, boardCards: Card[]): HandResult;

  /**
   * evaluateHand is required by BaseGame. We use the draw-side evaluation.
   * (This is only for display/fallback; actual showdown uses custom logic.)
   */
  protected evaluateHand(player: PlayerState): HandResult {
    return this.evaluateDrawHand(player);
  }

  // ============================================================
  // Implement BaseGame abstract methods
  // ============================================================

  protected postForcedBets(): void {
    // Post small blind (left of button)
    const sbIndex = this.getSmallBlindIndex();
    const sbPlayer = this.state.players[sbIndex];
    const sbAmount = Math.min(this.config.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmount;
    sbPlayer.bet += sbAmount;
    sbPlayer.totalBet += sbAmount;
    if (sbPlayer.chips === 0) sbPlayer.allIn = true;
    this.state.actionHistory.push({
      type: ActionType.PostBlind,
      playerId: sbPlayer.id,
      amount: sbAmount,
    });

    // Post big blind (left of small blind)
    const bbIndex = this.getBigBlindIndex();
    const bbPlayer = this.state.players[bbIndex];
    const bbAmount = Math.min(this.config.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmount;
    bbPlayer.bet += bbAmount;
    bbPlayer.totalBet += bbAmount;
    if (bbPlayer.chips === 0) bbPlayer.allIn = true;
    this.state.actionHistory.push({
      type: ActionType.PostBlind,
      playerId: bbPlayer.id,
      amount: bbAmount,
    });

    this.state.currentBet = this.config.bigBlind;
    this.state.phase = GamePhase.BettingPreflop;
    this.phaseStartActionIndex = this.state.actionHistory.length;
  }

  protected dealInitialCards(): void {
    // Deal 5 hole cards to each player
    const startIdx = this.findNextActiveFrom(this.state.buttonIndex);
    const n = this.state.players.length;

    for (let round = 0; round < 5; round++) {
      let idx = startIdx;
      for (let i = 0; i < n; i++) {
        const player = this.state.players[idx];
        if (!player.sittingOut) {
          player.holeCards.push(this.deck.deal());
        }
        idx = (idx + 1) % n;
      }
    }
  }

  protected setFirstActor(): void {
    // Preflop: first to act is left of BB
    const bbIndex = this.getBigBlindIndex();
    const firstActor = this.findNextActivePlayer(bbIndex);
    this.state.activePlayerIndex = firstActor !== -1 ? firstActor : bbIndex;
  }

  protected setFirstActorForStreet(): void {
    // Post-flop and post-draw: first to act is left of button
    const firstActor = this.findNextActivePlayer(this.state.buttonIndex);
    if (firstActor !== -1) {
      this.state.activePlayerIndex = firstActor;
    }
  }

  protected getNextPhase(): GamePhase {
    if (this.isPotLimit) {
      // PL: preflop → (flop dealt) → draw → flop betting → turn → river → showdown
      switch (this.state.phase) {
        case GamePhase.BettingPreflop:
          return GamePhase.Drawing1; // Flop will be dealt in dealPhaseCards
        case GamePhase.Drawing1:
          return GamePhase.BettingFlop;
        case GamePhase.BettingFlop:
          return GamePhase.BettingTurn;
        case GamePhase.BettingTurn:
          return GamePhase.BettingRiver;
        case GamePhase.BettingRiver:
          return GamePhase.Showdown;
        default:
          return GamePhase.Showdown;
      }
    } else {
      // Limit: preflop → flop betting → draw → turn → river → showdown
      switch (this.state.phase) {
        case GamePhase.BettingPreflop:
          return GamePhase.BettingFlop;
        case GamePhase.BettingFlop:
          return GamePhase.Drawing1;
        case GamePhase.Drawing1:
          return GamePhase.BettingTurn;
        case GamePhase.BettingTurn:
          return GamePhase.BettingRiver;
        case GamePhase.BettingRiver:
          return GamePhase.Showdown;
        default:
          return GamePhase.Showdown;
      }
    }
  }

  protected dealPhaseCards(phase: GamePhase): void {
    switch (phase) {
      case GamePhase.Drawing1:
        // In PL: flop is dealt when entering the draw phase (before draw starts)
        if (this.isPotLimit && this.state.communityCards.length === 0) {
          this.deck.burn();
          this.state.communityCards.push(...this.deck.dealMany(3));
        }
        // In Limit: flop was already dealt when entering BettingFlop
        break;

      case GamePhase.BettingFlop:
        // In Limit: deal flop when entering flop betting
        if (!this.isPotLimit && this.state.communityCards.length === 0) {
          this.deck.burn();
          this.state.communityCards.push(...this.deck.dealMany(3));
        }
        // In PL: flop already dealt before drawing phase
        break;

      case GamePhase.BettingTurn:
        // Deal turn after draw phase completes (or before, if no draw phase happened)
        this.deck.burn();
        this.state.communityCards.push(this.deck.deal());
        break;

      case GamePhase.BettingRiver:
        // Deal river
        this.deck.burn();
        this.state.communityCards.push(this.deck.deal());
        break;
    }
  }

  protected dealRemainingCards(): void {
    // For all-in scenarios: deal remaining community cards
    while (this.state.communityCards.length < 5) {
      this.deck.burn();
      if (this.state.communityCards.length === 0) {
        this.state.communityCards.push(...this.deck.dealMany(3));
      } else {
        this.state.communityCards.push(this.deck.deal());
      }
    }
  }

  // ============================================================
  // Draw-specific logic (single draw during hand)
  // ============================================================

  /**
   * Process a discard action during Drawing1 phase.
   * cardIndices: which indices of holeCards to discard (empty = stand pat).
   * Returns true if the hand is complete.
   */
  discard(playerId: string, cardIndices: number[]): boolean {
    if (this.state.phase !== GamePhase.Drawing1) {
      throw new Error(`Cannot discard during phase ${this.state.phase}`);
    }

    const player = this.state.players[this.state.activePlayerIndex];
    if (!player || player.id !== playerId) {
      throw new Error('Not your turn to draw');
    }
    if (player.folded || player.sittingOut) {
      throw new Error('Player cannot draw (folded or sitting out)');
    }

    // Validate card indices
    for (const idx of cardIndices) {
      if (idx < 0 || idx >= player.holeCards.length) {
        throw new Error(`Invalid card index: ${idx}`);
      }
    }

    // Record the action
    const actionType = cardIndices.length === 0 ? ActionType.StandPat : ActionType.Discard;
    this.state.actionHistory.push({
      type: actionType,
      playerId,
      discardIndices: cardIndices.length > 0 ? cardIndices : undefined,
    });

    // Remove discarded cards (reverse order to avoid index shifting)
    const sortedIndices = [...cardIndices].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      player.holeCards.splice(idx, 1);
    }

    // Deal replacements
    for (let i = 0; i < cardIndices.length; i++) {
      player.holeCards.push(this.deck.deal());
    }

    // Find next drawer
    const nextDrawer = this.findNextActivePlayer(this.state.activePlayerIndex);
    const allDrawn = nextDrawer === -1 || this.hasDrawnThisRound(this.state.players[nextDrawer].id);

    if (allDrawn) {
      // All have drawn — transition to next phase
      this.drawCompleted = true;
      const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);

      if (this.isPotLimit) {
        // PL: draw was after flop deal, now go to flop betting
        this.state.phase = GamePhase.BettingFlop;
      } else {
        // Limit: draw was after flop betting, now deal turn and go to turn betting
        this.state.phase = GamePhase.BettingTurn;
        this.deck.burn();
        this.state.communityCards.push(this.deck.deal());
      }

      this.phaseStartActionIndex = this.state.actionHistory.length;
      this.state.playersAtStreetStart = activePlayers.filter(p => !p.allIn).length;
      this.setFirstActorForStreet();

      // Check if only one player can act
      const canAct = activePlayers.filter(p => !p.allIn);
      if (canAct.length <= 1 && activePlayers.some(p => p.allIn)) {
        this.dealRemainingCards();
        return this.resolveShowdown();
      }

      return false;
    }

    // More players to draw
    this.state.activePlayerIndex = nextDrawer;
    return false;
  }

  /**
   * Check if a player has drawn in the current drawing round.
   */
  private hasDrawnThisRound(playerId: string): boolean {
    for (let i = this.state.actionHistory.length - 1; i >= this.phaseStartActionIndex; i--) {
      const action = this.state.actionHistory[i];
      if (
        action.playerId === playerId &&
        (action.type === ActionType.Discard || action.type === ActionType.StandPat)
      ) {
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // Custom showdown: split between draw side and Omaha side
  // ============================================================

  /**
   * Override BaseGame's resolveShowdown to implement custom split-pot logic.
   * Split each pot 50/50 between best draw hand and best Omaha hand.
   */
  protected override resolveShowdown(): boolean {
    this.state.pots = collectBets(this.state.players, this.state.pots);
    this.state.phase = GamePhase.Showdown;

    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut);
    this.mergePotsForShowdown(activePlayers);
    const totalPots = this.state.pots.length;
    // Track wins as separate entries per side (draw vs omaha) so quartered pots display correctly
    const winEntries: Array<{ player: PlayerState; amount: number; description: string; side: string; potLabel?: string }> = [];

    for (let pi = 0; pi < this.state.pots.length; pi++) {
      const pot = this.state.pots[pi];
      const potLabel = this.getPotLabel(pi, totalPots);
      const contenders = activePlayers.filter(p => pot.eligiblePlayerIds.includes(p.id));
      if (contenders.length === 0) continue;

      // If only one contender, they take the whole pot
      if (contenders.length === 1) {
        contenders[0].chips += pot.amount;
        winEntries.push({ player: contenders[0], amount: pot.amount, description: '', side: 'scoop', potLabel });
        continue;
      }

      // Evaluate draw hands (higher value = better)
      const drawEval = contenders.map(p => ({
        player: p,
        hand: this.evaluateDrawHand(p),
      }));
      const bestDrawValue = Math.max(...drawEval.map(e => e.hand.value));
      const drawWinners = drawEval.filter(e => e.hand.value === bestDrawValue);

      // Evaluate Omaha hands (higher value = better)
      const omahaEval = contenders.map(p => ({
        player: p,
        hand: this.evaluateOmahaHand(p, this.state.communityCards),
      }));
      const bestOmahaValue = Math.max(...omahaEval.map(e => e.hand.value));
      const omahaWinners = omahaEval.filter(e => e.hand.value === bestOmahaValue);

      // Split pot 50/50 using proper chip denomination
      const [drawHalf, omahaHalf] = this.splitPotHalves(pot.amount);

      // Award draw half to draw winners (OOP gets odd chip)
      const drawPlayers = drawWinners.map(e => e.player);
      const drawAmounts = this.divideAmongWinners(drawHalf, drawPlayers);
      for (let i = 0; i < drawWinners.length; i++) {
        drawWinners[i].player.chips += drawAmounts[i];
        winEntries.push({
          player: drawWinners[i].player,
          amount: drawAmounts[i],
          description: drawWinners[i].hand.description + ' (draw)',
          side: 'draw',
          potLabel,
        });
      }

      // Award Omaha half to Omaha winners (OOP gets odd chip)
      const omahaPlayers = omahaWinners.map(e => e.player);
      const omahaAmounts = this.divideAmongWinners(omahaHalf, omahaPlayers);
      for (let i = 0; i < omahaWinners.length; i++) {
        omahaWinners[i].player.chips += omahaAmounts[i];
        winEntries.push({
          player: omahaWinners[i].player,
          amount: omahaAmounts[i],
          description: omahaWinners[i].hand.description + ' (omaha)',
          side: 'omaha',
          potLabel,
        });
      }
    }

    // Build public winners list — keep separate entries per side
    // so quartered pots show "Player wins X (draw)" and "Player wins Y (omaha)" separately
    this._winners = winEntries.map(w => ({
      playerId: w.player.id,
      name: w.player.name,
      amount: w.amount,
      handDescription: w.description,
      side: w.side,
      potLabel: w.potLabel,
    }));

    this.state.pots = [];
    this.state.phase = GamePhase.Complete;
    return true;
  }

  /**
   * Get hand description for a player (shows both draw and Omaha evaluations).
   */
  getHandDescription(playerId: string): { description: string; cards: Card[] } | null {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return null;

    if (this.state.communityCards.length >= 3 && player.holeCards.length >= 5) {
      try {
        const draw = this.evaluateDrawHand(player);
        const omaha = this.evaluateOmahaHand(player, this.state.communityCards);
        return {
          description: `${draw.description} / ${omaha.description}`,
          cards: draw.cards,
        };
      } catch {
        return null;
      }
    }
    return null;
  }
}
