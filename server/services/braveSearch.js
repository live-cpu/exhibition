import dotenv from 'dotenv';
dotenv.config();

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BRAVE_API_BASE_URL = 'https://api.search.brave.com/res/v1/web/search';
const BRAVE_ENABLED = String(process.env.BRAVE_ENABLED ?? 'true').toLowerCase() === 'true';
const BRAVE_MAX_CALLS_PER_RUN = Number(process.env.BRAVE_MAX_CALLS_PER_RUN || 100);
const BRAVE_MAX_CALLS_PER_DAY = Number(process.env.BRAVE_MAX_CALLS_PER_DAY || 300);
let braveCallsUsed = 0;
let braveCallsDateKey = getLocalDateKey();

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resetBraveCounterIfNeeded() {
  const today = getLocalDateKey();
  if (today !== braveCallsDateKey) {
    braveCallsDateKey = today;
    braveCallsUsed = 0;
  }
}

function canUseBrave() {
  resetBraveCounterIfNeeded();
  if (!BRAVE_ENABLED) return false;
  if (!BRAVE_API_KEY) return false;
  if (braveCallsUsed >= BRAVE_MAX_CALLS_PER_RUN) return false;
  if (braveCallsUsed >= BRAVE_MAX_CALLS_PER_DAY) return false;
  braveCallsUsed += 1;
  return true;
}

export function consumeBraveQuota() {
  return canUseBrave();
}

