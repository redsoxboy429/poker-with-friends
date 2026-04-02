// ============================================================
// GameLog — slide-out panel with toggle button
// ============================================================
// Button positioned at top-right of the table area with high
// z-index and large touch target for mobile.

import { useRef, useEffect } from 'react';

export function GameLog({
  entries,
  visible,
  onToggle,
}: {
  entries: string[];
  visible: boolean;
  onToggle: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <>
      <button
        onClick={onToggle}
        className="absolute top-2 right-2 z-[40] w-10 h-10 rounded-full bg-slate-800/90 border border-slate-600/60 text-slate-300 hover:text-white hover:bg-slate-700 flex items-center justify-center text-base transition-colors shadow-lg"
        style={{ pointerEvents: 'auto' }}
        title="Toggle game log"
      >
        {visible ? '\u2715' : '\u2630'}
      </button>
      {visible && (
        <div
          className="absolute top-14 right-2 z-[40] w-72 max-h-64 overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 text-[11px] font-mono text-slate-500 space-y-0.5 shadow-xl"
          style={{ pointerEvents: 'auto' }}
        >
          {entries.map((e, i) => (
            <div key={i} className={e.startsWith('---') ? 'text-slate-400 font-semibold' : ''}>
              {e}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
    </>
  );
}
