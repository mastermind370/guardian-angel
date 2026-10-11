import type { Grounding, Position, SafeZone } from '@/types';

export const distanceM = (a: Position, b: Position) => {
  const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
  const dl = r(b.latitude - a.latitude), dn = r(b.longitude - a.longitude);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const daypart = (d = new Date()) => { const h = d.getHours(); return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'; };
export const weekday = (d = new Date()) => d.toLocaleDateString('en-US', { weekday: 'long' });
export const fmt12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

export function buildGrounding(p: Position | null, zones: SafeZone[], caregiver: string, now = new Date(), place?: string): Grounding {
  const when = `It is ${weekday(now)} ${daypart(now)}.`;
  const acc = p?.accuracy ?? 0;
  const near = p && zones.length ? zones.map((z) => ({ z, d: distanceM(p, z) })).sort((a, b) => a.d - b.d)[0] : null;
  const inside = !!near && near.d <= near.z.radiusMeters && acc <= 150;
  return {
    headline: place ? `You are at ${place}.` : 'Looking for your address…',
    spoken: place ? `You are at ${place}. ${when}` : `I could not look up your street address right now. Please check the internet connection. ${when}`,
    zone: inside ? near!.z : null, inside,
  };
}
