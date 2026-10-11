import { NextResponse } from 'next/server';
import { normBox } from '@/lib/box';
import { extractJson, friendly, generateText, type GPart } from '@/lib/gemini';
export const runtime = 'nodejs';

const img = (u: string): GPart => { const [h, d] = u.split(','); return { inlineData: { mimeType: h.slice(5, h.indexOf(';')), data: d } }; };
const BOX = '"box": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} or null (normalised, top-left origin)';

export async function GET(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  const base = { gemini: !!key, elevenlabs: !!process.env.ELEVENLABS_API_KEY };
  if (!new URL(req.url).searchParams.has('check')) return NextResponse.json(base);
  if (!key) return NextResponse.json({ ok: false, error: 'No GEMINI_API_KEY found in .env.local' });
  try { await generateText(key, [{ text: 'Reply with the single word OK.' }], 256); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ ok: false, error: friendly(e instanceof Error ? e.message : String(e)) }); }
}

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'no_key' }, { status: 501 });
  try {
    const b = await req.json();
    const parts: GPart[] = [];
    if (b.mode === 'face') {
      parts.push({ text: `Reference photos of known people follow, then a live frame. Report a match only if confident (>=0.75). Reply with JSON only: {"matchId": string|null, "confidence": number, "faceVisible": boolean, ${BOX}}.` });
      for (const c of b.contacts) parts.push({ text: `Reference id=${c.id} name=${c.name} (${c.relationship}):` }, img(c.photoDataUrl));
      parts.push({ text: 'Live frame:' }, img(b.frame));
      const j = extractJson(await generateText(key, parts));
      return NextResponse.json({ contactId: (j.matchId as string | null) ?? null, confidence: Number(j.confidence) || 0, faceVisible: !!j.faceVisible, box: normBox(j.box) });
    }
    parts.push({ text: `You are a gentle assistant for a person with dementia. They hold an object up to the camera and ask: "${b.question}". Focus on the single object being held up or closest to the camera and ignore the person and background. Identify it as specifically as you can, including brand or type (for example 'Pringles chip can', 'wireless headphones', 'scientific calculator', 'water bottle'). Their known items: ${JSON.stringify(b.items)}. If it matches a known item, reuse that item's id; otherwise matchedItemId is null and locationTip says briefly where such things usually go in a home. Speak in 1-2 short, warm, plain sentences. Never give medication dosage or tell them to take pills; say to check with their caregiver. Always give your best guess, never refuse. Reply with JSON only: {"name": string, "description": string, "locationTip": string, "matchedItemId": string|null, "confidence": number, ${BOX}}.` }, img(b.frame));
    const j = extractJson(await generateText(key, parts));
    return NextResponse.json({ name: String(j.name ?? 'Unknown'), description: String(j.description ?? ''), locationTip: String(j.locationTip ?? ''), itemId: (j.matchedItemId as string | null) ?? null, confidence: Number(j.confidence) || 0, box: normBox(j.box) });
  } catch (e) {
    return NextResponse.json({ error: friendly(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
