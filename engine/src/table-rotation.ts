// ============================================================
// TableRotation — button, game rotation and dealer's choice by physical seat
// ============================================================
// Used by the multiplayer server. Everything is keyed by physical seat number,
// never by position in a compacted list of active players, so empty and
// sitting-out seats cannot shift the button or the chooser.
//
// Rotation modes (HORSE / 8-game / 9-game): each game plays HANDS_PER_VARIANT
// hands. The button moves one occupied seat per hand in blind games, straight
// through game changes, and stands still during stud (docs/NINE-GAME-RULES.md §1).
//
// Dealer's choice: each chosen game is a "segment" of one orbit plus one hand
// (the chooser gets two buttons). Each segment starts with the button one
// occupied seat left of where the previous segment started.
//
// Planning is separate from committing: nextHand() can be called again (for
// example after a chooser leaves before picking) and only completeHand()
// advances the session.

import { GameVariant } from './types.js';
import { GameMode, HORSE_ROTATION, EIGHT_GAME_ROTATION, NINE_GAME_ROTATION, HANDS_PER_VARIANT, CAP_RULES } from './session.js';

export interface PlannedHand {
  buttonSeat: number;
  /** null until the dealer's-choice chooser picks */
  variant: GameVariant | null;
  /** Dealer's choice only: seat that picks (or picked) this segment's game */
  chooserSeat: number | null;
  needsChoice: boolean;
  newSegment: boolean;
}

export interface TableRotationState {
  mode: GameMode;
  currentVariant: GameVariant | null;
  /** 1-based hand number within the current segment */
  handInVariant: number;
  /** Hands in the segment (rotation), or the expected orbit + 1 (dealer's choice) */
  handsPerVariant: number;
  rotationIndex: number;
  rotationLength: number;
  /** Physical seat of the dealer's-choice chooser */
  chooserSeatIndex: number | null;
  needsChoice: boolean;
  capBB: number | null;
  buttonSeat: number | null;
}

export interface TableRotationOptions {
  mode: GameMode;
  /** Required for SpecificGame */
  variant?: GameVariant;
  seatCount?: number;
  /**
   * Continue from an earlier session (e.g. the host changed modes): the first
   * segment starts one occupied seat left of this seat.
   */
  startAfterSeat?: number | null;
}

/** Stud games have no blinds, so the button stands still during them in rotation modes */
const STUD_VARIANTS = new Set<GameVariant>([GameVariant.Razz, GameVariant.Stud, GameVariant.StudHiLo]);

interface Committed {
  lastButtonSeat: number | null;
  segmentStartSeat: number | null;
  handsInSegment: number;
  rotationIndex: number;
  chosenVariant: GameVariant | null;
  /** Times the button has landed on or passed the chooser's seat this segment */
  chooserPasses: number;
}

export class TableRotation {
  readonly mode: GameMode;
  private readonly rotation: GameVariant[];
  private readonly specificVariant: GameVariant | null;
  private readonly seatCount: number;
  private readonly startAfterSeat: number | null;
  private committed: Committed;
  private plan: (PlannedHand & { next: Committed }) | null = null;
  private occupiedCount = 0;

  constructor(opts: TableRotationOptions) {
    this.mode = opts.mode;
    this.seatCount = opts.seatCount ?? 6;
    this.startAfterSeat = opts.startAfterSeat ?? null;
    this.rotation = opts.mode === GameMode.Horse ? [...HORSE_ROTATION]
      : opts.mode === GameMode.EightGame ? [...EIGHT_GAME_ROTATION]
      : opts.mode === GameMode.NineGame ? [...NINE_GAME_ROTATION]
      : [];
    if (opts.mode === GameMode.SpecificGame && !opts.variant) {
      throw new Error('SpecificGame mode requires a variant');
    }
    this.specificVariant = opts.mode === GameMode.SpecificGame ? opts.variant! : null;
    this.committed = {
      lastButtonSeat: null, segmentStartSeat: null, handsInSegment: 0,
      rotationIndex: 0, chosenVariant: null, chooserPasses: 0,
    };
  }

  /** Occupied seat strictly after `from`, going left (increasing seat number). */
  private nextSeat(seats: number[], from: number): number {
    for (let step = 1; step <= this.seatCount; step++) {
      const seat = (from + step) % this.seatCount;
      if (seats.includes(seat)) return seat;
    }
    throw new Error('No occupied seats');
  }

  /** Does moving the button from `a` to `b` land on or pass seat `c`? */
  private crosses(a: number, b: number, c: number): boolean {
    const dist = (x: number, y: number) => (y - x + this.seatCount) % this.seatCount;
    const span = dist(a, b) || this.seatCount;
    const toC = dist(a, c);
    return toC > 0 && toC <= span;
  }

