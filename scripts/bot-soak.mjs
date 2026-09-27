// Headless bot soak: plays every bot scenario on a mocked clock (no waiting),
// writing each hand to logs/soak/ for scripts/verify-hand-log.mjs.
// Usage: npm run build, then: node scripts/bot-soak.mjs [handsPerScenario=300]
import { mock } from 'node:test';
import { rmSync } from 'node:fs';

const hands = Number(process.argv[2] ?? 300);
process.env.HAND_LOG_DIR = 'logs/soak';
rmSync('logs/soak', { recursive: true, force: true });

const { RoomManager } = await import('../server/dist/room-manager.js');
const { GameController } = await import('../server/dist/game-controller.js');
const { BOT_SCENARIOS } = await import('../server/dist/bots.js');

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const noop = () => {};
for (const scenario of BOT_SCENARIOS) {
  const rm = new RoomManager();
  const code = rm.createBotRoom('watcher', 'Soak', scenario.id);
  const room = rm.getRoom(code);
  const errors = [];
  const controller = new GameController(room, {
    sendHandState: noop, sendHandComplete: noop, sendDcChoose: noop, broadcastCountdown: noop,
    broadcastRoomState: noop, sendError: (_s, m) => errors.push(m), onHandSettled: () => rm.finalizeDepartures(room),
  });
  room.gameController = controller;
  controller.startHand();
  const seen = new Set();
  for (let t = 0; t < hands * 200 && seen.size < hands; t++) {
    mock.timers.tick(1000);
    const s = controller.getState();
    if (s) seen.add(s.id);
  }
  controller.destroy();
  console.log(`${scenario.id}: ${seen.size} hands${errors.length ? `, ${errors.length} server errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}` : ''}`);
}
mock.timers.reset();
// Let the queued log writes finish.
await new Promise(r => setTimeout(r, 1500));
