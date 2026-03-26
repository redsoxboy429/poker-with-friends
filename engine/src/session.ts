// ============================================================
// GameSession — Manages variant rotation across multiple hands
// ============================================================

import { GameVariant } from './types.js';

/** Game mode for a session */
export enum GameMode {
  Horse = 'horse',
  EightGame = '8-game',
  NineGame = '9-game',
  DealersChoice = 'dealers-choice',
  SpecificGame = 'specific',
}

/** Fixed rotation orders */
export const HORSE_ROTATION: GameVariant[] = [
  GameVariant.LimitHoldem,
  GameVariant.OmahaHiLo,
  GameVariant.Razz,
  GameVariant.Stud,
  GameVariant.StudHiLo,
];

export const EIGHT_GAME_ROTATION: GameVariant[] = [
  ...HORSE_ROTATION,
  GameVariant.NLH,
  GameVariant.PLO,
  GameVariant.TwoSevenSD,
];

export const NINE_GAME_ROTATION: GameVariant[] = [
  ...EIGHT_GAME_ROTATION,
  GameVariant.TwoSevenTD,
];

/** Hands per variant in rotation modes */
export const HANDS_PER_VARIANT = 8;

/** Bet cap rules (in big blinds) for mixed game modes */
export const CAP_RULES: Partial<Record<GameVariant, number>> = {
  [GameVariant.NLH]: 80,
  [GameVariant.PLO]: 80,
  [GameVariant.PLOHiLo]: 80,
  [GameVariant.TwoSevenSD]: 30,
  // Drawmaha variants with PL option get 80 BB cap
  [GameVariant.DrawmahaHigh]: 80,
  [GameVariant.Drawmaha27]: 80,
  [GameVariant.DrawmahaA5]: 80,
  [GameVariant.Drawmaha49]: 80,
  // PL Double Draw variants get 80 BB cap
  [GameVariant.PLBadugiDD]: 80,
  [GameVariant.PLBadeucyDD]: 80,
  [GameVariant.PLBadaceyDD]: 80,
  [GameVariant.PLArchieDD]: 80,
  [GameVariant.PLTenThirtyDD]: 80,
};

/** Configuration for creating a GameSession */
export interface GameSessionConfig {
  mode: GameMode;
  /** Required for SpecificGame mode */
  variant?: GameVariant;
  /** Number of players at the table (needed for dealer's choice orbit tracking) */
  numPlayers: number;
}

/** Dealer's choice state */
interface DealersChoiceState {
  /** Seat index of the player who chose the current game */
  chooserSeatIndex: number;
  /** The variant they chose */
  chosenVariant: GameVariant;
  /** Seat index of the button when the choice was made (chooser's first button) */
  startButtonIndex: number;
  /** How many hands have been played in this choice */
  handsPlayed: number;
  /** Total hands for this choice (numPlayers + 1, i.e. chooser gets two buttons) */
  totalHands: number;
  /** Whether a choice is needed (no variant selected yet) */
  needsChoice: boolean;
}

/** Snapshot of session state (for UI display) */
export interface GameSessionState {
  mode: GameMode;
  currentVariant: GameVariant | null;
  /** For rotation modes: which hand within the current variant (1-based) */
  handInVariant: number;
  handsPerVariant: number;
  /** For rotation modes: which game in the rotation (0-based) */
  rotationIndex: number;
  /** For rotation modes: total games in the rotation */
  rotationLength: number;
  /** For dealer's choice: seat index of the chooser, or null */
  chooserSeatIndex: number | null;
  /** For dealer's choice: true if a new choice is needed */
  needsChoice: boolean;
  /** Cap in big blinds for the current variant, or null if uncapped */
  capBB: number | null;
}

/**
 * GameSession manages variant rotation across multiple hands.
 *
 * It sits between the UI and individual game instances. Before each hand,
 * the UI asks the session "what variant do we deal next?" and the session
 * returns the answer based on the game mode and rotation state.
 */
export class GameSession {
  private mode: GameMode;
  private rotation: GameVariant[];
  private rotationIndex: number = 0;
  private handInVariant: number = 0; // 0-based count of hands in current variant
  private specificVariant: GameVariant | null = null;
  private numPlayers: number;

  // Dealer's choice state
  private dc: DealersChoiceState | null = null;

  constructor(config: GameSessionConfig) {
    this.mode = config.mode;
    this.numPlayers = config.numPlayers;

    switch (config.mode) {
      case GameMode.Horse:
        this.rotation = [...HORSE_ROTATION];
        break;
      case GameMode.EightGame:
        this.rotation = [...EIGHT_GAME_ROTATION];
        break;
      case GameMode.NineGame:
        this.rotation = [...NINE_GAME_ROTATION];
        break;
      case GameMode.DealersChoice:
        this.rotation = []; // No fixed rotation
        break;
      case GameMode.SpecificGame:
        if (!config.variant) {
          throw new Error('SpecificGame mode requires a variant');
        }
        this.rotation = [];
        this.specificVariant = config.variant;
        break;
    }
  }

  /**
   * Get the current variant to play. Returns null if dealer's choice
   * needs a player to pick first (check getState().needsChoice).
   */
  getCurrentVariant(): GameVariant | null {
    if (this.mode === GameMode.SpecificGame) {
      return this.specificVariant;
    }
    if (this.mode === GameMode.DealersChoice) {
      return this.dc?.chosenVariant ?? null;
    }
    // Rotation modes
    return this.rotation[this.rotationIndex] ?? null;
  }

