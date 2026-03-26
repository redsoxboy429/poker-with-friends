// ============================================================
// Game Controller — Server-side engine wrapper
// ============================================================
// Manages hand lifecycle, action validation, state broadcasting.
// This is the server equivalent of App.tsx's processState + dealNewHand.

import {
  GameVariant,
  GamePhase,
  ActionType,
  BettingStructure,
  GameSession,
  GameMode,
  CAP_RULES,
  type PlayerState,
  type TableConfig,
  type HandState,
  type AvailableActions,
  type BaseGame,
  NLHGame, PLOGame, LHEGame, O8Game, PLO8Game,
  RazzGame, StudGame, StudHiLoGame,
  TwoSevenSDGame, TwoSevenTDGame,
  BadugiGame, BadeucyGame, BadaceyGame, ArchieGame, TenThirtyGame,
  DrawmahaHighGame, Drawmaha27Game, DrawmahaA5Game, Drawmaha49Game,
  PLBadugiDDGame, PLBadeucyDDGame, PLBadaceyDDGame, PLArchieDDGame, PLTenThirtyDDGame,
  LimitOmahaHighGame,
  BaseDrawGame,
  BaseDrawmahaGame,
} from 'poker-engine';

import type { WinnerInfo } from 'poker-engine';
import type { Room, RoomPlayer } from './room-manager.js';
import { getPlayerView } from './state-filter.js';
import type { PlayerView } from './types.js';

const AUTO_DEAL_DELAY_MS = 12_000;

/** Callback interface for the controller to communicate with the socket layer */
export interface GameCallbacks {
  /** Send filtered hand state to a specific player */
  sendHandState(socketId: string, handState: PlayerView, actions: AvailableActions | null, isYourTurn: boolean): void;
  /** Send hand complete to a specific player */
  sendHandComplete(socketId: string, winners: WinnerInfo[], finalState: PlayerView): void;
  /** Ask a player to pick a Dealer's Choice variant */
  sendDcChoose(socketId: string): void;
  /** Broadcast countdown to all players in the room */
  broadcastCountdown(roomCode: string, seconds: number): void;
  /** Send an error to a specific player */
  sendError(socketId: string, message: string): void;
  /** Broadcast room state update */
  broadcastRoomState(roomCode: string): void;
}

export class GameController {
  private game: BaseGame | null = null;
  private session: GameSession;
  private room: Room;
  private callbacks: GameCallbacks;
  private buttonIndex: number = -1; // Will be 0 on first hand
  private chipsBehind: Record<string, number> = {};
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private autoDealTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(room: Room, callbacks: GameCallbacks) {
    this.room = room;
    this.callbacks = callbacks;

    const sessionConfig = {
      mode: room.settings.gameMode,
      variant: room.settings.variant,
      numPlayers: this.getActivePlayers().length,
    };
    this.session = new GameSession(sessionConfig);
  }

  /** Get active (connected, not sitting out) players sorted by seat */
  private getActivePlayers(): RoomPlayer[] {
    return [...this.room.players.values()]
      .filter(p => p.connected && !p.sittingOut)
      .sort((a, b) => a.seatIndex - b.seatIndex);
  }

  /** Map engine playerId to socket player */
  private getSocketPlayer(enginePlayerId: string): RoomPlayer | undefined {
    for (const player of this.room.players.values()) {
      if (player.playerId === enginePlayerId) return player;
    }
    return undefined;
  }

  /** Start a new hand */
  startHand(): void {
    const activePlayers = this.getActivePlayers();
    if (activePlayers.length < 2) {
      // Broadcast error to host
      this.callbacks.sendError(this.room.hostSocketId, 'Need at least 2 players to start');
      return;
    }

    // Clear any countdown
    this.clearTimers();

    // Advance button
    this.buttonIndex = (this.buttonIndex + 1) % activePlayers.length;

    // Advance session (variant rotation)
    if (this.session.getState().currentVariant !== null) {
      this.session.advanceHand(this.buttonIndex);
    }

    // Check if Dealer's Choice needs a pick
    const sessionState = this.session.getState();
    if (sessionState.needsChoice) {
      // The chooser needs to pick a variant
      const chooserSeat = sessionState.chooserSeatIndex;
      if (chooserSeat !== null) {
        const chooser = activePlayers.find(p => p.seatIndex === chooserSeat);
        if (chooser) {
          this.callbacks.sendDcChoose(chooser.socketId);
          return; // Wait for pick
        }
      }
    }

    this.dealHand();
  }

