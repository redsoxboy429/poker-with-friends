// ============================================================
// LobbyPage — Create Room / Join Room / Local Practice
// ============================================================

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from './useSocket';
import { GameMode, GameVariant } from './engine-wrapper';
import type { RoomSettings } from '../../server/src/types';
import {
  GAME_MODE_LABELS,
  GAME_MODE_DESC,
  GAME_MODES,
  VARIANT_LABELS,
  GAME_CATEGORIES,
  LIMIT_VARIANTS,
} from './constants';

// Persist name in localStorage
const STORED_NAME_KEY = 'poker-player-name';

export default function LobbyPage() {
  const navigate = useNavigate();
  const [socketState, socketActions] = useSocket();

  // Tab state
  const [tab, setTab] = useState<'create' | 'join'>('create');

  // Create room form
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(STORED_NAME_KEY) || '');
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.DealersChoice);
  const [smallBlind, setSmallBlind] = useState(0.25);
  const [bigBlind, setBigBlind] = useState(0.5);
  // Limit game fields
  const [smallBet, setSmallBet] = useState(1);
  const [bigBet, setBigBet] = useState(2);

  // Variant selection (for Specific Game mode)
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<number | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<GameVariant>(GameVariant.NLH);

  // Join room form
  const [joinName, setJoinName] = useState(() => localStorage.getItem(STORED_NAME_KEY) || '');
  const [roomCode, setRoomCode] = useState('');
  // Connect socket on mount
  useEffect(() => {
    socketActions.connect();
  }, [socketActions.connect]);

  // Navigate to room once created/joined
  useEffect(() => {
    if (socketState.roomState) {
      navigate(`/room/${socketState.roomState.code}`);
    }
  }, [socketState.roomState, navigate]);

  // Save name to localStorage
  const saveName = (name: string, setter: (v: string) => void) => {
    setter(name);
    localStorage.setItem(STORED_NAME_KEY, name);
  };

  const isLimitGame = gameMode === GameMode.SpecificGame && LIMIT_VARIANTS.has(selectedVariant);
  // For mixed modes with limit games, always show limit fields
  const showLimitFields = isLimitGame || gameMode === GameMode.Horse || gameMode === GameMode.EightGame || gameMode === GameMode.NineGame || gameMode === GameMode.DealersChoice;

  const handleCreate = () => {
    if (!playerName.trim()) return;
    const settings: RoomSettings = {
      gameMode,
      variant: gameMode === GameMode.SpecificGame ? selectedVariant : undefined,
      smallBlind,
      bigBlind,
      startingChips: 100 * bigBlind, // Default (players choose their own at the table)
      ...(showLimitFields ? { smallBet, bigBet } : {}),
    };
    socketActions.createRoom(playerName.trim(), settings);
  };

  const handleJoin = () => {
    if (!joinName.trim() || !roomCode.trim()) return;
    socketActions.joinRoom(joinName.trim(), roomCode.trim());
  };

  const inputClass = "w-full px-3 py-2 rounded-lg bg-slate-800 text-white text-sm border border-slate-600 focus:border-emerald-400 focus:outline-none";

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold text-white mb-2">Mixed Game Poker</h1>
      <p className="text-slate-400 text-sm mb-8">Play money only — for friends</p>

      {/* Connection status */}
      <div className="flex items-center gap-2 mb-6">
        <div className={`w-2 h-2 rounded-full ${
          socketState.status === 'connected' ? 'bg-emerald-400' :
          socketState.status === 'connecting' ? 'bg-amber-400 animate-pulse' :
          'bg-red-400'
        }`} />
        <span className="text-xs text-slate-500 capitalize">{socketState.status}</span>
      </div>

      {socketState.error && (
        <div className="mb-4 px-4 py-2 bg-red-900/50 border border-red-500/40 rounded-lg text-red-300 text-sm">
          {socketState.error}
        </div>
      )}

      <div className="w-full max-w-md">
        {/* Tabs */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setTab('create')}
            className={`flex-1 py-2 rounded-t-lg text-sm font-semibold transition-colors ${
              tab === 'create'
                ? 'bg-slate-800 text-emerald-400 border-b-2 border-emerald-400'
                : 'bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}
          >Create Room</button>
          <button
            onClick={() => setTab('join')}
            className={`flex-1 py-2 rounded-t-lg text-sm font-semibold transition-colors ${
              tab === 'join'
                ? 'bg-slate-800 text-emerald-400 border-b-2 border-emerald-400'
                : 'bg-slate-900 text-slate-500 hover:text-slate-300'
            }`}
          >Join Room</button>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          {tab === 'create' ? (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Your Name</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => saveName(e.target.value, setPlayerName)}
                  placeholder="Enter your name"
                  className={inputClass}
                  maxLength={20}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Game Mode</label>
                <div className="flex flex-wrap gap-1">
                  {GAME_MODES.map((m) => (
                    <button key={m} onClick={() => { setGameMode(m); setSelectedCategory(null); setSelectedStructure(null); }}
                      className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors min-w-[60px] ${
                        gameMode === m ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >{GAME_MODE_LABELS[m]}</button>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 text-center mt-1">{GAME_MODE_DESC[gameMode]}</div>
              </div>

              {/* Variant picker for Specific Game mode */}
              {gameMode === GameMode.SpecificGame && (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">Game</label>

                  {/* Step 1: Category */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {GAME_CATEGORIES.map((cat, ci) => (
                      <button key={cat.name}
                        onClick={() => {
                          setSelectedCategory(ci);
                          setSelectedStructure(null);
                          // Auto-select if only one structure
                          if (cat.structures.length === 1) {
                            setSelectedStructure(0);
                            // Select first variant by default
                            setSelectedVariant(cat.structures[0].variants[0]);
                          }
                        }}
                        className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors min-w-[60px] ${
                          selectedCategory === ci ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >{cat.name}</button>
                    ))}
                  </div>

                  {/* Step 2: Structure (if category has multiple) */}
                  {selectedCategory !== null && GAME_CATEGORIES[selectedCategory].structures.length > 1 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {GAME_CATEGORIES[selectedCategory].structures.map((s, si) => (
                        <button key={s.name}
                          onClick={() => {
                            setSelectedStructure(si);
                            // Select first variant by default
                            setSelectedVariant(s.variants[0]);
                          }}
                          className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                            selectedStructure === si ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                          }`}
                        >{s.name}</button>
                      ))}
                    </div>
                  )}

                  {/* Step 3: Variant (if structure has multiple) */}
                  {selectedCategory !== null && selectedStructure !== null && (
                    <div className="flex flex-wrap gap-1">
                      {GAME_CATEGORIES[selectedCategory].structures[selectedStructure].variants.map((v) => (
                        <button key={v}
                          onClick={() => setSelectedVariant(v)}
                          className={`py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                            selectedVariant === v ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                          }`}
                        >{VARIANT_LABELS[v]}</button>
                      ))}
                    </div>
                  )}

                  {/* Show selected variant */}
                  {selectedVariant && (
                    <div className="text-[11px] text-emerald-400 text-center mt-1 font-medium">
                      {VARIANT_LABELS[selectedVariant]}
                    </div>
                  )}
                </div>
              )}

              {/* Stakes */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] text-slate-400">Small Blind</label>
                  <input type="number" value={smallBlind} onChange={(e) => setSmallBlind(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-slate-400">Big Blind</label>
                  <input type="number" value={bigBlind} onChange={(e) => setBigBlind(Number(e.target.value) || 0)} step="0.25" className={inputClass} />
                </div>
              </div>

              {/* Limit game bet sizes */}
              {showLimitFields && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[11px] text-slate-400">Small Bet (limit)</label>
                    <input type="number" value={smallBet} onChange={(e) => setSmallBet(Number(e.target.value) || 0)} step="0.5" className={inputClass} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-slate-400">Big Bet (limit)</label>
                    <input type="number" value={bigBet} onChange={(e) => setBigBet(Number(e.target.value) || 0)} step="0.5" className={inputClass} />
                  </div>
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={!playerName.trim() || socketState.status !== 'connected'}
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold text-sm transition-colors active:scale-95"
              >
                Create Room
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Your Name</label>
                <input
                  type="text"
                  value={joinName}
                  onChange={(e) => saveName(e.target.value, setJoinName)}
                  placeholder="Enter your name"
                  className={inputClass}
                  maxLength={20}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Room Code</label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="ABCD"
                  className={`${inputClass} text-center text-2xl tracking-widest font-mono`}
                  maxLength={4}
                />
              </div>
              <button
                onClick={handleJoin}
                disabled={!joinName.trim() || roomCode.length !== 4 || socketState.status !== 'connected'}
                className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold text-sm transition-colors active:scale-95"
              >
                Join Room
              </button>
            </div>
          )}
        </div>

        {/* Local Practice button */}
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/practice')}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm font-semibold transition-colors border border-slate-600"
          >
            Local Practice (with bots)
          </button>
        </div>
      </div>
    </div>
  );
}
