// ============================================================
// Poker Server — Express + Socket.io entry point
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { RoomManager, SeatGoneError, type Room } from './room-manager.js';
import { GameController } from './game-controller.js';
import type { ClientToServerEvents, ServerToClientEvents, RoomPlayer } from './types.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager();

// ============================================================
// Static file serving (production) — serve built client
// ============================================================

const clientDistPath = path.resolve(__dirname, '../../client/dist');

// Health check (always available)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: roomManager.getRoomCount() });
});

if (NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
  // SPA catch-all. Express 5 requires named wildcard params: {*path}
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// ============================================================
// Helpers
// ============================================================

type PokerSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function broadcastRoom(room: Room): void {
  io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Run a handler, turning any exception into an error event for this socket only. */
function guarded(socket: PokerSocket, fallback: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    socket.emit('error', { message: errorMessage(err, fallback) });
  }
}

/** Tell the room a player left, and tell a kicked player to forget their seat. */
function announceDeparture(room: Room, player: RoomPlayer, kicked: boolean): void {
  const target = io.sockets.sockets.get(player.socketId);
  if (target) {
    if (kicked) target.emit('removed', { reason: 'You were removed by the host', clearSeat: true });
    target.leave(room.code);
  }
  io.to(room.code).emit('player-left', { playerName: player.name, seatIndex: player.seatIndex });
}

// ============================================================
// Socket.io connection handler
// ============================================================

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // Reject malformed payloads before any handler destructures them.
  const objectEvents = new Set(['create-room', 'join-room', 'sit-down', 'action', 'discard', 'pick-variant', 'update-settings', 'add-on', 'kick-player']);
  socket.use(([event, payload], next) => {
    if (objectEvents.has(event) && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
      socket.emit('error', { message: `Invalid ${event} payload` });
      return;
    }
    next();
  });

  // ---- Room Creation ----
  socket.on('create-room', ({ playerName, settings }) => guarded(socket, 'Failed to create room', () => {
    if (roomManager.getRoomForSocket(socket.id)) throw new Error('Already in a room');
    const roomCode = roomManager.createRoom(socket.id, playerName, settings);
    const room = roomManager.getRoom(roomCode)!;
    const host = room.players.get(socket.id)!;
    socket.join(roomCode);
    socket.emit('room-created', {
      roomCode,
      roomState: roomManager.getRoomStateView(room),
      yourPlayerId: host.playerId,
      token: host.token,
    });
    console.log(`[room] ${host.name} created room ${roomCode}`);
  }));

  // ---- Room Joining / Reconnecting ----
  socket.on('join-room', ({ playerName, roomCode, token }) => guarded(socket, 'Failed to join room', () => {
    const current = roomManager.getRoomForSocket(socket.id);
    if (current && current.code !== String(roomCode).toUpperCase()) throw new Error('Already in another room');
    // One seat per connection: a second join from the same socket is only a token refresh of its own seat.
    if (current && current.players.get(socket.id)?.token !== token) throw new Error('Already in this room');
    let result;
    try {
      result = roomManager.joinRoom(socket.id, playerName, roomCode, token);
    } catch (err) {
      if (err instanceof SeatGoneError) {
        socket.emit('removed', { reason: err.message, clearSeat: true });
        return;
      }
      throw err;
    }
    const room = roomManager.getRoom(roomCode)!;
    const player = room.players.get(socket.id)!;

    // A reconnect from a new tab takes the seat over from the old socket.
    if (result.replacedSocketId) {
      const old = io.sockets.sockets.get(result.replacedSocketId);
      if (old) {
        // The new window now owns the stored token, so the old one must not clear it.
        old.emit('removed', { reason: 'This seat was opened in another window', clearSeat: false });
        old.leave(room.code);
      }
    }

    socket.join(room.code);
    socket.emit('room-joined', {
      roomState: roomManager.getRoomStateView(room),
      yourPlayerId: result.playerId,
      token: result.token,
      reconnected: result.reconnected,
    });
    if (!result.reconnected) {
      socket.to(room.code).emit('player-joined', { playerName: player.name, seatIndex: result.seatIndex });
    }
    broadcastRoom(room);
    if (result.reconnected) room.gameController?.handlePlayerReconnected(result.playerId);
    console.log(`[room] ${player.name} ${result.reconnected ? 'reconnected to' : 'joined'} room ${room.code} at seat ${result.seatIndex}`);
  }));

  // ---- Leave Room ----
  socket.on('leave-room', () => {
    const result = roomManager.leaveRoom(socket.id);
    if (!result) return;
    const { room, player, status } = result;
    socket.leave(room.code);
    if (status === 'removed') announceDeparture(room, player, false);
    broadcastRoom(room);
  });

  // ---- Sit Down (buy in at the table, in dollars) ----
  socket.on('sit-down', ({ buyIn }) => guarded(socket, 'Failed to sit down', () => {
    const chips = roomManager.sitDown(socket.id, buyIn);
    const room = roomManager.getRoomForSocket(socket.id)!;
    broadcastRoom(room);
    room.gameController?.autoResumeIfReady();
    console.log(`[room] ${roomManager.getPlayer(socket.id)?.name} sat down in room ${room.code} with $${chips.toFixed(2)}`);
  }));

  // ---- Start Hand (Host Only) ----
  socket.on('start-hand', () => guarded(socket, 'Failed to start hand', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    if (room.hostSocketId !== socket.id) throw new Error('Only the host can start hands');
    if (!room.gameController) room.gameController = new GameController(room, createCallbacks(room.code));
    room.gameController.startHand();
  }));

  // ---- Player Action ----
  socket.on('action', (payload) => guarded(socket, 'Invalid action', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    if (!room.gameController.acceptsVersion(payload.handId, payload.actionCount)) {
      throw new Error('Action is stale; wait for the current hand state');
    }
    room.gameController.handleAction(socket.id, payload.type, payload.amount);
  }));

  // ---- Discard (Draw Games) ----
  socket.on('discard', (payload) => guarded(socket, 'Invalid discard', () => {
    if (!Array.isArray(payload.cardIndices)) throw new Error('Invalid discard');
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    if (!room.gameController.acceptsVersion(payload.handId, payload.actionCount)) {
      throw new Error('Discard is stale; wait for the current hand state');
    }
    room.gameController.handleDiscard(socket.id, payload.cardIndices);
  }));

  // ---- Dealer's Choice Pick ----
  socket.on('pick-variant', ({ variant }) => guarded(socket, 'Invalid variant', () => {
    if (typeof variant !== 'string') throw new Error('Invalid variant');
    const room = roomManager.getRoomForSocket(socket.id);
    const player = roomManager.getPlayer(socket.id);
    if (!room?.gameController || !player) return;
    room.gameController.handleVariantPick(player.playerId, variant);
  }));

  // ---- Update Settings (Host Only) ----
  socket.on('update-settings', (updates) => guarded(socket, 'Failed to update settings', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) throw new Error('Not in a room');
    if (room.hostSocketId !== socket.id) throw new Error('Only the host can update settings');
    const before = room.settings;
    const next = roomManager.updateSettings(socket.id, updates);
    // Only a real mode change (or a new game in Specific mode) rebuilds the rotation.
    const modeChanged = next.gameMode !== before.gameMode ||
      (next.gameMode === 'specific' && next.variant !== before.variant);
    if (modeChanged && room.gameController) {
      try {
        room.gameController.updateGameMode(next.gameMode, next.variant);
      } catch (err) {
        room.settings = before; // keep settings and session consistent
        throw err;
      }
    }
    broadcastRoom(room);
  }));

  // ---- Kick Player (Host Only) ----
  socket.on('kick-player', ({ seatIndex }) => {
    const result = roomManager.kickPlayer(socket.id, seatIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot kick this player' });
      return;
    }
    const { room, player, status } = result;
    if (status === 'removed') announceDeparture(room, player, true);
    broadcastRoom(room);
    console.log(`[room] ${player.name} was kicked from room ${room.code} (${status})`);
  });

  // ---- Stop Game (Host Only — returns everyone to lobby, between hands only) ----
  socket.on('stop-game', () => guarded(socket, 'Failed to stop game', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    if (room.hostSocketId !== socket.id) throw new Error('Only the host can stop the game');
    const hand = room.gameController?.getState();
    if (hand && hand.phase !== 'complete') throw new Error('Finish the current hand before stopping; use Pause to wait');
    room.gameController?.destroy();
    room.gameController = null;
    room.state = 'lobby';
    io.to(room.code).emit('game-stopped');
    broadcastRoom(room);
    console.log(`[room] Host stopped game in room ${room.code}`);
  }));

  // ---- Sit Out / Sit In ----
  socket.on('sit-out', () => {
    const player = roomManager.getPlayer(socket.id);
    const room = roomManager.getRoomForSocket(socket.id);
    if (!player || !room) return;
    player.sittingOut = true;
    player.autoSatOut = false;
    room.gameController?.handleSeatVacated(player.seatIndex);
    broadcastRoom(room);
  });

  socket.on('sit-in', () => {
    const player = roomManager.getPlayer(socket.id);
    const room = roomManager.getRoomForSocket(socket.id);
    if (!player || !room) return;
    player.sittingOut = false;
    player.autoSatOut = false;
    broadcastRoom(room);
    room.gameController?.autoResumeIfReady();
  });

  // ---- Pause / Resume (Host Only) ----
  socket.on('pause-countdown', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController || room.hostSocketId !== socket.id) return;
    room.gameController.pauseCountdown();
  });

  socket.on('resume-countdown', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController || room.hostSocketId !== socket.id) return;
    room.gameController.resumeCountdown();
  });

  // ---- Top up TO an amount (applied now between hands, after settlement mid-hand) ----
  socket.on('add-on', ({ amount }) => guarded(socket, 'Failed to top up', () => {
    const status = roomManager.topUp(socket.id, amount);
    const room = roomManager.getRoomForSocket(socket.id)!;
    broadcastRoom(room);
    if (status === 'applied') room.gameController?.autoResumeIfReady();
  }));

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const result = roomManager.handleDisconnect(socket.id);
    if (result) broadcastRoom(result.room);
    console.log(`[disconnect] ${socket.id}`);
  });
});

