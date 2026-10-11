import type { Position } from '@/types';

/** Turns GPS coordinates into a human address using OpenStreetMap Nominatim (free, no key). */
export async function reverseGeocode(p: Position): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${p.latitude}&lon=${p.longitude}`);
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.hamlet || a.county;
    return [street || a.road || a.neighbourhood || a.suburb || a.amenity, city].filter(Boolean).join(', ') || j.display_name || null;
  } catch { return null; }
}
