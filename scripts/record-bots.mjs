// Record a bot table to a captioned WebM video using headless Microsoft Edge.
// No extra installs: Edge streams screenshots over the DevTools protocol, and a
// second headless page re-plays them onto a canvas that MediaRecorder encodes.
// Captions come from the server's hand log, so each result is described on screen,
// and the video ends with scripts/verify-hand-log.mjs run on exactly those hands.
//
// Needs the production server running locally (scripts/serve-prod.mjs, port 3001).
// Usage: node scripts/record-bots.mjs <scenario> <seconds> [outDir=recordings]

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [scenario = 'side-pots', seconds = '90', outDir = 'recordings'] = process.argv.slice(2);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const APP = 'http://localhost:3001';
const PORT = 9300 + Math.floor(Math.random() * 400);
const W = 1280, H = 800;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP plumbing
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  };
  return {
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}
async function newPage(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await res.json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  return page;
}
const evaluate = async (page, expression) => {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
async function waitFor(page, expression, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await evaluate(page, expression).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// ---------------------------------------------------------------- captions from the hand log
const money = x => `$${x.toFixed(2)}`;
function describeHand(h) {
  const name = id => h.players.find(p => p.id === id)?.name ?? id;
  const lines = [];
  const title = `${h.variant.toUpperCase()}${h.capBB ? ` · cap ${h.capBB} BB (${money(h.capBB * h.bigBlind)})` : ''}`;
  if (h.pots.length > 1) lines.push(`Side pots: ${h.pots.map((p, i) => `${i === 0 ? 'Main' : `Side ${i}`} ${money(p.amount)} [${p.eligible.map(name).join(', ')}]`).join('  ·  ')}`);
  else if (h.pots.length) lines.push(`Pot ${money(h.pots[0].amount)}`);
  const winners = h.winners.map(w => `${name(w.playerId)} ${money(w.amount)}${w.side && w.side !== 'scoop' ? ` (${w.side})` : ''}${w.potLabel ? ` ${w.potLabel}` : ''}`);
  if (winners.length) lines.push(`Won: ${winners.join(', ')}`);
  for (const u of h.uncalled) lines.push(`Uncalled ${money(u.amount)} returned to ${name(u.playerId)}`);
  const capped = h.players.filter(p => p.behind > 0);
  if (capped.length) lines.push(`Behind the cap: ${capped.map(p => `${p.name} plays ${money(p.start)}, ${money(p.behind)} behind`).join('; ')}`);
  const byPot = {};
  for (const w of h.winners) (byPot[w.potLabel ?? 'pot'] ??= []).push(w.side);
  const quartered = Object.values(byPot).some(s => s.includes('high') && s.includes('low') && (s.filter(x => x === 'low').length > 1 || s.filter(x => x === 'high').length > 1));
  const tags = [h.pots.length > 1 && 'SIDE POT', quartered && 'QUARTERED', capped.length && 'CAPPED'].filter(Boolean);
  return { title: `${title}${tags.length ? `   ◆ ${tags.join(' · ')}` : ''}`, lines };
}

// ---------------------------------------------------------------- record
const profile = path.join(os.tmpdir(), `poker-rec-${PORT}`);
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(250); } }

  // 1. Open the lobby and start the bot table
  const app = await newPage(APP);
  await waitFor(app, `document.body && document.body.innerText.includes('Watch bots')`);
  await evaluate(app, `localStorage.setItem('poker-player-name', 'Recorder'); true`);
  await waitFor(app, `document.body.innerText.toLowerCase().includes('connected')`);
  const label = await evaluate(app, `(() => { const b = [...document.querySelectorAll('button')].find(b => b.innerText.startsWith(${JSON.stringify(
    { 'side-pots': 'Side pots', 'hi-lo': 'Hi/lo', caps: 'Mixed-game caps', 'draw-games': 'Draw games', 'ten-game': '10-Game' }[scenario])})); b.click(); return b.innerText.split('\\n')[0]; })()`);
  await waitFor(app, `location.pathname.startsWith('/room/')`);
  const room = await evaluate(app, `location.pathname.split('/')[2]`);
  console.log(`Recording "${label}" in room ${room} for ${seconds}s`);

  // 2. Capture frames
  const frames = [];
  app.on('Page.screencastFrame', p => {
    frames.push({ t: p.metadata.timestamp * 1000, data: p.data });
    app.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  const startWall = Date.now();
  await app.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(Number(seconds) * 1000);
  await app.send('Page.stopScreencast');
  const endWall = Date.now();
  await evaluate(app, `location.href = 'about:blank'; true`); // leave: the bot table pauses and is cleaned up
  app.close();
  console.log(`Captured ${frames.length} frames`);

  // 3. Hands from the log for this room during the recording
  const logFile = `logs/hands-${new Date(startWall).toISOString().slice(0, 10)}.jsonl`;
  await sleep(500);
  const hands = existsSync(logFile)
    ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
        .filter(h => h.room === room && Date.parse(h.time) >= startWall && Date.parse(h.time) <= endWall)
    : [];
  mkdirSync(outDir, { recursive: true });
  const handsFile = path.join(outDir, `${scenario}-hands.jsonl`);
  writeFileSync(handsFile, hands.map(h => JSON.stringify(h)).join('\n') + (hands.length ? '\n' : ''));
  let verdict = 'No hands completed during the recording.';
  if (hands.length) {
    try { verdict = execFileSync(process.execPath, ['scripts/verify-hand-log.mjs', handsFile], { encoding: 'utf8' }); }
    catch (e) { verdict = String(e.stdout ?? e.message); }
  }
  // Show each hand's caption from when it ends until the next hand ends (max 25s):
  // an all-in runout plays for up to ~10s before the result appears on the table.
  const t0 = frames.length ? frames[0].t : startWall;
  const ends = hands.map(h => Date.parse(h.time) - t0);
  const captions = hands.map((h, i) => ({ from: ends[i], to: Math.min(ends[i + 1] ?? Infinity, ends[i] + 25000), n: i + 1, ...describeHand(h) }));

  // 4. Encode: replay frames onto a canvas in real time and let MediaRecorder make a WebM
  const enc = await newPage('about:blank');
  await evaluate(enc, `(() => {
    const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H + 120}; document.body.appendChild(c);
    const g = c.getContext('2d'); window.__g = g; window.__img = null; window.__cap = null; window.__slate = null;
    const draw = () => {
      g.fillStyle = '#0b1220'; g.fillRect(0, 0, ${W}, ${H + 120});
      if (window.__img) g.drawImage(window.__img, 0, 0, ${W}, ${H});
      g.fillStyle = '#0b1220'; g.fillRect(0, ${H}, ${W}, 120);
      g.font = 'bold 18px Segoe UI, Arial'; g.fillStyle = '#67e8f9';
      g.fillText(${JSON.stringify(`Bot table: ${label}  ·  room ${room}`)}, 16, ${H + 26});
      const cap = window.__cap;
      if (cap) {
        g.fillStyle = '#fde68a'; g.font = 'bold 17px Segoe UI, Arial'; g.fillText('Hand ' + cap.n + ': ' + cap.title, 16, ${H + 52});
        g.fillStyle = '#e2e8f0'; g.font = '15px Segoe UI, Arial';
        cap.lines.slice(0, 3).forEach((l, i) => g.fillText(l.length > 150 ? l.slice(0, 147) + '…' : l, 16, ${H + 76} + i * 20));
      } else { g.fillStyle = '#94a3b8'; g.font = '15px Segoe UI, Arial'; g.fillText('Hand details from the server log appear here when each hand finishes.', 16, ${H + 56}); }
      if (window.__slate) {
        g.fillStyle = 'rgba(2,6,23,0.93)'; g.fillRect(0, 0, ${W}, ${H + 120});
        g.fillStyle = '#e2e8f0'; g.font = '16px Consolas, monospace';
        window.__slate.split('\\n').forEach((l, i) => g.fillText(l, 40, 60 + i * 26));
      }
    };
    setInterval(draw, 50);
    const stream = c.captureStream(20);
    const type = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3000000 });
    window.__chunks = []; rec.ondataavailable = e => e.data.size && window.__chunks.push(e.data);
    window.__rec = rec; rec.start(1000);
    window.__show = async (b64, cap) => { const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode(); window.__img = i; window.__cap = cap; };
    window.__finish = () => new Promise(res => { window.__rec.onstop = async () => {
      const blob = new Blob(window.__chunks, { type: 'video/webm' });
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768));
      res(btoa(s)); }; window.__rec.stop(); });
    return true;
  })()`);
  const encStart = Date.now();
  for (const f of frames) {
    const at = f.t - t0;
    const wait = at - (Date.now() - encStart);
    if (wait > 0) await sleep(wait);
    const cap = captions.filter(c => at >= c.from && at <= c.to).at(-1) ?? null;
    await evaluate(enc, `window.__show(${JSON.stringify(f.data)}, ${JSON.stringify(cap)})`);
  }
  // Hold the last frame so late captions still show, then the verifier slate.
  const tail = Math.max(0, ...captions.map(c => c.to).filter(Number.isFinite)) - (frames.at(-1)?.t - t0 || 0);
  for (let t = 0; t < Math.min(tail, 8000); t += 500) {
    const at = (frames.at(-1)?.t - t0 || 0) + t;
    const cap = captions.filter(c => at >= c.from && at <= c.to).at(-1) ?? null;
    await evaluate(enc, `window.__cap = ${JSON.stringify(cap)}; true`);
    await sleep(500);
  }
  const slate = [`Checker: scripts/verify-hand-log.mjs on the ${hands.length} hand(s) played in this video`, '', ...verdict.trim().split('\n')].join('\n');
  await evaluate(enc, `window.__slate = ${JSON.stringify(slate)}; true`);
  await sleep(6000);
  const b64 = await evaluate(enc, `window.__finish()`);
  const file = path.join(outDir, `${scenario}.webm`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  enc.close();
  console.log(`Saved ${file} (${(b64.length * 0.75 / 1e6).toFixed(1)} MB), ${hands.length} hands, log excerpt ${handsFile}`);
  console.log(verdict.trim());
} finally {
  // Edge spawns child processes; end the whole tree before removing its temp profile.
  try { execFileSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { edge.kill(); }
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir; Windows may hold a file briefly */ }
}
