// Regression tests written from docs/NINE-GAME-RULES.md (signed off 2026-09-23),
// one block per defect found in the 2026-09-23 engine audits. Expected values
// come from the spec, not from the implementation.
import { describe, it, expect } from 'vitest';
import {
  NLHGame, LHEGame, StudGame, StudHiLoGame, RazzGame, O8Game,
  GamePhase, ActionType, GameVariant, BettingStructure, CHIP_UNIT,
  parseCards, createDeck, evaluate5CardHigh, planShowdown, type PlayerState, type TableConfig, type BaseGame, type Card,
} from '../src/index.js';

const players = (count: number, chips = 100): PlayerState[] => Array.from({ length: count }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, chips, holeCards: [], bet: 0, totalBet: 0,
  folded: false, allIn: false, sittingOut: false, seatIndex: i,
}));

const NL: TableConfig = { maxPlayers: 6, smallBlind: 0.25, bigBlind: 0.5, ante: 0, bringIn: 0,
  startingChips: 100, variant: GameVariant.NLH, bettingStructure: BettingStructure.NoLimit };
const LIMIT: TableConfig = { maxPlayers: 6, smallBlind: 1, bigBlind: 2, smallBet: 2, bigBet: 4, ante: 0, bringIn: 0,
  startingChips: 100, variant: GameVariant.LimitHoldem, bettingStructure: BettingStructure.FixedLimit };
const STUD: TableConfig = { maxPlayers: 6, smallBlind: 0, bigBlind: 0, smallBet: 2, bigBet: 4, ante: 0.5, bringIn: 0.5,
  startingChips: 100, variant: GameVariant.Stud, bettingStructure: BettingStructure.FixedLimit };

/** Put `top` on top of the deck (dealt first), followed by the rest of a full deck. */
function stack(game: BaseGame, top: string): void {
  const first = parseCards(top);
  const key = (c: Card) => `${c.rank}${c.suit}`;
  const used = new Set(first.map(key));
  const rest = createDeck().filter(c => !used.has(key(c)));
  const deck = (game as unknown as { deck: { cards: Card[]; position: number } }).deck;
  deck.cards = [...first, ...rest];
  deck.position = 0;
}

const active = (game: BaseGame) => game.getState().players[game.getState().activePlayerIndex].id;
const total = (game: BaseGame) => {
  const s = game.getState();
  return s.players.reduce((sum, p) => sum + p.chips + p.bet, 0) + s.pots.reduce((sum, p) => sum + p.amount, 0);
};

describe('Stud bring-in (spec §4)', () => {
  it('a player all-in from the ante cannot bring in; it passes to the next-worst door card', () => {
    const ps = players(3); ps[1].chips = 0.5;
    const game = new StudGame(STUD, ps, 0);
    // Deal order: down, down, door — each round p0, p1, p2. Doors: p0 5d, p1 2c, p2 Kd.
    stack(game, 'As Ah Ad Ks Kh Qd 5d 2c Kd');
    game.start();
    expect(game.getState().players[1].allIn).toBe(true);
    expect(game.getState().pendingBringIn).toBe(true);
    expect(active(game)).toBe('p0');
  });

  it('the bring-in player chooses to bring in or complete; neither check nor fold', () => {
    const game = new StudGame(STUD, players(3), 0);
    stack(game, 'As Ah Ad Ks Kh Qd 5d 2c Kd');
    game.start();
    expect(active(game)).toBe('p1');
    const a = game.getAvailableActions();
    expect(a.betOptions).toEqual([0.5, 2]);
    expect(a.canCheck).toBe(false);
    expect(a.canFold).toBe(false);
    expect(() => game.act('p1', ActionType.Bet, 1)).toThrow();
    game.act('p1', ActionType.Bet, 2);
    const s = game.getState();
    expect(s.currentBet).toBe(2);
    expect(s.actionHistory.at(-1)!.type).toBe(ActionType.Bet);
    expect(active(game)).toBe('p2');
  });

  it('posting the bring-in records a BringIn and the next raise completes to the small bet', () => {
    const game = new StudGame(STUD, players(3), 0);
    stack(game, 'As Ah Ad Ks Kh Qd 5d 2c Kd');
    game.start();
    game.act('p1', ActionType.Bet, 0.5);
    expect(game.getState().actionHistory.at(-1)!.type).toBe(ActionType.BringIn);
    expect(game.getAvailableActions().minRaise).toBe(2);
  });
});

describe('Showdown descriptions include kickers (Josh 2026-09-23)', () => {
  const d = (cards: string) => evaluate5CardHigh(parseCards(cards)).showdownDescription;
  it('names the kickers that decide same-category hands', () => {
    expect(d('Jh Js Jd Kc 9s')).toBe('Three Jacks, K-9 kickers');
    expect(d('Jh Js Jd Qc 9s')).toBe('Three Jacks, Q-9 kickers');
    expect(d('Jh Js Ad Kc 9s')).toBe('Pair of Jacks, A-K-9 kickers');
    expect(d('Kh Ks 9d 9c As')).toBe('Two Pair, Kings and Nines, Ace kicker');
    expect(d('Ah Kh 9h 7h 4h')).toBe('Flush, A-K-9-7-4');
    expect(d('Ah Kd 9h 7c 4s')).toBe('Ace-high, K-9-7-4');
    expect(d('9h 8d 7h 6c 5s')).toBe('Straight, 9-high');
  });
});