  /**
   * Plan the next hand for the given occupied (dealt-in) seats. Pure with
   * respect to the committed session: calling it again replaces the plan.
   */
  nextHand(seats: number[]): PlannedHand {
    const occupied = [...new Set(seats)].sort((a, b) => a - b);
    if (occupied.length < 2) throw new Error('Need at least 2 players');
    this.occupiedCount = occupied.length;
    const c = this.committed;
    const next: Committed = { ...c };
    let buttonSeat: number;
    let newSegment = false;

    if (this.rotation.length > 0) {
      // HORSE / 8-game / 9-game (spec §1): 8 hands per game. In blind games the
      // button moves one occupied seat every hand, straight through game
      // changes. In stud games it stays put, and the next blind game passes it
      // to the left of wherever it stopped.
      if (c.lastButtonSeat !== null && c.handsInSegment >= HANDS_PER_VARIANT) {
        next.rotationIndex = (c.rotationIndex + 1) % this.rotation.length;
        next.handsInSegment = 0;
        newSegment = true;
      }
      const variant = this.rotation[next.rotationIndex];
      if (c.lastButtonSeat === null) {
        buttonSeat = this.startAfterSeat === null ? occupied[0] : this.nextSeat(occupied, this.startAfterSeat);
        newSegment = true;
      } else if (STUD_VARIANTS.has(variant)) {
        buttonSeat = occupied.includes(c.lastButtonSeat) ? c.lastButtonSeat : this.nextSeat(occupied, c.lastButtonSeat);
      } else {
        buttonSeat = this.nextSeat(occupied, c.lastButtonSeat);
      }
      next.lastButtonSeat = buttonSeat;
      next.handsInSegment += 1;
      this.plan = { buttonSeat, variant, chooserSeat: null, needsChoice: false, newSegment, next };
      return this.publicPlan()!;
    }

    if (c.lastButtonSeat === null) {
      buttonSeat = this.startAfterSeat === null ? occupied[0] : this.nextSeat(occupied, this.startAfterSeat);
      newSegment = true;
    } else {
      const candidate = this.nextSeat(occupied, c.lastButtonSeat);
      const start = c.segmentStartSeat!;
      // Dealer's choice ends after the chooser's second button. If the chooser
      // has left, it ends when the button passes their empty seat instead.
      const segmentOver = this.mode === GameMode.DealersChoice
        && (c.chooserPasses >= 2 || (!occupied.includes(start) && this.crosses(c.lastButtonSeat, candidate, start)));
      if (segmentOver) {
        buttonSeat = this.nextSeat(occupied, c.segmentStartSeat!);
        newSegment = true;
      } else {
        buttonSeat = candidate;
        if (this.mode === GameMode.DealersChoice && this.crosses(c.lastButtonSeat, candidate, start)) {
          next.chooserPasses = c.chooserPasses + 1;
        }
      }
    }

    if (newSegment) {
      next.segmentStartSeat = buttonSeat;
      next.handsInSegment = 0;
      next.chooserPasses = 1;
      if (this.mode === GameMode.DealersChoice) next.chosenVariant = null;
    }
    next.lastButtonSeat = buttonSeat;
    next.handsInSegment += 1;

    const isDC = this.mode === GameMode.DealersChoice;
    const variant = this.specificVariant ?? next.chosenVariant;
    this.plan = {
      buttonSeat,
      variant,
      chooserSeat: isDC ? next.segmentStartSeat : null,
      needsChoice: isDC && variant === null,
      newSegment,
      next,
    };
    return this.publicPlan()!;
  }

  private publicPlan(): PlannedHand | null {
    if (!this.plan) return null;
    const { next: _next, ...rest } = this.plan;
    return { ...rest };
  }

  /** Dealer's choice: the chooser's pick for the planned segment. */
  choose(variant: GameVariant): PlannedHand {
    if (!this.plan || !this.plan.needsChoice) throw new Error('No game choice is pending');
    if (!NINE_GAME_ROTATION.includes(variant)) throw new Error('Select a nine-game variant');
    this.plan.next.chosenVariant = variant;
    this.plan.variant = variant;
    this.plan.needsChoice = false;
    return this.publicPlan()!;
  }

  /** Commit the planned hand once it has been played to completion. */
  completeHand(): void {
    if (!this.plan || this.plan.needsChoice) throw new Error('No planned hand to complete');
    this.committed = this.plan.next;
    this.plan = null;
  }

  /** Drop an unplayed plan (e.g. the hand could not be dealt). */
  cancelPlan(): void {
    this.plan = null;
  }

  getPlan(): PlannedHand | null {
    return this.publicPlan();
  }

  /** Button of the last completed hand (to continue after a mode change). */
  getLastButtonSeat(): number | null {
    return this.committed.lastButtonSeat;
  }

  getCapBB(variant: GameVariant | null): number | null {
    if (this.mode === GameMode.SpecificGame || !variant) return null;
    return CAP_RULES[variant] ?? null;
  }

  getState(): TableRotationState {
    const planOrCommitted = this.plan ? this.plan.next : this.committed;
    const variant = this.plan ? this.plan.variant
      : this.specificVariant ?? (this.mode === GameMode.DealersChoice ? this.committed.chosenVariant : this.rotation[this.committed.rotationIndex] ?? null);
    const isDC = this.mode === GameMode.DealersChoice;
    return {
      mode: this.mode,
      currentVariant: variant,
      handInVariant: this.mode === GameMode.SpecificGame ? 0 : planOrCommitted.handsInSegment,
      handsPerVariant: this.rotation.length > 0 ? HANDS_PER_VARIANT : isDC ? this.occupiedCount + 1 : 0,
      rotationIndex: planOrCommitted.rotationIndex,
      rotationLength: this.rotation.length,
      chooserSeatIndex: isDC ? planOrCommitted.segmentStartSeat : null,
      needsChoice: this.plan?.needsChoice ?? (isDC && this.committed.chosenVariant === null),
      capBB: this.getCapBB(variant),
      buttonSeat: planOrCommitted.lastButtonSeat,
    };
  }
}
