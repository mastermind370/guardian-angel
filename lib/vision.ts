'use client';
import type { Caps, Contact, NormBox, ObjectResult, RemittanceItem } from '@/types';

const CDN = 'https://cdn.jsdelivr.net/npm';
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = () => res();
      s.onerror = () => { scripts.delete(src); rej(new Error(`could not download ${src.split('/').pop()} (check internet)`)); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

export async function getCaps(): Promise<Caps> {
  try {
    const c = (await (await fetch('/api/vision')).json()) as Caps;
    if (!c.gemini) return c;
    const k = (await (await fetch('/api/vision?check=1')).json()) as { ok: boolean; error?: string };
    return k.ok ? c : { ...c, gemini: false, geminiError: k.error ?? 'unknown error' };
  } catch { return { gemini: false, elevenlabs: false }; }
}

/** Tiny local thumbnail "embedding" (used for items you photograph) plus average colour. */
export function describe(c: HTMLCanvasElement, b: NormBox = { x: 0.25, y: 0.15, w: 0.5, h: 0.7 }) {
  const o = document.createElement('canvas'); o.width = o.height = 8;
  const g = o.getContext('2d')!;
  g.drawImage(c, b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; const v: number[] = []; let r = 0, gr = 0, bl = 0;
  for (let i = 0; i < d.length; i += 4) { v.push(d[i], d[i + 1], d[i + 2]); r += d[i]; gr += d[i + 1]; bl += d[i + 2]; }
  const m = v.reduce((a, x) => a + x, 0) / v.length; const z = v.map((x) => x - m); const n = Math.hypot(...z) || 1;
  const hex = [r, gr, bl].map((x) => Math.round(x / 64).toString(16).padStart(2, '0')).join('');
  return { descriptor: z.map((x) => Math.round((x / n) * 1000) / 1000), color: `#${hex}` };
}
const sim = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export function fileToJpeg(file: File, max = 480): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => rej(new Error('bad image')); img.src = url;
  });
}

// ---------- face-api (loaded from jsDelivr; it also provides the single TensorFlow.js copy) ----------
interface FADet { detection: { box: { x: number; y: number; width: number; height: number } }; descriptor: Float32Array }
interface FANet { loadFromUri(u: string): Promise<void> }
interface FA {
  tf?: { ready?: () => Promise<void> };
  nets: { tinyFaceDetector: FANet; faceLandmark68Net: FANet; faceRecognitionNet: FANet };
  TinyFaceDetectorOptions: new (o?: { inputSize?: number; scoreThreshold?: number }) => object;
  detectAllFaces(i: CanvasImageSource, o: object): Promise<{ box: { x: number; y: number; width: number; height: number } }[]> & { withFaceLandmarks(): { withFaceDescriptors(): Promise<FADet[]> } };
}
let faP: Promise<FA> | null = null;
const loadFA = (): Promise<FA> => (faP ??= (async () => {
  await loadScript(`${CDN}/@vladmandic/face-api@1.7.13/dist/face-api.js`);
  const f = (window as unknown as { faceapi?: FA }).faceapi;
  if (!f) throw new Error('face-api did not start');
  await f.tf?.ready?.();
  await Promise.all([f.nets.tinyFaceDetector, f.nets.faceLandmark68Net, f.nets.faceRecognitionNet].map((n) => n.loadFromUri(`${CDN}/@vladmandic/face-api@1.7.13/model`)));
  return f;
})().catch((e) => { faP = null; throw e; }));

/** Resolves to null when face recognition is ready, or to a short error message. */
export const preloadFaces = (): Promise<string | null> => loadFA().then(() => null, (e: Error) => e.message || 'unknown error');

export interface FaceHit { contactId: string | null; distance: number; box: NormBox; embedding: number[] }
const MATCH_DIST = 0.55; // face-api: same person is usually < 0.5, different people > 0.6
const eu = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - (b[i] ?? 0)));

/** Fast detection only (no identity): used every few frames to follow faces on screen. */
export async function detectBoxes(c: HTMLCanvasElement): Promise<NormBox[] | null> {
  try {
    const fa = await loadFA();
    const d = await fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }));
    return d.map((x) => ({ x: x.box.x / c.width, y: x.box.y / c.height, w: x.box.width / c.width, h: x.box.height / c.height }));
  } catch { return null; }
}

