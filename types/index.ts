export interface Contact { id: string; name: string; relationship: string; memoryNote: string; photoDataUrl: string; descriptor?: number[]; embedding?: number[]; phone?: string; voiceId?: string; isCaregiver: boolean; lastSeenAt?: number }
/** Life Vault item (kept under the requested name; LifeVaultItem is an alias). */
export interface RemittanceItem { id: string; name: string; description: string; locationTip: string; photoDataUrl?: string; descriptor?: number[]; dominantColor: string }
export type LifeVaultItem = RemittanceItem;
export interface Appointment { id: string; kind: 'medication' | 'appointment'; title: string; time: string; days: number[]; date?: string; note?: string; enabled: boolean }
export interface SafeZone { id: string; name: string; spokenName: string; room?: string; address: string; city: string; latitude: number; longitude: number; radiusMeters: number; isHome: boolean }
export type DistressLevel = 'none' | 'elevated' | 'panic';
export interface DistressState { active: boolean; level: DistressLevel; trigger: string | null; startedAt: number | null; caregiverNotified: boolean }
export interface CaregiverAlert { id: string; createdAt: number; level: 'info' | 'warning' | 'emergency'; title: string; body: string }
export interface Settings { patientName: string; caregiverName: string; caregiverPhone: string; locationMode: 'demo' | 'gps' }
export interface NormBox { x: number; y: number; w: number; h: number }
export interface Caps { gemini: boolean; elevenlabs: boolean; geminiError?: string }
export interface Position { latitude: number; longitude: number; accuracy?: number }
export interface Grounding { headline: string; spoken: string; zone: SafeZone | null; inside: boolean }
export interface FaceResult { contactId: string | null; confidence: number; faceVisible: boolean; box: NormBox | null; source: 'gemini' | 'local' | 'none' }
export interface ObjectResult { name: string; description: string; locationTip: string; itemId: string | null; confidence: number; box: NormBox | null; source: 'gemini' | 'local' | 'mock'; note?: string }
