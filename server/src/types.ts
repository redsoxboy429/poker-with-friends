// ============================================================
// Socket Event Protocol — Client ↔ Server communication types
// ============================================================

import type {
  GameVariant,
  ActionType,
  HandState,
  AvailableActions,
  Card,
  PlayerState,
  BettingStructure,
} from 'poker-engine';
import type { GameMode } from 'poker-engine';
import type { WinnerInfo } from 'poker-engine';

// ============================================================
// Room & Settings Types
// ============================================================

export interface RoomSettings {
  gameMode: GameMode;
  variant?: GameVariant;          // For SpecificGame mode
  smallBlind: number;
  bigBlind: number;
  startingChips: number;
  // Limit-specific
  smallBet?: number;
  bigBet?: number;
  // Stud forced bets (default: a quarter of the small bet)
  ante?: number;
  bringIn?: number;
  // Buy-in range in dollars (also the top-up maximum)
  buyInMin?: number;
  buyInMax?: number;
}

/** One row of the server-owned session ledger, keyed by memberId. */
export interface LedgerRow {
  memberId: string;
  name: string;
  /** Total bought in: first buy-in plus every top-up actually credited */
  buyIn: number;
  /** Chips taken off the table when leaving */
  cashOut: number;
  /** Current stack (0 once the player has left) */
  stack: number;
  left: boolean;
}

export interface RoomPlayer {
  socketId: string;
  name: string;
  seatIndex: number;
  chips: number;
  connected: boolean;
  playerId: string;               // Engine player ID: p{seat}. Seats are only freed between hands.
  /** Stable identity for the ledger; never reused. */
  memberId: string;
  /** Secret reconnect credential, sent only to this player. */
  token: string;
  sittingOut: boolean;
  /** Sat out automatically because they were disconnected when a hand was dealt */
  autoSatOut?: boolean;
  seated: boolean;                // Has bought in and is ready to play
  /** Mid-hand top-up target, applied after settlement as max(stack, target) */
  queuedAddOn?: number;
  /** Leaving or kicked while in a live hand; removed once the hand settles */
  pendingLeave?: 'leave' | 'kick';
}

export interface RoomStateView {
  code: string;
  hostSocketId: string;
  players: Array<{
    name: string;
    seatIndex: number;
    chips: number;
    connected: boolean;
    isHost: boolean;
    sittingOut: boolean;
    seated: boolean;
    queuedAddOn?: number;
    playerId: string;
    leaving: boolean;
  }>;
  settings: RoomSettings;
  ledger: LedgerRow[];
  state: 'lobby' | 'playing';
  maxSeats: number;
}

/** A player view of HandState — opponent hole cards filtered */
export interface PlayerView extends Omit<HandState, 'players'> {
  players: PlayerStateView[];
}

/** PlayerState with filtered hole cards */
export interface PlayerStateView extends Omit<PlayerState, 'holeCards'> {
  holeCards: (Card | null)[];     // null = face-down card (stud), [] = hidden
}

// ============================================================
// Socket Events
// ============================================================

/** Client → Server events */
export interface ClientToServerEvents {
  'create-room': (data: { playerName: string; settings: RoomSettings }) => void;
  'join-room': (data: { playerName: string; roomCode: string; token?: string }) => void;
  /** Buy-in in dollars */
  'sit-down': (data: { buyIn: number }) => void;
  'leave-room': () => void;
  'action': (data: { type: ActionType; amount?: number; handId: string; actionCount: number }) => void;
  'discard': (data: { cardIndices: number[]; handId: string; actionCount: number }) => void;
  'start-hand': () => void;
  'pick-variant': (data: { variant: GameVariant }) => void;
  'update-settings': (data: Partial<RoomSettings>) => void;
  /** Top up TO this many dollars (never "add X") */
  'add-on': (data: { amount: number }) => void;
  'pause-countdown': () => void;
  'resume-countdown': () => void;
  'kick-player': (data: { seatIndex: number }) => void;
  'sit-out': () => void;
  'sit-in': () => void;
  'stop-game': () => void;
}

/** Server → Client events */
export interface ServerToClientEvents {
  'room-created': (data: { roomCode: string; roomState: RoomStateView; yourPlayerId: string; token: string }) => void;
  'room-joined': (data: { roomState: RoomStateView; yourPlayerId: string; token: string; reconnected: boolean }) => void;
  'room-state': (data: RoomStateView) => void;
  'hand-state': (data: {
    handState: PlayerView;
    availableActions: AvailableActions | null;
    isYourTurn: boolean;
    lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number };
    handDescription?: string;
    sessionState?: {
      mode: string;
      handInVariant: number;
      handsPerVariant: number;
      rotationIndex: number;
      rotationLength: number;
      currentVariant: string | null;
      chooserSeatIndex: number | null;
      needsChoice: boolean;
      capBB: number | null;
      buttonSeat: number | null;
    };
    chipsBehind?: Record<string, number>;
  }) => void;
  'hand-complete': (data: {
    winners: WinnerInfo[];
    finalState: PlayerView;
    handDescriptions: Record<string, string>;
    lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number };
  }) => void;
  'player-joined': (data: { playerName: string; seatIndex: number }) => void;
  'player-left': (data: { playerName: string; seatIndex: number }) => void;
  'dc-choose': () => void;
  /** Kicked, or the room is gone: clear the stored reconnect token */
  'removed': (data: { reason: string; clearSeat: boolean }) => void;
  'countdown': (data: { seconds: number }) => void;
  'game-stopped': () => void;
  'error': (data: { message: string }) => void;
}

export type { GameVariant, ActionType, GameMode, WinnerInfo, HandState, AvailableActions, Card, BettingStructure };
