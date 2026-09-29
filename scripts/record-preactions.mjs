// Record a scripted test of pre-actions and pre-selected discards as captioned WebM videos.
// A headless Edge page plays one seat ("Tester") through the real UI, clicking the
// pre-action buttons, cards and "Draw N" toggle. Two opponents play through the public
// socket API, so card privacy is the normal one. Each check is shown as a caption with
// PASS/FAIL, and results are written to <outDir>/preactions-notes.md.
//
// Needs the production server running locally (scripts/serve-prod.mjs, port 3001).
// Usage: node scripts/record-preactions.mjs [outDir=recordings]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { io } from 'socket.io-client';

const [outDir = 'recordings'] = process.argv.slice(2);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = 'http://localhost:3001';
const PORT = 9300 + Math.floor(Math.random() * 400);
const W = 1280, H = 800;
const BOT_MS = 2500;      // opponents think this long, leaving time to arm a pre-action
const FAST_MS = 900;      // a pre-action counts as auto-fired if sent this soon after the turn arrives
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRAW = new Set(['draw-1', 'draw-2', 'draw-3']);
const BETS = new Set(['check', 'call', 'bet', 'raise', 'fold', 'all-in']);
let aggressive = false;   // opponents open the betting when checked to (to put the tester facing a bet)

// ---------------------------------------------------------------- CDP plumbing
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  };
  return {
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}
async function newPage(url) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  page.targetId = target.id;
  return page;
}
const evaluate = async (page, expression) => {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
async function until(fn, timeoutMs = 30000, label = 'condition') {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await Promise.resolve().then(fn).catch(() => false)) return true; await sleep(150); }
  throw new Error(`Timed out waiting for ${label}`);
}

// DOM helpers for the tester page (only the tester's own cards are clickable while picking discards).
const HELPERS = `window.__t = {
  // Ticked toggles show a check mark before the label; compare the label alone.
  text: b => b.innerText.replace('✓', '').trim(),
  toggles: () => [...document.querySelectorAll('button[aria-pressed]')].map(b => ({ label: window.__t.text(b), on: b.getAttribute('aria-pressed') === 'true' })),
  pick: (sel, label) => { const bs = [...document.querySelectorAll(sel)]; return bs.find(b => window.__t.text(b) === label) ?? bs.find(b => window.__t.text(b).startsWith(label)); },
  tap: label => { const b = window.__t.pick('button[aria-pressed]', label); if (!b) return false; b.click(); return true; },
  cards: () => [...document.querySelectorAll('div.cursor-pointer.duration-200')],
  card: i => { const c = window.__t.cards()[i]; if (!c) return false; c.click(); return true; },
  selected: () => window.__t.cards().filter(c => c.style.outline.includes('solid')).length,
  panel: () => [...document.querySelectorAll('button:not([aria-pressed])')].map(b => b.innerText.trim()).filter(t => /^(Fold|Check|Call |Raise|Bet|Draw \\d|Stand Pat)/.test(t)),
  press: label => { const b = window.__t.pick('button:not([aria-pressed])', label); if (!b) return false; b.click(); return true; },
}; true`;

// ---------------------------------------------------------------- opponents (public socket API)
function opponent(name) {
  const s = io(APP, { transports: ['websocket'], reconnection: false });
  const bot = { name, s, state: null, actions: null, yourTurn: false, raiseNext: false, timer: null };
  s.on('hand-state', d => { bot.state = d.handState; bot.actions = d.availableActions; bot.yourTurn = d.isYourTurn; plan(bot); });
  s.on('hand-complete', d => { bot.state = d.finalState ?? bot.state; bot.yourTurn = false; });
  s.on('error', e => console.log(`  [${name}] server error: ${e.message}`));
  return bot;
}
function plan(bot) {
  clearTimeout(bot.timer);
  if (!bot.yourTurn || !bot.state) return;
  const version = { handId: bot.state.id, actionCount: bot.state.actionHistory.length };
  bot.timer = setTimeout(() => {
    const st = bot.state, a = bot.actions;
    if (!st || st.id !== version.handId || st.actionHistory.length !== version.actionCount || !bot.yourTurn) return;
    if (DRAW.has(st.phase)) {
      const n = Math.floor(Math.random() * 3);
      bot.s.emit('discard', { cardIndices: [0, 1, 2].slice(0, n), ...version });
      return;
    }
    if (bot.raiseNext && (a.canRaise || a.canBet)) {
      bot.raiseNext = false;
      const nl = st.bettingStructure !== 'fixed-limit';
      const amount = a.canRaise ? (nl ? Math.min(a.maxRaise, Math.max(a.minRaise, st.currentBet * 3)) : a.minRaise) : a.minBet;
      bot.s.emit('action', { type: a.canRaise ? 'raise' : 'bet', amount, ...version });
      return;
    }
    if (aggressive && a.canBet) { bot.s.emit('action', { type: 'bet', amount: a.betOptions?.[0] ?? a.minBet, ...version }); return; }
    bot.s.emit('action', { type: a.canCheck ? 'check' : 'call', ...version });
  }, BOT_MS);
}
const once = (s, ev) => new Promise(res => s.once(ev, res));

