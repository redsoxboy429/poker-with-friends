// ============================================================
// useSocket — Socket.io connection layer for multiplayer
// ============================================================
// Singleton socket managed via React Context. The provider lives
// in main.tsx so the connection persists across route changes.
//
// Uses useReducer so each socket event triggers exactly ONE
// re-render instead of 3-5 separate setState calls.

import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  RoomStateView,
  PlayerView,
  RoomSettings,
} from '../../server/src/types';
import type { ActionType, AvailableActions, GameVariant, WinnerInfo } from './engine-wrapper';
import React from 'react';

// In production (combined deploy), VITE_SERVER_URL is empty → connect to same origin.
// In development, connects to the local server on :3001.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (
  typeof window !== 'undefined' && window.location.port !== '5173'
    ? window.location.origin  // Production: same-origin
    : 'http://localhost:3001' // Dev: separate server
);

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface SocketState {
  status: ConnectionStatus;
  roomState: RoomStateView | null;
  handState: PlayerView | null;
  availableActions: AvailableActions | null;
  isYourTurn: boolean;
  isHost: boolean;
  yourPlayerId: string | null;
  winners: WinnerInfo[] | null;
  finalState: PlayerView | null;
  countdown: number | null;
  dcChoosing: boolean;
  error: string | null;
  // Enriched server data
  lastAction: { playerId: string; type: string; amount?: number; discardCount?: number } | null;
  handDescription: string | null;
  handDescriptions: Record<string, string> | null;
  sessionState: { mode: string; handInVariant: number; handsPerVariant: number; rotationIndex: number; rotationLength: number; currentVariant: string | null; chooserSeatIndex: number | null; needsChoice?: boolean; capBB: number | null; buttonSeat?: number | null } | null;
  chipsBehind: Record<string, number> | null;
  /** Dealer's choice: who is picking the next game (the last hand is cleared meanwhile) */
  choosingPlayer: { name: string; seatIndex: number } | null;
}

export interface SocketActions {
  connect: () => void;
  disconnect: () => void;
  createRoom: (playerName: string, settings: RoomSettings) => void;
  joinRoom: (playerName: string, roomCode: string) => void;
  /** Buy in with a dollar amount */
  sitDown: (buyIn: number) => void;
  leaveRoom: () => void;
  sendAction: (type: ActionType, amount?: number) => void;
  sendDiscard: (cardIndices: number[]) => void;
  startHand: () => void;
  pickVariant: (variant: GameVariant) => void;
  updateSettings: (settings: Partial<RoomSettings>) => void;
  stopGame: () => void;
  addOn: (amount: number) => void;
  pauseCountdown: () => void;
  resumeCountdown: () => void;
  kickPlayer: (seatIndex: number) => void;
  sitOut: () => void;
  sitIn: () => void;
}

type SocketContextValue = [SocketState, SocketActions];

const SocketContext = createContext<SocketContextValue | null>(null);

// ============================================================
// Reducer — single state update per socket event
// ============================================================

const INITIAL_STATE: SocketState = {
  status: 'disconnected',
  roomState: null,
  handState: null,
  availableActions: null,
  isYourTurn: false,
  isHost: false,
  yourPlayerId: null,
  winners: null,
  finalState: null,
  countdown: null,
  dcChoosing: false,
  error: null,
  lastAction: null,
  handDescription: null,
  handDescriptions: null,
  sessionState: null,
  chipsBehind: null,
  choosingPlayer: null,
};

