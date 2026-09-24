// ============================================================
// Game Controller — Server-side engine wrapper
// ============================================================
// Owns the hand lifecycle for one room: planning the next hand (button, game,
// dealer's choice) through TableRotation, dealing, validating commands,
// settling, the result presentation window, the between-hand countdown, and
// the disconnect/leave policies in docs/NINE-GAME-RULES.md §7.

import {
  GameVariant,
  GamePhase,
  ActionType,
  BettingStructure,
  GameMode,
  NINE_GAME_ROTATION,
  TableRotation,
  planShowdown,
  createGame,
  type PlannedHand,
  type PlayerState,
  type TableConfig,
  type HandState,
  type AvailableActions,
  type BaseGame,
  BaseDrawGame,
  BaseDrawmahaGame,
} from 'poker-engine';

import type { WinnerInfo } from 'poker-engine';
import { creditTopUp, type Room } from './room-manager.js';
import { getPlayerView } from './state-filter.js';
import { isChipAmount, defaultStudForcedBet } from './settings.js';
import type { PlayerView, RoomPlayer } from './types.js';

const AUTO_DEAL_DELAY_MS = 15_000;
/** How long the table waits for a disconnected player whose turn it is */
export const TURN_GRACE_MS = 60_000;

type LastAction = { playerId: string; type: string; amount?: number; discardCount?: number };

/** Callback interface for the controller to communicate with the socket layer */
export interface GameCallbacks {
  /** Send filtered hand state to a specific player */
  sendHandState(socketId: string, handState: PlayerView, actions: AvailableActions | null, isYourTurn: boolean, lastAction?: LastAction, handDescription?: string, sessionState?: any, chipsBehind?: Record<string, number>): void;
  /** Send hand complete to a specific player */
  sendHandComplete(socketId: string, winners: WinnerInfo[], finalState: PlayerView, handDescriptions: Record<string, string>, lastAction?: LastAction): void;
  /** Ask a player to pick a Dealer's Choice variant */
  sendDcChoose(socketId: string): void;
  /** Broadcast countdown to all players in the room */
  broadcastCountdown(roomCode: string, seconds: number): void;
  /** Send an error to a specific player */
  sendError(socketId: string, message: string): void;
  /** Broadcast room state update */
  broadcastRoomState(roomCode: string): void;
  /** A hand has settled: free the seats of players who left during it */
  onHandSettled?(roomCode: string): void;
  /** Tell everyone who is choosing the next dealer's-choice game (null: nobody) */
  broadcastChoicePending?(roomCode: string, chooser: { name: string; seatIndex: number } | null): void;
}

const DRAW_PHASES = new Set<string>([GamePhase.Drawing1, GamePhase.Drawing2, GamePhase.Drawing3, GamePhase.Drawing]);
const STUD_VARIANTS = new Set<string>([GameVariant.Razz, GameVariant.Stud, GameVariant.StudHiLo]);

export class GameController {
  private game: BaseGame | null = null;
  private rotation: TableRotation;
  private room: Room;
  private callbacks: GameCallbacks;
  private chipsBehind: Record<string, number> = {};
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private autoDealTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private choiceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Physical seat that must pick the next dealer's-choice game */
  private pendingChooserSeat: number | null = null;
  private lastActionIndex = 0; // Tracks action history for broadcasting
  private countdownPaused = false;
  private hostPaused = false;
  private presenting = false;
  private countdownRemaining = 0;
  /** Engine playerId → memberId of whoever was dealt into the current/last hand */
  private handMembers = new Map<string, string>();
  /** Last completion payload, re-sent to players who reconnect during the result */
  private lastCompletion: { winners: WinnerInfo[]; handDescriptions: Record<string, string>; lastAction?: LastAction } | null = null;

  constructor(room: Room, callbacks: GameCallbacks) {
    this.room = room;
    this.callbacks = callbacks;
    this.rotation = new TableRotation({ mode: room.settings.gameMode, variant: room.settings.variant });
  }

  // ---------------------------------------------------------------- players