// ---------------------------------------------------------------- session
const profile = path.join(os.tmpdir(), `poker-pre-${PORT}`);
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
const results = [];
let bots = [];

async function session(variant, label, settings, tests, file) {
  // Opponents create the room, sit, and start; the tester joins mid-game and is dealt in next hand.
  bots = [opponent('Alice'), opponent('Bob')];
  await Promise.all(bots.map(b => once(b.s, 'connect')));
  const created = once(bots[0].s, 'room-created');
  bots[0].s.emit('create-room', { playerName: 'Alice', settings: { gameMode: 'specific', variant, startingChips: 200, ...settings } });
  const { roomCode } = await created;
  const joined = once(bots[1].s, 'room-joined');
  bots[1].s.emit('join-room', { roomCode, playerName: 'Bob' });
  await joined;
  for (const b of bots) { b.s.emit('sit-down', { buyIn: settings.buyIn }); await sleep(200); }
  bots[0].s.emit('start-hand');

  // Tester's own action times, seen through Alice's broadcasts
  const log = { turns: [], acts: [] };
  const watch = d => {
    const st = d.handState ?? d.finalState; if (!st) return;
    const tester = st.players.find(p => p.name === 'Tester'); if (!tester) return;
    const la = d.lastAction;
    if (la && la.playerId === tester.id) log.acts.push({ at: Date.now(), type: la.type, amount: la.amount, discardCount: la.discardCount, phase: st.phase });
    const active = st.players[st.activePlayerIndex];
    if (d.handState && active?.id === tester.id && st.phase !== 'complete') {
      const key = `${st.id}:${st.actionHistory.length}`;
      if (log.turns.at(-1)?.key !== key) log.turns.push({ key, at: Date.now(), phase: st.phase });
    }
  };
  bots[0].s.on('hand-state', watch); bots[0].s.on('hand-complete', watch);

  const page = await newPage(`${APP}/`);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS });
  await until(() => evaluate(page, `document.readyState === 'complete'`), 15000, 'lobby');
  await evaluate(page, `localStorage.setItem('poker-player-name', 'Tester'); location.href = '/room/${roomCode}'; true`);
  await until(() => evaluate(page, `[...document.querySelectorAll('button')].some(b => b.innerText.trim().startsWith('Join'))`), 15000, 'join prompt');
  await evaluate(page, `[...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('Join')).click(); true`);
  await until(() => evaluate(page, `[...document.querySelectorAll('button')].some(b => b.innerText.startsWith('Sit Down'))`), 15000, 'sit down');
  await evaluate(page, `[...document.querySelectorAll('button')].find(b => b.innerText.startsWith('Sit Down')).click(); true`);

  // Record
  const frames = [], captions = [];
  page.on('Page.screencastFrame', p => { frames.push({ t: p.metadata.timestamp * 1000, data: p.data }); page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {}); });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const caption = (title, lines) => captions.push({ at: Date.now(), title, lines });
  caption(`${label}: waiting to be dealt in`, ['The tester (bottom seat) is played by the script through the real page; Alice and Bob act after 2.5s.']);

  const ctx = {
    page, log, caption,
    // Let React re-render after each click before the next read
    ev: async expr => { const r = await evaluate(page, expr); await sleep(250); return r; },
    // The tester still has to act this betting round
    owes: () => { const st = bots[0].state, me = ctx.me(); return !!me && (ctx.toCall() > 0 || !st.actionHistory.slice(st.phaseStartActionIndex).some(a => a.playerId === me.id)); },
    nextBet: async (since, timeoutMs = 30000) => { await until(() => log.acts.some(a => a.at > since && BETS.has(a.type)), timeoutMs, 'tester betting action'); return log.acts.find(a => a.at > since && BETS.has(a.type)); },
    view: () => bots[0].state,
    me: () => bots[0].state?.players.find(p => p.name === 'Tester'),
    testerActive: () => { const st = bots[0].state; return !!st && st.players[st.activePlayerIndex]?.name === 'Tester'; },
    activeBot: () => { const st = bots[0].state; const n = st?.players[st.activePlayerIndex]?.name; return bots.find(b => b.name === n); },
    toCall: () => { const st = bots[0].state, me = ctx.me(); return st && me ? Math.max(0, Math.min(st.currentBet - me.bet, me.chips)) : 0; },
    inHand: () => { const me = ctx.me(); return !!me && !me.folded && !me.allIn && !['complete', 'showdown'].includes(bots[0].state.phase); },
    // Tester's next own action after `since`
    nextAct: async (since, timeoutMs = 20000) => { await until(async () => log.acts.some(a => a.at > since), timeoutMs, 'tester action'); return log.acts.find(a => a.at > since); },
    turnBefore: at => [...log.turns].reverse().find(t => t.at <= at + 50),
    toggles: () => evaluate(page, `window.__t.toggles()`),
  };
  await until(() => ctx.inHand(), 60000, 'tester dealt in');

  // Between tests the tester plays on by itself (check/call, stand pat or draw what is picked)
  // once their turn has waited 1.5s, so pre-actions always get the first chance.
  let turnKey = null, turnSince = 0, busy = false;
  const autoplay = setInterval(async () => {
    if (ctx.hold || busy || !ctx.testerActive()) return;
    const key = log.turns.at(-1)?.key;
    if (key !== turnKey) { turnKey = key; turnSince = Date.now(); return; }
    if (Date.now() - turnSince < 1500) return;
    busy = true;
    try { await evaluate(page, `window.__t.press('Check') || window.__t.press('Call') || window.__t.press('Stand Pat') || window.__t.press('Draw')`); } catch { /* page busy */ }
    turnSince = Date.now(); busy = false;
  }, 300);

  for (const t of tests.filter(t => !process.env.ONLY || t.name.includes(process.env.ONLY))) {
    const started = Date.now();
    caption(`${label} · ${t.name}`, [`Expect: ${t.expect}`]);
    let r;
    // A test that couldn't set up cleanly (e.g. betting capped, hand ended) tries again, up to 3 times.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { r = await t.run(ctx); } catch (e) { r = { ok: false, detail: `Error: ${e.message}` }; }
      ctx.hold = false;
      if (r.ok !== null) break;
      caption(`${label} · ${t.name}  (retry ${attempt})`, [`Expect: ${t.expect}`, `Set-up missed: ${r.detail}`]);
    }
    results.push({ game: label, name: t.name, expect: t.expect, ...r, seconds: ((Date.now() - started) / 1000).toFixed(1) });
    caption(`${label} · ${t.name}   ◆ ${r.ok === null ? 'NOT RUN' : r.ok ? 'PASS' : 'FAIL'}`, [`Expect: ${t.expect}`, `Result: ${r.detail}`]);
    console.log(`${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${label} · ${t.name}: ${r.detail}`);
    await sleep(3500);
  }
  clearInterval(autoplay);
  await page.send('Page.stopScreencast');
  await evaluate(page, `location.href = 'about:blank'; true`).catch(() => {});
  page.close();
  for (const b of bots) { clearTimeout(b.timer); b.s.disconnect(); }
  await encode(frames, captions, label, file);
}

