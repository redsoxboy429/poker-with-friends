// ============================================================
// ActionPanel — betting controls at bottom of screen
// ============================================================

import { useState, useEffect } from 'react';
import {
  GamePhase,
  ActionType,
  BettingStructure,
  type AvailableActions,
} from '../engine-wrapper';

export function ActionPanel({
  actions,
  onAction,
  bettingStructure,
  phase,
  minChip,
}: {
  actions: AvailableActions;
  onAction: (type: ActionType, amount?: number) => void;
  bettingStructure: string;
  phase?: string;
  minChip: number;
}) {
  const betLabel = phase === GamePhase.BettingPreflop ? 'Raise' : 'Bet';
  const isPotLimit = bettingStructure === BettingStructure.PotLimit;
  const isNoLimit = bettingStructure === BettingStructure.NoLimit;
  const maxLabel = isPotLimit ? 'Pot' : isNoLimit ? 'All In' : null;
  const isFixedLimit = bettingStructure === 'fixed-limit';

  const isBetting = actions.canBet && !isFixedLimit && actions.minBet < actions.maxBet;
  const isRaising = actions.canRaise && !isFixedLimit && actions.minRaise < actions.maxRaise;
  const sizeMin = isBetting ? actions.minBet : (isRaising ? actions.minRaise : 0);
  const sizeMax = isBetting ? actions.maxBet : (isRaising ? actions.maxRaise : 0);

  const [raiseAmount, setRaiseAmount] = useState(sizeMin);
  const [inputText, setInputText] = useState(String(sizeMin));

  useEffect(() => {
    setRaiseAmount(sizeMin);
    setInputText(String(sizeMin));
  }, [sizeMin]);

  const handleSlider = (val: number) => {
    const snapped = Math.round(val / minChip) * minChip;
    const clean = Math.round(snapped * 100) / 100;
    setRaiseAmount(clean);
    setInputText(String(clean));
  };

  const handleInputChange = (raw: string) => {
    if (raw === '' || raw === '.') { setInputText(raw); return; }
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    const snapped = Math.round(num / minChip) * minChip;
    const clean = Math.round(Math.min(snapped, sizeMax) * 100) / 100;
    setRaiseAmount(Math.max(clean, sizeMin));
    setInputText(raw);
  };

  const handleInputBlur = () => {
    const num = parseFloat(inputText);
    const snapped = isNaN(num) ? sizeMin : Math.round(num / minChip) * minChip;
    const final = Math.round(Math.max(Math.min(snapped, sizeMax), sizeMin) * 100) / 100;
    setRaiseAmount(final);
    setInputText(String(final));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const btnBase = 'px-6 py-3 rounded-lg font-bold text-base transition-all active:scale-95 shadow-md text-center';

  const sizingControls = (min: number, max: number, accentClass: string) => (
    <>
      <input type="range" min={min} max={max} step={minChip} value={raiseAmount}
        onChange={(e) => handleSlider(Number(e.target.value))}
        className={`w-36 h-3 ${accentClass}`}
      />
      <input type="text" inputMode="numeric" value={inputText}
        onChange={(e) => handleInputChange(e.target.value)}
        onBlur={handleInputBlur} onKeyDown={handleKeyDown}
        className="w-20 px-3 py-2 rounded bg-slate-700 text-white text-base text-center font-semibold border border-slate-500 focus:border-blue-400 focus:outline-none"
      />
      {maxLabel && (
        <button onClick={() => handleSlider(max)}
          className="px-3 py-2 rounded-lg font-bold text-sm bg-amber-700 hover:bg-amber-600 text-white active:scale-95 transition-all"
        >{maxLabel}</button>
      )}
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 justify-center">
      {actions.canFold && (
        <button onClick={() => onAction(ActionType.Fold)}
          className={`${btnBase} bg-red-700 hover:bg-red-600 text-white shadow-red-900/30`}>Fold</button>
      )}
      {actions.canCheck && (
        <button onClick={() => onAction(ActionType.Check)}
          className={`${btnBase} bg-slate-600 hover:bg-slate-500 text-white`}>Check</button>
      )}
      {actions.canCall && (
        <button onClick={() => onAction(ActionType.Call)}
          className={`${btnBase} bg-green-700 hover:bg-green-600 text-white shadow-green-900/30`}>Call {actions.callAmount}</button>
      )}
      {actions.canBet && (
        <div className="flex items-center gap-2">
          <button onClick={() => onAction(ActionType.Bet, isFixedLimit ? actions.minBet : raiseAmount)}
            className={`${btnBase} bg-blue-700 hover:bg-blue-600 text-white shadow-blue-900/30 w-[140px]`}>
            {betLabel} {isFixedLimit ? actions.minBet : raiseAmount}
          </button>
          {isBetting && sizingControls(actions.minBet, actions.maxBet, 'accent-blue-500')}
        </div>
      )}
      {actions.canRaise && (
        <div className="flex items-center gap-2">
          <button onClick={() => onAction(ActionType.Raise, isFixedLimit ? actions.minRaise : raiseAmount)}
            className={`${btnBase} bg-purple-700 hover:bg-purple-600 text-white shadow-purple-900/30 w-[140px]`}>
            Raise {isFixedLimit ? actions.minRaise : raiseAmount}
          </button>
          {isRaising && sizingControls(actions.minRaise, actions.maxRaise, 'accent-purple-500')}
        </div>
      )}
    </div>
  );
}