  /** Players who will be dealt in: seated, present, not sitting out, with chips */
  private getActivePlayers(): RoomPlayer[] {
    return [...this.room.players.values()]
      .filter(p => p.connected && p.seated && !p.sittingOut && !p.pendingLeave && p.chips > 0)
      .sort((a, b) => a.seatIndex - b.seatIndex);
  }

  /** Map engine playerId to room player */
  private getRoomPlayer(enginePlayerId: string): RoomPlayer | undefined {
    for (const player of this.room.players.values()) {
      if (player.playerId === enginePlayerId) return player;
    }
    return undefined;
  }

  private getSeatPlayer(seat: number): RoomPlayer | undefined {
    const socketId = this.room.seatMap[seat];
    return socketId ? this.room.players.get(socketId) : undefined;
  }

  private liveState(): HandState | null {
    const state = this.game?.getState();
    return state && state.phase !== GamePhase.Complete ? state : null;
  }

  /** Is this engine player dealt into a hand that has not settled? */
  isInLiveHand(playerId: string): boolean {
    return !!this.liveState()?.players.some(p => p.id === playerId);
  }

  // ---------------------------------------------------------------- hand start

  /** Host's Deal Now: also lifts a host pause, so it never needs a separate resume. */
  dealNow(): void {
    if (this.hostPaused) {
      this.hostPaused = false;
      this.countdownPaused = false;
    }
    this.startHand();
  }

  /** Start a new hand (host command or countdown expiry) */
  startHand(): void {
    if (this.hostPaused || this.presenting || this.pendingChooserSeat !== null || this.liveState()) {
      this.callbacks.sendError(this.room.hostSocketId, 'Finish the current hand or game choice first');
      return;
    }

    // Anyone still disconnected at the deal sits out, keeping seat and chips.
    for (const p of this.room.players.values()) {
      if (p.seated && !p.connected && !p.sittingOut) {
        p.sittingOut = true;
        p.autoSatOut = true;
      }
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length < 2) {
      this.callbacks.sendError(this.room.hostSocketId, 'Need at least 2 players to start');
      this.callbacks.broadcastRoomState(this.room.code);
      return;
    }

    this.clearTimers();
    const plan = this.rotation.nextHand(activePlayers.map(p => p.seatIndex));
    this.room.state = 'playing';

    if (plan.needsChoice) {
      const chooser = this.getSeatPlayer(plan.chooserSeat!);
      this.pendingChooserSeat = plan.chooserSeat;
      this.callbacks.broadcastRoomState(this.room.code);
      this.broadcastSessionOnly();
      // Everyone clears the last hand and sees who is choosing.
      this.callbacks.broadcastChoicePending?.(this.room.code, chooser ? { name: chooser.name, seatIndex: chooser.seatIndex } : null);
      if (chooser) this.callbacks.sendDcChoose(chooser.socketId);
      return;
    }
    this.dealHand(plan);
  }

  /** Handle Dealer's Choice variant pick */
  handleVariantPick(playerId: string, variant: GameVariant): void {
    const player = this.getRoomPlayer(playerId);
    if (!player) return;
    if (this.hostPaused || this.pendingChooserSeat !== player.seatIndex || !NINE_GAME_ROTATION.includes(variant)) {
      this.callbacks.sendError(player.socketId, 'Only the current chooser may pick a nine-game variant');
      return;
    }
    if (!this.getActivePlayers().includes(player)) {
      // The chooser sat out or went broke before picking: the choice passes on.
      this.callbacks.sendError(player.socketId, 'You are not dealt in, so the choice passes to the next player');
      this.replanChoice();
      return;
    }
    const plan = this.rotation.choose(variant);
    this.pendingChooserSeat = null;
    this.clearChoiceTimer();
    this.dealHand(plan);
  }

