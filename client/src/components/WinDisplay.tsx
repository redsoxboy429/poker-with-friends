// ============================================================
// WinDisplay — handles split-pot 2-column layout
// ============================================================

import { GameVariant } from '../engine-wrapper';

export type WinEntry = {
  playerId: string;
  name: string;
  amount: number;
  handDescription?: string;
  side?: string;
  potLabel?: string;
};

function consolidateEntries(entries: WinEntry[]): WinEntry[] {
  const map = new Map<string, WinEntry>();
  for (const e of entries) {
    const key = `${e.playerId}-${e.side ?? 'none'}-${e.potLabel ?? 'single'}`;
    const prev = map.get(key);
    if (prev) {
      prev.amount = Math.round((prev.amount + e.amount) * 100) / 100;
    } else {
      map.set(key, { ...e });
    }
  }
  return [...map.values()];
}

function SplitColumn({ label, entries, borderColor, labelColor, textColor, descColor, suffix }: {
  label: string; entries: WinEntry[]; borderColor: string; labelColor: string;
  textColor: string; descColor: string; suffix: string;
}) {
  const consolidated = consolidateEntries(entries);
  return (
    <div className={`flex flex-col items-center gap-1 bg-black/60 border ${borderColor} rounded-lg px-3 py-2 min-w-[120px]`}>
      <span className={`text-[10px] uppercase tracking-wider ${labelColor} font-semibold`}>{label}</span>
      {consolidated.map((w, idx) => (
        <div key={`${w.playerId}-${w.side ?? 'none'}-${w.potLabel ?? 'single'}-${idx}`} className="flex flex-col items-center">
          {w.potLabel && (
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide">{w.potLabel}</span>
          )}
          <span className={`text-xs font-bold ${textColor}`}>{w.name} {w.amount}</span>
          {w.handDescription && (
            <span className={`text-[10px] ${descColor}`}>{w.handDescription.replace(suffix, '')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function SimpleWinDisplay({ winInfo, totalPot }: { winInfo: WinEntry[]; totalPot?: number }) {
  const potGroups = new Map<string, WinEntry[]>();
  for (const w of winInfo) {
    const key = w.potLabel ?? '';
    if (!potGroups.has(key)) potGroups.set(key, []);
    potGroups.get(key)!.push(w);
  }
  const groups = [...potGroups.entries()];

  return (
    <div className="flex flex-col items-center gap-1.5">
      {totalPot !== undefined && (
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
      )}
      {groups.map(([label, entries]) => (
        <div key={label || 'main'} className="flex flex-col items-center gap-1">
          {label && (
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</span>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {entries.map((w, idx) => (
              <div
                key={`${w.playerId}-${idx}`}
                className="flex flex-col items-center bg-black/60 border border-emerald-400/40 rounded-lg px-3 py-1.5"
              >
                <span className="text-xs font-bold text-emerald-300">
                  {w.name} {w.name === 'You' ? 'win' : 'wins'} {w.amount}
                </span>
                {w.handDescription && (
                  <span className="text-[10px] text-emerald-400/70 font-medium">{w.handDescription}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WinDisplay({ winInfo, variant }: { winInfo: WinEntry[]; variant?: string }) {
  const totalPot = Math.round(winInfo.reduce((sum, w) => sum + w.amount, 0) * 100) / 100;

  const hasDrawmahaSides = winInfo.some(w => w.side === 'draw' || w.side === 'omaha');
  const hasHiLoSides = winInfo.some(w => w.side === 'high' || w.side === 'low');
  const hasScoopOnly = winInfo.every(w => !w.side || w.side === 'scoop');

  const isBadugiSplit = variant && [
    GameVariant.Badeucy, GameVariant.Badacey,
    GameVariant.PLBadeucyDD, GameVariant.PLBadaceyDD,
  ].includes(variant as GameVariant);
  const highLabel = isBadugiSplit ? 'Badugi' : 'High';

  if (hasScoopOnly) {
    return <SimpleWinDisplay winInfo={consolidateEntries(winInfo)} totalPot={totalPot} />;
  }

  if (hasDrawmahaSides) {
    const drawEntries = winInfo.filter(w => w.side === 'draw');
    const omahaEntries = winInfo.filter(w => w.side === 'omaha');
    const scoopEntries = winInfo.filter(w => w.side === 'scoop');
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
        <div className="flex items-start gap-3 justify-center">
          <SplitColumn label="Draw" entries={drawEntries}
            borderColor="border-blue-400/40" labelColor="text-blue-300/80"
            textColor="text-blue-200" descColor="text-blue-300/60" suffix=" (draw)" />
          <SplitColumn label="Omaha" entries={omahaEntries}
            borderColor="border-amber-400/40" labelColor="text-amber-300/80"
            textColor="text-amber-200" descColor="text-amber-300/60" suffix=" (omaha)" />
        </div>
        {scoopEntries.length > 0 && <SimpleWinDisplay winInfo={consolidateEntries(scoopEntries)} />}
      </div>
    );
  }

  if (hasHiLoSides) {
    const highEntries = winInfo.filter(w => w.side === 'high');
    const lowEntries = winInfo.filter(w => w.side === 'low');
    const scoopEntries = winInfo.filter(w => w.side === 'scoop');
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-300">Pot: {totalPot}</span>
        <div className="flex items-start gap-3 justify-center">
          {highEntries.length > 0 && (
            <SplitColumn label={highLabel} entries={highEntries}
              borderColor="border-emerald-400/40" labelColor="text-emerald-300/80"
              textColor="text-emerald-200" descColor="text-emerald-300/60" suffix=" (high)" />
          )}
          {lowEntries.length > 0 && (
            <SplitColumn label="Low" entries={lowEntries}
              borderColor="border-purple-400/40" labelColor="text-purple-300/80"
              textColor="text-purple-200" descColor="text-purple-300/60" suffix=" (low)" />
          )}
        </div>
        {scoopEntries.length > 0 && <SimpleWinDisplay winInfo={consolidateEntries(scoopEntries)} />}
      </div>
    );
  }

  return <SimpleWinDisplay winInfo={consolidateEntries(winInfo)} totalPot={totalPot} />;
}
