// Build a self-contained HTML hand-history report from hand-log JSONL files.
// Usage: node scripts/hand-report.mjs <out.html> <file-or-dir ...>
// Each hand shows cards, stacks, pots (with who could win each), payouts and
// the same per-hand checks as scripts/verify-hand-log.mjs.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [out = 'recordings/hand-report.html', ...inputs] = process.argv.slice(2);
const files = (inputs.length ? inputs : ['logs']).flatMap(t => statSync(t).isDirectory()
  ? readdirSync(t).filter(f => f.endsWith('.jsonl')).map(f => path.join(t, f)) : [t]);

const eq = (a, b) => Math.abs(a - b) < 1e-9;
const sum = xs => xs.reduce((a, b) => a + b, 0);

function analyze(h) {
  const won = id => sum(h.winners.filter(w => w.playerId === id).map(w => w.amount));
  const problems = [];
  if (!eq(sum(h.players.map(p => p.start)), sum(h.players.map(p => p.end)))) problems.push('chips not conserved');
  for (const p of h.players) if (!eq(p.start - p.totalBet + won(p.id), p.end)) problems.push(`${p.name}: stack arithmetic`);
  if (!eq(sum(h.pots.map(p => p.amount)), sum(h.players.map(p => p.totalBet)))) problems.push('pots != committed');
  if (!eq(sum(h.winners.map(w => w.amount)), sum(h.pots.map(p => p.amount)))) problems.push('paid != pots');
  for (const p of h.players) {
    const max = sum(h.players.map(q => Math.min(q.totalBet, p.totalBet)));
    if (won(p.id) > max + 1e-9) problems.push(`${p.name} won more than matchable`);
  }
  if (h.capBB) for (const p of h.players) if (p.start > h.capBB * h.bigBlind + 1e-9) problems.push(`${p.name} over cap`);
  const byPot = {};
  for (const w of h.winners) (byPot[w.potLabel ?? 'pot'] ??= []).push(w.side ?? 'scoop');
  const pots = Object.values(byPot);
  const tags = [];
  if (h.pots.length > 1) tags.push('side-pot');
  if (pots.some(s => s.includes('high') && s.includes('low') && (s.filter(x => x === 'low').length > 1 || s.filter(x => x === 'high').length > 1))) tags.push('quartered');
  if (pots.some(s => s.length > 1)) tags.push('split');
  if (h.players.some(p => p.behind > 0)) tags.push('capped');
  if (h.uncalled.length) tags.push('uncalled');
  return { problems, tags };
}

const all = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)))
  .map(h => ({ ...h, ...analyze(h) }));
