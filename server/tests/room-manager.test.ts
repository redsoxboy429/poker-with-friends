import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../src/room-manager.js';
import { GameMode } from 'poker-engine';

const DEFAULT_SETTINGS = {
  gameMode: GameMode.SpecificGame,
  smallBlind: 5,
  bigBlind: 10,
  startingChips: 1000,
};

describe('RoomManager', () => {
  let rm: RoomManager;

  beforeEach(() => {
    rm = new RoomManager();
  });

  describe('createRoom', () => {
    it('creates a room with a 4-char code', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      expect(code).toHaveLength(4);
      expect(/^[A-Z0-9]+$/.test(code)).toBe(true);
    });

    it('host is seated at index 0', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      const room = rm.getRoom(code)!;
      expect(room.seatMap[0]).toBe('socket1');
      expect(room.players.get('socket1')?.seatIndex).toBe(0);
      expect(room.players.get('socket1')?.playerId).toBe('p0');
    });

    it('room starts in lobby state', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      const room = rm.getRoom(code)!;
      expect(room.state).toBe('lobby');
    });
  });

  describe('joinRoom', () => {
    it('assigns next available seat', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      const { seatIndex, playerId } = rm.joinRoom('socket2', 'Alice', code);
      expect(seatIndex).toBe(1);
      expect(playerId).toBe('p1');
    });

    it('case-insensitive room codes', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      const { seatIndex } = rm.joinRoom('socket2', 'Alice', code.toLowerCase());
      expect(seatIndex).toBe(1);
    });

    it('rejects duplicate names', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      expect(() => rm.joinRoom('socket2', 'Josh', code)).toThrow('Name already taken');
    });

    it('rejects invalid room code', () => {
      expect(() => rm.joinRoom('socket2', 'Alice', 'XXXX')).toThrow('Room not found');
    });

    it('rejects when room is full (6 seats)', () => {
      const code = rm.createRoom('s1', 'P1', DEFAULT_SETTINGS);
      rm.joinRoom('s2', 'P2', code);
      rm.joinRoom('s3', 'P3', code);
      rm.joinRoom('s4', 'P4', code);
      rm.joinRoom('s5', 'P5', code);
      rm.joinRoom('s6', 'P6', code);
      expect(() => rm.joinRoom('s7', 'P7', code)).toThrow('Room is full');
    });
  });

  describe('leaveRoom', () => {
    it('removes player and frees seat', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.joinRoom('socket2', 'Alice', code);
      rm.leaveRoom('socket2');

      const room = rm.getRoom(code)!;
      expect(room.seatMap[1]).toBeNull();
      expect(room.players.has('socket2')).toBe(false);
    });

    it('transfers host when host leaves', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.joinRoom('socket2', 'Alice', code);
      rm.leaveRoom('socket1');

      const room = rm.getRoom(code)!;
      expect(room.hostSocketId).toBe('socket2');
    });
  });

  describe('reconnection', () => {
    it('reconnects a disconnected player by name', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.joinRoom('socket2', 'Alice', code);

      // Disconnect Alice
      rm.handleDisconnect('socket2');
      const room = rm.getRoom(code)!;
      expect(room.players.get('socket2')?.connected).toBe(false);

      // Reconnect Alice with new socket
      const { seatIndex } = rm.joinRoom('socket3', 'Alice', code);
      expect(seatIndex).toBe(1); // Same seat
      expect(room.players.get('socket3')?.connected).toBe(true);
      expect(room.players.has('socket2')).toBe(false); // Old socket cleaned up
    });
  });

  describe('getRoomStateView', () => {
    it('returns sorted players with host flag', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.joinRoom('socket2', 'Alice', code);
      const room = rm.getRoom(code)!;

      const view = rm.getRoomStateView(room);
      expect(view.players).toHaveLength(2);
      expect(view.players[0].name).toBe('Josh');
      expect(view.players[0].isHost).toBe(true);
      expect(view.players[1].name).toBe('Alice');
      expect(view.players[1].isHost).toBe(false);
      expect(view.code).toBe(code);
      expect(view.state).toBe('lobby');
    });
  });

  describe('updateSettings', () => {
    it('host can update settings in lobby', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.updateSettings('socket1', { smallBlind: 10, bigBlind: 20 });
      const room = rm.getRoom(code)!;
      expect(room.settings.smallBlind).toBe(10);
      expect(room.settings.bigBlind).toBe(20);
    });

    it('non-host cannot update settings', () => {
      const code = rm.createRoom('socket1', 'Josh', DEFAULT_SETTINGS);
      rm.joinRoom('socket2', 'Alice', code);
      expect(() => rm.updateSettings('socket2', { smallBlind: 10 })).toThrow('Only the host');
    });
  });
});
