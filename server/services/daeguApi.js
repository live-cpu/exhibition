import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { fetchBraveVenueInfo } from './braveSearch.js';
import { fetchNaverVenueInfo } from './naverExhibitionSearch.js';
import { applyVenueAlias, normalizeVenueName, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const DAEGU_API_KEY = process.env.DAEGU_API_KEY;
const DAEGU_API_BASE_URL = process.env.DAEGU_API_BASE_URL || '';
const DAEGU_DGFCA_BASE_URL = process.env.DAEGU_DGFCA_BASE_URL || 'https://dgfca.or.kr/api/daegu/cultural-events';
const EXTERNAL_ENRICH_ENABLED = String(process.env.EXTERNAL_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const UPCOMING_WINDOW_DAYS = Number(process.env.UPCOMING_WINDOW_DAYS || 7);
const VENUE_REFRESH_DAYS = Number(process.env.VENUE_REFRESH_DAYS || 7);

const venueCache = new Map();

function parseSimpleXML(xmlText) {
  try {
    const items = [];
    const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi)
      || xmlText.match(/<list>([\s\S]*?)<\/list>/gi);

    if (itemMatches) {
      itemMatches.forEach((itemXml) => {
        const item = {};
        const innerXml = itemXml.replace(/^<item>|<\/item>$/gi, '')
          .replace(/^<list>|<\/list>$/gi, '');
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

    return items;
  } catch (err) {
    console.error('[DaeguAPI] XML parse error:', err.message);
    return [];
  }
}

async function resolveVenueInfo(eventSite) {
  // 먼저 고급 정규화 적용
  const advancedNormalized = normalizeVenueNameAdvanced(eventSite);
  const aliased = applyVenueAlias(advancedNormalized || eventSite);
  const key = normalizeVenueName(aliased || advancedNormalized || eventSite || '');
  if (!key) return null;
  if (venueCache.has(key)) return venueCache.get(key);

  const existing = await Venue.findOne({ name: key }).lean();
  if (existing?.location?.lat && existing?.location?.lng) {
    const cached = {
      name: existing.name,
      address: existing.address,
      location: existing.location,
      barrierFree: existing.barrierFree || {}
    };
    venueCache.set(key, cached);
    return cached;
  }

  const needsLocation = !(existing?.location?.lat && existing?.location?.lng);
  if (!EXTERNAL_ENRICH_ENABLED || (!needsLocation && !shouldRefreshVenue(existing))) {
    venueCache.set(key, null);
    return null;
  }

  const naverInfo = await fetchNaverVenueInfo(aliased || eventSite);
  if (naverInfo?.address || naverInfo?.location) {
    const info = {
      name: existing?.name || key,
      address: naverInfo.address || existing?.address || key,
      location: naverInfo.location || existing?.location,
      barrierFree: existing?.barrierFree || naverInfo.barrierFree || {}
    };
    if (!existing && info.location?.lat && info.location?.lng) {
      await Venue.create({
        name: info.name,
        address: info.address || info.name,
        location: info.location,
        barrierFree: info.barrierFree || {},
        updatedAt: new Date()
      });
    }
    venueCache.set(key, info);
    return info;
  }

  const braveInfo = await fetchBraveVenueInfo(aliased || eventSite);
  if (braveInfo?.location) {
    const info = {
      name: existing?.name || key,
      address: braveInfo.address || existing?.address || key,
      location: braveInfo.location,
      barrierFree: existing?.barrierFree || braveInfo.barrierFree || {}
    };
    if (!existing && info.location?.lat && info.location?.lng) {
      await Venue.create({
        name: info.name,
        address: info.address || info.name,
        location: info.location,
        barrierFree: info.barrierFree || {},
        updatedAt: new Date()
      });
    }
    venueCache.set(key, info);
    return info;
  }

  venueCache.set(key, null);
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(`${compact[1]}-${compact[2]}-${compact[3]}`);
  }
  const normalized = raw.replace(/\./g, '-');
  const match = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  return match ? new Date(match[1]) : null;
}

function extractString(item, keys) {
  for (const key of keys) {
    if (item && typeof item[key] !== 'undefined') {
      const value = String(item[key]).trim();
      if (value) return value;
    }
  }
  return '';
}

function isExhibitionCandidate(item) {
  const eventGubun = extractString(item, ['event_gubun', 'EVENT_GUBUN']);
  if (eventGubun) {
    const text = eventGubun.toLowerCase();
    return text.includes('전시'); // 전시만 포함
  }
  const category = extractString(item, [
    'category', 'CATEGORY', 'genre', 'GENRE', 'type', 'TYPE', 'eventType', 'EVENT_TYPE'
  ]);
  if (!category) return true;
  const text = category.toLowerCase();
  return text.includes('exhibition') || text.includes('전시');
}

function isPermanentExhibition(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  return text.includes('상설') || text.includes('상설전');
}

function shouldRefreshVenue(existing) {
  if (!existing?.updatedAt) return true;
  const updated = new Date(existing.updatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  const ageMs = Date.now() - updated.getTime();
  return ageMs > VENUE_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

function buildExhibitionFromItem(item, source) {
  if (!item || typeof item !== 'object') return null;
  if (!isExhibitionCandidate(item)) return null;

  const title = extractString(item, [
    'title', 'TITLE', 'subject', 'SUBJECT', 'exhibitName', 'EXHIBIT_NAME',
    'eventName', 'EVENT_NAME', 'exhibitionName', 'EXHIBITION_NAME', 'PRF_NM'
  ]);
  if (!title) return null;

  const venueName = extractString(item, [
    'place', 'PLACE', 'placeName', 'PLACE_NAME', 'venue', 'VENUE', 'facility', 'FACILITY',
    'eventSite', 'EVENT_SITE', 'hallName', 'HALL_NAME', 'location', 'LOCATION', 'placeNm', 'PLACENM'
  ]);
  if (!venueName) return null;

  const startRaw = extractString(item, [
    'startDate', 'STARTDATE', 'start', 'START', 'from', 'FROM', 'start_dt', 'STRTDATE',
    'start_date', 'START_DATE'
  ]);
  const endRaw = extractString(item, [
    'endDate', 'ENDDATE', 'end', 'END', 'to', 'TO', 'end_dt',
    'end_date', 'END_DATE'
  ]);
  const start = parseDate(startRaw);
  const end = parseDate(endRaw);

  const image = extractString(item, [
    'thumbnail', 'THUMBNAIL', 'image', 'IMAGE', 'imgUrl', 'IMGURL', 'poster', 'POSTER', 'MAIN_IMG'
  ]);
  const url = extractString(item, ['url', 'URL', 'homepage', 'HOMEPAGE', 'link', 'LINK', 'ORG_LINK']);
  const description = extractString(item, ['description', 'DESCRIPTION', 'contents', 'CONTENTS', 'summary', 'SUMMARY']);
  const contact = extractString(item, ['contact', 'CONTACT', 'tel', 'TEL']);

  return {
    base: {
      title,
      venueName,
      period: { start, end },
      description,
      image,
      url,
      contact
    },
    source
  };
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[\s\W]+/g, '')
    .trim();
}

function dedupeByTitleVenue(list) {
  const seen = new Set();
  const results = [];
  for (const item of list) {
    const key = `${normalizeKey(item.base.title)}|${normalizeKey(item.base.venueName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }
  return results;
}

async function finalizeItems(items, source) {
  const now = new Date();
  const upcomingLimit = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const results = [];
  for (const item of items) {
    const base = item.base;
    const start = base.period.start;
    const end = base.period.end;
    const periodUnknown = !(start && end);
    const permanent = isPermanentExhibition(base.title, base.description);
    if (!periodUnknown) {
      if (now >= start && now <= end) {
        // ongoing
      } else if (start > now && start <= upcomingLimit) {
        // upcoming
      } else {
        continue;
      }
    } else if (!permanent) {
      continue;
    }

    const venueInfo = await resolveVenueInfo(base.venueName);
    const venueName = venueInfo?.name || base.venueName;

    results.push({
      title: base.title,
      period: { start, end },
      periodUnknown,
      openHours: {
        weekday: '',
        weekend: '',
        closed: []
      },
      venue: {
        name: venueName,
        address: venueInfo?.address || base.venueName,
        location: venueInfo?.location
      },
      price: { adult: 0, youth: 0, child: 0, free: true },
      barrierFree: {
        wheelchair: !!venueInfo?.barrierFree?.wheelchair,
        elevator: !!venueInfo?.barrierFree?.elevator,
        braille: !!venueInfo?.barrierFree?.braille,
        audioGuide: !!venueInfo?.barrierFree?.audioGuide
      },
      website: base.url || '',
      artists: [],
      description: base.description || '',
      images: base.image ? [base.image] : [],
      contact: base.contact || '',
      stats: { averageRating: 0, reviewCount: 0 },
      _source: source,
      _apiId: `${source}-${base.title}-${venueName}-${start ? start.toISOString() : ''}`
    });
  }
  return results;
}

async function fetchDaeguOpenApiRaw({ page = 1, rows = 100 } = {}) {
  if (!DAEGU_API_BASE_URL || !DAEGU_API_KEY) {
    console.warn('[DaeguAPI] Missing DAEGU_API_BASE_URL or DAEGU_API_KEY, skipping...');
    return [];
  }

  const queryParams = new URLSearchParams({
    serviceKey: DAEGU_API_KEY,
    pageNo: page.toString(),
    numOfRows: rows.toString()
  });

  const url = `${DAEGU_API_BASE_URL}?${queryParams.toString()}`;
  console.log(`[DaeguAPI] Fetching open data: ${url}`);

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    throw new Error(`Daegu open API request failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    return await response.json();
  }
  const xmlText = await response.text();
  return parseSimpleXML(xmlText);
}

function coerceItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.items?.item) {
    return Array.isArray(payload.items.item) ? payload.items.item : [payload.items.item];
  }
  if (payload.response?.body?.items) {
    const items = payload.response.body.items;
    if (Array.isArray(items)) return items;
    if (items.item) return Array.isArray(items.item) ? items.item : [items.item];
  }
  if (payload.data) {
    return Array.isArray(payload.data) ? payload.data : [payload.data];
  }
  return [];
}

export async function fetchDaeguOpenApiExhibitions(params = {}) {
  try {
    const payload = await fetchDaeguOpenApiRaw(params);
    const items = coerceItems(payload);
    const mapped = items.map((item) => buildExhibitionFromItem(item, 'daegu_api')).filter(Boolean);
    const deduped = dedupeByTitleVenue(mapped);
    return await finalizeItems(deduped, 'daegu_api');
  } catch (err) {
    console.error('[DaeguAPI] Open API error:', err.message);
    return [];
  }
}

export async function fetchDaeguDgfcaExhibitions() {
  try {
    const response = await fetch(DAEGU_DGFCA_BASE_URL, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      throw new Error(`Daegu DGFCA request failed: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json();
    const items = coerceItems(payload);
    const mapped = items.map((item) => buildExhibitionFromItem(item, 'daegu_dgfca')).filter(Boolean);
    const deduped = dedupeByTitleVenue(mapped);
    return await finalizeItems(deduped, 'daegu_dgfca');
  } catch (err) {
    console.error('[DaeguAPI] DGFCA error:', err.message);
    return [];
  }
}