  /** Deal the planned hand */
  private dealHand(plan: PlannedHand): void {
    const variant = plan.variant;
    if (!variant) {
      this.callbacks.sendError(this.room.hostSocketId, 'No variant selected');
      return;
    }
    const activePlayers = this.getActivePlayers();
    const buttonIndex = activePlayers.findIndex(p => p.seatIndex === plan.buttonSeat);

    try {
      if (buttonIndex < 0) throw new Error('Button seat is not active');
      const capBB = this.rotation.getCapBB(variant);
      const config = this.buildTableConfig(variant, capBB);

      this.chipsBehind = {};
      const enginePlayers: PlayerState[] = activePlayers.map(rp => {
        let chips = rp.chips;
        if (capBB && config.bigBlind > 0) {
          const maxChips = capBB * config.bigBlind;
          if (chips > maxChips) {
            this.chipsBehind[rp.playerId] = chips - maxChips;
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

      const game = createGame(variant, enginePlayers, buttonIndex, config);
      game.start();
      this.game = game;
      this.handMembers = new Map(activePlayers.map(rp => [rp.playerId, rp.memberId]));
      this.lastCompletion = null;
      this.room.state = 'playing';
      this.lastActionIndex = 0;

      if (game.getState().phase === GamePhase.Complete) this.handleHandComplete();
      else this.afterStateChange();
    } catch (err) {
      this.rotation.cancelPlan();
      this.chipsBehind = {};
      const message = err instanceof Error ? err.message : 'Failed to deal hand';
      console.error('[game-controller] dealHand error:', message);
      this.callbacks.sendError(this.room.hostSocketId, message);
    }
  }

  // ---------------------------------------------------------------- commands

  /** Does a command carry the current hand ID and action count? */
  acceptsVersion(handId: unknown, actionCount: unknown): boolean {
    const state = this.liveState();
    return !!state && handId === state.id && actionCount === state.actionHistory.length;
  }

  /** Handle a player action (fold/check/call/bet/raise) */
  handleAction(socketId: string, type: ActionType, amount?: number): void {
    if (this.hostPaused) { this.callbacks.sendError(socketId, 'Table paused by host'); return; }
    const state = this.liveState();
    if (!state || !this.game) { this.callbacks.sendError(socketId, 'No hand in progress'); return; }
    const player = this.room.players.get(socketId);
    if (!player) return;
    if (amount !== undefined && !isChipAmount(amount)) {
      this.callbacks.sendError(socketId, 'Amounts must be a multiple of $0.25');
      return;
    }
    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== player.playerId) {
      this.callbacks.sendError(socketId, 'Not your turn');
      return;
    }
    this.apply(() => this.game!.act(player.playerId, type, amount), socketId);
  }

  /** Handle a discard action (draw games) */
  handleDiscard(socketId: string, cardIndices: number[]): void {
    if (this.hostPaused) { this.callbacks.sendError(socketId, 'Table paused by host'); return; }
    const state = this.liveState();
    if (!state || !this.game) { this.callbacks.sendError(socketId, 'No hand in progress'); return; }
    const player = this.room.players.get(socketId);
    if (!player) return;
    if (!this.isDrawGame(this.game)) { this.callbacks.sendError(socketId, 'Not a draw game'); return; }
    const activePlayer = state.players[state.activePlayerIndex];
    if (!activePlayer || activePlayer.id !== player.playerId) {
      this.callbacks.sendError(socketId, 'Not your turn to draw');
      return;
    }
    this.apply(() => (this.game as BaseDrawGame).discard(player.playerId, cardIndices), socketId);
  }

  /** Run one engine mutation and publish the result. */
  private apply(mutate: () => boolean, socketId?: string): void {
    try {
      const done = mutate();
      if (done || this.game?.getState().phase === GamePhase.Complete) this.handleHandComplete();
      else this.afterStateChange();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid action';
      if (socketId) this.callbacks.sendError(socketId, message);
      else console.error('[game-controller] automatic action failed:', message);
    }
  }

  // ---------------------------------------------------------------- disconnect / leave

  /**
   * A player's socket dropped. Off-turn this changes nothing; on their turn the
   * table waits TURN_GRACE_MS. A pending dealer's-choice chooser gets the same grace.
   */
  handlePlayerDisconnected(playerId: string): void {
    this.scheduleTurnTimer();
    const player = this.getRoomPlayer(playerId);
    if (player && this.pendingChooserSeat === player.seatIndex) this.scheduleChoiceTimer();
    this.callbacks.broadcastRoomState(this.room.code);
  }

  /** A player left or was kicked while dealt into the live hand. */
  handlePlayerLeaving(_playerId: string): void {
    this.scheduleTurnTimer();
  }

  /** A player came back (token reconnect): resume them and send a full snapshot. */
  handlePlayerReconnected(playerId: string): void {
    const player = this.getRoomPlayer(playerId);
    if (!player) return;
    if (player.autoSatOut) {
      player.sittingOut = false;
      player.autoSatOut = false;
    }
    this.scheduleTurnTimer();
    if (this.pendingChooserSeat === player.seatIndex) this.clearChoiceTimer();
    this.sendSnapshot(player);
    this.autoResumeIfReady();
  }

  /** Give one player everything needed to render the current stage. */
  sendSnapshot(player: RoomPlayer): void {
    if (!player.connected) return;
    const state = this.game?.getState();
    if (state && state.phase !== GamePhase.Complete) {
      this.sendHandStateTo(player, state, undefined);
    } else if (state && this.lastCompletion) {
      const view = getPlayerView(state, this.viewerId(player));
      this.callbacks.sendHandComplete(player.socketId, this.lastCompletion.winners, view, this.lastCompletion.handDescriptions, this.lastCompletion.lastAction);
    }
    if (this.pendingChooserSeat !== null) {
      const chooser = this.getSeatPlayer(this.pendingChooserSeat);
      this.callbacks.broadcastChoicePending?.(this.room.code, chooser ? { name: chooser.name, seatIndex: chooser.seatIndex } : null);
    }
    if (this.pendingChooserSeat === player.seatIndex && !this.hostPaused) {
      this.callbacks.sendDcChoose(player.socketId);
    }
    if (this.hostPaused) {
      this.callbacks.broadcastCountdown(this.room.code, -1);
    } else if (!state || state.phase === GamePhase.Complete) {
      const seconds = this.countdownPaused ? -1 : this.countdownTimer ? this.countdownRemaining : null;
      if (seconds !== null) this.callbacks.broadcastCountdown(this.room.code, seconds);
    }
  }

  /**
   * The engine ID a room player may see a hand as. Engine IDs are p{seat}, so a
   * later occupant of the same seat must view the hand as a spectator, never
   * as the player who held those cards.
   */
  private viewerId(player: RoomPlayer): string {
    return this.handMembers.get(player.playerId) === player.memberId ? player.playerId : '__spectator__';
  }

  /** Room membership changed in a way clients should see (e.g. host transfer). */
  notifyRoomChanged(): void {
    this.callbacks.broadcastRoomState(this.room.code);
  }

  /**
   * Arrange the automatic action for the current actor: immediately if they
   * are leaving, after TURN_GRACE_MS if they are disconnected, never otherwise.
   */
  private scheduleTurnTimer(): void {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    const state = this.liveState();
    if (!state || this.hostPaused) return;
    const actor = state.players[state.activePlayerIndex];
    if (!actor) return;
    const rp = this.getRoomPlayer(actor.id);
    const leaving = !rp || !!rp.pendingLeave;
    if (!leaving && rp.connected) return;

    const handId = state.id;
    const actionCount = state.actionHistory.length;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      const now = this.liveState();
      if (!now || now.id !== handId || now.actionHistory.length !== actionCount || this.hostPaused) return;
      this.autoAct(actor.id);
    }, leaving ? 0 : TURN_GRACE_MS);
  }

  /**
   * The automatic action (spec §7). Draw: stand pat. A pending stud bring-in:
   * post the bring-in (it is forced). A player who left: fold. A disconnected
   * player: check if legal, otherwise fold.
   */
  private autoAct(playerId: string): void {
    const state = this.liveState();
    if (!state || !this.game) return;
    if (DRAW_PHASES.has(state.phase) && this.isDrawGame(this.game)) {
      this.apply(() => (this.game as BaseDrawGame).discard(playerId, []));
      return;
    }
    const actions = this.game.getAvailableActions();
    const rp = this.getRoomPlayer(playerId);
    const leaving = !rp || !!rp.pendingLeave;
    if (state.pendingBringIn && actions.canBet) this.apply(() => this.game!.act(playerId, ActionType.Bet, actions.minBet));
    else if (leaving) this.apply(() => this.game!.forfeit(playerId));
    else if (actions.canCheck) this.apply(() => this.game!.act(playerId, ActionType.Check));
    else if (actions.canFold) this.apply(() => this.game!.act(playerId, ActionType.Fold));
    else console.error(`[game-controller] no automatic action for ${playerId} in ${state.phase}`);
  }

  private scheduleChoiceTimer(): void {
    this.clearChoiceTimer();
    this.choiceTimer = setTimeout(() => {
      this.choiceTimer = null;
      const seat = this.pendingChooserSeat;
      if (seat === null) return;
      const chooser = this.getSeatPlayer(seat);
      if (chooser?.connected) return;
      // The chooser never came back: sit them out and pass the choice on.
      if (chooser) { chooser.sittingOut = true; chooser.autoSatOut = true; }
      this.replanChoice();
    }, TURN_GRACE_MS);
  }

  /** The pending chooser is gone (left, kicked, sat out, timed out): pass the choice left. */
  private replanChoice(): void {
    this.pendingChooserSeat = null;
    this.clearChoiceTimer();
    this.rotation.cancelPlan();
    if (!this.hostPaused) this.startHand();
  }

  /**
   * A seat stopped being playable between hands (the player left, was kicked,
   * or sat out). If they were about to pick the dealer's-choice game, re-plan.
   */
  handleSeatVacated(seat: number): void {
    if (this.pendingChooserSeat === seat) this.replanChoice();
  }

  private clearChoiceTimer(): void {
    if (this.choiceTimer) { clearTimeout(this.choiceTimer); this.choiceTimer = null; }
  }

  // ---------------------------------------------------------------- completion

  /** Settle chips, record the ledger, and start the result presentation. */
  private handleHandComplete(): void {
    if (!this.game) return;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }

    const state = this.game.getState();
    const winners = this.game.getWinners();

    for (const enginePlayer of state.players) {
      const roomPlayer = this.getRoomPlayer(enginePlayer.id);
      if (!roomPlayer) continue;
      roomPlayer.chips = enginePlayer.chips + (this.chipsBehind[enginePlayer.id] ?? 0);
      if (roomPlayer.queuedAddOn !== undefined) creditTopUp(this.room, roomPlayer, roomPlayer.queuedAddOn);
    }
    this.chipsBehind = {};
    this.rotation.completeHand();

    // Descriptions only for a contested showdown; a fold winner's hand stays private.
    const contested = state.players.filter(p => !p.folded && !p.sittingOut).length > 1;
    const handDescriptions: Record<string, string> = {};
    if (contested) {
      for (const enginePlayer of state.players) {
        if (enginePlayer.folded) continue;
        try {
          // Showdown labels include kickers so tied categories show who won.
          const desc = this.game.getShowdownDescription(enginePlayer.id);
          if (desc) handDescriptions[enginePlayer.id] = desc;
        } catch {
          // Some games may not support hand descriptions
        }
      }
    }

    const lastAction = this.takeLastAction(state);
    this.lastCompletion = { winners, handDescriptions, lastAction };

    this.callbacks.onHandSettled?.(this.room.code);
    this.callbacks.broadcastRoomState(this.room.code);

    for (const roomPlayer of this.room.players.values()) {
      if (!roomPlayer.connected) continue;
      const view = getPlayerView(state, this.viewerId(roomPlayer));
      this.callbacks.sendHandComplete(roomPlayer.socketId, winners, view, handDescriptions, lastAction);
    }

    this.presenting = true;
    this.autoDealTimer = setTimeout(() => {
      this.presenting = false;
      this.autoDealTimer = null;
      this.startCountdown();
    }, planShowdown(state).durationMs);
  }

