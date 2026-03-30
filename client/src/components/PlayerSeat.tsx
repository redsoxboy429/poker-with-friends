// ============================================================
// PlayerSeat — positioned around the table
// ============================================================

import type { PlayerState } from '@engine/types.ts';
import { CardDisplay } from './Cards';
import { ACTION_STYLES } from '../constants';

export function PlayerSeat({
  player,
  isActive,
  isDealer,
  isHuman,
  showCards,
  position,
  isTop,
  lastAction,
  lastDrawAction,
  dealtCardCount = 99,
  onCardClick,
  selectedDiscardIndices,
  isDrawing,
  chipsBehind,
  forceAllDown,
  handDescription,
}: {
  player: PlayerState;
  isActive: boolean;
  isDealer: boolean;
  isHuman: boolean;
  showCards: boolean;
  position: [number, number];
  isTop: boolean;
  lastAction?: string;
  lastDrawAction?: string;
  dealtCardCount?: number;
  onCardClick?: (idx: number) => void;
  selectedDiscardIndices?: Set<number>;
  isDrawing?: boolean;
  chipsBehind?: number;
  forceAllDown?: boolean;
  handDescription?: string;
}) {
  const hasVisibility = player.cardVisibility && player.cardVisibility.length > 0;
  const hideCards = player.folded || player.holeCards.length === 0;

  const cards = hideCards
    ? null
    : player.holeCards.map((card, i) => {
        const isDealtYet = i < dealtCardCount;
        let faceDown = false;
        if (forceAllDown) {
          faceDown = !isHuman;
        } else if (isHuman || showCards) {
          faceDown = false;
        } else if (hasVisibility) {
          faceDown = player.cardVisibility![i] === 'down';
        } else {
          faceDown = true;
        }
        const isUpCard = !forceAllDown && hasVisibility && player.cardVisibility![i] === 'up';
        const isSelected = isDrawing && selectedDiscardIndices?.has(i);
        return (
          <div
            key={i}
            className={`transition-all duration-200 ${isDrawing && isHuman ? 'cursor-pointer' : ''}`}
            onClick={() => isDrawing && isHuman && onCardClick?.(i)}
            style={{
              opacity: isDealtYet ? 1 : 0,
              transform: isDealtYet
                ? `scale(1)${isUpCard ? ' translateY(-6px)' : ''}${isSelected ? ' translateY(-12px)' : ''}`
                : 'scale(0.7)',
              outline: isSelected ? '2px solid #f59e0b' : 'none',
              outlineOffset: '2px',
              borderRadius: '6px',
            }}
          >
            <CardDisplay card={card} faceDown={faceDown} />
          </div>
        );
      });

  const nameChips = (
    <div
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full transition-all ${
        isActive
          ? 'bg-yellow-500/90 text-black shadow-lg shadow-yellow-500/30'
          : player.folded
            ? 'bg-slate-800/60 text-slate-600'
            : isHuman
              ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/30'
              : 'bg-slate-800/80 text-slate-200 border border-slate-600/30'
      }`}
    >
      {isDealer && (
        <span className="w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold flex items-center justify-center flex-shrink-0">
          D
        </span>
      )}
      <span className="text-xs font-semibold truncate max-w-[60px]">
        {player.name}
      </span>
      <span className="text-[10px] font-mono opacity-70">
        {player.chips}
        {chipsBehind && chipsBehind > 0 ? (
          <span className="text-slate-500 ml-0.5">({player.chips + chipsBehind})</span>
        ) : null}
      </span>
    </div>
  );

  const handBadge = handDescription && !player.folded ? (
    <span className="text-[10px] font-semibold text-amber-300 bg-black/60 px-2 py-0.5 rounded max-w-[280px] text-center whitespace-nowrap overflow-hidden text-ellipsis">
      {handDescription}
    </span>
  ) : null;

  const actionStyle = lastAction ? ACTION_STYLES[lastAction] : null;

  const drawBadge = lastDrawAction ? (
    <span className="text-[10px] font-bold text-cyan-400">
      {lastDrawAction.toUpperCase()}
    </span>
  ) : null;

  const statusBadge = player.folded ? (
    <span className="text-[10px] text-red-400 font-semibold">FOLD</span>
  ) : player.allIn ? (
    <div className="flex items-center gap-1.5">
      {drawBadge}
      <span className="text-[10px] text-amber-400 font-bold animate-pulse">ALL IN</span>
    </div>
  ) : actionStyle ? (
    <div className="flex items-center gap-1.5">
      {drawBadge}
      <span className={`text-[10px] font-bold ${actionStyle.color}`}>{actionStyle.text}</span>
    </div>
  ) : drawBadge ? drawBadge : null;

  return (
    <div
      className="absolute flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2 z-10"
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
    >
      {isTop ? (
        <>
          {nameChips}
          {statusBadge}
          {cards && <div className="flex gap-0.5">{cards}</div>}
          {handBadge}
        </>
      ) : (
        <>
          {handBadge}
          {cards && <div className="flex gap-0.5">{cards}</div>}
          {statusBadge}
          {nameChips}
        </>
      )}
    </div>
  );
}
