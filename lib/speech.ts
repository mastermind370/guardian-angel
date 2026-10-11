'use client';

let speaking = false, lastEnd = 0, gen = 0, current: HTMLAudioElement | null = null;
export const isSpeaking = () => speaking || Date.now() - lastEnd < 700;

export function stopSpeaking() {
  if (typeof window === 'undefined') return;
  window.speechSynthesis?.cancel();
  current?.pause(); current = null;
}

async function playEleven(text: string, voiceId?: string, whisper?: boolean): Promise<boolean> {
  try {
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voiceId }) });
    if (!r.ok) return false;
    const url = URL.createObjectURL(await r.blob());
    const a = new Audio(url); a.volume = whisper ? 0.6 : 1; current = a;
    await new Promise<void>((res, rej) => { a.onended = () => res(); a.onerror = () => rej(new Error('audio')); a.play().catch(rej); });
    URL.revokeObjectURL(url);
    return true;
  } catch { return false; }
}

function browserSpeak(text: string, whisper: boolean): Promise<void> {
  return new Promise((res) => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!s) return res();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.88; u.pitch = 1.05; u.volume = whisper ? 0.6 : 1;
    const v = s.getVoices().find((x) => /^en/i.test(x.lang) && /female|samantha|zira|aria|jenny|google uk english female/i.test(x.name));
    if (v) u.voice = v;
    u.onend = () => res(); u.onerror = () => res();
    s.speak(u);
  });
}

/** Speaks with ElevenLabs when available (useEleven), otherwise the native Web Speech voice. */
export async function speak(text: string, o: { voiceId?: string; whisper?: boolean; useEleven?: boolean } = {}): Promise<void> {
  stopSpeaking();
  const my = ++gen; speaking = true;
  try {
    if (o.useEleven && (await playEleven(text, o.voiceId, o.whisper))) return;
    if (my === gen) await browserSpeak(text, !!o.whisper);
  } finally {
    if (my === gen) { speaking = false; lastEnd = Date.now(); }
  }
}

export async function detectEarphones(): Promise<boolean> {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.some((x) => x.kind === 'audiooutput' && /bluetooth|airpods|buds|headphone|headset|earphone|earbud/i.test(x.label));
  } catch { return false; }
}

interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: { length: number; [i: number]: RecResult } }
interface Rec {
  continuous: boolean; interimResults: boolean; lang: string; start(): void; abort(): void;
  onstart: (() => void) | null; onspeechstart: (() => void) | null; onspeechend: (() => void) | null;
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
}
type RecCtor = new () => Rec;
export type ListenState = 'idle' | 'listening' | 'hearing' | 'denied' | 'unsupported';

/** Continuous keyword listener. speechstart/speechend double as voice-activity detection. */
export class KeywordListener {
  private rec: Rec | null = null; private want = false;
  constructor(private onText: (t: string, final: boolean) => void, private onState: (s: ListenState) => void) {}
  start() {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) return this.onState('unsupported');
    this.want = true;
    const r = new C(); r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onstart = () => this.onState('listening');
    r.onspeechstart = () => this.onState('hearing');
    r.onspeechend = () => this.onState('listening');
    r.onresult = (e) => {
      if (isSpeaking()) return; // ignore our own voice
      for (let i = e.resultIndex; i < e.results.length; i++) this.onText(e.results[i][0].transcript.trim(), e.results[i].isFinal);
    };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.want = false; this.onState('denied'); } };
    r.onend = () => { if (this.want) setTimeout(() => { try { r.start(); } catch { /* already started */ } }, 400); };
    this.rec = r;
    try { r.start(); } catch { /* ignore */ }
  }
  stop() { this.want = false; this.rec?.abort(); this.onState('idle'); }
}

export type Intent = 'distress' | 'item' | 'people' | 'meds' | 'nav' | 'items' | 'saveplace' | 'additem' | null;
const DISTRESS = [/where am i/, /i want to go home/, /who are you/, /i('m| am) (scared|lost)/];
export function classify(text: string): { intent: Intent; trigger?: string; arg?: string } {
  const s = text.toLowerCase().replace(/[?.!,]/g, '').trim();
  if (DISTRESS.some((r) => r.test(s)) || /^(please )?help( me)?( help)?$/.test(s)) return { intent: 'distress', trigger: text };
  if (/what('s| is) (this|that)|where does this go/.test(s)) return { intent: 'item' };
  if (/who('s| is) (here|there|that)/.test(s)) return { intent: 'people' };
  const sv = s.match(/^(?:please )?save (?:this|the|my current) (?:place|location|spot)(?: as| called| named)?\s*(.*)$/);
  if (sv) return { intent: 'saveplace', arg: sv[1] };
  if (/my items|my things|show (me )?(my )?(items|things)|what items/.test(s)) return { intent: 'items' };
  if (/^(please )?(add|save) (?:(?:a|an|new|a new|an new) )?(item|thing)s?$|add (more )?items?|remember this item/.test(s)) return { intent: 'additem' };
  if (/my places|saved places|saved locations|where can i go/.test(s)) return { intent: 'nav', arg: '' };
  const nav = s.match(/(?:take me|navigate|directions|bring me|how (?:do|can) i get)\s*(?:to\s+)?(.*)$/);
  if (nav) return { intent: 'nav', arg: nav[1] };
  if (/medic|pill|medicine/.test(s)) return { intent: 'meds' };
  return { intent: null };
}
