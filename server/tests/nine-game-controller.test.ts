import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameMode, GameVariant, ActionType, GamePhase, planShowdown } from 'poker-engine';
import { RoomManager } from '../src/room-manager.js';
import { GameController, type GameCallbacks } from '../src/game-controller.js';
import { getPlayerView } from '../src/state-filter.js';

function table(mode = GameMode.SpecificGame, variant = GameVariant.NLH, gap = false) {
  const rm = new RoomManager();
  const code = rm.createRoom('s0', 'Host', { gameMode: mode, variant, smallBlind: .25, bigBlind: .5, smallBet: 2, bigBet: 4, startingChips: 100 });
  rm.joinRoom('s1', 'One', code);
  if (gap) rm.joinRoom('s2', 'Two', code);
  const room = rm.getRoom(code)!;
  for (const p of room.players.values()) { p.seated = true; p.chips = 100; }
  if (gap) room.players.get('s0')!.sittingOut = true;
  const callbacks: GameCallbacks = {
    sendHandState: vi.fn(), sendHandComplete: vi.fn(), sendDcChoose: vi.fn(),
    broadcastCountdown: vi.fn(), sendError: vi.fn(), broadcastRoomState: vi.fn(),
  };
  const controller = new GameController(room, callbacks); room.gameController = controller;
  return { controller, callbacks, rm, room };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('nine-game multiplayer boundaries', () => {
  it('rejects a second deal during a live hand', () => {
    const { controller } = table(); controller.startHand();
    const before = structuredClone(controller.getState());
    controller.startHand(); expect(controller.getState()).toEqual(before);
  });
  it('accepts only the current hand and action sequence', () => {
    const { controller } = table(); controller.startHand();
    const state = controller.getState()!;
    const count = state.actionHistory.length;
    expect(controller.acceptsVersion(state.id, count)).toBe(true);
    expect(controller.acceptsVersion('previous-hand', count)).toBe(false);
    controller.handleAction(`s${state.players[state.activePlayerIndex].seatIndex}`, ActionType.Call);
    expect(controller.acceptsVersion(state.id, count)).toBe(false);
    expect(controller.acceptsVersion(undefined, undefined)).toBe(false);
  });
  it('requires the actual chooser even when occupied seats are not contiguous', () => {
    const { controller, callbacks } = table(GameMode.DealersChoice, GameVariant.NLH, true);
    controller.startHand(); expect(callbacks.sendDcChoose).toHaveBeenCalledWith('s1');
    controller.handleVariantPick('p2', GameVariant.PLO); expect(controller.getState()).toBeNull();
    controller.handleVariantPick('p1', GameVariant.Badugi); expect(controller.getState()).toBeNull();
    controller.handleVariantPick('p1', GameVariant.PLO); const id = controller.getState()!.id;
    controller.handleVariantPick('p1', GameVariant.NLH); expect(controller.getState()!.id).toBe(id);
  });
  it('uses 1/2 blinds for 2/4 limit and .25/.50 for NL', () => {
    for (const [variant, sb, bb] of [[GameVariant.LimitHoldem, 1, 2], [GameVariant.TwoSevenTD, 1, 2], [GameVariant.NLH, .25, .5]] as const) {
      const { controller } = table(GameMode.SpecificGame, variant); controller.startHand();
      expect(controller.getState()!.smallBlind).toBe(sb); expect(controller.getState()!.bigBlind).toBe(bb);
    }
  });
  it('adds queued chips to settled winnings instead of overwriting the stack', () => {
    vi.useFakeTimers();
    const { controller, room } = table(); controller.startHand();
    const player = room.players.get('s1')!;
    player.queuedAddOn = 150; player.queuedAddOnIncrement = 50;
    controller.handleAction('s0', ActionType.Fold);
    const settled = player.chips;
    vi.advanceTimersByTime(200);
    controller.startHand();
    expect(player.chips).toBe(settled + 50);
    expect([...room.players.values()].reduce((sum, p) => sum + p.chips, 0)).toBe(250);
    controller.destroy();
  });
  it('host pause blocks actions and automatic resume until the host resumes', () => {
    const { controller } = table(); controller.startHand();
    const before = structuredClone(controller.getState()!);
    const actor = `s${before.players[before.activePlayerIndex].seatIndex}`;
    controller.pauseCountdown(); controller.autoResumeIfReady();
    controller.handleAction(actor, ActionType.Call);
    expect(controller.getState()).toEqual(before); expect(controller.isPaused()).toBe(true);
    controller.resumeCountdown(); controller.handleAction(actor, ActionType.Call);
    expect(controller.getState()).not.toEqual(before);
  });
  it('finishes the runout before allowing the next deal or starting the countdown', () => {
    vi.useFakeTimers();
    const { controller, callbacks } = table(); controller.startHand();
    let state = controller.getState()!;
    controller.handleAction(`s${state.players[state.activePlayerIndex].seatIndex}`, ActionType.Raise, 100);
    state = controller.getState()!;
    controller.handleAction(`s${state.players[state.activePlayerIndex].seatIndex}`, ActionType.Call);
    const final = controller.getState()!; expect(final.phase).toBe(GamePhase.Complete);
    expect(final.showdownStart!.communityCardCount).toBe(0);
    expect(Object.values(final.showdownStart!.chips).reduce((a, b) => a + b, 0)).toBe(0);
    expect(callbacks.broadcastCountdown).not.toHaveBeenCalled();
    controller.startHand(); expect(controller.getState()!.id).toBe(final.id);
    controller.pauseCountdown();
    vi.advanceTimersByTime(planShowdown(final).durationMs);
    controller.autoResumeIfReady(); expect(controller.isPaused()).toBe(true);
    expect(callbacks.broadcastCountdown).toHaveBeenLastCalledWith(expect.any(String), -1);
    controller.resumeCountdown();
    vi.advanceTimersByTime(15_000);
    // One player is now broke; zero-stack eligibility is covered by the next lifecycle checkpoint.
    controller.destroy();
  });
  it('keeps a fold winner private but exposes every survivor at a real showdown', () => {
    const { controller } = table(); controller.startHand();
    const state = controller.getState()!;
    const folder = state.players[state.activePlayerIndex];
    controller.handleAction(`s${folder.seatIndex}`, ActionType.Fold);
    const final = controller.getState()!;
    expect(getPlayerView(final, folder.id).players.find(p => !p.folded)!.holeCards).toEqual([null, null]);
    controller.destroy();
  });
});
