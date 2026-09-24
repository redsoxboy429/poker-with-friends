import { it, expect } from 'vitest';
import { planShowdown } from '../src/presentation.js';

it('deals four stud streets around the table with a two-second pause per street', () => {
  const state = { communityCards: [], players: ['a', 'b'].map(id => ({ id, folded: false, sittingOut: false, holeCards: Array(7) })),
    showdownStart: { communityCardCount: 0, holeCardCounts: { a: 3, b: 3 } } };
  const plan = planShowdown(state);
  expect(plan.steps.map(s => [s.playerId, s.holeCardCount])).toEqual([
    ['a', 4], ['b', 4], ['a', 5], ['b', 5], ['a', 6], ['b', 6], ['a', 7], ['b', 7],
  ]);
  expect(plan.steps[0].atMs).toBe(2000);
  expect(plan.steps[2].atMs - plan.steps[1].atMs).toBe(2180);
  expect(plan.durationMs).toBe(10240);
});
