// ============================================================
// Room Manager — Room lifecycle, player seat assignment
// ============================================================

import { nanoid, customAlphabet } from 'nanoid';
import type { RoomSettings, RoomPlayer, RoomStateView } from './types.js';
import { GameController } from './game-controller.js';

// No ambiguous chars: I/L/O/0/1
const generateCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);

const MAX_SEATS = 6;
const RECONNECT_GRACE_MS = 60_000; // 60 seconds

export interface Room {
  code: string;
  hostSocketId: string;
  players: Map<string, RoomPlayer>;  // socketId → player
  seatMap: (string | null)[];        // seatIndex → socketId
  gameController: GameController | null;
  settings: RoomSettings;
  state: 'lobby' | 'playing';
  /** Timers for disconnected players (socketId → timeout) */
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** Reverse lookup: socketId → roomCode */
  private socketToRoom = new Map<string, string>();

  /** Create a new room. Returns the room code. */
  createRoom(hostSocketId: string, hostName: string, settings: RoomSettings): string {
    let code = generateCode();
    // Avoid collisions (astronomically unlikely at this scale)
    while (this.rooms.has(code)) {
      code = generateCode();
    }

    const room: Room = {
      code,
      hostSocketId,
      players: new Map(),
      seatMap: new Array(MAX_SEATS).fill(null),
      gameController: null,
      settings,
      state: 'lobby',
      disconnectTimers: new Map(),
    };

    // Host sits at seat 0
    const hostPlayer: RoomPlayer = {
      socketId: hostSocketId,
      name: hostName,
      seatIndex: 0,
      chips: settings.startingChips,
      connected: true,
      playerId: 'p0',
      sittingOut: false,
    };
    room.players.set(hostSocketId, hostPlayer);
    room.seatMap[0] = hostSocketId;

    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);

    return code;
  }

  /** Join an existing room. Returns the assigned seat index, or throws. */
  joinRoom(socketId: string, playerName: string, roomCode: string): { seatIndex: number; playerId: string } {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error('Room not found');

    // Check if this is a reconnection (same name, disconnected)
    for (const [oldSocketId, player] of room.players) {
      if (player.name === playerName && !player.connected) {
        // Reconnection — transfer socket
        clearTimeout(room.disconnectTimers.get(oldSocketId));
        room.disconnectTimers.delete(oldSocketId);

        room.players.delete(oldSocketId);
        player.socketId = socketId;
        player.connected = true;
        room.players.set(socketId, player);
        room.seatMap[player.seatIndex] = socketId;

        // Update host reference if needed
        if (room.hostSocketId === oldSocketId) {
          room.hostSocketId = socketId;
        }

        this.socketToRoom.set(socketId, room.code);
        return { seatIndex: player.seatIndex, playerId: player.playerId };
      }
    }

    // Check for duplicate name
    for (const player of room.players.values()) {
      if (player.name === playerName && player.connected) {
        throw new Error('Name already taken in this room');
      }
    }

    // Find next open seat
    const seatIndex = room.seatMap.indexOf(null);
    if (seatIndex === -1) throw new Error('Room is full');

    const playerId = `p${seatIndex}`;
    const newPlayer: RoomPlayer = {
      socketId,
      name: playerName,
      seatIndex,
      chips: room.settings.startingChips,
      connected: true,
      playerId,
      sittingOut: false,
    };

    room.players.set(socketId, newPlayer);
    room.seatMap[seatIndex] = socketId;
    this.socketToRoom.set(socketId, room.code);

    return { seatIndex, playerId };
  }

  /** Handle a socket disconnect. Returns the room + player info, or null. */
  handleDisconnect(socketId: string): { room: Room; player: RoomPlayer } | null {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    // Mark as disconnected
    player.connected = false;

    // If mid-hand, auto-fold via game controller
    if (room.gameController && room.state === 'playing') {
      room.gameController.handleDisconnect(player.playerId);
    }

    // Start grace period — remove player after timeout
    const timer = setTimeout(() => {
      this.removePlayer(socketId, room);
    }, RECONNECT_GRACE_MS);
    room.disconnectTimers.set(socketId, timer);

    // If no connected players remain, destroy room after grace period
    const connectedCount = [...room.players.values()].filter(p => p.connected).length;
    if (connectedCount === 0) {
      setTimeout(() => {
        if ([...room.players.values()].filter(p => p.connected).length === 0) {
          this.destroyRoom(room.code);
        }
      }, RECONNECT_GRACE_MS);
    }

    return { room, player };
  }

  /** Permanently remove a player from a room */
  private removePlayer(socketId: string, room: Room): void {
    const player = room.players.get(socketId);
    if (!player) return;

    room.seatMap[player.seatIndex] = null;
    room.players.delete(socketId);
    room.disconnectTimers.delete(socketId);
    this.socketToRoom.delete(socketId);

    // Transfer host if needed
    if (room.hostSocketId === socketId) {
      const nextHost = [...room.players.values()].find(p => p.connected);
      if (nextHost) {
        room.hostSocketId = nextHost.socketId;
      } else {
        // No connected players — destroy room
        this.destroyRoom(room.code);
      }
    }
  }

  /** Explicitly leave a room */
  leaveRoom(socketId: string): { room: Room; player: RoomPlayer } | null {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    // If mid-hand, auto-fold
    if (room.gameController && room.state === 'playing') {
      room.gameController.handleDisconnect(player.playerId);
    }

    // Clear any existing disconnect timer
    clearTimeout(room.disconnectTimers.get(socketId));

    this.removePlayer(socketId, room);

    return { room, player };
  }

  /** Destroy a room entirely */
  private destroyRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;

    // Clear all timers
    for (const timer of room.disconnectTimers.values()) {
      clearTimeout(timer);
    }

    // Clean up reverse lookups
    for (const socketId of room.players.keys()) {
      this.socketToRoom.delete(socketId);
    }

    this.rooms.delete(code);
  }

  /** Get room by code */
  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Get room by socket ID */
  getRoomForSocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Get the player for a socket ID */
  getPlayer(socketId: string): RoomPlayer | undefined {
    const room = this.getRoomForSocket(socketId);
    return room?.players.get(socketId);
  }

  /** Build a RoomStateView for broadcasting */
  getRoomStateView(room: Room): RoomStateView {
    const players = [...room.players.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(p => ({
        name: p.name,
        seatIndex: p.seatIndex,
        chips: p.chips,
        connected: p.connected,
        isHost: p.socketId === room.hostSocketId,
        sittingOut: p.sittingOut,
      }));

    return {
      code: room.code,
      hostSocketId: room.hostSocketId,
      players,
      settings: room.settings,
      state: room.state,
      maxSeats: MAX_SEATS,
    };
  }

  /** Update room settings (host only, lobby state only) */
  updateSettings(socketId: string, updates: Partial<RoomSettings>): void {
    const room = this.getRoomForSocket(socketId);
    if (!room) throw new Error('Not in a room');
    if (room.hostSocketId !== socketId) throw new Error('Only the host can update settings');
    if (room.state !== 'lobby') throw new Error('Cannot change settings while playing');

    Object.assign(room.settings, updates);

    // If starting chips changed, update all players' chips
    if (updates.startingChips !== undefined) {
      for (const player of room.players.values()) {
        player.chips = updates.startingChips;
      }
    }
  }

  /** Get connected player count for a room */
  getConnectedPlayerCount(room: Room): number {
    return [...room.players.values()].filter(p => p.connected && !p.sittingOut).length;
  }
}
