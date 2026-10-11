import type { NormBox } from '@/types';

/** Accepts Gemini boxes as {x,y,w,h} or [ymin,xmin,ymax,xmax], in 0-1 or 0-1000 units, and returns a safe 0-1 box. */
export function normBox(b: unknown): NormBox | null {
  let x: number, y: number, w: number, h: number, big: number;
  if (Array.isArray(b) && b.length === 4) {
    const [y1, x1, y2, x2] = b.map(Number);
    big = Math.max(y1, x1, y2, x2); x = x1; y = y1; w = x2 - x1; h = y2 - y1;
  } else if (b && typeof b === 'object') {
    const o = b as Record<string, unknown>;
    [x, y, w, h] = [o.x, o.y, o.w, o.h].map(Number);
    big = Math.max(x + w, y + h);
  } else return null;
  if ([x, y, w, h].some((v) => !Number.isFinite(v))) return null;
  const k = big > 1.5 ? 1000 : 1;
  x /= k; y /= k; w /= k; h /= k;
  x = Math.min(Math.max(x, 0), 0.95); y = Math.min(Math.max(y, 0), 0.95);
  w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
  return w > 0.03 && h > 0.03 ? { x, y, w, h } : null;
}
