'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, MapPin, Trash2, X } from 'lucide-react';
import { useGuardianStore } from '@/lib/store';
import { descriptorFromDataUrl, embeddingFromDataUrl, fileToJpeg } from '@/lib/vision';
import { fmt12 } from '@/lib/grounding';

type Tab = 'people' | 'items' | 'reminders' | 'zones' | 'settings';
const inp = 'w-full rounded-xl border-2 border-slate-600 bg-slate-900 p-3 text-lg text-white';
const btn = 'rounded-xl bg-yellow-300 px-5 py-3 text-lg font-bold text-slate-950 disabled:opacity-40';
const Label = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block text-base font-semibold text-slate-300">{t}<div className="mt-1">{children}</div></label>;

function Photo({ value, onChange, snap }: { value: string; onChange: (v: string) => void; snap: () => string | null }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {value ? <img src={value} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-xl bg-slate-800 text-slate-400"><Camera /></div>}
      <input type="file" accept="image/*" capture="environment" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await fileToJpeg(f)); }} />
      <button type="button" className="rounded-xl bg-cyan-300 px-3 py-2 font-bold text-slate-950" onClick={() => { const s = snap(); if (s) onChange(s); }}>Use live camera</button>
    </div>
  );
}

export function CaregiverModal({ open, onClose, snapshot, initialTab }: { open: boolean; onClose: () => void; snapshot: () => string | null; initialTab?: Tab }) {
  const st = useGuardianStore();
  const [tab, setTab] = useState<Tab>('people');
  const [p, setP] = useState({ name: '', relationship: '', memoryNote: '', phone: '', voiceId: '', isCaregiver: false, photo: '' });
  const [it, setIt] = useState({ name: '', description: '', locationTip: '', photo: '' });
  const [ap, setAp] = useState({ kind: 'medication' as 'medication' | 'appointment', title: '', time: '09:00', note: '', date: '' });
  const [z, setZ] = useState({ name: '', spokenName: '', room: '', address: '', city: '', radiusMeters: '150', latitude: '', longitude: '', isHome: false });
  const [msg, setMsg] = useState('');
  useEffect(() => { if (open && initialTab) setTab(initialTab); }, [open, initialTab]);

  const saveP = async () => {
    const d = p.photo ? await descriptorFromDataUrl(p.photo, true) : null;
    const emb = p.photo ? await embeddingFromDataUrl(p.photo) : null;
    st.addContact({ name: p.name, relationship: p.relationship || 'friend', memoryNote: p.memoryNote, photoDataUrl: p.photo, descriptor: d?.descriptor, embedding: emb ?? undefined, phone: p.phone, voiceId: p.voiceId || undefined, isCaregiver: p.isCaregiver });
    setP({ name: '', relationship: '', memoryNote: '', phone: '', voiceId: '', isCaregiver: false, photo: '' }); setMsg(p.photo && !emb ? 'Saved, but I could not find a face in that photo. Use a clear, front-facing photo.' : 'Contact saved.');
  };
  const saveI = async () => {
    const d = it.photo ? await descriptorFromDataUrl(it.photo, false) : null;
    st.addItem({ name: it.name, description: it.description, locationTip: it.locationTip, photoDataUrl: it.photo || undefined, descriptor: d?.descriptor, dominantColor: d?.color ?? '#888888' });
    setIt({ name: '', description: '', locationTip: '', photo: '' }); setMsg('Item saved.');
  };
  const useHere = () => navigator.geolocation.getCurrentPosition(
    (g) => setZ((v) => ({ ...v, latitude: String(g.coords.latitude), longitude: String(g.coords.longitude) })),
    () => setMsg('Could not read location. Allow location access or type the coordinates.'),
  );
  const saveZ = () => {
    st.addZone({ name: z.name, spokenName: z.spokenName || z.name, room: z.room || undefined, address: z.address, city: z.city, radiusMeters: Number(z.radiusMeters) || 150, latitude: Number(z.latitude), longitude: Number(z.longitude), isHome: z.isHome });
    setZ({ name: '', spokenName: '', room: '', address: '', city: '', radiusMeters: '150', latitude: '', longitude: '', isHome: false }); setMsg('Safe zone saved.');
  };
  const Row = ({ t, sub, onDel }: { t: string; sub?: string; onDel: () => void }) => (
    <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3"><div><p className="text-lg font-bold">{t}</p>{sub && <p className="text-sm text-slate-400">{sub}</p>}</div><button aria-label={`Delete ${t}`} onClick={onDel} className="p-2 text-red-400"><Trash2 /></button></div>
  );
  const tabs: Tab[] = ['people', 'items', 'reminders', 'zones', 'settings'];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/70" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside role="dialog" aria-label="Caregiver settings" className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l-4 border-cyan-300 bg-slate-950 p-5"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'tween', duration: 0.25 }}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-3xl font-black text-yellow-300">Caregiver panel</h2><button aria-label="Close" onClick={onClose} className="p-2"><X className="h-8 w-8" /></button></div>
            <div className="mb-5 flex flex-wrap gap-2">{tabs.map((t) => <button key={t} onClick={() => { setTab(t); setMsg(''); }} className={`rounded-xl px-4 py-2 text-lg font-bold capitalize ${tab === t ? 'bg-cyan-300 text-slate-950' : 'bg-slate-800'}`}>{t}</button>)}</div>
            {msg && <p className="mb-3 rounded-xl bg-slate-800 p-3 text-cyan-300">{msg}</p>}

            {tab === 'people' && (<div className="space-y-3">
              {st.contacts.map((c) => <Row key={c.id} t={`${c.name} (${c.relationship})`} sub={c.memoryNote} onDel={() => st.remove('contacts', c.id)} />)}
              <h3 className="pt-3 text-xl font-bold">Add a person</h3>
              <Photo value={p.photo} onChange={(v) => setP({ ...p, photo: v })} snap={snapshot} />
              <Label t="Name"><input className={inp} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Label>
              <Label t="Relationship (daughter, neighbour…)"><input className={inp} value={p.relationship} onChange={(e) => setP({ ...p, relationship: e.target.value })} /></Label>
              <Label t="Memory note whispered after their name"><input className={inp} value={p.memoryNote} onChange={(e) => setP({ ...p, memoryNote: e.target.value })} placeholder="She brought you peach cobbler today." /></Label>
              <Label t="Phone"><input className={inp} value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Label>
              <Label t="ElevenLabs voice ID (optional, for their cloned voice)"><input className={inp} value={p.voiceId} onChange={(e) => setP({ ...p, voiceId: e.target.value })} /></Label>
              <label className="flex items-center gap-3 text-lg"><input type="checkbox" className="h-6 w-6" checked={p.isCaregiver} onChange={(e) => setP({ ...p, isCaregiver: e.target.checked })} />This person is a caregiver</label>
              <button className={btn} disabled={!p.name} onClick={saveP}>Save person</button>
            </div>)}

            {tab === 'items' && (<div className="space-y-3">
              {st.items.map((i) => <Row key={i.id} t={i.name} sub={i.locationTip} onDel={() => st.remove('items', i.id)} />)}
              <h3 className="pt-3 text-xl font-bold">Photograph an item</h3>
              <Photo value={it.photo} onChange={(v) => setIt({ ...it, photo: v })} snap={snapshot} />
              <Label t="Name"><input className={inp} value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} /></Label>
              <Label t="What it is (said aloud)"><input className={inp} value={it.description} onChange={(e) => setIt({ ...it, description: e.target.value })} /></Label>
              <Label t="Where it goes"><input className={inp} value={it.locationTip} onChange={(e) => setIt({ ...it, locationTip: e.target.value })} /></Label>
              <button className={btn} disabled={!it.name} onClick={saveI}>Save item</button>
            </div>)}

            {tab === 'reminders' && (<div className="space-y-3">
              {st.appointments.map((a) => <Row key={a.id} t={`${fmt12(a.time)}: ${a.title}`} sub={`${a.kind}${a.date ? `, ${a.date}` : a.days.length ? '' : ', every day'}`} onDel={() => st.remove('appointments', a.id)} />)}
              <h3 className="pt-3 text-xl font-bold">Add a medication or appointment</h3>
              <Label t="Type"><select className={inp} value={ap.kind} onChange={(e) => setAp({ ...ap, kind: e.target.value as 'medication' | 'appointment' })}><option value="medication">Medication</option><option value="appointment">Appointment</option></select></Label>
              <Label t="Title"><input className={inp} value={ap.title} onChange={(e) => setAp({ ...ap, title: e.target.value })} /></Label>
              <Label t="Time"><input type="time" className={inp} value={ap.time} onChange={(e) => setAp({ ...ap, time: e.target.value })} /></Label>
              <Label t="Date (leave empty to repeat every day)"><input type="date" className={inp} value={ap.date} onChange={(e) => setAp({ ...ap, date: e.target.value })} /></Label>
              <Label t="Kind words to add"><input className={inp} value={ap.note} onChange={(e) => setAp({ ...ap, note: e.target.value })} /></Label>
              <button className={btn} disabled={!ap.title} onClick={() => { st.addAppointment({ ...ap, date: ap.date || undefined, days: [], enabled: true }); setAp({ ...ap, title: '', note: '' }); setMsg('Reminder saved.'); }}>Save reminder</button>
            </div>)}

            {tab === 'zones' && (<div className="space-y-3">
              {st.zones.map((v) => <Row key={v.id} t={v.name} sub={`${v.address}, ${v.city} · ${v.radiusMeters} m`} onDel={() => st.remove('zones', v.id)} />)}
              <h3 className="pt-3 text-xl font-bold">Add a safe zone</h3>
              <Label t="Name (Sarah's House)"><input className={inp} value={z.name} onChange={(e) => setZ({ ...z, name: e.target.value })} /></Label>
              <Label t="Said aloud (home, Sarah's house)"><input className={inp} value={z.spokenName} onChange={(e) => setZ({ ...z, spokenName: e.target.value })} /></Label>
              <Label t="Room (your living room)"><input className={inp} value={z.room} onChange={(e) => setZ({ ...z, room: e.target.value })} /></Label>
              <Label t="Street address"><input className={inp} value={z.address} onChange={(e) => setZ({ ...z, address: e.target.value })} /></Label>
              <Label t="City"><input className={inp} value={z.city} onChange={(e) => setZ({ ...z, city: e.target.value })} /></Label>
              <div className="grid grid-cols-3 gap-2">
                <Label t="Latitude"><input className={inp} value={z.latitude} onChange={(e) => setZ({ ...z, latitude: e.target.value })} /></Label>
                <Label t="Longitude"><input className={inp} value={z.longitude} onChange={(e) => setZ({ ...z, longitude: e.target.value })} /></Label>
                <Label t="Radius (m)"><input className={inp} value={z.radiusMeters} onChange={(e) => setZ({ ...z, radiusMeters: e.target.value })} /></Label>
              </div>
              <button className="flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-lg font-bold text-slate-950" onClick={useHere}><MapPin />Use my current location</button>
              <label className="flex items-center gap-3 text-lg"><input type="checkbox" className="h-6 w-6" checked={z.isHome} onChange={(e) => setZ({ ...z, isHome: e.target.checked })} />This is home</label>
              <button className={btn} disabled={!z.name || !z.latitude || !z.longitude} onClick={saveZ}>Save safe zone</button>
            </div>)}

            {tab === 'settings' && (<div className="space-y-3">
              <Label t="Patient first name"><input className={inp} value={st.settings.patientName} onChange={(e) => st.setSettings({ patientName: e.target.value })} /></Label>
              <Label t="Caregiver name"><input className={inp} value={st.settings.caregiverName} onChange={(e) => st.setSettings({ caregiverName: e.target.value })} /></Label>
              <Label t="Caregiver phone (used by Call for help on phones)"><input className={inp} value={st.settings.caregiverPhone} onChange={(e) => st.setSettings({ caregiverPhone: e.target.value })} /></Label>
              <button className="rounded-xl bg-red-600 px-5 py-3 text-lg font-bold" onClick={() => { if (confirm('Reset everything to the demo data?')) st.reset(); }}>Reset demo data</button>
            </div>)}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
