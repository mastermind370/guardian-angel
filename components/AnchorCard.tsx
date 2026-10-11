'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Phone, Smartphone, Volume2 } from 'lucide-react';
import type { CaregiverAlert, Contact, Grounding } from '@/types';

interface Props {
  open: boolean; patientName: string; contact: Contact | null; grounding: Grounding | null; address: string;
  alert: CaregiverAlert | null; onVoice: () => void; onEmergency: () => void; onDismiss: () => void;
}

export function AnchorCard({ open, patientName, contact, grounding, address, alert, onVoice, onEmergency, onDismiss }: Props) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { if (!open) return; const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="anchor" role="alertdialog" aria-modal="true" aria-label="You are safe"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black p-5 sm:p-10">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 text-center">
            <div className="relative grid h-44 w-44 place-items-center" aria-hidden>
              <motion.div className="absolute inset-0 rounded-full bg-cyan-300/30" animate={{ scale: [1, 1.5, 1] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
              <Heart className="relative h-20 w-20 text-yellow-300" />
            </div>
            <h1 aria-live="assertive" className="text-6xl font-black leading-tight text-yellow-300 sm:text-7xl">{patientName}, you are safe.</h1>
            <p className="text-4xl font-semibold leading-snug text-white">{grounding?.spoken ?? 'Someone who loves you is on the way.'}</p>
            <p className="text-3xl font-bold text-cyan-300">Breathe in slowly… and out slowly.</p>
            <div className="grid w-full gap-6 sm:grid-cols-2">
              <div className="rounded-3xl border-4 border-yellow-300 p-6">
                {contact?.photoDataUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={contact.photoDataUrl} alt={contact.name} className="mx-auto h-56 w-56 rounded-3xl object-cover" />}
                <p className="mt-4 text-4xl font-black">{contact ? `${contact.name}, your ${contact.relationship}` : 'Your family'}</p>
                <p className="text-3xl text-slate-300">is thinking of you.</p>
              </div>
              <div className="flex flex-col justify-center gap-4 rounded-3xl border-4 border-cyan-300 p-6">
                <p className="text-7xl font-black text-yellow-300">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                <p className="text-4xl font-bold">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                <p className="text-3xl text-cyan-300">{address}</p>
              </div>
            </div>
            {alert && (
              <div className="flex w-full items-start gap-4 rounded-3xl bg-slate-800 p-5 text-left text-2xl">
                <Smartphone className="mt-1 h-10 w-10 shrink-0 text-cyan-300" />
                <div><p className="font-bold text-cyan-300">Message sent to your caregiver</p><p className="text-slate-200">{alert.body}</p></div>
              </div>
            )}
            <div className="grid w-full gap-5 sm:grid-cols-3">
              <button onClick={onVoice} className="flex min-h-28 items-center justify-center gap-3 rounded-3xl bg-cyan-300 p-5 text-3xl font-black text-slate-950"><Volume2 className="h-10 w-10" />Hear {contact?.name ?? 'a loved one'}</button>
              <button onClick={onDismiss} className="min-h-28 rounded-3xl bg-yellow-300 p-5 text-3xl font-black text-slate-950">I feel better</button>
              <button onClick={onEmergency} className="flex min-h-28 items-center justify-center gap-3 rounded-3xl bg-red-600 p-5 text-3xl font-black text-white"><Phone className="h-10 w-10" />Call for help</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
