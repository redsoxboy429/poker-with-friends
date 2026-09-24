// ============================================================
// Room Manager — Room lifecycle, seats, identity, ledger
// ============================================================
// Identity rules (docs/NINE-GAME-RULES.md §7):
// - Reconnecting requires the secret token issued on create/join. A name alone
//   never reclaims a seat.
// - A disconnected player keeps their seat and chips. The game controller only
//   waits for them on their own turn, and sits them out at the next deal.
// - A player who leaves (or is kicked) during a live hand they are dealt into
//   keeps the seat until that hand settles, so the seat's engine ID (p{seat})
//   is never reused inside a live hand.

import { customAlphabet, nanoid } from 'nanoid';
import type { RoomSettings, RoomPlayer, RoomStateView, LedgerRow } from './types.js';
import type { GameController } from './game-controller.js';
import { normalizeSettings, isChipAmount } from './settings.js';

// No ambiguous chars: I/L/O/0/1
const generateCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);

const MAX_SEATS = 6;
/** Hand the host role to a connected player after the host is gone this long */
export const HOST_TRANSFER_MS = 60_000;
/** Destroy a room after everyone has been disconnected this long */
export const EMPTY_ROOM_TTL_MS = 30 * 60_000;
const MAX_NAME_LENGTH = 24;

export interface Room {
  code: string;
  hostSocketId: string;
  players: Map<string, RoomPlayer>;  // socketId → player
  seatMap: (string | null)[];        // seatIndex → socketId
  gameController: GameController | null;
  settings: RoomSettings;
  state: 'lobby' | 'playing';
  /** Host-transfer timers for a disconnected host (socketId → timeout) */
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** Timer that destroys the room once nobody is connected */
  emptyTimer: ReturnType<typeof setTimeout> | null;
  ledger: Map<string, LedgerRow>;    // memberId → row
}

/** A reconnect token that no longer matches a seat (the player was removed). */
export class SeatGoneError extends Error {
  constructor() { super('Your seat at this table has been closed'); }
}

export interface JoinResult {
  seatIndex: number;
  playerId: string;
  token: string;
  reconnected: boolean;
  /** Socket that previously held this seat (reconnect from a new tab) */
  replacedSocketId?: string;
}

