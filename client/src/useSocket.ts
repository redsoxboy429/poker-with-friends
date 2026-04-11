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
  sessionState: { mode: string; handInVariant: number; handsPerVariant: number; rotationIndex: number; rotationLength: number; currentVariant: string | null; chooserSeatIndex: number | null; capBB: number | null } | null;
  chipsBehind: Record<string, number> | null;
}

export interface SocketActions {
  connect: () => void;
  disconnect: () => void;
  createRoom: (playerName: string, settings: RoomSettings) => void;
  joinRoom: (playerName: string, roomCode: string) => void;
  sitDown: (buyInBB: number) => void;
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
};

type SocketAction =
  | { type: 'SET_STATUS'; status: ConnectionStatus }
  | { type: 'ROOM_CREATED'; roomState: RoomStateView }
  | { type: 'ROOM_JOINED'; roomState: RoomStateView; yourPlayerId: string }
  | { type: 'ROOM_STATE'; roomState: RoomStateView; isHost: boolean }
  | { type: 'HAND_STATE'; handState: PlayerView; availableActions: AvailableActions | null; isYourTurn: boolean; lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number }; handDescription?: string; sessionState?: any; chipsBehind?: Record<string, number> }
  | { type: 'HAND_COMPLETE'; winners: WinnerInfo[]; finalState: PlayerView; handDescriptions: Record<string, string>; lastAction?: { playerId: string; type: string; amount?: number; discardCount?: number } }
  | { type: 'DC_CHOOSE' }
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
      return { ...state, roomState: action.roomState, yourPlayerId: 'p0', isHost: true };

    case 'ROOM_JOINED':
      return { ...state, roomState: action.roomState, yourPlayerId: action.yourPlayerId, isHost: false };

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
        chipsBehind: action.chipsBehind ?? state.chipsBehind,
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
      };

    case 'DC_CHOOSE':
      return { ...state, dcChoosing: true };

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
      };

    case 'LEAVE_ROOM':
      return {
        ...state,
        roomState: null,
        handState: null,
        winners: null,
        finalState: null,
        yourPlayerId: null,
        isHost: false,
      };

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

function useSocketInternal(): SocketContextValue {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [state, dispatch] = useReducer(socketReducer, INITIAL_STATE);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    dispatch({ type: 'SET_STATUS', status: 'connecting' });
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      dispatch({ type: 'SET_STATUS', status: 'connected' });
    });

    socket.on('disconnect', () => {
      dispatch({ type: 'SET_STATUS', status: 'disconnected' });
    });

    // Room events
    socket.on('room-created', (data) => {
      dispatch({ type: 'ROOM_CREATED', roomState: data.roomState });
    });

    socket.on('room-joined', (data) => {
      dispatch({ type: 'ROOM_JOINED', roomState: data.roomState, yourPlayerId: data.yourPlayerId });
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
    socketRef.current?.emit('join-room', { playerName, roomCode: roomCode.toUpperCase() });
  }, []);

  const sitDown = useCallback((buyInBB: number) => {
    socketRef.current?.emit('sit-down', { buyInBB });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit('leave-room');
    dispatch({ type: 'LEAVE_ROOM' });
  }, []);

  const sendAction = useCallback((type: ActionType, amount?: number) => {
    socketRef.current?.emit('action', { type, amount });
  }, []);

  const sendDiscard = useCallback((cardIndices: number[]) => {
    socketRef.current?.emit('discard', { cardIndices });
  }, []);

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
