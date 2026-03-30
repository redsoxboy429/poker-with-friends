// ============================================================
// Card Components — CardFace, CardBack, CardDisplay
// ============================================================

import { type Card, RANK_NAMES, SUIT_SYMBOLS } from '@engine/types.ts';

export const CARD_W = 58;
export const CARD_H = 82;

export function CardFace({ card }: { card: Card }) {
  const isRed = card.suit === 'h' || card.suit === 'd';
  const rankStr = RANK_NAMES[card.rank];
  const suitStr = SUIT_SYMBOLS[card.suit];
  const color = isRed ? '#dc2626' : '#1a1a2e';

  return (
    <div
      className="relative rounded-md shadow-lg select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f8f8 100%)',
        border: '1px solid #d1d5db',
      }}
    >
      <div className="absolute top-0.5 left-1.5 leading-none" style={{ color }}>
        <div className="text-[13px] font-bold">{rankStr}</div>
        <div className="text-[12px] -mt-0.5">{suitStr}</div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center" style={{ color }}>
        <span className="text-2xl">{suitStr}</span>
      </div>
      <div className="absolute bottom-0.5 right-1.5 leading-none rotate-180" style={{ color }}>
        <div className="text-[13px] font-bold">{rankStr}</div>
        <div className="text-[12px] -mt-0.5">{suitStr}</div>
      </div>
    </div>
  );
}

export function CardBack() {
  return (
    <div
      className="relative rounded-md shadow-lg overflow-hidden select-none"
      style={{
        width: CARD_W,
        height: CARD_H,
        background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2744 100%)',
        border: '1px solid #2d4a6f',
      }}
    >
      <div className="absolute inset-1 rounded-sm opacity-20"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 4px,
            rgba(255,255,255,0.3) 4px,
            rgba(255,255,255,0.3) 5px
          ), repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            rgba(255,255,255,0.3) 4px,
            rgba(255,255,255,0.3) 5px
          )`,
        }}
      />
      <div className="absolute inset-1.5 rounded-sm border border-blue-400/20" />
    </div>
  );
}

export function CardDisplay({ card, faceDown = false }: { card?: Card | null; faceDown?: boolean }) {
  if (!card || faceDown) return <CardBack />;
  return <CardFace card={card} />;
}
