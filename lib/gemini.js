import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY nicht gesetzt');
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });
}

const PARSE_SCHEMA = `{
  "type": "income" | "expense",
  "amount": number (positiv, in EUR),
  "category": string (eine von: Lebensmittel, Restaurant, Transport, Wohnen, Gesundheit, Freizeit, Shopping, Abos, Gehalt, Sonstiges),
  "description": string (kurz, Händler oder Zweck),
  "date": "YYYY-MM-DD" (heute wenn unklar: ${new Date().toISOString().slice(0, 10)}),
  "confidence": number 0-1
}`;

function extractJson(text) {
  const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(cleaned);
}

function normalize(parsed) {
  const amount = Math.abs(Number(parsed.amount));
  if (!amount || Number.isNaN(amount)) throw new Error('Ungültiger Betrag');
  const type = parsed.type === 'income' ? 'income' : 'expense';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
    ? parsed.date
    : new Date().toISOString().slice(0, 10);
  return {
    type,
    amount,
    category: parsed.category || 'Sonstiges',
    description: String(parsed.description || '').slice(0, 200),
    date,
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.8)),
  };
}

export async function parseNaturalLanguage(text) {
  const model = getModel();
  const prompt = `Du bist ein Assistent für einen deutschen Einnahmen-Ausgaben-Tracker.
Extrahiere aus der Nutzereingabe eine Buchung. Antworte NUR mit gültigem JSON:
${PARSE_SCHEMA}

Beispiele:
- "50 Euro beim Bäcker" → expense, Lebensmittel
- "Gehalt 3200" → income, Gehalt
- "12,99 Netflix Abo gestern" → expense, Abos

Eingabe: "${text}"`;

  const result = await model.generateContent(prompt);
  return normalize(extractJson(result.response.text()));
}

const AUDIO_PROMPT = `Höre dir diese deutsche Sprachnachricht an (Einnahme oder Ausgabe).
Transkribiere und extrahiere eine Buchung. Antworte NUR mit gültigem JSON:
${PARSE_SCHEMA}`;

export async function parseAudio(filePath, mimeType) {
  const model = getModel();
  const audioData = fs.readFileSync(filePath);
  const base64 = audioData.toString('base64');
  const result = await model.generateContent([
    { text: AUDIO_PROMPT },
    { inlineData: { data: base64, mimeType: mimeType || 'audio/webm' } },
  ]);
  return normalize(extractJson(result.response.text()));
}

export async function parseReceiptImage(filePath, mimeType) {
  const model = getModel();
  const imageData = fs.readFileSync(filePath);
  const base64 = imageData.toString('base64');

  const prompt = `Analysiere diesen Kassenbon/Beleg (deutsch oder international).
Extrahiere Betrag, Datum, Händler und schlage eine Kategorie vor.
Antworte NUR mit gültigem JSON:
${PARSE_SCHEMA}

Bei Mehrdeutigkeit: type=expense, confidence niedriger setzen.`;

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: base64, mimeType: mimeType || 'image/jpeg' } },
  ]);
  return normalize(extractJson(result.response.text()));
}

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}
