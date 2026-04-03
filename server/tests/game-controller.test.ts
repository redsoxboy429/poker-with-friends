// ============================================================
// Game Controller Tests — server-side hand lifecycle
// ============================================================
// Tests the GameController orchestration layer: hand start, action
// routing, hand completion, countdown, DC variant picking.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameController, type GameCallbacks } from '../src/game-controller.js';
import type { Room } from '../src/room-manager.js';
import type { RoomPlayer } from '../src/types.js';
import { GameMode, ActionType, GameVariant } from 'poker-engine';

// ============================================================
// Helpers
// ============================================================

function makeRoom(playerCount: number = 2): Room {
  const players = new Map<string, RoomPlayer>();
  const seatMap: (string | null)[] = new Array(6).fill(null);

  for (let i = 0; i < playerCount; i++) {
    const socketId = `socket${i}`;
    const player: RoomPlayer = {
      socketId,
      name: `Player ${i}`,
      seatIndex: i,
      chips: 100,
      connected: true,
      playerId: `p${i}`,
      sittingOut: false,
      seated: true,
    };
    players.set(socketId, player);
    seatMap[i] = socketId;
  }

  return {
    code: 'TEST',
    hostSocketId: 'socket0',
    players,
    seatMap,
    gameController: null,
    settings: {
      gameMode: GameMode.SpecificGame,
      variant: GameVariant.NLH,
      smallBlind: 0.25,
      bigBlind: 0.50,
      startingChips: 100,
    },
    state: 'lobby',
    disconnectTimers: new Map(),
  };
}

function makeCallbacks() {
  const handStates: any[] = [];
  const handCompletes: any[] = [];
  const dcChooses: string[] = [];
  const countdowns: number[] = [];
  const errors: string[] = [];
  let roomStateBroadcasts = 0;

  const callbacks: GameCallbacks = {
    sendHandState(socketId, handState, actions, isYourTurn, lastAction, handDescription, sessionState, chipsBehind) {
      handStates.push({ socketId, handState, actions, isYourTurn, lastAction, handDescription, chipsBehind });
    },
    sendHandComplete(socketId, winners, finalState, handDescriptions) {
      handCompletes.push({ socketId, winners, finalState, handDescriptions });
    },
    sendDcChoose(socketId) {
      dcChooses.push(socketId);
    },
    broadcastCountdown(_roomCode, seconds) {
      countdowns.push(seconds);
    },
    sendError(_socketId, message) {
      errors.push(message);
    },
    broadcastRoomState(_roomCode) {
      roomStateBroadcasts++;
    },
  };

  return {
    ...callbacks,
    get handStates() { return handStates; },
    get handCompletes() { return handCompletes; },
    get dcChooses() { return dcChooses; },
    get countdowns() { return countdowns; },
    get errors() { return errors; },
    get roomStateBroadcasts() { return roomStateBroadcasts; },
  };
}

// ============================================================
// Hand lifecycle
// ============================================================
describe('GameController: Hand lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('startHand deals cards and broadcasts state to all players', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Should broadcast hand-state to both players
    expect(cb.handStates.length).toBe(2);
    // Each player gets their own view
    const sockets = cb.handStates.map(s => s.socketId);
    expect(sockets).toContain('socket0');
    expect(sockets).toContain('socket1');
    // Exactly one player should have isYourTurn = true
    const turns = cb.handStates.filter(s => s.isYourTurn);
    expect(turns.length).toBe(1);
  });

  it('rejects startHand with < 2 players', () => {
    const room = makeRoom(1);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    expect(cb.errors.length).toBe(1);
    expect(cb.errors[0]).toContain('2 players');
  });

  it('handleAction routes fold → hand-complete', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();
    cb.handStates.length = 0; // Clear initial broadcasts

    // Find who's active
    const activeState = cb.handStates.length === 0 ? null : cb.handStates.find(s => s.isYourTurn);
    // Re-broadcast to find active player
    const turn = gc.getState()!;
    const activePlayer = turn.players[turn.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;

    gc.handleAction(activeSocket, ActionType.Fold);

    // Should have sent hand-complete to both players
    expect(cb.handCompletes.length).toBe(2);
    // Should have broadcast room state (chip update)
    expect(cb.roomStateBroadcasts).toBeGreaterThan(0);
  });

  it('hand-complete starts countdown timer', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Fold to end hand
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    // Should have broadcast initial countdown
    expect(cb.countdowns.length).toBeGreaterThan(0);
    expect(cb.countdowns[0]).toBe(15); // 15 second countdown

    // Advance timer — countdown should decrement
    vi.advanceTimersByTime(1000);
    expect(cb.countdowns[cb.countdowns.length - 1]).toBe(14);
  });

  it('countdown auto-deals next hand', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Fold to end hand
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    const completesBefore = cb.handCompletes.length;
    cb.handStates.length = 0;

    // Advance full countdown (15 seconds)
    vi.advanceTimersByTime(15000);

    // New hand should have been dealt (new hand-state broadcasts)
    expect(cb.handStates.length).toBeGreaterThan(0);
  });

  it('pause/resume countdown works', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Fold to end hand
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    // Advance 3 seconds
    vi.advanceTimersByTime(3000);
    const countdownBefore = cb.countdowns[cb.countdowns.length - 1];

    // Pause
    gc.pauseCountdown();
    expect(gc.isPaused()).toBe(true);
    // Should broadcast -1 for paused
    expect(cb.countdowns[cb.countdowns.length - 1]).toBe(-1);

    // Advance 5 more seconds — countdown should NOT decrement
    vi.advanceTimersByTime(5000);

    // Resume
    gc.resumeCountdown();
    expect(gc.isPaused()).toBe(false);
    // Countdown should resume from where it paused
    expect(cb.countdowns[cb.countdowns.length - 1]).toBe(countdownBefore);
  });

  it('chips are preserved across hands', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    const totalBefore = [...room.players.values()].reduce((s, p) => s + p.chips, 0);

    gc.startHand();

    // Fold to end hand
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    const totalAfter = [...room.players.values()].reduce((s, p) => s + p.chips, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it('destroy clears all timers', () => {
    const room = makeRoom(2);
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Fold → starts countdown
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    gc.destroy();

    // Advancing timers should NOT trigger new hands
    cb.handStates.length = 0;
    vi.advanceTimersByTime(20000);
    expect(cb.handStates.length).toBe(0);
  });
});

