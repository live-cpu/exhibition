import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { fetchBraveVenueInfo } from './braveSearch.js';
import { fetchNaverVenueInfo } from './naverExhibitionSearch.js';
import { applyVenueAlias, normalizeVenueName, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const GG_API_KEY = process.env.GG_API_KEY || process.env.GGCULTURE_API_KEY || process.env.GG_CULTURE_API_KEY;
const API_BASE_URL = 'https://openapi.gg.go.kr/GGCULTUREVENTSTUS';
const UPCOMING_WINDOW_DAYS = Number(process.env.UPCOMING_WINDOW_DAYS || 7);
const EXTERNAL_ENRICH_ENABLED = String(process.env.EXTERNAL_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const VENUE_REFRESH_DAYS = Number(process.env.VENUE_REFRESH_DAYS || 7);

const venueCache = new Map();

function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/[./]/g, '-');
  const match = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  return match ? new Date(match[1]) : null;
}

function normalizeText(value) {
  if (!value) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

function shouldIncludeExhibitionByCategory(item) {
  const raw = item?.CATEGORY_NM || item?.CLSSF_NM || item?.DIVISION || item?.CULTURE_TYPE || item?.EVENT_GUBUN || item?.EVENT_TYPE;
  if (raw) {
    const text = String(raw).toLowerCase();
    // CATEGORY_NM가 있을 때는 전시만 허용
    if (item?.CATEGORY_NM && !(text.includes('전시') || text.includes('미술') || text.includes('exhibition'))) {
      return false;
    }
  }
  if (!raw) return true;
  const text = String(raw).toLowerCase();
  return text.includes('전시') || text.includes('미술') || text.includes('exhibition');
}

async function resolveVenueInfo(rawName) {
  // 먼저 고급 정규화 적용
  const advancedNormalized = normalizeVenueNameAdvanced(rawName);
  const aliased = applyVenueAlias(advancedNormalized || rawName || '');
  const name = normalizeVenueName(aliased || advancedNormalized || rawName || '');
  if (!name) return null;
  if (venueCache.has(name)) return venueCache.get(name);

  const existing = await Venue.findOne({ name }).lean();
  if (existing?.location?.lat && existing?.location?.lng) {
    const cached = {
      name: existing.name,
      address: existing.address || existing.name,
      location: existing.location,
      barrierFree: existing.barrierFree || {}
    };
    venueCache.set(name, cached);
    return cached;
  }

  const needsLocation = !(existing?.location?.lat && existing?.location?.lng);
  if (!EXTERNAL_ENRICH_ENABLED || (!needsLocation && !shouldRefreshVenue(existing))) {
    venueCache.set(name, null);
    return null;
  }

  const naverInfo = await fetchNaverVenueInfo(aliased || rawName);
  if (naverInfo?.address || naverInfo?.location) {
    const info = {
      name: existing?.name || name,
      address: naverInfo.address || existing?.address || name,
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
    venueCache.set(name, info);
    return info;
  }

  const braveInfo = await fetchBraveVenueInfo(aliased || rawName);
  if (braveInfo?.location) {
    const info = {
      name: existing?.name || name,
      address: braveInfo.address || existing?.address || name,
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
    venueCache.set(name, info);
    return info;
  }

  venueCache.set(name, null);
  return null;
}

export async function fetchGgCultureExhibitions({ rows = 100 } = {}) {
  if (!GG_API_KEY) {
    console.warn('[GGCULTURE] Missing GG_API_KEY, skipping...');
    return [];
  }
  const params = new URLSearchParams({
    KEY: GG_API_KEY,
    Type: 'json',
    pIndex: '1',
    pSize: String(rows)
  });
  const url = `${API_BASE_URL}?${params.toString()}`;
  console.log('[GGCULTURE] Fetching exhibitions...');

  const res = await fetch(url, { headers: { Accept: 'application/json, */*' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`GGCULTURE request failed: ${res.status} ${res.statusText}`);
  }
  const payload = await res.json();

  const blocks = payload?.GGCULTUREVENTSTUS || [];
  let rowsData = [];
  for (const block of blocks) {
    if (Array.isArray(block?.row)) {
      rowsData = block.row;
      break;
    }
  }
  if (!rowsData.length && Array.isArray(payload?.row)) rowsData = payload.row;

  const results = [];
  const now = new Date();
  const upcomingLimit = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  for (const item of rowsData) {
    if (!shouldIncludeExhibitionByCategory(item)) continue;
    const title = normalizeText(item.TITLE || item.title);
    if (!title) continue;
    const venueName = normalizeText(item.HOST_INST_NM || item.host_inst_nm || '');
    if (!venueName) continue;
    const start = parseDate(item.BEGIN_DE || item.BEGIN_DATE || item.START_DATE);
    const end = parseDate(item.END_DE || item.END_DATE || item.CLOSE_DATE);
    const periodUnknown = !(start && end);
    const permanent = isPermanentExhibition(title, item.PARTCPT_EXPN_INFO || item.DESCRIPTION || '');
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

    const venueInfo = await resolveVenueInfo(venueName);
    const address = venueInfo?.address || venueName;

    results.push({
      title,
      period: { start, end },
      periodUnknown,
      venue: {
        name: venueName,
        address,
        location: venueInfo?.location
      },
      openHours: {
        weekday: normalizeText(item.EVENT_TM_INFO || ''),
        weekend: normalizeText(item.EVENT_TM_INFO || ''),
        closed: []
      },
      price: { adult: 0, youth: 0, child: 0, free: true },
      barrierFree: {
        wheelchair: !!venueInfo?.barrierFree?.wheelchair,
        elevator: !!venueInfo?.barrierFree?.elevator,
        braille: !!venueInfo?.barrierFree?.braille,
        audioGuide: !!venueInfo?.barrierFree?.audioGuide
      },
      website: normalizeText(item.URL || item.HOMEPAGE || ''),
      description: normalizeText(item.PARTCPT_EXPN_INFO || item.DESCRIPTION || ''),
      images: item.IMAGE_URL ? [item.IMAGE_URL] : [],
      artists: [],
      stats: { averageRating: 0, reviewCount: 0 },
      _source: 'ggcultur',
      _apiId: `ggcultur-${title}-${venueName}-${start ? start.toISOString() : ''}`
    });
  }

  console.log(`[GGCULTURE] Final results: ${results.length}`);
  return results;
}