  /** Handle Dealer's Choice variant pick */
  handleVariantPick(playerId: string, variant: GameVariant): void {
    this.session.setDealersChoice(variant, this.buttonIndex);
    this.dealHand();
  }

  /** Actually deal the hand (after variant is determined) */
  private dealHand(): void {
    const activePlayers = this.getActivePlayers();
    const variant = this.session.getCurrentVariant();
    if (!variant) return;

    // Build engine players from room players
    const capBB = this.session.getCapBB();
    const config = this.buildTableConfig(variant, capBB);

    const enginePlayers: PlayerState[] = activePlayers.map((rp, i) => {
      let chips = rp.chips;

      // Apply cap if needed
      if (capBB && config.bigBlind > 0) {
        const maxChips = capBB * config.bigBlind;
        if (chips > maxChips) {
          this.chipsBehind[rp.playerId] = (this.chipsBehind[rp.playerId] || 0) + (chips - maxChips);
          chips = maxChips;
        }
      }

      return {
        id: rp.playerId,
        name: rp.name,
        chips,
        holeCards: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        sittingOut: false,
        seatIndex: rp.seatIndex,
      };
    });

    // Create and start the game
    this.game = createGame(variant, enginePlayers, this.buttonIndex, config);
    this.game.start();
    this.room.state = 'playing';

    // Broadcast initial state
    this.broadcastState();
  }

  /** Handle a player action (fold/check/call/bet/raise) */
  handleAction(socketId: string, type: ActionType, amount?: number): void {
    if (!this.game) {
      this.callbacks.sendError(socketId, 'No hand in progress');
      return;
    }

    const player = this.room.players.get(socketId);
    if (!player) return;

    const state = this.game.getState();
    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== player.playerId) {
      this.callbacks.sendError(socketId, 'Not your turn');
      return;
    }

    try {
      const done = this.game.act(player.playerId, type, amount);
      if (done) {
        this.handleHandComplete();
      } else {
        this.broadcastState();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid action';
      this.callbacks.sendError(socketId, message);
    }
  }

  /** Handle a discard action (draw games) */
  handleDiscard(socketId: string, cardIndices: number[]): void {
    if (!this.game) {
      this.callbacks.sendError(socketId, 'No hand in progress');
      return;
    }

    const player = this.room.players.get(socketId);
    if (!player) return;

    // Type guard: must be a draw game
    if (!this.isDrawGame(this.game) && !this.isDrawmahaGame(this.game)) {
      this.callbacks.sendError(socketId, 'Not a draw game');
      return;
    }

    const state = this.game.getState();
    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== player.playerId) {
      this.callbacks.sendError(socketId, 'Not your turn to draw');
      return;
    }

    try {
      const done = (this.game as any).discard(player.playerId, cardIndices);
      if (done) {
        this.handleHandComplete();
      } else {
        this.broadcastState();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid discard';
      this.callbacks.sendError(socketId, message);
    }
  }

  /** Handle player disconnect mid-hand */
  handleDisconnect(playerId: string): void {
    if (!this.game) return;

    const state = this.game.getState();
    const activePlayer = state.players[state.activePlayerIndex];

    // If it's this player's turn, auto-fold
    if (activePlayer && activePlayer.id === playerId) {
      try {
        const actions = this.game.getAvailableActions();
        if (actions.canFold) {
          const done = this.game.act(playerId, ActionType.Fold);
          if (done) {
            this.handleHandComplete();
          } else {
            this.broadcastState();
          }
        } else if (actions.canCheck) {
          const done = this.game.act(playerId, ActionType.Check);
          if (done) {
            this.handleHandComplete();
          } else {
            this.broadcastState();
          }
        }
      } catch {
        // Ignore errors during disconnect handling
      }
    }
  }