// Wait for a moment when the tester is in the hand, not acting, in a betting round, and `extra` holds.
async function bettingWindow(ctx, extra = () => true, timeoutMs = 240000) {
  await until(async () => ctx.inHand() && !ctx.testerActive() && !DRAW.has(ctx.view().phase) && ctx.owes() && extra()
    && (await ctx.toggles()).some(t => !/^(Draw|Stand Pat)/.test(t.label)), timeoutMs, 'a betting window');
}

// ---------------------------------------------------------------- tests
const limitTests = [
  {
    name: 'Draw 2 ticked early goes in by itself',
    expect: 'pick 2 cards and tick "Draw 2" before the draw; the tester discards 2 the moment the draw reaches them',
    run: async ctx => {
      await until(async () => ctx.inHand() && !ctx.testerActive() && (ctx.view().drawsRemaining ?? 0) > 0 && !DRAW.has(ctx.view().phase)
        && (await ctx.toggles()).some(t => t.label === 'Stand Pat'), 90000, 'pre-draw window');
      await ctx.ev(`window.__t.card(1)`); await ctx.ev(`window.__t.card(3)`);
      const label = (await ctx.toggles()).find(t => /^Draw/.test(t.label))?.label;
      await ctx.ev(`window.__t.tap('Draw')`);
      await ctx.ev(`window.__t.tap('Check/Call Any') || window.__t.tap('Call Any')`); // betting before the draw plays itself
      const armedAt = Date.now();
      await until(async () => ctx.log.acts.some(a => a.at > armedAt && a.type !== 'check' && a.type !== 'call'), 60000, 'tester draw');
      const d = ctx.log.acts.find(a => a.at > armedAt && (a.type === 'discard' || a.type === 'stand-pat'));
      const turn = d && ctx.turnBefore(d.at);
      const ms = d && turn ? d.at - turn.at : null;
      const ok = label === 'Draw 2' && d?.type === 'discard' && d.discardCount === 2 && ms !== null && ms < FAST_MS;
      return { ok, detail: `toggle read "${label}"; tester ${d?.type} ${d?.discardCount ?? ''} card(s) ${ms}ms after the draw reached them` };
    },
  },
  {
    name: 'Picked but not ticked: no auto-draw',
    expect: 'pick 1 card without ticking; at the draw nothing is sent, the Draw button reads "Draw 1" with the card still raised; tapping it discards 1',
    run: async ctx => {
      await until(async () => ctx.inHand() && !ctx.testerActive() && (ctx.view().drawsRemaining ?? 0) > 0 && !DRAW.has(ctx.view().phase)
        && (await ctx.toggles()).some(t => t.label === 'Stand Pat'), 120000, 'pre-draw window');
      await ctx.ev(`window.__t.card(0)`);
      await ctx.ev(`window.__t.tap('Check/Call Any') || window.__t.tap('Call Any')`);
      const since = Date.now();
      await until(() => ctx.testerActive() && DRAW.has(ctx.view().phase), 60000, 'tester draw turn');
      ctx.hold = true;
      await sleep(3000);
      const sent = ctx.log.acts.filter(a => a.at > since && (a.type === 'discard' || a.type === 'stand-pat')).length;
      const panel = await ctx.ev(`window.__t.panel()`), selected = await ctx.ev(`window.__t.selected()`);
      const pressAt = Date.now();
      await ctx.ev(`window.__t.press('Draw')`);
      const d = await ctx.nextAct(pressAt);
      const ok = sent === 0 && panel.includes('Draw 1') && selected === 1 && d.type === 'discard' && d.discardCount === 1;
      return { ok, detail: `after 3s: ${sent} draw sent, button "${panel.join(', ')}", ${selected} card raised; after tapping: ${d.type} ${d.discardCount}` };
    },
  },
  {
    name: 'Changing the pick un-ticks Draw N',
    expect: 'pick 1, tick "Draw 1", then tap another card: the toggle un-ticks and reads "Draw 2"; re-tick and it discards 2 by itself',
    run: async ctx => {
      await until(async () => ctx.inHand() && !ctx.testerActive() && (ctx.view().drawsRemaining ?? 0) > 0 && !DRAW.has(ctx.view().phase)
        && (await ctx.toggles()).some(t => t.label === 'Stand Pat'), 120000, 'pre-draw window');
      const before = await ctx.toggles();
      const clicked = await ctx.ev(`window.__t.card(2)`);
      const picked = await ctx.toggles(), raised = await ctx.ev(`window.__t.selected()`);
      await ctx.ev(`window.__t.tap('Draw')`);
      const armed = (await ctx.toggles()).find(t => /^Draw/.test(t.label));
      if (process.env.DEBUG) console.log('  debug', JSON.stringify({ before, clicked, picked, raised, armedAll: await ctx.toggles(), phase: ctx.view().phase, cards: await ctx.ev(`window.__t.cards().length`) }));
      await ctx.ev(`window.__t.card(4)`);
      const after = (await ctx.toggles()).find(t => /^Draw/.test(t.label));
      await sleep(1200);
      await ctx.ev(`window.__t.tap('Draw')`);
      await ctx.ev(`window.__t.tap('Check/Call Any') || window.__t.tap('Call Any')`);
      const since = Date.now();
      await until(() => ctx.log.acts.some(a => a.at > since && (a.type === 'discard' || a.type === 'stand-pat')), 60000, 'tester draw');
      const d = ctx.log.acts.find(a => a.at > since && (a.type === 'discard' || a.type === 'stand-pat'));
      const ms = d.at - ctx.turnBefore(d.at).at;
      const ok = armed?.label === 'Draw 1' && armed.on && after?.label === 'Draw 2' && !after.on && d.discardCount === 2 && ms < FAST_MS;
      return { ok, detail: `ticked "${armed?.label}" (${armed?.on ? 'on' : 'off'}) → after tapping a card "${after?.label}" (${after?.on ? 'on' : 'off'}); re-ticked: discarded ${d.discardCount} after ${ms}ms` };
    },
  },
  {
    name: 'Call X drops when someone raises',
    expect: 'tick "Call X"; an opponent raises first; nothing is sent and the normal Fold/Call/Raise buttons appear',
    run: async ctx => {
      aggressive = true;
      await bettingWindow(ctx, () => ctx.toCall() > 0 && ctx.activeBot());
      aggressive = false;
      const bot = ctx.activeBot(); bot.raiseNext = true;
      const callLabel = (await ctx.toggles()).find(t => /^Call \d/.test(t.label))?.label;
      await ctx.ev(`window.__t.tap(${JSON.stringify(callLabel)})`);
      ctx.hold = true;
      const since = Date.now();
      await until(() => ctx.testerActive() || !ctx.inHand(), 30000, 'tester turn');
      if (!ctx.testerActive()) return { ok: null, detail: 'hand ended before the tester acted' };
      await sleep(2000);
      const sent = ctx.log.acts.filter(a => a.at > since).length;
      const panel = await ctx.ev(`window.__t.panel()`);
      const toCall = ctx.toCall();
      await ctx.ev(`window.__t.press('Call')`);
      const raised = String(toCall) !== callLabel?.replace('Call ', '');
      if (!raised) return { ok: null, detail: `no raise came (betting capped?); to call stayed ${toCall}` };
      const ok = sent === 0 && panel.some(p => p.startsWith('Call')) && panel.includes('Fold');
      return { ok, detail: `ticked "${callLabel}", to call became ${toCall}; after 2s: ${sent} action sent, buttons shown: ${panel.join(' · ')}` };
    },
  },
  {
    name: 'Call Any still calls after a raise',
    expect: 'tick "Call Any"; an opponent raises; the tester calls the new amount the moment it is their turn',
    run: async ctx => {
      await bettingWindow(ctx, () => ctx.toCall() > 0 && ctx.activeBot());
      ctx.activeBot().raiseNext = true;
      await ctx.ev(`window.__t.tap('Call Any')`);
      const since = Date.now();
      const a = await ctx.nextBet(since, 30000);
      const ms = a.at - ctx.turnBefore(a.at).at;
      return { ok: a.type === 'call' && ms < FAST_MS, detail: `tester ${a.type} ${a.amount ?? ''} ${ms}ms after their turn arrived` };
    },
  },
  {
    name: 'Raise Any raises (limit)',
    expect: 'tick "Raise Any" (or "Bet/Raise Any"); the tester raises or bets at once (calls only if betting is capped)',
    run: async ctx => {
      await bettingWindow(ctx);
      const labels = (await ctx.toggles()).map(t => t.label);
      await ctx.ev(`window.__t.tap('Raise Any') || window.__t.tap('Bet/Raise Any')`);
      const a = await ctx.nextBet(Date.now(), 30000);
      const ms = a.at - ctx.turnBefore(a.at).at;
      return { ok: ['raise', 'bet', 'call'].includes(a.type) && ms < FAST_MS, detail: `buttons were: ${labels.join(' · ')}; tester ${a.type} ${a.amount ?? ''} ${ms}ms after their turn` };
    },
  },
  {
    name: 'Check/Fold checks when free',
    expect: 'with nothing to call, tick "Check/Fold"; opponents check; the tester checks (never folds for free)',
    run: async ctx => {
      await bettingWindow(ctx, () => ctx.toCall() === 0);
      await ctx.ev(`window.__t.tap('Check/Fold')`);
      const a = await ctx.nextBet(Date.now(), 30000);
      const ms = a.at - ctx.turnBefore(a.at).at;
      return { ok: a.type === 'check' && ms < FAST_MS, detail: `tester ${a.type} ${ms}ms after their turn` };
    },
  },
  {
    name: 'Fold folds facing a bet',
    expect: 'facing a bet, tick "Fold"; the tester folds at once',
    run: async ctx => {
      aggressive = true;
      await bettingWindow(ctx, () => ctx.toCall() > 0);
      aggressive = false;
      await ctx.ev(`window.__t.tap('Fold')`);
      const a = await ctx.nextBet(Date.now(), 30000);
      const turn = ctx.turnBefore(a.at), ms = turn ? a.at - turn.at : 0;
      return { ok: a.type === 'fold' && ms < FAST_MS, detail: `tester ${a.type} ${ms}ms after their turn` };
    },
  },
];

