import { planShowdown } from '@engine/presentation.ts';
import { PLAYABLE_VARIANTS } from './engine-wrapper';
// ============================================================
// MultiplayerTable — App.tsx rendering + socket integration
// ============================================================
// Built FROM App.tsx's proven rendering/animation code.
// Engine calls replaced with socket events. Multiplayer UI layered on top.
// All rendering, animation, showdown, fold display, pot merging logic
// is IDENTICAL to App.tsx — no reimplementation.

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket, hasStoredSeat } from './useSocket';
import { GameVariant, ActionType, GameMode } from './engine-wrapper';
import {
  CardDisplay,
  PlayerSeat,
  BetChip,
  CasinoChip,
  PotDisplay,
  WinDisplay,
  ActionPanel,
  GameLog,
  decomposeChips,
} from './components';
import type { WinEntry } from './components';
import {
  VARIANT_LABELS,
  GAME_MODE_LABELS,
  SEAT_POSITIONS,
  BET_OFFSETS,
  DRAW_PHASES,
  CARD_DEAL_INTERVAL,
  formatActionType,
} from './constants';

// ============================================================
// Helpers
// ============================================================

/** Rotate an array so `startIndex` becomes index 0 */
function rotateArray<T>(arr: T[], startIndex: number): T[] {
  if (startIndex === 0 || arr.length === 0) return arr;
  return [...arr.slice(startIndex), ...arr.slice(0, startIndex)];
}

const MAX_LOG_ENTRIES = 200;

/** Round to whole $0.25 chips */
const toChips = (x: number) => Math.round(x * 4) / 4;

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs font-medium transition-colors"
    >
      {copied ? 'Copied!' : 'Copy Link'}
    </button>
  );
}

/** Buy-in in dollars within the room's range (used in the lobby and mid-game). */
function BuyInPanel({ min, max, value, onChange, onSitDown }: {
  min: number; max: number; value: number;
  onChange: (v: number) => void; onSitDown: () => void;
}) {
  return (
    <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-600">
      <label className="text-xs font-semibold text-slate-300 block mb-1">Buy-in: ${value.toFixed(2)}</label>
      <input type="range" min={min} max={max} step={0.25} value={value}
        onChange={e => onChange(toChips(Number(e.target.value)))} className="w-full accent-emerald-500" />
      <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 mb-2"><span>${min.toFixed(2)}</span><span>${max.toFixed(2)}</span></div>
      <button onClick={onSitDown}
        className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors">
        Sit Down (${value.toFixed(2)})
      </button>
    </div>
  );
}

// ============================================================
// Main Component
// ============================================================

