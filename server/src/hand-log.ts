// ============================================================
// Hand log — one JSON line per completed hand
// ============================================================
// Written automatically in production (and by the local serve-prod launcher)
// to <repo>/logs/hands-YYYY-MM-DD.jsonl, or to $HAND_LOG_DIR. It records
// everything needed to audit a hand afterwards: stacks, cards, actions, pots,
// winners, uncalled returns and caps. Logging never affects play: failures are
// reported on the console and ignored.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HandLogRecord {
  time: string;
  room: string;
  bot?: string;
  handId: string;
  mode: string;
  variant: string;
  capBB: number | null;
  bigBlind: number;
  buttonSeat: number;
  players: Array<{
    id: string;
    name: string;
    seat: number;
    /** Chips in play at the deal (after any cap) */
    start: number;
    /** Chips kept behind by the mixed-game cap */
    behind: number;
    end: number;
    totalBet: number;
    folded: boolean;
    holeCards: string[];
  }>;
  board: string[];
  actions: Array<{ playerId: string; type: string; amount?: number; discards?: number }>;
  pots: Array<{ amount: number; eligible: string[] }>;
  winners: Array<{ playerId: string; amount: number; side?: string; potLabel?: string; hand?: string }>;
  uncalled: Array<{ playerId: string; amount: number }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function logDir(): string | null {
  if (process.env.HAND_LOG_DIR) return process.env.HAND_LOG_DIR;
  return process.env.NODE_ENV === 'production' ? path.resolve(here, '../../logs') : null;
}

export function logHand(record: HandLogRecord): void {
  const dir = logDir();
  if (!dir) return;
  const file = path.join(dir, `hands-${record.time.slice(0, 10)}.jsonl`);
  mkdir(dir, { recursive: true })
    .then(() => appendFile(file, JSON.stringify(record) + '\n'))
    .catch(err => console.error('[hand-log] write failed:', err instanceof Error ? err.message : err));
}

/** Compact card text, e.g. "Ah", "10c" */
export function cardText(card: { rank: number; suit: string } | null | undefined): string {
  if (!card) return '??';
  const r = ({ 14: 'A', 13: 'K', 12: 'Q', 11: 'J' } as Record<number, string>)[card.rank] ?? String(card.rank);
  return r + card.suit;
}