// Keep the report small: every quartered / problem hand, and the first 60 of each other kind.
const picked = new Map();
const take = (pred, n) => { for (const h of all.filter(pred).slice(0, n)) picked.set(h.handId, h); };
take(h => h.problems.length, Infinity);
take(h => h.tags.includes('quartered'), Infinity);
for (const tag of ['side-pot', 'capped', 'split', 'uncalled']) take(h => h.tags.includes(tag), 60);
take(() => true, 40);
const hands = [...picked.values()].sort((a, b) => a.time.localeCompare(b.time));
const count = tag => all.filter(h => h.tags.includes(tag)).length;
const summary = { total: all.length, problems: all.filter(h => h.problems.length).length, sidePot: count('side-pot'), quartered: count('quartered'), split: count('split'), capped: count('capped'), uncalled: count('uncalled') };

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hand History Report</title>
<style>
:root { --bg:#f8fafc; --panel:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#0e7490; --good:#15803d; --bad:#b91c1c; --red:#dc2626; --tag:#e0f2fe; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0b1220; --panel:#111a2e; --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --accent:#67e8f9; --good:#4ade80; --bad:#f87171; --red:#f87171; --tag:#0c4a6e; } }
:root[data-theme="dark"] { --bg:#0b1220; --panel:#111a2e; --ink:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --accent:#67e8f9; --good:#4ade80; --bad:#f87171; --red:#f87171; --tag:#0c4a6e; }
* { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 60px; }
h1 { font-size: 22px; margin: 0 0 4px; } .muted { color: var(--muted); }
.stats { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; } .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:8px 12px; }
.stat b { display:block; font-size:18px; }
.filters { display:flex; flex-wrap:wrap; gap:6px; margin: 8px 0 16px; } .filters button { border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:999px; padding:5px 12px; cursor:pointer; font:inherit; }
.filters button.on { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.hand { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; margin-bottom:12px; }
.head { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; justify-content:space-between; } .head h2 { font-size:15px; margin:0; }
.tag { background:var(--tag); border-radius:6px; padding:1px 7px; font-size:12px; margin-left:4px; }
.ok { color:var(--good); font-weight:600; } .fail { color:var(--bad); font-weight:600; }
table { width:100%; border-collapse:collapse; margin-top:8px; font-size:13px; } th, td { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); } th { color:var(--muted); font-weight:500; }
td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
.card { display:inline-block; min-width:26px; padding:0 3px; margin-right:2px; border:1px solid var(--line); border-radius:4px; text-align:center; font-weight:600; background:var(--bg); }
.card.r { color: var(--red); } .folded { opacity:.45; }
.overflow { overflow-x:auto; }
</style></head><body><main>
<h1>Hand History Report</h1>
<div class="muted">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from ${files.length} log file(s). Showing ${hands.length} of ${summary.total} hands: every quartered pot and every hand with a problem, plus samples of each kind.</div>
<div class="stats">
  <div class="stat"><b>${summary.total}</b>hands checked</div>
  <div class="stat"><b class="${summary.problems ? 'fail' : 'ok'}">${summary.problems}</b>with problems</div>
  <div class="stat"><b>${summary.sidePot}</b>side-pot hands</div>
  <div class="stat"><b>${summary.quartered}</b>quartered pots</div>
  <div class="stat"><b>${summary.split}</b>split pots</div>
  <div class="stat"><b>${summary.capped}</b>capped hands</div>
  <div class="stat"><b>${summary.uncalled}</b>uncalled returns</div>
</div>
<div class="filters" id="filters"></div>
<div id="hands"></div>
</main>
<script>
const HANDS = ${JSON.stringify(hands)};
const FILTERS = [['all','All'],['quartered','Quartered'],['side-pot','Side pots'],['split','Split pots'],['capped','Capped'],['uncalled','Uncalled returns'],['problems','Problems']];
const money = x => '$' + x.toFixed(2);
const card = c => { const suit = c.slice(-1), r = c.slice(0, -1); const sym = {s:'♠',h:'♥',d:'♦',c:'♣'}[suit] ?? '?'; return '<span class="card' + (suit === 'h' || suit === 'd' ? ' r' : '') + '">' + r + sym + '</span>'; };
const esc = s => String(s).replace(/[&<>]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[ch]);
let current = 'all';
function render() {
  document.getElementById('filters').innerHTML = FILTERS.map(([k, l]) => '<button class="' + (k === current ? 'on' : '') + '" data-k="' + k + '">' + l + '</button>').join('');
  const list = HANDS.filter(h => current === 'all' || (current === 'problems' ? h.problems.length : h.tags.includes(current)));
  document.getElementById('hands').innerHTML = list.length ? list.map(h => {
    const name = id => esc(h.players.find(p => p.id === id)?.name ?? id);
    const players = h.players.map(p => '<tr class="' + (p.folded ? 'folded' : '') + '"><td>' + esc(p.name) + (p.folded ? ' (folded)' : '') + '</td><td>' + p.holeCards.map(card).join('') + '</td><td class="num">' + money(p.start) + '</td><td class="num">' + (p.behind ? money(p.behind) : '—') + '</td><td class="num">' + money(p.totalBet) + '</td><td class="num">' + money(p.end) + '</td></tr>').join('');
    const pots = h.pots.map((p, i) => '<tr><td>' + (h.pots.length > 1 ? (i === 0 ? 'Main' : 'Side ' + i) : 'Pot') + '</td><td class="num">' + money(p.amount) + '</td><td>' + p.eligible.map(name).join(', ') + '</td></tr>').join('');
    const winners = h.winners.map(w => '<tr><td>' + name(w.playerId) + '</td><td class="num">' + money(w.amount) + '</td><td>' + esc(w.side ?? '') + '</td><td>' + esc(w.potLabel ?? '') + '</td><td>' + esc(w.hand ?? '') + '</td></tr>').join('');
    const uncalled = h.uncalled.map(u => money(u.amount) + ' returned to ' + name(u.playerId)).join('; ');
    return '<section class="hand"><div class="head"><h2>' + esc(h.variant.toUpperCase()) + (h.capBB ? ' · cap ' + h.capBB + ' BB (' + money(h.capBB * h.bigBlind) + ')' : '') + h.tags.map(t => '<span class="tag">' + t + '</span>').join('') + '</h2>'
      + '<span>' + (h.problems.length ? '<span class="fail">✗ ' + esc(h.problems.join('; ')) + '</span>' : '<span class="ok">✓ checks pass</span>') + ' <span class="muted">' + esc(h.room) + (h.bot ? ' · ' + esc(h.bot) : '') + ' · ' + h.time.slice(11, 19) + '</span></span></div>'
      + (h.board.length ? '<div style="margin-top:6px">Board: ' + h.board.map(card).join('') + '</div>' : '')
      + '<div class="overflow"><table><thead><tr><th>Player</th><th>Cards</th><th class="num">In play</th><th class="num">Behind</th><th class="num">Put in</th><th class="num">End</th></tr></thead><tbody>' + players + '</tbody></table></div>'
      + '<div class="overflow"><table><thead><tr><th>Pot</th><th class="num">Amount</th><th>Eligible</th></tr></thead><tbody>' + pots + '</tbody></table></div>'
      + '<div class="overflow"><table><thead><tr><th>Winner</th><th class="num">Won</th><th>Side</th><th>Pot</th><th>Hand</th></tr></thead><tbody>' + winners + '</tbody></table></div>'
      + (uncalled ? '<div class="muted" style="margin-top:6px">Uncalled: ' + uncalled + '</div>' : '')
      + '</section>';
  }).join('') : '<p class="muted">No hands of this kind.</p>';
  for (const b of document.querySelectorAll('#filters button')) b.onclick = () => { current = b.dataset.k; render(); };
}
render();
</script></body></html>`;
writeFileSync(out, html);
console.log(`Wrote ${out}: ${hands.length} hands shown of ${summary.total} (${summary.quartered} quartered, ${summary.problems} with problems)`);