  /**
   * Get the cap in big blinds for the current variant, or null if uncapped.
   * Caps only apply in mixed modes (HORSE, 8-game, 9-game, dealer's choice).
   */
  getCapBB(): number | null {
    if (this.mode === GameMode.SpecificGame) return null;
    const variant = this.getCurrentVariant();
    if (!variant) return null;
    return CAP_RULES[variant] ?? null;
  }

  /**
   * Called after each hand completes. Advances rotation / dealer's choice state.
   *
   * @param buttonIndex - The button index for the hand that just completed.
   *   Used for dealer's choice orbit tracking.
   */
  advanceHand(buttonIndex: number): void {
    if (this.mode === GameMode.SpecificGame) {
      // Nothing to track
      return;
    }

    if (this.mode === GameMode.DealersChoice) {
      if (!this.dc || this.dc.needsChoice) return;

      this.dc.handsPlayed++;

      // Check if orbit is complete: chooser has had the button twice.
      // The orbit = numPlayers + 1 hands (chooser gets two buttons).
      if (this.dc.handsPlayed >= this.dc.totalHands) {
        // Choice passes to the player currently to the left of the chooser
        const nextChooserSeat = (this.dc.chooserSeatIndex + 1) % this.numPlayers;
        this.dc = {
          chooserSeatIndex: nextChooserSeat,
          chosenVariant: null!,
          startButtonIndex: -1,
          handsPlayed: 0,
          totalHands: this.numPlayers + 1,
          needsChoice: true,
        };
      }
      return;
    }

    // Rotation modes (HORSE, 8-game, 9-game)
    this.handInVariant++;
    if (this.handInVariant >= HANDS_PER_VARIANT) {
      this.handInVariant = 0;
      this.rotationIndex = (this.rotationIndex + 1) % this.rotation.length;
    }
  }

  /**
   * For dealer's choice: set the variant chosen by the current chooser.
   *
   * @param variant - The variant the chooser picked
   * @param buttonIndex - The current button index (chooser's first button)
   */
  setDealersChoice(variant: GameVariant, buttonIndex: number): void {
    if (this.mode !== GameMode.DealersChoice) {
      throw new Error('setDealersChoice only valid in DealersChoice mode');
    }

    if (!this.dc) {
      // First choice of the session — chooser is the button
      this.dc = {
        chooserSeatIndex: buttonIndex,
        chosenVariant: variant,
        startButtonIndex: buttonIndex,
        handsPlayed: 0,
        totalHands: this.numPlayers + 1,
        needsChoice: false,
      };
    } else if (this.dc.needsChoice) {
      this.dc.chosenVariant = variant;
      this.dc.startButtonIndex = buttonIndex;
      this.dc.handsPlayed = 0;
      this.dc.totalHands = this.numPlayers + 1;
      this.dc.needsChoice = false;
    }
  }

  /**
   * Initialize dealer's choice for the first time.
   * The first chooser is the player on the button.
   *
   * @param buttonIndex - The starting button position
   */
  initDealersChoice(buttonIndex: number): void {
    if (this.mode !== GameMode.DealersChoice) return;
    if (this.dc) return; // Already initialized

    this.dc = {
      chooserSeatIndex: buttonIndex,
      chosenVariant: null!,
      startButtonIndex: buttonIndex,
      handsPlayed: 0,
      totalHands: this.numPlayers + 1,
      needsChoice: true,
    };
  }

  /**
   * Update the number of players. Important for dealer's choice
   * orbit length calculation when players join or leave.
   */
  updatePlayerCount(numPlayers: number): void {
    this.numPlayers = numPlayers;
    // If in dealer's choice, recalculate remaining hands
    if (this.dc && !this.dc.needsChoice) {
      this.dc.totalHands = numPlayers + 1;
      // If they've already played more than the new total, end the orbit
      if (this.dc.handsPlayed >= this.dc.totalHands) {
        const nextChooserSeat = (this.dc.chooserSeatIndex + 1) % numPlayers;
        this.dc = {
          chooserSeatIndex: nextChooserSeat,
          chosenVariant: null!,
          startButtonIndex: -1,
          handsPlayed: 0,
          totalHands: numPlayers + 1,
          needsChoice: true,
        };
      }
    }
  }

  /**
   * Get the full session state for UI display.
   */
  getState(): GameSessionState {
    const variant = this.getCurrentVariant();

    if (this.mode === GameMode.SpecificGame) {
      return {
        mode: this.mode,
        currentVariant: variant,
        handInVariant: 0,
        handsPerVariant: 0,
        rotationIndex: 0,
        rotationLength: 0,
        chooserSeatIndex: null,
        needsChoice: false,
        capBB: null,
      };
    }

    if (this.mode === GameMode.DealersChoice) {
      return {
        mode: this.mode,
        currentVariant: variant,
        handInVariant: this.dc ? this.dc.handsPlayed + 1 : 0,
        handsPerVariant: this.dc ? this.dc.totalHands : 0,
        rotationIndex: 0,
        rotationLength: 0,
        chooserSeatIndex: this.dc?.chooserSeatIndex ?? null,
        needsChoice: this.dc?.needsChoice ?? true,
        capBB: this.getCapBB(),
      };
    }

    // Rotation modes
    return {
      mode: this.mode,
      currentVariant: variant,
      handInVariant: this.handInVariant + 1, // 1-based for display
      handsPerVariant: HANDS_PER_VARIANT,
      rotationIndex: this.rotationIndex,
      rotationLength: this.rotation.length,
      chooserSeatIndex: null,
      needsChoice: false,
      capBB: this.getCapBB(),
    };
  }

  /** Get the rotation array (for UI display of upcoming games) */
  getRotation(): GameVariant[] {
    return [...this.rotation];
  }

  /** Get the game mode */
  getMode(): GameMode {
    return this.mode;
  }
}
