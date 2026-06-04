import fs from 'fs';

const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const audioModel = process.env.GEMINI_AUDIO_MODEL || defaultModel;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const CATEGORIES = 'Lebensmittel|Restaurant|Transport|Wohnen|Gesundheit|Freizeit|Shopping|Abos|Gehalt|Sonstiges';
const today = () => new Date().toISOString().slice(0, 10);

const PARSE_SCHEMA = `{"type":"income"|"expense","amount":number,"category":"${CATEGORIES}","description":string,"date":"YYYY-MM-DD","confidence":0-1}`;

function extractJson(text) {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}

function normalize(parsed) {
  const amount = Math.abs(Number(parsed.amount));
  if (!amount || Number.isNaN(amount)) throw new Error('Ungültiger Betrag');
  const type = parsed.type === 'income' ? 'income' : 'expense';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today();
  return {
    type,
    amount,
    category: parsed.category || 'Sonstiges',
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
  return normalize(extractJson(text));
}

export async function parseNaturalLanguage(text) {
  const prompt = `Extrahiere eine deutsche Haushaltsbuchung als JSON ${PARSE_SCHEMA}. Heute: ${today()}. Nur JSON.\nText: "${text}"`;
  return geminiGenerate([{ text: prompt }]);
}

export async function parseAudio(filePath, mimeType) {
  const audioData = fs.readFileSync(filePath);
  const base64 = audioData.toString('base64');
  const prompt = `Deutsche Sprachnachricht (Einnahme/Ausgabe) → JSON ${PARSE_SCHEMA}. Heute: ${today()}. Nur JSON.`;
  return geminiGenerate([
    { text: prompt },
    { inlineData: { mimeType: mimeType || 'audio/webm', data: base64 } },
  ], audioModel);
}

export async function parseReceiptImage(filePath, mimeType) {
  const base64 = fs.readFileSync(filePath).toString('base64');
  const prompt = `Kassenbon/Beleg → JSON ${PARSE_SCHEMA}. Heute: ${today()}. type meist expense. Nur JSON.`;
  return geminiGenerate([
    { text: prompt },
    { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64 } },
  ]);
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}
