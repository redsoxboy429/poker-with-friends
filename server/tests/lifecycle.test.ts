// Table lifecycle rules from docs/NINE-GAME-RULES.md §2 and §7.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionType, GameMode, GamePhase, GameVariant } from 'poker-engine';
import { RoomManager } from '../src/room-manager.js';
import { GameController, TURN_GRACE_MS, type GameCallbacks } from '../src/game-controller.js';
import { normalizeSettings } from '../src/settings.js';

const NL = { gameMode: GameMode.SpecificGame, variant: GameVariant.NLH, smallBlind: 0.25, bigBlind: 0.5 };

/** A room with `n` seated players (sockets s0..s{n-1}) and a controller wired like index.ts. */
function table(n: number, settings: object = NL, buyIn = 100) {
  const rm = new RoomManager();
  const code = rm.createRoom('s0', 'P0', settings);
  for (let i = 1; i < n; i++) rm.joinRoom(`s${i}`, `P${i}`, code);
  for (let i = 0; i < n; i++) rm.sitDown(`s${i}`, buyIn);
  const room = rm.getRoom(code)!;
  const callbacks: GameCallbacks = {
    sendHandState: vi.fn(), sendHandComplete: vi.fn(), sendDcChoose: vi.fn(),
    broadcastCountdown: vi.fn(), sendError: vi.fn(), broadcastRoomState: vi.fn(),
    onHandSettled: () => { rm.finalizeDepartures(room); },
  };
  const controller = new GameController(room, callbacks);
  room.gameController = controller;
  return { rm, room, controller, callbacks };
}

