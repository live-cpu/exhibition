import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { fetchBraveVenueInfo } from './braveSearch.js';
import { fetchNaverVenueInfo } from './naverExhibitionSearch.js';
import { applyVenueAlias, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const API_KEY = process.env.UNIFIED_EXHIBITION_API_KEY;
const API_BASE_URL = 'https://api.kcisa.kr/openapi/API_CCA_145/request';
const EXTERNAL_ENRICH_ENABLED = String(process.env.EXTERNAL_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const UPCOMING_WINDOW_DAYS = Number(process.env.UPCOMING_WINDOW_DAYS || 7);
const VENUE_REFRESH_DAYS = Number(process.env.VENUE_REFRESH_DAYS || 7);

const venueCache = new Map();

function parseSimpleXML(xmlText) {
  try {
    const items = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi);

    if (itemMatches) {
      itemMatches.forEach((itemXml) => {
        const item = {};
        const innerXml = itemXml.replace(/^<item>|<\/item>$/gi, '');
        const tagPattern = /<([^>\/\s]+)>([\s\S]*?)<\/\1>/g;
        let match;

        while ((match = tagPattern.exec(innerXml)) !== null) {
          const tagName = match[1];
          let tagValue = match[2];
          tagValue = tagValue.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
          item[tagName] = tagValue;
        }

        if (Object.keys(item).length > 0) {
          items.push(item);
        }
      });
    }

    return { response: { body: { items } } };
  } catch (err) {
    console.error('[UnifiedAPI] XML parse error:', err);
    return { response: { body: { items: [] } } };
  }
}

function parsePeriod(periodStr) {
  if (!periodStr) return { start: null, end: null };
  const raw = String(periodStr).trim();
  if (!raw) return { start: null, end: null };

  const normalized = raw.replace(/\./g, '-');
  const match = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})\s*[~\-]\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (match) {
    return { start: new Date(match[1]), end: new Date(match[2]) };
  }

  const compact = raw.match(/(\d{8})\s*[~\-]\s*(\d{8})/);
  if (compact) {
    const start = `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}`;
    const end = `${compact[2].slice(0, 4)}-${compact[2].slice(4, 6)}-${compact[2].slice(6, 8)}`;
    return { start: new Date(start), end: new Date(end) };
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

function isPermanentExhibition(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  return text.includes('상설') || text.includes('상설전');
}

function extractVenueCore(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/(.+?(박물관|미술관|문화전당|문화회관|예술의전당|아트센터|아트센터|아트스페이스|센터|갤러리|전당))/);
  return match ? match[1].trim() : text;
}

function normalizeEventSite(eventSite, cntcInsttNm, contributor) {
  const raw = String(eventSite || '').trim();
  const inst = String(cntcInsttNm || '').trim();
  const contrib = String(contributor || '').trim();
  if (!raw) return inst || contrib;

  const generic = [
    '해외', '국외', '국내', '온라인',
    '기획전시실', '기획전시실1', '기획전시실2',
    '상설전시관', '상설전시실', '본관', '별관'
  ];
  if (generic.includes(raw)) return inst || contrib || raw;

  // 먼저 고급 정규화 적용
  const advancedNormalized = normalizeVenueNameAdvanced(raw);
  if (advancedNormalized && advancedNormalized !== raw) {
    return advancedNormalized;
  }

  // MMCA 분관 처리
  if (raw.includes('과천')) return inst || '국립현대미술관 (과천)';
  if (raw.includes('덕수궁')) return inst || '국립현대미술관 (덕수궁)';
  if (raw.includes('청주')) return inst || '국립현대미술관 (청주)';
  if (raw.includes('서울') || raw.includes('삼청동')) return inst || '국립현대미술관 (서울)';

  // ACC 처리
  if (raw.includes('문화창조원') || raw.includes('아시아문화박물관') || /acc/i.test(raw)) {
    return '국립아시아문화전당';
  }

  const stripped = extractVenueCore(raw)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (inst && !stripped.includes(inst) && stripped.length <= 12) return inst;
  if (contrib && stripped.length <= 8) return contrib;

  if (inst) {
    const instCore = extractVenueCore(inst);
    if (stripped.includes(instCore)) return instCore;
  }

  return stripped || inst || contrib;
}