const bigBetTests = [
  {
    name: 'No raise buttons in big-bet games',
    expect: 'facing a bet the buttons are Fold · Call X · Call Any; with nothing to call, Check/Fold · Check · Check/Call Any',
    run: async ctx => {
      const seen = {};
      await until(async () => {
        if (!(ctx.inHand() && !ctx.testerActive())) return false;
        const t = (await ctx.toggles()).map(x => x.label);
        if (t.length) seen[ctx.toCall() > 0 ? 'facing' : 'free'] = t;
        return seen.facing && seen.free;
      }, 120000, 'both button sets');
      const ok = /^Fold,Call \d[\d.]*,Call Any$/.test(seen.facing.join(',')) && seen.free.join(',') === 'Check/Fold,Check,Check/Call Any';
      return { ok, detail: `facing a bet: ${seen.facing.join(' · ')}  |  nothing to call: ${seen.free.join(' · ')}` };
    },
  },
  {
    name: 'Call Any calls a 3x raise (no-limit)',
    expect: 'tick "Call Any"; an opponent raises to 3x; the tester calls it the moment it is their turn',
    run: async ctx => {
      await bettingWindow(ctx, () => !!ctx.activeBot());
      ctx.activeBot().raiseNext = true;
      await ctx.ev(`window.__t.tap('Call Any') || window.__t.tap('Check/Call Any')`);
      const a = await ctx.nextBet(Date.now(), 30000);
      const ms = a.at - ctx.turnBefore(a.at).at;
      return { ok: (a.type === 'call' || a.type === 'check') && ms < FAST_MS, detail: `tester ${a.type} ${a.amount ?? ''} ${ms}ms after their turn` };
    },
  },
  {
    name: 'Check drops when someone bets (no-limit)',
    expect: 'with nothing to call, tick "Check"; an opponent bets first; nothing is sent and the normal buttons appear',
    run: async ctx => {
      await bettingWindow(ctx, () => ctx.toCall() === 0 && !!ctx.activeBot() && ctx.view().phase !== 'preflop');
      ctx.activeBot().raiseNext = true;
      await ctx.ev(`window.__t.tap('Check')`);
      ctx.hold = true;
      const since = Date.now();
      await until(() => ctx.testerActive() || !ctx.inHand(), 30000, 'tester turn');
      if (!ctx.testerActive()) return { ok: null, detail: 'hand ended before the tester acted' };
      await sleep(2000);
      const sent = ctx.log.acts.filter(a => a.at > since).length;
      const panel = await ctx.ev(`window.__t.panel()`);
      const toCall = ctx.toCall();
      await ctx.ev(`window.__t.press('Fold')`);
      return { ok: toCall > 0 && sent === 0 && panel.includes('Fold'), detail: `to call became ${toCall}; after 2s: ${sent} action sent, buttons shown: ${panel.join(' · ')}` };
    },
  },
];