type SocketAction =
  | { type: 'SET_STATUS'; status: ConnectionStatus }
  | { type: 'ROOM_CREATED'; roomState: RoomStateView; yourPlayerId: string }
  | { type: 'ROOM_JOINED'; roomState: RoomStateView; yourPlayerId: string }
  | { type: 'ROOM_STATE'; roomState: RoomStateView; isHost: boolean }
  | { type: 'HAND_STATE'; handState: PlayerView; availableActions: AvailableActions | null; isYourTurn: boolean; lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number }; handDescription?: string; sessionState?: SocketState['sessionState']; chipsBehind?: Record<string, number> }
  | { type: 'HAND_COMPLETE'; winners: WinnerInfo[]; finalState: PlayerView; handDescriptions: Record<string, string>; lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number } }
  | { type: 'DC_CHOOSE' }
  | { type: 'CHOICE_PENDING'; chooser: { name: string; seatIndex: number } | null }
  | { type: 'DC_PICKED' }
  | { type: 'COUNTDOWN'; seconds: number }
  | { type: 'ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'LEAVE_ROOM' }
  | { type: 'GAME_STOPPED' }
  | { type: 'DISCONNECT' };

function socketReducer(state: SocketState, action: SocketAction): SocketState {
  switch (action.type) {
    case 'SET_STATUS':
      return action.status === 'connected'
        ? { ...state, status: action.status, error: null }
        : { ...state, status: action.status };

    case 'ROOM_CREATED':
      return { ...state, roomState: action.roomState, yourPlayerId: action.yourPlayerId, isHost: true };

    case 'ROOM_JOINED':
      return { ...state, roomState: action.roomState, yourPlayerId: action.yourPlayerId };

    case 'ROOM_STATE':
      return { ...state, roomState: action.roomState, isHost: action.isHost };

    case 'HAND_STATE': {
      const clearWinners = action.handState.phase !== 'complete' && action.handState.phase !== 'showdown';
      return {
        ...state,
        handState: action.handState,
        availableActions: action.availableActions,
        isYourTurn: action.isYourTurn,
        lastAction: action.lastAction ?? null,
        handDescription: action.handDescription ?? null,
        sessionState: action.sessionState ?? state.sessionState,
        chipsBehind: action.chipsBehind ?? null,
        choosingPlayer: null, // a hand is being dealt, so no choice is pending
        dcChoosing: false,
        ...(clearWinners ? { winners: null, finalState: null, handDescriptions: null, countdown: null } : {}),
      };
    }

    case 'HAND_COMPLETE':
      return {
        ...state,
        winners: action.winners,
        finalState: action.finalState,
        handDescriptions: action.handDescriptions,
        lastAction: action.lastAction ?? state.lastAction,
        handDescription: null, // Clear stale hand description
        isYourTurn: false,
        availableActions: null,
        // A hand can complete the moment it is dealt (all-in on the blinds): it still ends any pick
        choosingPlayer: null,
        dcChoosing: false,
      };

    case 'DC_CHOOSE':
      return { ...state, dcChoosing: true };

    case 'CHOICE_PENDING': {
      // null = no choice pending any more (the pick fell through or the table is waiting for players)
      if (!action.chooser) return { ...state, choosingPlayer: null, dcChoosing: false };
      const mySeat = state.roomState?.players.find(p => p.playerId === state.yourPlayerId)?.seatIndex;
      return { ...state, choosingPlayer: action.chooser, dcChoosing: action.chooser.seatIndex === mySeat };
    }

    case 'DC_PICKED':
      return { ...state, dcChoosing: false };

    case 'COUNTDOWN':
      return { ...state, countdown: action.seconds };

    case 'ERROR':
      return { ...state, error: action.message };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'GAME_STOPPED':
      return {
        ...state,
        handState: null,
        winners: null,
        finalState: null,
        countdown: null,
        availableActions: null,
        isYourTurn: false,
        dcChoosing: false,
        lastAction: null,
        handDescription: null,
        handDescriptions: null,
        sessionState: null,
        chipsBehind: null,
        choosingPlayer: null,
      };

    case 'LEAVE_ROOM':
      return { ...INITIAL_STATE, status: state.status, error: state.error };

    case 'DISCONNECT':
      return { ...INITIAL_STATE };

    default:
      return state;
  }
}

/**
 * Provider component — wrap the app in this so all routes share one socket.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const value = useSocketInternal();
  return React.createElement(SocketContext.Provider, { value }, children);
}

/**
 * Hook to consume the shared socket from any component.
 */
export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
  return ctx;
}

// ============================================================
// Internal hook — the actual socket logic (used once by provider)
// ============================================================

/** Reconnect credentials are kept per room so a refresh or dropped connection can resume the seat. */
const tokenKey = (roomCode: string) => `poker-token-${roomCode.toUpperCase()}`;
function readToken(roomCode: string): string | undefined {
  try { return localStorage.getItem(tokenKey(roomCode)) ?? undefined; } catch { return undefined; }
}
function writeToken(roomCode: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(tokenKey(roomCode), token);
    else localStorage.removeItem(tokenKey(roomCode));
  } catch { /* storage unavailable: reconnect falls back to a fresh join */ }
}

/** Does this browser hold a reconnect token for the room (e.g. after a refresh)? */
export function hasStoredSeat(roomCode: string): boolean {
  return !!readToken(roomCode);
}

