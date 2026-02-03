import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { applyVenueAlias, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const MOCA_API_KEY = process.env.MOCA_API_KEY;
const API_BASE_URL = 'https://api.kcisa.kr/openapi/service/rest/moca/docMeta';

function parseDateRange(value) {
  if (!value) return { start: null, end: null };
  const raw = String(value).trim();
  if (!raw) return { start: null, end: null };
  const normalized = raw.replace(/[./]/g, '-');
  const rangeMatch = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})\s*[~\-]\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (rangeMatch) {
    return { start: new Date(rangeMatch[1]), end: new Date(rangeMatch[2]) };
  }
  const single = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  if (single) {
    const d = new Date(single[1]);
    return { start: d, end: d };
  }
  return { start: null, end: null };
}

function parsePrice(priceStr) {
  if (!priceStr) return { adult: 0, youth: 0, child: 0, free: true };
  const str = String(priceStr).toLowerCase();
  if (str.includes('무료') || str === '0' || str === 'free' || str.trim() === '') {
    return { adult: 0, youth: 0, child: 0, free: true };
  }
  const numbers = str.match(/\d+/g);
  if (numbers && numbers.length > 0) {
    const price = parseInt(numbers[0], 10) || 0;
    return { adult: price, youth: Math.floor(price * 0.7), child: Math.floor(price * 0.5), free: price === 0 };
  }
  return { adult: 0, youth: 0, child: 0, free: true };
}

function parseXmlItems(xmlText, itemTag = 'item') {
  const items = [];
  const itemRegex = new RegExp(`<${itemTag}>([\\s\\S]*?)<\\/${itemTag}>`, 'gi');
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const inner = match[1];
    const item = {};
    const tagRegex = /<([^>\/\s]+)>([\s\S]*?)<\/\1>/g;
    let tagMatch;
    while ((tagMatch = tagRegex.exec(inner)) !== null) {
      const tagName = tagMatch[1];
      let tagValue = tagMatch[2];
      tagValue = tagValue.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      item[tagName] = tagValue;
    }
    if (Object.keys(item).length > 0) items.push(item);
  }
  return items;
}

function normalizeText(value) {
  if (!value) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickVenueName(raw) {
  if (!raw) return '국립현대미술관 (서울)';
  // applyVenueAlias를 사용하여 정규화
  const aliased = applyVenueAlias(raw);
  if (aliased && aliased !== raw) return aliased;
  if (raw.includes('국립현대미술관')) {
    // 분관 구분
    if (raw.includes('서울') || raw.includes('삼청동')) return '국립현대미술관 (서울)';
    if (raw.includes('과천')) return '국립현대미술관 (과천)';
    if (raw.includes('덕수궁')) return '국립현대미술관 (덕수궁)';
    if (raw.includes('청주')) return '국립현대미술관 (청주)';
    return '국립현대미술관 (서울)';
  }
  return raw.trim();
}

async function resolveVenueInfo(name) {
  if (!name) return null;
  const exact = await Venue.findOne({ name }).lean();
  if (exact?.location?.lat && exact?.location?.lng) {
    return {
      name: exact.name,
      address: exact.address || exact.name,
      location: exact.location,
      barrierFree: exact.barrierFree || {}
    };
  }
  if (name !== '국립현대미술관') {
    const fallback = await Venue.findOne({ name: '국립현대미술관' }).lean();
    if (fallback?.location?.lat && fallback?.location?.lng) {
      return {
        name,
        address: fallback.address || name,
        location: fallback.location,
        barrierFree: fallback.barrierFree || {}
      };
    }
  }
  return null;
}

export async function fetchMocaExhibitions({ rows = 200 } = {}) {
  if (!MOCA_API_KEY) {
    console.warn('[MOCA] Missing MOCA_API_KEY, skipping...');
    return [];
  }

  const params = new URLSearchParams({
    serviceKey: MOCA_API_KEY,
    pageNo: '1',
    numOfRows: String(rows)
  });
  const url = `${API_BASE_URL}?${params.toString()}`;
  console.log('[MOCA] Fetching exhibitions...');

  const res = await fetch(url, { headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`MOCA request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  const items = parseXmlItems(text, 'item');
  const results = [];
  const now = new Date();

  for (const item of items) {
    const title = normalizeText(item.title || item.TITLE);
    if (!title) continue;
    const rawVenue = normalizeText(item.venue || item.VENUE || item.place || item.PLACE || '국립현대미술관');
    const venueName = pickVenueName(rawVenue);
    const period = parseDateRange(item.eventPeriod || item.EVENT_PERIOD || '');
    if (!period.start || !period.end) continue;
    if (!(now >= period.start && now <= period.end)) continue;

    const venueInfo = await resolveVenueInfo(venueName);
    const address = venueInfo?.address || venueName;

    results.push({
      title,
      period: { start: period.start, end: period.end },
      periodUnknown: false,
      venue: {
        name: venueName,
        address,
        location: venueInfo?.location
      },
      price: parsePrice(item.charge || item.CHARGE || ''),
      barrierFree: {
        wheelchair: !!venueInfo?.barrierFree?.wheelchair,
        elevator: !!venueInfo?.barrierFree?.elevator,
        braille: !!venueInfo?.barrierFree?.braille,
        audioGuide: !!venueInfo?.barrierFree?.audioGuide
      },
      website: normalizeText(item.url || item.URL || ''),
      description: normalizeText(item.subDescription || item.SUB_DESCRIPTION || item.description || item.DESCRIPTION || ''),
      images: [],
      artists: [],
      stats: { averageRating: 0, reviewCount: 0 },
      _source: 'moca',
      _apiId: `moca-${title}-${venueName}-${period.start.toISOString()}`
    });
  }

  console.log(`[MOCA] Final results: ${results.length}`);
  return results;
}
