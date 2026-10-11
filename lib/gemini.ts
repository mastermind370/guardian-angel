// Server-side helper: talks to the Gemini REST API directly and discovers which models your key can use.
export type GPart = { text: string } | { inlineData: { mimeType: string; data: string } };
const API = 'https://generativelanguage.googleapis.com/v1beta';

export const friendly = (m: string): string =>
  /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|API key expired|403/i.test(m) ? 'The Gemini key was rejected. Check GEMINI_API_KEY in .env.local (no spaces or quotes).'
  : /429|quota|RESOURCE_EXHAUSTED/i.test(m) ? 'Gemini is over its free limit right now. Wait a minute and try again.'
  : /fetch failed|ENOTFOUND|ECONN|network|timeout|aborted/i.test(m) ? 'The app could not reach Gemini. Check the internet connection.'
  : m.slice(0, 220);

/** Picks current Gemini "flash" models that support generateContent, newest first. */
export function rankModels(list: { models?: { name: string; supportedGenerationMethods?: string[] }[] }): string[] {
  const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  return (list.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name) && /flash/.test(m.name) && !/tts|image|live|embedding|thinking|audio|robotics|computer|exp|preview/i.test(m.name))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort((a, b) => (+b.includes('lite') - +a.includes('lite')) || ver(b) - ver(a) || (b.includes('latest') ? 1 : 0) - (a.includes('latest') ? 1 : 0) || a.length - b.length);
}

export function extractJson(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Gemini did not return an answer I could read.');
  return JSON.parse(m[0]);
}

let cache: string[] | null = null;
export const resetModelCache = () => { cache = null; };
const errMsg = (j: unknown, status: number) => ((j as { error?: { message?: string } })?.error?.message) ?? `HTTP ${status}`;

async function models(key: string, f: typeof fetch): Promise<string[]> {
  if (cache) return cache;
  const r = await f(`${API}/models?pageSize=200&key=${key}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errMsg(j, r.status));
  cache = [...new Set([process.env.GEMINI_MODEL, ...rankModels(j), 'gemini-flash-latest'].filter(Boolean) as string[])].slice(0, 5);
  return cache;
}

export async function generateText(key: string, parts: GPart[], maxTokens = 1024, f: typeof fetch = fetch): Promise<string> {
  const errors: string[] = [];
  for (const m of await models(key, f)) {
    for (const thinkingOff of [true, false]) {
      const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } };
      let r: Response;
      try {
        r = await f(`${API}/models/${m}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      } catch (e) { errors.push(`${m}: ${String(e)}`); break; }
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const t = ((j as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
        if (t) return t;
        errors.push(`${m}: empty answer`); break;
      }
      const msg = errMsg(j, r.status);
      if (thinkingOff && r.status === 400 && /thinking/i.test(msg)) continue; // retry this model without the thinking option
      errors.push(`${m}: ${msg}`);
      if ((r.status === 400 && /API key/i.test(msg)) || r.status === 403) { cache = null; throw new Error(errors[0]); }
      break;
    }
  }
  cache = null;
  throw new Error(errors[0] ?? 'no Gemini models available for this key');
}
