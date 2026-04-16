// ============================================================
// Poker Server — Express + Socket.io entry point
// ============================================================

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { RoomManager } from './room-manager.js';
import { GameController } from './game-controller.js';
import { getPlayerView } from './state-filter.js';
import type { ClientToServerEvents, ServerToClientEvents, RoomSettings } from './types.js';

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
  connectionStateRecovery: {
    maxDisconnectionDuration: 60_000,
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

// Serve client static files in production
if (NODE_ENV === 'production') {
  app.use(express.static(clientDistPath));
}

// SPA catch-all — serve index.html for all non-API routes (production)
// Must come after static middleware and API routes
// Express 5 requires named wildcard params: {*path}
if (NODE_ENV === 'production') {
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// ============================================================
// Socket.io connection handler
// ============================================================

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ---- Room Creation ----
  socket.on('create-room', ({ playerName, settings }) => {
    try {
      const roomCode = roomManager.createRoom(socket.id, playerName, settings);
      const room = roomManager.getRoom(roomCode)!;
      socket.join(roomCode);

      socket.emit('room-created', {
        roomCode,
        roomState: roomManager.getRoomStateView(room),
      });
      console.log(`[room] ${playerName} created room ${roomCode}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create room';
      socket.emit('error', { message });
    }
  });

  // ---- Room Joining ----
  socket.on('join-room', ({ playerName, roomCode }) => {
    try {
      const { seatIndex, playerId } = roomManager.joinRoom(socket.id, playerName, roomCode);
      const room = roomManager.getRoom(roomCode)!;
      socket.join(room.code);

      // Send room state to the joining player
      socket.emit('room-joined', {
        roomState: roomManager.getRoomStateView(room),
        yourPlayerId: playerId,
      });

      // Notify all other players
      socket.to(room.code).emit('player-joined', {
        playerName,
        seatIndex,
      });

      // Broadcast updated room state
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));

      // If reconnecting mid-hand, send current game state
      if (room.gameController && room.state === 'playing') {
        const gameState = room.gameController.getState();
        if (gameState) {
          // Import at top of file handles this
          const view = getPlayerView(gameState, playerId);
          const activePlayer = gameState.players[gameState.activePlayerIndex];
          const isYourTurn = activePlayer?.id === playerId;

          socket.emit('hand-state', {
            handState: view,
            availableActions: null, // Will get proper actions on next state broadcast
            isYourTurn,
          });
        }
      }

      console.log(`[room] ${playerName} joined room ${room.code} at seat ${seatIndex}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to join room';
      socket.emit('error', { message });
    }
  });

  // ---- Leave Room ----
  socket.on('leave-room', () => {
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      const { room, player } = result;
      socket.leave(room.code);
      io.to(room.code).emit('player-left', {
        playerName: player.name,
        seatIndex: player.seatIndex,
      });
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
    }
  });

  // ---- Sit Down (buy in at the table) ----
  socket.on('sit-down', ({ buyInBB }) => {
    try {
      roomManager.sitDown(socket.id, buyInBB);
      const room = roomManager.getRoomForSocket(socket.id)!;
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
      // Auto-resume countdown if enough players are now seated
      room.gameController?.autoResumeIfReady();
      console.log(`[room] ${roomManager.getPlayer(socket.id)?.name} sat down in room ${room.code} with ${buyInBB} BB`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to sit down';
      socket.emit('error', { message });
    }
  });

  // ---- Start Hand (Host Only) ----
  socket.on('start-hand', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Only the host can start hands' });
      return;
    }

    // Create game controller if needed
    if (!room.gameController) {
      room.gameController = new GameController(room, createCallbacks(room.code));
    }

    try {
      room.gameController.startHand();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start hand';
      console.error('[server] start-hand error:', message);
      socket.emit('error', { message });
    }
  });

  // ---- Player Action ----
  socket.on('action', ({ type, amount }) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    room.gameController.handleAction(socket.id, type, amount);
  });

  // ---- Discard (Draw Games) ----
  socket.on('discard', ({ cardIndices }) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    room.gameController.handleDiscard(socket.id, cardIndices);
  });

  // ---- Dealer's Choice Pick ----
  socket.on('pick-variant', ({ variant }) => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    const player = roomManager.getPlayer(socket.id);
    if (!player) return;
    room.gameController.handleVariantPick(player.playerId, variant);
  });

  // ---- Update Settings (Host Only) ----
  socket.on('update-settings', (updates) => {
    try {
      const room = roomManager.getRoomForSocket(socket.id);
      if (!room) { socket.emit('error', { message: 'Not in a room' }); return; }
      if (room.hostSocketId !== socket.id) { socket.emit('error', { message: 'Only the host can update settings' }); return; }

      // If game mode changed during play, update the game controller's session
      if (room.state === 'playing' && room.gameController && (updates.gameMode || updates.variant)) {
        room.gameController.updateGameMode(
          updates.gameMode || room.settings.gameMode,
          updates.variant || room.settings.variant
        );
      }

      // Update room settings (works in both lobby and playing)
      roomManager.updateSettingsPlaying(socket.id, updates);
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update settings';
      socket.emit('error', { message });
    }
  });

  // ---- Kick Player (Host Only) ----
  socket.on('kick-player', ({ seatIndex }) => {
    const result = roomManager.kickPlayer(socket.id, seatIndex);
    if (!result) {
      socket.emit('error', { message: 'Cannot kick this player' });
      return;
    }
    const { room, player } = result;
    // Notify the kicked player
    const kickedSocket = io.sockets.sockets.get(player.socketId);
    if (kickedSocket) {
      kickedSocket.emit('error', { message: 'You were kicked by the host' });
      kickedSocket.leave(room.code);
    }
    // Broadcast to room
    io.to(room.code).emit('player-left', { playerName: player.name, seatIndex: player.seatIndex });
    io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
    console.log(`[room] ${player.name} was kicked from room ${room.code}`);
  });

  // ---- Stop Game (Host Only — returns everyone to lobby) ----
  socket.on('stop-game', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room) return;
    if (room.hostSocketId !== socket.id) {
      socket.emit('error', { message: 'Only the host can stop the game' });
      return;
    }
    // Destroy game controller (clears timers)
    if (room.gameController) {
      room.gameController.destroy();
      room.gameController = null;
    }
    room.state = 'lobby';
    // Notify all players
    io.to(room.code).emit('game-stopped');
    io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
    console.log(`[room] Host stopped game in room ${room.code}`);
  });

  // ---- Sit Out / Sit In ----
  socket.on('sit-out', () => {
    const player = roomManager.getPlayer(socket.id);
    if (player) {
      player.sittingOut = true;
      const room = roomManager.getRoomForSocket(socket.id);
      if (room) {
        io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
      }
    }
  });

  socket.on('sit-in', () => {
    const player = roomManager.getPlayer(socket.id);
    if (player) {
      player.sittingOut = false;
      const room = roomManager.getRoomForSocket(socket.id);
      if (room) {
        io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
        // Auto-resume countdown if now >= 2 active players
        room.gameController?.autoResumeIfReady();
      }
    }
  });

  // ---- Pause / Resume Countdown (Host Only) ----
  socket.on('pause-countdown', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    if (room.hostSocketId !== socket.id) return;
    room.gameController.pauseCountdown();
  });

  socket.on('resume-countdown', () => {
    const room = roomManager.getRoomForSocket(socket.id);
    if (!room?.gameController) return;
    if (room.hostSocketId !== socket.id) return;
    room.gameController.resumeCountdown();
  });

  // ---- Add-On (top up chips — immediate if between hands, queued during active hand) ----
  socket.on('add-on', ({ amount }) => {
    const player = roomManager.getPlayer(socket.id);
    const room = roomManager.getRoomForSocket(socket.id);
    if (!player || !room) return;

    if (!player.seated) {
      socket.emit('error', { message: 'Must be seated to add on' });
      return;
    }

    // Validate amount — must be between current effective chips and max buy-in
    const maxBuyIn = 300 * room.settings.bigBlind;
    const currentEffective = Math.max(player.chips, player.queuedAddOn ?? 0);
    if (amount < currentEffective || amount > maxBuyIn) {
      socket.emit('error', { message: `Add-on must be between $${currentEffective.toFixed(2)} and $${maxBuyIn.toFixed(2)}` });
      return;
    }

    // Determine if a hand is in progress
    const handInProgress = room.state === 'playing' && !!room.gameController?.getState();

    if (handInProgress) {
      // Queue the add-on — takes effect on next hand
      player.queuedAddOn = amount;
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
      console.log(`[room] ${player.name} queued add-on of $${amount.toFixed(2)} in room ${room.code}`);
    } else {
      // Apply immediately (between hands or in lobby)
      player.chips = amount;
      player.queuedAddOn = undefined;
      player.sittingOut = false; // Re-enter if sitting out
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
      // Auto-resume countdown if this tipped us to 2+ active players
      room.gameController?.autoResumeIfReady();
      console.log(`[room] ${player.name} added on to $${amount.toFixed(2)} in room ${room.code}`);
    }
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const result = roomManager.handleDisconnect(socket.id);
    if (result) {
      const { room, player } = result;
      io.to(room.code).emit('player-left', {
        playerName: player.name,
        seatIndex: player.seatIndex,
      });
      io.to(room.code).emit('room-state', roomManager.getRoomStateView(room));
    }
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
      if (room) {
        io.to(code).emit('room-state', roomManager.getRoomStateView(room));
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