  /** Handle hand completion */
  private handleHandComplete(): void {
    if (!this.game) return;

    const state = this.game.getState();
    const winners = this.game.getWinners();

    // Update player chips in room
    for (const enginePlayer of state.players) {
      const roomPlayer = this.getSocketPlayer(enginePlayer.id);
      if (roomPlayer) {
        // Restore chips behind
        let chips = enginePlayer.chips;
        if (this.chipsBehind[enginePlayer.id]) {
          chips += this.chipsBehind[enginePlayer.id];
          delete this.chipsBehind[enginePlayer.id];
        }
        roomPlayer.chips = chips;
      }
    }

    // Send hand-complete to each player with their view
    for (const [socketId, roomPlayer] of this.room.players) {
      if (!roomPlayer.connected) continue;
      const view = getPlayerView(state, roomPlayer.playerId);
      this.callbacks.sendHandComplete(socketId, winners, view);
    }

    // Start auto-deal countdown
    this.startCountdown();
  }

  /** Broadcast filtered state to all connected players */
  private broadcastState(): void {
    if (!this.game) return;

    const state = this.game.getState();
    const activePlayer = state.players[state.activePlayerIndex];

    for (const [socketId, roomPlayer] of this.room.players) {
      if (!roomPlayer.connected) continue;

      const view = getPlayerView(state, roomPlayer.playerId);
      const isYourTurn = activePlayer?.id === roomPlayer.playerId;
      const actions = isYourTurn ? this.game.getAvailableActions() : null;

      this.callbacks.sendHandState(socketId, view, actions, isYourTurn);
    }
  }

  /** Start auto-deal countdown */
  private startCountdown(): void {
    this.clearTimers();

    let remaining = Math.floor(AUTO_DEAL_DELAY_MS / 1000);
    this.callbacks.broadcastCountdown(this.room.code, remaining);

    this.countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        this.clearTimers();
        this.startHand();
      } else {
        this.callbacks.broadcastCountdown(this.room.code, remaining);
      }
    }, 1000);
  }

  /** Clear all timers */
  private clearTimers(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.autoDealTimer) {
      clearTimeout(this.autoDealTimer);
      this.autoDealTimer = null;
    }
  }

  /** Build TableConfig from room settings + variant */
  private buildTableConfig(variant: GameVariant, capBB: number | null): TableConfig {
    const s = this.room.settings;
    const isStud = ['razz', 'stud', 'stud8'].includes(variant);
    const isLimit = this.getVariantBettingStructure(variant) === BettingStructure.FixedLimit;

    const config: TableConfig = {
      maxPlayers: 6,
      smallBlind: isStud ? 0 : s.smallBlind,
      bigBlind: isStud ? 0 : s.bigBlind,
      ante: isStud ? Math.round(s.smallBlind * 0.4) : 0,
      bringIn: isStud ? Math.round(s.smallBlind * 0.6) : 0,
      startingChips: s.startingChips,
      variant,
      bettingStructure: this.getVariantBettingStructure(variant),
    };

    if (isLimit) {
      config.smallBet = s.smallBet || s.bigBlind;
      config.bigBet = s.bigBet || s.bigBlind * 2;
    }

    if (capBB) {
      config.capBB = capBB;
    }

    return config;
  }

  /** Get the betting structure for a variant */
  private getVariantBettingStructure(variant: GameVariant): BettingStructure {
    const NL = [GameVariant.NLH, GameVariant.TwoSevenSD];
    const PL = [
      GameVariant.PLO, GameVariant.PLOHiLo,
      GameVariant.DrawmahaHigh, GameVariant.Drawmaha27, GameVariant.DrawmahaA5, GameVariant.Drawmaha49,
      GameVariant.PLBadugiDD, GameVariant.PLBadeucyDD, GameVariant.PLBadaceyDD, GameVariant.PLArchieDD, GameVariant.PLTenThirtyDD,
    ];
    if (NL.includes(variant)) return BettingStructure.NoLimit;
    if (PL.includes(variant)) return BettingStructure.PotLimit;
    return BettingStructure.FixedLimit;
  }

  /** Type guard for draw games */
  private isDrawGame(game: BaseGame): boolean {
    return game instanceof BaseDrawGame;
  }

  /** Type guard for drawmaha games */
  private isDrawmahaGame(game: BaseGame): boolean {
    return game instanceof BaseDrawmahaGame;
  }

  /** Get current game state (for reconnection) */
  getState(): HandState | null {
    return this.game?.getState() ?? null;
  }

  /** Get current session state */
  getSessionState() {
    return this.session.getState();
  }

  /** Clean up on room destroy */
  destroy(): void {
    this.clearTimers();
    this.game = null;
  }
}

