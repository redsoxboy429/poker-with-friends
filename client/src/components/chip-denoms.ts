// Chip denominations and stack decomposition (non-component helpers)

export const CHIP_DENOM = [
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