export async function embedFaces(c: HTMLCanvasElement): Promise<{ box: NormBox; embedding: number[] }[] | null> {
  try {
    const fa = await loadFA();
    const dets = await fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 })).withFaceLandmarks().withFaceDescriptors();
    return dets.map((d) => ({ box: { x: d.detection.box.x / c.width, y: d.detection.box.y / c.height, w: d.detection.box.width / c.width, h: d.detection.box.height / c.height }, embedding: Array.from(d.descriptor, (v) => Math.round(v * 1e4) / 1e4) }));
  } catch { return null; }
}
export async function detectFaces(c: HTMLCanvasElement): Promise<NormBox[] | null> { const f = await embedFaces(c); return f ? f.map((x) => x.box) : null; }

/** Matches every face in the frame against every saved person. Null = face recognition unavailable. */
export async function recognizeFaces(c: HTMLCanvasElement, contacts: Contact[]): Promise<FaceHit[] | null> {
  const faces = await embedFaces(c);
  if (!faces) return null;
  return faces.map((f) => {
    let best: Contact | null = null, bd = 9;
    for (const k of contacts) { if (!k.embedding) continue; const d = eu(f.embedding, k.embedding); if (d < bd) { bd = d; best = k; } }
    return { contactId: best && bd < MATCH_DIST ? best.id : null, distance: bd, box: f.box, embedding: f.embedding };
  });
}

export function embeddingFromDataUrl(url: string): Promise<number[] | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0);
      const f = (await embedFaces(c))?.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      res(f?.embedding ?? null);
    };
    img.onerror = () => res(null); img.src = url;
  });
}

export function descriptorFromDataUrl(url: string, face: boolean): Promise<{ descriptor: number[]; color: string }> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d')!.drawImage(img, 0, 0);
      res(describe(c, face ? (await detectFaces(c))?.[0] : undefined));
    };
    img.onerror = () => rej(new Error('bad image')); img.src = url;
  });
}

/** Crops a face that is NOT already a saved contact (so only new people get offered). */
export async function faceCrop(c: HTMLCanvasElement, contacts: Contact[] = []): Promise<{ photo: string; descriptor: number[]; embedding?: number[] } | null> {
  const hits = await recognizeFaces(c, contacts);
  if (!hits) return null;
  const fresh = hits.filter((h) => !h.contactId).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  if (!fresh) return null;
  const box = fresh.box, pad = 0.25, x = Math.max(0, box.x - box.w * pad), y = Math.max(0, box.y - box.h * pad);
  const w = Math.min(1 - x, box.w * (1 + 2 * pad)), h = Math.min(1 - y, box.h * (1 + 2 * pad));
  const o = document.createElement('canvas'); o.width = 240; o.height = 240;
  o.getContext('2d')!.drawImage(c, x * c.width, y * c.height, w * c.width, h * c.height, 0, 0, 240, 240);
  return { photo: o.toDataURL('image/jpeg', 0.8), descriptor: describe(c, box).descriptor, embedding: fresh.embedding };
}