function shouldRefreshVenue(existing) {
  if (!existing?.updatedAt) return true;
  const updated = new Date(existing.updatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  const ageMs = Date.now() - updated.getTime();
  return ageMs > VENUE_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeVenueName(name) {
  if (!name) return '';
  return String(name).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractParenValue(name) {
  const match = String(name || '').match(/\(([^)]+)\)/);
  return match ? match[1].trim() : '';
}

function buildFlexibleRegex(value) {
  if (!value) return null;
  const escaped = String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped.replace(/\s+/g, '\\s*');
  return new RegExp(flexible, 'i');
}

function getVenueNameCandidates(rawName) {
  if (!rawName) return [];
  const base = normalizeVenueName(rawName);
  const paren = extractParenValue(rawName);
  const candidates = new Set();
  if (base) candidates.add(base);
  if (paren && base) {
    candidates.add(`${paren} ${base}`);
    candidates.add(`${base} ${paren}`);
    candidates.add(`${paren}${base}`);
    candidates.add(`${base}${paren}`);
  }
  return Array.from(candidates);
}

async function resolveVenueInfo(eventSite, cntcInsttNm) {
  const rawName = normalizeEventSite(eventSite, cntcInsttNm, '');
  const aliased = applyVenueAlias(rawName);
  const key = normalizeVenueName(aliased || rawName);
  if (!key) return null;
  if (venueCache.has(key)) return venueCache.get(key);

  const candidates = getVenueNameCandidates(aliased || rawName);
  const regexList = candidates.map(buildFlexibleRegex).filter(Boolean);
  const existing = regexList.length
    ? await Venue.findOne({ $or: regexList.map((regex) => ({ name: { $regex: regex } })) }).lean()
    : await Venue.findOne({ name: key }).lean();

  if (existing?.location?.lat && existing?.location?.lng) {
    const info = {
      name: existing.name,
      address: existing.address || existing.name,
      location: existing.location,
      region: existing.region,
      barrierFree: existing.barrierFree || {}
    };
    venueCache.set(key, info);
    return info;
  }

  const needsLocation = !(existing?.location?.lat && existing?.location?.lng);
  if (!EXTERNAL_ENRICH_ENABLED || (!needsLocation && !shouldRefreshVenue(existing))) {
    venueCache.set(key, null);
    return null;
  }

  const naverInfo = await fetchNaverVenueInfo(aliased || rawName);
  if (naverInfo && existing) {
    const update = {};
    if (!existing.address && naverInfo.address) update.address = naverInfo.address;
    const bf = {};
    if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = !!naverInfo.barrierFree?.wheelchair;
    if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = !!naverInfo.barrierFree?.elevator;
    if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = !!naverInfo.barrierFree?.braille;
    if (typeof existing.barrierFree?.audioGuide === 'undefined') bf.audioGuide = !!naverInfo.barrierFree?.audioGuide;
    if (typeof existing.barrierFree?.accessibleToilet === 'undefined') bf.accessibleToilet = !!naverInfo.barrierFree?.accessibleToilet;
    if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!naverInfo.barrierFree?.parkingPaid;
    if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!naverInfo.barrierFree?.parkingFree;
    if (Object.keys(bf).length) update.barrierFree = { ...existing.barrierFree, ...bf };
    if (Object.keys(update).length) {
      update.updatedAt = new Date();
      await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
    }
  }

  const braveInfo = await fetchBraveVenueInfo(aliased || rawName);
  if (braveInfo?.location) {
    const update = {};
    if (!existing) {
      await Venue.create({
        name: key,
        address: braveInfo.address || '',
        location: braveInfo.location,
        barrierFree: {
          wheelchair: !!braveInfo.barrierFree?.wheelchair,
          elevator: !!braveInfo.barrierFree?.elevator,
          braille: !!braveInfo.barrierFree?.braille,
          audioGuide: !!braveInfo.barrierFree?.audioGuide,
          accessibleToilet: !!braveInfo.barrierFree?.accessibleToilet,
          parkingPaid: !!braveInfo.barrierFree?.parkingPaid,
          parkingFree: !!braveInfo.barrierFree?.parkingFree
        },
        updatedAt: new Date()
      });
    } else {
      if (!existing.address && braveInfo.address) update.address = braveInfo.address;
      if (!existing.location?.lat || !existing.location?.lng) update.location = braveInfo.location;
      const bf = {};
      if (typeof existing.barrierFree?.wheelchair === 'undefined') bf.wheelchair = !!braveInfo.barrierFree?.wheelchair;
      if (typeof existing.barrierFree?.elevator === 'undefined') bf.elevator = !!braveInfo.barrierFree?.elevator;
      if (typeof existing.barrierFree?.braille === 'undefined') bf.braille = !!braveInfo.barrierFree?.braille;
      if (typeof existing.barrierFree?.audioGuide === 'undefined') bf.audioGuide = !!braveInfo.barrierFree?.audioGuide;
      if (typeof existing.barrierFree?.accessibleToilet === 'undefined') bf.accessibleToilet = !!braveInfo.barrierFree?.accessibleToilet;
      if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!braveInfo.barrierFree?.parkingPaid;
      if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!braveInfo.barrierFree?.parkingFree;
      if (Object.keys(bf).length) update.barrierFree = { ...existing.barrierFree, ...bf };
      if (Object.keys(update).length) {
        update.updatedAt = new Date();
        await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
      }
    }

    const info = {
      name: existing?.name || key,
      address: braveInfo.address || existing?.address || key,
      location: braveInfo.location,
      region: existing?.region,
      barrierFree: existing?.barrierFree || braveInfo.barrierFree || {}
    };
    venueCache.set(key, info);
    return info;
  }

  venueCache.set(key, null);
  return null;
}

function transformExhibitionItem(item) {
  if (!item || typeof item !== 'object') return null;

  const title = (item.TITLE || item.title || '').trim();
  if (!title) return null;

  const eventSite = (item.EVENT_SITE || '').trim();
  const cntcInsttNm = (item.CNTC_INSTT_NM || '').trim();
  const contributor = (item.CONTRIBUTOR || '').trim();
  const period = parsePeriod(item.PERIOD || '');
  const price = parsePrice(item.CHARGE || '');

  return {
    title,
    eventSite,
    cntcInsttNm,
    contributor,
    period,
    price,
    duration: (item.DURATION || '').trim(),
    eventPeriod: (item.EVENT_PERIOD || '').trim(),
    description: (item.DESCRIPTION || item.SUB_DESCRIPTION || '').trim(),
    url: (item.URL || '').trim(),
    imageUrl: (item.IMAGE_OBJECT || '').trim(),
    localId: (item.LOCAL_ID || '').trim(),
    genre: (item.GENRE || '전시').trim()
  };
}

export async function fetchUnifiedExhibitions(params = {}) {
  if (!API_KEY) {
    console.warn('[UnifiedAPI] Missing UNIFIED_EXHIBITION_API_KEY, skipping...');
    return [];
  }

  const { page = 1, rows = 500, maxResults = 100 } = params;

  const queryParams = new URLSearchParams({
    serviceKey: API_KEY,
    pageNo: page.toString(),
    numOfRows: rows.toString()
  });

  const url = `${API_BASE_URL}?${queryParams.toString()}`;
  console.log('[UnifiedAPI] Fetching from API...');

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('xml') || contentType.includes('text')) {
      const xmlText = await response.text();
      data = parseSimpleXML(xmlText);
    } else {
      data = await response.json();
    }

    let items = [];
    if (data.response?.body?.items) {
      const itemsData = data.response.body.items;
      if (Array.isArray(itemsData)) {
        items = itemsData;
      } else if (Array.isArray(itemsData.item)) {
        items = itemsData.item;
      } else if (itemsData.item) {
        items = [itemsData.item];
      }
    } else if (data.items) {
      items = Array.isArray(data.items) ? data.items : [data.items];
    } else if (Array.isArray(data)) {
      items = data;
    }

    const transformed = items.map(transformExhibitionItem).filter(Boolean);
    const now = new Date();
    const upcomingLimit = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const filtered = transformed.filter((item) => {
      const start = item.period.start;
      const end = item.period.end;
      const permanent = isPermanentExhibition(item.title, item.description);
      if (!start || !end) return permanent;
      if (now >= start && now <= end) return true;
      return start > now && start <= upcomingLimit;
    });

    const limited = filtered.slice(0, maxResults);
    const results = [];
    for (const item of limited) {
      const venueInfo = await resolveVenueInfo(
        normalizeEventSite(item.eventSite, item.cntcInsttNm, item.contributor),
        item.cntcInsttNm
      );
      const venueName = venueInfo?.name || normalizeVenueName(item.eventSite || item.cntcInsttNm || '');
      const periodUnknown = !(item.period.start && item.period.end);

      results.push({
        title: item.title,
        period: { start: item.period.start, end: item.period.end },
        periodUnknown,
        openHours: {
          weekday: item.duration || item.eventPeriod || '',
          weekend: item.duration || item.eventPeriod || '',
          closed: []
        },
        venue: {
          name: venueName || 'Unknown venue',
          address: venueInfo?.address || venueName || '',
          location: venueInfo?.location
        },
        price: item.price,
        barrierFree: {
          wheelchair: !!venueInfo?.barrierFree?.wheelchair,
          elevator: !!venueInfo?.barrierFree?.elevator,
          braille: !!venueInfo?.barrierFree?.braille,
          audioGuide: !!venueInfo?.barrierFree?.audioGuide
        },
        website: item.url || '',
        artists: [],
        description: item.description || '',
        images: item.imageUrl ? [item.imageUrl] : [],
        genre: item.genre || '전시',
        stats: { averageRating: 0, reviewCount: 0 },
        _source: 'unified_exhibition_api',
        _apiId: item.localId || `unified-${item.title}-${venueName}`
      });
    }

    console.log(`[UnifiedAPI] Final results: ${results.length}`);
    return results;
  } catch (err) {
    console.error('[UnifiedAPI] API error:', err.message);
    return [];
  }
}

export function clearVenueCache() {
  venueCache.clear();
}
