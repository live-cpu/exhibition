import dotenv from 'dotenv';
import Venue from '../models/Venue.js';
import { fetchBraveVenueInfo } from './braveSearch.js';
import { fetchNaverVenueInfo } from './naverExhibitionSearch.js';
import { applyVenueAlias, normalizeVenueNameAdvanced } from './venueAlias.js';

dotenv.config();

const SEMA_API_KEY = process.env.SEMA_API_KEY;
const SEMA_API_BASE_URL = process.env.SEMA_API_BASE_URL || 'http://openapi.seoul.go.kr:8088';
const SEMA_API_SERVICE = process.env.SEMA_API_SERVICE || 'SemaExhibitionInfo';
const CULTURE_API_KEY = process.env.SEMA_CULTURE_API_KEY || process.env.SEMA_API_KEY;
const CULTURE_API_BASE_URL = 'http://openapi.seoul.go.kr:8088';
const CULTURE_SERVICE_NAME = 'culturalEventInfo';
const DEFAULT_ROWS = 200;
const EXTERNAL_ENRICH_ENABLED = String(process.env.EXTERNAL_ENRICH_ENABLED ?? 'true').toLowerCase() !== 'false';
const UPCOMING_WINDOW_DAYS = Number(process.env.UPCOMING_WINDOW_DAYS || 7);
const VENUE_REFRESH_DAYS = Number(process.env.VENUE_REFRESH_DAYS || 7);

const venueCache = new Map();

function stripHtml(text) {
  if (!text) return '';
  return String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return stripHtml(value || '');
}

function normalizeVenueName(value) {
  if (!value) return '';
  return String(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
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

function parseDateRange(value) {
  if (!value) return { start: null, end: null };
  const raw = String(value).trim();
  if (!raw) return { start: null, end: null };

  const normalized = raw.replace(/\./g, '-');
  const rangeMatch = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})\s*[~\-]\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (rangeMatch) {
    return { start: new Date(rangeMatch[1]), end: new Date(rangeMatch[2]) };
  }

  const singleMatch = normalized.match(/(\d{4}-\d{1,2}-\d{1,2})/);
  if (singleMatch) {
    const start = new Date(singleMatch[1]);
    return { start, end: start };
  }

  return { start: null, end: null };
}

function parsePrice(value) {
  if (!value) return { adult: 0, youth: 0, child: 0, free: true };
  const text = String(value).toLowerCase();
  if (text.includes('무료') || text.includes('free') || text.trim() === '0' || text.trim() === '') {
    return { adult: 0, youth: 0, child: 0, free: true };
  }
  const numbers = text.match(/\d+/g);
  if (!numbers || !numbers.length) {
    return { adult: 0, youth: 0, child: 0, free: true };
  }
  const adult = Number(numbers[0]) || 0;
  return {
    adult,
    youth: Math.floor(adult * 0.7),
    child: Math.floor(adult * 0.5),
    free: adult === 0
  };
}

function shouldRefreshVenue(existing) {
  if (!existing?.updatedAt) return true;
  const updated = new Date(existing.updatedAt);
  if (Number.isNaN(updated.getTime())) return true;
  const ageMs = Date.now() - updated.getTime();
  return ageMs > VENUE_REFRESH_DAYS * 24 * 60 * 60 * 1000;
}

function extractRows(payload, serviceName) {
  if (!payload || typeof payload !== 'object') return [];
  if (serviceName && payload[serviceName]?.row) return payload[serviceName].row;
  const key = Object.keys(payload).find((k) => payload[k]?.row);
  if (key) return payload[key].row;
  if (Array.isArray(payload.row)) return payload.row;
  return [];
}

