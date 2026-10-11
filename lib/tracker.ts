import type { NormBox } from '@/types';

/** A face being followed from frame to frame, so the slow "who is it?" step runs once per person, not once per frame. */
export interface Track { id: number; box: NormBox; contactId: string | null; identified: boolean; at: number; tried: number; seen: number; prompted: boolean; announced: string | null }

export const iou = (a: NormBox, b: NormBox) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i || 1);
};

export function updateTracks(tracks: Track[], dets: NormBox[], now: number, nextId: () => number): Track[] {
  const used = new Set<number>();
  for (const d of dets) {
    let best: Track | null = null, bi = 0.2;
    for (const t of tracks) { if (used.has(t.id)) continue; const v = iou(t.box, d); if (v > bi) { bi = v; best = t; } }
    if (best) {
      best.box = { x: best.box.x * 0.4 + d.x * 0.6, y: best.box.y * 0.4 + d.y * 0.6, w: best.box.w * 0.4 + d.w * 0.6, h: best.box.h * 0.4 + d.h * 0.6 };
      best.seen = now; used.add(best.id);
    } else {
      const t: Track = { id: nextId(), box: d, contactId: null, identified: false, at: 0, tried: 0, seen: now, prompted: false, announced: null };
      tracks.push(t); used.add(t.id);
    }
  }
  return tracks.filter((t) => now - t.seen < 1000);
}

/** New faces right away; known faces re-checked every 8 s; unknown faces every 3 s. */
export const needsIdentity = (t: Track, now: number, force = false) => force || (now - t.tried > 1200 && (!t.identified || now - t.at > (t.contactId ? 8000 : 3000)));