function useSocketInternal(): SocketContextValue {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [state, dispatch] = useReducer(socketReducer, INITIAL_STATE);
  /** Room this client is in, for automatic rejoin after a reconnect */
  const roomRef = useRef<{ code: string; name: string } | null>(null);

  const connect = useCallback(() => {
    // One socket per client: socket.io reconnects it itself, so never open a second one.
    if (socketRef.current) return;

    dispatch({ type: 'SET_STATUS', status: 'connecting' });
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      dispatch({ type: 'SET_STATUS', status: 'connected' });
      // After a dropped connection, resume the same seat with the stored token.
      const room = roomRef.current;
      const token = room ? readToken(room.code) : undefined;
      if (room && token) socket.emit('join-room', { playerName: room.name, roomCode: room.code, token });
    });

    socket.on('disconnect', () => {
      dispatch({ type: 'SET_STATUS', status: 'disconnected' });
    });

    // Room events
    socket.on('room-created', (data) => {
      writeToken(data.roomCode, data.token);
      roomRef.current = { code: data.roomCode, name: data.roomState.players.find(p => p.playerId === data.yourPlayerId)?.name ?? '' };
      dispatch({ type: 'ROOM_CREATED', roomState: data.roomState, yourPlayerId: data.yourPlayerId });
    });

    socket.on('room-joined', (data) => {
      writeToken(data.roomState.code, data.token);
      roomRef.current = { code: data.roomState.code, name: data.roomState.players.find(p => p.playerId === data.yourPlayerId)?.name ?? '' };
      dispatch({ type: 'ROOM_JOINED', roomState: data.roomState, yourPlayerId: data.yourPlayerId });
    });

    socket.on('removed', (data) => {
      // A takeover by another window keeps the token: that window owns the seat now.
      if (roomRef.current && data.clearSeat) writeToken(roomRef.current.code, null);
      roomRef.current = null;
      dispatch({ type: 'LEAVE_ROOM' });
      dispatch({ type: 'ERROR', message: data.reason });
    });

    socket.on('room-state', (data) => {
      dispatch({ type: 'ROOM_STATE', roomState: data, isHost: data.hostSocketId === socket.id });
    });

    // Hand events — single dispatch per event (no more 5 separate setStates)
    socket.on('hand-state', (data) => {
      dispatch({
        type: 'HAND_STATE',
        handState: data.handState,
        availableActions: data.availableActions,
        isYourTurn: data.isYourTurn,
        lastAction: data.lastAction,
        handDescription: data.handDescription,
        sessionState: data.sessionState,
        chipsBehind: data.chipsBehind,
      });
    });

    socket.on('hand-complete', (data) => {
      dispatch({
        type: 'HAND_COMPLETE',
        winners: data.winners,
        finalState: data.finalState,
        handDescriptions: data.handDescriptions ?? {},
        lastAction: data.lastAction,
      });
    });

    socket.on('dc-choose', () => {
      dispatch({ type: 'DC_CHOOSE' });
    });

    socket.on('choice-pending', (data) => {
      dispatch({ type: 'CHOICE_PENDING', chooser: data.chooser });
    });

    socket.on('game-stopped', () => {
      dispatch({ type: 'GAME_STOPPED' });
    });

    socket.on('countdown', (data) => {
      dispatch({ type: 'COUNTDOWN', seconds: data.seconds });
    });

    socket.on('error', (data) => {
      dispatch({ type: 'ERROR', message: data.message });
      // Auto-clear errors after 5 seconds
      setTimeout(() => dispatch({ type: 'CLEAR_ERROR' }), 5000);
    });

    socketRef.current = socket;
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    dispatch({ type: 'DISCONNECT' });
  }, []);

  // Clean up on unmount (app-level — only when entire app is destroyed)
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const createRoom = useCallback((playerName: string, settings: RoomSettings) => {
    socketRef.current?.emit('create-room', { playerName, settings });
  }, []);

  const joinRoom = useCallback((playerName: string, roomCode: string) => {
    const code = roomCode.toUpperCase();
    socketRef.current?.emit('join-room', { playerName, roomCode: code, token: readToken(code) });
  }, []);

  const sitDown = useCallback((buyIn: number) => {
    socketRef.current?.emit('sit-down', { buyIn });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave-room');
    if (roomRef.current) writeToken(roomRef.current.code, null);
    roomRef.current = null;
    dispatch({ type: 'LEAVE_ROOM' });
  }, []);

  const sendAction = useCallback((type: ActionType, amount?: number) => {
    if (!state.handState) return;
    socketRef.current?.emit('action', { type, amount, handId: state.handState.id, actionCount: state.handState.actionHistory.length });
  }, [state.handState]);

  const sendDiscard = useCallback((cardIndices: number[]) => {
    if (!state.handState) return;
    socketRef.current?.emit('discard', { cardIndices, handId: state.handState.id, actionCount: state.handState.actionHistory.length });
  }, [state.handState]);

  const startHand = useCallback(() => {
    socketRef.current?.emit('start-hand');
  }, []);

  const pickVariant = useCallback((variant: GameVariant) => {
    socketRef.current?.emit('pick-variant', { variant });
    dispatch({ type: 'DC_PICKED' });
  }, []);

  const updateSettings = useCallback((settings: Partial<RoomSettings>) => {
    socketRef.current?.emit('update-settings', settings);
  }, []);

  const addOn = useCallback((amount: number) => {
    socketRef.current?.emit('add-on', { amount });
  }, []);

  const pauseCountdown = useCallback(() => {
    socketRef.current?.emit('pause-countdown');
  }, []);

  const resumeCountdown = useCallback(() => {
    socketRef.current?.emit('resume-countdown');
  }, []);

  const kickPlayer = useCallback((seatIndex: number) => {
    socketRef.current?.emit('kick-player', { seatIndex });
  }, []);

  const sitOut = useCallback(() => {
    socketRef.current?.emit('sit-out');
  }, []);

  const sitIn = useCallback(() => {
    socketRef.current?.emit('sit-in');
  }, []);

  const stopGame = useCallback(() => {
    socketRef.current?.emit('stop-game');
  }, []);

  const actions: SocketActions = {
    connect,
    disconnect,
    createRoom,
    joinRoom,
    sitDown,
    leaveRoom,
    sendAction,
    sendDiscard,
    startHand,
    pickVariant,
    updateSettings,
    addOn,
    pauseCountdown,
    resumeCountdown,
    kickPlayer,
    sitOut,
    sitIn,
    stopGame,
  };

  return [state, actions];
}
