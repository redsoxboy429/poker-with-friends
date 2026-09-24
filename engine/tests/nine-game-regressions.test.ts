import { describe, it, expect } from 'vitest';
import { NLHGame, TwoSevenTDGame, GamePhase, ActionType, GameVariant, BettingStructure, evaluate5CardLow, evaluate5Card27Low, parseCards, type PlayerState } from '../src/index.js';
import { StudGame, RazzGame } from '../src/index.js';

class StudProbe extends StudGame {
  actor(boards: string[], allInIndex = -1) {
    boards.forEach((cards, i) => this.upCards.set(`p${i}`, parseCards(cards)));
    this.state.players.forEach((p, i) => { p.allIn = i === allInIndex; });
    this.setFirstActorForStreet();
    return this.state.activePlayerIndex;
  }
}
class RazzProbe extends RazzGame {
  actor(boards: string[]) {
    boards.forEach((cards, i) => this.upCards.set(`p${i}`, parseCards(cards)));
    this.setFirstActorForStreet();
    return this.state.activePlayerIndex;
  }
}

const players = (count = 2): PlayerState[] => Array.from({ length: count }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, chips: 100, holeCards: [], bet: 0, totalBet: 0,
  folded: false, allIn: false, sittingOut: false, seatIndex: i,
}));
const config = { maxPlayers: 6, smallBlind: 1, bigBlind: 2, smallBet: 2, bigBet: 4,
  ante: 0, bringIn: 0, startingChips: 100, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit };

describe('nine-game regression gate', () => {
  it('uses exposed pairs in Stud, highest-card-first in Razz, and skips all-in actors', () => {
    const stud = new StudProbe(config, players(3), 0);
    expect(stud.actor(['As Kd', '2s 2d', '3s 4d'])).toBe(1);
    expect(stud.actor(['As Kd', '2s 2d', '3s 4d'], 1)).toBe(0);
    const razz = new RazzProbe(config, players(), 0);
    expect(razz.actor(['As Kd', '2s 3d'])).toBe(1);
    expect(razz.actor(['As Ad', 'Ks Qd'])).toBe(1);
  });
  it('runs out forced all-ins without waiting for an impossible action', () => {
    const ps = players(); ps.forEach(p => p.chips = 1);
    const game = new NLHGame(config, ps, 0); game.start();
    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(game.getState().communityCards).toHaveLength(5);
    expect(game.getState().players.reduce((sum, p) => sum + p.chips, 0)).toBe(2);
  });
  it('does not reopen raising after a short all-in and a third player call', () => {
    const ps = players(3); ps[1].chips = 15;
    const game = new NLHGame(config, ps, 0); game.start();
    game.act('p0', ActionType.Raise, 10);
    game.act('p1', ActionType.Raise, 15);
    game.act('p2', ActionType.Call);
    expect(game.getAvailableActions().canCall).toBe(true);
    expect(game.getAvailableActions().canRaise).toBe(false);
    expect(() => game.act('p0', ActionType.Raise, 30)).toThrow();
  });
  it('rejects a second start and post-settlement actions without changing chips', () => {
    const game = new NLHGame(config, players(), 0);
    game.start();
    expect(() => game.start()).toThrow();
    while (game.getState().phase !== GamePhase.Complete) {
      const state = game.getState();
      game.act(state.players[state.activePlayerIndex].id, game.getAvailableActions().canCheck ? ActionType.Check : ActionType.Call);
    }
    const before = structuredClone(game.getState());
    expect(() => game.act(before.players[before.activePlayerIndex].id, ActionType.Check)).toThrow();
    expect(game.getState()).toEqual(before);
    expect(before.players.reduce((sum, p) => sum + p.chips, 0)).toBe(200);
    expect(game.getAvailableActions().canCheck).toBe(false);
  });

  it.each([NaN, Infinity, -1, '10', null])('rejects malformed amounts: %s', amount => {
    const game = new NLHGame(config, players(), 0); game.start();
    const before = structuredClone(game.getState());
    expect(() => game.act(before.players[before.activePlayerIndex].id, ActionType.Raise, amount as number)).toThrow();
    expect(game.getState()).toEqual(before);
  });

  it('six players can draw five on every draw without duplicates or exhaustion', () => {
    const game = new TwoSevenTDGame({ ...config, variant: GameVariant.TwoSevenTD, bettingStructure: BettingStructure.FixedLimit }, players(6), 0);
    game.start();
    let draws = 0;
    for (let step = 0; step < 100 && game.getState().phase !== GamePhase.Complete; step++) {
      const state = game.getState();
      const id = state.players[state.activePlayerIndex].id;
      if (state.phase.startsWith('draw-')) {
        const before = structuredClone(state);
        for (const bad of [[1, 1], [0.5], [NaN], [-1], [5]]) {
          expect(() => game.discard(id, bad)).toThrow();
          expect(game.getState()).toEqual(before);
        }
        expect(() => game.act(id, ActionType.Check)).toThrow();
        const oldCards = before.players[before.activePlayerIndex].holeCards;
        game.discard(id, [0, 1, 2, 3, 4]); draws++;
        const fresh = game.getState();
        expect(fresh.players[before.activePlayerIndex].holeCards.some(c => oldCards.some(o => o.rank === c.rank && o.suit === c.suit))).toBe(false);
        const cards = fresh.players.flatMap(p => p.holeCards.map(c => `${c.rank}${c.suit}`));
        expect(new Set(cards).size).toBe(30);
      } else game.act(id, game.getAvailableActions().canCheck ? ActionType.Check : ActionType.Call);
    }
    expect(draws).toBe(18);
    expect(game.getState().phase).toBe(GamePhase.Complete);
    expect(game.getState().players.reduce((sum, p) => sum + p.chips, 0)).toBe(600);
  });

  it('ranks A2345 as ace-high in deuce-to-seven', () => {
    expect(evaluate5Card27Low(parseCards('As 2d 3c 4h 5s')).value)
      .toBeLessThan(evaluate5Card27Low(parseCards('2s 2d 3c 4h 5s')).value);
  });
  it('orders all paired ace-to-five categories and pair ranks', () => {
    const hands = ['As 2d 3c 4h Ks', 'As Ad Kc Qh Js', '2s 2d 3c 4h 5s', 'As Ad 2c 2h Ks', 'As Ad Ac 2h 3s', 'As Ad Ac 2h 2s', 'As Ad Ac Ah 2s'];
    const values = hands.map(h => evaluate5CardLow(parseCards(h)).value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});
