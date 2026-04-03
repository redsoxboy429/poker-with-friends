// ============================================================
// MultiplayerTable — table view powered by socket events
// ============================================================
// Full-featured multiplayer table matching App.tsx's polish:
// - Client-side animations (community cards, hole cards, all-in runout)
// - Action badges (FOLD/CHECK/CALL/BET/RAISE + draw actions)
// - Hand description display
// - Add-on / cash-out modals
// - Session ledger
// - Real showdown vs fold-win detection
// - Stud force-down initial deal animation

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket } from './useSocket';
import type { AvailableActions } from './engine-wrapper';
import { GameVariant, GamePhase, ActionType, GameMode } from './engine-wrapper';
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
  ALLIN_STREET_PAUSE,
  SHOWDOWN_DELAY,
  formatActionType,
  ACTION_STYLES,
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
const MAX_BUYIN_BB = 300;

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

// ============================================================
// Main Component
// ============================================================

export default function MultiplayerTable() {
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const [socketState, socketActions] = useSocket();
  const [buyInBB, setBuyInBB] = useState(100);

  // --- Core game UI state ---
  const [logVisible, setLogVisible] = useState(false);
  const [log, setLog] = useState<string[]>(['Connected to room ' + (code || '???')]);
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<Set<number>>(new Set());
  const [showdown, setShowdown] = useState(false);
  const [isRealShowdown, setIsRealShowdown] = useState(false);
  const [winInfo, setWinInfo] = useState<WinEntry[]>([]);

  // --- Action badges ---
  const [lastActions, setLastActions] = useState<Record<string, string>>({});
  const [lastDrawActions, setLastDrawActions] = useState<Record<string, string>>({});

  // --- Animation state ---
  const [visibleCommunityCount, setVisibleCommunityCount] = useState(0);
  const [dealtCardCounts, setDealtCardCounts] = useState<Record<string, number>>({});
  const [isAnimating, setIsAnimating] = useState(false);
  const [isAllInRunout, setIsAllInRunout] = useState(false);
  const [studForceDown, setStudForceDown] = useState(false);

  // --- Add-on / Cash-out modals ---
  const [showAddOn, setShowAddOn] = useState(false);
  const [addOnAmount, setAddOnAmount] = useState(0);
  const [showCashOut, setShowCashOut] = useState(false);

  // --- Ledger / Tracker ---
  const [showTracker, setShowTracker] = useState(false);
  const ledgerRef = useRef<Record<string, { totalBuyIn: number; totalBuyOut: number; name: string }>>({});

  // --- Game mode menu (host only) ---
  const [showGameMenu, setShowGameMenu] = useState(false);
  const [menuGameMode, setMenuGameMode] = useState<GameMode>(GameMode.DealersChoice);
  const [menuVariant, setMenuVariant] = useState<GameVariant>(GameVariant.NLH);

  // --- Direct link join ---
  const [directJoinName, setDirectJoinName] = useState(() => localStorage.getItem('poker-player-name') || '');
  const [directJoinAttempted, setDirectJoinAttempted] = useState(false);

  // --- Refs for animation coordination ---
  const visibleCommunityCountRef = useRef(0);
  const dealtCardCountsRef = useRef<Record<string, number>>({});
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevPhaseRef = useRef<string | null>(null);
  const prevHandRef = useRef<typeof socketState.handState>(null);
  const pendingWinnersRef = useRef<typeof socketState.winners>(null);
  const pendingFinalStateRef = useRef<typeof socketState.finalState>(null);

  // --- Helpers ---
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

  const updateDealtCardCounts = useCallback((updater: (prev: Record<string, number>) => Record<string, number>) => {
    setDealtCardCounts(prev => {
      const next = updater(prev);
      dealtCardCountsRef.current = next;
      return next;
    });
  }, []);

  // ============================================================
  // Animation functions (ported from App.tsx)
  // ============================================================

  /** Animate community cards appearing one at a time */
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

  /** Animate hole cards being dealt one at a time */
  const animateHoleCards = useCallback(
    (prevCounts: Record<string, number>, players: Array<{ id: string; holeCards: any[]; cardVisibility?: string[] }>, onDone: () => void) => {
      // Build deal steps: which player gets which card index
      const dealSteps: Array<{ playerId: string; cardIdx: number }> = [];
      const maxCards = Math.max(...players.map(p => p.holeCards.length), 0);
      for (let cardIdx = 1; cardIdx <= maxCards; cardIdx++) {
        for (const p of players) {
          if (p.holeCards.length >= cardIdx && (prevCounts[p.id] ?? 0) < cardIdx) {
            dealSteps.push({ playerId: p.id, cardIdx });
          }
        }
      }
      if (dealSteps.length === 0) { onDone(); return; }

      // Stud initial deal: force all cards face-down, then reveal door cards
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

  /** Run all-in runout animation (street-by-street reveal) */
  const animateRunout = useCallback(
    (currentVisible: number, totalCommunity: number, onDone: () => void) => {
      // Build street array
      const streets: Array<[number, number]> = [];
      let from = currentVisible;
      if (from === 0 && totalCommunity >= 3) {
        streets.push([0, 3]); from = 3;
      }
      while (from < totalCommunity) {
        streets.push([from, from + 1]); from++;
      }
      if (streets.length === 0) { onDone(); return; }

      setIsAnimating(true);
      setIsAllInRunout(true);

      let totalDelay = ALLIN_STREET_PAUSE;
      for (let s = 0; s < streets.length; s++) {
        const [streetFrom, streetTo] = streets[s];
        const isLast = s === streets.length - 1;
        const streetDelay = totalDelay;
        for (let c = streetFrom; c < streetTo; c++) {
          const cardDelay = streetDelay + (c - streetFrom) * CARD_DEAL_INTERVAL;
          const t = setTimeout(() => updateVisibleCommunity(c + 1), cardDelay);
          animTimersRef.current.push(t);
        }
        const streetDoneDelay = streetDelay + (streetTo - streetFrom) * CARD_DEAL_INTERVAL;
        if (isLast) {
          const t = setTimeout(() => {
            setIsAnimating(false);
            setIsAllInRunout(false);
            onDone();
          }, streetDoneDelay + SHOWDOWN_DELAY);
          animTimersRef.current.push(t);
        }
        totalDelay = streetDoneDelay + ALLIN_STREET_PAUSE;
      }
    }, [updateVisibleCommunity]
  );

  // ============================================================
  // Socket effects
  // ============================================================

  // Connect on mount
  useEffect(() => {
    if (socketState.status === 'disconnected') socketActions.connect();
  }, []);

  // Process incoming hand state — animate cards, track actions
  useEffect(() => {
    const curr = socketState.handState;
    const prev = prevHandRef.current;
    if (!curr) {
      prevHandRef.current = null;
      prevPhaseRef.current = null;
      return;
    }

    // Detect new hand (prev was null or phase reset from showdown to dealing)
    if (!prev) {
      // New hand — reset animation state
      clearAnimTimers();
      setVisibleCommunityCount(0); visibleCommunityCountRef.current = 0;
      setDealtCardCounts({}); dealtCardCountsRef.current = {};
      setIsAnimating(false); setIsAllInRunout(false); setStudForceDown(false);
      setLastActions({}); setLastDrawActions({});
      addLog(`--- ${VARIANT_LABELS[curr.variant] || curr.variant} ---`);

      // Animate initial hole card deal
      const prevCounts: Record<string, number> = {};
      curr.players.forEach(p => { prevCounts[p.id] = 0; });
      animateHoleCards(prevCounts, curr.players, () => {
        // After hole cards dealt, animate any community cards (e.g. drawmaha)
        if (curr.communityCards.length > 0) {
          animateCommunityCards(0, curr.communityCards.length, () => {});
        }
      });
    } else {
      // Detect phase change
      if (prev.phase !== curr.phase) {
        const label = curr.phase === 'complete' ? 'Showdown' : curr.phase;
        addLog(`Phase: ${label}`);
        // Clear betting action badges on street change
        setLastActions({});
        // Clear draw actions and discard selection when entering a new draw phase
        if (DRAW_PHASES.includes(curr.phase)) {
          setLastDrawActions({});
          setSelectedDiscardIndices(new Set());
        }
      }

      // Animate new community cards
      const prevCommunity = visibleCommunityCountRef.current;
      if (curr.communityCards.length > prevCommunity) {
        animateCommunityCards(prevCommunity, curr.communityCards.length, () => {});
      }

      // Animate new hole cards (stud streets)
      const prevCardCounts = dealtCardCountsRef.current;
      const hasNewCards = curr.players.some(p => p.holeCards.length > (prevCardCounts[p.id] ?? 0));
      if (hasNewCards) {
        animateHoleCards(prevCardCounts, curr.players, () => {});
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
    prevPhaseRef.current = curr.phase;
  }, [socketState.handState, socketState.lastAction, addLog, clearAnimTimers, animateHoleCards, animateCommunityCards]);

  // Handle hand complete — animate runout if needed, then show winners
  useEffect(() => {
    if (!socketState.winners || !socketState.finalState) return;

    const finalState = socketState.finalState;
    const nonFolded = finalState.players.filter(p => !p.folded).length;
    const isReal = nonFolded > 1;

    // Check for unrevealed community cards (all-in runout)
    const currentVisible = visibleCommunityCountRef.current;
    const totalCommunity = finalState.communityCards.length;
    const hasRunout = totalCommunity > currentVisible && isReal;

    const finishShowdown = () => {
      setIsRealShowdown(isReal);
      setShowdown(true);
      setWinInfo(socketState.winners!.map(w => ({
        playerId: w.playerId,
        name: w.name,
        amount: w.amount,
        handDescription: w.handDescription,
        side: w.side,
        potLabel: w.potLabel,
      })));
      // Make sure all community cards are visible
      updateVisibleCommunity(totalCommunity);
      addLog('--- Hand complete ---');
    };

    if (hasRunout) {
      // Animate the runout, then show winners
      animateRunout(currentVisible, totalCommunity, finishShowdown);
    } else {
      // No runout — add a brief delay then show winners
      const t = setTimeout(finishShowdown, isReal ? SHOWDOWN_DELAY : 200);
      animTimersRef.current.push(t);
    }
  }, [socketState.winners, socketState.finalState, addLog, animateRunout, updateVisibleCommunity]);

  // Clear showdown on new hand
  useEffect(() => {
    if (socketState.handState && socketState.handState.phase !== 'complete' && socketState.handState.phase !== 'showdown') {
      if (showdown) {
        setShowdown(false);
        setIsRealShowdown(false);
        setWinInfo([]);
        setSelectedDiscardIndices(new Set());
        prevHandRef.current = null; // Force new-hand animation on next hand-state
      }
    }
  }, [socketState.handState, showdown]);

  // Initialize ledger when players sit down
  useEffect(() => {
    if (!socketState.roomState) return;
    for (const p of socketState.roomState.players) {
      if (p.seated && !ledgerRef.current[p.name]) {
        ledgerRef.current[p.name] = { totalBuyIn: p.chips, totalBuyOut: 0, name: p.name };
      }
    }
  }, [socketState.roomState]);

  // ============================================================
  // Action handlers
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

  const handleAddOnOpen = useCallback(() => {
    const roomState = socketState.roomState;
    if (!roomState) return;
    const bb = roomState.settings.bigBlind;
    const maxBuyIn = MAX_BUYIN_BB * bb;
    const myPlayer = roomState.players.find(p =>
      p.seatIndex === (socketState.yourPlayerId ? parseInt(socketState.yourPlayerId.slice(1)) : -1)
    );
    if (!myPlayer) return;
    if (myPlayer.chips >= maxBuyIn) {
      addLog('Already at max buy-in');
      return;
    }
    setAddOnAmount(myPlayer.chips);
    setShowAddOn(true);
    if (socketState.isHost) socketActions.pauseCountdown();
  }, [socketState.roomState, socketState.yourPlayerId, socketState.isHost, socketActions, addLog]);

  const handleAddOnConfirm = useCallback(() => {
    const roomState = socketState.roomState;
    if (!roomState) return;
    const myPlayer = roomState.players.find(p =>
      p.seatIndex === (socketState.yourPlayerId ? parseInt(socketState.yourPlayerId.slice(1)) : -1)
    );
    if (!myPlayer) return;
    const addAmount = addOnAmount - myPlayer.chips;
    if (addAmount <= 0) { setShowAddOn(false); return; }

    socketActions.addOn(addOnAmount);
    // Update ledger
    if (ledgerRef.current[myPlayer.name]) {
      ledgerRef.current[myPlayer.name].totalBuyIn += addAmount;
    }
    addLog(`${myPlayer.name}: Added on $${addAmount.toFixed(2)}`);
    setShowAddOn(false);
    if (socketState.isHost) socketActions.resumeCountdown();
  }, [addOnAmount, socketState.roomState, socketState.yourPlayerId, socketState.isHost, socketActions, addLog]);

  // ============================================================
  // Rendering setup
  // ============================================================

  // Use finalState during showdown OR all-in runout animation (finalState has the full board)
  const gameState = (showdown || isAllInRunout) && socketState.finalState ? socketState.finalState : socketState.handState;
  const roomState = socketState.roomState;
  const myId = socketState.yourPlayerId;

  // --- Early returns for non-game states ---

  if (!roomState) {
    // If connected and have a room code from URL, show join prompt
    if (socketState.status === 'connected' && code && !directJoinAttempted) {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
          <h2 className="text-xl font-bold text-white mb-4">Join Room {code.toUpperCase()}</h2>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 w-full max-w-xs">
            <label className="text-xs font-semibold text-slate-300 block mb-1">Your Name</label>
            <input
              type="text"
              value={directJoinName}
              onChange={e => setDirectJoinName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white text-sm mb-3 focus:outline-none focus:border-emerald-500"
              maxLength={20}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && directJoinName.trim()) {
                  localStorage.setItem('poker-player-name', directJoinName.trim());
                  socketActions.joinRoom(directJoinName.trim(), code);
                  setDirectJoinAttempted(true);
                }
              }}
            />
            <button
              onClick={() => {
                if (!directJoinName.trim()) return;
                localStorage.setItem('poker-player-name', directJoinName.trim());
                socketActions.joinRoom(directJoinName.trim(), code);
                setDirectJoinAttempted(true);
              }}
              disabled={!directJoinName.trim()}
              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold text-sm transition-colors"
            >
              Join Room
            </button>
          </div>
          <button onClick={() => navigate('/')} className="mt-4 text-slate-500 hover:text-slate-300 text-sm">
            Back to Lobby
          </button>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <p className="text-slate-400 mb-4">Connecting to room {code}...</p>
        <button onClick={() => navigate('/')} className="text-emerald-400 hover:underline text-sm">
          Back to Lobby
        </button>
      </div>
    );
  }

  // Room is in lobby state — show waiting room
  if (roomState.state === 'lobby' && !gameState && !socketState.dcChoosing) {
    const roomLink = `${window.location.origin}/room/${roomState.code}`;
    const seatedCount = roomState.players.filter(p => p.seated && p.connected).length;
    const canStart = seatedCount >= 2;
    const myPlayer = roomState.players.find(p => p.seatIndex === (socketState.yourPlayerId ? parseInt(socketState.yourPlayerId.slice(1)) : -1));
    const iAmSeated = myPlayer?.seated ?? false;
    const bb = roomState.settings.bigBlind;

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
                    className="text-red-500 hover:text-red-400 text-[10px] font-semibold ml-1">
                    Kick
                  </button>
                )}
              </div>
            ))}
          </div>

          {!iAmSeated && (
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-600">
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Buy-in: {buyInBB} BB {bb > 0 && <span className="text-slate-500">(${(buyInBB * bb).toFixed(2)})</span>}
              </label>
              <input type="range" min="50" max="300" step="10" value={buyInBB}
                onChange={(e) => setBuyInBB(Number(e.target.value))} className="w-full accent-emerald-500" />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 mb-2">
                <span>50 BB</span><span>300 BB</span>
              </div>
              <button onClick={() => socketActions.sitDown(buyInBB)}
                className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors">
                Sit Down (${(buyInBB * bb).toFixed(2)})
              </button>
            </div>
          )}

          {socketState.isHost && canStart && iAmSeated && (
            <button onClick={() => socketActions.startHand()}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors">
              Start Game
            </button>
          )}
          {!socketState.isHost && canStart && iAmSeated && (
            <p className="text-center text-xs text-slate-500">Waiting for host to start...</p>
          )}
          {iAmSeated && !canStart && (
            <p className="text-center text-xs text-slate-500">Waiting for more players to sit down...</p>
          )}
        </div>

        <button onClick={() => { socketActions.leaveRoom(); navigate('/'); }}
          className="mt-4 text-slate-500 hover:text-slate-300 text-sm">
          Leave Room
        </button>
      </div>
    );
  }

  // ============================================================
  // Game is active — render the table
  // ============================================================

  const numPlayers = gameState?.players.length ?? roomState.players.length;
  const positions = SEAT_POSITIONS[numPlayers] || SEAT_POSITIONS[4];
  const betPositions = BET_OFFSETS[numPlayers] || BET_OFFSETS[4];
  const bb = roomState.settings.bigBlind;
  const maxBuyIn = MAX_BUYIN_BB * bb;

  const collectedPot = gameState ? gameState.pots.reduce((s, p) => s + p.amount, 0) : 0;
  const currentStreetBets = gameState ? gameState.players.reduce((s, p) => s + p.bet, 0) : 0;
  const potTotal = collectedPot + currentStreetBets;

  const isDrawPhase = gameState && DRAW_PHASES.includes(gameState.phase);

  // Seat rotation
  const mySeatIndex = gameState?.players.findIndex(p => p.id === myId) ?? 0;
  const n = gameState?.players.length ?? 0;
  const rotatedPlayers = gameState ? rotateArray(gameState.players, mySeatIndex) : [];
  const rotatedActiveIndex = n > 0 ? (gameState!.activePlayerIndex - mySeatIndex + n + n) % n : -1;
  const rotatedButtonIndex = n > 0 ? (gameState!.buttonIndex - mySeatIndex + n + n) % n : -1;

  // My current player info (for add-on etc.)
  const myRoomPlayer = roomState.players.find(p =>
    p.seatIndex === (socketState.yourPlayerId ? parseInt(socketState.yourPlayerId.slice(1)) : -1)
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-bold text-white">Room {roomState.code}</h1>
          {gameState && (
            <span className="text-xs text-emerald-400 font-medium">
              {VARIANT_LABELS[gameState.variant] || gameState.variant}
            </span>
          )}
          {/* Session tracker (DC / rotation info) */}
          {socketState.sessionState && socketState.sessionState.mode !== 'specific' && socketState.sessionState.handsPerVariant > 0 && (
            <span className="text-[10px] text-slate-500 font-mono">
              {socketState.sessionState.mode === 'dealers-choice'
                ? `Hand ${socketState.sessionState.handInVariant}/${socketState.sessionState.handsPerVariant}`
                : `Hand ${socketState.sessionState.handInVariant}/${socketState.sessionState.handsPerVariant} \u2022 Game ${socketState.sessionState.rotationIndex + 1}/${socketState.sessionState.rotationLength}`
              }
              {socketState.sessionState.capBB && ` \u2022 Cap ${socketState.sessionState.capBB}BB`}
            </span>
          )}
        </div>
        <div className="flex gap-1 items-center">
          {/* Sit Out / Sit In */}
          <button onClick={() => myRoomPlayer?.sittingOut ? socketActions.sitIn() : socketActions.sitOut()}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              myRoomPlayer?.sittingOut
                ? 'bg-emerald-800 hover:bg-emerald-700 text-emerald-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
            }`}>
            {myRoomPlayer?.sittingOut ? 'Sit In' : 'Sit Out'}
          </button>
          {/* Game Menu (host only) */}
          {socketState.isHost && (
            <button onClick={() => { setMenuGameMode(roomState.settings.gameMode as GameMode); setMenuVariant((roomState.settings.variant || GameVariant.NLH) as GameVariant); setShowGameMenu(true); }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-medium transition-colors">
              Game
            </button>
          )}
          <button onClick={() => setShowTracker(v => !v)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-[10px] font-medium transition-colors">
            Tracker
          </button>
          <button onClick={() => setShowCashOut(true)}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-semibold transition-colors">
            Leave
          </button>
        </div>
      </header>

      {/* Error banner */}
      {socketState.error && (
        <div className="px-4 py-1.5 bg-red-900/40 text-red-300 text-xs text-center">
          {socketState.error}
        </div>
      )}

      {/* Tracker popup */}
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
                <th className="text-right py-1 px-2">Buy-outs</th>
                <th className="text-right py-1 px-2">Stack</th>
                <th className="text-right py-1 pl-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {roomState.players.filter(p => p.seated).map(p => {
                const ledger = ledgerRef.current[p.name] ?? { totalBuyIn: p.chips, totalBuyOut: 0, name: p.name };
                const net = p.chips + ledger.totalBuyOut - ledger.totalBuyIn;
                return (
                  <tr key={p.name} className="border-b border-slate-800">
                    <td className="py-1.5 pr-3 text-white font-medium">{p.name}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${ledger.totalBuyIn.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-400">${ledger.totalBuyOut.toFixed(2)}</td>
                    <td className="py-1.5 px-2 text-right text-slate-300">${p.chips.toFixed(2)}</td>
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

      {/* Table area */}
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <div className="relative w-full max-w-4xl" style={{ aspectRatio: '16 / 9' }}>
          {/* Table surface */}
          <div
            className="absolute inset-0 rounded-[50%] shadow-2xl"
            style={{
              background: 'radial-gradient(ellipse at 40% 40%, #1a5c2a 0%, #145222 40%, #0d3d18 100%)',
              border: '8px solid #2a1a0a',
              boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.5), 0 0 0 12px #1a0f05',
            }}
          >
            <div className="absolute inset-0 rounded-[50%]" style={{ boxShadow: 'inset 0 0 20px rgba(0,0,0,0.3)' }} />
            <div className="absolute inset-0 rounded-[50%] opacity-[0.03]"
              style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)' }}
            />
          </div>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
            {gameState && (
              <>
                <div className="text-xs font-semibold text-amber-300/80 tracking-wide mb-1">
                  {VARIANT_LABELS[gameState.variant] || gameState.variant}
                </div>
                <div className="text-[10px] text-green-300/50 font-mono uppercase tracking-widest mb-2">
                  {gameState.phase === 'complete' ? 'Showdown' : gameState.phase}
                </div>

                {/* Community cards — animated reveal via visibleCommunityCount */}
                {gameState.communityCards.length > 0 && (
                  <div className="flex gap-1 mb-2">
                    {gameState.communityCards.map((card, i) => (
                      <div key={i} style={{
                        opacity: i < visibleCommunityCount ? 1 : 0,
                        transform: i < visibleCommunityCount ? 'scale(1)' : 'scale(0.8)',
                        transition: 'opacity 0.15s ease-out, transform 0.15s ease-out',
                      }}>
                        <CardDisplay card={card} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Pot or Win display */}
                {showdown && winInfo.length > 0 ? (
                  <WinDisplay winInfo={winInfo} variant={gameState.variant} />
                ) : (
                  <PotDisplay collectedAmount={collectedPot} totalAmount={potTotal} pots={(() => {
                    if (!gameState || gameState.pots.length <= 1) return undefined;
                    const activePlayers = new Set(
                      gameState.players.filter(p => !p.folded && !p.sittingOut).map(p => p.id)
                    );
                    const merged: typeof gameState.pots = [];
                    for (const pot of gameState.pots) {
                      const effectiveIds = pot.eligiblePlayerIds
                        .filter(id => activePlayers.has(id))
                        .sort()
                        .join(',');
                      const match = merged.find(m => {
                        const mIds = m.eligiblePlayerIds
                          .filter(id => activePlayers.has(id))
                          .sort()
                          .join(',');
                        return mIds === effectiveIds;
                      });
                      if (match) {
                        match.amount += pot.amount;
                      } else {
                        merged.push({ ...pot, eligiblePlayerIds: [...pot.eligiblePlayerIds] });
                      }
                    }
                    return merged.length > 1 ? merged : undefined;
                  })()} />
                )}
              </>
            )}

            {/* Waiting for DC pick (non-chooser) */}
            {!gameState && !socketState.dcChoosing && (
              <p className="text-sm text-slate-400">Waiting for dealer to choose the game...</p>
            )}
          </div>

          {/* Player seats */}
          {gameState && rotatedPlayers.map((player, i) => (
            <PlayerSeat
              key={player.id}
              player={player}
              isActive={i === rotatedActiveIndex && !showdown}
              isDealer={i === rotatedButtonIndex}
              isHuman={player.id === myId}
              showCards={
                (isRealShowdown && !player.folded && showdown) ||
                player.id === myId ||
                (isAllInRunout && !player.folded)
              }
              position={positions[i]}
              isTop={positions[i][1] < 50}
              onCardClick={toggleDiscard}
              selectedDiscardIndices={selectedDiscardIndices}
              isDrawing={isDrawPhase && player.id === myId}
              dealtCardCount={showdown ? (player.folded ? 0 : player.holeCards.length) : (dealtCardCounts[player.id] ?? 0)}
              lastAction={lastActions[player.id]}
              lastDrawAction={lastDrawActions[player.id]}
              forceAllDown={studForceDown}
              handDescription={
                showdown && isRealShowdown && !player.folded && socketState.handDescriptions
                  ? socketState.handDescriptions[player.id]
                  : undefined
              }
              chipsBehind={socketState.chipsBehind?.[player.id]}
            />
          ))}

          {/* Bet chips */}
          {gameState && !showdown && rotatedPlayers.map((player, i) =>
            player.bet > 0 ? (
              <BetChip key={`bet-${player.id}`} amount={player.bet} position={betPositions[i]} />
            ) : null
          )}

          {/* Win chips */}
          {gameState && showdown && winInfo.map((w, idx) => {
            const playerIdx = rotatedPlayers.findIndex(p => p.id === w.playerId);
            if (playerIdx === -1) return null;
            const seatPos = positions[playerIdx];
            const chipX = 50 + (seatPos[0] - 50) * 0.45;
            const chipY = 50 + (seatPos[1] - 50) * 0.45;
            const chipGroups = decomposeChips(w.amount);
            return (
              <div key={`win-${w.playerId}-${idx}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-[5]"
                style={{ left: `${chipX}%`, top: `${chipY}%` }}
              >
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

          {/* Game log */}
          <GameLog entries={log} visible={logVisible} onToggle={() => setLogVisible(v => !v)} />
        </div>
      </div>

      {/* DC picker — high z-index overlay so it's always above cards */}
      {socketState.dcChoosing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-slate-900/95 border border-amber-500/40 rounded-lg p-5 max-w-sm shadow-2xl">
            <h2 className="text-sm font-bold text-amber-400 mb-3 text-center">Your Pick — Choose the Game</h2>
            <div className="grid grid-cols-2 gap-1.5 w-full max-h-[60vh] overflow-y-auto">
              {Object.values(GameVariant).map((v) => (
                <button key={v} onClick={() => handleDcPick(v)}
                  className="py-2 px-3 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white transition-colors"
                >{VARIANT_LABELS[v]}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hand description (during play — hide during all-in runout since cards aren't all visible yet) */}
      {socketState.handDescription && gameState && !showdown && !isAllInRunout && (
        <div className="flex-shrink-0 flex justify-center px-4 py-0.5">
          <span className="text-[11px] font-semibold text-amber-400/80 tracking-wide">
            {socketState.handDescription}
          </span>
        </div>
      )}

      {/* Bottom bar — actions */}
      <div className="flex-shrink-0 px-4 pb-3 pt-1">
        {isDrawPhase && socketState.isYourTurn && gameState ? (
          <div className="flex flex-wrap items-center gap-2 justify-center">
            <span className="text-xs text-slate-400">Click cards to select for discard, then:</span>
            <button onClick={handleDiscard}
              className="px-5 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 shadow-md bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/30"
            >
              {selectedDiscardIndices.size === 0 ? 'Stand Pat' : `Draw ${selectedDiscardIndices.size}`}
            </button>
          </div>
        ) : socketState.isYourTurn && socketState.availableActions && gameState ? (
          <ActionPanel
            actions={socketState.availableActions}
            onAction={handleAction}
            bettingStructure={gameState.bettingStructure}
            phase={gameState.phase}
            minChip={0.25}
          />
        ) : (showdown || socketState.winners) ? (
          <div className="flex flex-col items-center gap-2">
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
              <button onClick={handleAddOnOpen}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs font-semibold transition-colors">
                Add On
              </button>
            </div>
          </div>
        ) : gameState ? (
          <div className="text-center text-slate-600 text-xs py-2">
            Waiting for {rotatedPlayers[rotatedActiveIndex]?.name ?? '...'}
          </div>
        ) : null}
      </div>

      {/* Add-On Modal */}
      {showAddOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[320px] max-w-[400px]">
            <h3 className="text-lg font-bold text-white mb-4">Add On</h3>
            <p className="text-sm text-slate-400 mb-3">Set chips to:</p>
            <div className="flex items-center gap-3 mb-4">
              <input type="range"
                min={myRoomPlayer?.chips ?? 0}
                max={maxBuyIn}
                step={roomState.settings.smallBlind}
                value={addOnAmount}
                onChange={e => setAddOnAmount(parseFloat(e.target.value))}
                className="flex-1 accent-emerald-500"
              />
              <span className="text-lg font-bold text-emerald-300 w-20 text-right">
                ${addOnAmount.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Adding ${Math.max(0, addOnAmount - (myRoomPlayer?.chips ?? 0)).toFixed(2)}
            </p>
            <div className="flex gap-2">
              <button onClick={handleAddOnConfirm}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors">
                Confirm
              </button>
              <button onClick={() => { setShowAddOn(false); if (socketState.isHost) socketActions.resumeCountdown(); }}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cash-Out / Leave Modal */}
      {showCashOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[300px]">
            <h3 className="text-lg font-bold text-white mb-3">Leave Table</h3>
            <p className="text-sm text-slate-400 mb-4">
              Cash out ${(myRoomPlayer?.chips ?? 0).toFixed(2)} and leave?
            </p>
            <div className="flex flex-col gap-2">
              <button onClick={() => {
                // Record cash-out in ledger
                if (myRoomPlayer && ledgerRef.current[myRoomPlayer.name]) {
                  ledgerRef.current[myRoomPlayer.name].totalBuyOut += myRoomPlayer.chips;
                }
                socketActions.leaveRoom(); navigate('/');
              }}
                className="w-full px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg font-semibold transition-colors">
                Leave Table
              </button>
              {socketState.isHost && (
                <button onClick={() => { socketActions.stopGame(); setShowCashOut(false); }}
                  className="w-full px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white rounded-lg font-semibold transition-colors">
                  Stop Game (Back to Lobby)
                </button>
              )}
              <button onClick={() => setShowCashOut(false)}
                className="w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Mode Menu (Host Only) */}
      {showGameMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-600 rounded-xl shadow-2xl p-6 min-w-[340px] max-w-[420px]">
            <h3 className="text-lg font-bold text-white mb-4">Change Game</h3>
            <p className="text-xs text-slate-500 mb-3">Takes effect on the next hand.</p>

            {/* Game mode selector */}
            <div className="grid grid-cols-2 gap-1.5 mb-4">
              {Object.values(GameMode).map(m => (
                <button key={m} onClick={() => setMenuGameMode(m)}
                  className={`py-2 px-3 rounded text-xs font-medium transition-colors ${
                    menuGameMode === m
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}>
                  {GAME_MODE_LABELS[m] || m}
                </button>
              ))}
            </div>

            {/* Variant picker (only for Specific Game) */}
            {menuGameMode === GameMode.SpecificGame && (
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1">Variant</label>
                <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
                  {Object.values(GameVariant).map(v => (
                    <button key={v} onClick={() => setMenuVariant(v)}
                      className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors ${
                        menuVariant === v
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}>
                      {VARIANT_LABELS[v]}
                    </button>
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
              }}
                className="flex-1 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors">
                Confirm
              </button>
              <button onClick={() => setShowGameMenu(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg font-semibold transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
