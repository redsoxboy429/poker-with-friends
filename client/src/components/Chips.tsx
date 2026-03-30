// ============================================================
// Chip Components — CasinoChip, BetChip, PotDisplay
// ============================================================

const CHIP_DENOM = [
  { value: 100, bg: 'from-gray-800 to-black', border: 'border-gray-500/60', edge: 'bg-gray-600' },
  { value: 25, bg: 'from-green-500 to-green-700', border: 'border-green-300/60', edge: 'bg-green-400' },
  { value: 5, bg: 'from-red-500 to-red-700', border: 'border-red-300/60', edge: 'bg-red-400' },
  { value: 1, bg: 'from-gray-100 to-gray-300', border: 'border-gray-400/60', edge: 'bg-white' },
  { value: 0.5, bg: 'from-pink-400 to-pink-600', border: 'border-pink-300/60', edge: 'bg-pink-300' },
  { value: 0.25, bg: 'from-blue-400 to-blue-600', border: 'border-blue-300/60', edge: 'bg-blue-300' },
] as const;

export function decomposeChips(amount: number): Array<{ value: number; count: number }> {
  const result: Array<{ value: number; count: number }> = [];
  let remaining = amount;
  for (const denom of CHIP_DENOM) {
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      result.push({ value: denom.value, count });
      remaining -= count * denom.value;
    }
  }
  return result;
}

export function CasinoChip({ value, size = 20 }: { value: number; size?: number }) {
  const denom = CHIP_DENOM.find(d => d.value === value) || CHIP_DENOM[CHIP_DENOM.length - 1];
  return (
    <div
      className={`rounded-full bg-gradient-to-br ${denom.bg} border-2 ${denom.border} flex items-center justify-center relative overflow-hidden`}
      style={{ width: size, height: size }}
    >
      <div className={`absolute top-[2px] left-1/2 -translate-x-1/2 w-[60%] h-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute bottom-[2px] left-1/2 -translate-x-1/2 w-[60%] h-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute left-[2px] top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-full ${denom.edge} opacity-60`} />
      <div className={`absolute right-[2px] top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-full ${denom.edge} opacity-60`} />
    </div>
  );
}

export function BetChip({ amount, position }: { amount: number; position: [number, number] }) {
  if (amount <= 0) return null;
  const chipGroups = decomposeChips(amount);
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
    >
      <div className="flex items-center gap-1">
        <div className="flex items-center" style={{ gap: '-2px' }}>
          {chipGroups.slice(0, 4).map((group, gi) => (
            <div key={gi} style={{ marginLeft: gi > 0 ? -4 : 0 }}>
              <CasinoChip value={group.value} size={16} />
            </div>
          ))}
        </div>
        <span className="text-[11px] font-mono font-bold text-amber-400 whitespace-nowrap">
          {amount}
        </span>
      </div>
    </div>
  );
}

function PotChipStack({ amount, label }: { amount: number; label?: string }) {
  if (amount <= 0) return null;
  const chipGroups = decomposeChips(amount);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="flex items-end gap-1">
        {chipGroups.map((group, gi) => (
          <div key={gi} className="flex flex-col-reverse items-center">
            {Array.from({ length: Math.min(group.count, 4) }, (_, i) => (
              <div key={i} style={{ marginTop: i > 0 ? -14 : 0 }}>
                <CasinoChip value={group.value} size={label ? 16 : 22} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className={`font-mono font-bold text-amber-300 bg-black/50 rounded-full px-2 py-0.5 ${label ? 'text-[10px]' : 'text-sm'}`}>
        {label && <span className="text-amber-400/70 mr-1">{label}:</span>}
        {amount}
      </span>
    </div>
  );
}

export function PotDisplay({ collectedAmount, totalAmount, pots }: {
  collectedAmount: number;
  totalAmount?: number;
  pots?: Array<{ amount: number; eligiblePlayerIds: string[] }>;
}) {
  if (collectedAmount <= 0 && !totalAmount) return null;
  const showTotal = totalAmount && totalAmount > collectedAmount;
  const hasSidePots = pots && pots.length > 1;

  return (
    <div className="flex flex-col items-center gap-1">
      {hasSidePots ? (
        <div className="flex items-end gap-3">
          {pots.map((pot, i) => (
            <PotChipStack
              key={i}
              amount={pot.amount}
              label={i === 0 ? 'Main' : pots.length === 2 ? 'Side' : `Side ${i}`}
            />
          ))}
        </div>
      ) : (
        <PotChipStack amount={collectedAmount} />
      )}
      {showTotal && (
        <span className="text-xs font-mono text-amber-400/70 bg-black/50 rounded-full px-2">
          Total: {totalAmount}
        </span>
      )}
    </div>
  );
}
