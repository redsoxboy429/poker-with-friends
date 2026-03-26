// ============================================================
// Base Flop Game Engine
// ============================================================
// Shared infrastructure for all community-card (flop) variants:
// NLH, PLO, Limit Hold'em, Omaha Hi-Lo, etc.
//
// Handles: blind posting (SB + BB + optional antes), community
// card dealing (flop/turn/river with burns), phase transitions,
// position-based first actor, and dealRemainingCards.
//
// Subclasses only need to implement:
// - getHoleCardCount(): number of hole cards per player
// - evaluateHand(): hand evaluation at showdown
// And optionally override the constructor to set betting structure.

import { BaseGame } from './base.js';
import {
  GamePhase,
  ActionType,
  HandResult,
  PlayerState,
  TableConfig,
  BettingStructure,
} from '../types.js';

/**
 * Abstract base class for community-card (flop) poker variants.
 * Covers Hold'em-family games: NLH, PLO, LHE, Omaha Hi-Lo, etc.
 */
export abstract class BaseFlopGame extends BaseGame {
  constructor(config: TableConfig, players: PlayerState[], buttonIndex: number) {
    super(config, players, buttonIndex);
  }

  /** How many hole cards each player receives (2 for HE, 4 for PLO, etc.) */
  protected abstract getHoleCardCount(): number;

  // ============================================================
  // Shared flop-game logic
  // ============================================================

  protected postForcedBets(): void {
    // Post antes if configured
    if (this.config.ante > 0) {
      for (const player of this.state.players) {
        if (player.sittingOut) continue;
        const anteAmount = Math.min(this.config.ante, player.chips);
        player.chips -= anteAmount;
        player.bet += anteAmount;
        player.totalBet += anteAmount;
        if (player.chips === 0) player.allIn = true;
        this.state.actionHistory.push({
          type: ActionType.PostAnte,
          playerId: player.id,
          amount: anteAmount,
        });
      }
    }

    // Post small blind
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

    // Post big blind
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
    const holeCardCount = this.getHoleCardCount();
    const startIdx = this.findNextActiveFrom(this.state.buttonIndex);
    const n = this.state.players.length;

    for (let round = 0; round < holeCardCount; round++) {
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
    // Preflop: first to act is left of BB (UTG)
    const bbIndex = this.getBigBlindIndex();
    const firstActor = this.findNextActivePlayer(bbIndex);
    this.state.activePlayerIndex = firstActor !== -1 ? firstActor : bbIndex;
  }

  protected setFirstActorForStreet(): void {
    // Post-flop: first to act is left of button (SB or next active)
    const firstActor = this.findNextActivePlayer(this.state.buttonIndex);
    if (firstActor !== -1) {
      this.state.activePlayerIndex = firstActor;
    }
  }

  protected getNextPhase(): GamePhase {
    switch (this.state.phase) {
      case GamePhase.BettingPreflop: return GamePhase.BettingFlop;
      case GamePhase.BettingFlop: return GamePhase.BettingTurn;
      case GamePhase.BettingTurn: return GamePhase.BettingRiver;
      case GamePhase.BettingRiver: return GamePhase.Showdown;
      default: return GamePhase.Showdown;
    }
  }

  protected dealPhaseCards(phase: GamePhase): void {
    switch (phase) {
      case GamePhase.BettingFlop:
        this.deck.burn();
        this.state.communityCards.push(...this.deck.dealMany(3));
        break;
      case GamePhase.BettingTurn:
        this.deck.burn();
        this.state.communityCards.push(this.deck.deal());
        break;
      case GamePhase.BettingRiver:
        this.deck.burn();
        this.state.communityCards.push(this.deck.deal());
        break;
    }
  }

  protected dealRemainingCards(): void {
    while (this.state.communityCards.length < 5) {
      this.deck.burn();
      const cardsNeeded = this.state.communityCards.length === 0 ? 3 : 1;
      this.state.communityCards.push(...this.deck.dealMany(cardsNeeded));
    }
  }
}