  private takeLastAction(state: HandState): LastAction | undefined {
    if (state.actionHistory.length <= this.lastActionIndex) return undefined;
    const latest = state.actionHistory[state.actionHistory.length - 1];
    this.lastActionIndex = state.actionHistory.length;
    return {
      playerId: latest.playerId,
      type: latest.type,
      amount: latest.amount,
      discardCount: latest.discardIndices?.length,
    };
  }

  // ---------------------------------------------------------------- broadcasting

  /** Publish a mid-hand state change and arrange any automatic action. */
  private afterStateChange(): void {
    this.broadcastState();
    this.scheduleTurnTimer();
  }

  private sendHandStateTo(roomPlayer: RoomPlayer, state: HandState, lastAction: LastAction | undefined): void {
    if (!this.game || !roomPlayer.connected) return;
    const activePlayer = state.players[state.activePlayerIndex];
    const viewer = this.viewerId(roomPlayer);
    const view = getPlayerView(state, viewer);
    const isYourTurn = activePlayer?.id === viewer;
    const actions = isYourTurn ? this.game.getAvailableActions() : null;
    let handDescription: string | undefined;
    if (state.players.some(p => p.id === viewer && !p.folded)) {
      try {
        handDescription = this.game.getHandDescription(roomPlayer.playerId)?.description;
      } catch {
        // Some game states may not support hand descriptions yet
      }
    }
    const chipsBehind = Object.keys(this.chipsBehind).length > 0 ? { ...this.chipsBehind } : undefined;
    this.callbacks.sendHandState(roomPlayer.socketId, view, actions, isYourTurn, lastAction, handDescription, this.rotation.getState(), chipsBehind);
  }