function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractAddress(text) {
  if (!text) return '';
  const value = String(text);
  const patterns = [
    /([가-힣]{2,}(?:시|도)\s*[가-힣]{1,}(?:구|군)?\s*[가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/,
    /([가-힣]{2,}(?:시|도)\s*[가-힣]{1,}(?:구|군)?\s*[가-힣0-9\-]+(?:읍|면)\s*[가-힣0-9\-]+)/,
    /([가-힣]{2,}(?:구|군)\s*[가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/,
    /([가-힣0-9\-]+(?:로|길)\s*\d+(?:-\d+)?)/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1].trim();
  }
  return '';
}

function detectBarrierFree(text) {
  const t = String(text || '').toLowerCase();
  const hasWheelchair = /휠체어|wheelchair|장애인/.test(t);
  const hasElevator = /엘리베이터|승강기|elevator/.test(t);
  const hasBraille = /점자|braille/.test(t);
  const hasAudio = /오디오|음성안내|audio/.test(t);
  const hasAccessibleToilet = /장애인\s*화장실|화장실\s*장애인/.test(t);
  const hasParkingPaid = /유료\s*주차|주차\s*유료|주차요금/.test(t);
  const hasParkingFree = /무료\s*주차|주차\s*무료/.test(t);
  return {
    wheelchair: hasWheelchair,
    elevator: hasElevator,
    braille: hasBraille,
    audioGuide: hasAudio,
    accessibleToilet: hasAccessibleToilet,
    parkingPaid: hasParkingPaid,
    parkingFree: hasParkingFree
  };
}

function extractOpenHours(text) {
  if (!text) return '';
  const value = String(text);
  const timeMatch = value.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
  const closedMatch = value.match(/(월|화|수|목|금|토|일)\s*휴관|휴관\s*:\s*(월|화|수|목|금|토|일)/);
  if (!timeMatch && !closedMatch) return '';
  let result = '';
  if (timeMatch) {
    result = `${timeMatch[1]}~${timeMatch[2]}`;
  }
  if (closedMatch) {
    const day = closedMatch[1] || closedMatch[2];
    result = result ? `${result} (${day} 휴관)` : `${day} 휴관`;
  }
  return result;
}

async function geocodeAddress(address) {
  if (!address) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=kr`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ArtMap/1.0 (contact: dev)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const { lat, lon } = data[0];
    const latNum = Number(lat);
    const lngNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
    return { lat: latNum, lng: lngNum };
  } catch (err) {
    return null;
  }
}

export async function fetchBraveDescription(query) {
  if (!query || !canUseBrave()) return '';

  try {
    const url = new URL(BRAVE_API_BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '3');
    url.searchParams.set('extra_snippets', 'true');
    url.searchParams.set('country', 'KR');
    url.searchParams.set('search_lang', 'ko');

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) return '';

    const data = await response.json();
    const results = data?.web?.results || [];
    if (results.length === 0) return '';

    const candidate = results.find(r => (r.description && r.description.trim()) || (r.extra_snippets && r.extra_snippets.length > 0));
    if (!candidate) return '';

    const raw = candidate.description || candidate.extra_snippets?.[0] || '';
    const cleaned = stripHtml(raw);
    return cleaned.length > 600 ? `${cleaned.slice(0, 600)}...` : cleaned;
  } catch (err) {
    return '';
  }
}

export async function fetchBraveImageUrls(query, limit = 2) {
  if (!query || !canUseBrave()) return [];

  try {
    const url = new URL(BRAVE_API_BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('extra_snippets', 'true');
    url.searchParams.set('country', 'KR');
    url.searchParams.set('search_lang', 'ko');

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) return [];

    const data = await response.json();
    const results = data?.web?.results || [];
    const images = results
      .map((r) => r?.thumbnail?.src)
      .filter(Boolean);

    return images.slice(0, Math.max(0, limit));
  } catch (err) {
    return [];
  }
}

export async function fetchBraveVenueInfo(venueName) {
  if (!venueName || !canUseBrave()) return { address: '', location: null, barrierFree: {}, openHours: '' };

  try {
    const url = new URL(BRAVE_API_BASE_URL);
    url.searchParams.set('q', `${venueName} 주소 운영시간 주차 장애인 화장실 휠체어 엘리베이터 점자 음성안내`);
    url.searchParams.set('count', '5');
    url.searchParams.set('extra_snippets', 'true');
    url.searchParams.set('country', 'KR');
    url.searchParams.set('search_lang', 'ko');

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { address: '', location: null, barrierFree: {}, openHours: '' };
    }

    const data = await response.json();
    const results = data?.web?.results || [];
    const candidatesText = results
      .map(r => `${r.title || ''} ${r.description || ''} ${(r.extra_snippets || []).join(' ')}`)
      .join(' ');

    const address = extractAddress(candidatesText);
    const barrierFree = detectBarrierFree(candidatesText);
    const openHours = extractOpenHours(candidatesText);
    const geocodeQueries = [
      address,
      `${venueName} 문화공간`,
      `${venueName} 전시`,
      `${venueName} 갤러리`
    ].filter(Boolean);
    let location = null;
    for (const query of geocodeQueries) {
      location = await geocodeAddress(query);
      if (location) break;
    }

    return {
      address: address || '',
      location,
      barrierFree,
      openHours: openHours || ''
    };
  } catch (err) {
    return { address: '', location: null, barrierFree: {}, openHours: '' };
  }
}

export async function fetchBraveExhibitionAccessibility(title, venueName = '') {
  if (!title || !canUseBrave()) return { braille: false, audioGuide: false };

  try {
    const url = new URL(BRAVE_API_BASE_URL);
    url.searchParams.set('q', `${title} ${venueName} 점자 음성안내`);
    url.searchParams.set('count', '5');
    url.searchParams.set('extra_snippets', 'true');
    url.searchParams.set('country', 'KR');
    url.searchParams.set('search_lang', 'ko');

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return { braille: false, audioGuide: false };
    }

    const data = await response.json();
    const results = data?.web?.results || [];
    const candidatesText = results
      .map(r => `${r.title || ''} ${r.description || ''} ${(r.extra_snippets || []).join(' ')}`)
      .join(' ');

    const barrier = detectBarrierFree(candidatesText);
    return {
      braille: !!barrier.braille,
      audioGuide: !!barrier.audioGuide
    };
  } catch (err) {
    return { braille: false, audioGuide: false };
  }
}

export async function fetchBraveExhibitionPeriod(query) {
  if (!query || !canUseBrave()) return null;

  try {
    const url = new URL(BRAVE_API_BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('count', '5');
    url.searchParams.set('extra_snippets', 'true');
    url.searchParams.set('country', 'KR');
    url.searchParams.set('search_lang', 'ko');

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const results = data?.web?.results || [];
    const candidatesText = results
      .map(r => `${r.title || ''} ${r.description || ''} ${(r.extra_snippets || []).join(' ')}`)
      .join(' ');

    return parsePeriodFromText(candidatesText);
  } catch (err) {
    return null;
  }
}

export function parsePeriodFromText(text) {
  if (!text) return null;
  const value = String(text);
  const now = new Date();
  const currentYear = now.getFullYear();

  const openEndedKeywords = /(상설|상설전|상설전시|기획전 상설)/;
  if (openEndedKeywords.test(value)) {
    return { start: now, end: new Date(2099, 11, 31) };
  }

  const normalizeYear = (yearValue) => {
    const yearNum = Number(yearValue);
    if (!Number.isFinite(yearNum)) return currentYear;
    if (yearNum < 100) return 2000 + yearNum;
    return yearNum;
  };

  const normalizeDate = (year, month, day) => {
    const y = normalizeYear(year);
    const m = Number(month);
    const d = Number(day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const patterns = [
    /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*(?:~|-|–)\s*(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g,
    /(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*(?:~|-|–)\s*(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g,
    /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*(?:~|-|–)\s*(\d{1,2})[.\-\/](\d{1,2})/g,
    /(\d{1,2})[.\-\/](\d{1,2})\s*(?:~|-|–)\s*(\d{1,2})[.\-\/](\d{1,2})/g
  ];

  const ranges = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(value)) !== null) {
      let start = null;
      let end = null;

      if (match.length >= 7) {
        start = normalizeDate(match[1], match[2], match[3]);
        end = normalizeDate(match[4], match[5], match[6]);
      } else if (match.length >= 5) {
        const year = currentYear;
        start = normalizeDate(year, match[1], match[2]);
        end = normalizeDate(year, match[3], match[4]);
      }

      if (start && end && end >= start) {
        ranges.push({ start, end });
      }
    }
  }

  if (ranges.length > 0) {
    ranges.sort((a, b) => b.end.getTime() - a.end.getTime());
    return ranges[0];
  }

  return null;
}

