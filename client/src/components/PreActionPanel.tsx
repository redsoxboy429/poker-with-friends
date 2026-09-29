// ============================================================
// PreActionPanel — choose an action before your turn (checkbox-style toggles)
// ============================================================

export function PreActionPanel<K extends string>({
  choices,
  selected,
  onSelect,
}: {
  choices: { kind: K; label: string }[];
  selected: K | null;
  onSelect: (kind: K | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 justify-center">
      {choices.map(c => {
        const on = c.kind === selected;
        return (
          <button key={c.kind} onClick={() => onSelect(on ? null : c.kind)} aria-pressed={on}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all active:scale-95 ${on
              ? 'bg-amber-500 border-amber-300 text-black shadow-md'
              : 'bg-slate-800/80 border-slate-600 text-slate-200 hover:bg-slate-700'}`}>
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center text-[10px] leading-none ${on ? 'bg-black border-black text-amber-300' : 'border-slate-400'}`}>
              {on ? '✓' : ''}
            </span>
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