export default function MultiplayerTable() {
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const [socketState, socketActions] = useSocket();

  // --- Lobby state ---
  /** Buy-in in dollars; null until the player moves the slider (then the room default is used) */
  const [buyInChoice, setBuyInChoice] = useState<number | null>(null);
  const [directJoinName, setDirectJoinName] = useState(() => localStorage.getItem('poker-player-name') || '');
  const [directJoinAttempted, setDirectJoinAttempted] = useState(false);

  // --- Core game UI state (FROM App.tsx) ---
  const [logVisible, setLogVisible] = useState(false);
  const [log, setLog] = useState<string[]>(['Connected to room ' + (code || '???')]);
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<Set<number>>(new Set());
  const [showdown, setShowdown] = useState(false);
  /** Hand the showdown / card-deal animation belongs to, so neither can paint over a newer hand */
  const [showdownHandId, setShowdownHandId] = useState<string | null>(null);
  const [animHandId, setAnimHandId] = useState<string | null>(null);
  const [isRealShowdown, setIsRealShowdown] = useState(false);
  const [winInfo, setWinInfo] = useState<WinEntry[]>([]);

  // --- Action badges (FROM App.tsx) ---
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [lastDrawActions, setLastDrawActions] = useState<Record<string, string>>({});

  // --- Animation state (FROM App.tsx) ---
  const [visibleCommunityCount, setVisibleCommunityCount] = useState(0);
  const [dealtCardCounts, setDealtCardCounts] = useState<Record<string, number>>({});
  const [isAnimating, setIsAnimating] = useState(false);
  const [isAllInRunout, setIsAllInRunout] = useState(false);
  const [studForceDown, setStudForceDown] = useState(false);

  // --- Modals (multiplayer versions) ---
  const [showAddOn, setShowAddOn] = useState(false);
  const [addOnAmount, setAddOnAmount] = useState(0);
  const [showCashOut, setShowCashOut] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [menuGameMode, setMenuGameMode] = useState<GameMode>(GameMode.DealersChoice);
  const [menuVariant, setMenuVariant] = useState<GameVariant>(GameVariant.NLH);

  // --- Animation refs (FROM App.tsx) ---
  const prevPhaseRef = useRef<string | null>(null);
  const prevHandRef = useRef<typeof socketState.handState>(null);
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const visibleCommunityCountRef = useRef(0);
  const dealtCardCountsRef = useRef<Record<string, number>>({});

  // ============================================================
  // Helper functions (FROM App.tsx)
  // ============================================================

  const addLog = useCallback((msg: string) => {
    setLog(prev => {
      const next = [...prev, msg];
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }, []);

  const clearAnimTimers = useCallback(() => {
    for (const t of animTimersRef.current) clearTimeout(t);
    animTimersRef.current = [];
  }, []);

  const updateVisibleCommunity = useCallback((count: number) => {
    visibleCommunityCountRef.current = count;
    setVisibleCommunityCount(count);
  }, []);

  const updateDealtCardCounts = useCallback((counts: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    setDealtCardCounts(prev => {
      const next = typeof counts === 'function' ? counts(prev) : counts;
      dealtCardCountsRef.current = next;
      return next;
    });
  }, []);

  // ============================================================
  // Animation functions (FROM App.tsx — identical logic)
  // ============================================================

  /** Animate community cards appearing one at a time (FROM App.tsx lines 452-472) */
  const animateCommunityCards = useCallback(
    (fromCount: number, toCount: number, onDone: () => void) => {
      if (toCount <= fromCount) { onDone(); return; }
      setIsAnimating(true);
      const cardsToReveal = toCount - fromCount;
      for (let i = 0; i < cardsToReveal; i++) {
        const t = setTimeout(() => {
          updateVisibleCommunity(fromCount + i + 1);
          if (i === cardsToReveal - 1) {
            setIsAnimating(false);
            onDone();
          }
        }, CARD_DEAL_INTERVAL * (i + 1));
        animTimersRef.current.push(t);
      }
    }, [updateVisibleCommunity]
  );

  /** Animate hole cards dealt to players (FROM App.tsx lines 477-541)
   *  Adapted signature: takes players array instead of full HandState (server sends filtered view) */
  const animateHoleCards = useCallback(
    (players: Array<{ id: string; holeCards: unknown[]; cardVisibility?: string[]; sittingOut?: boolean }>,
     buttonIndex: number,
     prevCounts: Record<string, number>,
     onDone: () => void) => {
      const n = players.length;
      const btn = buttonIndex;

      // Build deal steps in order: left of button, around (FROM App.tsx lines 488-498)
      const maxCards = Math.max(...players.map(p => p.holeCards.length), 0);
      const dealSteps: Array<{ playerId: string; cardIdx: number }> = [];

      for (let cardRound = 0; cardRound < maxCards; cardRound++) {
        for (let offset = 1; offset <= n; offset++) {
          const idx = (btn + offset) % n;
          const p = players[idx];
          const prev = prevCounts[p.id] ?? 0;
          if (!p.sittingOut && p.holeCards.length > cardRound && cardRound >= prev) {
            dealSteps.push({ playerId: p.id, cardIdx: cardRound + 1 });
          }
        }
      }

      if (dealSteps.length === 0) { onDone(); return; }

      // Stud initial deal: force all cards face-down, then reveal door cards (FROM App.tsx lines 506-512)
      const isStudInitialDeal = players.some(
        p => p.cardVisibility && p.cardVisibility.length > 0
      ) && Object.values(prevCounts).every(c => c === 0);
      if (isStudInitialDeal) setStudForceDown(true);

      setIsAnimating(true);
      for (let i = 0; i < dealSteps.length; i++) {
        const step = dealSteps[i];
        const t = setTimeout(() => {
          updateDealtCardCounts(prev => ({ ...prev, [step.playerId]: step.cardIdx }));
          if (i === dealSteps.length - 1) {
            if (isStudInitialDeal) {
              const flipTimer = setTimeout(() => {
                setStudForceDown(false);
                setIsAnimating(false);
                onDone();
              }, 600);
              animTimersRef.current.push(flipTimer);
            } else {
              setIsAnimating(false);
              onDone();
            }
          }
        }, CARD_DEAL_INTERVAL * (i + 1));
        animTimersRef.current.push(t);
      }
    }, [updateDealtCardCounts]
  );

  // ============================================================
  // Socket effects — replaces processState() + dealNewHand()
  // ============================================================

  // Connect on mount (connect() is a no-op while a socket exists, including during auto-reconnect)
  const { connect } = socketActions;
  useEffect(() => {
    connect();
  }, [connect]);

  // After a refresh, resume the stored seat without asking for a name again (one automatic try).
  const autoRejoinTriedRef = useRef(false);
  useEffect(() => {
    if (socketState.status === 'connected' && code && !socketState.roomState && !autoRejoinTriedRef.current && hasStoredSeat(code)) {
      autoRejoinTriedRef.current = true;
      socketActions.joinRoom(localStorage.getItem('poker-player-name') || '', code);
      setDirectJoinAttempted(true);
    }
  }, [socketState.status, socketState.roomState, code, socketActions]);

  // A failed join (bad code, name taken, room gone) returns to the name prompt instead of stranding.
  useEffect(() => {
    if (socketState.error && !socketState.roomState && directJoinAttempted) setDirectJoinAttempted(false);
  }, [socketState.error, socketState.roomState, directJoinAttempted]);

  // Process incoming hand state — animate cards, track actions
  // This replaces processState()'s card animation branch (App.tsx lines 683-792)
  useEffect(() => {
    const curr = socketState.handState;
    const prev = prevHandRef.current;
    if (!curr) {
      prevHandRef.current = null;
      prevPhaseRef.current = null;
      return;
    }

    // Completion arrives separately; compare IDs instead of assuming a prior Complete phase.
    const isNewHandTransition = !!prev && prev.id !== curr.id;

    if (!prev || isNewHandTransition) {
      clearAnimTimers();
      setVisibleCommunityCount(0); visibleCommunityCountRef.current = 0;
      setDealtCardCounts({}); dealtCardCountsRef.current = {};
      setIsAnimating(false); setIsAllInRunout(false); setStudForceDown(false);
      setLastActions({}); setLastDrawActions({});
      addLog(`--- ${VARIANT_LABELS[curr.variant] || curr.variant} ---`);
      prevPhaseRef.current = curr.phase;
      setAnimHandId(curr.id);

      // Animate initial hole card deal (FROM App.tsx lines 967-973)
      const noPrevCards: Record<string, number> = {};
      curr.players.forEach(p => { noPrevCards[p.id] = 0; });
      animateHoleCards(curr.players, curr.buttonIndex, noPrevCards, () => {
        // After hole cards dealt, animate any community cards (e.g. drawmaha flop)
        if (curr.communityCards.length > 0) {
          animateCommunityCards(0, curr.communityCards.length, () => {});
        }
      });
    } else {
      // Existing hand — detect phase changes
      // This replaces processState()'s street detection (App.tsx lines 549-555)
      const prevPhase = prevPhaseRef.current;
      const currentPhase = curr.phase;

      if (prevPhase !== currentPhase) {
        const label = currentPhase === 'complete' ? 'Showdown' : currentPhase;
        addLog(`Phase: ${label}`);

        // Clear betting action badges on street change (FROM App.tsx line 691)
        setLastActions({});

        // Also clear draw badges when a new hand starts (phase goes complete/showdown -> active)
        if (prevPhase === 'complete' || prevPhase === 'showdown') {
          setLastDrawActions({});
        }

        // Reset card preselection and draw labels on new draw phase (FROM App.tsx lines 699-702)
        if (DRAW_PHASES.includes(currentPhase)) {
          setSelectedDiscardIndices(new Set());
          setLastDrawActions({});
        }
      }

      prevPhaseRef.current = currentPhase;

      // Animate new community cards (FROM App.tsx lines 770-780)
      const currentVisible = visibleCommunityCountRef.current;
      if (curr.communityCards.length > currentVisible) {
        animateCommunityCards(currentVisible, curr.communityCards.length, () => {});
      }

      // Animate new hole cards for stud streets (FROM App.tsx lines 781-789)
      // Compare against PREVIOUS hand state (authoritative) rather than
      // dealtCardCountsRef (which updates async during animation).
      // Otherwise a fast incoming action can re-trigger the hole card deal.
      const hasNewCards = curr.players.some(p => {
        const prevPlayer = prev.players.find(pp => pp.id === p.id);
        const prevCount = prevPlayer?.holeCards.length ?? 0;
        return p.holeCards.length > prevCount;
      });
      if (hasNewCards) {
        const studPrevCounts: Record<string, number> = {};
        for (const p of curr.players) {
          const prevPlayer = prev.players.find(pp => pp.id === p.id);
          studPrevCounts[p.id] = prevPlayer?.holeCards.length ?? 0;
        }
        animateHoleCards(curr.players, curr.buttonIndex, studPrevCounts, () => {});
      }
    }

    // Process action badges from server's lastAction field
    if (socketState.lastAction) {
      const la = socketState.lastAction;
      if (la.type === 'discard' || la.type === 'stand-pat') {
        const drawLabel = la.type === 'stand-pat' ? 'Stand Pat' : `Drew ${la.discardCount ?? 0}`;
        setLastDrawActions(prev => ({ ...prev, [la.playerId]: drawLabel }));
        addLog(`${curr.players.find(p => p.id === la.playerId)?.name ?? la.playerId}: ${drawLabel}`);
      } else {
        const displayType = formatActionType(la.type, curr.phase);
        setLastActions(prev => ({ ...prev, [la.playerId]: displayType }));
        const amountStr = la.amount ? ` $${la.amount.toFixed(2)}` : '';
        addLog(`${curr.players.find(p => p.id === la.playerId)?.name ?? la.playerId}: ${displayType}${amountStr}`);
      }
    }

    prevHandRef.current = curr;
  }, [socketState.handState, socketState.lastAction, addLog, clearAnimTimers, animateHoleCards, animateCommunityCards]);

  // Handle hand complete — showdown display
  // This is App.tsx's processState() showdown branch (lines 562-680), adapted for socket data
  useEffect(() => {
    if (!socketState.winners || !socketState.finalState) return;

    const finalState = socketState.finalState;
    const nonFolded = finalState.players.filter(p => !p.folded).length;
    const isReal = nonFolded > 1;

    clearAnimTimers();
    // A hand that completes at the deal never got a hand-state: its counts belong to it now.
    setAnimHandId(finalState.id);
    const plan = planShowdown(finalState);
    // Reveal surviving hands, retaining only cards dealt before the runout.
    // Folded players → 0 (cards disappear), others → full count
    const snappedCounts: Record<string, number> = {};
    for (const p of finalState.players) {
      snappedCounts[p.id] = p.folded ? 0 : (finalState.showdownStart?.holeCardCounts[p.id] ?? p.holeCards.length);
    }
    updateDealtCardCounts(snappedCounts);

    // Process the final action badge
    if (socketState.lastAction) {
      const la = socketState.lastAction;
      if (la.type === 'discard' || la.type === 'stand-pat') {
        const drawLabel = la.type === 'stand-pat' ? 'Stand Pat' : `Drew ${la.discardCount ?? 0}`;
        setLastDrawActions(prev => ({ ...prev, [la.playerId]: drawLabel }));
      } else {
        const displayType = formatActionType(la.type, finalState.phase);
        setLastActions(prev => ({ ...prev, [la.playerId]: displayType }));
      }
    }

    const totalCommunity = finalState.communityCards.length;
    updateVisibleCommunity(finalState.showdownStart?.communityCardCount ?? totalCommunity);

    // finishShowdown callback (FROM App.tsx lines 589-622)
    const finishShowdown = () => {
      setIsAnimating(false);
      setIsAllInRunout(false);
      setShowdown(true);
      setShowdownHandId(finalState.id);
      setIsRealShowdown(isReal);
      setWinInfo(socketState.winners!.map(w => ({
        playerId: w.playerId,
        name: w.name,
        amount: w.amount,
        handDescription: w.handDescription,
        side: w.side,
        potLabel: w.potLabel,
      })));
      updateVisibleCommunity(totalCommunity);
      addLog('--- Hand complete ---');
    };

    setIsAnimating(true);
    setIsAllInRunout(plan.steps.length > 0);
    setStudForceDown(false);
    for (const step of plan.steps) {
      const timer = setTimeout(() => {
        if (step.communityCount !== undefined) updateVisibleCommunity(step.communityCount);
        if (step.playerId !== undefined && step.holeCardCount !== undefined) {
          updateDealtCardCounts(counts => ({ ...counts, [step.playerId!]: step.holeCardCount! }));
        }
      }, step.atMs);
      animTimersRef.current.push(timer);
    }
    animTimersRef.current.push(setTimeout(finishShowdown, plan.durationMs));
    return clearAnimTimers;
  }, [socketState.winners, socketState.finalState, socketState.lastAction, addLog, updateVisibleCommunity, updateDealtCardCounts, clearAnimTimers]);

  useEffect(() => () => clearAnimTimers(), [clearAnimTimers]);

  // Clear showdown on new hand (when new hand-state arrives with non-complete phase)
  // CRITICAL: only clear when finalState is null — otherwise we're still in the completed hand.
  // The HAND_STATE reducer clears finalState when a genuinely new hand-state arrives.
  // Without this guard, the old handState's non-complete phase immediately clears showdown.
  // Note: new-hand animation is now triggered inside the animation effect itself via
  // phase-transition detection (complete/showdown -> active), so we don't touch prevHandRef here.
  useEffect(() => {
    if (socketState.handState && !socketState.finalState &&
        socketState.handState.phase !== 'complete' && socketState.handState.phase !== 'showdown') {
      if (showdown) {
        setShowdown(false);
        setIsRealShowdown(false);
        setWinInfo([]);
        setSelectedDiscardIndices(new Set());
      }
    }
  }, [socketState.handState, socketState.finalState, showdown]);

  // ============================================================
  // Action handlers — socket versions of App.tsx handlers
  // ============================================================

  const handleAction = useCallback((type: ActionType, amount?: number) => {
    socketActions.sendAction(type, amount);
  }, [socketActions]);

  const handleDiscard = useCallback(() => {
    const indices = [...selectedDiscardIndices].sort((a, b) => a - b);
    socketActions.sendDiscard(indices);
    setSelectedDiscardIndices(new Set());
  }, [selectedDiscardIndices, socketActions]);

  const toggleDiscard = (idx: number) => {
    setSelectedDiscardIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDcPick = useCallback((variant: GameVariant) => {
    socketActions.pickVariant(variant);
  }, [socketActions]);

  // Add-on (FROM App.tsx lines 1034-1067, adapted for socket)
  // During active hands the add-on is queued by the server and applied on the next hand.
  const handleAddOnOpen = useCallback(() => {
    const roomState = socketState.roomState;
    if (!roomState) return;
    const maxBuyIn = roomState.settings.buyInMax ?? Infinity;
    const myPlayer = roomState.players.find(p =>
      p.playerId === socketState.yourPlayerId
    );
    if (!myPlayer) return;
    // Use max of current chips and any queued add-on as the floor
    const effectiveChips = Math.max(myPlayer.chips, myPlayer.queuedAddOn ?? 0);
    if (effectiveChips >= maxBuyIn) {
      addLog('Already at max buy-in');
      return;
    }
    setAddOnAmount(effectiveChips);
    setShowAddOn(true);
    // Only pause countdown if no hand is in progress (host is at showdown)
    if (socketState.isHost && !socketState.handState) socketActions.pauseCountdown();
  }, [socketState.roomState, socketState.yourPlayerId, socketState.isHost, socketState.handState, socketActions, addLog]);

  const handleAddOnConfirm = useCallback(() => {
    const roomState = socketState.roomState;
    if (!roomState) return;
    const myPlayer = roomState.players.find(p =>
      p.playerId === socketState.yourPlayerId
    );
    if (!myPlayer) return;
    const effectiveChips = Math.max(myPlayer.chips, myPlayer.queuedAddOn ?? 0);
    if (addOnAmount <= effectiveChips) { setShowAddOn(false); if (socketState.isHost && !socketState.handState) socketActions.resumeCountdown(); return; }

    // Top up TO the amount. The server applies it now between hands, or after
    // this hand settles (never lowering a stack that has since grown).
    socketActions.addOn(addOnAmount);
    const handInProgress = !!socketState.handState && !showdown;
    addLog(handInProgress
      ? `${myPlayer.name}: Top-up to $${addOnAmount.toFixed(2)} queued (applies after this hand)`
      : `${myPlayer.name}: Topped up to $${addOnAmount.toFixed(2)}`);
    setShowAddOn(false);
    if (socketState.isHost && !socketState.handState) socketActions.resumeCountdown();
  }, [addOnAmount, socketState.roomState, socketState.yourPlayerId, socketState.isHost, socketState.handState, showdown, socketActions, addLog]);

  // ============================================================
  // Rendering setup
  // ============================================================

  // Use finalState as soon as it arrives (shows folds, final board immediately)
  const receivedState = socketState.finalState ?? socketState.handState;
  const gameState = receivedState?.showdownStart && !showdown
    ? { ...receivedState, players: receivedState.players.map(p => ({ ...p, chips: receivedState.showdownStart!.chips[p.id] ?? p.chips })) }
    : receivedState;
  const roomState = socketState.roomState;
  const myId = socketState.yourPlayerId;
  // Dealer's choice between hands: the table is cleared while someone picks the game.
  const awaitingChoice = !!socketState.choosingPlayer; // cleared by the next hand-state
  const choosingName = socketState.choosingPlayer?.name ?? 'the dealer';
  // The previous hand's showdown and dealt-card counts must never paint over a newly dealt hand.
  const showdownNow = showdown && !!gameState && showdownHandId === gameState.id && !awaitingChoice;
  const countsFresh = !!gameState && animHandId === gameState.id && !awaitingChoice;
  const ss = socketState.sessionState;
  const trackerText = ss && ss.mode !== 'specific' && ss.handsPerVariant > 0
    ? (ss.mode === 'dealers-choice'
        ? `Hand ${ss.handInVariant}/${ss.handsPerVariant}`
        : `Hand ${ss.handInVariant}/${ss.handsPerVariant} \u2022 Game ${ss.rotationIndex + 1}/${ss.rotationLength}`)
      + (ss.capBB ? ` \u2022 Cap ${ss.capBB}BB` : '')
    : null;

  // ============================================================
  // Early returns — multiplayer-only screens
  // ============================================================

  if (!roomState) {
    // Direct link join prompt
    if (socketState.status === 'connected' && code && !directJoinAttempted) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
          <h2 className="text-xl font-bold text-white mb-4">Join Room {code.toUpperCase()}</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 w-full max-w-xs">
            <label className="text-xs font-semibold text-slate-300 block mb-1">Your Name</label>
            <input type="text" value={directJoinName}
              onChange={e => setDirectJoinName(e.target.value)} placeholder="Enter your name"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm mb-3 focus:outline-none focus:border-emerald-500"
              maxLength={20} autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && directJoinName.trim()) {
                  localStorage.setItem('poker-player-name', directJoinName.trim());
                  socketActions.joinRoom(directJoinName.trim(), code);
                  setDirectJoinAttempted(true);
                }
              }}
            />
            <button onClick={() => {
              if (!directJoinName.trim()) return;
              localStorage.setItem('poker-player-name', directJoinName.trim());
              socketActions.joinRoom(directJoinName.trim(), code);
              setDirectJoinAttempted(true);
            }} disabled={!directJoinName.trim()}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold text-sm transition-colors">
              Join Room
            </button>
          </div>
          <button onClick={() => navigate('/')} className="mt-4 text-slate-500 hover:text-slate-300 text-sm">Back to Lobby</button>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <p className="text-slate-400 mb-4">Connecting to room {code}...</p>
        <button onClick={() => navigate('/')} className="text-emerald-400 hover:underline text-sm">Back to Lobby</button>
      </div>
    );
  }

  // Lobby — waiting room
  if (roomState.state === 'lobby' && !gameState && !socketState.dcChoosing) {
    const roomLink = `${window.location.origin}/room/${roomState.code}`;
    const seatedCount = roomState.players.filter(p => p.seated && p.connected).length;
    const canStart = seatedCount >= 2;
    const myPlayer = roomState.players.find(p => p.playerId === socketState.yourPlayerId);
    const iAmSeated = myPlayer?.seated ?? false;
    const bb = roomState.settings.bigBlind;
    const buyInMin = roomState.settings.buyInMin ?? 50 * bb;
    const buyInMax = roomState.settings.buyInMax ?? 300 * bb;
    const buyIn = buyInChoice ?? toChips(Math.min(Math.max(100 * bb, buyInMin), buyInMax));

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <h2 className="text-2xl font-bold text-white mb-2">Room {roomState.code}</h2>
        <p className="text-slate-400 text-sm mb-6">Share the code or link with friends to join</p>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 w-full max-w-sm">
          <div className="text-center mb-4">
            <span className="text-4xl font-mono font-bold text-emerald-400 tracking-[0.3em]">{roomState.code}</span>
            <div className="mt-2"><CopyLinkButton link={roomLink} /></div>
          </div>
          <div className="text-center text-xs text-slate-400 mb-3">
            <div>Blinds: ${roomState.settings.smallBlind.toFixed(2)} / ${bb.toFixed(2)}</div>
            {roomState.settings.smallBet && roomState.settings.bigBet && (
              <div>Limits: ${roomState.settings.smallBet.toFixed(2)} / ${roomState.settings.bigBet.toFixed(2)}</div>
            )}
          </div>
          <h3 className="text-xs font-semibold text-slate-400 mb-2">
            {seatedCount}/{roomState.maxSeats} seated
            {canStart
              ? (socketState.isHost ? '' : ' — waiting for host to start')
              : ' — need at least 2 seated players'}
          </h3>
          <div className="space-y-1 mb-4">
            {roomState.players.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded">
                <span className={`text-sm ${p.connected ? 'text-white' : 'text-slate-600'}`}>{p.name}</span>
                {p.isHost && <span className="text-[10px] text-amber-400 font-semibold">HOST</span>}
                {!p.connected && <span className="text-[10px] text-red-400">disconnected</span>}
                {p.seated
                  ? <span className="ml-auto text-[10px] text-emerald-400">${p.chips.toFixed(2)}</span>
                  : <span className="ml-auto text-[10px] text-slate-600">not seated</span>}
                {socketState.isHost && !p.isHost && (
                  <button onClick={() => socketActions.kickPlayer(p.seatIndex)}
                    className="text-red-500 hover:text-red-400 text-[10px] font-semibold ml-1">Kick</button>
                )}
              </div>
            ))}
          </div>
          {!iAmSeated && (
            <BuyInPanel min={buyInMin} max={buyInMax} value={buyIn} onChange={setBuyInChoice}
              onSitDown={() => socketActions.sitDown(buyIn)} />
          )}
          {socketState.isHost && canStart && iAmSeated && (
            <button onClick={() => socketActions.startHand()}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors">Start Game</button>
          )}
          {!socketState.isHost && canStart && iAmSeated && (
            <p className="text-center text-xs text-slate-500">Waiting for host to start...</p>
          )}
          {iAmSeated && !canStart && (
            <p className="text-center text-xs text-slate-500">Waiting for more players to sit down...</p>
          )}
        </div>
        <button onClick={() => { socketActions.leaveRoom(); navigate('/'); }}
          className="mt-4 text-slate-500 hover:text-slate-300 text-sm">Leave Room</button>
      </div>
    );
  }

  // ============================================================
  // Game is active — render the table (FROM App.tsx rendering)
  // ============================================================

  const numPlayers = gameState?.players.length ?? roomState.players.length;
  const positions = SEAT_POSITIONS[numPlayers] || SEAT_POSITIONS[4];
  const betPositions = BET_OFFSETS[numPlayers] || BET_OFFSETS[4];
  const bb = roomState.settings.bigBlind;
  const maxBuyIn = roomState.settings.buyInMax ?? 300 * bb;
  const tableBuyInMin = roomState.settings.buyInMin ?? 50 * bb;
  const tableBuyIn = buyInChoice ?? toChips(Math.min(Math.max(100 * bb, tableBuyInMin), maxBuyIn));
  const awayIds = new Set(roomState.players.filter(p => !p.connected || p.leaving).map(p => p.playerId));

  // Pot calculations (FROM App.tsx lines 1178-1188)
  const collectedPot = gameState ? gameState.pots.reduce((s, p) => s + p.amount, 0) : 0;
  const currentStreetBets = gameState ? gameState.players.reduce((s, p) => s + p.bet, 0) : 0;
  const potTotal = collectedPot + currentStreetBets;

  const isDrawPhase = gameState && DRAW_PHASES.includes(gameState.phase);

  // Seat rotation — you always at bottom (multiplayer-only)
  const mySeatIndex = gameState?.players.findIndex(p => p.id === myId) ?? 0;
  const n = gameState?.players.length ?? 0;
  const rotatedPlayers = gameState ? rotateArray(gameState.players, mySeatIndex) : [];
  const rotatedActiveIndex = n > 0 ? (gameState!.activePlayerIndex - mySeatIndex + n + n) % n : -1;
  const rotatedButtonIndex = n > 0 ? (gameState!.buttonIndex - mySeatIndex + n + n) % n : -1;

  // My room player info
  const myRoomPlayer = roomState.players.find(p =>
    p.playerId === socketState.yourPlayerId
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* ======== Header (multiplayer version) ======== */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-white">Room {roomState.code}</h1>
          {socketState.isHost && <button onClick={() => socketState.countdown === -1 ? socketActions.resumeCountdown() : socketActions.pauseCountdown()}
            className="text-xs text-amber-300">{socketState.countdown === -1 ? 'Resume table' : 'Pause table'}</button>}
          {gameState && (
            <span className="text-xs text-emerald-400 font-medium">
              {VARIANT_LABELS[gameState.variant] || gameState.variant}
            </span>
          )}
          {/* Session tracker (DC / rotation info) */}
          {trackerText && <span className="text-[10px] text-slate-500 font-mono">{trackerText}</span>}
        </div>
        <div className="flex gap-1 items-center">
          {/* Sit Out / Sit In */}
          <button onClick={() => myRoomPlayer?.sittingOut ? socketActions.sitIn() : socketActions.sitOut()}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              myRoomPlayer?.sittingOut ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
            }`}>{myRoomPlayer?.sittingOut ? 'Sit In' : 'Sit Out'}</button>
          {/* Add On (always visible, queues during hand) */}
          {myRoomPlayer?.seated && (
            <button onClick={handleAddOnOpen}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded text-[10px] font-medium transition-colors"
              title="Top up your stack">
              {myRoomPlayer.queuedAddOn ? `Top Up (to $${myRoomPlayer.queuedAddOn.toFixed(2)} after hand)` : 'Top Up'}
            </button>
          )}
          {/* Game Menu (host only) */}
          {socketState.isHost && (
            <button onClick={() => { setMenuGameMode(roomState.settings.gameMode as GameMode); setMenuVariant((roomState.settings.variant || GameVariant.NLH) as GameVariant); setShowGameMenu(true); }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-medium transition-colors">Game</button>
          )}
          <button onClick={() => setShowTracker(v => !v)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-medium transition-colors">Tracker</button>
          {/* Leave: only visible between hands (showdown or no active hand) */}
          {(showdownNow || awaitingChoice || !gameState) && (
            <button onClick={() => setShowCashOut(true)}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors">Leave</button>
          )}
        </div>
      </header>

      {/* Error banner */}
      {socketState.error && (
        <div className="px-4 py-1.5 bg-red-900/40 text-red-300 text-xs text-center">{socketState.error}</div>
      )}

      {/* ======== Tracker Popup (FROM App.tsx lines 1267-1302, with multiplayer data) ======== */}
      {showTracker && (
        <div className="absolute top-12 right-4 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 min-w-[320px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white">Player Tracker</h3>
            <button onClick={() => setShowTracker(false)} className="text-slate-500 hover:text-white text-lg leading-none">&times;</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="text-left py-1 pr-3">Player</th>
                <th className="text-right py-1 px-2">Buy-ins</th>
                <th className="text-right py-1 px-2">Cashed out</th>
                <th className="text-right py-1 px-2">Stack</th>
                <th className="text-right py-1 pl-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {/* Server-owned ledger: same on every device, survives refresh, keeps players who left */}
              {roomState.ledger.map(row => {
                const net = row.stack + row.cashOut - row.buyIn;
                return (
                  <tr key={row.memberId} className="border-b border-slate-800">
                    <td className={`py-1.5 pr-3 font-medium ${row.left ? 'text-slate-500' : 'text-white'}`}>{row.name}{row.left ? ' (left)' : ''}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${row.buyIn.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${row.cashOut.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300">${row.stack.toFixed(2)}</td>
                    <td className={`py-1.5 pl-2 text-right font-semibold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {net >= 0 ? '+' : ''}{net.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ======== Add-On Modal (FROM App.tsx lines 1306-1346) ======== */}
      {showAddOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[400px]">
            <h3 className="text-lg font-bold text-white mb-4">Top Up</h3>
            {/* Queued notice if a hand is currently active */}
            {socketState.handState && !showdown && (
              <div className="bg-amber-900/30 border border-amber-600/40 rounded p-2 mb-3 text-xs text-amber-300">
                A hand is in progress. Your stack is topped up to this amount after the hand; winnings are never reduced.
              </div>
            )}
            <p className="text-sm text-slate-400 mb-3">Top up to:</p>
            <div className="flex items-center gap-3 mb-4">
              <input type="range"
                min={Math.max(myRoomPlayer?.chips ?? 0, myRoomPlayer?.queuedAddOn ?? 0)}
                max={maxBuyIn}
                step={0.25} value={addOnAmount}
                onChange={e => setAddOnAmount(toChips(parseFloat(e.target.value)))} className="flex-1 accent-emerald-500" />
              <span className="text-lg font-bold text-emerald-300 w-20 text-right">${addOnAmount.toFixed(2)}</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">Adding ${Math.max(0, addOnAmount - Math.max(myRoomPlayer?.chips ?? 0, myRoomPlayer?.queuedAddOn ?? 0)).toFixed(2)}</p>
            <div className="flex gap-2">
              <button onClick={handleAddOnConfirm}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors">Confirm</button>
              <button onClick={() => { setShowAddOn(false); if (socketState.isHost && !socketState.handState) socketActions.resumeCountdown(); }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Cash-Out / Leave Modal ======== */}
      {showCashOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[300px]">
            <h3 className="text-lg font-bold text-white mb-3">Leave Table</h3>
            <p className="text-sm text-slate-400 mb-4">Cash out ${(myRoomPlayer?.chips ?? 0).toFixed(2)} and leave?</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => { socketActions.leaveRoom(); navigate('/'); }} className="w-full px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors">Leave Table</button>
              {socketState.isHost && (
                <button onClick={() => { socketActions.stopGame(); setShowCashOut(false); }}
                  className="w-full px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors">Stop Game (Back to Lobby)</button>
              )}
              <button onClick={() => setShowCashOut(false)}
                className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Game Mode Menu (Host Only) ======== */}
      {showGameMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[340px] max-w-[420px]">
            <h3 className="text-lg font-bold text-white mb-4">Change Game</h3>
            <p className="text-xs text-slate-500 mb-3">Takes effect on the next hand.</p>
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {Object.values(GameMode).map(m => (
                <button key={m} onClick={() => setMenuGameMode(m)}
                  className={`py-2 px-3 rounded text-xs font-medium transition-colors ${
                    menuGameMode === m ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}>{GAME_MODE_LABELS[m] || m}</button>
              ))}
            </div>
            {menuGameMode === GameMode.SpecificGame && (
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1">Variant</label>
                <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                  {PLAYABLE_VARIANTS.map(v => (
                    <button key={v} onClick={() => setMenuVariant(v)}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors ${
                        menuVariant === v ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}>{VARIANT_LABELS[v]}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => {
                socketActions.updateSettings({
                  gameMode: menuGameMode,
                  ...(menuGameMode === GameMode.SpecificGame ? { variant: menuVariant } : {}),
                });
                setShowGameMenu(false);
                addLog(`Game changed to ${GAME_MODE_LABELS[menuGameMode] || menuGameMode}${menuGameMode === GameMode.SpecificGame ? ` (${VARIANT_LABELS[menuVariant]})` : ''}`);
              }} className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors">Confirm</button>
              <button onClick={() => setShowGameMenu(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Table Area (FROM App.tsx lines 1374-1617) ======== */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <div className="relative w-full max-w-4xl" style={{ aspectRatio: '16 / 9' }}>
          {/* Table surface — oval (FROM App.tsx lines 1382-1408) */}
          <div className="absolute inset-0 rounded-[50%] shadow-2xl" style={{
            background: 'radial-gradient(ellipse at 40% 40%, #1a5c2a 0%, #145222 40%, #0d3d18 100%)',
            border: '8px solid #2a1a0a',
            boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.5), 0 0 0 12px #1a0f05',
          }}>
            <div className="absolute inset-0 rounded-[50%]" style={{ boxShadow: 'inset 0 0 20px rgba(0,0,0,0.3)' }} />
            <div className="absolute inset-0 rounded-[50%] opacity-[0.03]"
              style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)' }} />
          </div>

          {/* Center content (FROM App.tsx lines 1411-1524) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
            {gameState && !awaitingChoice && (
              <>
                {/* Variant label on felt, with the mixed-game tracker */}
                <div className="text-xs font-semibold text-amber-300/80 tracking-wide mb-0.5">
                  {VARIANT_LABELS[gameState.variant] || gameState.variant}
                </div>
                {trackerText && (
                  <div className="text-[10px] text-amber-100/60 font-mono mb-1">{trackerText}</div>
                )}

                {/* Phase indicator */}
                <div className="text-[10px] text-green-300/50 font-mono uppercase tracking-widest mb-2">
                  {gameState.phase === 'complete' ? 'Showdown' : gameState.phase}
                </div>

                {/* Community Cards — animated reveal (FROM App.tsx lines 1437-1455) */}
                {gameState.communityCards.length > 0 && (
                  <div className="flex gap-1 mb-2">
                    {gameState.communityCards.map((card, i) => (
                      <div key={i} className="transition-all duration-200" style={{
                        opacity: i < visibleCommunityCount ? 1 : 0,
                        transform: i < visibleCommunityCount ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.9)',
                      }}>
                        <CardDisplay card={card} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Pot or Win Display (FROM App.tsx lines 1457-1490) */}
                {showdownNow && winInfo.length > 0 ? (
                  <>
                    <WinDisplay winInfo={winInfo} variant={gameState.variant} />
                    {/* Uncalled bets were returned, not won */}
                    {(gameState.uncalledReturns ?? []).map((r, i) => (
                      <div key={`uncalled-${i}`} className="text-[10px] text-slate-300/70 mt-0.5">
                        ${r.amount.toFixed(2)} uncalled, returned to {gameState.players.find(p => p.id === r.playerId)?.name ?? r.playerId}
                      </div>
                    ))}
                  </>
                ) : (
                  <PotDisplay collectedAmount={collectedPot} totalAmount={potTotal} pots={(() => {
                    if (!gameState || gameState.pots.length <= 1) return undefined;
                    const activePlayers = new Set(
                      gameState.players.filter(p => !p.folded && !p.sittingOut).map(p => p.id)
                    );
                    const merged: typeof gameState.pots = [];
                    for (const pot of gameState.pots) {
                      const effectiveIds = pot.eligiblePlayerIds
                        .filter(id => activePlayers.has(id)).sort().join(',');
                      const match = merged.find(m => {
                        const mIds = m.eligiblePlayerIds.filter(id => activePlayers.has(id)).sort().join(',');
                        return mIds === effectiveIds;
                      });
                      if (match) { match.amount += pot.amount; }
                      else { merged.push({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] }); }
                    }
                    return merged.length > 1 ? merged : undefined;
                  })()} />
                )}
              </>
            )}

            {/* Waiting for the dealer's-choice pick */}
            {(!gameState || awaitingChoice) && !socketState.dcChoosing && (
              <p className="text-sm text-slate-300">Waiting for <span className="font-semibold text-amber-300">{choosingName}</span> to choose the game...</p>
            )}
          </div>

          {/* Player seats (FROM App.tsx lines 1527-1561, with seat rotation) */}
          {gameState && rotatedPlayers.map((player, i) => (
            <PlayerSeat
              key={player.id}
              player={awayIds.has(player.id) ? { ...player, name: `${player.name} (away)` } : player}
              isActive={i === rotatedActiveIndex && !showdownNow && !awaitingChoice}
              isDealer={i === rotatedButtonIndex}
              isHuman={player.id === myId}
              showCards={
                !awaitingChoice && (
                  (isRealShowdown && !player.folded && showdownNow) ||
                  player.id === myId ||
                  (isAllInRunout && !player.folded))
              }
              position={positions[i]}
              isTop={positions[i][1] < 50}
              onCardClick={toggleDiscard}
              selectedDiscardIndices={selectedDiscardIndices}
              isDrawing={isDrawPhase === true && player.id === myId}
              dealtCardCount={
                showdownNow
                  ? (player.folded ? 0 : player.holeCards.length)
                  : countsFresh ? (dealtCardCounts[player.id] ?? 0) : 0
              }
              lastAction={awaitingChoice ? undefined : lastActions[player.id]}
              lastDrawAction={awaitingChoice ? undefined : lastDrawActions[player.id]}
              forceAllDown={studForceDown}
              chipsBehind={socketState.chipsBehind?.[player.id]}
              handDescription={
                showdownNow && isRealShowdown && !player.folded && socketState.handDescriptions
                  ? socketState.handDescriptions[player.id]
                  : undefined
              }
            />
          ))}

          {/* Bet chips (FROM App.tsx lines 1563-1574, with rotation) */}
          {/* Dealer button on the felt, beside the button seat */}
          {gameState && !awaitingChoice && rotatedButtonIndex >= 0 && positions[rotatedButtonIndex] && (() => {
            const pos = positions[rotatedButtonIndex];
            const x = 50 + (pos[0] - 50) * 0.62 + (pos[0] >= 50 ? -5 : 5);
            const y = 50 + (pos[1] - 50) * 0.62;
            return (
              <div className="absolute -translate-x-1/2 -translate-y-1/2 z-[6] w-6 h-6 rounded-full bg-yellow-300 text-black text-[11px] font-bold flex items-center justify-center shadow-md border-2 border-yellow-100"
                style={{ left: `${x}%`, top: `${y}%` }} title="Dealer button">D</div>
            );
          })()}

          {gameState && !showdownNow && !awaitingChoice && rotatedPlayers.map((player, i) =>
            player.bet > 0 ? (
              <BetChip key={`bet-${player.id}`} amount={player.bet} position={betPositions[i]} />
            ) : null
          )}

          {/* Win chips (FROM App.tsx lines 1576-1609, with rotation) */}
          {gameState && showdownNow && winInfo.map((w, idx) => {
            const playerIdx = rotatedPlayers.findIndex(p => p.id === w.playerId);
            if (playerIdx === -1) return null;
            const seatPos = positions[playerIdx];
            const chipX = 50 + (seatPos[0] - 50) * 0.45;
            const chipY = 50 + (seatPos[1] - 50) * 0.45;
            const chipGroups = decomposeChips(w.amount);
            return (
              <div key={`win-chips-${w.playerId}-${idx}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-[5] transition-all duration-700 ease-out"
                style={{ left: `${chipX}%`, top: `${chipY}%` }}>
                <div className="flex items-end gap-0.5">
                  {chipGroups.map((group, gi) => (
                    <div key={gi} className="flex flex-col-reverse items-center">
                      {Array.from({ length: Math.min(group.count, 3) }, (_, i) => (
                        <div key={i} style={{ marginTop: i > 0 ? -12 : 0 }}>
                          <CasinoChip value={group.value} size={18} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Game log (FROM App.tsx lines 1611-1617) */}
          <GameLog entries={log} visible={logVisible} onToggle={() => setLogVisible(v => !v)} />
        </div>
      </div>

      {/* DC picker — high z-index overlay */}
      {socketState.dcChoosing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-slate-900/95 border border-amber-500/40 rounded-lg p-5 max-w-sm shadow-2xl">
            <h2 className="text-sm font-bold text-amber-400 mb-3 text-center">Your Pick — Choose the Game</h2>
            <div className="grid grid-cols-2 gap-1.5 w-full max-h-[60vh] overflow-y-auto">
              {PLAYABLE_VARIANTS.map(v => (
                <button key={v} onClick={() => handleDcPick(v)}
                  className="py-2 px-3 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white transition-colors"
                >{VARIANT_LABELS[v]}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======== Hand Ranking (FROM App.tsx lines 1620-1627) ======== */}
      {socketState.handDescription && gameState && !showdownNow && !awaitingChoice && !isAllInRunout && (
        <div className="flex-shrink-0 flex justify-center px-4 py-0.5">
          <span className="text-[11px] font-semibold text-amber-400/80 tracking-wide">
            {socketState.handDescription}
          </span>
        </div>
      )}

      {/* ======== Bottom Bar — Actions (FROM App.tsx lines 1630-1704, multiplayer version) ======== */}
      <div className="flex-shrink-0 px-4 pb-3 pt-1">
        {myRoomPlayer && !myRoomPlayer.seated ? (
          // Arrived mid-game: buy in now, dealt in from the next hand
          <div className="max-w-xs mx-auto">
            <BuyInPanel min={tableBuyInMin} max={maxBuyIn} value={tableBuyIn} onChange={setBuyInChoice}
              onSitDown={() => socketActions.sitDown(tableBuyIn)} />
          </div>
        ) : isDrawPhase && socketState.isYourTurn && !isAnimating && socketState.countdown !== -1 && gameState ? (
          <div className="flex flex-wrap items-center gap-2 justify-center">
            <span className="text-xs text-slate-400">Click cards to select for discard, then:</span>
            <button onClick={handleDiscard}
              className="px-5 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-md bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30">
              {selectedDiscardIndices.size === 0 ? 'Stand Pat' : `Draw ${selectedDiscardIndices.size}`}
            </button>
          </div>
        ) : socketState.isYourTurn && !isAnimating && socketState.countdown !== -1 && socketState.availableActions && gameState ? (
          <ActionPanel
            // Remount per decision so the bet amount resets to the new legal range
            key={`${gameState.id}-${gameState.actionHistory.length}`}
            actions={socketState.availableActions}
            onAction={handleAction}
            bettingStructure={gameState.bettingStructure}
            phase={gameState.phase}
            minChip={0.25}
            pot={potTotal}
            currentBet={gameState.currentBet}
          />
        ) : awaitingChoice ? (
          <div className="flex flex-col items-center gap-2">
            <div className="text-center text-slate-400 text-xs">
              {socketState.dcChoosing ? 'Your pick: choose the game' : <>Waiting for <span className="text-amber-300 font-semibold">{choosingName}</span> to choose the game</>}
            </div>
            {socketState.countdown === -1 && <span className="text-sm font-mono text-amber-400">Paused</span>}
            {socketState.isHost && (
              <div className="flex gap-2">
                <button onClick={() => socketActions.startHand()}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-all active:scale-95">
                  Deal Now
                </button>
                <button onClick={() => socketState.countdown === -1 ? socketActions.resumeCountdown() : socketActions.pauseCountdown()}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-semibold transition-colors">
                  {socketState.countdown === -1 ? 'Resume' : 'Pause'}
                </button>
              </div>
            )}
          </div>
        ) : showdownNow ? (
          <div className="flex flex-col items-center gap-2">
            {/* Countdown display — only after showdown declared (FROM App.tsx lines 1658-1663) */}
            {socketState.countdown !== null && socketState.countdown > 0 && (
              <span className="text-sm font-mono text-slate-400">
                Next hand in <span className="text-white font-bold">{socketState.countdown}</span>...
              </span>
            )}
            {socketState.countdown === -1 && (
              <span className="text-sm font-mono text-amber-400">Paused</span>
            )}
            <div className="flex gap-2 items-center">
              {socketState.isHost ? (
                <>
                  <button onClick={() => socketActions.startHand()}
                    className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-all active:scale-95">
                    Deal Now
                  </button>
                  <button onClick={() => socketState.countdown === -1 ? socketActions.resumeCountdown() : socketActions.pauseCountdown()}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-semibold transition-colors">
                    {socketState.countdown === -1 ? 'Resume' : 'Pause'}
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-500">Waiting for host to deal...</span>
              )}
            </div>
          </div>
        ) : socketState.winners ? (
          // During runout animation — winners received but showdown not yet declared
          null
        ) : gameState ? (
          <div className="text-center text-slate-600 text-xs py-2">
            Waiting for {rotatedPlayers[rotatedActiveIndex]?.name ?? '...'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
