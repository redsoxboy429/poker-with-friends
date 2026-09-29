// Pre-actions: a choice made before it's your turn, sent the moment the turn arrives.
// "Call X" / "Raise X" / "Check" are tied to the amount to call when chosen and drop
// if a bet or raise changes it. Fold, Call Any and Raise Any survive changes.

import { ActionType, type AvailableActions } from './engine-wrapper';

export type PreActionKind = 'fold' | 'check' | 'call' | 'call-any' | 'raise' | 'raise-any';

export interface PreAction {
  kind: PreActionKind;
  /** Amount to call when chosen */
  toCall: number;
  /** Betting round it was chosen in (hand id + phase); cleared when the round ends */
  round: string;
}

export interface PreActionChoice {
  kind: PreActionKind;
  label: string;
}

/** Buttons to offer: limit games get Raise / Raise Any; big-bet games stop at Call Any. */
export function preActionChoices(toCall: number, currentBet: number, isFixedLimit: boolean): PreActionChoice[] {
  const choices: PreActionChoice[] = toCall > 0
    ? [{ kind: 'fold', label: 'Fold' }, { kind: 'call', label: `Call ${toCall}` }, { kind: 'call-any', label: 'Call Any' }]
    : [{ kind: 'fold', label: 'Check/Fold' }, { kind: 'check', label: 'Check' }, { kind: 'call-any', label: 'Check/Call Any' }];
  if (isFixedLimit) {
    choices.push(currentBet > 0
      ? { kind: 'raise', label: `Raise vs ${currentBet}` }
      : { kind: 'raise', label: 'Bet' });
    choices.push({ kind: 'raise-any', label: currentBet > 0 ? 'Raise Any' : 'Bet/Raise Any' });
  }
  return choices;
}

/** Whether a fixed-amount pre-action still matches the table (false once the amount to call changed). */
export function preActionStillValid(pre: PreAction, toCall: number): boolean {
  return (pre.kind !== 'call' && pre.kind !== 'check' && pre.kind !== 'raise') || pre.toCall === toCall;
}

/**
 * The action to send now that it's the player's turn, or null to fall back to the
 * normal action panel. Never folds when checking is free.
 */
export function resolvePreAction(pre: PreAction, actions: AvailableActions): { type: ActionType; amount?: number } | null {
  // Bring-in style choices (no fold, no check) always need a real decision.
  if (!actions.canFold && !actions.canCheck) return null;
  const toCall = actions.canCall ? actions.callAmount : 0;
  const checkOrCall = () => actions.canCheck ? { type: ActionType.Check }
    : actions.canCall ? { type: ActionType.Call } : null;
  const raise = () => actions.canRaise ? { type: ActionType.Raise, amount: actions.raiseOptions?.[0] ?? actions.minRaise }
    : actions.canBet ? { type: ActionType.Bet, amount: actions.betOptions?.[0] ?? actions.minBet } : null;
  switch (pre.kind) {
    case 'fold': return actions.canCheck ? { type: ActionType.Check } : { type: ActionType.Fold };
    case 'check': return actions.canCheck && pre.toCall === 0 ? { type: ActionType.Check } : null;
    case 'call': return pre.toCall === toCall ? checkOrCall() : null;
    case 'call-any': return checkOrCall();
    case 'raise': return pre.toCall === toCall ? raise() : null;
    // Capped betting: Raise Any calls instead.
    case 'raise-any': return raise() ?? checkOrCall();
  }
}