/** Raise a stack to `target` (never lower it) and record the credited amount. */
export function creditTopUp(room: Room, player: RoomPlayer, target: number): void {
  const added = Math.max(0, target - player.chips);
  player.chips += added;
  player.queuedAddOn = undefined;
  const row = room.ledger.get(player.memberId);
  if (row) { row.buyIn += added; row.stack = player.chips; }
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('Enter a name');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a name');
  if (trimmed.length > MAX_NAME_LENGTH) throw new Error(`Names are limited to ${MAX_NAME_LENGTH} characters`);
  return trimmed;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** Reverse lookup: socketId → roomCode */
  private socketToRoom = new Map<string, string>();

  /** Create a new room. Returns the room code; the host's token is on the host player. */
  createRoom(hostSocketId: string, hostName: string, settings: unknown): string {
    const name = cleanName(hostName);
    const normalized = normalizeSettings(settings);
    let code = generateCode();
    while (this.rooms.has(code)) code = generateCode();

    const room: Room = {
      code,
      hostSocketId,
      players: new Map(),
      seatMap: new Array(MAX_SEATS).fill(null),
      gameController: null,
      settings: normalized,
      state: 'lobby',
      disconnectTimers: new Map(),
      emptyTimer: null,
      ledger: new Map(),
    };
    this.rooms.set(code, room);
    this.addPlayer(room, hostSocketId, name, 0);
    return code;
  }

  private addPlayer(room: Room, socketId: string, name: string, seatIndex: number): RoomPlayer {
    const player: RoomPlayer = {
      socketId,
      name,
      seatIndex,
      chips: 0,
      connected: true,
      playerId: `p${seatIndex}`,
      memberId: nanoid(12),
      token: nanoid(24),
      sittingOut: false,
      seated: false,
    };
    room.players.set(socketId, player);
    room.seatMap[seatIndex] = socketId;
    this.socketToRoom.set(socketId, room.code);
    return player;
  }

  /** Join a room, or reconnect to an existing seat with its token. */
  joinRoom(socketId: string, playerName: string, roomCode: string, token?: unknown): JoinResult {
    if (typeof roomCode !== 'string') throw new Error('Room not found');
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) throw new Error('Room not found');

    if (typeof token === 'string' && token) {
      for (const [oldSocketId, player] of room.players) {
        if (player.token !== token) continue;
        const replacedSocketId = oldSocketId !== socketId ? oldSocketId : undefined;
        clearTimeout(room.disconnectTimers.get(oldSocketId));
        room.disconnectTimers.delete(oldSocketId);
        room.players.delete(oldSocketId);
        this.socketToRoom.delete(oldSocketId);
        player.socketId = socketId;
        player.connected = true;
        player.pendingLeave = undefined; // coming back cancels a mid-hand leave
        room.players.set(socketId, player);
        room.seatMap[player.seatIndex] = socketId;
        this.socketToRoom.set(socketId, room.code);
        if (room.hostSocketId === oldSocketId) room.hostSocketId = socketId;
        if (room.emptyTimer) { clearTimeout(room.emptyTimer); room.emptyTimer = null; }
        return { seatIndex: player.seatIndex, playerId: player.playerId, token: player.token, reconnected: true, replacedSocketId };
      }
      // The seat behind this token was removed (left or kicked): do not silently re-seat.
      throw new SeatGoneError();
    }

    const name = cleanName(playerName);
    for (const player of room.players.values()) {
      if (player.name.toLowerCase() === name.toLowerCase()) throw new Error('Name already taken in this room');
    }
    const seatIndex = room.seatMap.indexOf(null);
    if (seatIndex === -1) throw new Error('Room is full');
    const player = this.addPlayer(room, socketId, name, seatIndex);
    return { seatIndex, playerId: player.playerId, token: player.token, reconnected: false };
  }

  /** Handle a socket disconnect. The seat and chips are kept. */
  handleDisconnect(socketId: string): { room: Room; player: RoomPlayer } | null {
    const room = this.getRoomForSocket(socketId);
    const player = room?.players.get(socketId);
    if (!room || !player) return null;

    player.connected = false;
    room.gameController?.handlePlayerDisconnected(player.playerId);

    if (room.hostSocketId === socketId) {
      room.disconnectTimers.set(socketId, setTimeout(() => {
        room.disconnectTimers.delete(socketId);
        if (room.hostSocketId !== socketId || player.connected) return;
        const next = [...room.players.values()].find(p => p.connected);
        if (next) {
          room.hostSocketId = next.socketId;
          room.gameController?.notifyRoomChanged();
        }
      }, HOST_TRANSFER_MS));
    }

    if (![...room.players.values()].some(p => p.connected) && !room.emptyTimer) {
      room.emptyTimer = setTimeout(() => {
        room.emptyTimer = null;
        if (![...room.players.values()].some(p => p.connected)) this.destroyRoom(room.code);
      }, EMPTY_ROOM_TTL_MS);
    }
    return { room, player };
  }

  /** Is this player dealt into a hand that has not settled yet? */
  private inLiveHand(room: Room, player: RoomPlayer): boolean {
    return room.gameController?.isInLiveHand(player.playerId) ?? false;
  }

  /**
   * Leave (or be kicked). Returns 'removed' when the seat was freed now, or
   * 'pending' when the player is in a live hand and leaves once it settles.
   */
  private depart(room: Room, player: RoomPlayer, reason: 'leave' | 'kick'): 'removed' | 'pending' {
    if (this.inLiveHand(room, player)) {
      player.pendingLeave = reason;
      room.gameController!.handlePlayerLeaving(player.playerId);
      return 'pending';
    }
    this.removePlayer(room, player);
    return 'removed';
  }

  /** Remove a player now, cashing out their stack in the ledger. */
  private removePlayer(room: Room, player: RoomPlayer): void {
    const row = room.ledger.get(player.memberId);
    if (row) {
      row.cashOut += player.chips;
      row.stack = 0;
      row.left = true;
    }
    clearTimeout(room.disconnectTimers.get(player.socketId));
    room.disconnectTimers.delete(player.socketId);
    room.seatMap[player.seatIndex] = null;
    room.players.delete(player.socketId);
    this.socketToRoom.delete(player.socketId);
    room.gameController?.handleSeatVacated(player.seatIndex);

    if (room.hostSocketId === player.socketId) {
      const nextHost = [...room.players.values()].find(p => p.connected) ?? [...room.players.values()][0];
      if (nextHost) room.hostSocketId = nextHost.socketId;
    }
    if (room.players.size === 0) this.destroyRoom(room.code);
  }

  /**
   * Free the seats of players who left during the hand that just settled.
   * Returns the removed players so the caller can notify the room.
   */
  finalizeDepartures(room: Room): RoomPlayer[] {
    const leaving = [...room.players.values()].filter(p => p.pendingLeave && !this.inLiveHand(room, p));
    for (const player of leaving) this.removePlayer(room, player);
    return leaving;
  }

  /** Explicitly leave a room */
  leaveRoom(socketId: string): { room: Room; player: RoomPlayer; status: 'removed' | 'pending' } | null {
    const room = this.getRoomForSocket(socketId);
    const player = room?.players.get(socketId);
    if (!room || !player) return null;
    const status = this.depart(room, player, 'leave');
    return { room, player, status };
  }

  /** Kick a player from the room (host only) */
  kickPlayer(hostSocketId: string, seatIndex: unknown): { room: Room; player: RoomPlayer; status: 'removed' | 'pending' } | null {
    const room = this.getRoomForSocket(hostSocketId);
    if (!room || room.hostSocketId !== hostSocketId) return null;
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= MAX_SEATS) return null;
    const targetSocketId = room.seatMap[seatIndex];
    if (!targetSocketId || targetSocketId === hostSocketId) return null;
    const player = room.players.get(targetSocketId);
    if (!player) return null;
    const status = this.depart(room, player, 'kick');
    return { room, player, status };
  }

  /** Destroy a room entirely */
  private destroyRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.gameController?.destroy();
    for (const timer of room.disconnectTimers.values()) clearTimeout(timer);
    if (room.emptyTimer) clearTimeout(room.emptyTimer);
    for (const socketId of room.players.keys()) this.socketToRoom.delete(socketId);
    this.rooms.delete(code);
  }

  getRoom(code: string): Room | undefined {
    return typeof code === 'string' ? this.rooms.get(code.toUpperCase()) : undefined;
  }

  getRoomForSocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  getPlayer(socketId: string): RoomPlayer | undefined {
    return this.getRoomForSocket(socketId)?.players.get(socketId);
  }

  /** Build a RoomStateView for broadcasting. Tokens are never included. */
  getRoomStateView(room: Room): RoomStateView {
    for (const p of room.players.values()) {
      const row = room.ledger.get(p.memberId);
      if (row) { row.stack = p.chips; row.name = p.name; }
    }
    const players = [...room.players.values()]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(p => ({
        name: p.name,
        seatIndex: p.seatIndex,
        chips: p.chips,
        connected: p.connected,
        isHost: p.socketId === room.hostSocketId,
        sittingOut: p.sittingOut,
        seated: p.seated,
        queuedAddOn: p.queuedAddOn,
        playerId: p.playerId,
        leaving: !!p.pendingLeave,
      }));

    return {
      code: room.code,
      hostSocketId: room.hostSocketId,
      players,
      settings: room.settings,
      state: room.state,
      maxSeats: MAX_SEATS,
      ledger: [...room.ledger.values()].map(r => ({ ...r })),
    };
  }

  /** Update room settings — host only. Validated as a whole before anything changes. */
  updateSettings(socketId: string, updates: unknown): RoomSettings {
    const room = this.getRoomForSocket(socketId);
    if (!room) throw new Error('Not in a room');
    if (room.hostSocketId !== socketId) throw new Error('Only the host can update settings');
    const next = normalizeSettings(updates, room.settings);
    room.settings = next;
    return next;
  }

  /** Sit down at the table with a buy-in in dollars. Returns the chip amount. */
  sitDown(socketId: string, buyIn: unknown): number {
    const room = this.getRoomForSocket(socketId);
    if (!room) throw new Error('Not in a room');
    const player = room.players.get(socketId);
    if (!player) throw new Error('Player not found');
    if (player.seated) throw new Error('Already seated');
    const { buyInMin = 0, buyInMax = Infinity } = room.settings;
    if (!isChipAmount(buyIn)) throw new Error('Buy-in must be a multiple of $0.25');
    if (buyIn < buyInMin || buyIn > buyInMax) {
      throw new Error(`Buy-in must be between $${buyInMin.toFixed(2)} and $${buyInMax.toFixed(2)}`);
    }
    player.chips = buyIn;
    player.seated = true;
    player.sittingOut = false;
    const row = room.ledger.get(player.memberId);
    if (row) { row.buyIn += buyIn; row.stack = buyIn; row.left = false; }
    else room.ledger.set(player.memberId, { memberId: player.memberId, name: player.name, buyIn, cashOut: 0, stack: buyIn, left: false });
    return buyIn;
  }

  /**
   * Top up TO `target` dollars. Between hands it applies now; during a live
   * hand the player is in, it is queued and applied after settlement as
   * max(stack, target), so winnings are never reduced.
   */
  topUp(socketId: string, target: unknown): 'applied' | 'queued' {
    const room = this.getRoomForSocket(socketId);
    const player = room?.players.get(socketId);
    if (!room || !player) throw new Error('Not in a room');
    if (!player.seated) throw new Error('Must be seated to top up');
    if (!isChipAmount(target)) throw new Error('Top-up must be a multiple of $0.25');
    const max = room.settings.buyInMax ?? Infinity;
    if (target > max) throw new Error(`Top-up is limited to $${max.toFixed(2)}`);

    if (this.inLiveHand(room, player)) {
      player.queuedAddOn = target;
      return 'queued';
    }
    if (target <= player.chips) throw new Error(`You already have $${player.chips.toFixed(2)}`);
    creditTopUp(room, player, target);
    player.sittingOut = false;
    return 'applied';
  }

  /** Get total active room count */
  getRoomCount(): number {
    return this.rooms.size;
  }
}
