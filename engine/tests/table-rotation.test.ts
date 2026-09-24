// Written from docs/NINE-GAME-RULES.md §1 and §7 (button across segments, dealer's choice).
import { describe, it, expect } from 'vitest';
import { TableRotation, GameMode, GameVariant, HANDS_PER_VARIANT, NINE_GAME_ROTATION } from '../src/index.js';

/** Play `n` hands, returning each hand's button seat and variant. */
function play(rot: TableRotation, seats: number[] | ((i: number) => number[]), n: number, pick?: (chooser: number) => GameVariant) {
  const out: { button: number; variant: GameVariant | null; chooser: number | null }[] = [];
  for (let i = 0; i < n; i++) {
    const s = typeof seats === 'function' ? seats(i) : seats;
    let plan = rot.nextHand(s);
    if (plan.needsChoice) plan = rot.choose(pick ? pick(plan.chooserSeat!) : GameVariant.NLH);
    out.push({ button: plan.buttonSeat, variant: plan.variant, chooser: plan.chooserSeat });
    rot.completeHand();
  }
  return out;
}

describe('TableRotation — rotation modes', () => {
  it('each game segment is 8 hands and the button moves one occupied seat per hand', () => {
    const rot = new TableRotation({ mode: GameMode.Horse });
    const hands = play(rot, [0, 1, 2, 3, 4, 5], 8);
    expect(hands.map(h => h.button)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(hands.every(h => h.variant === GameVariant.LimitHoldem)).toBe(true);
  });

  it('the next game resets the button one seat left of where the previous game started (5 players, 8 hands)', () => {
    const rot = new TableRotation({ mode: GameMode.NineGame });
    const seats = [0, 1, 2, 3, 4];
    const hands = play(rot, seats, 3 * HANDS_PER_VARIANT);
    // Game 1 starts at seat 0 and would finish with the button at seat 2 (8 hands over 5 seats).
    expect(hands[7].button).toBe(2);
    // Game 2 is explicitly reset to seat 1, not the natural next seat 3.
    expect(hands[8]).toMatchObject({ button: 1, variant: NINE_GAME_ROTATION[1] });
    // Game 3 starts at seat 2.
    expect(hands[16]).toMatchObject({ button: 2, variant: NINE_GAME_ROTATION[2] });
  });

  it('skips empty and sitting-out seats by physical seat number', () => {
    const rot = new TableRotation({ mode: GameMode.Horse });
    const hands = play(rot, [0, 2, 5], 9);
    expect(hands.slice(0, 8).map(h => h.button)).toEqual([0, 2, 5, 0, 2, 5, 0, 2]);
    expect(hands[8].button).toBe(2); // next game starts left of seat 0
  });

  it('stud hands still advance the (invisible) button', () => {
    const rot = new TableRotation({ mode: GameMode.Horse });
    const hands = play(rot, [0, 1, 2, 3], 3 * HANDS_PER_VARIANT);
    // Razz (game 3) still moves the button every hand, and starts at seat 2.
    const razz = hands.slice(16, 24);
    expect(razz.every(h => h.variant === GameVariant.Razz)).toBe(true);
    expect(razz.map(h => h.button)).toEqual([2, 3, 0, 1, 2, 3, 0, 1]);
  });

  it('wraps the rotation after the last game', () => {
    const rot = new TableRotation({ mode: GameMode.Horse });
    const hands = play(rot, [0, 1], 5 * HANDS_PER_VARIANT + 1);
    expect(hands[5 * HANDS_PER_VARIANT].variant).toBe(GameVariant.LimitHoldem);
  });

  it('only completed hands count; re-planning does not advance the session', () => {
    const rot = new TableRotation({ mode: GameMode.Horse });
    rot.nextHand([0, 1, 2]);
    rot.nextHand([0, 1, 2]);
    rot.cancelPlan();
    const plan = rot.nextHand([0, 1, 2]);
    expect(plan.buttonSeat).toBe(0);
    rot.completeHand();
    expect(rot.nextHand([0, 1, 2]).buttonSeat).toBe(1);
  });

  it('a mode change continues one seat left of the last button', () => {
    const rot = new TableRotation({ mode: GameMode.EightGame, startAfterSeat: 3 });
    expect(rot.nextHand([0, 1, 3, 4]).buttonSeat).toBe(4);
  });
});

describe('TableRotation — dealer\'s choice', () => {
  it('the chooser gets two buttons (one orbit plus one hand), then the choice passes left', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    const picks: number[] = [];
    const hands = play(rot, [0, 1, 2, 3], 10, chooser => { picks.push(chooser); return GameVariant.PLO; });
    expect(hands.slice(0, 5).map(h => h.button)).toEqual([0, 1, 2, 3, 0]);
    expect(hands.slice(0, 5).every(h => h.chooser === 0)).toBe(true);
    expect(hands[5]).toMatchObject({ button: 1, chooser: 1 });
    expect(picks).toEqual([0, 1]);
  });

  it('uses physical seats with gaps', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    const hands = play(rot, [1, 3, 5], 5);
    expect(hands.map(h => [h.button, h.chooser])).toEqual([[1, 1], [3, 1], [5, 1], [1, 1], [3, 3]]);
  });

  it('if the chooser leaves mid-orbit, the game finishes the orbit and the choice passes to their left', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    // Chooser at seat 1 picks, then leaves after two hands.
    const hands = play(rot, i => (i < 2 ? [1, 2, 4] : [2, 4]), 4);
    expect(hands.map(h => [h.button, h.chooser])).toEqual([[1, 1], [2, 1], [4, 1], [2, 2]]);
  });

  it('a chooser who leaves before picking is replaced by the next seat left', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    play(rot, [0, 1, 2], 4); // seat 0 chose; seat 1 is up next
    const pending = rot.nextHand([0, 1, 2]);
    expect(pending).toMatchObject({ needsChoice: true, chooserSeat: 1, buttonSeat: 1 });
    const replanned = rot.nextHand([0, 2]);
    expect(replanned).toMatchObject({ needsChoice: true, chooserSeat: 2, buttonSeat: 2 });
  });

  it('only nine-game variants can be chosen, and only while a choice is pending', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    rot.nextHand([0, 1]);
    expect(() => rot.choose(GameVariant.Badugi)).toThrow();
    rot.choose(GameVariant.Razz);
    expect(() => rot.choose(GameVariant.NLH)).toThrow();
  });

  it('state reports the chooser by physical seat', () => {
    const rot = new TableRotation({ mode: GameMode.DealersChoice });
    rot.nextHand([2, 4]);
    expect(rot.getState()).toMatchObject({ chooserSeatIndex: 2, needsChoice: true, buttonSeat: 2 });
  });
});

describe('TableRotation — specific game and caps', () => {
  it('specific game just moves the button', () => {
    const rot = new TableRotation({ mode: GameMode.SpecificGame, variant: GameVariant.TwoSevenTD });
    const hands = play(rot, [0, 3], 3);
    expect(hands.map(h => h.button)).toEqual([0, 3, 0]);
    expect(rot.getCapBB(GameVariant.NLH)).toBeNull();
  });

  it('mixed modes cap NLH/PLO at 80 BB and 2-7 SD at 30 BB', () => {
    const rot = new TableRotation({ mode: GameMode.NineGame });
    expect(rot.getCapBB(GameVariant.NLH)).toBe(80);
    expect(rot.getCapBB(GameVariant.PLO)).toBe(80);
    expect(rot.getCapBB(GameVariant.TwoSevenSD)).toBe(30);
    expect(rot.getCapBB(GameVariant.LimitHoldem)).toBeNull();
  });
});
