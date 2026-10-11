import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'GuardianAngel', description: 'An ambient AI caregiver and memory copilot' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="min-h-screen bg-slate-950 font-sans text-white antialiased">{children}</body></html>);
}
