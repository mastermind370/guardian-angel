import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: 'no_key' }, { status: 501 });
  const { text, voiceId } = (await req.json()) as { text: string; voiceId?: string };
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5', voice_settings: { stability: 0.6, similarity_boost: 0.85 } }),
  });
  if (!r.ok) return NextResponse.json({ error: 'tts_failed' }, { status: 502 });
  return new Response(await r.arrayBuffer(), { headers: { 'Content-Type': 'audio/mpeg' } });
}