// ============================================================
// Dealer's Choice
// ============================================================
describe('GameController: Dealers Choice', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('DC mode sends dc-choose to the chooser', () => {
    const room = makeRoom(2);
    room.settings.gameMode = GameMode.DealersChoice;
    room.settings.variant = undefined;
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Should have sent dc-choose to one player
    expect(cb.dcChooses.length).toBe(1);
    // Should NOT have dealt yet (waiting for pick)
    expect(cb.handStates.length).toBe(0);
  });

  it('variant pick triggers deal', () => {
    const room = makeRoom(2);
    room.settings.gameMode = GameMode.DealersChoice;
    room.settings.variant = undefined;
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Pick a variant
    const chooserSocket = cb.dcChooses[0];
    const chooser = room.players.get(chooserSocket)!;
    gc.handleVariantPick(chooser.playerId, GameVariant.PLO);

    // Should now have dealt hand-state to both players
    expect(cb.handStates.length).toBe(2);
  });
});

// ============================================================
// Stud ante configuration
// ============================================================
describe('GameController: Stud config', () => {
  it('stud games have non-zero ante and bring-in', () => {
    const room = makeRoom(2);
    room.settings.gameMode = GameMode.SpecificGame;
    room.settings.variant = GameVariant.Razz;
    room.settings.bigBlind = 0.50;
    room.settings.smallBlind = 0.25;
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // Game should have started (hand-state broadcast)
    expect(cb.handStates.length).toBe(2);
    // Check that antes were posted (players should have less than starting chips)
    const state = gc.getState()!;
    const totalBets = state.players.reduce((s, p) => s + p.bet, 0);
    const totalAntes = state.pots.reduce((s, p) => s + p.amount, 0);
    // There should be antes in the pot or bets posted
    expect(totalBets + totalAntes).toBeGreaterThan(0);
  });
});

// ============================================================
// chipsBehind tracking
// ============================================================
describe('GameController: chipsBehind', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('caps chips and tracks chipsBehind for rotation games', () => {
    const room = makeRoom(2);
    // 8-game mode with NLH variant (has 80BB cap)
    room.settings.gameMode = GameMode.EightGame;
    room.settings.variant = undefined;
    // Give players more than the cap
    for (const p of room.players.values()) {
      p.chips = 200; // 80 BB cap = 80 * 0.50 = 40, so 200 > 40
    }
    const cb = makeCallbacks();
    const gc = new GameController(room, cb);

    gc.startHand();

    // chipsBehind should be included in hand-state for capped players
    if (cb.handStates.length > 0) {
      const hs = cb.handStates[0];
      // If caps applied, chipsBehind should be non-null
      if (hs.chipsBehind) {
        const behindValues = Object.values(hs.chipsBehind as Record<string, number>);
        expect(behindValues.some(v => v > 0)).toBe(true);
      }
    }

    // After hand completes, chips behind should be restored
    const state = gc.getState()!;
    const activePlayer = state.players[state.activePlayerIndex];
    const activeSocket = [...room.players.values()].find(p => p.playerId === activePlayer.id)!.socketId;
    gc.handleAction(activeSocket, ActionType.Fold);

    // Room player chips should be restored (chips + chipsBehind)
    const totalAfter = [...room.players.values()].reduce((s, p) => s + p.chips, 0);
    expect(totalAfter).toBe(400); // 200 + 200
  });
});
