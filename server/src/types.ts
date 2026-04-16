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
}

export interface RoomPlayer {
  socketId: string;
  name: string;
  seatIndex: number;
  chips: number;
  connected: boolean;
  playerId: string;               // Engine player ID (p0, p1, etc.)
  sittingOut: boolean;
  seated: boolean;                // Has bought in and is ready to play
  queuedAddOn?: number;           // Pending add-on amount (applied on next hand)
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
  }>;
  settings: RoomSettings;
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
  'join-room': (data: { playerName: string; roomCode: string }) => void;
  'sit-down': (data: { buyInBB: number }) => void;
  'leave-room': () => void;
  'action': (data: { type: ActionType; amount?: number }) => void;
  'discard': (data: { cardIndices: number[] }) => void;
  'start-hand': () => void;
  'pick-variant': (data: { variant: GameVariant }) => void;
  'update-settings': (data: Partial<RoomSettings>) => void;
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
  'room-created': (data: { roomCode: string; roomState: RoomStateView }) => void;
  'room-joined': (data: { roomState: RoomStateView; yourPlayerId: string }) => void;
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
      capBB: number | null;
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
  'countdown': (data: { seconds: number }) => void;
  'game-stopped': () => void;
  'error': (data: { message: string }) => void;
}

export type { GameVariant, ActionType, GameMode, WinnerInfo, HandState, AvailableActions, Card, BettingStructure };
