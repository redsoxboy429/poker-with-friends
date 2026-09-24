// ============================================================
// TableRotation — button, game rotation and dealer's choice by physical seat
// ============================================================
// Used by the multiplayer server. Everything is keyed by physical seat number,
// never by position in a compacted list of active players, so empty and
// sitting-out seats cannot shift the button or the chooser.
//
// A "segment" is one game in a rotation mode (HANDS_PER_VARIANT hands) or one
// dealer's-choice orbit (the chooser gets two buttons). Every segment starts
// with the button one occupied seat left of where the previous segment started
// (docs/NINE-GAME-RULES.md §1). Within a segment the button moves one occupied
// seat per hand, including during stud, where it is invisible.
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

    if (c.lastButtonSeat === null) {
      buttonSeat = this.startAfterSeat === null ? occupied[0] : this.nextSeat(occupied, this.startAfterSeat);
      newSegment = true;
    } else {
      const candidate = this.nextSeat(occupied, c.lastButtonSeat);
      const start = c.segmentStartSeat!;
      // Dealer's choice ends after the chooser's second button. If the chooser
      // has left, it ends when the button passes their empty seat instead.
      const segmentOver =
        this.rotation.length > 0 ? c.handsInSegment >= HANDS_PER_VARIANT
        : this.mode === GameMode.DealersChoice
          ? c.chooserPasses >= 2 || (!occupied.includes(start) && this.crosses(c.lastButtonSeat, candidate, start))
          : false;
      if (segmentOver) {
        buttonSeat = this.nextSeat(occupied, c.segmentStartSeat!);
        newSegment = true;
        if (this.rotation.length > 0) next.rotationIndex = (c.rotationIndex + 1) % this.rotation.length;
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
    const variant = this.specificVariant ?? (isDC ? next.chosenVariant : this.rotation[next.rotationIndex]);
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
