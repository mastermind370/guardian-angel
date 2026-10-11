'use client';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Appointment, CaregiverAlert, Contact, DistressState, RemittanceItem, SafeZone, Settings } from '@/types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const avatar = (initial: string, bg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='400' height='400' fill='${bg}'/><text x='200' y='265' font-size='190' text-anchor='middle' fill='#0f172a' font-family='Arial' font-weight='700'>${initial}</text></svg>`)}`;

const seed = () => ({
  contacts: [
    { id: 'c-sarah', name: 'Sarah', relationship: 'daughter', memoryNote: 'She brought you peach cobbler today.', photoDataUrl: avatar('S', '#fde047'), phone: '', isCaregiver: false },
    { id: 'c-john', name: 'John', relationship: 'caregiver', memoryNote: 'He is here to help you with your medicine today.', photoDataUrl: avatar('J', '#67e8f9'), phone: '', isCaregiver: true },
  ] as Contact[],
  items: [
    { id: 'i-glasses', name: 'Blue reading glasses', description: 'These are your blue reading glasses. They have a soft blue frame and you use them for your books.', locationTip: 'They live on the little table beside your armchair.', dominantColor: '#2563eb' },
    { id: 'i-pills', name: 'Morning pill bottle', description: 'This is your pill bottle with the orange cap. Please only take pills when John or Sarah tells you to.', locationTip: 'It goes in the kitchen cabinet, top shelf, next to the tea.', dominantColor: '#f97316' },
  ] as RemittanceItem[],
  appointments: [
    { id: 'a-bp', kind: 'medication', title: 'Blood Pressure', time: '09:00', days: [], note: 'A glass of water helps.', enabled: true },
    { id: 'a-miller', kind: 'appointment', title: 'Dr. Miller', time: '15:00', days: [2, 4], note: 'Sarah will drive you.', enabled: true },
  ] as Appointment[],
  zones: [] as SafeZone[],
  settings: { patientName: 'Margaret', caregiverName: 'John', caregiverPhone: '', locationMode: 'gps' } as Settings,
});

const idle: DistressState = { active: false, level: 'none', trigger: null, startedAt: null, caregiverNotified: false };
type ListKey = 'contacts' | 'items' | 'appointments' | 'zones';

interface Store {
  contacts: Contact[]; items: RemittanceItem[]; appointments: Appointment[]; zones: SafeZone[];
  settings: Settings; alerts: CaregiverAlert[]; distress: DistressState; fired: Record<string, boolean>;
  addContact: (c: Omit<Contact, 'id'>) => void; addItem: (i: Omit<RemittanceItem, 'id'>) => void;
  addAppointment: (a: Omit<Appointment, 'id'>) => void; addZone: (z: Omit<SafeZone, 'id'>) => void;
  remove: (k: ListKey, id: string) => void; setSettings: (p: Partial<Settings>) => void;
  touchContact: (id: string) => void; setEmbedding: (id: string, e: number[]) => void; renameZone: (id: string, name: string) => void; markFired: (key: string) => void;
  pushAlert: (level: CaregiverAlert['level'], title: string, body: string) => void;
  triggerDistress: (trigger: string, body: string) => void; resolveDistress: () => void; reset: () => void;
}

const safeStorage: StateStorage = {
  getItem: (n) => { try { return typeof window === 'undefined' ? null : window.localStorage.getItem(n); } catch { return null; } },
  setItem: (n, v) => { try { window.localStorage.setItem(n, v); } catch (e) { console.warn('GuardianAngel: storage full', e); } },
  removeItem: (n) => { try { window.localStorage.removeItem(n); } catch { /* ignore */ } },
};

export const useGuardianStore = create<Store>()(
  persist(
    (set) => ({
      ...seed(), alerts: [], distress: idle, fired: {},
      addContact: (c) => set((s) => ({ contacts: [...s.contacts, { ...c, id: uid() }] })),
      addItem: (i) => set((s) => ({ items: [...s.items, { ...i, id: uid() }] })),
      addAppointment: (a) => set((s) => ({ appointments: [...s.appointments, { ...a, id: uid() }] })),
      addZone: (z) => set((s) => ({ zones: [...s.zones.map((x) => (z.isHome ? { ...x, isHome: false } : x)), { ...z, id: uid() }] })),
      remove: (k, id) => set((s) => ({ [k]: (s[k] as { id: string }[]).filter((x) => x.id !== id) } as Partial<Store>)),
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      touchContact: (id) => set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, lastSeenAt: Date.now() } : c)) })),
      renameZone: (id, name) => set((s) => ({ zones: s.zones.map((z) => (z.id === id ? { ...z, name, spokenName: z.isHome ? z.spokenName : name } : z)) })),
      setEmbedding: (id, e) => set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, embedding: e } : c)) })),
      markFired: (key) => set((s) => ({ fired: { ...Object.fromEntries(Object.entries(s.fired).slice(-40)), [key]: true } })),
      pushAlert: (level, title, body) => set((s) => ({ alerts: [{ id: uid(), createdAt: Date.now(), level, title, body }, ...s.alerts].slice(0, 20) })),
      triggerDistress: (trigger, body) => set((s) => ({
        distress: { active: true, level: 'panic', trigger, startedAt: Date.now(), caregiverNotified: true },
        alerts: [{ id: uid(), createdAt: Date.now(), level: 'warning' as const, title: 'Possible distress detected', body }, ...s.alerts].slice(0, 20),
      })),
      resolveDistress: () => set({ distress: idle }),
      reset: () => set({ ...seed(), alerts: [], distress: idle, fired: {} }),
    }),
    {
      name: 'guardian-angel-v1', version: 2,
      migrate: (s: unknown) => { const o = s as Partial<Store>; return { ...o, zones: (o.zones ?? []).filter((z) => z.id !== 'z-home'), settings: { ...(o.settings as Settings), locationMode: 'gps' } } as Store; }, storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ contacts: s.contacts, items: s.items, appointments: s.appointments, zones: s.zones, settings: s.settings, alerts: s.alerts, fired: s.fired }),
    },
  ),
);