  /** Broadcast filtered state to all connected players */
  private broadcastState(): void {
    if (!this.game) return;
    const state = this.game.getState();
    const lastAction = this.takeLastAction(state);
    for (const roomPlayer of this.room.players.values()) this.sendHandStateTo(roomPlayer, state, lastAction);
  }

  /** While waiting for a dealer's-choice pick there is no hand; still show who is choosing. */
  private broadcastSessionOnly(): void {
    this.callbacks.broadcastCountdown(this.room.code, this.hostPaused ? -1 : 0);
  }

  // ---------------------------------------------------------------- countdown / pause

  /** Start auto-deal countdown */
  private startCountdown(durationMs: number = AUTO_DEAL_DELAY_MS): void {
    this.clearTimers();
    this.countdownPaused = false;
    this.countdownRemaining = Math.floor(durationMs / 1000);

    // Preserve a deliberate host pause when the hand finishes.
    if (this.hostPaused || this.getActivePlayers().length < 2) {
      this.countdownPaused = true;
      this.callbacks.broadcastCountdown(this.room.code, -1);
      return;
    }
    this.runCountdown();
  }

  private runCountdown(): void {
    this.callbacks.broadcastCountdown(this.room.code, this.countdownRemaining);
    this.countdownTimer = setInterval(() => {
      if (this.getActivePlayers().length < 2) {
        clearInterval(this.countdownTimer!);
        this.countdownTimer = null;
        this.countdownPaused = true;
        this.callbacks.broadcastCountdown(this.room.code, -1);
        return;
      }
      this.countdownRemaining--;
      if (this.countdownRemaining <= 0) {
        this.clearTimers();
        this.startHand();
      } else {
        this.callbacks.broadcastCountdown(this.room.code, this.countdownRemaining);
      }
    }, 1000);
  }