// ---------- object recognition ----------
async function post<T>(body: object): Promise<T> {
  const r = await fetch('/api/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(String(j.error ?? r.status).slice(0, 240)); }
  return r.json();
}

interface OD { detect(i: CanvasImageSource): Promise<{ bbox: number[]; class: string; score: number }[]> }
interface MN { classify(i: CanvasImageSource, topk?: number): Promise<{ className: string; probability: number }[]> }
let odP: Promise<OD> | null = null, mnP: Promise<MN> | null = null;
// coco-ssd and mobilenet reuse the TensorFlow.js that face-api already loaded (a second copy would conflict).
const useSharedTf = async () => { const fa = await loadFA(); (window as unknown as { tf?: unknown }).tf = (fa as unknown as { tf: unknown }).tf; };
const loadOD = (): Promise<OD> => (odP ??= (async () => {
  await useSharedTf(); await loadScript(`${CDN}/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js`);
  return (window as unknown as { cocoSsd: { load(o?: object): Promise<OD> } }).cocoSsd.load({ base: 'lite_mobilenet_v2' });
})().catch((e) => { odP = null; throw e; }));
const loadMN = (): Promise<MN> => (mnP ??= (async () => {
  await useSharedTf(); await loadScript(`${CDN}/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js`);
  return (window as unknown as { mobilenet: { load(o?: object): Promise<MN> } }).mobilenet.load({ version: 2, alpha: 1.0 });
})().catch((e) => { mnP = null; throw e; }));
export const preloadObjects = () => Promise.allSettled([loadOD(), loadMN()]);

function cropTo(frame: HTMLCanvasElement, b: NormBox): HTMLCanvasElement {
  const o = document.createElement('canvas'); o.width = o.height = 224;
  o.getContext('2d')!.drawImage(frame, b.x * frame.width, b.y * frame.height, b.w * frame.width, b.h * frame.height, 0, 0, 224, 224);
  return o;
}

export async function identifyObject(frame: HTMLCanvasElement, question: string, items: RemittanceItem[], caps: Caps): Promise<ObjectResult> {
  let note: string | undefined;
  if (caps.gemini) {
    try {
      return { ...(await post<Omit<ObjectResult, 'source'>>({ mode: 'object', question, frame: frame.toDataURL('image/jpeg', 0.7), items: items.map(({ id, name, description, locationTip }) => ({ id, name, description, locationTip })) })), source: 'gemini' };
    } catch (e) { note = `Gemini problem: ${(e as Error).message}`; }
  } else note = caps.geminiError ? `Gemini problem: ${caps.geminiError}` : 'No Gemini key found. Add GEMINI_API_KEY to .env.local and restart the app.';
  // 1) items you photographed yourself
  const { descriptor } = describe(frame, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  let best: RemittanceItem | null = null, sc = 0;
  for (const it of items) { if (!it.descriptor) continue; const s = sim(descriptor, it.descriptor); if (s > sc) { sc = s; best = it; } }
  if (best && sc > 0.93) return { name: best.name, description: best.description, locationTip: best.locationTip, itemId: best.id, confidence: sc, box: null, source: 'local' };
  // 2) on-device: COCO-SSD finds a box, MobileNet (1000 classes) names several crops
  try {
    const dets = (await (await loadOD()).detect(frame).catch(() => [])).filter((d) => d.score > 0.3 && d.class !== 'person').sort((a, b) => b.score - a.score);
    const d = dets[0];
    const box: NormBox | null = d ? { x: d.bbox[0] / frame.width, y: d.bbox[1] / frame.height, w: d.bbox[2] / frame.width, h: d.bbox[3] / frame.height } : null;
    const crops = [cropTo(frame, { x: 0, y: 0, w: 1, h: 1 }), cropTo(frame, { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }), cropTo(frame, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 })];
    if (box) { const px = box.w * 0.1, py = box.h * 0.1, x = Math.max(0, box.x - px), y = Math.max(0, box.y - py); crops.unshift(cropTo(frame, { x, y, w: Math.min(1 - x, box.w + 2 * px), h: Math.min(1 - y, box.h + 2 * py) })); }
    const mn = await loadMN(); const scores = new Map<string, number>();
    for (const cv of crops) for (const r of await mn.classify(cv, 5)) { const n = r.className.split(',')[0].trim(); scores.set(n, Math.max(scores.get(n) ?? 0, r.probability)); }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked[0] && ranked[0][1] > 0.12) {
      const [name, p] = ranked[0], other = ranked[1]?.[0];
      return { name, description: p > 0.4 ? `This looks like a ${name}.` : `I think this might be a ${name}${other ? `, or maybe a ${other}` : ''}, but I am not sure.`, locationTip: '', itemId: null, confidence: p, box, source: 'local', note };
    }
    if (d) return { name: d.class, description: `This looks like a ${d.class}.`, locationTip: '', itemId: null, confidence: d.score, box, source: 'local', note };
  } catch (e) { note = `${note ?? ''} On-device recognition could not start: ${(e as Error).message}`.trim(); }
  return { name: 'Something new', description: `I could not recognise this. ${note ?? ''}`.trim(), locationTip: '', itemId: null, confidence: 0, box: null, source: 'mock', note };
}
