// ============================================================
// Base Draw Game Engine
// ============================================================
// Shared infrastructure for all draw poker variants (single draw,
// triple draw, etc.). Handles: initial deal, multi-round drawing,
// discard/replacement logic, and draw phase transitions.
//
// Subclasses only need to implement:
// - evaluateHand(): hand ranking (2-7 low, etc.)
// - getInitialCardCount(): how many cards per player (usually 5)
// - getMaxDraws(): how many draws are available

import { BaseGame } from './base.js';
import {
  GamePhase,
  ActionType,
  PlayerState,
  TableConfig,
  BettingStructure,
  HandResult,
} from '../types.js';
import { collectBets } from '../betting.js';

/**
 * Abstract base class for draw poker variants.
 * Manages: blinds, initial deal, multi-round draw phases, discard/replacement,
 * and phase transitions between betting and drawing.
 */
export abstract class BaseDrawGame extends BaseGame {
  private maxDraws: number;       // How many draws are allowed (1, 3, etc.)
  private currentDrawIndex: number = 0; // Which draw we're currently in (0-indexed)

  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number, maxDraws: number) {
    super(config, players, buttonIndex);
    this.maxDraws = maxDraws;
  }

  /** How many cards each player gets initially (5 for standard draw) */
  protected getInitialCardCount(): number {
    return 5;
  }

  /** Get the maximum number of draws */
  protected getMaxDraws(): number {
    return this.maxDraws;
  }

  // ============================================================
  // Implement BaseGame abstract methods
  // ============================================================

  protected postForcedBets(): void {
    // Post antes if configured (dead money into the pot)
    if (this.config.ante > 0) {
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

      // Antes go directly into the pot
      if (totalAntes > 0) {
        this.state.pots.push({ amount: totalAntes, eligiblePlayerIds: eligibleIds });
      }
    }

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
    this.state.drawsRemaining = this.maxDraws;
    this.phaseStartActionIndex = this.state.actionHistory.length;
  }

  protected dealInitialCards(): void {
    // Deal cards one round per player
    const cardCount = this.getInitialCardCount();
    const startIdx = this.findNextActiveFrom(this.state.buttonIndex);
    const n = this.state.players.length;

    for (let round = 0; round < cardCount; round++) {
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
    // Pre-draw: first to act is left of BB (same as Hold'em)
    const bbIndex = this.getBigBlindIndex();
    const firstActor = this.findNextActivePlayer(bbIndex);
    this.state.activePlayerIndex = firstActor !== -1 ? firstActor : bbIndex;
  }

  protected setFirstActorForStreet(): void {
    // For both post-draw betting and drawing phases: first to act is left of button
    const firstActor = this.findNextActivePlayer(this.state.buttonIndex);
    if (firstActor !== -1) {
      this.state.activePlayerIndex = firstActor;
    }
  }

  protected getNextPhase(): GamePhase {
    // Transition from betting to drawing and back to betting
    switch (this.state.phase) {
      case GamePhase.BettingPreflop:
        return GamePhase.Drawing1;
      case GamePhase.BettingPostDraw1:
        if (this.maxDraws >= 2) return GamePhase.Drawing2;
        return GamePhase.Showdown;
      case GamePhase.BettingPostDraw2:
        if (this.maxDraws >= 3) return GamePhase.Drawing3;
        return GamePhase.Showdown;
      case GamePhase.BettingPostDraw3:
        return GamePhase.Showdown;
      default:
        return GamePhase.Showdown;
    }
  }

  protected dealPhaseCards(_phase: GamePhase): void {
    // Draw games don't deal community cards during draw phases.
    // Drawing is handled by the discard() method.
    // This method is called by the base act() when entering a draw phase,
    // but there's nothing to do here.
  }

  protected dealRemainingCards(): void {
    // In draw games when all-in, remaining draws are skipped.
    // No community cards to deal, so nothing to do.
  }

  /** Override the abstract hand evaluation hook (subclasses implement this) */
  protected abstract evaluateHand(player: PlayerState): HandResult;

  // ============================================================
  // Draw-specific logic
  // ============================================================

  /**
   * Process a discard action during a drawing phase.
   * cardIndices: which indices of holeCards to discard and replace (empty = stand pat).
   * Returns true if the hand is complete.
   */
  discard(playerId: string, cardIndices: number[]): boolean {
    // Validate we're in a drawing phase
    const drawPhases = [GamePhase.Drawing1, GamePhase.Drawing2, GamePhase.Drawing3];
    if (!drawPhases.includes(this.state.phase)) {
      throw new Error(`Cannot discard during phase ${this.state.phase}`);
    }

    const player = this.state.players[this.state.activePlayerIndex];
    if (!player || player.id !== playerId) {
      throw new Error('Not your turn to draw');
    }
    if (player.folded || player.sittingOut) {
      throw new Error('Player cannot draw (folded or sitting out)');
    }

    // Validate card indices are in range
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

    // Remove discarded cards (in reverse order to avoid index shifting)
    const sortedIndices = [...cardIndices].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      player.holeCards.splice(idx, 1);
    }

    // Deal replacement cards
    for (let i = 0; i < cardIndices.length; i++) {
      player.holeCards.push(this.deck.deal());
    }

    // Find the next player who needs to draw
    const activePlayers = this.state.players.filter(p => !p.folded && !p.sittingOut && !p.allIn);
    const nextDrawer = this.findNextActivePlayer(this.state.activePlayerIndex);

    // Check if we've gone around the table (everyone has drawn this round)
    const nextDrawerAlreadyDrawn = nextDrawer !== -1 && this.hasDrawnThisRound(this.state.players[nextDrawer].id);

    if (nextDrawer === -1 || nextDrawerAlreadyDrawn) {
      // All players have drawn — transition to post-draw betting or showdown
      this.currentDrawIndex++;
      this.state.drawsRemaining = this.maxDraws - this.currentDrawIndex;

      // Get the post-draw betting phase
      const nextBettingPhase = this.getPostDrawBettingPhase();
      if (nextBettingPhase === GamePhase.Showdown) {
        return this.resolveShowdown();
      }

      // Move to post-draw betting
      this.state.phase = nextBettingPhase;
      this.phaseStartActionIndex = this.state.actionHistory.length;
      this.state.playersAtStreetStart = activePlayers.filter(p => !p.allIn).length;
      this.setFirstActorForStreet();

      // If only one player can act, go to showdown
      const canAct = this.state.players.filter(p => !p.folded && !p.sittingOut && !p.allIn);
      if (canAct.length <= 1) {
        return this.resolveShowdown();
      }

      return false;
    }

    // More players need to draw
    this.state.activePlayerIndex = nextDrawer;
    return false;
  }

  /**
   * Check if a player has already drawn in the current draw round.
   */
  private hasDrawnThisRound(playerId: string): boolean {
    if (playerId === '') return false;
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

  /**
   * Get the post-draw betting phase based on which draw just completed.
   */
  private getPostDrawBettingPhase(): GamePhase {
    switch (this.state.phase) {
      case GamePhase.Drawing1:
        return GamePhase.BettingPostDraw1;
      case GamePhase.Drawing2:
        return GamePhase.BettingPostDraw2;
      case GamePhase.Drawing3:
        return GamePhase.BettingPostDraw3;
      default:
        return GamePhase.Showdown;
    }
  }

}