describe('Stud runout order (Josh 2026-09-23)', () => {
  it('deals each runout street starting left of the button', () => {
    const state = {
      buttonIndex: 1,
      communityCards: [],
      players: ['p0', 'p1', 'p2'].map(id => ({ id, folded: false, sittingOut: false, holeCards: new Array(7).fill(null) })),
      showdownStart: { communityCardCount: 0, holeCardCounts: { p0: 3, p1: 3, p2: 3 } },
    };
    const fourth = planShowdown(state).steps.filter(s => s.holeCardCount === 4).map(s => s.playerId);
    expect(fourth).toEqual(['p2', 'p0', 'p1']);
  });
});

describe('Short forced bets (audit 2026-09-23)', () => {
  it('a player all-in for less than the ante only wins the antes they matched', () => {
    const ps = players(3); ps[0].chips = 0.25;
    const game = new StudGame(STUD, ps, 0);
    game.start();
    const pots = game.getState().pots;
    expect(pots).toEqual([
      { amount: 0.75, eligiblePlayerIds: ['p0', 'p1', 'p2'] },
      { amount: 0.5, eligiblePlayerIds: ['p1', 'p2'] },
    ]);
  });

  it('a big blind all-in for less than the small blind leaves the small blind nothing to decide', () => {
    const ps = players(2); ps[1].chips = 0.25; // p1 is the big blind heads-up (button p0 posts the SB)
    const game = new NLHGame(NL, ps, 0);
    game.start();
    const s = game.getState();
    expect(s.phase).toBe(GamePhase.Complete);
    expect(s.players.reduce((sum, p) => sum + p.chips, 0)).toBe(100.25);
  });

  it('forfeit folds a departing player even when checking is free', () => {
    const game = new NLHGame(NL, players(2), 0);
    game.start();
    game.act('p0', ActionType.Call);
    expect(game.getAvailableActions().canFold).toBe(false);
    expect(game.forfeit('p1')).toBe(true);
    expect(game.getState().players[1].folded).toBe(true);
  });
});

