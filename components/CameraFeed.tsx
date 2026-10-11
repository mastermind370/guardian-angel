'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { detectBoxes, preloadFaces, preloadObjects, recognizeFaces } from '@/lib/vision';
import { iou, needsIdentity, updateTracks, type Track } from '@/lib/tracker';
import type { Caps, Contact, NormBox } from '@/types';

export interface ScanOutcome { contact: Contact | null; contacts: Contact[]; confidence: number; faceVisible: boolean; unknown: boolean; reliable: boolean; unavailable: boolean }
export interface CameraHandle { capture: (w?: number) => HTMLCanvasElement | null; scanOnce: () => Promise<ScanOutcome> }
interface Overlay { box: NormBox; label: string; color: string; until: number }
interface Props {
  enabled: boolean; contacts: Contact[]; caps: Caps;
  objectOverlay: { box: NormBox | null; label: string; at: number } | null;
  onRecognized: (c: Contact, confidence: number) => void; onUnknown?: () => void;
}
const CYAN = '#22d3ee', YELLOW = '#facc15';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Store = { current: HTMLCanvasElement | null };

export const CameraFeed = forwardRef<CameraHandle, Props>(function CameraFeed({ enabled, contacts, caps, objectOverlay, onRecognized, onUnknown }, ref) {
  const video = useRef<HTMLVideoElement>(null), view = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement | null>(null), small = useRef<HTMLCanvasElement | null>(null);
  const overlays = useRef<Overlay[]>([]), tracks = useRef<Track[]>([]), nextId = useRef(1), lastDraw = useRef(0), identifying = useRef(false), count = useRef(0);
  const [status, setStatus] = useState<'off' | 'live' | 'error'>('off');
  const [faceState, setFaceState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [faceCount, setFaceCount] = useState(0), [faceErr, setFaceErr] = useState('');
  const latest = useRef({ contacts, caps, onRecognized, onUnknown });
  latest.current = { contacts, caps, onRecognized, onUnknown };

  const grab = (w: number, store: Store) => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const c = store.current ?? (store.current = document.createElement('canvas'));
    const W = Math.min(w, v.videoWidth);
    c.width = W; c.height = Math.round((W * v.videoHeight) / v.videoWidth);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c;
  };
  const capture = (w = 640) => grab(w, big);

  const refresh = (dets: NormBox[]) => {
    const now = Date.now();
    tracks.current = updateTracks(tracks.current, dets, now, () => nextId.current++);
    const nameOf = (t: Track) => latest.current.contacts.find((x) => x.id === t.contactId)?.name;
    overlays.current = [...overlays.current.filter((o) => o.color !== CYAN), ...tracks.current.map((t) => ({ box: t.box, label: nameOf(t) ?? (t.identified ? 'Unknown person' : 'Recognizing…'), color: CYAN, until: now + 500 }))];
    if (count.current !== tracks.current.length) { count.current = tracks.current.length; setFaceCount(count.current); }
  };

  // Slow step (face embedding), only for faces that need it.
  const identify = async (force: boolean) => {
    if (identifying.current) return;
    const now = Date.now();
    const need = tracks.current.filter((t) => needsIdentity(t, now, force));
    if (!need.length) return;
    identifying.current = true;
    need.forEach((t) => { t.tried = now; });
    try {
      const c = grab(640, big);
      const hits = c ? await recognizeFaces(c, latest.current.contacts) : null;
      if (!hits) return;
      for (const t of need) {
        let best: (typeof hits)[number] | null = null, bi = 0.15;
        for (const h of hits) { const v = iou(t.box, h.box); if (v > bi) { bi = v; best = h; } }
        if (best) { t.contactId = best.contactId; t.identified = true; t.at = Date.now(); }
      }
    } finally { identifying.current = false; }
  };

  const announce = () => {
    const { contacts: list, onRecognized: cb, onUnknown: unknownCb } = latest.current;
    for (const t of tracks.current) {
      if (!t.identified) continue;
      const k = list.find((x) => x.id === t.contactId);
      if (k && t.announced !== k.id) { t.announced = k.id; cb(k, 0.9); }
      else if (!k && !t.prompted) { t.prompted = true; unknownCb?.(); }
    }
  };

  const scanOnce = async (): Promise<ScanOutcome> => {
    const none: ScanOutcome = { contact: null, contacts: [], confidence: 0, faceVisible: false, unknown: false, reliable: true, unavailable: false };
    const c = grab(320, small);
    if (!c) return none;
    const dets = await detectBoxes(c);
    if (!dets) return { ...none, unavailable: true };
    refresh(dets);
    while (identifying.current) await sleep(80);
    await identify(true);
    const list = latest.current.contacts;
    const known = tracks.current.map((t) => list.find((x) => x.id === t.contactId)).filter((x): x is Contact => !!x);
    return { ...none, contact: known[0] ?? null, contacts: known, confidence: known[0] ? 0.9 : 0, faceVisible: tracks.current.length > 0, unknown: tracks.current.some((t) => t.identified && !t.contactId) };
  };
  useImperativeHandle(ref, () => ({ capture, scanOnce }));

  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stream: MediaStream | null = null, raf = 0, dead = false;
    const draw = (ts = 0) => {
      raf = requestAnimationFrame(draw);
      if (ts - lastDraw.current < 30) return; // ~30 fps keeps the page smooth while the AI runs
      lastDraw.current = ts;
      const v = video.current, c = view.current;
      if (!v || !c || !v.videoWidth) return;
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      const g = c.getContext('2d')!; g.drawImage(v, 0, 0);
      const now = Date.now(); overlays.current = overlays.current.filter((o) => o.until > now);
      g.lineWidth = 5; g.font = 'bold 30px sans-serif';
      for (const o of overlays.current) {
        const x = o.box.x * c.width, y = o.box.y * c.height;
        g.strokeStyle = o.color; g.strokeRect(x, y, o.box.w * c.width, o.box.h * c.height);
        const tw = g.measureText(o.label).width + 20;
        g.fillStyle = o.color; g.fillRect(x, Math.max(0, y - 44), tw, 44);
        g.fillStyle = '#020617'; g.fillText(o.label, x + 10, Math.max(32, y - 12));
      }
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then((s) => {
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s; const v = video.current!; v.srcObject = s;
        return v.play().then(() => { setStatus('live'); draw(); });
      })
      .catch(() => setStatus('error'));
    return () => { dead = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); setStatus('off'); };
  }, [enabled]);

  // Ambient loop: fast face detection every ~150 ms, tracking between frames, identity only when needed.
  useEffect(() => {
    if (status !== 'live' || faceState !== 'ready') return;
    let stop = false, timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      if (!document.hidden) {
        try {
          const c = grab(320, small);
          const dets = c ? await detectBoxes(c) : null;
          if (dets) { refresh(dets); await identify(false); announce(); }
        } catch { /* try again next tick */ }
      }
      timer = setTimeout(loop, 120);
    };
    void loop();
    return () => { stop = true; clearTimeout(timer); tracks.current = []; overlays.current = overlays.current.filter((o) => o.color !== CYAN); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, faceState]);

  useEffect(() => {
    if (status !== 'live') return;
    preloadFaces().then((err) => { setFaceErr(err ?? ''); setFaceState(err ? 'failed' : 'ready'); if (!err && !latest.current.caps.gemini) void preloadObjects(); });
  }, [status]);

  useEffect(() => {
    if (!objectOverlay) return;
    overlays.current = [...overlays.current.filter((o) => o.color !== YELLOW), { box: objectOverlay.box ?? { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, label: objectOverlay.label, color: YELLOW, until: Date.now() + 6000 }];
  }, [objectOverlay]);

  return (
    <div className="relative overflow-hidden rounded-3xl border-4 border-cyan-300 bg-black">
      <video ref={video} playsInline muted className="absolute h-px w-px opacity-0" />
      <canvas ref={view} className="aspect-video w-full object-cover" aria-label="Live camera view" />
      <div className="absolute left-3 top-3 rounded-full bg-black/70 px-4 py-1 text-xl font-bold text-cyan-300">{faceState === 'ready' ? `Face recognition ready · ${faceCount} face${faceCount === 1 ? '' : 's'} in view` : faceState === 'failed' ? `Face recognition failed: ${faceErr}` : 'Loading face recognition…'}</div>
      {status !== 'live' && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900 p-6 text-center text-3xl font-bold text-slate-200">
          {status === 'error' ? 'Camera is blocked. Please allow camera access.' : 'Starting camera…'}
        </div>
      )}
    </div>
  );
});
