/** Shared timing for server hand boundaries and client runout presentation. */
export const RUNOUT_STREET_MS = 2000;
export const RUNOUT_CARD_MS = 180;
export const RESULT_PAUSE_MS = 800;

interface PresentationState {
  /** Stud runouts deal each street starting left of the button */
  buttonIndex?: number;
  communityCards: unknown[];
  players: { id: string; folded: boolean; sittingOut: boolean; holeCards: unknown[] }[];
  showdownStart?: { communityCardCount: number; holeCardCounts: Record<string, number> };
}
export interface RevealStep {
  atMs: number;
  communityCount?: number;
  playerId?: string;
  holeCardCount?: number;
}

export function planShowdown(state: PresentationState): { steps: RevealStep[]; durationMs: number } {
  const live = state.players.filter(p => !p.folded && !p.sittingOut);
  if (live.length < 2) return { steps: [], durationMs: 200 };
  const start = state.showdownStart;
  if (!start) return { steps: [], durationMs: RESULT_PAUSE_MS };
  const steps: RevealStep[] = [];
  let atMs = 0;
  let board = start.communityCardCount;
  while (board < state.communityCards.length) {
    atMs += RUNOUT_STREET_MS;
    const end = board === 0 ? Math.min(3, state.communityCards.length) : board + 1;
    while (board < end) {
      steps.push({ atMs, communityCount: ++board });
      atMs += RUNOUT_CARD_MS;
    }
  }
  // Stud: complete each street around the table before dealing the next street,
  // starting with the player to the left of the button, as it is dealt.
  const n = state.players.length;
  const button = state.buttonIndex ?? n - 1;
  const seatOrder = (p: { id: string }) => (state.players.findIndex(q => q.id === p.id) - button - 1 + 2 * n) % n;
  live.sort((a, b) => seatOrder(a) - seatOrder(b));
  const minCount = Math.min(...live.map(p => start.holeCardCounts[p.id] ?? p.holeCards.length));
  const maxCount = Math.max(...live.map(p => p.holeCards.length));
  for (let count = minCount + 1; count <= maxCount; count++) {
    const receiving = live.filter(p => (start.holeCardCounts[p.id] ?? p.holeCards.length) < count && p.holeCards.length >= count);
    if (!receiving.length) continue;
    atMs += RUNOUT_STREET_MS;
    for (const p of receiving) {
      steps.push({ atMs, playerId: p.id, holeCardCount: count });
      atMs += RUNOUT_CARD_MS;
    }
  }
  return { steps, durationMs: atMs + RESULT_PAUSE_MS };
}