// ============================================================
// Game factory (server-side version of engine-wrapper createGame)
// ============================================================

function createGame(
  variant: GameVariant,
  players: PlayerState[],
  buttonIndex: number,
  config: TableConfig,
): BaseGame {
  switch (variant) {
    case GameVariant.NLH: return new NLHGame(config, players, buttonIndex);
    case GameVariant.PLO: return new PLOGame(config, players, buttonIndex);
    case GameVariant.LimitHoldem: return new LHEGame(config, players, buttonIndex);
    case GameVariant.OmahaHiLo: return new O8Game(config, players, buttonIndex);
    case GameVariant.PLOHiLo: return new PLO8Game(config, players, buttonIndex);
    case GameVariant.Razz: return new RazzGame(config, players, buttonIndex);
    case GameVariant.Stud: return new StudGame(config, players, buttonIndex);
    case GameVariant.StudHiLo: return new StudHiLoGame(config, players, buttonIndex);
    case GameVariant.TwoSevenSD: return new TwoSevenSDGame(config, players, buttonIndex);
    case GameVariant.TwoSevenTD: return new TwoSevenTDGame(config, players, buttonIndex);
    case GameVariant.Badugi: return new BadugiGame(config, players, buttonIndex);
    case GameVariant.Badeucy: return new BadeucyGame(config, players, buttonIndex);
    case GameVariant.Badacey: return new BadaceyGame(config, players, buttonIndex);
    case GameVariant.Archie: return new ArchieGame(config, players, buttonIndex);
    case GameVariant.TenThirtyDraw: return new TenThirtyGame(config, players, buttonIndex);
    case GameVariant.DrawmahaHigh:
    case GameVariant.LimitDrawmahaHigh:
      return new DrawmahaHighGame(config, players, buttonIndex);
    case GameVariant.Drawmaha27:
    case GameVariant.LimitDrawmaha27:
      return new Drawmaha27Game(config, players, buttonIndex);
    case GameVariant.DrawmahaA5:
    case GameVariant.LimitDrawmahaA5:
      return new DrawmahaA5Game(config, players, buttonIndex);
    case GameVariant.Drawmaha49:
    case GameVariant.LimitDrawmaha49:
      return new Drawmaha49Game(config, players, buttonIndex);
    case GameVariant.PLBadugiDD: return new PLBadugiDDGame(config, players, buttonIndex);
    case GameVariant.PLBadeucyDD: return new PLBadeucyDDGame(config, players, buttonIndex);
    case GameVariant.PLBadaceyDD: return new PLBadaceyDDGame(config, players, buttonIndex);
    case GameVariant.PLArchieDD: return new PLArchieDDGame(config, players, buttonIndex);
    case GameVariant.PLTenThirtyDD: return new PLTenThirtyDDGame(config, players, buttonIndex);
    case GameVariant.LimitOmahaHigh: return new LimitOmahaHighGame(config, players, buttonIndex);
    default: return new NLHGame(config, players, buttonIndex);
  }
}
