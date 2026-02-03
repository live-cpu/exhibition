import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GEMINI_ENABLED = String(process.env.GEMINI_ENABLED ?? 'false').toLowerCase() === 'true';
const GEMINI_MAX_CALLS_PER_RUN = Number(process.env.GEMINI_MAX_CALLS_PER_RUN || 3);
const GEMINI_MAX_CALLS_PER_DAY = Number(process.env.GEMINI_MAX_CALLS_PER_DAY || 10);
const GEMINI_USE_SEARCH_TOOL = String(process.env.GEMINI_USE_SEARCH_TOOL ?? 'true').toLowerCase() === 'true';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 20000);

let geminiCallsUsed = 0;
let geminiCallsDateKey = getLocalDateKey();

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resetGeminiCounterIfNeeded() {
  const today = getLocalDateKey();
  if (today !== geminiCallsDateKey) {
    geminiCallsDateKey = today;
    geminiCallsUsed = 0;
  }
}

function canUseGemini() {
  resetGeminiCounterIfNeeded();
  if (!GEMINI_ENABLED) return false;
  if (!GEMINI_API_KEY) return false;
  if (geminiCallsUsed >= GEMINI_MAX_CALLS_PER_RUN) return false;
  if (geminiCallsUsed >= GEMINI_MAX_CALLS_PER_DAY) return false;
  geminiCallsUsed += 1;
  return true;
}

export function consumeGeminiQuota() {
  return canUseGemini();
}

function extractJsonArray(text) {
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (err) {
    return null;
  }
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeGeminiItem(item) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || '').trim();
  const url = String(item.url || '').trim();
  if (!title || title.length < 2) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  const start = normalizeDate(item.start_date);
  const end = normalizeDate(item.end_date);
  const description = String(item.description || '').trim();
  return {
    title,
    link: url,
    description,
    period: start && end ? { start, end } : null
  };
}

export async function fetchGeminiExhibitions({ venue, limit = 5 } = {}) {
  const venueName = typeof venue === 'string' ? venue : venue?.name;
  if (!venueName) return [];
  if (!GEMINI_ENABLED || !GEMINI_API_KEY) return [];
  if (!consumeGeminiQuota()) return [];

  const prompt = [
    'Find ongoing or upcoming exhibitions for the venue below.',
    'Return JSON array only. Each item must include:',
    'title, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), url, description (optional).',
    'Only include entries you can confirm from a specific URL. If unsure, return [].',
    `Venue: ${venueName}`
  ].join('\n');

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.2,
        maxOutputTokens: 1024
      }
    };

    if (GEMINI_USE_SEARCH_TOOL) {
      body.tools = [{ google_search: {} }];
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || '')
      .join('\n');
    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((item) => normalizeGeminiItem(item))
      .filter(Boolean);
    return normalized.slice(0, Math.max(1, Number(limit) || 5));
  } catch (err) {
    return [];
  }
}