// ---------------------------------------------------------------- encode
async function encode(frames, captions, label, file) {
  const t0 = frames.length ? frames[0].t : Date.now();
  const caps = captions.map((c, i) => ({ from: c.at - t0, to: (captions[i + 1]?.at ?? Infinity) - t0, title: c.title, lines: c.lines }));
  const enc = await newPage('about:blank');
  await evaluate(enc, `(() => {
    const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H + 110}; document.body.appendChild(c);
    const g = c.getContext('2d'); window.__img = null; window.__cap = null;
    const wrap = (text, max) => { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
    const draw = () => {
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, ${W}, ${H + 110});
      if (window.__img) g.drawImage(window.__img, 0, 0, ${W}, ${H});
      const cap = window.__cap; if (!cap) return;
      const pass = cap.title.includes('PASS'), fail = cap.title.includes('FAIL');
      g.fillStyle = pass ? '#86efac' : fail ? '#fca5a5' : '#fde68a'; g.font = 'bold 18px Segoe UI, Arial'; g.fillText(cap.title, 16, ${H + 26});
      g.fillStyle = '#e2e8f0'; g.font = '15px Segoe UI, Arial';
      cap.lines.flatMap(l => wrap(l, ${W - 32})).slice(0, 4).forEach((l, i) => g.fillText(l, 16, ${H + 50} + i * 19));
    };
    setInterval(draw, 50);
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 3000000 });
    window.__chunks = []; rec.ondataavailable = e => e.data.size && window.__chunks.push(e.data); window.__rec = rec; rec.start(1000);
    window.__show = async (b64, cap) => { const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode(); window.__img = i; window.__cap = cap; };
    window.__finish = () => new Promise(res => { window.__rec.onstop = async () => {
      const buf = new Uint8Array(await new Blob(window.__chunks, { type: 'video/webm' }).arrayBuffer()); let s = '';
      for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); res(btoa(s)); }; window.__rec.stop(); });
    return true;
  })()`);
  const start = Date.now();
  for (const f of frames) {
    const at = f.t - t0, wait = at - (Date.now() - start);
    if (wait > 0) await sleep(wait);
    await evaluate(enc, `window.__show(${JSON.stringify(f.data)}, ${JSON.stringify(caps.filter(c => at >= c.from && at < c.to).at(-1) ?? null)})`);
  }
  await evaluate(enc, `window.__cap = ${JSON.stringify(caps.at(-1) ?? null)}; true`);
  await sleep(4000);
  const b64 = await evaluate(enc, `window.__finish()`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, file), Buffer.from(b64, 'base64'));
  enc.close();
  console.log(`Saved ${path.join(outDir, file)} (${(b64.length * 0.75 / 1e6).toFixed(1)} MB) from ${frames.length} frames`);
}

