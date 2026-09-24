// Local integration test. No production room or external service is contacted.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const port = 43180;
const child = spawn(process.execPath, ['server/dist/index.js'], {
  cwd: new URL('../../', import.meta.url),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let output = '';
child.stdout.on('data', b => { output += b; });
child.stderr.on('data', b => { output += b; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (socket, name) => new Promise((resolve, reject) => {
  const receive = data => { clearTimeout(timer); resolve(data); };
  const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Timeout: ${name}`)); }, 3000);
  socket.once(name, receive);
});
const clients = [];
try {
  for (let i = 0; i < 100 && !output.includes('Poker server listening'); i++) await pause(50);
  assert(output.includes('Poker server listening'), output);
  for (let i = 0; i < 2; i++) {
    const socket = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false });
    clients.push(socket); await event(socket, 'connect');
  }
  const [host, peer] = clients;
  let response = event(host, 'room-created');
  host.emit('create-room', { playerName: 'Host', settings: {
    gameMode: 'specific', variant: 'nlh', smallBlind: 1, bigBlind: 2, smallBet: 2, bigBet: 4, startingChips: 100,
  } });
  const { roomCode } = await response;
  response = event(peer, 'room-joined'); peer.emit('join-room', { roomCode, playerName: 'Peer' });
  const { token: peerToken } = await response;
  assert.equal(typeof peerToken, 'string');
  for (const socket of clients) {
    response = event(socket, 'room-state'); socket.emit('sit-down', { buyIn: 100 });
    const view = await response;
    assert(!JSON.stringify(view).includes(peerToken), 'room-state must not carry tokens');
  }
  response = event(host, 'hand-state'); host.emit('start-hand');
  const initial = (await response).handState;
  for (const name of ['action', 'discard', 'pick-variant', 'add-on', 'create-room', 'join-room', 'sit-down', 'kick-player', 'update-settings']) {
    response = event(peer, 'error'); peer.emit(name, null);
    assert.match((await response).message, /Invalid/);
  }
  response = event(host, 'error'); host.emit('action', { type: 'call', handId: 'stale', actionCount: 2 });
  assert.match((await response).message, /stale/);
  response = event(host, 'hand-state');
  const payload = { type: 'call', handId: initial.id, actionCount: initial.actionHistory.length };
  host.emit('action', payload); const current = (await response).handState;
  assert.equal(current.actionHistory.length, initial.actionHistory.length + 1);
  response = event(host, 'error'); host.emit('action', payload);
  assert.match((await response).message, /stale/);

  // Token reconnect: the peer's socket drops and a new one reclaims the seat mid-hand.
  peer.disconnect();
  await pause(100);
  const back = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false });
  clients.push(back); await event(back, 'connect');
  const joined = event(back, 'room-joined');
  const snapshot = event(back, 'hand-state');
  back.emit('join-room', { roomCode, playerName: 'Someone', token: peerToken });
  assert.equal((await joined).reconnected, true);
  const resumed = await snapshot;
  assert.equal(resumed.handState.id, initial.id);
  assert.equal(resumed.handState.players.find(p => p.id === 'p1').holeCards.filter(Boolean).length, 2);

  // A name alone cannot take the seat.
  const stranger = io(`http://localhost:${port}`, { transports: ['websocket'], reconnection: false });
  clients.push(stranger); await event(stranger, 'connect');
  response = event(stranger, 'error'); stranger.emit('join-room', { roomCode, playerName: 'Peer' });
  assert.match((await response).message, /Name already taken/);

  const health = await fetch(`http://localhost:${port}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(child.exitCode, null);
  console.log('PASS socket server survives malformed payloads, rejects stale/duplicate actions, and reconnects by token only');
} finally {
  for (const socket of clients) socket.disconnect();
  if (child.exitCode === null) child.kill();
}
