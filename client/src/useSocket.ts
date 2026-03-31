// ============================================================
// useSocket — Socket.io connection layer for multiplayer
// ============================================================
// Singleton socket managed via React Context. The provider lives
// in main.tsx so the connection persists across route changes.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  addOn: (amount: number) => void;
  sitOut: () => void;
  sitIn: () => void;
}

type SocketContextValue = [SocketState, SocketActions];

const SocketContext = createContext<SocketContextValue | null>(null);

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

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [roomState, setRoomState] = useState<RoomStateView | null>(null);
  const [handState, setHandState] = useState<PlayerView | null>(null);
  const [availableActions, setAvailableActions] = useState<AvailableActions | null>(null);
  const [isYourTurn, setIsYourTurn] = useState(false);
  const [yourPlayerId, setYourPlayerId] = useState<string | null>(null);
  const [winners, setWinners] = useState<WinnerInfo[] | null>(null);
  const [finalState, setFinalState] = useState<PlayerView | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [dcChoosing, setDcChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    setStatus('connecting');
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      setStatus('connected');
      setError(null);
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    // Room events
    socket.on('room-created', (data) => {
      setRoomState(data.roomState);
      setYourPlayerId('p0');
      setIsHost(true);
    });

    socket.on('room-joined', (data) => {
      setRoomState(data.roomState);
      setYourPlayerId(data.yourPlayerId);
      setIsHost(false);
    });

    socket.on('room-state', (data) => {
      setRoomState(data);
      // Update host status (may change if original host disconnects)
      if (socket.id) {
        const me = data.players.find(p => p.isHost);
        // Check via hostSocketId — but client doesn't know its socketId easily
        // Instead, check if our playerId matches the host player's
        setIsHost(data.hostSocketId === socket.id);
      }
    });

    // Hand events
    socket.on('hand-state', (data) => {
      setHandState(data.handState);
      setAvailableActions(data.availableActions);
      setIsYourTurn(data.isYourTurn);
      // Clear winners when new hand state arrives (unless showdown)
      if (data.handState.phase !== 'complete' && data.handState.phase !== 'showdown') {
        setWinners(null);
        setFinalState(null);
      }
    });

    socket.on('hand-complete', (data) => {
      setWinners(data.winners);
      setFinalState(data.finalState);
      setIsYourTurn(false);
      setAvailableActions(null);
    });

    socket.on('dc-choose', () => {
      setDcChoosing(true);
    });

    socket.on('countdown', (data) => {
      setCountdown(data.seconds);
    });

    socket.on('error', (data) => {
      setError(data.message);
      // Auto-clear errors after 5 seconds
      setTimeout(() => setError(null), 5000);
    });

    socketRef.current = socket;
  }, []);

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setStatus('disconnected');
    setRoomState(null);
    setHandState(null);
    setAvailableActions(null);
    setIsYourTurn(false);
    setIsHost(false);
    setYourPlayerId(null);
    setWinners(null);
    setFinalState(null);
    setCountdown(null);
    setDcChoosing(false);
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
    setRoomState(null);
    setHandState(null);
    setWinners(null);
    setFinalState(null);
    setYourPlayerId(null);
    setIsHost(false);
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
    setDcChoosing(false);
  }, []);

  const updateSettings = useCallback((settings: Partial<RoomSettings>) => {
    socketRef.current?.emit('update-settings', settings);
  }, []);

  const addOn = useCallback((amount: number) => {
    socketRef.current?.emit('add-on', { amount });
  }, []);

  const sitOut = useCallback(() => {
    socketRef.current?.emit('sit-out');
  }, []);

  const sitIn = useCallback(() => {
    socketRef.current?.emit('sit-in');
  }, []);

  const state: SocketState = {
    status,
    roomState,
    handState,
    availableActions,
    isYourTurn,
    isHost,
    yourPlayerId,
    winners,
    finalState,
    countdown,
    dcChoosing,
    error,
  };

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
    sitOut,
    sitIn,
  };

  return [state, actions];
}