const actorSocket = (controller: GameController) => {
  const s = controller.getState()!;
  return `s${s.players[s.activePlayerIndex].seatIndex}`;
};
const totalRoomChips = (room: ReturnType<typeof table>['room']) =>
  [...room.players.values()].reduce((sum, p) => sum + p.chips, 0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('settings validation (§2)', () => {
  it('rejects stakes that are not whole $0.25 chips', () => {
    expect(() => normalizeSettings({ ...NL, smallBlind: 0.1 })).toThrow('multiple of $0.25');
    expect(() => normalizeSettings({ ...NL, smallBet: 0.75, bigBet: 1.5 })).toThrow('limit small blind');
    expect(() => normalizeSettings({ ...NL, smallBet: 2, bigBet: 5 })).toThrow('twice the small bet');
  });

  it('defaults ante and bring-in to a quarter of the small bet, and buy-ins to 50–300 big blinds', () => {
    expect(normalizeSettings(NL)).toMatchObject({ smallBet: 2, bigBet: 4, ante: 0.5, bringIn: 0.5, buyInMin: 25, buyInMax: 150 });
    expect(normalizeSettings({ ...NL, smallBet: 3, bigBet: 6 })).toMatchObject({ ante: 0.75, bringIn: 0.75 });
    expect(normalizeSettings({ ...NL, smallBet: 4, bigBet: 8, ante: 0.5, bringIn: 1 })).toMatchObject({ ante: 0.5, bringIn: 1 });
  });

  it('keeps the other settings when a partial update arrives', () => {
    const base = normalizeSettings({ ...NL, ante: 0.25, bringIn: 0.5 });
    expect(normalizeSettings({ bigBlind: 1, smallBlind: 0.5 }, base)).toMatchObject({ ante: 0.25, bringIn: 0.5, buyInMax: 300 });
  });

  it('only accepts nine-game variants', () => {
    expect(() => normalizeSettings({ ...NL, variant: GameVariant.Badugi })).toThrow('nine-game');
  });
});

describe('buy-in, top-up and ledger (§2, §7)', () => {
  it('buys in with dollars inside the host range', () => {
    const rm = new RoomManager();
    const code = rm.createRoom('s0', 'P0', NL);
    expect(() => rm.sitDown('s0', 10)).toThrow('between $25.00 and $150.00');
    expect(() => rm.sitDown('s0', 30.1)).toThrow('multiple of $0.25');
    expect(rm.sitDown('s0', 40)).toBe(40);
    expect(rm.getRoomStateView(rm.getRoom(code)!).ledger).toEqual([
      expect.objectContaining({ name: 'P0', buyIn: 40, cashOut: 0, stack: 40, left: false }),
    ]);
  });

  it('tops up TO an amount between hands and never lowers a stack', () => {
    const { rm, room } = table(2, NL, 50);
    expect(rm.topUp('s1', 80)).toBe('applied');
    expect(room.players.get('s1')!.chips).toBe(80);
    expect(() => rm.topUp('s1', 60)).toThrow('already have');
    expect(() => rm.topUp('s1', 200)).toThrow('limited to $150.00');
    expect(rm.getRoomStateView(room).ledger.find(r => r.name === 'P1')!.buyIn).toBe(80);
  });

  it('queues a mid-hand top-up and applies it after settlement', () => {
    const { rm, room, controller } = table(2, NL, 50);
    controller.startHand();
    expect(rm.topUp('s0', 120)).toBe('queued');
    controller.handleAction(actorSocket(controller), ActionType.Fold);
    expect(room.players.get('s0')!.chips).toBe(120);
    const ledger = rm.getRoomStateView(room).ledger;
    const bought = ledger.reduce((sum, r) => sum + r.buyIn, 0);
    expect(totalRoomChips(room)).toBe(bought); // every chip on the table was bought
  });
});

describe('disconnects (§7)', () => {
  it('waits for a disconnected player only on their turn, then checks or folds', () => {
    const { rm, controller } = table(2);
    controller.startHand();
    const actor = actorSocket(controller);
    const handId = controller.getState()!.id;
    rm.handleDisconnect(actor);
    vi.advanceTimersByTime(TURN_GRACE_MS - 1);
    expect(controller.getState()!.actionHistory.at(-1)!.type).not.toBe(ActionType.Fold);
    vi.advanceTimersByTime(1);
    const s = controller.getState()!;
    expect(s.id).toBe(handId);
    expect(s.phase).toBe(GamePhase.Complete); // facing the blind, so they fold
  });

  it('an off-turn disconnect never stalls the hand', () => {
    const { rm, controller } = table(3);
    controller.startHand();
    const actor = actorSocket(controller);
    const offTurn = ['s0', 's1', 's2'].find(s => s !== actor)!;
    rm.handleDisconnect(offTurn);
    controller.handleAction(actor, ActionType.Call);
    // Nothing waits on the disconnected player until their own turn arrives.
    expect(controller.getState()!.phase).not.toBe(GamePhase.Complete);
  });

  it('still-disconnected players sit out at the next deal and keep their seat; reconnecting resumes them', () => {
    const { rm, room, controller } = table(3);
    const token = room.players.get('s2')!.token;
    rm.handleDisconnect('s2');
    controller.startHand();
    const dealt = controller.getState()!.players.map(p => p.id);
    expect(dealt).toEqual(['p0', 'p1']);
    expect(room.players.get('s2')).toMatchObject({ sittingOut: true, autoSatOut: true, chips: 100 });

    rm.joinRoom('s2b', 'x', room.code, token);
    controller.handlePlayerReconnected('p2');
    expect(room.players.get('s2b')).toMatchObject({ sittingOut: false, connected: true });
  });
});

describe('audit regressions (2026-09-23)', () => {
  const STUD = { gameMode: GameMode.SpecificGame, variant: GameVariant.Stud, smallBlind: 0.25, bigBlind: 0.5 };

  it('a disconnected stud bring-in player has the bring-in posted after the grace period', () => {
    const { rm, controller } = table(3, STUD);
    controller.startHand();
    expect(controller.getState()!.pendingBringIn).toBe(true);
    const actor = actorSocket(controller);
    rm.handleDisconnect(actor);
    vi.advanceTimersByTime(TURN_GRACE_MS);
    const s = controller.getState()!;
    expect(s.pendingBringIn).toBe(false);
    expect(s.actionHistory.at(-1)!.type).toBe(ActionType.BringIn);
  });

  it('a player who leaves on their turn folds, even when checking is free', () => {
    const { rm, room, controller } = table(2);
    controller.startHand();
    controller.handleAction(actorSocket(controller), ActionType.Call); // SB completes; BB may check
    const bb = actorSocket(controller);
    const bbId = room.players.get(bb)!.playerId;
    expect(controller.getState()!.players.find(p => p.id === bbId)!.folded).toBe(false);
    rm.leaveRoom(bb);
    vi.advanceTimersByTime(0);
    const s = controller.getState()!;
    expect(s.phase).toBe(GamePhase.Complete);
    expect(s.players.find(p => p.id === bbId)!.folded).toBe(true);
    expect(room.players.has(bb)).toBe(false); // seat freed once the hand settled
  });

  it('the choice passes on when the pending dealer\'s-choice chooser leaves', () => {
    const { rm, controller, callbacks } = table(3, { ...NL, gameMode: GameMode.DealersChoice, variant: undefined });
    controller.startHand();
    expect(callbacks.sendDcChoose).toHaveBeenLastCalledWith('s0');
    rm.leaveRoom('s0');
    expect(callbacks.sendDcChoose).toHaveBeenLastCalledWith('s1');
    controller.handleVariantPick('p1', GameVariant.PLO);
    expect(controller.getState()!.variant).toBe(GameVariant.PLO);
  });

  it('the choice passes on when the pending chooser sits out, and a stale pick is refused', () => {
    const { room, controller, callbacks } = table(3, { ...NL, gameMode: GameMode.DealersChoice, variant: undefined });
    controller.startHand();
    room.players.get('s0')!.sittingOut = true;
    controller.handleVariantPick('p0', GameVariant.NLH);
    expect(controller.getState()).toBeNull();
    expect(callbacks.sendDcChoose).toHaveBeenLastCalledWith('s1');
  });

  it('a new occupant of a reused seat never receives the previous occupant\'s cards', () => {
    const { rm, room, controller, callbacks } = table(3);
    controller.startHand();
    while (controller.getState()!.phase !== GamePhase.Complete) controller.handleAction(actorSocket(controller), ActionType.Fold);
    const oldCards = controller.getState()!.players.find(p => p.id === 'p2')!.holeCards;
    rm.leaveRoom('s2'); // between hands: seat freed at once
    const { token } = rm.joinRoom('s9', 'Newbie', room.code);
    expect(room.players.get('s9')!.playerId).toBe('p2');
    rm.handleDisconnect('s9');
    rm.joinRoom('s10', 'x', room.code, token);
    controller.handlePlayerReconnected('p2');
    const sent = JSON.stringify((callbacks.sendHandComplete as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === 's10'));
    for (const card of oldCards) expect(sent).not.toContain(JSON.stringify(card));
  });

  it('a stale token after a kick is refused instead of silently re-seating', () => {
    const { rm, room } = table(3);
    const token = room.players.get('s2')!.token;
    rm.handleDisconnect('s2');
    rm.kickPlayer('s0', 2);
    expect(() => rm.joinRoom('s9', 'P2', room.code, token)).toThrow('closed');
  });

  it('caps stakes and buy-ins at a sane maximum', () => {
    expect(() => normalizeSettings({ ...NL, buyInMax: 1e300 })).toThrow('limited');
  });
});

describe('leaving during a hand (§7)', () => {
  it('keeps the seat until the hand settles, folds on their turn, then cashes out', () => {
    const { rm, room, controller } = table(3);
    controller.startHand();
    const actor = actorSocket(controller);
    const s0 = controller.getState()!;
    const leaver = `s${s0.players[(s0.activePlayerIndex + 1) % 3].seatIndex}`; // acts next
    const result = rm.leaveRoom(leaver)!;
    expect(result.status).toBe('pending');
    expect(room.seatMap[room.players.get(leaver)!.seatIndex]).toBe(leaver);

    controller.handleAction(actor, ActionType.Raise, 2);
    vi.advanceTimersByTime(0); // the leaver's turn: automatic fold
    while (controller.getState()!.phase !== GamePhase.Complete) {
      controller.handleAction(actorSocket(controller), ActionType.Fold);
      vi.advanceTimersByTime(0);
    }
    expect(room.players.has(leaver)).toBe(false);
    const row = rm.getRoomStateView(room).ledger.find(r => r.name === result.player.name)!;
    expect(row).toMatchObject({ left: true, stack: 0 });
    expect(row.cashOut).toBeGreaterThan(0);
    const ledger = rm.getRoomStateView(room).ledger;
    const net = ledger.reduce((sum, r) => sum + r.stack + r.cashOut - r.buyIn, 0);
    expect(net).toBe(0); // chips are conserved across the session
  });

  it('leaving between hands frees the seat immediately', () => {
    const { rm, room } = table(3);
    expect(rm.leaveRoom('s1')!.status).toBe('removed');
    expect(room.seatMap[1]).toBeNull();
  });
});