// ============================================================
// Callback factory — bridges GameController with Socket.io
// ============================================================

function createCallbacks(roomCode: string) {
  return {
    sendHandState(socketId: string, handState: any, actions: any, isYourTurn: boolean, lastAction?: any, handDescription?: string, sessionState?: any, chipsBehind?: Record<string, number>) {
      io.to(socketId).emit('hand-state', { handState, availableActions: actions, isYourTurn, lastAction, handDescription, sessionState, chipsBehind });
    },
    sendHandComplete(socketId: string, winners: any, finalState: any, handDescriptions: Record<string, string>, lastAction?: any) {
      io.to(socketId).emit('hand-complete', { winners, finalState, handDescriptions, lastAction });
    },
    sendDcChoose(socketId: string) {
      io.to(socketId).emit('dc-choose');
    },
    broadcastCountdown(code: string, seconds: number) {
      io.to(code).emit('countdown', { seconds });
    },
    sendError(socketId: string, message: string) {
      io.to(socketId).emit('error', { message });
    },
    broadcastRoomState(code: string) {
      const room = roomManager.getRoom(code);
      if (room) broadcastRoom(room);
    },
    onHandSettled(code: string) {
      const room = roomManager.getRoom(code);
      if (!room) return;
      for (const player of roomManager.finalizeDepartures(room)) {
        announceDeparture(room, player, player.pendingLeave === 'kick');
      }
    },
  };
}

// ============================================================
// Start server
// ============================================================

httpServer.listen(PORT, () => {
  console.log(`Poker server listening on port ${PORT}`);
  console.log(`Accepting connections from: ${CLIENT_ORIGIN}`);
});
