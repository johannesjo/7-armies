/** Graphics quality for the 3D renderer (kept apart so the menu doesn't pull in three.js). */
export type QualitySetting = 'auto' | 'high' | 'low';
export type Quality = 'high' | 'low';

const KEY = 'charge.quality';

export function readQuality(): QualitySetting {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high' || v === 'low' || v === 'auto') return v;
  } catch { /* storage unavailable */ }
  return 'auto';
}

export function writeQuality(q: QualitySetting): void {
  try { localStorage.setItem(KEY, q); } catch { /* storage unavailable */ }
}

/** Auto picks Low on phones and tablets (touch screens, small screens), High elsewhere. */
export function resolveQuality(q: QualitySetting = readQuality()): Quality {
  if (q !== 'auto') return q;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 700;
  return coarse || small ? 'low' : 'high';
}