async function resolveVenue(venueName, fallbackLocation) {
  // 먼저 정규화 및 alias 적용
  const aliased = applyVenueAlias(venueName);
  const normalized = normalizeVenueName(aliased || venueName);
  if (!normalized) return null;
  if (venueCache.has(normalized)) return venueCache.get(normalized);

  // SeMA 관련 추가 alias 처리
  const semaAliases = [
    { test: /서소문|덕수궁길|본관|sema 본관/i, name: '서울시립미술관' },
    { test: /북서울|노원/i, name: '서울시립 북서울미술관' },
    { test: /남서울|사당|관악/i, name: '서울시립 남서울미술관' },
    { test: /미술아카이브|평창동/i, name: '서울시립 미술아카이브' },
    { test: /벙커|여의도/i, name: 'SeMA 벙커' },
    { test: /창고|은평|혁신파크/i, name: 'SeMA 창고' }
  ];
  const aliasHit = semaAliases.find((entry) => entry.test.test(normalized));
  const lookupName = aliasHit ? aliasHit.name : normalized;

  const candidates = getVenueNameCandidates(venueName);
  const regexList = candidates.map(buildFlexibleRegex).filter(Boolean);
  const existing = regexList.length
    ? await Venue.findOne({
      $or: [
        ...regexList.map((regex) => ({ name: { $regex: regex } })),
        { name: lookupName }
      ]
    }).lean()
    : await Venue.findOne({ name: lookupName }).lean();

  if (existing?.location?.lat && existing?.location?.lng) {
    const info = {
      name: existing.name,
      address: existing.address || existing.name,
      location: existing.location,
      barrierFree: existing.barrierFree || {}
    };
    venueCache.set(normalized, info);
    return info;
  }

  const needsLocation = !(existing?.location?.lat && existing?.location?.lng);
  if (!EXTERNAL_ENRICH_ENABLED || (!needsLocation && !shouldRefreshVenue(existing))) {
    venueCache.set(normalized, null);
    return null;
  }

  if (fallbackLocation?.lat && fallbackLocation?.lng) {
    const update = {};
    if (!existing) {
      await Venue.create({
        name: normalized,
        address: existing?.address || normalized,
        location: fallbackLocation,
        updatedAt: new Date()
      });
    } else {
      if (!existing.location?.lat || !existing.location?.lng) update.location = fallbackLocation;
      if (Object.keys(update).length) {
        update.updatedAt = new Date();
        await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
      }
    }
    const info = {
      name: existing?.name || normalized,
      address: existing?.address || normalized,
      location: fallbackLocation,
      barrierFree: existing?.barrierFree || {}
    };
    venueCache.set(normalized, info);
    return info;
  }

  const naverInfo = await fetchNaverVenueInfo(venueName);
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

  const braveInfo = await fetchBraveVenueInfo(venueName);
  if (braveInfo?.location) {
    const update = {};
    if (!existing) {
      await Venue.create({
        name: normalized,
        address: braveInfo.address || normalized,
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
      if (typeof existing.barrierFree?.accessibleToilet === 'undefined') {
        bf.accessibleToilet = !!braveInfo.barrierFree?.accessibleToilet;
      }
      if (typeof existing.barrierFree?.parkingPaid === 'undefined') bf.parkingPaid = !!braveInfo.barrierFree?.parkingPaid;
      if (typeof existing.barrierFree?.parkingFree === 'undefined') bf.parkingFree = !!braveInfo.barrierFree?.parkingFree;
      if (Object.keys(bf).length) update.barrierFree = { ...existing.barrierFree, ...bf };
      if (Object.keys(update).length) {
        update.updatedAt = new Date();
        await Venue.findOneAndUpdate({ _id: existing._id }, { $set: update });
      }
    }

    const info = {
      name: existing?.name || normalized,
      address: braveInfo.address || existing?.address || normalized,
      location: braveInfo.location,
      barrierFree: existing?.barrierFree || braveInfo.barrierFree || {}
    };
    venueCache.set(normalized, info);
    return info;
  }

  venueCache.set(normalized, null);
  return null;
}

export async function fetchSeoulCultureExhibitions(options = {}) {
  if (!CULTURE_API_KEY) {
    console.warn('[SeoulAPI] Missing SEMA_API_KEY, skipping...');
    return [];
  }

  const rows = Number(options.rows || DEFAULT_ROWS);
  const url = `${CULTURE_API_BASE_URL}/${CULTURE_API_KEY}/json/${CULTURE_SERVICE_NAME}/1/${rows}`;
  console.log('[SeoulAPI] Fetching exhibitions...');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const rowsData = extractRows(data, CULTURE_SERVICE_NAME);
    if (!Array.isArray(rowsData) || rowsData.length === 0) {
      console.warn('[SeoulAPI] No rows returned.');
      return [];
    }

    const now = new Date();
    const upcomingLimit = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const results = [];
    let missingVenueName = 0;
    let fallbackPlaceUsed = 0;
    let missingLocation = 0;

    for (const item of rowsData) {
      const title = normalizeText(item.TITLE || item.title);
      if (!title) continue;

      const codeName = normalizeText(item.CODENAME || item.codename || '');
      if (codeName && !(codeName.includes('전시') || codeName.includes('미술'))) continue;

      const rawOrg = normalizeText(item.ORG_NAME || item.org_name);
      const rawPlace = normalizeText(item.PLACE || item.place);
      let venueName = rawOrg;
      if (!venueName || /기타/i.test(venueName)) {
        venueName = rawPlace;
        if (venueName) fallbackPlaceUsed += 1;
      }
      if (!venueName) {
        missingVenueName += 1;
        console.warn('[SeoulAPI] Missing venue name for row title:', title);
        continue;
      }

      const period = parseDateRange(item.DATE || item.date || '');
      const fallbackStart = item.STRTDATE || item.START_DATE || item.BEGIN_DATE || item.EXHIBITION_BEGIN;
      const fallbackEnd = item.END_DATE || item.ENDDATE || item.CLOSE_DATE || item.EXHIBITION_END;
      if (!period.start && fallbackStart) {
        period.start = parseDateRange(fallbackStart).start;
      }
      if (!period.end && fallbackEnd) {
        period.end = parseDateRange(fallbackEnd).end;
      }
      const periodUnknown = !(period.start && period.end);
      if (!periodUnknown) {
        if (now >= period.start && now <= period.end) {
          // ongoing
        } else if (period.start > now && period.start <= upcomingLimit) {
          // upcoming
        } else {
          continue;
        }
      }

      const location = {
        lat: Number(item.LAT),
        lng: Number(item.LOT)
      };
      const fallbackLocation = Number.isFinite(location.lat) && Number.isFinite(location.lng)
        ? location
        : null;
      if (!fallbackLocation) missingLocation += 1;

      const venue = await resolveVenue(venueName, fallbackLocation);
      const resolvedVenue = venue || { name: venueName, address: venueName, location: null, barrierFree: {} };

      const description = normalizeText(item.ETC_DESC || item.PROGRAM || '');
      const website = normalizeText(item.ORG_LINK || item.HOMEPAGE || '');
      const imageUrl = normalizeText(item.MAIN_IMG || '');
      const price = parsePrice(item.USE_FEE || '');
      const apiId = `${title}-${resolvedVenue.name}-${period.start ? period.start.toISOString() : ''}`;

      results.push({
        title,
        period: {
          start: period.start,
          end: period.end
        },
        periodUnknown,
        venue: {
          name: resolvedVenue.name,
          address: resolvedVenue.address,
          location: resolvedVenue.location
        },
        price,
        barrierFree: {
          wheelchair: !!resolvedVenue.barrierFree?.wheelchair,
          elevator: !!resolvedVenue.barrierFree?.elevator,
          braille: !!resolvedVenue.barrierFree?.braille,
          audioGuide: !!resolvedVenue.barrierFree?.audioGuide,
          accessibleToilet: !!resolvedVenue.barrierFree?.accessibleToilet,
          parkingPaid: !!resolvedVenue.barrierFree?.parkingPaid,
          parkingFree: !!resolvedVenue.barrierFree?.parkingFree
        },
        website,
        description,
        images: imageUrl ? [imageUrl] : [],
        artists: [],
        stats: { averageRating: 0, reviewCount: 0 },
        _source: 'seoul_api',
        _apiId: `seoul-${apiId}`
      });
    }

    console.log(`[SeoulAPI] Final results: ${results.length}, missingVenueName=${missingVenueName}, fallbackPlace=${fallbackPlaceUsed}, missingLocation=${missingLocation}`);
    return results;
  } catch (err) {
    console.error('[SeoulAPI] API error:', err.message, err.stack);
    return [];
  }
}

export async function fetchSeoulMuseumExhibitions(options = {}) {
  if (!SEMA_API_KEY) {
    console.warn('[SeMA] Missing SEMA_API_KEY, skipping...');
    return [];
  }

  const rows = Number(options.rows || DEFAULT_ROWS);
  const url = `${SEMA_API_BASE_URL}/${SEMA_API_KEY}/json/${SEMA_API_SERVICE}/1/${rows}`;
  console.log('[SeMA] Fetching exhibitions...');

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const rowsData = extractRows(data, SEMA_API_SERVICE);
    if (!Array.isArray(rowsData) || rowsData.length === 0) {
      console.warn('[SeMA] No rows returned.');
      return [];
    }

    const results = [];
    const upcomingLimit = new Date(Date.now() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    for (const item of rowsData) {
      const title = normalizeText(
        item.TITLE ||
        item.EXHIBITION_NM ||
        item.EXHIBITION_NAME ||
        item.EXH_NM ||
        item.NAME ||
        item.SUBJECT
      );
      if (!title) continue;

      const venueName = normalizeText(
        item.PLACE ||
        item.EXHIBITION_PLACE ||
        item.HALL_NAME ||
        item.LOCATION ||
        item.PLACE_NAME ||
        item.SITE
      );
      if (!venueName) continue;

      const startRaw =
        item.START_DATE ||
        item.BEGIN_DATE ||
        item.EXHIBITION_BEGIN ||
        item.EXHIBITION_START ||
        item.DATE_START ||
        item.STRTDATE ||
        item.FROM;
      const endRaw =
        item.END_DATE ||
        item.CLOSE_DATE ||
        item.EXHIBITION_END ||
        item.EXHIBITION_FINISH ||
        item.DATE_END ||
        item.ENDDATE ||
        item.TO;
      const period = {
        start: parseDateRange(startRaw).start,
        end: parseDateRange(endRaw).end
      };

      const periodUnknown = !(period.start && period.end);
      if (!periodUnknown) {
        const now = new Date();
        if (now >= period.start && now <= period.end) {
          // ongoing
        } else if (period.start > now && period.start <= upcomingLimit) {
          // upcoming
        } else {
          continue;
        }
      }

      const venue = await resolveVenue(venueName);
      const resolvedVenue = venue || { name: venueName, address: venueName, location: null, barrierFree: {} };

      const description = normalizeText(item.DESCRIPTION || item.CONTENT || item.OUTLINE || item.CONTENTS || '');
      const website = normalizeText(item.HOMEPAGE || item.URL || item.LINK || '');
      const imageUrl = normalizeText(item.MAIN_IMG || item.IMAGE_URL || item.IMAGE || item.FILE_URL || item.THUMB_URL || '');
      const price = parsePrice(item.PRICE || item.FEE || item.CHARGE || '');
      const apiId = `${title}-${venue.name}-${period.start ? period.start.toISOString() : ''}`;

      results.push({
        title,
        period: {
          start: period.start,
          end: period.end
        },
        periodUnknown,
        venue: {
          name: resolvedVenue.name,
          address: resolvedVenue.address,
          location: resolvedVenue.location
        },
        price,
        barrierFree: {
          wheelchair: !!resolvedVenue.barrierFree?.wheelchair,
          elevator: !!resolvedVenue.barrierFree?.elevator,
          braille: !!resolvedVenue.barrierFree?.braille,
          audioGuide: !!resolvedVenue.barrierFree?.audioGuide,
          accessibleToilet: !!resolvedVenue.barrierFree?.accessibleToilet,
          parkingPaid: !!resolvedVenue.barrierFree?.parkingPaid,
          parkingFree: !!resolvedVenue.barrierFree?.parkingFree
        },
        website,
        description,
        images: imageUrl ? [imageUrl] : [],
        artists: [],
        stats: { averageRating: 0, reviewCount: 0 },
        _source: 'sema_api',
        _apiId: `sema-${apiId}`
      });
    }

    console.log(`[SeMA] Final results: ${results.length}`);
    return results;
  } catch (err) {
    console.error('[SeMA] API error:', err.message);
    return [];
  }
}
