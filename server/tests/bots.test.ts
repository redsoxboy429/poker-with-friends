// Bot tables: bots play through the real controller; the human watches with every card up.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase } from 'poker-engine';
import { RoomManager } from '../src/room-manager.js';
import { GameController, type GameCallbacks } from '../src/game-controller.js';
import { BOT_SCENARIOS, decideBet } from '../src/bots.js';

function botTable(scenario: string) {
  const rm = new RoomManager();
  const code = rm.createBotRoom('human', 'Watcher', scenario);
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

const tableChips = (room: ReturnType<typeof botTable>['room']) =>
  [...room.players.values()].reduce((sum, p) => sum + p.chips, 0);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('bot tables', () => {
  for (const scenario of BOT_SCENARIOS) {
    it(`${scenario.id}: bots keep playing hands and every chip is accounted for`, () => {
      const { rm, room, controller } = botTable(scenario.id);
      controller.startHand();
      const ids = new Set<string>();
      for (let t = 0; t < 400 && ids.size < 12; t++) {
        vi.advanceTimersByTime(1_000);
        const s = controller.getState();
        if (s) ids.add(s.id);
      }
      expect(ids.size).toBeGreaterThanOrEqual(12);
      // Between hands: stacks equal everything bought in (rebuys included).
      const ledger = rm.getRoomStateView(room).ledger;
      const bought = ledger.reduce((sum, r) => sum + r.buyIn, 0);
      if (controller.getState()?.phase === GamePhase.Complete) expect(tableChips(room)).toBeCloseTo(bought, 6);
      controller.destroy();
    });
  }

  it('the spectator sees every live hand; a human cannot sit down', () => {
    const { rm, controller, callbacks } = botTable('side-pots');
    controller.startHand();
    const toHuman = (callbacks.sendHandState as ReturnType<typeof vi.fn>).mock.calls.filter(c => c[0] === 'human').at(-1)!;
    const view = toHuman[1] as { players: { holeCards: unknown[] }[] };
    expect(view.players.every(p => p.holeCards.length === 2 && p.holeCards.every(c => c !== null))).toBe(true);
    expect(() => rm.sitDown('human', 50)).toThrow('bot table');
    controller.destroy();
  });

  it('pauses while nobody is watching and resumes when the spectator returns', () => {
    const { rm, room, controller } = botTable('side-pots');
    controller.startHand();
    const before = controller.getState()!.actionHistory.length;
    rm.handleDisconnect('human');
    vi.advanceTimersByTime(30_000);
    expect(controller.getState()!.actionHistory.length).toBeLessThanOrEqual(before + 1);
    rm.joinRoom('human2', 'Watcher', room.code, room.players.get('human')!.token);
    controller.handlePlayerReconnected('p0');
    vi.advanceTimersByTime(10_000);
    expect(controller.getState()!.actionHistory.length).toBeGreaterThan(before + 1);
    controller.destroy();
  });

  it('bot betting decisions are always legal', () => {
    const style = { shove: 0.3, raise: 0.3, call: 0.3 };
    const actions = { canFold: true, canCheck: false, canCall: true, callAmount: 2, canBet: false, minBet: 0, maxBet: 0, canRaise: true, minRaise: 4, maxRaise: 50 };
    for (const r of [0, 0.29, 0.31, 0.61, 0.95]) {
      const d = decideBet(actions, style, () => r);
      if (d.type === 'raise') expect([4, 50]).toContain(d.amount);
      else expect(['call', 'fold']).toContain(d.type);
    }
    const bringIn = { ...actions, canFold: false, canCall: false, canRaise: false, canBet: true, minBet: 0.5, maxBet: 2, betOptions: [0.5, 2] };
    expect(decideBet(bringIn, style, () => 0.1)).toEqual({ type: 'bet', amount: 0.5 });
  });
});
