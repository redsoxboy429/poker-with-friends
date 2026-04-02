// ============================================================
// MultiplayerTable — table view powered by socket events
// ============================================================
// Same visual rendering as App.tsx (local practice) but:
// - State comes from server via socket (PlayerView, not HandState)
// - Actions sent via socket (no local engine)
// - No bot logic, no local game engine
// - Animations are simplified (server broadcasts state; client renders)

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
  formatActionType,
} from './constants';

/** Rotate an array so `startIndex` becomes index 0 */
function rotateArray<T>(arr: T[], startIndex: number): T[] {
  if (startIndex === 0 || arr.length === 0) return arr;
  return [...arr.slice(startIndex), ...arr.slice(0, startIndex)];
}

const MAX_LOG_ENTRIES = 200;

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

export default function MultiplayerTable() {
  const navigate = useNavigate();
  const { code } = useParams<{ code: string }>();
  const [socketState, socketActions] = useSocket();
  const [buyInBB, setBuyInBB] = useState(100);

  const [logVisible, setLogVisible] = useState(false);
  const [log, setLog] = useState<string[]>(['Connected to room ' + (code || '???')]);
  const [selectedDiscardIndices, setSelectedDiscardIndices] = useState<Set<number>>(new Set());
  const [showdown, setShowdown] = useState(false);
  const [winInfo, setWinInfo] = useState<WinEntry[]>([]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => {
      const next = [...prev, msg];
      return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
    });
  }, []);

  // Track previous hand state to detect phase/action changes for logging
  const prevHandRef = useRef<typeof socketState.handState>(null);

  // Connect to server on mount
  useEffect(() => {
    if (socketState.status === 'disconnected') {
      socketActions.connect();
    }
  }, []);

  // Detect hand complete
  useEffect(() => {
    if (socketState.winners) {
      setShowdown(true);
      setWinInfo(socketState.winners.map(w => ({
        playerId: w.playerId,
        name: w.name,
        amount: w.amount,
        handDescription: w.handDescription,
        side: w.side,
        potLabel: w.potLabel,
      })));
      addLog('--- Hand complete ---');
    }
  }, [socketState.winners, addLog]);

  // Log hand state changes (phase transitions, new hands) for all players
  useEffect(() => {
    const curr = socketState.handState;
    const prev = prevHandRef.current;
    if (!curr) { prevHandRef.current = null; return; }

    if (!prev) {
      // First hand state — new hand started
      addLog(`--- ${VARIANT_LABELS[curr.variant] || curr.variant} ---`);
    } else if (prev.phase !== curr.phase) {
      // Phase changed
      const label = curr.phase === 'complete' ? 'Showdown' : curr.phase;
      addLog(`Phase: ${label}`);
    }

    prevHandRef.current = curr;
  }, [socketState.handState, addLog]);

  // Clear showdown on new hand
  useEffect(() => {
    if (socketState.handState && socketState.handState.phase !== 'complete' && socketState.handState.phase !== 'showdown') {
      if (showdown) {
        setShowdown(false);
        setWinInfo([]);
        setSelectedDiscardIndices(new Set());
      }
    }
  }, [socketState.handState, showdown]);

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

  // Use handState for rendering (from socket or final state during showdown)
  const gameState = showdown && socketState.finalState ? socketState.finalState : socketState.handState;
  const roomState = socketState.roomState;
  const myId = socketState.yourPlayerId;

  if (!roomState) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center">
        <p className="text-slate-400 mb-4">Connecting to room {code}...</p>
        <button onClick={() => navigate('/')} className="text-emerald-400 hover:underline text-sm">
          Back to Lobby
        </button>
      </div>
    );
  }

  // Room is in lobby state — show waiting room (unless DC picker is active)
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
        <p className="text-slate-400 text-sm mb-6">
          Share the code or link with friends to join
        </p>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 w-full max-w-sm">
          {/* Room code + copy link */}
          <div className="text-center mb-4">
            <span className="text-4xl font-mono font-bold text-emerald-400 tracking-[0.3em]">
              {roomState.code}
            </span>
            <div className="mt-2">
              <CopyLinkButton link={roomLink} />
            </div>
          </div>

          {/* Stakes info */}
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
                <span className={`text-sm ${p.connected ? 'text-white' : 'text-slate-600'}`}>
                  {p.name}
                </span>
                {p.isHost && <span className="text-[10px] text-amber-400 font-semibold">HOST</span>}
                {!p.connected && <span className="text-[10px] text-red-400">disconnected</span>}
                {p.seated
                  ? <span className="ml-auto text-[10px] text-emerald-400">${p.chips.toFixed(2)}</span>
                  : <span className="ml-auto text-[10px] text-slate-600">not seated</span>
                }
              </div>
            ))}
          </div>

          {/* Buy-in for unseated players */}
          {!iAmSeated && (
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg border border-slate-600">
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Buy-in: {buyInBB} BB {bb > 0 && <span className="text-slate-500">(${(buyInBB * bb).toFixed(2)})</span>}
              </label>
              <input
                type="range"
                min="50"
                max="300"
                step="10"
                value={buyInBB}
                onChange={(e) => setBuyInBB(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 mb-2">
                <span>50 BB</span>
                <span>300 BB</span>
              </div>
              <button
                onClick={() => socketActions.sitDown(buyInBB)}
                className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors"
              >
                Sit Down (${(buyInBB * bb).toFixed(2)})
              </button>
            </div>
          )}

          {/* Host can start */}
          {socketState.isHost && canStart && iAmSeated && (
            <button
              onClick={() => socketActions.startHand()}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-sm transition-colors"
            >
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

  // Game is active — render the table
  const numPlayers = gameState?.players.length ?? roomState.players.length;
  const positions = SEAT_POSITIONS[numPlayers] || SEAT_POSITIONS[4];
  const betPositions = BET_OFFSETS[numPlayers] || BET_OFFSETS[4];

  const collectedPot = gameState ? gameState.pots.reduce((s, p) => s + p.amount, 0) : 0;
  const currentStreetBets = gameState ? gameState.players.reduce((s, p) => s + p.bet, 0) : 0;
  const potTotal = collectedPot + currentStreetBets;

  const isDrawPhase = gameState && DRAW_PHASES.includes(gameState.phase);

  // Seat rotation: rotate players so current user is always at index 0 (bottom of screen).
  // Server indices stay the same — this is purely a visual rotation.
  const mySeatIndex = gameState?.players.findIndex(p => p.id === myId) ?? 0;
  const n = gameState?.players.length ?? 0;
  const rotatedPlayers = gameState ? rotateArray(gameState.players, mySeatIndex) : [];
  // Remap server indices to rotated visual indices
  const rotatedActiveIndex = n > 0 ? (gameState!.activePlayerIndex - mySeatIndex + n + n) % n : -1;
  const rotatedButtonIndex = n > 0 ? (gameState!.buttonIndex - mySeatIndex + n + n) % n : -1;

  return (
    <div className="flex flex-col h-screen bg-slate-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-white">Room {roomState.code}</h1>
          {gameState && (
            <span className="text-xs text-emerald-400 font-medium">
              {VARIANT_LABELS[gameState.variant] || gameState.variant}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 items-center">
          <span className="text-xs text-slate-500">
            {roomState.players.length} players
          </span>
          <button onClick={() => { socketActions.leaveRoom(); navigate('/'); }}
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

                {/* Community cards */}
                {gameState.communityCards.length > 0 && (
                  <div className="flex gap-1 mb-2">
                    {gameState.communityCards.map((card, i) => (
                      <CardDisplay key={i} card={card} />
                    ))}
                  </div>
                )}

                {/* Pot or Win display */}
                {showdown && winInfo.length > 0 ? (
                  <WinDisplay winInfo={winInfo} variant={gameState.variant} />
                ) : (
                  <PotDisplay collectedAmount={collectedPot} totalAmount={potTotal} />
                )}
              </>
            )}

            {/* DC picker */}
            {socketState.dcChoosing && (
              <div className="flex flex-col items-center gap-3 bg-slate-900/80 border border-amber-500/40 rounded-lg p-5 max-w-sm pointer-events-auto">
                <h2 className="text-sm font-bold text-amber-400">Your Pick — Choose the Game</h2>
                <div className="grid grid-cols-2 gap-1.5 w-full">
                  {Object.values(GameVariant).map((v) => (
                    <button key={v} onClick={() => handleDcPick(v)}
                      className="py-2 px-3 rounded text-xs font-medium bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white transition-colors"
                    >{VARIANT_LABELS[v]}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Waiting for DC pick (non-chooser sees this) */}
            {!gameState && !socketState.dcChoosing && (
              <p className="text-sm text-slate-400">Waiting for host to choose the game...</p>
            )}
          </div>

          {/* Player seats — using rotated array so "you" is always at bottom */}
          {gameState && rotatedPlayers.map((player, i) => (
            <PlayerSeat
              key={player.id}
              player={player}
              isActive={i === rotatedActiveIndex && !showdown}
              isDealer={i === rotatedButtonIndex}
              isHuman={player.id === myId}
              showCards={showdown && !player.folded}
              position={positions[i]}
              isTop={positions[i][1] < 50}
              onCardClick={toggleDiscard}
              selectedDiscardIndices={selectedDiscardIndices}
              isDrawing={isDrawPhase && player.id === myId}
              dealtCardCount={player.holeCards.length}
            />
          ))}

          {/* Bet chips — using rotated player order */}
          {gameState && !showdown && rotatedPlayers.map((player, i) =>
            player.bet > 0 ? (
              <BetChip key={`bet-${player.id}`} amount={player.bet} position={betPositions[i]} />
            ) : null
          )}

          {/* Win chips — find rotated index for positioning */}
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
        ) : showdown ? (
          <div className="flex flex-col items-center gap-2">
            {socketState.countdown !== null && socketState.countdown > 0 && (
              <span className="text-sm font-mono text-slate-400">
                Next hand in <span className="text-white font-bold">{socketState.countdown}</span>…
              </span>
            )}
            {socketState.isHost ? (
              <button onClick={() => socketActions.startHand()}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-sm transition-all active:scale-95"
              >
                Deal Next Hand
              </button>
            ) : (
              <span className="text-xs text-slate-500">Waiting for host to deal…</span>
            )}
          </div>
        ) : gameState ? (
          <div className="text-center text-slate-600 text-xs py-2">
            Waiting for {rotatedPlayers[rotatedActiveIndex]?.name ?? '...'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