  /** Auto-resume countdown if it was paused due to insufficient players */
  autoResumeIfReady(): void {
    if (!this.countdownPaused || this.hostPaused || this.presenting || this.liveState()) return;
    if (this.getActivePlayers().length < 2) return;
    this.countdownPaused = false;
    if (this.countdownRemaining <= 0) this.countdownRemaining = Math.floor(AUTO_DEAL_DELAY_MS / 1000);
    this.runCountdown();
  }

  /** Pause the table (host only): no actions, choices or deals until resumed */
  pauseCountdown(): void {
    this.hostPaused = true;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.clearChoiceTimer();
    this.countdownPaused = true;
    this.callbacks.broadcastCountdown(this.room.code, -1);
  }

  /** Resume the table (host only) */
  resumeCountdown(): void {
    if (!this.hostPaused && !this.countdownPaused) return;
    this.hostPaused = false;
    if (this.pendingChooserSeat !== null) {
      this.countdownPaused = false;
      this.callbacks.broadcastCountdown(this.room.code, 0);
      const chooser = this.getSeatPlayer(this.pendingChooserSeat);
      if (chooser?.connected) this.callbacks.sendDcChoose(chooser.socketId);
      else this.scheduleChoiceTimer();
      return;
    }
    if (this.presenting || this.liveState()) {
      this.countdownPaused = false;
      this.callbacks.broadcastCountdown(this.room.code, 0);
      this.scheduleTurnTimer();
      return;
    }
    if (this.getActivePlayers().length < 2) {
      this.callbacks.broadcastCountdown(this.room.code, -1);
      return;
    }
    this.countdownPaused = false;
    if (this.countdownRemaining <= 0) this.countdownRemaining = Math.floor(AUTO_DEAL_DELAY_MS / 1000);
    this.runCountdown();
  }

