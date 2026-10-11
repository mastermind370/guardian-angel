'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BookmarkPlus, Navigation, Ear, MapPin, Mic, Package, Pill, Settings, ShieldCheck, Sparkles, Users, Video, VideoOff } from 'lucide-react';
import { useGuardianStore } from '@/lib/store';
import { KeywordListener, classify, detectEarphones, speak, isSpeaking, stopSpeaking, type ListenState } from '@/lib/speech';
import { describe, embeddingFromDataUrl, faceCrop, getCaps, identifyObject } from '@/lib/vision';
import { reverseGeocode } from '@/lib/geo';
import { buildGrounding, daypart, distanceM, fmt12 } from '@/lib/grounding';
import { CameraFeed, type CameraHandle } from '@/components/CameraFeed';
import { AnchorCard } from '@/components/AnchorCard';
import { CaregiverModal } from '@/components/CaregiverModal';
import type { Appointment, Caps, Contact, NormBox, ObjectResult, Position, RemittanceItem, SafeZone } from '@/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whisperFor = (c: Contact) => `That's your ${c.relationship.toLowerCase()} ${c.name}. ${c.memoryNote}`.trim();
interface Reply { title: string; body: string; image?: string }

function Chip({ on, icon: I, text }: { on: boolean; icon: typeof Ear; text: string }) {
  return <span className={`flex items-center gap-2 rounded-full border-2 px-4 py-2 text-xl font-bold ${on ? 'border-cyan-300 text-cyan-300' : 'border-slate-600 text-slate-400'}`}><I className="h-6 w-6" />{text}</span>;
}
function Big({ icon: I, label, onClick, tone }: { icon: typeof Ear; label: string; onClick: () => void; tone: string }) {
  return <button onClick={onClick} className={`flex min-h-40 flex-col items-center justify-center gap-3 rounded-3xl border-4 p-6 text-4xl font-black transition active:scale-95 ${tone}`}><I className="h-14 w-14" />{label}</button>;
}

export default function Home() {
  const st = useGuardianStore();
  const { contacts, items, appointments, zones, settings, alerts, distress } = st;
  const [mounted, setMounted] = useState(false), [started, setStarted] = useState(false);
  const [caps, setCaps] = useState<Caps>({ gemini: false, elevenlabs: false });
  const [ear, setEar] = useState(false), [listen, setListen] = useState<ListenState>('idle');
  const [cameraOn, setCameraOn] = useState(false), [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'items' | 'meds' | 'people' | 'nav'>('none');
  const [reply, setReply] = useState<Reply | null>(null);
  const [position, setPosition] = useState<Position | null>(null), [place, setPlace] = useState<string | null>(null);
  const [newPerson, setNewPerson] = useState<{ photo: string; descriptor: number[]; embedding?: number[] } | null>(null), [np, setNp] = useState({ name: '', relationship: '', memoryNote: '' });
  const [lastObj, setLastObj] = useState<{ r: ObjectResult; photo: string; descriptor: number[]; color: string } | null>(null);
  const [pendingPlace, setPendingPlace] = useState<{ pos: Position; addr: string | null } | null>(null), [placeName, setPlaceName] = useState('');
  const unknownAt = useRef(0), lastGeo = useRef<Position | null>(null), triedEmb = useRef(new Set<string>());
  const [npStage, setNpStage] = useState<'ask' | 'form'>('ask'), [modalTab, setModalTab] = useState<'items' | undefined>(undefined);
  const [overlay, setOverlay] = useState<{ box: NormBox | null; label: string; at: number } | null>(null);
  const [caregiverOpen, setCaregiverOpen] = useState(false), [typed, setTyped] = useState(''), [now, setNow] = useState(new Date());
  const cam = useRef<CameraHandle>(null), listener = useRef<KeywordListener | null>(null);
  const itemAt = useRef(0), lastPanic = useRef(0), seen = useRef<Record<string, number>>({}), hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  const primary = useMemo(() => contacts.find((c) => !c.isCaregiver) ?? contacts[0] ?? null, [contacts]);
  const g = useMemo(() => buildGrounding(position, zones, settings.caregiverName, now, place ?? undefined), [position, zones, settings.caregiverName, now, place]);
  const say = useCallback((t: string, o: { voiceId?: string; whisper?: boolean } = {}) => speak(t, { ...o, useEleven: caps.elevenlabs }), [caps.elevenlabs]);
  const respond = (title: string, body: string, image?: string, o?: { voiceId?: string; whisper?: boolean }) => { setReply({ title, body, image }); return say(body, o); };

  // Location: demo mode pins the patient at home; gps mode watches the Geolocation API.
  useEffect(() => {
    if (!started) return;
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => setPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), () => setPosition(null), { enableHighAccuracy: true, maximumAge: 0 });
    return () => navigator.geolocation.clearWatch(id);
  }, [started]);

  // Samples GPS for up to 9 s and keeps the most accurate fix (never a cached one).
  const getPos = (maxMs = 9000) => new Promise<Position | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let best: Position | null = null, done = false;
    const finish = () => { if (done) return; done = true; navigator.geolocation.clearWatch(id); clearTimeout(t); resolve(best); };
    const id = navigator.geolocation.watchPosition((p) => {
      const c = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy };
      if (!best || c.accuracy < (best.accuracy ?? 1e9)) best = c;
      if (c.accuracy <= 40) finish();
    }, () => finish(), { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
    const t = setTimeout(finish, maxMs);
  });
  // Real address lookup whenever the GPS position moves more than ~60 m.
  useEffect(() => {
    if (!position) return;
    if (lastGeo.current && distanceM(lastGeo.current, position) < 60) return;
    lastGeo.current = position; reverseGeocode(position).then((p) => p && setPlace(p));
  }, [position]);

  const whereAmI = async () => {
    setReply({ title: 'Finding you…', body: 'One moment while I find where you are.' });
    const fresh = await getPos();
    if (!fresh) return respond('Location is off', 'I cannot see where you are. Please allow location access for this page in Chrome.');
    setPosition(fresh);
    const pl = (await reverseGeocode(fresh)) ?? place; if (pl) setPlace(pl);
    const gg = buildGrounding(fresh, zones, settings.caregiverName, new Date(), pl ?? undefined);
    return respond(gg.headline, gg.spoken);
  };

  const showItems = () => {
    setPanel('items');
    const n = items.map((i) => i.name);
    return respond('My items', n.length ? `You have ${n.length} saved item${n.length > 1 ? 's' : ''}: ${n.join(', ')}. Tap one to hear about it. To add more, say add item, or tap one of the add buttons.` : 'You have no saved items yet. Hold something up and ask what it is, then tap Remember this.');
  };
  const commitPlace = (nameIn: string, pos: Position, addr: string | null) => {
    let name = nameIn.trim();
    if (!name) return;
    name = name[0].toUpperCase() + name.slice(1);
    const home = /^(my )?home$/i.test(name);
    st.addZone({ name, spokenName: home ? 'home' : name, address: addr ?? '', city: '', latitude: pos.latitude, longitude: pos.longitude, radiusMeters: 100, isHome: home });
    setPendingPlace(null); setPlaceName('');
    return respond('Place saved', `I saved ${name}${addr ? `, at ${addr}` : ''}. Say take me somewhere any time to see your saved places.`);
  };
  // "Save this place": reads GPS now, then asks you to name it (type it, or say "call it ...").
  const savePlace = async (nameArg?: string) => {
    setReply({ title: 'Finding your location…', body: 'One moment.' });
    const pos = await getPos();
    if (!pos) return respond('Location is off', 'I could not read your location. Please allow location access.');
    if ((pos.accuracy ?? 0) > 250) return respond('Location not precise enough', `My location is only accurate to about ${Math.round(pos.accuracy ?? 0)} meters, so I cannot save this place safely. Try again near a window, or use a phone.`);
    const addr = await reverseGeocode(pos);
    if ((nameArg ?? '').trim()) return commitPlace(nameArg!, pos, addr);
    setPendingPlace({ pos, addr }); setPlaceName('');
    return respond('Name this place', `I found you${addr ? ` at ${addr}` : ''}. What should I call this place? Type a name, or say call it, and then the name.`);
  };
  const navigateTo = (z: SafeZone) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${z.latitude},${z.longitude}&travelmode=walking`;
    if (window.open(url, '_blank')) return say(`Okay. Opening directions to ${z.spokenName}.`);
    setPanel('nav'); // the browser blocked the pop-up, so show a button to tap instead
    return respond(`Directions to ${z.name}`, `Tap ${z.name} below to start the directions.`);
  };
  const showPlaces = () => {
    setPanel('nav');
    const n = zones.map((z) => z.name);
    return respond('Take me somewhere', n.length ? `You have ${n.length} saved place${n.length > 1 ? 's' : ''}: ${n.join(', ')}. Tap one for directions, or say take me to, and the name.` : 'You have no saved places yet. Go to a place you want to remember and say save this place.');
  };
  const goTo = (arg?: string) => {
    const q = (arg ?? '').toLowerCase().replace(/^(the|my)\s+/, '').trim();
    if (!q || /^(somewhere|anywhere|someplace|a place|somewhere else|somewhere new)$/.test(q)) return showPlaces();
    const z = zones.find((x) => x.isHome && q === 'home') ?? zones.find((x) => x.name.toLowerCase().includes(q) || q.includes(x.name.toLowerCase()) || q.includes(x.spokenName.toLowerCase()));
    if (!z) { setPanel('nav'); return respond('I could not find that place', `I do not have a place called ${q}. ${zones.length ? `Your saved places are ${zones.map((x) => x.name).join(', ')}.` : 'You have no saved places yet.'}`); }
    return navigateTo(z);
  };

  const ensureCamera = async () => { if (!cameraOn) { setCameraOn(true); await sleep(900); } };

  const whatIsThis = async (q = 'What is this?') => {
    setBusy(true); const wasOff = !cameraOn;
    setReply({ title: 'Looking…', body: 'Hold it up so I can see it.' });
    await ensureCamera();
    let c: HTMLCanvasElement | null = null;
    for (let i = 0; i < 12 && !c; i++) { c = cam.current?.capture(800) ?? null; if (!c) await sleep(300); }
    if (!c) { setBusy(false); return respond('Camera needed', 'I could not see the camera. Please allow camera access.'); }
    const r = await identifyObject(c, q, items, caps);
    const item = items.find((i) => i.id === r.itemId);
    setLastObj(item || r.name === 'Something new' ? null : { r, photo: c.toDataURL('image/jpeg', 0.7), ...describe(c, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }) });
    setOverlay({ box: r.box, label: r.name, at: Date.now() });
    setBusy(false);
    void wasOff;
    const body = `${r.description} ${r.locationTip}`.trim();
    const out = respond(r.name, body, item?.photoDataUrl);
    if (r.note) setReply({ title: r.name, body: `${body} (${r.note})`, image: item?.photoDataUrl });
    return out;
  };

  const whoIsHere = async () => {
    setBusy(true); say('Let me see who is here.', { whisper: true }); await ensureCamera();
    const o = (await cam.current?.scanOnce()) ?? { contact: null, contacts: [] as Contact[], faceVisible: false, confidence: 0, unknown: false, reliable: false, unavailable: false };
    setBusy(false);
    if (o.unavailable) return respond('Face recognition is not working', 'I could not load face recognition. Please check the internet connection and reload the page.');
    if (o.contacts.length) { o.contacts.forEach((c) => st.touchContact(c.id)); return respond(o.contacts.map((c) => c.name).join(' and '), o.contacts.map(whisperFor).join(' '), o.contacts[0].photoDataUrl, { whisper: true }); }
    if (o.faceVisible) { void offerNewPerson(true); return respond('Someone new', 'I can see someone I do not know yet. Would you like me to remember them?'); }
    return respond('No one yet', 'I do not see anyone right now. Look at the camera and try again.');
  };

  const medsToday = () => {
    const d = new Date(), hhmm = d.toTimeString().slice(0, 5);
    return appointments.filter((a) => a.enabled && (a.date ? a.date === d.toLocaleDateString('en-CA') : !a.days.length || a.days.includes(d.getDay()))).sort((a, b) => a.time.localeCompare(b.time)).map((a) => ({ a, past: a.time < hhmm }));
  };
  const meds = () => {
    setPanel('meds');
    const list = medsToday(), next = list.find((x) => !x.past);
    const body = !list.length ? 'Nothing is planned for today. Enjoy a quiet day.'
      : `Today: ${list.map(({ a }) => `${a.title} at ${fmt12(a.time)}`).join(', then ')}. ${next ? `Next is ${next.a.title} at ${fmt12(next.a.time)}.` : 'That is everything for today.'}`;
    return respond('My day', body);
  };

  const remind = (a: Appointment) => {
    const hello = `Good ${daypart() === 'night' ? 'day' : daypart()}, ${settings.patientName}.`;
    const body = a.kind === 'medication' ? `${hello} It is ${fmt12(a.time)}. Time for your ${a.title} medicine. ${a.note ?? ''}` : `${hello} Just a reminder: ${a.title} is at ${fmt12(a.time)}. ${a.note ?? ''}`;
    respond(a.title, body.trim(), primary?.photoDataUrl, { voiceId: primary?.voiceId });
  };

  const onRecognized = (c: Contact, force = false) => {
    if (useGuardianStore.getState().distress.active) return;
    if (!force && (isSpeaking() || Date.now() - (seen.current[c.id] ?? 0) < 120000)) return;
    seen.current[c.id] = Date.now(); st.touchContact(c.id);
    respond(c.name, whisperFor(c), c.photoDataUrl, { whisper: true });
  };

  const panic = (trigger: string) => {
    if (Date.now() - lastPanic.current < 45000 || useGuardianStore.getState().distress.active) return;
    lastPanic.current = Date.now();
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    st.triggerDistress(trigger, `${settings.patientName} said “${trigger}” at ${time}${g.zone ? ` near ${g.zone.name}` : place ? ` near ${place}` : ''}. Please call or check in.`);
    setCameraOn(false); setPanel('none');
    say(`Hi ${settings.patientName}, it's ${primary?.name ?? 'someone who loves you'}. You are safe. ${g.spoken} Nothing is wrong. I love you, and I'll see you very soon. Let's take a slow breath together.`, { voiceId: primary?.voiceId });
  };

  const emergency = () => {
    st.pushAlert('emergency', 'EMERGENCY button pressed', `${settings.patientName} asked for help right now.`);
    say(`I'm calling ${settings.caregiverName} now. Stay with me. Help is on the way.`);
    const phone = settings.caregiverPhone.trim();
    if (/^\+?[\d\s\-()]{7,}$/.test(phone) && /Mobi|Android|iPhone/i.test(navigator.userAgent)) window.location.href = `tel:${phone}`;
  };

  const offerNewPerson = async (manual = false) => {
    if (newPerson || (!manual && Date.now() - unknownAt.current < 90000)) return;
    unknownAt.current = Date.now();
    const c = cam.current?.capture(); const f = c ? await faceCrop(c, contacts) : null;
    if (!f) { if (manual) respond('No face found', 'I could not see a face. Look at the camera and try again.'); return; }
    setNewPerson(f); setNp({ name: '', relationship: '', memoryNote: '' }); setNpStage(manual ? 'form' : 'ask');
    if (!manual) say("I see someone I don't know. Would you like to save this person?", { whisper: true });
  };
  const saveNewPerson = () => {
    if (!newPerson || !np.name.trim()) return;
    st.addContact({ name: np.name.trim(), relationship: np.relationship.trim() || 'friend', memoryNote: np.memoryNote.trim(), photoDataUrl: newPerson.photo, descriptor: newPerson.descriptor, embedding: newPerson.embedding, isCaregiver: false });
    say(`Okay. I will remember ${np.name.trim()}.`); setNewPerson(null);
  };
  const saveDetected = () => {
    if (!lastObj) return;
    const { r, photo, descriptor, color } = lastObj;
    st.addItem({ name: r.name, description: r.description, locationTip: r.locationTip, photoDataUrl: photo, descriptor, dominantColor: color });
    setLastObj(null); say(`Saved. I will remember your ${r.name}.`);
  };

  const onText = (t: string, final: boolean) => {
    const { intent, trigger, arg } = classify(t);
    if (intent === 'distress') return panic(trigger ?? t);
    if (intent === 'item') { if (Date.now() - itemAt.current > 5000) { itemAt.current = Date.now(); void whatIsThis(t); } return; } // react to the first words, don't wait for the pause
    if (!final) return;
    if (pendingPlace) {
      const m = t.toLowerCase().match(/^(?:call it|name it|it'?s called|save it as|the name is|call this)\s+(.+)$/);
      if (m) { commitPlace(m[1], pendingPlace.pos, pendingPlace.addr); return; }
      if (/^(cancel|never mind)$/.test(t.toLowerCase().trim())) { setPendingPlace(null); return; }
    }
    if (newPerson && npStage === 'ask') {
      const y = t.toLowerCase();
      if (/^(yes|yeah|yep|sure|ok|okay|save)/.test(y)) { setNpStage('form'); say('Okay. Please type their name.'); return; }
      if (/^(no|nope|not now|cancel)/.test(y)) { setNewPerson(null); return; }
    }
    if (intent === 'people') void whoIsHere(); else if (intent === 'meds') void meds(); else if (intent === 'nav') goTo(arg); else if (intent === 'items') showItems(); else if (intent === 'saveplace') void savePlace(arg); else if (intent === 'additem') void whatIsThis('Add this item');
  };
  const handlers = useRef({ onText, remind, onRecognized, offerNewPerson });
  handlers.current = { onText, remind, onRecognized, offerNewPerson };

  const start = async () => {
    setStarted(true);
    const c = await getCaps(); setCaps(c);
    listener.current = new KeywordListener((t, f) => handlers.current.onText(t, f), setListen);
    listener.current.start();
    const check = async () => setEar(await detectEarphones());
    setTimeout(check, 2500); navigator.mediaDevices?.addEventListener?.('devicechange', check);
    speak(`Hello ${settings.patientName}. I'm here with you.`, { whisper: true, useEleven: c.elevenlabs });
  };
  useEffect(() => () => { listener.current?.stop(); stopSpeaking(); }, []);

  // Reminder engine: checks the schedule every 15 seconds and fires each reminder once per day.
  useEffect(() => {
    if (!started) return;
    const tick = () => {
      const d = new Date(), hhmm = d.toTimeString().slice(0, 5);
      for (const a of useGuardianStore.getState().appointments) {
        const key = `${a.id}-${d.toDateString()}`;
        if (!a.enabled || a.time !== hhmm || (a.date ? a.date !== d.toLocaleDateString('en-CA') : a.days.length > 0 && !a.days.includes(d.getDay())) || useGuardianStore.getState().fired[key]) continue;
        useGuardianStore.getState().markFired(key); handlers.current.remind(a);
      }
    };
    tick(); const t = setInterval(tick, 15000); return () => clearInterval(t);
  }, [started]);

  // People saved by earlier versions: build their face embedding from the saved photo.
  useEffect(() => {
    if (!started) return;
    contacts.filter((c) => !c.embedding && c.photoDataUrl.startsWith('data:image/jpeg') && !triedEmb.current.has(c.id)).forEach(async (c) => {
      triedEmb.current.add(c.id);
      const e = await embeddingFromDataUrl(c.photoDataUrl);
      if (e) st.setEmbedding(c.id, e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, contacts.length]);

  const holdStart = () => { hold.current = setTimeout(() => setCaregiverOpen(true), 800); };
  const holdEnd = () => { if (hold.current) clearTimeout(hold.current); };
  const showItem = (i: RemittanceItem) => respond(i.name, `${i.description} ${i.locationTip}`, i.photoDataUrl);

  if (!mounted) return <main className="grid min-h-screen place-items-center text-4xl text-yellow-300">GuardianAngel…</main>;
  if (!started) return (
    <main className="grid min-h-screen place-items-center p-8 text-center">
      <div>
        <ShieldCheck className="mx-auto h-28 w-28 text-cyan-300" />
        <h1 className="mt-6 text-6xl font-black text-yellow-300">GuardianAngel</h1>
        <p className="mt-4 text-3xl text-slate-200">Your gentle helper, always by your side.</p>
        <button onClick={start} className="mt-10 rounded-3xl bg-yellow-300 px-12 py-8 text-4xl font-black text-slate-950">Tap to wake me up</button>
        <p className="mt-6 text-xl text-slate-400">Put in your earbuds first. I will ask to use your microphone.</p>
      </div>
    </main>
  );

  const latest = alerts[0] && now.getTime() - alerts[0].createdAt < 180000 ? alerts[0] : null;
  const listenText = { idle: 'Mic off', listening: 'Listening', hearing: 'Hearing you…', denied: 'Mic blocked', unsupported: 'Voice not supported' }[listen];

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5 sm:p-8">
      <header className="flex flex-wrap items-center gap-3">
        <Chip on={ear} icon={Ear} text={ear ? 'Earphones connected' : 'Speaker (no earbuds)'} />
        <Chip on={g.inside} icon={ShieldCheck} text={g.inside ? 'Safe zone active' : position ? `Outside safe zones${position.accuracy ? ` (±${Math.round(position.accuracy)} m)` : ''}` : 'Location off'} />
        <Chip on={listen === 'listening' || listen === 'hearing'} icon={Mic} text={listenText} />
        <Chip on={caps.gemini} icon={Sparkles} text={caps.gemini ? 'Gemini Vision' : caps.geminiError ? `Gemini problem: ${caps.geminiError}` : 'Basic vision (add Gemini key)'} />
        <button onClick={() => { setModalTab(undefined); setCaregiverOpen(true); }} className="ml-auto flex items-center gap-2 rounded-full border-2 border-cyan-300 px-4 py-2 text-xl font-bold text-cyan-300"><Settings className="h-6 w-6" />Add / manage</button>
      </header>

      <section>
        <h1 className="text-6xl font-black leading-tight text-yellow-300">{daypart(now) === 'night' ? 'Hello' : `Good ${daypart(now)}`}, {settings.patientName}.</h1>
        <p className="mt-2 text-3xl text-cyan-300">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
      </section>

      <AnimatePresence>
        {latest && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-2xl border-2 border-cyan-300 bg-slate-900 p-4 text-xl"><b className="text-cyan-300">Caregiver alert sent (simulated): </b>{latest.title}. {latest.body}</motion.div>}
      </AnimatePresence>

      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Big icon={MapPin} label="Where Am I?" tone="border-yellow-300 text-yellow-300" onClick={() => void whereAmI()} />
        <Big icon={Package} label="My Items" tone="border-cyan-300 text-cyan-300" onClick={showItems} />
        <Big icon={Users} label="Who Is Here?" tone="border-cyan-300 text-cyan-300" onClick={() => void whoIsHere()} />
        <Big icon={Pill} label="Medications" tone="border-yellow-300 text-yellow-300" onClick={() => void meds()} />
        <Big icon={Navigation} label="Take Me Somewhere" tone="border-yellow-300 text-yellow-300" onClick={() => goTo()} />
        <Big icon={BookmarkPlus} label="Save This Place" tone="border-cyan-300 text-cyan-300" onClick={() => void savePlace()} />
      </section>

      {reply && (
        <motion.section key={reply.title + reply.body} initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-live="polite" className="flex items-center gap-6 rounded-3xl border-4 border-yellow-300 bg-slate-900 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {reply.image && <img src={reply.image} alt="" className="h-36 w-36 shrink-0 rounded-2xl object-cover" />}
          <div><h2 className="text-4xl font-black text-yellow-300">{reply.title}</h2><p className="mt-2 text-3xl leading-snug">{reply.body}</p></div>
        </motion.section>
      )}

      {newPerson && (
        <section className="space-y-3 rounded-3xl border-4 border-cyan-300 bg-slate-900 p-5">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={newPerson.photo} alt="Unknown person" className="h-28 w-28 rounded-2xl object-cover" />
            <div><h2 className="text-4xl font-black text-yellow-300">Unknown person</h2><p className="text-2xl text-cyan-300">{npStage === 'ask' ? 'Would you like to save this person?' : 'Tell me who they are.'}</p></div>
          </div>
          {npStage === 'ask' ? (
            <div className="flex gap-3">
              <button onClick={() => { setNpStage('form'); say('Okay. Please type their name.'); }} className="rounded-2xl bg-yellow-300 px-6 py-4 text-2xl font-black text-slate-950">Yes, save them</button>
              <button onClick={() => setNewPerson(null)} className="rounded-2xl border-2 border-slate-500 px-6 py-4 text-2xl font-bold">No thanks</button>
            </div>
          ) : (
            <>
              {(['name', 'relationship', 'memoryNote'] as const).map((k) => (
                <input key={k} value={np[k]} onChange={(e) => setNp({ ...np, [k]: e.target.value })} placeholder={{ name: 'Name', relationship: 'Who are they? (daughter, neighbour…)', memoryNote: 'Something to remember (optional)' }[k]} className="w-full rounded-xl border-2 border-slate-600 bg-slate-950 p-3 text-xl text-white" />
              ))}
              <div className="flex gap-3">
                <button disabled={!np.name.trim()} onClick={saveNewPerson} className="rounded-2xl bg-yellow-300 px-6 py-4 text-2xl font-black text-slate-950 disabled:opacity-40">Save person</button>
                <button onClick={() => setNewPerson(null)} className="rounded-2xl border-2 border-slate-500 px-6 py-4 text-2xl font-bold">Not now</button>
              </div>
            </>
          )}
        </section>
      )}
      {pendingPlace && (
        <section className="space-y-3 rounded-3xl border-4 border-yellow-300 bg-slate-900 p-5">
          <h2 className="text-3xl font-black text-yellow-300">Name this place</h2>
          <p className="text-2xl text-slate-200">{pendingPlace.addr ?? 'Your current location'}</p>
          <input autoFocus value={placeName} onChange={(e) => setPlaceName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commitPlace(placeName, pendingPlace.pos, pendingPlace.addr)} placeholder="Home, Sarah's house, Library…" className="w-full rounded-xl border-2 border-slate-600 bg-slate-950 p-4 text-2xl text-white" />
          <div className="flex gap-3">
            <button disabled={!placeName.trim()} onClick={() => commitPlace(placeName, pendingPlace.pos, pendingPlace.addr)} className="rounded-2xl bg-yellow-300 px-6 py-4 text-2xl font-black text-slate-950 disabled:opacity-40">Save place</button>
            <button onClick={() => setPendingPlace(null)} className="rounded-2xl border-2 border-slate-500 px-6 py-4 text-2xl font-bold">Cancel</button>
          </div>
          <p className="text-lg text-slate-400">You can also say “call it” followed by the name.</p>
        </section>
      )}
      {lastObj && <button onClick={saveDetected} className="w-full rounded-3xl border-4 border-cyan-300 p-5 text-3xl font-black text-cyan-300">Remember this: {lastObj.r.name}</button>}

      <section className="space-y-4">
        <button onClick={() => setCameraOn(!cameraOn)} className="flex min-h-20 items-center gap-3 rounded-3xl border-4 border-cyan-300 px-8 text-3xl font-black text-cyan-300">{cameraOn ? <VideoOff className="h-9 w-9" /> : <Video className="h-9 w-9" />}{cameraOn ? 'Hide camera' : 'Show camera'}</button>
        {cameraOn && <>
          <CameraFeed ref={cam} enabled={cameraOn} contacts={contacts} caps={caps} objectOverlay={overlay} onRecognized={(c) => handlers.current.onRecognized(c)} onUnknown={() => void handlers.current.offerNewPerson()} />
          <button disabled={busy} onClick={() => void whatIsThis()} className="min-h-24 w-full rounded-3xl bg-yellow-300 text-4xl font-black text-slate-950 disabled:opacity-50">{busy ? 'Looking…' : 'What is this?'}</button>
          <button onClick={() => void offerNewPerson(true)} className="min-h-20 w-full rounded-3xl border-4 border-cyan-300 text-3xl font-black text-cyan-300">Save the person I am looking at</button>
        </>}
      </section>

      {panel === 'items' && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((i) => <button key={i.id} onClick={() => void showItem(i)} className="rounded-3xl border-4 border-slate-600 p-5 text-left"><p className="text-3xl font-black text-cyan-300">{i.name}</p><p className="mt-1 text-2xl text-slate-200">{i.locationTip}</p></button>)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <button onClick={() => void whatIsThis('Add this item')} className="min-h-24 rounded-3xl bg-yellow-300 text-3xl font-black text-slate-950">Add item with camera</button>
            <button onClick={() => { setModalTab('items'); setCaregiverOpen(true); }} className="min-h-24 rounded-3xl border-4 border-cyan-300 text-3xl font-black text-cyan-300">Add item with a photo</button>
          </div>
        </section>
      )}
      {panel === 'meds' && <section className="space-y-3">{medsToday().map(({ a, past }) => <div key={a.id} className={`rounded-3xl border-4 p-5 text-3xl font-bold ${past ? 'border-slate-700 text-slate-500' : 'border-yellow-300'}`}>{fmt12(a.time)} · {a.title}{past && ' · done'}</div>)}</section>}

      {panel === 'nav' && (
        <section className="space-y-3">
          {zones.length ? zones.map((z) => (
            <div key={z.id} className="flex items-stretch gap-3">
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${z.latitude},${z.longitude}&travelmode=walking`} target="_blank" rel="noreferrer" onClick={() => say(`Opening directions to ${z.spokenName}.`)} className="block flex-1 rounded-3xl border-4 border-yellow-300 p-5 text-3xl font-black text-yellow-300">
                Take me to {z.name}<span className="block text-xl font-normal text-slate-300">{[z.address, z.city].filter(Boolean).join(', ')}</span>
              </a>
              <button aria-label={`Rename ${z.name}`} onClick={() => { const n = window.prompt('New name for this place', z.name); if (n && n.trim()) st.renameZone(z.id, n.trim()); }} className="rounded-3xl border-4 border-slate-600 px-5 text-xl font-bold">Rename</button>
              <button aria-label={`Delete ${z.name}`} onClick={() => { if (window.confirm(`Delete ${z.name}?`)) st.remove('zones', z.id); }} className="rounded-3xl border-4 border-red-500 px-5 text-xl font-bold text-red-400">Delete</button>
            </div>
          )) : <p className="text-2xl text-slate-300">No saved places yet. Say “save this place” when you are somewhere you want to remember.</p>}
        </section>
      )}

      <details className="rounded-2xl border-2 border-slate-700 p-4 text-lg text-slate-300">
        <summary className="cursor-pointer text-xl font-bold">Demo tools (for presenters)</summary>
        <div className="mt-4 flex flex-wrap gap-3">
          {primary && <button className="rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950" onClick={() => onRecognized(primary, true)}>Simulate: {primary.name} walks in</button>}
          <button className="rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950" onClick={() => onText('I want to go home', true)}>Simulate: “I want to go home”</button>
          {items[0] && <button className="rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950" onClick={() => void showItem(items[0])}>Simulate: show {items[0].name}</button>}
          {appointments[0] && <button className="rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950" onClick={() => remind(appointments[0])}>Simulate: reminder due</button>}
          
        </div>
        <div className="mt-4 flex gap-3">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typed) { onText(typed, true); setTyped(''); } }} placeholder="Type what the patient says…" className="flex-1 rounded-xl border-2 border-slate-600 bg-slate-900 p-3 text-lg text-white" />
          <button className="rounded-xl bg-yellow-300 px-5 py-3 font-bold text-slate-950" onClick={() => { if (typed) { onText(typed, true); setTyped(''); } }}>Say it</button>
        </div>
      </details>

      <AnchorCard open={distress.active} patientName={settings.patientName} contact={primary} grounding={g} address={g.zone ? [g.zone.address, g.zone.city].filter(Boolean).join(', ') : place ?? 'Someone is on the way'}
        alert={alerts[0] ?? null} onVoice={() => say(`Hi ${settings.patientName}, it's ${primary?.name ?? 'your family'}. You are safe. ${g.spoken} I love you.`, { voiceId: primary?.voiceId })}
        onEmergency={emergency} onDismiss={() => { stopSpeaking(); st.resolveDistress(); say(`I'm glad you feel better, ${settings.patientName}. I'm right here.`, { whisper: true }); }} />
      <CaregiverModal open={caregiverOpen} onClose={() => setCaregiverOpen(false)} initialTab={modalTab} snapshot={() => cam.current?.capture(480)?.toDataURL('image/jpeg', 0.75) ?? null} />
    </main>
  );
}
