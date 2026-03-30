// ============================================================
// GameLog — slide-out panel
// ============================================================

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
        className="absolute top-3 right-3 z-30 w-8 h-8 rounded-full bg-slate-800/80 border border-slate-600/50 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center text-xs transition-colors"
        title="Toggle log"
      >
        {visible ? '\u2715' : '\u2630'}
      </button>
      {visible && (
        <div className="absolute top-12 right-3 z-30 w-72 max-h-64 overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 text-[11px] font-mono text-slate-500 space-y-0.5 shadow-xl">
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
