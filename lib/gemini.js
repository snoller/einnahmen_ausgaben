import fs from 'fs';

const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const audioModel = process.env.GEMINI_AUDIO_MODEL || defaultModel;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const today = () => new Date().toISOString().slice(0, 10);

function parseSchema(categories) {
  const list = categories?.length ? categories : ['Sonstiges'];
  return `{"type":"income"|"expense","amount":number,"category":"${list.join('|')}","description":string,"date":"YYYY-MM-DD","confidence":0-1}`;
}

function extractJson(text) {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}

function normalize(parsed, categories = []) {
  const amount = Math.abs(Number(parsed.amount));
  if (!amount || Number.isNaN(amount)) throw new Error('Ungültiger Betrag');
  const type = parsed.type === 'income' ? 'income' : 'expense';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today();
  const fallback = categories.includes('Sonstiges') ? 'Sonstiges' : (categories[0] || 'Sonstiges');
  const category = categories.includes(parsed.category) ? parsed.category : fallback;
  return {
    type,
    amount,
    category,
    description: String(parsed.description || '').slice(0, 200),
    date,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.8)),
  };
}

async function geminiGenerate(parts, model = defaultModel) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY nicht gesetzt');

  const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 200,
        thinkingConfig: { thinkingLevel: 'MINIMAL' },
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini API Fehler (${res.status})`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
  if (!text) throw new Error('Keine Antwort von Gemini');
  return text;
}

export async function parseNaturalLanguage(text, categories) {
  const schema = parseSchema(categories);
  const prompt = `Extrahiere eine deutsche Haushaltsbuchung als JSON ${schema}. Heute: ${today()}. Nur JSON.\nText: "${text}"`;
  return normalize(extractJson(await geminiGenerate([{ text: prompt }])), categories);
}

export async function parseAudio(filePath, mimeType, categories) {
  const schema = parseSchema(categories);
  const audioData = fs.readFileSync(filePath);
  const base64 = audioData.toString('base64');
  const prompt = `Deutsche Sprachnachricht (Einnahme/Ausgabe) → JSON ${schema}. Heute: ${today()}. Nur JSON.`;
  return normalize(extractJson(await geminiGenerate([
    { text: prompt },
    { inlineData: { mimeType: mimeType || 'audio/webm', data: base64 } },
  ], audioModel)), categories);
}

export async function parseReceiptImage(filePath, mimeType, categories) {
  const schema = parseSchema(categories);
  const base64 = fs.readFileSync(filePath).toString('base64');
  const prompt = `Kassenbon/Beleg → JSON ${schema}. Heute: ${today()}. type meist expense. Nur JSON.`;
  return normalize(extractJson(await geminiGenerate([
    { text: prompt },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
  ])), categories);
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}