// ---------------------------------------------------------------- run
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }
  await session('27td', '2-7 Triple Draw (limit)', { smallBlind: 1, bigBlind: 2, smallBet: 2, bigBet: 4, buyIn: 200 }, limitTests, 'preactions-limit-draw.webm');
  await session('nlh', "No-Limit Hold'em", { smallBlind: 1, bigBlind: 2, buyIn: 200 }, bigBetTests, 'preactions-no-limit.webm');
} catch (e) {
  console.error('Run stopped:', e);
} finally {
  for (const b of bots) { clearTimeout(b.timer); b.s.disconnect(); }
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { edge.kill(); }
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir; Windows may hold a file briefly */ }
  const mark = r => r.ok === null ? 'NOT RUN' : r.ok ? 'PASS' : 'FAIL';
  const notes = [`# Pre-action and pre-draw test run`, '', `Recorded ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by scripts/record-preactions.mjs.`,
    `A pre-action counts as auto-fired when the tester's action reached the server under ${FAST_MS}ms after their turn began.`, '',
    '| Game | Test | Result | Detail |', '|---|---|---|---|',
    ...results.map(r => `| ${r.game} | ${r.name} | ${mark(r)} | ${String(r.detail).replaceAll('|', '/')} |`), ''].join('\n');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'preactions-notes.md'), notes);
  console.log(`\n${results.filter(r => r.ok).length}/${results.length} passed; notes in ${path.join(outDir, 'preactions-notes.md')}`);
  process.exit(0);
}