describe('Stud first to act from 4th street (spec §4)', () => {
  class Probe extends StudGame {
    actor(boards: string[]) {
      boards.forEach((cards, i) => this.upCards.set(`p${i}`, parseCards(cards)));
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
  it('ties go to the tied player closest to the left of the button', () => {
    expect(new Probe(STUD, players(3), 1).actor(['9s 5d', '3s 4d', '9h 5c'])).toBe(2);
    expect(new Probe(STUD, players(3), 2).actor(['9s 5d', '3s 4d', '9h 5c'])).toBe(0);
    expect(new RazzProbe({ ...STUD, variant: GameVariant.Razz }, players(3), 1).actor(['3s 5d', 'Ks Qd', '3h 5c'])).toBe(2);
  });
});

describe('Stud high open pair on 4th street (spec §4)', () => {
  // 3rd street: p0 door 9d, p1 door 2c (brings in), p2 door 7h. 4th: p0 9h (open pair), p1 4s, p2 8c.
  const deal = 'As Kh Qc Ah Kd Qd 9d 2c 7h 9h 4s 8c';
  function toFourth(game: BaseGame) {
    stack(game, deal);
    game.start();
    game.act('p1', ActionType.Bet, 0.5);
    game.act('p2', ActionType.Call);
    game.act('p0', ActionType.Call);
    expect(game.getState().phase).toBe(GamePhase.BettingFourth);
  }

  it('offers the small or big bet, and after the big bet all raises are big bets', () => {
    const game = new StudGame(STUD, players(3), 0);
    toFourth(game);
    expect(active(game)).toBe('p0');
    expect(game.getAvailableActions().betOptions).toEqual([2, 4]);
    game.act('p0', ActionType.Bet, 4);
    const a = game.getAvailableActions();
    expect(a.raiseOptions).toBeUndefined();
    expect(a.minRaise).toBe(8);
  });

  it('after a small bet, a raise may be the small or the big amount', () => {
    const game = new StudGame(STUD, players(3), 0);
    toFourth(game);
    game.act('p0', ActionType.Bet, 2);
    expect(game.getAvailableActions().raiseOptions).toEqual([4, 6]);
  });

  it('does not apply to Stud/8 or Razz', () => {
    const stud8 = new StudHiLoGame({ ...STUD, variant: GameVariant.StudHiLo }, players(3), 0);
    toFourth(stud8);
    expect(stud8.getAvailableActions().betOptions).toBeUndefined();
    expect(stud8.getAvailableActions().maxBet).toBe(2);
  });
});

describe('Fixed-limit cap and short all-ins (spec §3)', () => {
  it('preflop the big blind is the opening bet: bet + 3 raises caps at 8', () => {
    const game = new LHEGame(LIMIT, players(3), 0);
    game.start();
    game.act('p0', ActionType.Raise, 4);
    game.act('p1', ActionType.Raise, 6);
    game.act('p2', ActionType.Raise, 8);
    expect(active(game)).toBe('p0');
    expect(game.getAvailableActions().canRaise).toBe(false);
    expect(game.getAvailableActions().canCall).toBe(true);
  });

  function toFlop(stackP2: number) {
    const ps = players(3); ps[2].chips = stackP2;
    const game = new LHEGame(LIMIT, ps, 0);
    game.start();
    game.act('p0', ActionType.Call);
    game.act('p1', ActionType.Call);
    game.act('p2', ActionType.Check);
    expect(game.getState().phase).toBe(GamePhase.BettingFlop);
    return game;
  }

  it('an all-in raise of less than half a bet does not reopen the betting', () => {
    const game = toFlop(4.75); // 2.75 behind on the flop
    game.act('p1', ActionType.Bet, 2);
    game.act('p2', ActionType.Raise, 2.75);
    game.act('p0', ActionType.Call);
    expect(active(game)).toBe('p1');
    expect(game.getAvailableActions().canCall).toBe(true);
    expect(game.getAvailableActions().canRaise).toBe(false);
  });

  it('an all-in raise of half a bet or more reopens the betting', () => {
    const game = toFlop(5); // 3 behind: a raise of 1 = half a bet
    game.act('p1', ActionType.Bet, 2);
    game.act('p2', ActionType.Raise, 3);
    game.act('p0', ActionType.Call);
    expect(game.getAvailableActions().canRaise).toBe(true);
  });

  it('a round that starts heads-up is uncapped', () => {
    const game = new LHEGame(LIMIT, players(2), 0);
    game.start();
    for (const [id, to] of [['p0', 4], ['p1', 6], ['p0', 8], ['p1', 10]] as const) game.act(id, ActionType.Raise, to);
    expect(game.getAvailableActions().canRaise).toBe(true);
  });
});

describe('Chip unit $0.25 (spec §2, §5)', () => {
  it('rejects amounts that are not whole chips', () => {
    const game = new NLHGame(NL, players(3), 0);
    game.start();
    expect(() => game.act('p0', ActionType.Raise, 1.1)).toThrow();
    game.act('p0', ActionType.Raise, 1.25);
    expect(game.getState().currentBet).toBe(1.25);
  });

  class SplitProbe extends O8Game {
    halves(amount: number) { return this.splitPotHalves(amount); }
    divide(amount: number) { return this.divideAmongWinners(amount, [this.state.players[2], this.state.players[1]]); }
  }
  it('splits pots in whole $0.25 chips with the odd chip to the high half, conserving the pot', () => {
    const probe = new SplitProbe({ ...LIMIT, variant: GameVariant.OmahaHiLo }, players(3), 0);
    expect(probe.halves(9)).toEqual([4.5, 4.5]);
    expect(probe.halves(9.25)).toEqual([4.75, 4.5]);
    expect(probe.halves(7)).toEqual([3.5, 3.5]);
    // Tied winners: the odd chip goes to the first tied player left of the button (p1 before p2).
    expect(probe.divide(5.25)).toEqual([2.5, 2.75]);
    expect(CHIP_UNIT).toBe(0.25);
  });
});

describe('Uncalled bets are returned, not won (spec §3)', () => {
  it('a fold win pays only the called pot and records the returned bet', () => {
    const game = new NLHGame(NL, players(3), 0);
    game.start();
    game.act('p0', ActionType.Raise, 10);
    game.act('p1', ActionType.Fold);
    game.act('p2', ActionType.Fold);
    const s = game.getState();
    expect(game.getWinners()).toEqual([{ playerId: 'p0', name: 'P0', amount: 1.25 }]);
    expect(s.uncalledReturns).toEqual([{ playerId: 'p0', amount: 9.5 }]);
    expect(s.players[0].chips).toBe(100.75);
  });

  it('an all-in called for less returns the excess to the bettor', () => {
    const ps = players(2); ps[1].chips = 20;
    const game = new NLHGame(NL, ps, 0);
    game.start();
    game.act('p0', ActionType.Raise, 100);
    game.act('p1', ActionType.Call);
    const s = game.getState();
    expect(s.phase).toBe(GamePhase.Complete);
    expect(s.uncalledReturns).toEqual([{ playerId: 'p0', amount: 80 }]);
    expect(game.getWinners().reduce((sum, w) => sum + w.amount, 0)).toBe(40);
    expect(total(game) - s.pots.reduce((sum, p) => sum + p.amount, 0)).toBe(120);
  });
});