  /** Check if the table is paused */
  isPaused(): boolean {
    return this.hostPaused || this.countdownPaused;
  }

  /** Clear the between-hand timers (not the turn or choice timers) */
  private clearTimers(): void {
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
    if (this.autoDealTimer) { clearTimeout(this.autoDealTimer); this.autoDealTimer = null; }
  }

  // ---------------------------------------------------------------- config

  /** Build TableConfig from room settings + variant */
  private buildTableConfig(variant: GameVariant, capBB: number | null): TableConfig {
    const s = this.room.settings;
    const isStud = STUD_VARIANTS.has(variant);
    const structure = this.getVariantBettingStructure(variant);
    const isLimit = structure === BettingStructure.FixedLimit;
    const smallBet = s.smallBet ?? s.bigBlind * 2;
    const bigBet = s.bigBet ?? smallBet * 2;

    const config: TableConfig = {
      maxPlayers: 6,
      smallBlind: isStud ? 0 : isLimit ? smallBet / 2 : s.smallBlind,
      bigBlind: isStud ? 0 : isLimit ? smallBet : s.bigBlind,
      ante: isStud ? (s.ante ?? defaultStudForcedBet(smallBet)) : 0,
      bringIn: isStud ? (s.bringIn ?? defaultStudForcedBet(smallBet)) : 0,
      startingChips: s.startingChips,
      variant,
      bettingStructure: structure,
    };
    if (isLimit) {
      config.smallBet = smallBet;
      config.bigBet = bigBet;
    }
    if (capBB) config.capBB = capBB;
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

  private isDrawGame(game: BaseGame): boolean {
    return game instanceof BaseDrawGame || game instanceof BaseDrawmahaGame;
  }

  // ---------------------------------------------------------------- queries / admin

  /** Get current game state */
  getState(): HandState | null {
    return this.game?.getState() ?? null;
  }

  /** Get current session state */
  getSessionState() {
    return this.rotation.getState();
  }

  /** Change the game mode between hands (host only). The button continues left. */
  updateGameMode(mode: GameMode, variant?: GameVariant): void {
    if (variant && !NINE_GAME_ROTATION.includes(variant)) throw new Error('Select a nine-game variant');
    if (this.liveState() || this.pendingChooserSeat !== null) throw new Error('Change games between hands');
    this.rotation = new TableRotation({ mode, variant, startAfterSeat: this.rotation.getLastButtonSeat() });
  }

  /** Clean up on room destroy */
  destroy(): void {
    this.clearTimers();
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    this.clearChoiceTimer();
    this.game = null;
    this.presenting = false;
    this.pendingChooserSeat = null;
  }
}
