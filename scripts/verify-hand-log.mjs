// Independent checks over the hand log (logs/hands-*.jsonl, written by the server).
// Usage: node scripts/verify-hand-log.mjs [file-or-dir ...]   (default: logs/)
//
// Uses only the logged numbers, not the engine, so it cross-checks the engine's
// pot and payout arithmetic. Hand strength is not re-evaluated here.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const targets = args.length ? args : ['logs'];
const files = targets.flatMap(t => statSync(t).isDirectory()
  ? readdirSync(t).filter(f => f.endsWith('.jsonl')).map(f => path.join(t, f))
  : [t]);

const eq = (a, b) => Math.abs(a - b) < 1e-9;
const isChip = x => Number.isInteger(Math.round(x * 1e6) / 1e6 / 0.25);
const sum = xs => xs.reduce((a, b) => a + b, 0);

const problems = [];
const stats = { hands: 0, byVariant: {}, sidePotHands: 0, splitPots: 0, quartered: 0, cappedHands: 0, uncalledReturns: 0, foldWins: 0 };
const examples = { sidePot: null, quartered: null, capped: null };

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const h = JSON.parse(line);
    stats.hands++;
    stats.byVariant[h.variant] = (stats.byVariant[h.variant] ?? 0) + 1;
    const fail = msg => problems.push(`${h.room} ${h.handId} ${h.variant}: ${msg}`);
    const won = id => sum(h.winners.filter(w => w.playerId === id).map(w => w.amount));
    const bet = id => h.players.find(p => p.id === id)?.totalBet ?? 0;

    // 1. Chips conserved inside the hand
    if (!eq(sum(h.players.map(p => p.start)), sum(h.players.map(p => p.end)))) fail('chips not conserved');
    // 2. Each stack = start - committed + won (uncalled bets are already out of totalBet)
    for (const p of h.players) {
      if (!eq(p.start - p.totalBet + won(p.id), p.end)) fail(`${p.name}: start ${p.start} - bet ${p.totalBet} + won ${won(p.id)} != end ${p.end}`);
    }
    // 3. Pots hold exactly what was committed, and exactly the pots are paid out
    const potTotal = sum(h.pots.map(p => p.amount));
    if (!eq(potTotal, sum(h.players.map(p => p.totalBet)))) fail(`pots ${potTotal} != committed ${sum(h.players.map(p => p.totalBet))}`);
    if (!eq(sum(h.winners.map(w => w.amount)), potTotal)) fail(`paid ${sum(h.winners.map(w => w.amount))} != pots ${potTotal}`);
    // 4. Nobody folded wins; nobody wins more than they could match from each opponent
    for (const w of h.winners) {
      const p = h.players.find(q => q.id === w.playerId);
      if (!p) { fail(`winner ${w.playerId} not in hand`); continue; }
      if (p.folded) fail(`${p.name} won while folded`);
    }
    for (const p of h.players) {
      const maxWinnable = sum(h.players.map(q => Math.min(q.totalBet, p.totalBet)));
      if (won(p.id) > maxWinnable + 1e-9) fail(`${p.name} won ${won(p.id)} > matchable ${maxWinnable} (side-pot eligibility)`);
    }
    // 5. Whole $0.25 chips everywhere
    const amounts = [...h.players.flatMap(p => [p.start, p.end, p.totalBet, p.behind]), ...h.pots.map(p => p.amount), ...h.winners.map(w => w.amount), ...h.uncalled.map(u => u.amount)];
    if (!amounts.every(isChip)) fail('an amount is not a multiple of $0.25');
    // 6. Caps: nobody plays more than the cap; anyone with chips behind plays exactly the cap
    if (h.capBB) {
      const cap = h.capBB * h.bigBlind;
      for (const p of h.players) {
        if (p.start > cap + 1e-9) fail(`${p.name} played ${p.start} over the ${h.capBB} BB cap (${cap})`);
        if (p.behind > 0 && !eq(p.start, cap)) fail(`${p.name} has ${p.behind} behind but only ${p.start} in play (cap ${cap})`);
      }
      if (h.players.some(p => p.behind > 0)) { stats.cappedHands++; examples.capped ??= h; }
    }
    // 7. No card appears twice among final hands and board
    const cards = [...h.players.flatMap(p => p.holeCards), ...h.board];
    const dupes = cards.filter((c, i) => cards.indexOf(c) !== i);
    if (dupes.length) fail(`duplicate cards ${dupes.join(' ')}`);

    // Stats
    if (h.pots.length > 1) { stats.sidePotHands++; examples.sidePot ??= h; }
    stats.uncalledReturns += h.uncalled.length;
    if (h.players.filter(p => !p.folded).length === 1) stats.foldWins++;
    const byPot = new Map();
    for (const w of h.winners) {
      const key = w.potLabel ?? 'pot';
      const e = byPot.get(key) ?? { high: 0, low: 0, scoop: 0 };
      e[w.side ?? 'scoop'] = (e[w.side ?? 'scoop'] ?? 0) + 1;
      byPot.set(key, e);
    }
    for (const e of byPot.values()) {
      if (e.scoop > 1 || e.high > 1 || e.low > 1 || (e.high && e.low)) stats.splitPots++;
      if ((e.high && e.low) && (e.high > 1 || e.low > 1)) { stats.quartered++; examples.quartered ??= h; }
    }
  }
}

console.log(`Checked ${stats.hands} hands in ${files.length} file(s).`);
console.log('By game:', JSON.stringify(stats.byVariant));
console.log(`Side-pot hands ${stats.sidePotHands} · split pots ${stats.splitPots} · quartered pots ${stats.quartered} · capped hands ${stats.cappedHands} · uncalled returns ${stats.uncalledReturns} · fold wins ${stats.foldWins}`);
for (const [kind, h] of Object.entries(examples)) if (h) console.log(`Example ${kind}: room ${h.room} hand ${h.handId} (${h.variant})`);
if (problems.length) {
  console.log(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 50)) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('\nPASS — every hand conserves chips, pays exactly the pots, respects side-pot eligibility, caps and $0.25 chips, with no duplicate cards.');
}
