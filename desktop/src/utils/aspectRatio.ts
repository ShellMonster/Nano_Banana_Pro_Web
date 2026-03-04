const PRESET_RATIOS: Array<{ label: string; value: number }> = [
  { label: '1:1', value: 1 / 1 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '9:16', value: 9 / 16 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 }
];

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function simplifyRatio(w: number, h: number): [number, number] {
  const d = gcd(w, h);
  return [Math.round(w / d), Math.round(h / d)];
}

function approximateRatio(value: number, maxDenominator = 32): [number, number] {
  let bestNum = 1;
  let bestDen = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let den = 1; den <= maxDenominator; den += 1) {
    const num = Math.max(1, Math.round(value * den));
    const error = Math.abs(num / den - value);
    if (error < bestError) {
      bestError = error;
      bestNum = num;
      bestDen = den;
    }
  }

  return simplifyRatio(bestNum, bestDen);
}

export function formatAspectRatioLabel(width: number, height: number): string {
  if (!width || !height || width <= 0 || height <= 0) return '1:1';

  const ratio = width / height;
  const preset = PRESET_RATIOS.reduce<{ label: string; diff: number } | null>((best, item) => {
    const diff = Math.abs(item.value - ratio);
    if (!best || diff < best.diff) {
      return { label: item.label, diff };
    }
    return best;
  }, null);

  // 优先贴近常见比例，避免 3792x2544 显示为 79:53 这类不友好比例
  if (preset && preset.diff <= 0.02) {
    return preset.label;
  }

  const [num, den] = approximateRatio(ratio, 32);
  return `${num}:${den}`;
}

